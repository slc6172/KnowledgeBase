---
title: 文章標籤篩選(搜尋 + 純瀏覽)
status: ready-for-agent
date: 2026-09-01
project: GAS + Supabase 個人/團隊知識庫
depends_on: spec_search.md(已完成,本 spec 是它當初 Out of Scope 留下的「純瀏覽標籤篩選」缺口 + 補上搜尋列缺的前端 UI)
---

# 文章標籤篩選(搜尋 + 純瀏覽)— Spec

## Problem Statement

文章列表目前只能用分類篩選(`list-category-filter` 下拉選單),標籤完全沒有對應的篩選 UI。
`hybrid_search_articles` RPC 跟 `Search.gs` 的 `searchArticles` 其實已經支援 `tagIds`(AND 語意)
參數,但前端搜尋列沒有接上這個功能;而沒有打搜尋文字、純瀏覽用 `listArticles` 的情境,
後端更是完全沒有 `tagIds` 這個篩選維度可用。使用者想「只看某個標籤底下的文章」時,現在唯一的
辦法是搜尋文字剛好符合、或是進到每篇文章底下自己找標籤,不方便。

## Solution

前端補上一個標籤篩選 UI(細節見 `spec_tag_picker.md`,兩份 spec 共用同一顆元件),搜尋列跟純
瀏覽列表都能用。搜尋情境直接把選取的 `tagIds` 傳進既有的 `searchArticles`;純瀏覽情境則在
`Articles.gs` 的 `listArticles` 新增 `tagIds` 支援,語意跟 RPC 的 AND 篩選(必須同時擁有所有
選取的標籤)一致,採用專案裡「先查詢、應用層過濾、再查主表」的既有模式(`mergeTags` 的作法),
不新增 SQL 函式或 migration。

## User Stories

1. As a knowledge-base user, I want to filter the article list by one or more tags while
   browsing (without typing a search query), so I can see everything tagged, say, "React"
   without needing to remember the right search keyword.
2. As a knowledge-base user, I want to combine a tag filter with the existing category
   filter, so I can narrow down to articles that are both in a category and carry a tag.
3. As a knowledge-base user, I want to select multiple tags and see only articles that have
   all of them, so the filter behaves the same way whether I'm searching or just browsing.
4. As a knowledge-base user, I want tag filtering while searching (typing a query) to work
   the same way it already works via the search RPC, so the two entry points feel
   consistent rather than like two different features.
5. As a knowledge-base user, I want the article list to show zero results (not an error)
   when no article matches every selected tag, so I get clear feedback instead of a broken
   screen.
6. As a developer, I want the tag-filtering logic in `listArticles` to reuse the existing
   `article_tags` join table via a plain application-layer query, so this doesn't require a
   new RPC function or a schema migration.

## Implementation Decisions

**`Articles.gs`:新增私有輔助函式 `filterArticleIdsByTags_(tagIds)`**

1. `supabaseSelect('article_tags', 'tag_id=in.(' + tagIds.join(',') + ')&select=article_id,tag_id')` 取出所有「有任一選取標籤」的關聯列。
2. 在 JS 應用層依 `article_id` 分組,計算每篇文章實際符合的 distinct `tag_id` 數量。
3. 回傳「符合數量 === `tagIds.length`」的 `article_id` 陣列(AND 語意——必須同時擁有全部選取的標籤才算符合),跟 `hybrid_search_articles` RPC 裡 `having count(distinct tag_id) = array_length(tag_ids, 1)` 的邏輯對齊。

**`listArticles(opts)` 修改**:

```
if (opts.tagIds && opts.tagIds.length > 0) {
  var matchedIds = filterArticleIdsByTags_(opts.tagIds);
  if (matchedIds.length === 0) return [];   // 短路,不送出第二次查詢
  q += '&id=in.(' + matchedIds.join(',') + ')';
}
```

這段插在既有 `status`/`categoryId` 過濾之後、`limit`/`offset` 之前——分類、狀態、標籤三個篩選
條件都是疊加的 `&` 查詢參數,天然就是 AND 語意(對應 User Story 2),分頁的 `limit`/`offset`
套用在標籤過濾後的結果集上,行為跟現有分類/狀態篩選的分頁一致。

**空結果短路**:`matchedIds.length === 0` 時直接回傳 `[]`,不送出第二次對 `articles` 表的查詢——
避免組出 `id=in.()` 這種空清單語法送給 PostgREST(行為未定義,不如直接短路乾淨)。

**前端(`JavaScript.html`)**:

- 篩選列(`ArticleListView.html` 目前放 `list-category-filter` 的地方)新增標籤篩選,UI 元件是
  `spec_tag_picker.md` 定義的共用元件的「篩選模式」(只能瀏覽/勾選既有標籤,不能在這裡打字建立
  新標籤)。
- `loadArticleList()` 呼叫 `listArticles` 時,把目前選取的標籤 id 陣列一併帶進 `opts.tagIds`。
- 搜尋列(`performSearch`/`searchArticles` 呼叫處)同樣接上這顆元件,把選取的標籤 id 帶進
  `opts.tagIds` 傳給既有的 `searchArticles(queryText, opts)`——這條路徑後端完全不用改,
  `opts.tagIds` 已經支援。

## Testing Decisions

延續既有模式,測試擴充 `test/Articles.test.js`,`test/Search.test.js` 裡驗證 `opts` 轉換成 RPC
參數的斷言風格、`spec_tag_management.md` 裡 `mergeTags` 的「多次依序假 `httpFetch_` 回傳」寫法,
是這次的 prior art。

**要測的模組**:`Articles.gs`(新增 `filterArticleIdsByTags_`,修改 `listArticles`)。`Search.gs`
不用改,不需要新增測試。

**關鍵測試情境**

1. `listArticles({ tagIds: [...] })` 先送出正確的 `article_tags` 查詢(URL 含 `tag_id=in.(...)`),
   再依分組結果送出帶 `id=in.(...)` 的 `articles` 查詢,兩次呼叫的順序跟參數都要驗證到。
2. 只符合部分標籤(不是全部)的文章,不會出現在最終 `id=in.(...)` 清單裡——驗證 AND 語意
   (需要至少 2 個標籤、其中一篇文章只符合其中 1 個的測試資料)。
3. 沒有任何文章同時符合全部選取標籤時,`listArticles` 回傳 `[]`,且**不會**送出第二次對
   `articles` 表的查詢(斷言 `fetchSpy` 的呼叫次數只有 1 次)。
4. `tagIds` 為空陣列或未提供時,`listArticles` 行為跟這次改動之前完全一樣(不觸發
   `filterArticleIdsByTags_`,既有測試不能因此斷掉)。
5. `tagIds` 跟 `categoryId`/`status` 同時提供時,最終查詢字串三個條件都要出現(驗證 AND 疊加)。

**前端**沒有自動化測試,`node --check` 驗證語法,手動驗收清單涵蓋:純瀏覽勾選 2 個標籤只看到
同時有這兩個標籤的文章、搜尋時疊加標籤篩選、標籤篩選跟分類篩選同時使用。

## Out of Scope

- 標籤篩選的 OR 語意(符合任一標籤即可)——這次統一用 AND,跟現有 RPC 行為一致,不提供切換。
- 標籤篩選元件本身的外觀/互動細節——見 `spec_tag_picker.md`,這份 spec 只定義後端跟串接邏輯。
- 用一次新的 RPC/SQL view 取代這裡的兩段式查詢——這次維持應用層過濾,不新增資料庫物件。

## Further Notes

`filterArticleIdsByTags_` 用兩次獨立的 REST 呼叫(先查 `article_tags` 再查 `articles`)而不是
一次 PostgREST 的 embedded filter(例如 `article_tags!inner`),是因為 PostgREST 的 embedded
filter 對多個 `tag_id` 只能表達「至少符合其中一個」(inner join + `in.()`),沒辦法直接表達
「同時符合全部」的 AND 語意,除非額外疊加同一張關聯表的多次 embed(語法複雜、可讀性差)。
兩段式查詢雖然多一次網路呼叫,但邏輯清楚、跟 `mergeTags` 已經證明過的「查詢 → 應用層處理 →
再查」風格一致,對這個專案的資料量級(單一知識庫,文章跟標籤數量都不大)效能不是問題。
