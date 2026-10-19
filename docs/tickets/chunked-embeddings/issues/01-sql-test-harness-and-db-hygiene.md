# 01 — SQL 整合測試接縫與資料庫整理

**Type:** AFK

**Blocked by:** None — can start immediately

**Status:** done

**對應 User Story:** 17、18、19(見 `docs/specs/spec_chunked_embeddings.md`)

**What to build:** 建立「對真實 PostgreSQL(含 pgvector)執行 `docs/schema.sql`」的 Jest 整合測試接縫:設了 `TEST_DATABASE_URL` 才跑,沒設自動跳過(本機 `npm test` 不需要資料庫);CI 以 `pgvector/pgvector:pg16` 服務容器真的跑。同時整理資料庫:`vector`、`pg_trgm` 建在 `extensions` schema(型別與運算子類別用全限定名稱),現有四個函式(`touch_updated_at`、`hybrid_search_articles`、`related_articles`、`articles_by_tags`)全部固定 `search_path = public, extensions`。行為不變,只是位置與設定。

**接縫:** 新增的 SQL 整合測試(真實 PostgreSQL);靜態文字掃描(`SchemaGreenfield`)依新的最終狀態更新。

- [x] 新增開發相依 `pg`(精確版本),`npm audit` 為 0
- [x] 測試輔助:每個測試檔載入前重建乾淨資料庫(含 Supabase 風格的 `anon` / `authenticated` / `service_role` 角色與預設授權),再執行 `docs/schema.sql`
- [x] 未設定 `TEST_DATABASE_URL` 時整批 SQL 測試被跳過(顯示為 skipped,不是失敗)
- [x] `schema.sql` 在全新資料庫載入成功;`vector`、`pg_trgm` 位於 `extensions`,`public` 沒有它們的物件
- [x] 四個函式的設定都含 `search_path=public, extensions`
- [x] 六張資料表都開啟 RLS;匿名角色讀不到任何資料表
- [x] 搜尋、相關文章、標籤篩選三個函式搬家後行為與搬家前相同(以固定資料集比對結果)
- [x] CI workflow 有 pgvector 服務容器與 `TEST_DATABASE_URL`;既有的 CI 加固測試仍通過(action 仍以 SHA 固定;容器映像以版本標籤固定並註記)
- [x] `SchemaGreenfield` 的靜態斷言改為新的最終狀態

> **實作註記:** (1) 每個測試檔建立自己的臨時資料庫(Jest 平行執行),載入失敗時一定清掉連線與資料庫——第一版沒做這件事,被刻意改壞的 schema 讓 Jest 掛住 300 秒,才補上。
> (2) `KB_SCHEMA_FILE` 環境變數可指定另一份 schema 當對照組:先用搬家前的 schema 跑 `RetrievalBaseline`,七個全綠,確認我對舊行為的推演正確,再要求新 schema 一樣。
> (3) 沒有 `search_path` 的 SQL 函式在**建立時**就無法解析 `<=>`(整份 schema 載入失敗),等於 PostgreSQL 自己強制了這條規則。
> (4) **CI 映像未以 digest 固定**:沙箱連不到容器登錄庫,無法解析 `pgvector/pgvector:pg16` 的 digest。目前以 `pg16` 標籤固定並在 workflow 註明;擁有者在第一次 CI 成功後,可把它改成 digest(`docker buildx imagetools inspect` 或 GitHub 的 Packages 頁)。**CI 容器第一次在 GitHub 上跑還沒驗證過**,與 Deno 那一步的狀況相同。
> (5) 破壞驗證:一個函式沒固定 `search_path`、擴充裝回 `public`、一張表沒開 RLS、語意門檻被改——四種都變紅。
