---
title: 搜尋頁串接(hybrid_search_articles RPC)
status: ready-for-agent
date: 2026-08-15
project: GAS + Supabase 個人知識庫
depends_on: schema.sql(hybrid_search_articles 函式)、DESIGN.md(決策 #11)、spec_gas_backend.md(已完成)
---

# 搜尋頁串接:hybrid_search_articles RPC — Spec

## Problem Statement

`schema.sql` 裡已經定義好 `hybrid_search_articles`(pg_trgm 關鍵字 + pgvector 語意,
RRF 融合排序,標籤 AND 篩選),但 GAS 端還沒有任何函式會呼叫它。這個 RPC 函式
`returns setof articles`——只回傳 `articles` 表的原始欄位,不含 `categories`/
`article_tags` 的 join 資料(PostgREST 對 RPC 呼叫不會像一般 table/view 查詢那樣
自動套用巢狀 embed 語法)。所以 GAS 端除了呼叫 RPC,還要另外做一次補查詢把
分類/標籤資料補齊,並且維持 RPC 算出來的相關性排序(補查詢用 `id=in.(...)`
不保證回傳順序)。

本次額外查證了 PostgREST 官方文件與一則 pgvector 相關的討論串,確認 `vector`
型別的 RPC 參數就是傳一般的 JSON 數字陣列(例如 `{"embedding": [1,2,3]}`),
不需要额外包裝或轉字串——這是原本比較沒把握的一點,查證後可以確定。

## Solution

新增 `Search.gs`,提供單一函式 `searchArticles(queryText, opts)`:

1. 驗證 `queryText` 非空(空字串直接丟出清楚錯誤——「輸入文字才能搜尋」這條路線,
   不含文字的純標籤瀏覽不在本 spec 範圍,見 Out of Scope)。
2. 呼叫既有的 `generateEmbedding_(queryText)`(沿用 ticket 03 已完成的 Embeddings.gs)
   算出 query 的向量。
3. 呼叫既有的 `supabaseRpc('hybrid_search_articles', {...})`,帶入 query 文字、
   向量、以及可選的標籤篩選/分頁/是否只搜已發布文章。
4. 用 RPC 回傳的文章 id 順序(即相關性排序)做一次
   `supabaseSelect('articles', 'id=in.(...)&select=...')` 補上 `categories`/
   `article_tags`,並依照 RPC 的原始順序重新排列補查詢的結果。
5. 用既有的 `normalizeArticleRow_`(沿用 ticket 02 已完成的 Articles.gs)攤平
   `article_tags` → `tags`,回傳陣列。

## User Stories

1. As a knowledge-base user, I want `searchArticles(queryText, opts)` to reject an
   empty or missing `queryText` with a clear error before making any network call, so
   I get immediate feedback instead of a confusing downstream failure.
2. As a knowledge-base user, I want my search text turned into an embedding via the
   existing `generateEmbedding_`, so semantic matching uses the same model/config as
   the rest of the app.
3. As a knowledge-base user, I want the embedding and my search text sent to
   `hybrid_search_articles` via `supabaseRpc`, so results are ranked by the RRF fusion
   of keyword + semantic relevance already implemented in the database function.
4. As a knowledge-base user, I want to optionally filter by a list of tag IDs, so
   results narrow to articles matching all of the selected tags (the RPC's own AND
   semantics), without having to filter results myself afterward.
5. As a knowledge-base user, I want to optionally cap the number of results and choose
   whether drafts are included, so the search adapts to different contexts (browsing
   vs an admin view that also wants to find drafts).
6. As a knowledge-base user, I want the returned articles to include their category
   and tags (not just the bare `articles` row), so the results list can display the
   same rich information as the article list/detail views.
7. As a knowledge-base user, I want the returned articles to stay in the RPC's
   relevance order after the category/tag enrichment step, so the most relevant result
   is still first even though the enrichment query itself doesn't guarantee ordering.
8. As a knowledge-base user, I want a query with zero matches to return an empty array
   without an unnecessary or malformed follow-up query, rather than erroring.
9. As a developer, I want the whole flow (embedding → RPC → enrich → reorder →
   normalize) tested against a mocked `httpFetch_`, consistent with the rest of the
   project, so this works before a live Supabase project exists.
10. As a developer, I want a failed embedding generation to propagate as a thrown
    error (no silent fallback to keyword-only search), consistent with how the rest of
    the project treats Gemini failures (e.g. the publish flow in ticket 03).

## Implementation Decisions

**檔案結構**:新增 `Search.gs`,單一函式 `searchArticles(queryText, opts)`
(`opts`: `{ tagIds, matchCount, onlyPublished }`,皆為選填)。重用既有的
`generateEmbedding_`(Embeddings.gs)、`supabaseRpc`/`supabaseSelect`
(SupabaseClient.gs)、`normalizeArticleRow_`(Articles.gs)——不重新實作。

**RPC 呼叫參數組裝**
- `query_text`、`query_embedding`(`generateEmbedding_` 回傳的純數字陣列,直接
  當 JSON 陣列傳給 RPC——查證後確認 PostgREST 對 `vector` 型別參數就是接受一般
  JSON 數字陣列,不需要轉字串或特殊包裝)一定會送。
- `tag_ids` 一律送 `opts.tagIds || []`(不論有沒有指定都送,空陣列讓 RPC 內建的
  `array_length(tag_ids,1) is null` 判斷自然生效,不需要在 GAS 端另外判斷要不要
  帶這個參數)。
- `match_count`、`only_published` 只有在 `opts` 有明確帶值時才加進 payload,
  沒帶就完全省略該 key——讓 Postgres 函式自己的預設值(`match_count` 20、
  `only_published` true)生效,不在 GAS 端重複寫一次預設值。

**結果補查詢與排序**
- RPC 回傳空陣列時直接回傳 `[]`,不做補查詢(避免組出空的 `id=in.()`)。
- 補查詢:`supabaseSelect('articles', 'id=in.(' + ids.join(',') + ')&select=id,
  title,content_md,status,category_id,created_at,updated_at,categories(id,name),
  article_tags(tags(id,name))')`——刻意不含 `embedding`(維持跟 `listArticles`
  一致的「列表類查詢不回傳大型向量欄位」慣例),但包含 `content_md`(給前端做
  搜尋結果摘要用)。
- 補查詢结果先建成 `id → row` 的對照表,再依照 RPC 回傳的原始 id 順序重新排列
  (`Array.prototype.map` 依序查表),因為 `id=in.(...)` 查詢本身不保證回傳順序
  跟 RPC 的相關性排序一致。
- 最後每筆都跑一次既有的 `normalizeArticleRow_`,回傳格式跟 `listArticles`/
  `getArticle` 一致(`tags` 陣列、拿掉 `article_tags`)。

**錯誤處理**
- `queryText` 為空字串或未提供時,在呼叫 `generateEmbedding_` 之前就 throw。
- `generateEmbedding_` 或 `supabaseRpc` 失敗時直接讓錯誤往外傳,不做任何
  try/catch 降級(跟 ticket 03 的既有原則一致:Gemini 失敗就是失敗,不悄悄退化
  成只用關鍵字搜尋)。

## Testing Decisions

延續既有模式:透過假的 `httpFetch_` 驗證行為(同一個假函式要能同時應付
Gemini embedding 呼叫、RPC 呼叫、補查詢呼叫,用回傳序列區分)。

**要測的模組**:`Search.gs`(參數組裝、空查詢驗證、結果重排序、normalize)。

**關鍵測試情境**
1. 空字串或未提供 `queryText` 時,在任何網路呼叫之前就 throw。
2. 正常查詢:依序驗證(a) 呼叫 `generateEmbedding_` 對應的 Gemini 端點,
   (b) 呼叫 `hybrid_search_articles` RPC 且 `query_embedding` 是純數字陣列、
   `tag_ids` 預設是 `[]`,(c) 用 RPC 回傳的 id 清單組出正確的補查詢
   `id=in.(...)`。
3. `opts.tagIds`/`opts.matchCount`/`opts.onlyPublished` 有帶值時,正確反映在 RPC
   payload 裡;沒帶時 `match_count`/`only_published` 完全不出現在 payload 裡。
4. 補查詢回傳的資料跟 RPC 原始順序不同時,最終回傳陣列仍依照 RPC 的原始順序
   (用一個刻意打亂順序的補查詢回應來驗證重排序邏輯真的有作用,不是巧合通過)。
5. RPC 回傳空陣列時,直接回傳 `[]`,且沒有發出補查詢的網路呼叫。
6. 回傳的每筆文章都跑過 `normalizeArticleRow_`(`tags` 是陣列、沒有
   `article_tags` 欄位)。

## Out of Scope

- 不含搜尋文字的純標籤瀏覽(例如只勾標籤、不打字就列出符合的文章)——這是不同的
  查詢模式(比較接近 `listArticles` 加標籤篩選,而不是 hybrid search),`schema.sql`
  的 `hybrid_search_articles` 也不是為了這個情境設計的。如果之後要做,建議另立
  spec 幫 `listArticles` 加 `tagIds` 篩選,而不是勉強套用這個 RPC。
- 前端搜尋列 UI、debounce、loading 狀態——GAS 前端頁面的工作。
- 搜尋結果的分頁(「載入更多」)——`match_count`/`hybrid_search_articles` 內部
  已經有 `least(match_count, 30)` 的上限,真的要做分頁需要額外設計(RPC 目前
  沒有 offset 參數),不在本 spec 範圍。
- 調整 `full_text_weight`/`semantic_weight`/`rrf_k` 這幾個 RPC 早就存在的權重
  參數的使用者介面——`searchArticles` 目前不 expose 這幾個參數,需要的話可以
  之後在 `opts` 裡加,不影響現有設計。

## Further Notes

- 這次查證了 PostgREST 官方文件對 RPC 陣列參數的說明,以及一則 GitHub 討論串
  確認 pgvector 的 `vector` 型別參數透過 PostgREST RPC 傳遞時,就是傳一般 JSON
  數字陣列(如 `{"embedding": [1,2,3]}`),PostgREST/pgvector 會自動轉型,不需要
  在 GAS 端把陣列轉成字串或做其他特殊處理。這解決了原本設計時比較沒把握的一個
  細節。
- `hybrid_search_articles` 本身(SQL 定義)不在本 spec 修改範圍——已經是
  `schema.sql` 交付內容的一部分,套用到真正的 Supabase 專案之後才能實際跑通這裡
  設計的 GAS 端流程,建議屆時做一次端到端的 smoke test。
- **語意搜尋的 Gemini 用量節流(2026-09 補記)**：這份 spec 原始版本完全沒有討論
  `searchArticles` 觸發的 `generateEmbedding_` 呼叫要不要節流——當時的假設是
  Web App 部署層級是 `MYSELF`,只有部署者自己連得上,不會有濫用問題。後來確認
  實際部署一直是不用登入 Google 就能連線,`searchArticles` 又是刻意設計成公開、
  不需密碼的讀取函式,等於任何人都能無限次觸發真正花錢的 Gemini API 呼叫。
  `docs/specs/spec_rag_qa.md` 其實已經為了同一種資源(Gemini 用量)訂過節流機制
  (`askKnowledgeBase` 的密碼門檻),但沒有回頭套用到這裡。修法見
  `src/Search.gs` 的 `SEMANTIC_SEARCH_RATE_LIMIT_`/
  `SEMANTIC_SEARCH_RATE_LIMIT_WINDOW_SECONDS_`(README 已知問題修復紀錄第 33
  條)——這兩個數字目前是概略估計,沒有實際用量數據支撐,之後如果真的觀察到
  合法使用者也會被擋到,或者反過來覺得上限太寬鬆,直接調整這兩個變數即可,不需要
  改動其他程式碼。
