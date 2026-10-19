# 上線清單:分段向量與原子寫入

> **狀態(2026-10-08):已上線。** 步驟 0 到 5 完成(結果見 `docs/tickets/chunked-embeddings/issues/10-rollout-and-measure.md`);步驟 6 的收尾項目中,等價性測試已移除,其餘(移除重建工具與 F03 測試文章、實際操作一輪寫入)待擁有者確認。

> 這份清單只服務擁有者**那一個已經建好的線上資料庫**。本專案的目標是「從無到有佈建」:新專案只需要執行一次
> `docs/schema.sql`,不需要這裡的任何東西(README「快速開始」)。這份清單與同資料夾的 `migration.sql` 是**一次性**的,
> 上線完成後留作歷史紀錄。

## 先看這個:會有一段短暫停機

資料庫(丟掉 `articles.embedding`、換搜尋函式的簽名)和 GAS 程式**必須一起換**,中間沒有相容層(刻意的,見 spec 的決策)。
從「套用 migration」到「新版 Web App 上線」之間(幾分鐘),**舊版網站的發布、編輯、搜尋、相關文章會報錯**。
線上目前只有測試資料、只有擁有者使用,接受這個窗口。

**之後還有第二段「語意搜尋找不到東西」的期間**:migration 會丟掉舊的整篇向量,所有已發布文章要等重建工具跑完才有段落向量。
這段期間**關鍵字搜尋照常運作**(語意那一路是空的),相關文章區塊是空的,AI 問答可能回「找不到相關文章」。

## 失敗時怎麼辦

- **migration 本身**:整份在單一交易內,任何一步失敗整份回滾,資料庫維持原狀(有測試證明)。看錯誤訊息、修正後重試即可。
- **migration 成功、但新版程式有問題**:資料已經是新結構,舊版程式無法再用。往前修(forward-fix);線上只有測試資料,最壞情況是
  用 `docs/schema.sql` 重建一個新的 Supabase 專案(README「快速開始」)。
- **重建工具中途停下**:正常現象(時間預算、429、單篇失敗),`REINDEX_ENABLED` 會保留,再執行一次即可接續。

## 步驟

### 0. 事前(擁有者,約 5 分鐘,不影響線上)

> **第 1 項已於 2026-10-03 完成**:順序一致、40 / 41 筆都能放進同一個批次請求(`EMBEDDING_BATCH_MAX_ = 40` 不需要調整);100 筆的 429 是免費層每分鐘 100 個請求的額度,不是筆數上限。
> 線上已發布約 45 段,重建一次執行就能完成。擁有者的 `REINDEX_ENABLED` 與驗證檔案是否已刪除,請在上線前再確認一次。

1. 執行 `tools/VerifyBatchEmbedding.gs` 的 `verifyBatchEmbedding`(流程見檔案頂端說明),把以「[驗證]」開頭的日誌貼回。
   這支驗證工具是**獨立**的:它只依賴專案裡本來就有的 `getConfig_` 與 `httpFetch_`,所以可以在新版程式還沒上線之前直接貼進現有專案執行
   (第一版曾因為呼叫了新版才有的函式,在還沒上線的專案裡出現 `ReferenceError`,已修正)。
   相對地,第 4 步的 `Reindex.gs` 依賴新版程式,**必須在第 3 步「上線新版 GAS」完成之後**才能上傳。
   若「最大成功筆數」小於 40,先把 `src/Embeddings.gs` 的 `EMBEDDING_BATCH_MAX_` 下修再繼續。**驗完刪除該 Property 與檔案。**
2. 決定一個你不會使用網站的時段(幾分鐘即可)。

### 1. 套用 migration(Claude 以 Supabase 連接器執行)

1. 先**唯讀**核對線上結構與 `schema-before.sql` 相同(欄位、索引、約束、函式)——migration 的前提是線上資料庫等於升級前的 schema。
   **已於 2026-10-03 預先核對過一次**(同一支 SQL 在本機以 `schema-before.sql` 建立的資料庫與線上各算一組指紋):欄位、索引、約束、
   函式簽名、RLS、擴充功能位置、專案的觸發器全部相同;四個函式的本體去掉 `\r` 後 md5 逐一相同——**唯一差異是線上的函式本體是 CRLF
   換行**(貼進 SQL Editor 時帶入),這四個函式在 migration 裡都會被丟棄或取代,所以無影響。(第一次比對時 `triggers` 那項不同,
   是因為我的查詢沒有限定 schema、把 Supabase 自己的 `storage` / `realtime` 觸發器也算進去了,不是專案的漂移。)
   套用前仍要再核對一次,因為這中間線上可能被改動。
2. 套用 `migration.sql`(整份單一交易;透過連接器套用時省略首尾的 `begin;` / `commit;`,由連接器的交易包住,效果相同)。
3. 讀回驗證:`article_chunks` 存在、`articles.embedding` 不存在、`vector` / `pg_trgm` 在 `extensions`、七張表 RLS 開啟、
   `merge_tags` / `save_article` / `articles_needing_reindex` 存在、舊的 `hybrid_search_articles` 沒有並存的舊簽名;
   安全顧問不再有 `search_path` 與「擴充功能在 public」的警告。

### 2. 部署 Edge Function 代理(Claude 以連接器執行)

部署 Edge Function:`supabase/functions/kb-proxy/` 的 `handler.ts` 與 `index.ts`(`verify_jwt` 維持 `false`),
然後讀回線上版本,與專案檔案逐行 diff 確認一致。這次的變更累積了:`merge_tags`、`save_article`、`articles_needing_reindex` 三個 RPC
進白名單(第 1 步之後才有意義)。

### 3. 上線新版 GAS(擁有者)

1. `clasp push`(只會推 `src/`,不會推 `tools/`)。
2. 在 Apps Script 發**新版本**的 Web App,並確認網址指到新版本(歷史上發生過沒指到新版的狀況)。
3. 開網站:應該可以開啟、列出文章、關鍵字搜尋有結果;語意搜尋與相關文章暫時是空的(正常)。**停機窗口到此結束。**

### 4. 重建段落向量(擁有者)

1. 上傳 `tools/Reindex.gs`;在「指令碼屬性」新增 `REINDEX_ENABLED = true`。
2. 執行 `reindexDryRun`,貼回日誌:待重建文章數、段數、預估 Gemini 請求數、超過 40 段的文章。
3. 執行 `reindexAllArticles`;時間不夠會自動停下,再執行一次接續。完成時日誌會說明,`REINDEX_ENABLED` 會自動消失。
4. 刪除工具檔 `Reindex.gs`(**不要**留在專案裡:入口函式沒有底線)。

### 5. 驗證與量測(Claude + 擁有者)

1. Claude 以連接器確認 `articles_needing_reindex` 回傳空集合、每篇已發布文章都有段落、`embedding_model` 一致。
2. 擁有者:用 F03 長文的**後半段**內容搜尋,應該找得到(整篇向量時代做不到);發布一篇超過 40 段的草稿 → 發布,應收到明確訊息。
3. Claude 用真實段落向量量測距離分布(例如 F03 烹飪/天文各段彼此的距離),評估 0.4 / 0.6 兩個門檻是否需要調整;需要調整另開票。

### 6. 收尾

1. 刪除 4 篇 F03 測試文章。
2. 移除一次性的 migration 等價性測試 `test/sql/MigrationEquivalence.test.js`:它比對「舊 schema + migration」與**現行** `docs/schema.sql`,
   schema 繼續演進後就不再成立(`migration.sql` 與 `schema-before.sql` 留在這個資料夾當歷史紀錄)。
3. 更新 README 變更紀錄(上線日期與量測結果),版本號。
