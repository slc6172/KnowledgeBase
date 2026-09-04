---
title: 搜尋結果相關性門檻(關鍵字比對可調 + 沒有夠格結果時回傳空陣列)
status: ready-for-agent
date: 2026-09-01
project: GAS + Supabase 個人/團隊知識庫
depends_on: spec_search.md(已完成,這份 spec 修改它建立的 hybrid_search_articles RPC 簽名)
---

# 搜尋結果相關性門檻 — Spec

## Problem Statement

`hybrid_search_articles` 的語意比對(向量)那一半已經有 `max_semantic_distance` 這個可調門檻,
但關鍵字比對(pg_trgm 的 `%` 運算子)那一半完全沒有對應的可調參數,吃的是 Postgres/session 層
級的 `pg_trgm.similarity_threshold`(未特別設定時預設 0.3)。更根本的問題是:最終排序不論兩邊
候選名單裡的比對品質多差,都會盡量湊到 `match_count` 篇——RRF 只負責替「已經進入候選名單」的
文章排名次,不負責判斷「這篇文章夠不夠格出現在結果裡」。結果就是查詢字沒有夠多真正相關的文章
時,後面幾筆常常是勉強擠進候選名單、實際上不相關的文章。

## Solution

替關鍵字比對那一半新增一個對稱的可調參數 `min_full_text_similarity`(預設 0.3,對齊 Postgres
原生預設值,行為不會無感跑掉),用明確的 `similarity(...) >= min_full_text_similarity` 寫在
`where` 子句(不用有連線池風險的 `set_limit()`)。`Search.gs` 的 `searchArticles` 開放
`opts.minFullTextSimilarity` 讓呼叫端可以覆蓋,比照現有 `opts.maxSemanticDistance` 的傳法。
兩邊候選名單都變成「真門檻篩過的名單」之後,「沒有夠格結果時回傳空陣列」不需要額外寫判斷邏輯,
是兩個門檻變成真門檻後自然會有的行為——這兩者是同一個修改帶來的結果,不是兩個獨立功能。

## User Stories

1. As a knowledge-base user, I want the keyword-matching half of search to have an
   explicit, tunable relevance threshold (not an invisible database default), so search
   quality isn't governed by a setting I can't see or adjust.
2. As a knowledge-base user, I want to manually experiment with different threshold values
   via the Supabase SQL editor, so I can find numbers that feel right for my own knowledge
   base's content, rather than accepting a value someone else guessed at.
3. As a knowledge-base user, I want search to return fewer results — even zero — when
   nothing genuinely qualifies, so I don't get padded-out results that don't actually
   answer my query.
4. As a developer, I want the new threshold parameter implemented without relying on
   session-level Postgres state (like `set_limit()`), so it behaves correctly under
   PostgREST's connection pooling and doesn't leak into unrelated queries reusing the same
   pooled connection.
5. As a developer, I want `Search.gs` to be able to override the new threshold per call
   (mirroring how `maxSemanticDistance` already works), so the value can be tuned later
   without redeploying the SQL function itself.

## Implementation Decisions

**Schema(`docs/schema.sql`):`hybrid_search_articles` 函式簽名新增參數,`full_text` CTE 改寫**

```sql
create or replace function hybrid_search_articles(
  query_text              text,
  query_embedding         vector(768),
  match_count             int default 20,
  full_text_weight        float default 1,
  semantic_weight         float default 1,
  rrf_k                   int default 50,
  only_published          boolean default true,
  tag_ids                 uuid[] default null,
  max_semantic_distance   float default 0.6,
  min_full_text_similarity float default 0.3
)
returns setof articles
language sql
as $$
  ...
  full_text as (
    select
      a.id,
      row_number() over (
        order by similarity(a.title || ' ' || a.content_md, query_text) desc
      ) as rank_ix
    from articles a
    join tag_filtered t on t.id = a.id
    where similarity(a.title || ' ' || a.content_md, query_text) >= min_full_text_similarity
      and (not only_published or a.status = 'published')
    order by rank_ix
    limit least(match_count, 30) * 2
  ),
  ...
$$;
```

把 `(a.title || ' ' || a.content_md) % query_text`(`%` 運算子,吃 session 層級的
`pg_trgm.similarity_threshold`)換成明確的 `similarity(...) >= min_full_text_similarity` 比較
式——效果一樣(pg_trgm 的 `%` 運算子本來就是 `similarity(...) >= pg_trgm.similarity_threshold`
的語法糖),但門檻變成函式參數、每次呼叫互不影響,不依賴任何共用 session 狀態。

`semantic` CTE(`max_semantic_distance` 那段)不用改,維持原樣。

**`Search.gs` 的 `searchArticles` 新增一行**,跟 `maxSemanticDistance` 並列:

```javascript
if (opts.minFullTextSimilarity !== undefined) {
  rpcArgs.min_full_text_similarity = opts.minFullTextSimilarity;
}
```

**「沒有夠格結果就不呈現」不需要額外程式碼**——`full_text`/`semantic` 兩個 CTE 現在都是真門檻
篩過的候選名單,兩邊都篩不出任何候選時,後續的 `full outer join` 自然是空集合,最終
`select ... limit match_count` 回傳空陣列。`searchArticles` 現有的
`if (!rankedRows || rankedRows.length === 0) return [];` 已經處理了這個情況,不用修改。

## Testing Decisions

延續既有模式,測試擴充 `test/Search.test.js`,只驗證「有沒有正確把新參數傳給 RPC」——SQL 函式
本身的比對邏輯不在這個專案的 JS 測試範圍內(`max_semantic_distance` 現在也是這樣測的:JS 測試
只斷言 `rpcArgs` 有沒有正確帶上這個欄位,SQL 邏輯本身要靠你在 Supabase 端手動驗證/調整)。

**要測的模組**:`Search.gs`(`searchArticles` 新增一個條件式參數傳遞)。`docs/schema.sql` 的
SQL 邏輯本身沒有自動化測試(這個專案目前沒有對 SQL 函式跑測試的機制)。

**關鍵測試情境**

1. `opts.minFullTextSimilarity` 有提供時,`rpcArgs.min_full_text_similarity` 正確帶上這個值。
2. `opts.minFullTextSimilarity` 未提供時,`rpcArgs` 完全不含 `min_full_text_similarity` 這個
   欄位(讓 SQL 函式吃自己的預設值 0.3)——跟 `maxSemanticDistance` 現有的測試斷言方式一致。
3. 既有的 `searchArticles` 測試(空查詢文字丟錯、正常查詢的完整流程)在這次改動後維持通過,
   不因為新增這個可選參數而斷掉。

**你這邊要做的手動驗證**:部署後,先用 Supabase SQL Editor 直接呼叫
`select * from hybrid_search_articles('你的查詢字', embedding, 20, 1, 1, 50, true, null, 0.6, 0.3)`,
換最後一個參數(`min_full_text_similarity`)試不同數字,觀察關鍵字比對那一半的結果變化,找到
你覺得「不會混進明顯不相關文章」的數字之後,再決定要不要把這個數字寫回函式簽名的預設值,或是
讓 `Search.gs` 固定傳這個值。

## Out of Scope

- 自動決定/推薦「最佳」門檻數值——這個數字沒有放諸四海皆準的答案(`max_semantic_distance` 的
  0.6 當初也是註明「經驗值起點」,不是算出來的),這次只負責讓它變成可調參數,實際數值由你
  手動測試決定。
- 前端 UI 開放讓使用者自己調門檻——這次只在後端/API 層開放參數,不是產品功能,不會出現在
  `ArticleListView.html` 或搜尋列上。
- `related_articles` 函式的門檻邏輯——它只有語意比對,沒有關鍵字比對那一半,`min_full_text_similarity`
  跟它無關,這次不動它。

## Further Notes

沒有直接調整全域的 `pg_trgm.similarity_threshold`(Supabase 專案設定或 `alter database` 層級),
是因為那樣會影響這個資料庫裡任何其他用到 `%` 運算子或 `similarity()` 的地方(如果將來還有其他
功能用到 pg_trgm),範圍比只改這一個 RPC 函式的參數大很多、也更難追蹤是誰在什麼時候改了這個
全域設定。把門檻收斂成單一函式的具名參數,change 的範圍跟責任歸屬都更清楚。
