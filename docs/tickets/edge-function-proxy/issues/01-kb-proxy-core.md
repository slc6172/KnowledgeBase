# 01 — 代理核心 `kb-proxy`:驗證、白名單、轉發

**What to build:** 一個 Supabase Edge Function 薄轉發層。收到請求後依序:
驗證共用密鑰 → 檢查方法與路徑白名單 → 換上 Supabase 新版 secret key → 原樣
轉發並把上游回應原樣轉回。核心是可注入環境變數與 `fetch` 的純函式,函式設定檔
明確關閉平台 JWT 驗證。這張票交付後,代理即可獨立用 Deno 測試驗證完整契約。

**Blocked by:** None — can start immediately

**Status:** done

**接縫(spec〈Testing Decisions〉接縫 2):** Edge Function 端 `handleRequest(request, deps)`,
`deps` 注入環境變數與 `fetch`;Deno 內建測試,只用 Deno 內建與 `node:*` 模組。

**手動驗證:** 部署後以 curl 冒煙測試(缺密鑰 401、白名單外 403、合法讀取 200);
大檔上傳與冷啟動實測。

- [x] 缺少或錯誤的共用密鑰 → 401(固定、可辨識的訊息),且完全不發出上游請求
- [x] 共用密鑰以常數時間比對
- [x] 白名單內的資料表(6 張)、RPC(3 個,僅 POST)、`attachments` bucket 的
      上傳/刪除/簽名/下載 → 轉發成功
- [x] 白名單外的資料表、RPC、bucket → 403(固定、可辨識的訊息);RPC 用 GET → 拒絕
- [x] 路徑穿越(含百分比編碼)、空段落、額外前綴、`rest/v1` 根路徑、`auth/v1`、
      bucket 列舉一律拒絕
- [x] 上游請求:secret key 只放 `apikey`、無 `Authorization`;只轉發
      `Content-Type` 與 `Prefer`;共用密鑰 header 不外流;方法、query string、
      原始位元組 body 原樣轉發
- [x] 回應:狀態碼、body、`Content-Type` 原樣轉回(含 4xx / 5xx),其他上游 header
      丟棄;不加 CORS header;不支援的方法 → 405
- [x] 上游金鑰取自 `SUPABASE_SECRET_KEYS` 中名為 `default` 的那把,網址取自 `SUPABASE_URL`;
      環境設定缺漏時回明確的伺服器端錯誤而不是轉發
- [x] 日誌只含方法、消毒後路徑、狀態碼、耗時
- [x] 函式設定檔明確宣告關閉平台 JWT 驗證
- [x] 既有 `npm test`(Jest)不會誤把 Deno 測試檔當成 Jest 測試執行,且全數維持通過

> **實作註記:** (1) 測試檔命名為 `handler_test.ts`(Deno 慣例)而非 `.test.ts`,並在 Jest 設定另加
> `testPathIgnorePatterns`,雙重避免 Jest 誤抓。(2) 額外處理「上游連線失敗 → 502(代理自產、可辨識)」,
> spec 未明訂,但不處理則 GAS 會收到平台泛用 500,無法與資料庫錯誤區分(決策紀錄)。
> (3) 順序為認證 401 → 方法 405 → 路徑白名單 403。(4) 白名單與 schema / GAS 呼叫點的一致性由
> Jest 靜態測試守住(見 `EdgeFunctionProxyConfig.test.js`)。
