---
title: 批次操作(批次刪除文章/設分類/加標籤)
status: ready-for-agent
date: 2026-08-29
project: GAS + Supabase 個人/團隊知識庫
depends_on: spec_gas_backend.md(已完成)、spec_frontend.md(已完成)、spec_pagination.md(排在本 spec 之前施作,建立當頁勾選的「頁」概念)
---

# 批次操作(批次刪除文章/設分類/加標籤) — Spec

## Problem Statement

文章列表/詳情頁目前完全沒有多選介面,每個寫入類操作都只能一篇一篇來
(刪除、改分類、加標籤都要進到單篇的編輯/詳情頁才能做)。文章數一多,
清理一批錯誤資料、把一批文章重新歸類、或幫一批文章統一補標籤,都得重複
同一組操作 N 次。

## Solution

文章列表加上勾選模式與批次工具列,支援三個批次動作:刪除、設定分類、新增
標籤。後端新增三個獨立的白名單函式,批次刪除內部重用既有的
`deleteArticle`(含它已經處理好的附件 Storage 清理邏輯),不重新設計刪除本身
的邏輯。

## User Stories

**勾選與工具列**

1. As a knowledge-base user, I want to enter a "select mode" on the article list and
   check individual article cards, so I can build up a set of articles to act on
   together.
2. As a knowledge-base user, I want a batch toolbar to appear once at least one
   article is checked, showing 刪除/設分類/加標籤 actions side by side, so I have a
   single entry point for all three batch actions.
3. As a knowledge-base user, I want selection to be scoped to the current page only
   (no cross-page "select all"), so the interaction stays simple and predictable —
   consistent with how pagination (`spec_pagination.md`) already resets state on
   filter/page changes.
4. As a knowledge-base user, I want the selection to clear after switching filters,
   changing page, or completing a batch action, so I don't accidentally act on a stale
   set of article ids from a previous view.

**批次刪除**

5. As a knowledge-base user, I want to select multiple articles and delete them all at
   once, so cleaning up a batch of unwanted content doesn't take N separate delete
   confirmations.
6. As a knowledge-base user, I want the delete confirmation to list the titles of all
   selected articles (consistent with the existing single-article delete's serious
   tone, since this is a hard delete with no recycle bin — `DESIGN.md` decision #15),
   so I can double-check I'm not about to delete the wrong batch.
7. As a knowledge-base user, I want each selected article's attachments cleaned up
   from Storage the same way single-article deletion already does, so batch deletion
   doesn't leave orphaned files behind.
8. As a knowledge-base user, I want a partial failure (some articles deleted, some
   not) to be reported clearly — which succeeded, which failed and why — rather than
   an all-or-nothing silent failure, so I know exactly what state my data is in
   afterward.

**批次設分類**

9. As a knowledge-base user, I want to set the same category on multiple selected
   articles at once, so re-organizing a batch of miscategorized articles doesn't
   require opening each one individually.
10. As a knowledge-base user, I want to be able to batch-set the category to "未分類"
    (uncategorized), consistent with the single-article editor's category dropdown
    already offering that option.
11. As a knowledge-base user, I want a lightweight one-line confirmation (article
    count + target category name) before a batch category change applies, rather than
    the heavier title-listing confirmation used for deletion, since this action is
    reversible.

**批次加標籤**

12. As a knowledge-base user, I want to add one or more tags to multiple selected
    articles at once, so tagging a batch of related articles doesn't require opening
    each one individually.
13. As a knowledge-base user, I want batch-adding tags to only add (never remove or
    replace) each article's existing tags, so I can't accidentally wipe out tags
    someone already carefully set on an article.
14. As a knowledge-base user, I want an article that already has one of the tags being
    batch-added to simply keep that tag (no duplicate, no error), so the operation
    always succeeds cleanly regardless of overlap.
15. As a developer, I want batch category/tag changes to not trigger embedding
    regeneration, consistent with how `updateArticle` only regenerates embeddings on
    title/content changes — these are cheap, Gemini-free operations.

## Implementation Decisions

**三個獨立的白名單函式**(延續 `Auth.gs` 既有哲學:具體、單一用途的函式,不做
通用的 `batchUpdateArticles(ids, patch)`):

**`batchDeleteArticles(articleIds)`**(`Articles.gs`)
- 對 `articleIds` 逐一呼叫既有的 `deleteArticle(id)`,用 `try/catch` 包住每一筆
  (單篇失敗不中斷整批,對應 User Story 8)。
- 回傳 `{ succeeded: [id, ...], failed: [{ id, message }, ...] }`——呼叫端可以
  分別呈現。

**`batchSetArticlesCategory(articleIds, categoryId)`**(`Articles.gs`)
- `categoryId` 可以是 `null`(對應 User Story 10)。
- 逐一呼叫 `supabaseUpdate('articles', 'id=eq.' + id, { category_id:
  categoryId })`——不透過 `updateArticle`(那個函式的 embedding 重新產生判斷式
  只檢查 `title`/`content_md`,`category_id` 單獨變更本來就不會觸發,行為一致,
  但直接呼叫 `supabaseUpdate` 更直接,不需要為了共用 `updateArticle` 而傳一堆
  不相關的 `undefined` 欄位)。
- 同樣包 `try/catch`,回傳格式跟 `batchDeleteArticles` 一致
  (`{ succeeded, failed }`)。

**`batchAddTagsToArticles(articleIds, tagNames)`**(`Articles.gs`,重用
`findOrCreateTag_`)
1. 用既有的 `findOrCreateTag_` 把 `tagNames` 轉成 `tagIds`(找不到就建立,跟
   單篇存檔時的既有行為一致)。
2. 對 `articleIds` 逐一:先查該篇文章目前的 `article_tags`
   (`supabaseSelect('article_tags', 'article_id=eq.' + id)`),過濾掉已經存在
   的 `tag_id`,只對真正缺少的標籤 `supabaseInsert('article_tags', [...])`——
   避開 `(article_id, tag_id)` unique constraint,做法與
   `spec_tag_management.md` 的 `mergeTags` 面對同一個約束時採用的「應用層先查
   再過濾」是同一套邏輯,不引入新的處理方式。
3. 同樣包 `try/catch`、回傳 `{ succeeded, failed }`。

**`Auth.gs` 白名單**新增三筆:`batchDeleteArticles`、
`batchSetArticlesCategory`、`batchAddTagsToArticles`。

**前端**:
- `ArticleListView.html` 的文章卡片(`renderArticleCards`)在「勾選模式」下,
  每張卡片左上角顯示一個 checkbox(平常隱藏,避免干擾一般瀏覽/點擊進入詳情頁
  的既有互動);新增一個「選取」按鈕切換勾選模式的開關。
- 新增批次工具列(`#article-batch-toolbar`,平常 `hidden`,至少勾選一篇時
  顯示),含「刪除」「設分類」(下拉選單 + 確認按鈕)「加標籤」(沿用文章編輯頁
  `tag-input` 元件的極簡版:輸入框 + Enter 新增 chip,不需要自動建議既有標籤,
  因為 `findOrCreateTag_` 本來就能處理新標籤)三個動作。
- 三個動作都呼叫對應的 `runProtected('batchXxx', [勾選的 id 陣列, ...其他參數],
  onSuccess, onFailure)`。
- `onSuccess` 收到 `{ succeeded, failed }` 後:`failed` 為空時單純
  `showToast('已處理 N 篇')` + 重新整理列表 + 清空勾選;`failed` 非空時用
  `showError` 顯示「N 篇成功、M 篇失敗:{列出失敗文章標題/錯誤}」,同樣重新
  整理列表(讓成功的部分反映出來)並清空勾選。
- 換頁、換篩選條件、切換離開勾選模式時,清空目前的勾選集合(對應 User
  Story 4)。
- 批次刪除的確認:沿用單篇刪除的 `window.confirm()`模式,但列出所有勾選文章的
  標題(對應 User Story 6);批次設分類的確認只需要一行文字帶數量與目標分類
  名稱(對應 User Story 11,不用列標題)。

## Testing Decisions

延續既有模式:透過假的 `httpFetch_` 驗證行為,`test/Articles.test.js` 的既有
`deleteArticle` 測試、`spec_tag_management.md` 的 `mergeTags` 測試都是直接的
prior art(單篇操作的既有測試 + 「查詢→過濾→寫入」的應用層邏輯)。

**要測的模組**:`Articles.gs`(新增三個批次函式)、`Auth.gs`(白名單新增三筆)。

**關鍵測試情境**
1. `batchDeleteArticles`:全部成功時 `succeeded` 含全部 id、`failed` 是空陣列;
   其中一筆 `deleteArticle` 拋出錯誤時,那筆進 `failed`(含錯誤訊息)、其餘仍在
   `succeeded`,且流程不中斷(驗證後續文章仍然被處理到)。
2. `batchSetArticlesCategory`:`categoryId` 為 `null` 時正確送出
   `{ category_id: null }`;每篇文章各自送出獨立的 PATCH 請求。
3. `batchAddTagsToArticles`:某篇文章已經有其中一個要加的標籤時,只對缺少的
   標籤呼叫 insert,不重複插入已存在的 pair。
4. `batchAddTagsToArticles`:`tagNames` 對應到不存在的標籤時,透過
   `findOrCreateTag_` 建立新標籤(驗證呼叫到 insert into `tags`)。
5. 三個批次函式:任一筆處理失敗都不影響其餘文章繼續被處理(逐一
   try/catch,不是整批因單一失敗而中止)。
6. `Auth.gs`:三個新函式都能透過 `callProtected` 正確轉呼叫;密碼錯誤時統一
   丟出「密碼錯誤」,三個函式都不會被實際執行到。

**前端**沒有自動化測試(既有慣例),`node --check` 驗證語法,明確告知使用者
需要手動驗收,重點驗收部分失敗時的訊息呈現(User Story 8)。

## Out of Scope

- 跨頁/跨篩選結果的「全選」——選取範圍只限當頁勾選,`spec_pagination.md`
  完成後才有明確的「頁」概念;跨頁全選要處理「換頁時已勾選的怎麼辦」「全選是
  抓真實 id 清單還是傳篩選條件給後端重新查」,複雜度明顯更高,留待有實際需求
  再另立 spec。
- 批次修改文章狀態(草稿/發布)——這個操作牽涉 Gemini embedding 重新產生
  (`setArticleStatus` 目前 published 時會呼叫),批次觸發可能造成 API 用量
  暴增,不在這次範圍,需要的話應該另外討論節流機制。
- 批次移除標籤——這次只做「加」,移除語意風險較高(User Story 13 已明確排除
  取代/移除),之後如果有需求可以另立 spec。
- 批次操作的復原(undo)——`DESIGN.md` 決策 #15(硬刪除、無回收筒)本來就沒有
  復原機制,批次操作不改變這個既有立場。

## Further Notes

- `batchDeleteArticles`/`batchSetArticlesCategory`/`batchAddTagsToArticles`
  三個函式回傳同一種 `{ succeeded, failed }` 形狀,前端的部分失敗處理邏輯
  (組合出「N 篇成功、M 篇失敗」的訊息)可以寫成一個共用的前端 helper,三個
  動作的 `onSuccess` handler 都呼叫它,不需要各寫一份幾乎一樣的邏輯。
