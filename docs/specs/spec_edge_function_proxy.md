---
title: GAS 改經 Supabase Edge Function 代理存取 Supabase
status: ready-for-agent
date: 2026-09-28
project: GAS + Supabase 個人/團隊知識庫
depends_on: docs/DESIGN.md、README「已知風險」(Legacy service_role key)
---

# Spec:GAS 改經 Supabase Edge Function 代理存取 Supabase,不再持有 service_role key

**Triage label**:`ready-for-agent`

**來源**:`future.pdf`(外部研究建議 §3)+ `/grilling` 對談定案(2026-09-28)。研究過
`coleam00/Archon`(`archive/v1-task-management-rag` 分支)與 `lobehub/lobehub`,
結論見〈Further Notes〉。

## Problem Statement

目前 Google Apps Script(GAS)用 `UrlFetchApp` 直接呼叫 Supabase 的 PostgREST 與 Storage,
並使用 **Legacy `service_role` key**(JWT 格式)。這個做法有兩個問題:

1. **Legacy key 即將淘汰。** Supabase 官方文件已明確要求遷移到 `sb_publishable_…` /
   `sb_secret_…`,舊版 `anon` / `service_role` 預計 2026 年底淘汰,新專案已不再提供舊版金鑰。
2. **新版 secret key 從 GAS 打不通。** 新版 secret key 由 Supabase 依 User-Agent 偵測瀏覽器型
   請求並回 401;GAS 的 `UrlFetchApp` 預設 User-Agent 是
   `Mozilla/5.0 (compatible; Google-Apps-Script; …)`,且無法自訂。所以現有架構在 Legacy
   key 被淘汰的那天會整個失效,沒有 GAS 端可以自救的辦法。

README 已把這件事記為「已知風險」,並預告需要加一層代理(如 Edge Function)。從擁有者的角度:
不想等到被強制淘汰才緊急重構,也不想因此重寫已經過大量測試與資安複查的 GAS 端邏輯。

## Solution

在 GAS 與 Supabase 之間加一個 **Supabase Edge Function 薄轉發層(`kb-proxy`)**:

```
GAS ──HTTPS + 自訂共用密鑰──▶ Edge Function (kb-proxy) ──新版 secret key──▶ PostgREST / Storage
```

- GAS 端的查詢組法(`eqFilter_` / `inFilter_` / RPC 呼叫 / Storage 呼叫)與所有業務邏輯**維持不變**,
  只換掉「送去哪個網址、帶哪個認證 header」。
- 真正的 Supabase secret key **只存在 Supabase 內部**,不再進入 GAS 的 Script Properties。
- 代理內建**白名單**,只放行本專案實際使用的資料表、RPC 與 `attachments` bucket。
- 這是「相容性遷移」,不是效能或功能升級(見〈Further Notes〉的誠實評估)。

## User Stories

**擁有者(部署與維運)**

1. As an 擁有者, I want GAS 不再持有 Supabase 萬能金鑰, so that GAS 專案外洩時攻擊者拿不到能直連資料庫的鑰匙
2. As an 擁有者, I want 系統在 Legacy key 淘汰後仍正常運作, so that 我不用在期限前緊急重構
3. As an 擁有者, I want 代理只放行本專案用到的資料表、RPC 與 bucket, so that 即使共用密鑰外洩,攻擊面也被限縮
4. As an 擁有者, I want 共用密鑰可以用一行指令輪替, so that 懷疑外洩時能立刻止血
5. As an 擁有者, I want 輪替共用密鑰時完全不影響 Supabase 本身的金鑰, so that 不會牽動其他依賴這些金鑰的東西
6. As an 擁有者, I want 有一份明確的既有部署遷移步驟, so that 我能依序操作而不會讓線上系統中斷
7. As an 擁有者, I want 遷移步驟明訂「先部署函式、再推送 GAS」的順序, so that 中間不會出現 GAS 打不到代理的空窗
8. As an 擁有者, I want 遷移驗證完成後才刪除舊的 `SUPABASE_SERVICE_ROLE_KEY` 屬性, so that 出問題時還有時間用 git revert 退回舊版
9. As an 擁有者, I want 新部署的專案完全不需要 Legacy key, so that 新環境一開始就走在正確的路上
10. As an 擁有者, I want 設定缺漏(如沒設 `EDGE_PROXY_SECRET`)時得到明確的錯誤訊息, so that 我知道缺哪個設定而不是看到神祕的失敗
11. As an 擁有者, I want 診斷工具 `debugConfig_` 只顯示共用密鑰的長度與是否過短、絕不顯示任何片段, so that 密鑰不會經由截圖或貼文洩漏
12. As an 擁有者, I want 診斷工具不再顯示或要求 service_role key, so that 診斷輸出跟新架構一致
13. As an 擁有者, I want 代理「設定錯了」與「資料庫查詢失敗」的錯誤訊息可以區分, so that 我能快速判斷該檢查代理設定還是資料
14. As an 擁有者, I want 代理的日誌只記錄方法、消毒後的路徑、狀態碼與耗時, so that 日誌對除錯有用又不會洩漏密鑰或內容
15. As an 擁有者, I want 代理設定在函式設定檔中明確關閉平台 JWT 驗證, so that 日後重新部署不會意外還原成預設值而讓 GAS 全部 401

**知識庫使用者(功能不變)**

16. As a 知識庫使用者, I want 文章的建立、編輯、發布、刪除照常運作, so that 遷移對我完全無感
17. As a 知識庫使用者, I want 搜尋(Hybrid Search)與相關文章照常運作, so that 我找資料的方式不變
18. As a 知識庫使用者, I want 標籤篩選與分頁照常運作, so that 大量文章下仍可瀏覽
19. As a 知識庫使用者, I want 附件上傳、刪除、資料夾管理照常運作, so that 我的附件流程不受影響
20. As a 知識庫使用者, I want PDF / Office 附件預覽的簽名連結照常可用, so that 我仍能線上預覽
21. As a 知識庫使用者, I want 程式碼附件預覽(伺服器端下載內容)照常運作, so that 語法高亮預覽不受影響
22. As a 知識庫使用者, I want AI 問答照常運作, so that 我仍能對知識庫發問

**代理行為(系統)**

23. As a 系統, I want 密鑰缺漏或錯誤時立即回 401 且不做任何上游呼叫, so that 未授權請求不消耗上游資源
24. As a 系統, I want 用常數時間比對共用密鑰, so that 不會被計時攻擊逐字猜出密鑰
25. As a 系統, I want 白名單外的資料表、RPC、bucket 一律回 403, so that 攻擊者即使拿到密鑰也無法存取未列出的資源
26. As a 系統, I want 拒絕含路徑穿越(含編碼形式)的路徑, so that 白名單不會被繞過
27. As a 系統, I want 拒絕 `rest/v1` 根路徑(OpenAPI schema)、bucket 列舉、`auth/v1` 等未列入的端點, so that 不洩漏 schema 或其他服務
28. As a 系統, I want 只轉發 `Content-Type` 與 `Prefer` 兩個請求 header, so that 共用密鑰與其他不該外流的 header 不會被帶到上游
29. As a 系統, I want 以原始位元組轉發請求 body 而不解析, so that 大檔上傳不觸發 CPU 時間上限
30. As a 系統, I want 上游的狀態碼、body 與 content-type 原樣轉回, so that GAS 既有的 `code >= 400` 錯誤處理完全不用改
31. As a 系統, I want 對上游只把 secret key 放在 `apikey` header、不放 `Authorization`, so that 符合新版金鑰不是 JWT 的官方規則
32. As a 系統, I want 不加任何 CORS header, so that 這個端點只服務伺服器對伺服器呼叫

**開發者(測試與維護)**

33. As a 開發者, I want 代理核心是可注入環境變數與 `fetch` 的純函式, so that 能用假實作在不碰網路下測完所有行為
34. As a 開發者, I want CI 自動執行代理的 Deno 測試, so that 白名單或驗證被改壞時 PR 就會失敗
35. As a 開發者, I want CI 新增的步驟同樣以 commit SHA 固定版本並納入既有的 CI 加固測試, so that 不會為了新工具破壞已建立的供應鏈防護
36. As a 開發者, I want 既有 GAS 測試只需更新假設定就能全部通過, so that 我確信業務邏輯確實沒被動到
37. As a 開發者, I want 有一個靜態檢查確保 GAS 原始碼不再出現 service_role 相關字樣, so that 舊路徑不會被遺留或不小心復活
38. As a 開發者, I want 新增資料表或 RPC 時,白名單的修改點單一且有測試鎖住, so that 忘記更新白名單時能立刻發現

## Implementation Decisions

**架構**

- 新增 Edge Function `kb-proxy`(Supabase Edge Function,Deno / TypeScript),GAS 端所有對 Supabase 的呼叫改經由它。
- 採**薄轉發**而非重新設計 API:GAS 端組出的 PostgREST / Storage 路徑與查詢字串原封不動送給代理,代理只負責「驗證 → 白名單 → 換金鑰 → 轉發」。理由:既有 querystring 編碼邏輯(`eqFilter_` / `inFilter_` 等)歷經多輪踩坑與官方文件核對、有大量專屬測試,重設 API 等於整包重來,對一個只為繞開 User-Agent 封鎖的問題不成比例。
- **直接切換,不留雙路徑開關。** 舊 Legacy 路徑在 2026 年底前仍可用,出問題以 git revert 退回;維護兩套路徑與兩套測試不值得。
- **Gemini 呼叫維持 GAS 直接發送**,不納入本次範圍(它不受 Supabase 金鑰淘汰影響)。
- 瀏覽器端使用的 Storage 簽名 URL 仍直連 Supabase Storage(token 內含於 URL),不經代理;代理只轉發「產生簽名」這個請求。

**代理契約(GAS ↔ `kb-proxy`)**

- 網址:專案的 Edge Functions 端點 + `kb-proxy` + 一段「上游路徑」,上游路徑必須以 `rest/v1/` 或 `storage/v1/` 開頭,其後內容與 query string 與 GAS 現行直打 Supabase 時完全相同。GAS 端由既有的 `SUPABASE_URL` 組出代理網址,不新增網址屬性。
- 認證:自訂 header `X-KB-Proxy-Secret`,值為共用密鑰。**不使用** `Authorization` 或 `apikey` header 與代理溝通。
- 密鑰:兩端使用同名設定 `EDGE_PROXY_SECRET`(GAS 存於 Script Properties,Supabase 端存於 Edge Function secrets)。至少 32 bytes 隨機值(建議 64 個十六進位字元)。函式以常數時間比對。
- 平台 `verify_jwt` **關閉**(新版 API key 不是 JWT,內建檢查無法驗證;專案本身也沒有 Supabase Auth 與使用者 JWT),並在函式設定檔中明確宣告,避免重新部署時還原。
- 錯誤區分:代理自己產生的 401(認證失敗)與 403(白名單拒絕)使用可辨識的固定訊息;上游轉回的錯誤維持原樣。
- 請求 header 轉發清單:僅 `Content-Type`、`Prefer`;其餘一律丟棄(含共用密鑰 header)。方法、query string、原始位元組 body 原樣轉發。
- 回應:狀態碼、body、`Content-Type` 原樣轉回,其他上游 header 丟棄。
- 不加 CORS header;不支援的方法回 405。
- 日誌:只記方法、消毒後路徑、狀態碼、耗時;不記密鑰、不記 body。這不是稽核日誌(見 Out of Scope)。

**白名單(單一常數定義,新增資源需明確修改並有測試鎖住)**

- REST 資料表:`categories`、`tags`、`articles`、`article_tags`、`attachments`、`attachment_folders`(允許 GET / POST / PATCH / DELETE)。
- RPC:`hybrid_search_articles`、`related_articles`、`articles_by_tags`(僅 POST)。
- Storage:僅 `attachments` bucket;僅允許上傳、刪除、產生簽名、下載這四種物件操作。
- 以上以資料庫 schema 檔與 GAS 現行呼叫點為準;實作時須再對照一次,確認沒有遺漏或多列。
- 路徑正規化後再比對;含 `..`(含百分比編碼)、空段落、額外前綴的一律拒絕。

**代理對上游的金鑰**

- 使用 Supabase 新版 secret key,由 Edge Function 執行環境注入的 `SUPABASE_SECRET_KEYS` 讀取(預設使用名為 `default` 的那把),**只放在 `apikey` header**。上游網址取自執行環境注入的 `SUPABASE_URL`。
- 實作時須以官方文件(可用專案已連接的 Context7)再核對一次環境變數的結構與名稱,因為這部分屬於近期變動中的 API。

**GAS 端(模組層級變更)**

- Config:設定物件改為提供 `supabaseUrl` 與共用密鑰;不再讀取、要求或回傳 service_role key。缺 `EDGE_PROXY_SECRET` 時拋出明確錯誤。`SUPABASE_URL` 保留(組代理網址與簽名 URL 皆需要)。
- 診斷(`debugConfig_`):共用密鑰比照寫入密碼的既有慣例(mycr F-05):只印長度與過短警告(< 32 字元),絕不印任何片段;移除 service_role 的顯示。
- SupabaseClient / StorageClient:組網址改為代理網址;認證 header 改為 `X-KB-Proxy-Secret`;不再送 `apikey` / `Authorization`。上傳改為原始位元組加上 content-type。`httpFetch_` 仍是全專案唯一呼叫 `UrlFetchApp` 的地方,不變。
- 其他業務模組(Articles、Attachments、Search、RelatedArticles、Categories、Tags、RagChat、Auth)不應需要修改。若實作時發現需要動,先停下來確認是不是接縫被破壞。
- 代理不可達或逾時的錯誤,沿用既有的上游錯誤分類與使用者安全訊息,不新增分類。

**部署與 CI**

- Edge Function 原始碼放入 repo 的 Supabase functions 目錄,以 Supabase CLI 部署;函式設定檔宣告關閉平台 JWT 驗證。
- CI 新增 Deno 安裝與 `deno test` 步驟;該 action 需以 commit SHA 固定,並擴充既有的 CI 加固測試涵蓋新步驟。
- 既有 Node / Jest 流程不變。

**既有部署的遷移步驟(須寫入 README)**

1. 在 Supabase Dashboard 確認新版 secret key 存在。
2. 產生隨機共用密鑰;以 CLI 設定 Edge Function secret `EDGE_PROXY_SECRET` 並部署 `kb-proxy`。
3. 用 curl 對代理做冒煙測試(缺密鑰 → 401、白名單外 → 403、合法讀取 → 200)。
4. 在 GAS Script Properties 新增 `EDGE_PROXY_SECRET`。
5. `clasp push` 並重新部署 Web App。
6. 依〈手動驗證清單〉實測。
7. 確認無誤後,才刪除 `SUPABASE_SERVICE_ROLE_KEY` 屬性,最後視需要停用 Supabase 的 Legacy keys。

**文件**

- README:架構圖與說明改為經 Edge Function;快速開始改為新流程;原「務必使用 Legacy service_role」的警告段落改寫為遷移說明;新增一條問題修復/變更紀錄與版本號調整。
- 設計文件(DESIGN):決策表新增一列,架構圖同步更新。
- 資料庫 schema 檔不變。

## Testing Decisions

**什麼是好測試**:只驗證外部可觀察的行為(送出的請求、回傳的回應、拋出的錯誤),不驗證內部實作細節;沿用專案既有做法——把網路接縫換成假實作,測試自己決定回應。

**兩個接縫(每個執行環境一個,已與擁有者確認)**

1. **GAS 端:既有的 `httpFetch_`。** 新增/更新測試驗證:請求網址指向代理且保留原上游路徑與 query;帶 `X-KB-Proxy-Secret`;不帶 `apikey` / `Authorization`;上傳以原始位元組送出並帶正確 content-type;簽名 URL 仍以公開專案網址組成瀏覽器直連網址;缺共用密鑰時錯誤訊息明確;`debugConfig_` 不輸出密鑰片段。既有 Articles / Attachments / Search / Categories / Tags / RagChat / Auth 等測試只更新假設定(`testSetup` 的設定值),預期不需改斷言邏輯。
2. **Edge Function 端(新增):** 核心為純函式 `handleRequest(request, deps)`,`deps` 注入環境變數與 `fetch`。以 Deno 內建測試執行。涵蓋:
   - 缺密鑰 / 錯誤密鑰 → 401,且**未**發出任何上游請求
   - 白名單內的表 / RPC / bucket 操作 → 轉發成功;白名單外 → 403;RPC 用 GET → 拒絕
   - 路徑穿越(含編碼)、`rest/v1` 根路徑、`auth/v1`、bucket 列舉 → 拒絕
   - 上游請求:secret key 只在 `apikey`、無 `Authorization`;只轉發 `Content-Type` / `Prefer`;共用密鑰 header 未外流;方法、query、原始 body 原樣
   - 回應:狀態碼、body、content-type 原樣轉回(含 4xx / 5xx)
   - 不支援的方法 → 405;不含 CORS header

**Deno 測試的依賴限制(2026-09-28 於容器實測)**:Deno 2.9.6 可透過 `npm install -g deno` 安裝並執行 `deno test`;但 `jsr.io` 被沙箱網路封鎖(`jsr:@std/assert` 匯入回 403)。因此代理核心與其測試**只使用 Deno 內建與 `node:*` 內建模組**(斷言用 `node:assert/strict`、常數時間比對用 `node:crypto` 的 `timingSafeEqual`),**不使用任何遠端 URL 或 `jsr:` 匯入**。這同時讓核心保持零外部依賴,符合專案的供應鏈防護方向。已實測:注入假 `env` / 假 `fetch` 的 `handleRequest` 樣板可用 `Request` / `Response` 完整測試(401 且未發出上游請求、帶密鑰時轉發)。

**靜態檢查(既有測試風格)**:新增測試確認 GAS 原始碼不再出現 service_role 相關識別字;CI 加固測試涵蓋 Deno 步驟。

**先前案例(Prior art)**:`test/SupabaseClient.test.js`、`test/StorageClient.test.js`(假 `httpFetch_` 斷言網址/header)、`test/helpers/testSetup.js`(假 PropertiesService)、`test/Config.test.js`(診斷輸出不洩漏密鑰)、`test/CiWorkflowHardening.test.js`(CI 靜態斷言)、`test/PrivateFunctionExposure.test.js`(靜態掃描風格)。

**不自動化測試的部分(需手動)**:兩端契約是否在真實環境對得起來(以〈手動驗證清單〉的冒煙測試涵蓋)、冷啟動、大檔上傳。

**手動驗證清單**:新增/編輯/發布/刪除文章;標籤篩選分頁;搜尋與相關文章;AI 問答;上傳大檔(接近實際會用的上限)與刪除;PDF / Office 簽名連結預覽;程式碼附件預覽;閒置一段時間後的第一個請求(冷啟動可接受)。

## Out of Scope

- 新功能(MCP server、reranking、網頁擷取匯入等,見〈Further Notes〉備忘)。
- Gemini API 呼叫的搬遷或集中管理。
- 稽核日誌 / 操作歸屬(維持 README 第 55 條已接受的取捨)。
- 雙路徑切換開關(新舊路徑並存)。
- 量身設計的業務 API(取代薄轉發)。
- Supabase Auth / RLS / 個別使用者身分。
- 代理端的速率限制(GAS 端既有節流維持;代理在密鑰錯誤時立即回 401)。
- 自架 Supabase 或更換後端平台。

## Further Notes

**誠實評估(避免對遷移抱錯誤期待)**

- **效能:沒有幫助,略慢。** 多一跳,且閒置後有冷啟動。Edge Function 限制(2026-09 官方文件):每請求最多 2 秒 CPU 時間、256MB 記憶體、免費方案 wall clock 150 秒、閒置逾時 150 秒回 504、函式打包上限 20MB(CLI)。這也是為何 body 要以原始位元組轉發、不解析。
- **安全:單純轉發不提升安全;提升來自兩點。** (1) 真正的 secret key 不離開 Supabase;(2) 白名單。若不加白名單,安全面僅打平。
- **本質是相容性遷移**,讓系統能撐過 Legacy key 淘汰。

**設計取捨的依據(認證方式)**

平台內建 `verify_jwt` 只認使用者 JWT,新版 publishable / secret key 不是 JWT,官方文件明示「服務對服務、以 API key 呼叫的函式應關閉 `verify_jwt` 並自行授權」。本專案無使用者 JWT,故內建驗證不適用。考慮過的替代方案:GAS 改送一把命名的 Supabase secret key、由函式以官方 `@supabase/server` 驗證(`auth: 'secret:<name>'`)。未採用原因:(1) GAS 仍持有萬能金鑰,失去「金鑰不離開 Supabase」的好處;(2) 官方文件未明說 User-Agent 偵測是否也適用於 Edge Function,而 User-Agent 問題正是本次遷移的起因。

**風險與待驗證**

- 大檔上傳經代理的實際上限,須以真實檔案實測。
- 免費方案的 Edge Function 呼叫次數配額:代理對未授權請求立即回 401 以降低濫用消耗,但公開端點仍可能被打爆配額(與 GAS Web App 本身的暴露面相同)。
- `SUPABASE_SECRET_KEYS` 等執行環境變數屬近期變動的 API,實作前須再核對官方文件。
- 兩端契約分開測試,有漂移風險,以手動冒煙測試把關。

**建議切票方向(供 `/to-tickets` 參考,非強制)**

1. 代理核心:`handleRequest` + Deno 測試(認證、白名單、轉發、回應),函式設定檔。
2. GAS 端切換:Config / SupabaseClient / StorageClient / `debugConfig_` + 測試更新 + 靜態檢查。依賴 1 的契約定義。
3. CI 步驟(Deno)+ CI 加固測試擴充 + README / DESIGN 更新 + 遷移步驟文件。依賴 1、2。
4. **(選用,擁有者可刪)** `debugConfig_` 連線自我檢查:對代理打一個最小的白名單內讀取,依回應輸出診斷(401 → 共用密鑰兩端不一致、403 → 白名單、404 → 函式未部署、200 → 正常)。這是第二輪研究(Archon 啟動時驗證金鑰角色的做法)啟發的遷移期診斷輔助,不是新功能;沒有它,前三張票仍完整。依賴 2。

**參考 repo(供實作時快速查閱)**

- 見下方〈參考 repo 與可借鏡之處〉。

## 參考 repo 與可借鏡之處

研究對象:
- Archon v1:`https://github.com/coleam00/Archon`,分支 `archive/v1-task-management-rag`(主分支已轉型為 coding workflow engine,不要參考)
- LobeHub:`https://github.com/lobehub/lobehub`(LobeChat 的現行 repo)
- 兩輪研究角度:第一輪看檢索與架構;第二輪看遷移追蹤、embedding 重試、金鑰驗證、MCP 工具面、測試慣例、RAG 提示詞與引用 UI、專案層級 AI 指引檔。

### 對照後確認「現行做法沒問題」

- **全文檢索選型**:Archon 的 hybrid search 全文那半用 `to_tsvector('english', …)`(migration `002_add_hybrid_search_tsvector.sql`),完全不處理中文,印證本專案選 `pg_trgm` 正確。
- **整體架構**:LobeHub 知識庫官方文件(`lobehub.com/docs/self-hosting/advanced/knowledge-base`)的 Postgres + pgvector + 物件儲存 + embedding 服務,與本專案 Supabase 選型同構。
- **測試接縫**:Archon 的測試以全域 `MagicMock` 換掉整個 Supabase client(`python/tests/conftest.py`),比本專案在 `httpFetch_` 換假實作的做法更遠離真實請求形狀。本專案的接縫較好,本 spec 沿用,不需仿效。

### 明確不採用

- Archon `reranking_strategy.py`:依賴本機 CrossEncoder 模型,GAS 無法執行;改用 LLM 重排則成本與延遲不成比例。
- Archon 網頁爬取管線、Docker 部署、多維度 embedding 欄位、agent work orders:與單人/小團隊 GAS 知識庫無關。
- LobeHub 的 chunk 切片與片段預覽:本專案「整篇一個向量」(DESIGN 決策 #8)不適用。
- LobeHub 多知識庫:本專案為單一知識庫。

### 備忘 backlog(新功能或強化;不屬於本 spec,各自需另走 `/grilling` → `/to-spec`)

依「價值/成本」由高到低:

1. **專案層級 `AGENTS.md` / `CLAUDE.md`**:兩個 repo 都有(Archon 的 `CLAUDE.md` 含開發指令、架構概覽、DB schema、命名慣例、品質標準)。本專案沒有。建議內容:測試指令與 Node 版本範圍、接縫(`httpFetch_`)與「測試不碰真實網路」原則、GAS 私有函式底線命名慣例、文件流程(`/grilling` → `/to-spec` → `/to-tickets` → `/tdd`)與 README 變更紀錄慣例、實作前以 Context7 核對官方文件的習慣。對「開新對話後用 `/to-tickets`、`/tdd` 實作」直接加速,成本最低。
2. **Gemini 呼叫的重試與退避**:Archon `embedding_service.py` 區分「配額耗盡」與「一般速率限制」,後者以指數退避(2 的 n 次方秒)重試。本專案 `generateEmbedding_` 遇到 429 即失敗、無重試。
3. **搜尋降級**:LobeHub `formatSearchResults.ts` 在其中一路檢索失敗時仍回傳另一路並附註。本專案 embedding 失敗會讓整個 `searchArticles` 失敗,即使 `pg_trgm` 關鍵字搜尋根本不需要向量。**已於 2026-09-28 以真實 PostgreSQL 16 + pgvector 驗證:`hybrid_search_articles` 收到 NULL 向量時語意那一路自然為空、關鍵字那一路照常回傳,不需要 schema 變更**(本條原本誤寫為需要 schema 變更,已更正)。已另立 spec。
4. **多輪問答的查詢改寫**:LobeHub `userQuery.ts` 同時保留 `raw_query` 與 `rewrite_query`。本專案 RAG 只用最新一句做檢索,追問(例如「那它的缺點呢?」)檢索品質會差。代價:每次多一次 Gemini 呼叫(現有密碼節流可涵蓋)。
5. **SQL 遷移追蹤**:Archon `migration/0.1.0/008_add_migration_tracking.sql` + `migration_service.py`(記錄 version / name / applied_at / checksum 的表 + 冪等腳本)。對應 README 多次出現的「新增的 SQL 要到 SQL Editor 手動執行、不隨部署套用」痛點。輕量版:編號的冪等 SQL 檔 + 一張紀錄表即可,不需仿 Archon 做 API。
6. **AI 回答的來源改為預設收合的面板**:LobeHub `FileChunks/index.tsx`(點擊展開,窄螢幕友善)。
7. **MCP server,讓 Claude Code / Desktop 直接查詢知識庫**:Archon `python/src/mcp_server/features/rag/rag_tools.py`(`search_knowledge_base`、`get_available_sources`、讀取全文等工具)。若要做,可考慮由 Edge Function 承載,但須另行查證 Supabase 對 MCP 的官方支援。屬全新功能,Q1 已排除。
8. **提示詞以 XML 標籤分隔資料區塊**(LobeHub `formatSearchResults.ts`):對現行 `=== … ===` 分隔的邊際改善,優先度最低。
