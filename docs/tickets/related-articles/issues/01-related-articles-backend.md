# 01 — 相關文章推薦:related_articles RPC + GAS 函式

**What to build:** 新增 Postgres 函式 `related_articles(source_article_id,
match_count)`,用一篇文章自己的 `embedding` 做最近鄰搜尋找出最相關的其他已發布
文章;以及 GAS 端 `getRelatedArticles(articleId)`,呼叫這個 RPC、補齊
categories/tags、依相關性順序回傳。全部重用既有的 `supabaseRpc`/
`supabaseSelect`/`normalizeArticleRow_`,不呼叫 Gemini。

**Blocked by:** None — 沿用既有的 `httpFetch_` 接縫與 `hybrid_search_articles`
已經確立的 RPC/pgvector 呼叫模式(`search/01`)。

**Status:** ready-for-agent

- [ ] `related_articles` SQL 函式:給定 `source_article_id`,先查出該文章的
      `embedding`;查無此文章或 `embedding is null` 時回傳空集合,不報錯。
- [ ] 只比對 `status = 'published'` 且 `id <> source_article_id` 的文章,用
      cosine distance(`<=>`)排序。
- [ ] 沿用 `hybrid_search_articles` 既有的 `max_semantic_distance`(0.6)當篩選
      門檻,超過門檻的文章不回傳;不足 `match_count` 篇時就回傳現有篩到的幾篇,
      不湊數。
- [ ] `getRelatedArticles(articleId)` 呼叫 RPC 時帶 `source_article_id`、
      `match_count: 3`。
- [ ] RPC 回傳空陣列時,`getRelatedArticles` 直接回傳 `[]`,不發出補查詢的
      網路呼叫。
- [ ] RPC 回傳非空時,用回傳的 id 清單做補查詢補上
      `categories(id,name)`/`article_tags(tags(id,name))`,補查詢結果依 RPC 的
      原始(相關性)順序重新排列後回傳(用一個刻意打亂順序的假回應驗證重排序
      邏輯真的有作用)。
- [ ] 回傳的每筆文章都跑過 `normalizeArticleRow_`(`tags` 是陣列、沒有
      `article_tags` 欄位)。
- [ ] 這是讀取類函式,不經過 `Auth.gs`/`callProtected`,任何人都能呼叫——不在
      白名單裡新增任何項目。
- [ ] 用假的 `httpFetch_` 寫測試涵蓋以上情境,比照 `test/Search.test.js` 的既有
      模式。
