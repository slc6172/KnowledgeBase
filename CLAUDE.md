# CLAUDE.md

GAS + Supabase 個人/團隊知識庫(文章、附件、Hybrid Search、Gemini RAG 問答)。
Apps Script 後端 + 前端(HtmlService),資料在 Supabase(Postgres + pgvector + Storage)。
GAS **不直連** Supabase:所有請求經 Edge Function 代理 `kb-proxy`(`supabase/functions/kb-proxy/`),
GAS 只持有共用密鑰 `EDGE_PROXY_SECRET`,Supabase 的 secret key 只存在 Supabase 內部。
細節看 `README.md`(架構、快速開始、已知問題修復紀錄)與 `docs/DESIGN.md`(決策表)。

**專案目標是「從無到有佈建」,不以「從舊版升級」為設計前提。** `docs/schema.sql`、README 快速開始、DESIGN.md 都只描述最終狀態:
不要在它們裡面寫遷移步驟、`alter` / `drop` 補丁、「原本是…後來改成…」的敘事。歷史留在 README 的「已知問題修復紀錄」。

## 指令

```bash
npm install
npm test          # Jest 30 + Babel 8,不需要網路、不連 Supabase / Gemini
```

代理的測試是獨立的 Deno 測試:`deno test supabase/functions/kb-proxy/`(CI 也會跑;`npm test` 不會涵蓋它)。
代理核心與測試**只能用 Deno 內建與 `node:*` 模組**,不要用 `jsr:` / 遠端 URL 匯入(沙箱與供應鏈限制)。

Node 需 `^22.18.0 || >=24.11.0`(`package.json` engines、CI、`test/CiNodeVersion.test.js` 三處對齊)。
沒有 lint / build 步驟。部署用 clasp(`.clasp.json` 不進版控,範本是 `.clasp.json.example`,`rootDir` 為 `./src`)。

## 目錄

- `src/*.gs`:後端;`src/*.html`:前端(Index / JavaScript / Stylesheet + 各 View)
- `test/`:Jest 測試;`test/helpers/loadGas.js`、`test/helpers/testSetup.js` 是共用輔助;`test/sql/`:SQL 整合測試(對真實 PostgreSQL,見下方接縫)
- `tools/`:**一次性工具檔,不在 `src/`**(clasp 的 `rootDir` 是 `./src`,一般推送不會帶上它)。需要時手動上傳到 Apps Script 專案、用完即刪:`Reindex.gs`(重建段落向量)、`VerifyBatchEmbedding.gs`(實測 Gemini 批次嵌入)。入口函式**刻意不加底線**(底線函式在編輯器裡無法手動執行),所以每個入口都必須有 `REINDEX_ENABLED` 開關、不回傳資料;`test/ToolsFolder.test.js` 守住這些規則。
- `supabase/`:Edge Function 代理(`config.toml`、`functions/kb-proxy/`);
- `docs/schema.sql`:資料庫 schema 與 RPC;`docs/DESIGN.md`:決策表
- `docs/specs/spec_*.md`:spec;`docs/tickets/<功能>/issues/NN-*.md`:票
- `.github/`:CI(`workflows/test.yml`,action 以 commit SHA 固定)與 `dependabot.yml`
- `.mycr/reports/`:`/mycr` 程式碼審查報告

## 測試接縫(最重要)

- **`httpFetch_`(`HttpTransport.gs`)是全專案唯一呼叫 `UrlFetchApp` 的地方。**(GAS 端所有 Supabase 請求的網址都經 `proxyUrl_` 組成,送往代理。) 測試把它換成假實作,自己決定回應;業務邏輯測試都靠這個接縫,不碰真實網路。不要在別處直接呼叫 `UrlFetchApp`。
- `.gs` 檔案以 `if (typeof module !== 'undefined') module.exports = {...}` 匯出給 Jest;`loadGas` 把匯出的函式掛到 `global`,模擬 Apps Script 共用全域命名空間。新檔案要照這個模式。
- 設定用 `testSetup.js` 的 `fakeConfig*` 系列輔助假造 `PropertiesService`。
- `fakeCacheService()` 回傳控制器:`advanceSeconds(n)`(虛擬時鐘,測 TTL)、`failGets` / `failPuts`(故障注入)、`puts`(每次寫入的鍵、值、存活秒數)、`valueOf(key)`;值超過 100 KB 時 `put` 會丟例外(比照真實服務)。沒有用到這些的測試行為完全不變。`fakeUtilities()` 提供 `computeDigest`(SHA-256,回傳有號位元組,比照真實 API)。
- **SQL 整合測試(`test/sql/*.test.js`)**:對真實 PostgreSQL 16 + pgvector 執行專案的 `docs/schema.sql`,涵蓋放在資料庫裡的行為(搜尋排序、最近段落、`save_article` 原子性、`merge_tags`、RLS、擴充功能位置、`search_path`)。設定環境變數 `TEST_DATABASE_URL` 才會執行,**沒設定時整批自動 skipped**,本機 `npm test` 不需要資料庫;CI 以 `pgvector/pgvector:pg16` 服務容器真的執行。每個測試檔用 `test/sql/helpers.js` 建立自己的臨時資料庫(模擬 Supabase 的三個預設角色與預設授權,匿名角色的行為才測得出來),載入失敗時一定會清理;向量用手工構造的軸向量,**不呼叫 Gemini**。新的資料庫行為優先用這個接縫測;改壞實作確認測試會變紅(`KB_SCHEMA_FILE` 可指定一份被改壞的 schema 當對照)。沙箱裡每次執行前先 `service postgresql start`(它會被停掉)。
- 測試只驗證外部可觀察行為(送出的請求、回傳值、拋出的錯誤),不測內部實作。
- 前端的 `google.script.run` 沒有替換接縫,所以沒有「整頁」的端對端測試,但有兩類測試:**函式抽取 + jsdom 執行**(用 `extractFunction` 從 `JavaScript.html` 抓出函式原始碼,餵最小假依賴,在 jsdom 內真的執行並驗證 DOM 結果,例如 `AiSourcesPanel.test.js`、`SearchDegradedNotice.test.js`、`AttachmentUrlRender.test.js`);以及**靜態文字掃描**(讀 `src/*.html` 原始碼比對關鍵 class / 屬性 / CSS,例如 `NavDrawer.test.js`)。新的前端行為優先用前者;兩者不能互相取代。「畫面看起來對不對」仍要實際部署後手動確認。
- 新增 CDN 資源要過 `CdnAssetIntegrity.test.js`(SRI);CI 的 action 一律以 commit SHA 固定(`CiWorkflowHardening.test.js`)。
- `marked`、`dompurify` 的 `package.json` 版本必須與 `Index.html` 的 CDN 版本完全一致(`BrowserLibraryVersionSync.test.js`),且 dependabot 刻意不自動更新它們。升級要手動四處同步:`Index.html` 版本號 + SRI hash、`package.json`、`package-lock.json`。SRI hash 可由 npm 套件內的 `dist/` 檔案以 sha384 算出(jsdelivr 提供的就是同一個檔案)。

## GAS 程式慣例

- **沒有底線字首的頂層函式會自動變成 `google.script.run` 公開端點。** 私有函式一律加尾底線(`foo_`)。`test/PrivateFunctionExposure.test.js` 窮舉掃描 `src/`,只有 `PUBLIC_ALLOWLIST` 內的才允許不帶底線;新增公開函式前先想清楚它該套用哪種防護(公開讀取走 `checkPublicReadRateLimit_`、寫入走 `callProtected` 的 switch 白名單、AI 走密碼驗證),不要只為了讓測試通過就加進清單。
- 錯誤:業務函式包在 `withSafeErrors_`;上游錯誤用 `markUpstreamError_` 並標分類(`UPSTREAM_ERROR_CATEGORY_DATA_` / `_AI_`)。給使用者的訊息要安全,細節進日誌。
- `google.script.run` 回傳值必須是可 JSON 序列化的純資料(附加在陣列上的屬性會被丟掉,要傳額外資訊就回傳物件,例如 `searchArticles` 回傳 `{ articles, degraded }`)。
- 公開搜尋允許降級(Gemini 產生向量失敗 → 關鍵字結果);內部函式 `searchArticlesInternal_(query, opts, allowDegrade)` 的 `allowDegrade=false` 給 RAG 用,新增檢索呼叫者時要明確決定用哪一種。
- **內部開關絕不能從公開函式的 `opts` 讀取。** `searchArticles` 等公開函式的 `opts` 完全由(匿名)呼叫端控制;只有伺服器內部程式碼才能決定的行為(例如跳過公開讀取額度的 `skipPublicReadRateLimit`)必須是內部函式的**獨立參數**(`searchArticlesInternal_` 的第四個參數),公開函式永遠不傳。新增這類開關時,要寫測試:匿名呼叫端在 `opts` 夾帶同名與類似的鍵,都不能有任何效果。
- **AI 問答只送節錄,不送文章全文**(`RagChat.gs`:最多 8 篇、每篇最多 1,500 字,上限常數 `RAG_MATCH_COUNT_` / `RAG_EXCERPT_MAX_CHARS_`)。命中段落由 `searchArticlesInternal_` 以 `matchedChunk` 往上傳,公開的 `searchArticles` 一律剝除。查詢向量有 60 秒的 `CacheService` 快取(`Search.gs`,鍵為含模型識別字串的雜湊),快取只是最佳化:讀寫例外一律吞掉;語意搜尋節流只在快取未命中時計數。前端因此必須「文章列表請求完成後才發 AI 請求」。
- 所有 markdown 渲染一律經 `renderMarkdownSafe_` + DOMPurify(有 AI 專用的較嚴設定)。不要直接把未消毒內容指定給 `innerHTML`。
- **文章寫入(建立 / 更新 / 發布 / 取消發布)一律經 `saveArticleRpc_`,也就是一個 `save_article` RPC**:文章欄位、狀態、全部段落、標籤在資料庫單一交易內一起寫。不要在 GAS 端把它拆回多個請求(會留下半成品)。順序規則:Gemini 在任何寫入之前呼叫,新標籤在 Gemini 成功之後才建立;只改標籤 / 分類時不帶 `p_fields`(不動 `updated_at`)。切段規則在 `Chunking.gs`(每段約 1,500 字、上限 40 段、超過在呼叫 Gemini 之前就拒絕);嵌入模型與維度的單一定義在 `Embeddings.gs`(`EMBEDDING_MODEL_NAME_` / `EMBEDDING_DIMENSIONS_`)。
- 註解用繁體中文,寫「為什麼」(踩過的坑、被排除的替代方案),不只寫「做什麼」。
- 縮排 2 空格、LF、檔尾換行(`.editorconfig`)。
- **`src/` 一律用 ES5 風格的 `var`,這是刻意的慣例,不要遷移成 `let` / `const`。** 整個專案(後端 `.gs` 與前端 `JavaScript.html`)統一用 `var` + `function`,沒有任何 `let` / `const`;Apps Script 的 V8 執行環境其實支援 ES6,但混用兩種風格比維持單一風格更糟,而且全面遷移的風險(提升行為、迴圈閉包語意改變)大於收益。專案沒有 linter 強制這件事,靠這條說明與 code review 維持。測試檔(`test/`)不受此限。

## 資料庫

- **新增資料表或 RPC 時,必須同步更新代理白名單**(`supabase/functions/kb-proxy/handler.ts` 的 `ALLOWED_TABLES` / `ALLOWED_RPCS`),並重新部署 Edge Function;`test/EdgeFunctionProxyConfig.test.js` 會比對 schema 檔與 GAS 呼叫點,忘了更新會直接報錯。
- `docs/schema.sql` 永遠是**最終狀態**,以全新的 Supabase 專案為前提(貼進 SQL Editor 一次執行);不寫升級腳本。改 schema 就直接改成新的最終形狀,並更新 `docs/DESIGN.md`。
- **擴充功能放 `extensions` schema,型別與運算子類別一律寫全限定名稱**(`extensions.vector(768)`、`extensions.gin_trgm_ops`);**每個函式都要 `set search_path = public, extensions`**(沒有它,SQL 函式在建立時就無法解析 `<=>`;`SchemaHygiene` 與 `SchemaGreenfield` 兩層測試守住)。新資料表一律開 RLS、不建 policy。
- **`article_chunks` 刻意不在代理的資料表白名單**:所有讀寫都經 RPC(`save_article`、`articles_needing_reindex`)。`EdgeFunctionProxyConfig.test.js` 的 `INTENTIONALLY_PRIVATE_TABLES` 明列這類資料表——新增資料表時要明確決定「開放給 GAS」(加進 `ALLOWED_TABLES`)或「刻意不開放」(加進這個清單),忘了決定測試會紅。
- 已經建好的資料庫(例如擁有者自己線上那個)不會隨部署自動套用 schema 變更,要另外手動套用。**改 RPC 函式簽名時,套用到既有資料庫必須明確 `drop function` 舊簽名**:新舊並存會讓 PostgREST 無法判斷該呼叫哪個,`searchArticles` 會收到非陣列回傳(程式裡有對應的錯誤訊息)。
- 驗證 SQL 行為時,用真實 PostgreSQL 16 + pgvector 跑 `docs/schema.sql`,不要只憑推測(沙箱裡 `apt-get install postgresql postgresql-16-pgvector` 可用)。重整 schema 後,可用 `pg_dump --schema-only` 對新舊版本做結構比對(忽略 `\restrict` 隨機標記)。

## 開發流程

`/grilling`(與擁有者對齊)→ `/to-spec`(`docs/specs/spec_*.md`,含 front matter:title / status / date / project / depends_on)→ `/to-tickets`(`docs/tickets/<功能>/issues/`)→ `/tdd`(紅綠循環實作)。

- 實作完成後在 `README.md` 的「已知問題修復紀錄」新增編號條目,並視情況調整版本號。**不要在文件裡寫測試總數**(寫死的數字會過期,直接跑 `npm test`)。
- 決策有取捨時,同步更新 `docs/DESIGN.md` 決策表。
- 快速變動的外部 API(Supabase 金鑰與 Edge Functions、Gemini 模型名稱)實作前,用已連接的 Context7 或官方文件再核對一次,並在註解標註查證日期。
