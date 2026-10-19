// kb-proxy 核心:驗證 → 白名單 → 換金鑰 → 轉發。
// 純函式,環境變數與 fetch 都由呼叫端注入,測試不碰網路。

import { createHash, timingSafeEqual } from "node:crypto";

// Storage 只放行這個 bucket,且只放行四種物件操作(上傳/刪除/下載/產生簽名)。
export const ALLOWED_BUCKET = "attachments";

export interface ProxyDeps {
  env: Record<string, string | undefined>;
  fetch: (url: string | URL, init?: RequestInit) => Promise<Response>;
  log?: (line: string) => void;
}

const SECRET_HEADER = "X-KB-Proxy-Secret";

// 共用密鑰的最小長度(字元)。這個端點 verify_jwt=false、對整個網際網路開放,唯一憑證
// 就是這把密鑰;README 的產生方式是 64 個十六進位字元(32 bytes 隨機值)。短於此值視為
// 設定錯誤,fail closed——與「根本沒設定」同一類(500),而不是讓一把可猜的密鑰默默生效。
export const MIN_SECRET_LENGTH = 32;
const SUPPORTED_METHODS = ["GET", "POST", "PATCH", "DELETE"];
const FORWARDED_REQUEST_HEADERS = ["Content-Type", "Prefer"];

// 白名單的單一定義處。新增資料表 / RPC / bucket 必須明確改這裡,
// 並由測試鎖住(忘記更新時,GAS 端新呼叫會在冒煙測試就被 403 擋下)。
export const ALLOWED_TABLES: readonly string[] = [
  "categories",
  "tags",
  "articles",
  "article_tags",
  "attachments",
  "attachment_folders",
];

// RPC 只允許 POST(PostgREST 的 GET 形式會把參數放進 query,本專案從不使用)。
export const ALLOWED_RPCS: readonly string[] = [
  "hybrid_search_articles",
  "related_articles",
  "articles_by_tags",
  "merge_tags",
  "save_article",
  "articles_needing_reindex",
];

// 這些 query 參數是 PostgREST 的「選取 / 排序 / 分頁」控制,不是列的篩選條件,
// 不能拿來滿足「PATCH / DELETE 必須帶篩選」(例如 ?select=eq.x 只是 select 的值)。
const NON_FILTER_PARAMS = new Set(["select", "limit", "offset", "order", "columns", "on_conflict"]);

// 至少有一個「欄位=eq.值」或「欄位=in.(…)」的篩選。本專案的 GAS 端只用這兩種
// (eqFilter_ / inFilter_);不認得的運算子一律不算,寧可在 GAS 日後新增用法時被擋下、
// 回頭來改白名單,也不要放行無篩選的整表寫入。
function hasRowFilter(search: URLSearchParams): boolean {
  for (const [name, value] of search) {
    if (NON_FILTER_PARAMS.has(name)) continue;
    if (/^(eq\.|in\.\().+/.test(value)) return true;
  }
  return false;
}

function proxyError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ source: "kb-proxy", message: `kb-proxy: ${message}` }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

// 常數時間比對:先各自做 SHA-256 變成等長,再用 timingSafeEqual——
// timingSafeEqual 要求長度相同,直接比原字串會因長度不同而拋錯或洩漏長度。
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const PREFIXES = ["/functions/v1/kb-proxy/", "/kb-proxy/"];

// 取出「上游路徑」的各段;任何可疑形式一律回傳 null(由呼叫端當成 403)。
// 只做「拒絕」,不改寫:通過檢查的原始(仍編碼的)路徑會原樣轉發,
// 避免代理與上游對同一路徑的解讀不一致。
function parseUpstreamSegments(pathname: string): string[] | null {
  const prefix = PREFIXES.find((p) => pathname.startsWith(p));
  if (!prefix) return null;
  const segments = pathname.slice(prefix.length).split("/");
  for (const raw of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null; // 無效的百分比編碼
    }
    if (decoded === "" || decoded === "." || decoded === "..") return null;
    if (/[\\/\x00-\x1f\x7f]/.test(decoded)) return null; // 斜線、反斜線、控制字元
  }
  return segments;
}

// 日誌用的路徑:不含 query(可能夾帶搜尋字、標題等內容),去掉函式前綴,
// 非可見 ASCII 一律換成 ?,並限制長度,避免偽造日誌行或灌爆日誌。
function sanitizedPathForLog(request: Request): string {
  const pathname = new URL(request.url).pathname;
  const prefix = PREFIXES.find((p) => pathname.startsWith(p));
  const path = prefix ? pathname.slice(prefix.length - 1) : "/(unknown)";
  return path.replace(/[^\x20-\x7e]/g, "?").slice(0, 200);
}

export async function handleRequest(
  request: Request,
  deps: ProxyDeps,
): Promise<Response> {
  const started = Date.now();
  const response = await route(request, deps);
  // 只記方法、消毒後路徑、狀態碼、耗時。不記密鑰、不記 body——這不是稽核日誌。
  (deps.log ?? console.log)(
    `${request.method.replace(/[^A-Z]/g, "?").slice(0, 10)} ${sanitizedPathForLog(request)} ${response.status} ${Date.now() - started}ms`,
  );
  return response;
}

async function route(
  request: Request,
  deps: ProxyDeps,
): Promise<Response> {
  // 代理自己沒設好共用密鑰 → 500(設定問題),不是 401(呼叫端的問題):
  // 兩者要能一眼分辨,擁有者才知道該檢查代理設定還是 GAS 端的密鑰。
  const expected = deps.env.EDGE_PROXY_SECRET ?? "";
  if (!expected) {
    return proxyError(500, "misconfigured (EDGE_PROXY_SECRET 未設定)");
  }
  // 過短一律 500,而且發生在比對呼叫端密鑰「之前」:若先比對,猜中的人會看到 500、
  // 猜錯的人看到 401,等於告訴對方猜測是否命中。
  if (expected.length < MIN_SECRET_LENGTH) {
    return proxyError(
      500,
      `misconfigured (EDGE_PROXY_SECRET 過短,至少需要 ${MIN_SECRET_LENGTH} 個字元)`,
    );
  }
  const provided = request.headers.get(SECRET_HEADER);
  if (!provided || !secretsMatch(provided, expected)) {
    return proxyError(401, "unauthorized");
  }

  // 上游設定:SUPABASE_URL 與 SUPABASE_SECRET_KEYS 由 Edge Function 執行環境注入。
  // 新版 secret key 放在 JSON 物件裡,以名稱索引,預設那把名為 default。
  // (官方文件查證日期 2026-09-30:supabase.com 的 API keys 與遷移文件,
  //  以 Context7 核對。)
  const upstreamBase = deps.env.SUPABASE_URL;
  if (!upstreamBase) {
    return proxyError(500, "misconfigured (SUPABASE_URL 未設定)");
  }
  let secretKey: string | undefined;
  try {
    const keys = JSON.parse(deps.env.SUPABASE_SECRET_KEYS ?? "");
    secretKey = keys?.["default"];
  } catch {
    return proxyError(500, "misconfigured (SUPABASE_SECRET_KEYS 缺漏或不是 JSON)");
  }
  if (typeof secretKey !== "string" || !secretKey) {
    return proxyError(500, "misconfigured (SUPABASE_SECRET_KEYS 沒有名為 default 的金鑰)");
  }

  // 順序:認證(401)→ 方法(405)→ 路徑白名單(403)。認證放最前面,
  // 未授權者連「哪些方法/路徑存在」都探測不到。
  if (!SUPPORTED_METHODS.includes(request.method)) {
    return proxyError(405, "method not allowed");
  }

  const url = new URL(request.url);
  const segments = parseUpstreamSegments(url.pathname);
  if (!segments) {
    return proxyError(403, "forbidden");
  }
  const upstreamPath = segments.join("/");
  const isAllowedTable = segments.length === 3 &&
    segments[0] === "rest" && segments[1] === "v1" &&
    ALLOWED_TABLES.includes(segments[2]);
  const isAllowedRpc = segments.length === 4 &&
    segments[0] === "rest" && segments[1] === "v1" && segments[2] === "rpc" &&
    ALLOWED_RPCS.includes(segments[3]) && request.method === "POST";
  // storage/v1/object/<bucket>/<key...>:POST 上傳、DELETE 刪除、GET 下載
  // storage/v1/object/sign/<bucket>/<key...>:POST 產生簽名
  const isStorage = segments[0] === "storage" && segments[1] === "v1" &&
    segments[2] === "object";
  const isSign = isStorage && segments[3] === "sign";
  const isAllowedObject = isStorage && !isSign &&
    segments[3] === ALLOWED_BUCKET && segments.length >= 5 &&
    ["POST", "DELETE", "GET"].includes(request.method);
  const isAllowedSign = isSign && segments[4] === ALLOWED_BUCKET &&
    segments.length >= 6 && request.method === "POST";
  if (!isAllowedTable && !isAllowedRpc && !isAllowedObject && !isAllowedSign) {
    return proxyError(403, "forbidden");
  }
  // 資料表的 PATCH / DELETE 必須帶列篩選:沒有篩選會一次改動或清空整張表。
  // 只管資料表;GET、POST、RPC、Storage 物件操作(物件鍵本身就是目標)不受影響。
  if (
    isAllowedTable && (request.method === "PATCH" || request.method === "DELETE") &&
    !hasRowFilter(url.searchParams)
  ) {
    return proxyError(403, "forbidden (PATCH/DELETE 必須帶 eq. 或 in. 篩選條件)");
  }

  // header 採「只轉發清單」而非「刪除黑名單」:共用密鑰、Cookie、User-Agent 等
  // 一律不外流,新增的未知 header 預設也不會被帶到上游。
  const headers = new Headers();
  headers.set("apikey", secretKey);
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // body 以原始位元組轉發、不解析(Edge Function 每請求只有 2 秒 CPU 時間)。
  const raw = await request.arrayBuffer();
  let upstream: Response;
  try {
    upstream = await deps.fetch(
      `${upstreamBase.replace(/\/$/, "")}/${upstreamPath}${url.search}`,
      {
        method: request.method,
        headers,
        body: raw.byteLength > 0 ? raw : undefined,
        redirect: "manual",
      },
    );
  } catch {
    // 錯誤細節可能含金鑰或內部位址,刻意不回傳、不記錄內容;
    // 回 502 讓 GAS 既有的 `code >= 400` 路徑接得住(而不是收到平台的泛用 500)。
    return proxyError(502, "upstream unreachable");
  }
  // 回應也只回傳必要的東西:狀態碼、body、Content-Type。GAS 既有的
  // `code >= 400` 錯誤處理因此完全不用改。刻意不加任何 CORS header——
  // 這個端點只服務伺服器對伺服器呼叫。
  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("Content-Type");
  if (contentType) responseHeaders.set("Content-Type", contentType);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
