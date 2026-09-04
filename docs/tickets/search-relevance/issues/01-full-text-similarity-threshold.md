# 01 — 關鍵字比對可調門檻 + 無夠格結果回傳空陣列

**What to build:** `hybrid_search_articles` 新增 `min_full_text_similarity`
參數(對稱於既有 `max_semantic_distance`),關鍵字比對從 `%` 運算子(吃
session 層級的 `pg_trgm.similarity_threshold`)換成明確的 `similarity(...) >=
min_full_text_similarity` 寫法;`Search.gs` 開放 `opts.minFullTextSimilarity`
傳遞。兩邊候選名單都是真門檻篩過後,搜尋沒有夠格結果時自然回傳空陣列,不需要
額外程式碼。

**Blocked by:** 無,可立即開始

**Status:** ready-for-agent

- [ ] `docs/schema.sql` 的 `hybrid_search_articles` 函式簽名新增
      `min_full_text_similarity float default 0.3`(接在既有參數列表最後,
      預設值對齊 Postgres 原生的 `pg_trgm.similarity_threshold` 預設值,
      行為不會無感跑掉)。
- [ ] `full_text` CTE 的 `where` 子句從 `(a.title || ' ' || a.content_md) %
      query_text` 改成 `similarity(a.title || ' ' || a.content_md,
      query_text) >= min_full_text_similarity`——**不使用** `set_limit()`
      (session 層級狀態,PostgREST 連線池環境下可能漏到不相關的查詢)。
- [ ] `semantic` CTE(`max_semantic_distance` 那段)維持原樣,不修改。
- [ ] `Search.gs` 的 `searchArticles`:`opts.minFullTextSimilarity !==
      undefined` 時,`rpcArgs.min_full_text_similarity =
      opts.minFullTextSimilarity`——跟既有 `maxSemanticDistance` 的傳遞方式
      並列、同一種寫法。
- [ ] 用假的 `httpFetch_` 寫測試(擴充 `test/Search.test.js`):
      1. `opts.minFullTextSimilarity` 有提供時,`rpcArgs` 正確帶上這個值。
      2. 未提供時,`rpcArgs` 完全不含這個欄位(讓 SQL 函式吃自己的預設值)。
      3. 既有的 `searchArticles` 測試(空查詢文字丟錯、正常查詢完整流程)
         這次改動後維持通過。
- [ ] 部署後,手動用 Supabase SQL Editor 呼叫 `hybrid_search_articles` 帶不同
      `min_full_text_similarity` 數值,找到你覺得「不會混進明顯不相關文章」
      的門檻,再決定要不要調整函式簽名的預設值或讓 `Search.gs` 固定傳這個值。
