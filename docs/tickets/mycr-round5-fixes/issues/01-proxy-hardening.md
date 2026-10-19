# 01 — 代理強化:共用密鑰最小長度 + PATCH/DELETE 必須帶篩選條件

**What to build:** Edge Function 代理 `kb-proxy` 對兩種「設定或呼叫端出錯時後果最大」的情況主動把關。
(F-04)`EDGE_PROXY_SECRET` 短於 32 字元時,代理視為設定錯誤(回 500、點名原因、不轉發任何請求),
與既有的「密鑰未設定」同一類處理。(F-09)白名單內資料表的 PATCH / DELETE 必須帶至少一個
`欄位=eq.值` 或 `欄位=in.(…)` 篩選條件,否則回 403;GET / POST 不受影響。GAS 端現有每一個
PATCH / DELETE 呼叫本來就帶篩選,所以正常使用行為完全不變。

**Blocked by:** None — can start immediately

**Status:** done

**接縫:** Deno 測試的 `handleRequest`(注入 env 與 fetch,與現有 15 個測試同一接縫);另以 Jest 靜態比對
GAS 端所有 PATCH / DELETE 呼叫點確實都帶篩選(`test/EdgeFunctionProxyConfig.test.js` 既有的比對機制延伸)。

- [x] 密鑰長度 31 → 500(訊息點名 `EDGE_PROXY_SECRET` 過短,不含任何密鑰內容),32 與 64 → 正常處理
- [x] 密鑰過短時不呼叫上游 fetch,且回應與日誌都不含密鑰
- [x] 資料表 PATCH / DELETE 帶 `id=eq.…` 或 `id=in.(…)` → 轉發;不帶任何篩選(空 query、只有 `select=` 或 `limit=`)→ 403 且不轉發
- [x] GET / POST(含 RPC、Storage 的 POST / DELETE / GET)行為不變
- [x] Storage 的 DELETE 不受「必須帶篩選」影響(物件鍵本身就是目標)
- [x] GAS 端所有對 `supabaseUpdate_` / `supabaseDelete_` 的呼叫點都帶篩選條件(靜態比對,忘了帶會直接報錯)
- [x] README 變更紀錄註明:改了 `handler.ts`,**必須重新部署 Edge Function**

> **實作註記:** (1) 密鑰過短時回 500 發生在**比對呼叫端密鑰之前**,對所有請求(含沒帶或帶錯密鑰的)一律 500。
> 若先比對再報錯,猜中的人看到 500、猜錯的人看到 401,等於告訴對方猜測是否命中;與既有「密鑰未設定」同一類 fail-closed 處理。
> (2) 「篩選」的判定是:排除 `select` / `limit` / `offset` / `order` / `columns` / `on_conflict` 後,至少一個參數的值以
> `eq.` 或 `in.(` 開頭且非空。`?select=eq.x` 不算(只是 select 的值)。不認得的運算子(`gt.`、`or=` …)一律不算——
> GAS 日後若新增用法,會在 Jest 的靜態比對或上線後的 403 被發現,回頭來改這條規則。
> (3) 部署前不需要再確認密鑰長度:擁有者已確認 `EDGE_PROXY_SECRET` 是 64 字元。
> (4) **改了 `handler.ts`,必須重新部署 Edge Function**(線上是獨立拷貝);Deno 測試 15 → 21。
