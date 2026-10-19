# 09 — 文件、最終 schema 與上線清單

**Type:** AFK

**Blocked by:** 02, 07, 08

**Status:** done

**對應 User Story:** 16、19(見 `docs/specs/spec_chunked_embeddings.md`)

**What to build:** 讓所有文件與 `docs/schema.sql` 反映最終狀態:`DESIGN.md`(原決策「整篇一個向量、不切 chunk」被取代,資料流與架構圖同步)、README(快速開始、變更紀錄、重建工具用法)、`CLAUDE.md`(SQL 整合測試接縫、`tools/` 資料夾、`extensions` schema)。提供**線上資料庫的 migration 腳本**與逐步上線清單(套用 migration → 部署代理 → `clasp push` 並發新版 → 上傳工具 → 試跑 → 正式 → 刪檔),migration 先在真實 PostgreSQL 上驗證。

**接縫:** SQL 整合測試與 `pg_dump` 比對;靜態文字掃描。

- [x] 以「舊 schema(線上現狀)+ migration」得到的結構,與全新載入 `schema.sql` 的 `pg_dump --schema-only` 逐條相同
- [x] migration 對含資料的舊資料庫可套用(測試文章與標籤保留,舊向量被丟棄),且可在交易內執行
- [x] 上線清單涵蓋 spec 〈上線〉全部步驟,並標明停機窗口
- [x] DESIGN.md、README 現行章節、CLAUDE.md 與實作一致;靜態測試守住(無舊決策殘留、有新接縫說明)
- [x] README 變更紀錄新增條目,版本號更新
- [x] mycr 報告進度更新(F-02、F-03 標記為已修)

> **實作註記:** (1) migration 由腳本從 `schema.sql` **逐字抽出**組裝(不是手抄),所以兩邊不會漂移;`MigrationEquivalence.test.js` 用目錄查詢(欄位、索引、約束、函式定義、觸發器、RLS、擴充功能位置)比對「舊 schema + migration」與「全新載入 schema.sql」,而不是靠 `pg_dump`(CI 的 runner 不一定有符合版本的 client)。並以含資料的舊資料庫驗證:分類、標籤、文章、關聯、資料夾、附件全部保留,舊向量被丟棄,所有已發布文章出現在待重建清單,草稿不會。
> (2) migration 的破壞驗證:少搬 `vector`、少搬 `pg_trgm`、沒丟 `articles.embedding`、段落表沒開 RLS、沒丟舊的 `hybrid_search_articles`、`touch_updated_at` 沒補 `search_path`、少了 `merge_tags`、偷偷刪資料——全部變紅。(中途有一次『少搬 pg_trgm』顯示沒被抓到,查出是我的 `sed` 沒匹配到那一行〔該行只有一個空格〕,修正後確認會變紅。)
> (3) 失敗時整份回滾也有測試:在 `commit` 之前注入錯誤,rollback 後仍是舊結構。(4) **預先對線上做了唯讀的結構核對**,結果寫在上線清單第 1 步。(5) 文件守門測試新增 16 個(DESIGN 決策被取代、README 說明新接縫、CLAUDE.md 慣例、上線清單順序與內容),全部做過破壞驗證。
> (6) 順手修正一個潛在假綠:`EdgeFunctionProxyDocs` 引用的章節標題改名後,原本因為 `indexOf` 回傳 -1 而『碰巧』沒報錯。
