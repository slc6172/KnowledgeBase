# 02 — GAS 端切換:改經代理、不再持有 service_role key

**What to build:** GAS 對 Supabase 的所有呼叫(REST 與 Storage)改送往代理網址,
路徑與 query 原封不動,認證改用共用密鑰 header;設定、診斷不再讀取或顯示
service_role key。業務模組的行為完全不變。

**Blocked by:** 01 — 代理核心(契約定義:網址形狀、`X-KB-Proxy-Secret`、`EDGE_PROXY_SECRET`)

**Status:** done

**接縫(spec〈Testing Decisions〉接縫 1):** GAS 端 `httpFetch_`;另有靜態文字掃描測試。

**手動驗證:** 依 spec 手動驗證清單實測(文章 CRUD、標籤篩選分頁、搜尋與相關文章、
AI 問答、大檔上傳/刪除、PDF/Office 簽名預覽、程式碼附件預覽、冷啟動)。

- [x] REST 請求網址指向代理並保留原上游路徑與 query;帶共用密鑰 header;
      不帶 `apikey` / `Authorization`
- [x] Storage 上傳/刪除/簽名/下載同樣經代理;上傳以原始位元組送出並帶正確 content-type
- [x] 簽名 URL 仍以公開專案網址組成瀏覽器直連網址
- [x] 缺 `EDGE_PROXY_SECRET` 時拋出明確、點名該設定的錯誤;不再要求 service_role key
- [x] 診斷輸出只顯示共用密鑰的長度與過短警告(< 32 字元),不顯示任何片段;
      不再顯示 service_role
- [x] 既有 Articles / Attachments / Search / Categories / Tags / RagChat / Auth 等測試
      只更新假設定即全數通過,斷言邏輯不需改動
- [x] 靜態掃描:GAS 原始碼不再出現 service_role 相關識別字
- [x] `httpFetch_` 仍是全專案唯一呼叫 `UrlFetchApp` 之處

> **實作註記:** spec 預期既有業務測試「只更新假設定」。實際上 Articles / Attachments / Auth /
> Categories / RagChat / RelatedArticles / Search / Tags 的測試把上游網址寫死在斷言裡,因此另需
> 機械式把 `…/rest/v1/`、`…/storage/v1/` 改為經代理的網址(斷言意圖與邏輯不變;回傳給瀏覽器的
> 簽名 URL 斷言維持直連公開網址)。`docs/schema.sql` 內的 service_role 註解依 spec「schema 檔不變」未動。
