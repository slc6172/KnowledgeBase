// kb-proxy 核心的 Deno 測試。
// 只用 Deno 內建與 node:* 內建模組:沙箱封鎖 jsr.io(jsr:@std/assert 會 403),
// 而且零外部依賴也符合專案的供應鏈防護方向。
import assert from "node:assert/strict";
import { handleRequest, type ProxyDeps } from "./handler.ts";

const PROXY_SECRET = "s".repeat(64);
const BASE = "https://proj.supabase.co/functions/v1/kb-proxy";

interface UpstreamCall {
  url: string;
  init: RequestInit;
}

// 假的上游:記錄每次呼叫,回應由測試決定。
function makeDeps(
  respond: (call: UpstreamCall) => Response = () =>
    new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
) {
  const calls: UpstreamCall[] = [];
  const logs: string[] = [];
  const deps: ProxyDeps = {
    env: {
      EDGE_PROXY_SECRET: PROXY_SECRET,
      SUPABASE_URL: "https://proj.supabase.co",
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_TESTKEY" }),
    },
    fetch: (url, init) => {
      const call = { url: String(url), init: init ?? {} };
      calls.push(call);
      return Promise.resolve(respond(call));
    },
    log: (line) => logs.push(line),
  };
  return { deps, calls, logs };
}

function req(path: string, init: RequestInit = {}, withSecret = true) {
  const headers = new Headers(init.headers);
  if (withSecret && !headers.has("X-KB-Proxy-Secret")) {
    headers.set("X-KB-Proxy-Secret", PROXY_SECRET);
  }
  return new Request(`${BASE}/${path}`, { ...init, headers });
}

Deno.test("缺少共用密鑰 → 401,且未發出任何上游請求", async () => {
  const { deps, calls } = makeDeps();
  const res = await handleRequest(req("rest/v1/articles", {}, false), deps);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

Deno.test("錯誤的共用密鑰(含長度不同、長度相同)→ 401,且未發出上游請求", async () => {
  for (const wrong of ["nope", "x".repeat(64), PROXY_SECRET + "x"]) {
    const { deps, calls } = makeDeps();
    const res = await handleRequest(
      req("rest/v1/articles", { headers: { "X-KB-Proxy-Secret": wrong } }),
      deps,
    );
    assert.equal(res.status, 401, `密鑰 ${wrong.slice(0, 4)}… 應被拒絕`);
    assert.equal(calls.length, 0);
  }
});

Deno.test("白名單內的讀取 → 轉發到上游同路徑同 query,secret key 只放 apikey", async () => {
  const { deps, calls } = makeDeps();
  const res = await handleRequest(
    req("rest/v1/articles?select=*&id=eq.abc", {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer should-not-leak",
      },
    }),
    deps,
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://proj.supabase.co/rest/v1/articles?select=*&id=eq.abc",
  );
  assert.equal(calls[0].init.method, "GET");
  const sent = new Headers(calls[0].init.headers);
  assert.equal(sent.get("apikey"), "sb_secret_TESTKEY");
  assert.equal(sent.get("Authorization"), null);
  assert.equal(sent.get("X-KB-Proxy-Secret"), null);
});

Deno.test("白名單外的資料表、RPC、bucket、端點 → 403(固定訊息),未發出上游請求", async () => {
  const denied = [
    "rest/v1/users", // 非白名單資料表
    "rest/v1/", // OpenAPI schema 根路徑
    "rest/v1", // 同上,無結尾斜線
    "rest/v1/rpc/drop_everything", // 非白名單 RPC
    "rest/v1/rpc", // 缺少 RPC 名稱
    "rest/v1/articles/extra", // 額外路徑段
    "auth/v1/admin/users", // 其他服務
    "storage/v1/bucket", // bucket 列舉
    "storage/v1/object/list/attachments", // 物件列舉
    "storage/v1/object/other-bucket/a/b.png", // 非白名單 bucket
    "storage/v1/object/attachments", // 缺少物件路徑
    "functions/v1/other", // 未知前綴
    "v1/rest/v1/articles", // 額外前綴
  ];
  for (const path of denied) {
    const { deps, calls } = makeDeps();
    const res = await handleRequest(req(path), deps);
    assert.equal(res.status, 403, `${path} 應為 403`);
    assert.equal(calls.length, 0, `${path} 不應發出上游請求`);
    const body = await res.json();
    assert.match(body.message, /^kb-proxy: forbidden/);
  }
});

Deno.test("三個白名單 RPC 只接受 POST:POST 轉發成功、GET 被拒", async () => {
  for (const fn of ["hybrid_search_articles", "related_articles", "articles_by_tags"]) {
    const ok = makeDeps();
    const posted = await handleRequest(
      req(`rest/v1/rpc/${fn}`, { method: "POST", body: "{}" }),
      ok.deps,
    );
    assert.equal(posted.status, 200, `${fn} POST 應放行`);
    assert.equal(ok.calls[0].url, `https://proj.supabase.co/rest/v1/rpc/${fn}`);

    const bad = makeDeps();
    const got = await handleRequest(req(`rest/v1/rpc/${fn}`), bad.deps);
    assert.equal(got.status, 403, `${fn} GET 應被拒`);
    assert.equal(bad.calls.length, 0);
  }
});

Deno.test("attachments bucket 的上傳/刪除/簽名/下載 → 放行;其他 Storage 操作 → 403", async () => {
  const key = "11111111-aaaa/22222222-bbbb.pdf";
  const allowed: Array<[string, string, string]> = [
    ["POST", `storage/v1/object/attachments/${key}`, "上傳"],
    ["DELETE", `storage/v1/object/attachments/${key}`, "刪除"],
    ["GET", `storage/v1/object/attachments/${key}`, "下載"],
    ["POST", `storage/v1/object/sign/attachments/${key}`, "簽名"],
  ];
  for (const [method, path, label] of allowed) {
    const { deps, calls } = makeDeps();
    const res = await handleRequest(
      req(path, { method, body: method === "POST" ? "x" : undefined }),
      deps,
    );
    assert.equal(res.status, 200, `${label}應放行`);
    assert.equal(calls[0].url, `https://proj.supabase.co/${path}`);
  }

  const denied: Array<[string, string]> = [
    ["GET", `storage/v1/object/sign/attachments/${key}`], // 簽名只能 POST
    ["DELETE", `storage/v1/object/sign/attachments/${key}`],
    ["GET", `storage/v1/object/public/attachments/${key}`], // 公開端點
    ["GET", `storage/v1/object/authenticated/attachments/${key}`],
    ["POST", `storage/v1/object/move`],
    ["POST", `storage/v1/object/copy`],
    ["POST", `storage/v1/object/sign/other-bucket/${key}`],
    ["PATCH", `storage/v1/object/attachments/${key}`], // 此 bucket 路徑不允許 PATCH
  ];
  for (const [method, path] of denied) {
    const { deps, calls } = makeDeps();
    const res = await handleRequest(
      req(path, { method, body: method === "POST" ? "x" : undefined }),
      deps,
    );
    assert.equal(res.status, 403, `${method} ${path} 應為 403`);
    assert.equal(calls.length, 0);
  }
});

Deno.test("路徑穿越(含編碼)、空段落、控制字元、非預期前綴 → 403,未發出上游請求", async () => {
  // URL 解析器會自行化解字面 ../ 與 %2e%2e 段;能活過解析的是「編碼後的斜線」
  // 與反斜線、NUL、空段落,這些必須由代理自己擋。
  const denied = [
    "storage/v1/object/attachments/a%2F..%2F..%2Fsecret",
    "storage/v1/object/attachments/..%2f..%2fsecret",
    "storage/v1/object/attachments/%2e%2e%2fsecret",
    "storage/v1/object/attachments/a%5C..%5Csecret",
    "storage/v1/object/attachments/a%00b",
    "storage/v1/object/attachments/a//b",
    "storage/v1/object/attachments/a/b/", // 結尾空段落
    "storage/v1/object/attachments/a%ZZb", // 無效百分比編碼
    "rest/v1/articles%2F..%2Fusers",
  ];
  for (const path of denied) {
    const { deps, calls } = makeDeps();
    const res = await handleRequest(req(path), deps);
    assert.equal(res.status, 403, `${path} 應為 403`);
    assert.equal(calls.length, 0, `${path} 不應發出上游請求`);
  }

  // 非預期前綴:必須正好是 /functions/v1/kb-proxy/ 或 /kb-proxy/ 開頭。
  for (const url of [
    "https://proj.supabase.co/evil/kb-proxy/rest/v1/articles",
    "https://proj.supabase.co/functions/v1/x/kb-proxy/rest/v1/articles",
  ]) {
    const { deps, calls } = makeDeps();
    const res = await handleRequest(
      new Request(url, { headers: { "X-KB-Proxy-Secret": PROXY_SECRET } }),
      deps,
    );
    assert.equal(res.status, 403, `${url} 應為 403`);
    assert.equal(calls.length, 0);
  }
});

Deno.test("上游請求只帶 Content-Type 與 Prefer,body 以原始位元組原樣轉發", async () => {
  const { deps, calls } = makeDeps();
  // 含非 UTF-8 的位元組(0xff、0x00),證明代理沒有解析或重新編碼 body。
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0x80, 0x0a]);
  const res = await handleRequest(
    req("storage/v1/object/attachments/a/b.pdf", {
      method: "POST",
      body: bytes,
      headers: {
        "Content-Type": "application/pdf",
        Prefer: "return=representation",
        Cookie: "session=abc",
        "X-Forwarded-For": "1.2.3.4",
        "User-Agent": "Google-Apps-Script",
        "Accept-Encoding": "gzip",
      },
    }),
    deps,
  );
  assert.equal(res.status, 200);
  const sent = new Headers(calls[0].init.headers);
  assert.deepEqual([...sent.keys()].sort(), ["apikey", "content-type", "prefer"]);
  assert.equal(sent.get("content-type"), "application/pdf");
  assert.equal(sent.get("prefer"), "return=representation");
  assert.equal(calls[0].init.method, "POST");
  const sentBody = new Uint8Array(calls[0].init.body as ArrayBuffer);
  assert.deepEqual([...sentBody], [...bytes]);
});

Deno.test("GET 沒有 body 時,不對上游附帶 body", async () => {
  const { deps, calls } = makeDeps();
  await handleRequest(req("rest/v1/tags?select=*"), deps);
  assert.equal(calls[0].init.body, undefined);
});

Deno.test("上游的狀態碼、body、content-type 原樣轉回(含 4xx/5xx),其他 header 丟棄,不加 CORS", async () => {
  for (const status of [200, 201, 400, 404, 409, 500, 503]) {
    const { deps } = makeDeps(() =>
      new Response(`{"code":"X${status}"}`, {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": "sb=1",
          "X-Upstream-Internal": "secret-ish",
          "Access-Control-Allow-Origin": "*",
        },
      })
    );
    const res = await handleRequest(req("rest/v1/categories"), deps);
    assert.equal(res.status, status);
    assert.equal(await res.text(), `{"code":"X${status}"}`);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("x-upstream-internal"), null);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  }
});

Deno.test("上游二進位 body(下載)位元組不變", async () => {
  const bytes = new Uint8Array([0, 255, 128, 10, 13, 200]);
  const { deps } = makeDeps(() =>
    new Response(bytes, { status: 200, headers: { "Content-Type": "application/octet-stream" } })
  );
  const res = await handleRequest(req("storage/v1/object/attachments/a/b.bin"), deps);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...bytes]);
});

Deno.test("不支援的方法(PUT/OPTIONS/HEAD)→ 405,且任何代理自產的錯誤都不含 CORS header", async () => {
  for (const method of ["PUT", "OPTIONS", "HEAD"]) {
    const { deps, calls } = makeDeps();
    const res = await handleRequest(req("rest/v1/articles", { method }), deps);
    assert.equal(res.status, 405, `${method} 應為 405`);
    assert.equal(calls.length, 0);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  }
  const { deps } = makeDeps();
  for (const res of [
    await handleRequest(req("rest/v1/articles", {}, false), deps), // 401
    await handleRequest(req("rest/v1/users"), deps), // 403
  ]) {
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("access-control-allow-headers"), null);
  }
});

Deno.test("代理自己的環境設定缺漏或壞掉 → 500 且點名缺什麼,不轉發、不洩漏金鑰", async () => {
  const cases: Array<[string, (d: ProxyDeps) => void, RegExp]> = [
    ["缺 EDGE_PROXY_SECRET", (d) => delete d.env.EDGE_PROXY_SECRET, /EDGE_PROXY_SECRET/],
    ["缺 SUPABASE_URL", (d) => delete d.env.SUPABASE_URL, /SUPABASE_URL/],
    ["缺 SUPABASE_SECRET_KEYS", (d) => delete d.env.SUPABASE_SECRET_KEYS, /SUPABASE_SECRET_KEYS/],
    ["SUPABASE_SECRET_KEYS 不是 JSON", (d) => (d.env.SUPABASE_SECRET_KEYS = "not-json"), /SUPABASE_SECRET_KEYS/],
    ["SUPABASE_SECRET_KEYS 沒有 default", (d) => (d.env.SUPABASE_SECRET_KEYS = "{}"), /default/],
  ];
  for (const [label, breakIt, pattern] of cases) {
    const { deps, calls } = makeDeps();
    breakIt(deps);
    const res = await handleRequest(req("rest/v1/articles"), deps);
    assert.equal(res.status, 500, label);
    const body = await res.json();
    assert.match(body.message, /^kb-proxy: misconfigured/, label);
    assert.match(body.message, pattern, label);
    assert.doesNotMatch(JSON.stringify(body), /sb_secret_TESTKEY/, label);
    assert.equal(calls.length, 0, label);
  }
});

Deno.test("上游連線失敗(fetch 拋錯)→ 502 且訊息可辨識,不洩漏金鑰或內部錯誤細節", async () => {
  const { deps } = makeDeps();
  deps.fetch = () => Promise.reject(new Error("connect ECONNREFUSED sb_secret_TESTKEY"));
  const res = await handleRequest(req("rest/v1/articles"), deps);
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.match(text, /kb-proxy: upstream unreachable/);
  assert.doesNotMatch(text, /sb_secret_TESTKEY|ECONNREFUSED/);
});

Deno.test("日誌只有方法、路徑(不含 query)、狀態碼、耗時;不含密鑰、金鑰、body、query", async () => {
  const { deps, logs } = makeDeps();
  await handleRequest(
    req("rest/v1/articles?title=eq.機密標題&select=*", {
      method: "POST",
      body: '{"content":"機密內文"}',
    }),
    deps,
  );
  await handleRequest(req("rest/v1/users\nforged-line", {}), deps); // 被拒的請求也要記錄
  await handleRequest(req("rest/v1/articles", {}, false), deps);
  assert.equal(logs.length, 3);
  assert.match(logs[0], /^POST \/rest\/v1\/articles 200 \d+ms$/);
  assert.match(logs[1], / 403 \d+ms$/);
  assert.match(logs[2], /^GET \/rest\/v1\/articles 401 \d+ms$/);
  for (const line of logs) {
    assert.doesNotMatch(line, /機密|title=|select=|sb_secret_TESTKEY/);
    assert.doesNotMatch(line, new RegExp(PROXY_SECRET));
    assert.equal(line.includes("\n"), false, "換行字元必須被消毒,避免偽造日誌行");
  }
});

// ---- mycr F-04:共用密鑰最小長度 ----------------------------------------
// 代理是 verify_jwt=false、對整個網際網路開放的端點,唯一憑證就是這把密鑰。
// 過短的密鑰等於沒有門——視為設定錯誤,fail closed。

Deno.test("共用密鑰短於 32 字元 → 一律 500(點名原因、不轉發、不含密鑰),32 與 64 字元正常", async () => {
  for (const length of [1, 8, 31]) {
    // 用訊息裡不會出現的字元(Z),才能可靠地檢查「密鑰內容不在回應裡」。
    const secret = "Z".repeat(length);
    // 持有正確短密鑰的呼叫端、沒帶密鑰的呼叫端、帶錯密鑰的呼叫端:全部 500,
    // 避免「500 或 401」的差別洩漏某個猜測是否命中。
    for (const clientSecret of [secret, null, "wrong"]) {
      const { deps, calls } = makeDeps();
      deps.env.EDGE_PROXY_SECRET = secret;
      const headers: Record<string, string> = {};
      if (clientSecret !== null) headers["X-KB-Proxy-Secret"] = clientSecret;
      const res = await handleRequest(req("rest/v1/articles", { headers }, false), deps);
      assert.equal(res.status, 500, `長度 ${length}、呼叫端密鑰 ${clientSecret === null ? "(無)" : "有"}`);
      const body = await res.json();
      assert.match(body.message, /^kb-proxy: misconfigured/);
      assert.match(body.message, /EDGE_PROXY_SECRET/);
      assert.match(body.message, /32/);
      assert.ok(!JSON.stringify(body).includes(secret), "回應不得含密鑰內容");
      assert.equal(calls.length, 0);
    }
  }
  for (const length of [32, 64]) {
    const secret = "k".repeat(length);
    const { deps, calls } = makeDeps();
    deps.env.EDGE_PROXY_SECRET = secret;
    const res = await handleRequest(
      req("rest/v1/articles?select=id", { headers: { "X-KB-Proxy-Secret": secret } }, false),
      deps,
    );
    assert.equal(res.status, 200, `長度 ${length} 應正常運作`);
    assert.equal(calls.length, 1);
  }
});

Deno.test("密鑰過短時的日誌不含密鑰", async () => {
  const { deps, logs } = makeDeps();
  deps.env.EDGE_PROXY_SECRET = "shortsecret";
  await handleRequest(req("rest/v1/articles", { headers: { "X-KB-Proxy-Secret": "shortsecret" } }, false), deps);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /shortsecret/);
  assert.match(logs[0], / 500 /);
});

// ---- mycr F-09:資料表的 PATCH / DELETE 必須帶篩選條件 -------------------
// 沒有篩選條件的 PATCH / DELETE 會一次改動或清空整張表。GAS 目前每個呼叫都帶
// 篩選,所以這只是縱深防禦:共用密鑰外洩或 GAS 日後出錯時,擋住「一個請求清空整張表」。

const TABLES = ["categories", "tags", "articles", "article_tags", "attachments", "attachment_folders"];

Deno.test("PATCH / DELETE 帶 eq. 或 in. 篩選 → 轉發(單欄、多欄、in 清單)", async () => {
  const filters = [
    "id=eq.00000000-0000-0000-0000-000000000001",
    "article_id=eq.a&tag_id=eq.b",
    "id=in.(%22a%22,%22b%22)",
    "select=id&id=eq.x", // select 搭配真正的篩選
  ];
  for (const table of TABLES) {
    for (const method of ["PATCH", "DELETE"]) {
      for (const filter of filters) {
        const { deps, calls } = makeDeps();
        const res = await handleRequest(
          req(`rest/v1/${table}?${filter}`, { method, body: method === "PATCH" ? "{}" : undefined }),
          deps,
        );
        assert.equal(res.status, 200, `${method} ${table}?${filter}`);
        assert.equal(calls.length, 1);
      }
    }
  }
});

Deno.test("PATCH / DELETE 沒有篩選條件 → 403,未發出上游請求", async () => {
  const noFilter = [
    "", // 完全沒有 query
    "?select=*",
    "?limit=1",
    "?order=created_at.desc",
    "?select=eq.x", // 只是 select 的值長得像篩選
    "?columns=id",
    "?id=", // 空值
    "?id=gt.5", // 本專案不使用的運算子,不算
    "?foo=bar",
  ];
  for (const table of TABLES) {
    for (const method of ["PATCH", "DELETE"]) {
      for (const query of noFilter) {
        const { deps, calls } = makeDeps();
        const res = await handleRequest(
          req(`rest/v1/${table}${query}`, { method, body: method === "PATCH" ? "{}" : undefined }),
          deps,
        );
        assert.equal(res.status, 403, `${method} ${table}${query} 應為 403`);
        assert.equal(calls.length, 0, `${method} ${table}${query} 不應轉發`);
        const body = await res.json();
        assert.match(body.message, /篩選/);
      }
    }
  }
});

Deno.test("篩選條件規則只管資料表的 PATCH / DELETE:GET、POST、RPC、Storage 不受影響", async () => {
  const cases: Array<[string, string]> = [
    ["GET", "rest/v1/articles?select=*"],
    ["GET", "rest/v1/articles"],
    ["POST", "rest/v1/articles"],
    ["POST", "rest/v1/rpc/hybrid_search_articles"],
    ["POST", "storage/v1/object/attachments/a/b.pdf"],
    ["DELETE", "storage/v1/object/attachments/a/b.pdf"],
    ["GET", "storage/v1/object/attachments/a/b.pdf"],
    ["POST", "storage/v1/object/sign/attachments/a/b.pdf"],
  ];
  for (const [method, path] of cases) {
    const { deps, calls } = makeDeps();
    const res = await handleRequest(
      req(path, { method, body: method === "POST" ? "{}" : undefined }),
      deps,
    );
    assert.equal(res.status, 200, `${method} ${path}`);
    assert.equal(calls.length, 1);
  }
});

Deno.test("篩選檢查在認證與白名單之後:未授權仍是 401、白名單外仍是 403(固定訊息)", async () => {
  const { deps } = makeDeps();
  const unauth = await handleRequest(req("rest/v1/articles", { method: "DELETE" }, false), deps);
  assert.equal(unauth.status, 401);
  const outside = await handleRequest(req("rest/v1/users", { method: "DELETE" }), deps);
  assert.equal(outside.status, 403);
  assert.doesNotMatch((await outside.json()).message, /篩選/);
});

// ---- spec_chunked_embeddings 票 02:merge_tags ---------------------------

Deno.test("merge_tags RPC:POST 轉發;其他方法一律 403(RPC 只允許 POST)", async () => {
  const { deps, calls } = makeDeps();
  const ok = await handleRequest(
    req("rest/v1/rpc/merge_tags", { method: "POST", body: '{"source_tag_id":"a","target_tag_id":"b"}' }),
    deps,
  );
  assert.equal(ok.status, 200);
  assert.equal(calls.length, 1);

  for (const method of ["GET", "PATCH", "DELETE"]) {
    const { deps: d2, calls: c2 } = makeDeps();
    const res = await handleRequest(req("rest/v1/rpc/merge_tags", { method }), d2);
    assert.equal(res.status, 403, `${method} 應被拒絕`);
    assert.equal(c2.length, 0);
  }
});

// ---- spec_chunked_embeddings 票 05:save_article / articles_needing_reindex / article_chunks ----

Deno.test("save_article 與 articles_needing_reindex:POST 轉發;其他方法一律 403", async () => {
  for (const rpc of ["save_article", "articles_needing_reindex"]) {
    const { deps, calls } = makeDeps();
    const ok = await handleRequest(req(`rest/v1/rpc/${rpc}`, { method: "POST", body: "{}" }), deps);
    assert.equal(ok.status, 200, rpc);
    assert.equal(calls.length, 1);

    for (const method of ["GET", "PATCH", "DELETE"]) {
      const { deps: d2, calls: c2 } = makeDeps();
      const res = await handleRequest(req(`rest/v1/rpc/${rpc}`, { method }), d2);
      assert.equal(res.status, 403, `${rpc} ${method} 應被拒絕`);
      assert.equal(c2.length, 0);
    }
  }
});

Deno.test("article_chunks 不對外開放:任何方法、任何形式的直接存取都是 403,且不轉發", async () => {
  const paths = [
    "rest/v1/article_chunks",
    "rest/v1/article_chunks?select=*",
    "rest/v1/article_chunks?article_id=eq.x",
    "rest/v1/rpc/article_chunks",
  ];
  for (const path of paths) {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const { deps, calls } = makeDeps();
      const res = await handleRequest(req(path, { method, body: method === "POST" ? "{}" : undefined }), deps);
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal(calls.length, 0, `${method} ${path} 不應轉發`);
    }
  }
});
