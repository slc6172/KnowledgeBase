# 01 — SupabaseClient 基礎層(Config + REST 通用呼叫 + 測試接縫)

**What to build:** 一個可獨立驗證、不需要真的連上 Supabase 的 REST 呼叫層。所有對
Supabase 的 HTTP 請求都收斂到單一可替換的底層函式,上層提供 select/insert/update/
delete/rpc 這幾個好用的介面,並且對錯誤回應給出清楚、可診斷的錯誤訊息。

**Blocked by:** None — can start immediately

**Status:** done

- [x] `getConfig_()` 從 Script Properties 讀出 `SUPABASE_URL`、
      `SUPABASE_SERVICE_ROLE_KEY`、`GEMINI_API_KEY`;`SUPABASE_URL` 或
      `SUPABASE_SERVICE_ROLE_KEY` 缺任一個就丟出點名該欄位的錯誤(`GEMINI_API_KEY`
      這個階段不強制,留給之後用到它的功能自行檢查)。
- [x] `setupScriptProperties()` 提供一次性手動執行的設定函式,把值寫進 Script
      Properties。
- [x] `httpFetch_(url, params)` 是專案裡唯一呼叫 `UrlFetchApp.fetch` 的地方,預設就是
      直接轉呼叫;測試時可以整個替換成假的實作。
- [x] `supabaseRequest(method, path, options)` 組出帶 `apikey` /
      `Authorization: Bearer` / `Content-Type` 標頭(有需要時再加 `Prefer`)的請求,
      透過 `httpFetch_` 送出,回傳解析後的 JSON(空 body 回傳 `null`)。
- [x] 回應碼 ≥ 400 時,`supabaseRequest` 丟出的 `Error` 訊息包含狀態碼與原始回應
      內容。
- [x] `supabaseSelect` / `supabaseInsert` / `supabaseUpdate` / `supabaseDelete` /
      `supabaseRpc` 各自包好正確的 HTTP method 與 query string;insert/update 帶
      `Prefer: return=representation`。
- [x] 用假的 `httpFetch_` 寫測試涵蓋:select 回傳解析後的資料列;insert/update 送出
      正確的 payload 與標頭、並拿到寫入後的那筆資料;模擬 400 回應時會 throw,且
      錯誤訊息看得到狀態碼與回應內容。
