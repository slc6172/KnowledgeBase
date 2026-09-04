# 01 — 搜尋頁串接:hybrid_search_articles RPC

**What to build:** 新增 `Search.gs` 的 `searchArticles(queryText, opts)`——驗證
查詢文字、產生 embedding、呼叫 `hybrid_search_articles` RPC(標籤 AND 篩選、可選
分頁與是否含草稿)、依 RPC 排序結果補查 categories/tags、依原始相關性順序重新排列、
normalize 後回傳。全部重用既有的 `generateEmbedding_`/`supabaseRpc`/
`supabaseSelect`/`normalizeArticleRow_`,不重新實作。

**Blocked by:** None — can start immediately(沿用既有的 `httpFetch_` 接縫,以及
已完成的 Embeddings.gs/SupabaseClient.gs/Articles.gs)

**Status:** done

- [x] `searchArticles(queryText, opts)` 對空字串或未提供的 `queryText`,在任何
      網路呼叫之前就 throw 清楚的錯誤。
- [x] 呼叫既有的 `generateEmbedding_(queryText)` 取得查詢文字的向量。
- [x] 呼叫 `supabaseRpc('hybrid_search_articles', {...})`,payload 帶
      `query_text`、`query_embedding`(純數字陣列,不轉字串、不額外包裝)。
- [x] `tag_ids` 一律送 `opts.tagIds || []`(不論是否指定都送,空陣列讓 RPC 內建
      的「無篩選」判斷自然生效)。
- [x] `match_count`、`only_published` 只有在 `opts` 明確帶值時才加進 payload,
      沒帶時完全不出現在 payload 裡(讓 Postgres 函式自己的預設值生效)。
- [x] RPC 回傳空陣列時,直接回傳 `[]`,不發出任何補查詢。
- [x] RPC 回傳非空時,用回傳的 id 清單組出
      `supabaseSelect('articles', 'id=in.(...)&select=id,title,content_md,status,
      category_id,created_at,updated_at,categories(id,name),
      article_tags(tags(id,name))')` 補查詢(不含 `embedding` 欄位)。
- [x] 最終回傳的文章陣列順序跟 RPC 回傳的原始相關性順序一致,即使補查詢本身
      回傳的順序不同(用一個刻意打亂順序的補查詢回應驗證這條真的有作用)。
- [x] 每筆回傳的文章都跑過既有的 `normalizeArticleRow_`(`tags` 是陣列、沒有
      `article_tags` 欄位)。
- [x] `generateEmbedding_` 或 `supabaseRpc` 失敗時錯誤直接往外傳,沒有任何
      try/catch 降級成關鍵字搜尋。
- [x] 用假的 `httpFetch_`(同時應付 Gemini/RPC/補查詢三種呼叫)寫測試涵蓋以上
      每一條行為。
