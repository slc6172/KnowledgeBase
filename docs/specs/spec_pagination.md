---
title: 文章列表分頁
status: ready-for-agent
date: 2026-08-29
project: GAS + Supabase 個人/團隊知識庫
depends_on: spec_search.md(已完成)、spec_categories_tags.md(已完成)
---

# 文章列表分頁 — Spec

## Problem Statement

`Articles.gs` 的 `listArticles(opts)` 本來就支援 `limit`/`offset`,但
`JavaScript.html` 呼叫時完全沒有帶這兩個參數,永遠吃後端預設值(`limit` 固定
50,沒有 `offset`)。文章數一旦超過 50 篇,使用者在瀏覽模式(不輸入搜尋文字,
單純用狀態/分類篩選)下永遠看不到第 51 篇以後的內容,介面上也沒有任何提示
「其實還有更多」。

`searchArticles`(呼叫 `hybrid_search_articles` RPC)目前不支援 `offset`,這是
`spec_search.md` 明訂的 Out of Scope,本 spec 沿用同一個界線——只做瀏覽模式
(`listArticles`)的分頁,不動搜尋結果的分頁。

## Solution

前端加上一頁筆數固定的「上一頁/下一頁」分頁控制,只作用在瀏覽模式(沒有輸入
搜尋文字、單純用狀態/分類篩選瀏覽)。每頁筆數是程式碼常數,先寫死一個預設值,
之後要調整由開發者直接改常數,不開放使用者在介面上自行調整。

## User Stories

1. As a knowledge-base user, I want the article list to show a fixed number of
   articles per page instead of silently capping at 50 with no indication there's
   more, so I know whether there's more content to browse.
2. As a knowledge-base user, I want "上一頁"/"下一頁" buttons below the article list
   (browse mode only), so I can move through all articles without scrolling through
   an unbounded list.
3. As a knowledge-base user, I want the "上一頁" button disabled on the first page and
   "下一頁" disabled when there are no more results, so I don't click into an empty or
   invalid state.
4. As a knowledge-base user, I want changing the status filter, category filter, or
   navigating home to reset back to page 1, so I don't end up looking at "page 3" of a
   completely different filtered set by accident.
5. As a knowledge-base user, I want switching into search mode (typing a query and
   hitting 搜尋) to not show pagination controls, since `searchArticles` doesn't
   support paging (existing `spec_search.md` limitation) — I should not see broken
   controls that don't do anything.
6. As a developer, I want the page size to live in a single named constant in the
   source, so I can change it later without hunting through the file for a magic
   number.

## Implementation Decisions

**範圍:只動前端。** `listArticles(opts)` 的 `limit`/`offset` 支援已經存在
(`Articles.gs`),完全不需要修改後端或 `Auth.gs`(`listArticles` 是讀取類函式,
不受密碼保護,任何人都能呼叫,這點不變)。

**頁筆數常數**:`JavaScript.html` 內新增 `var ARTICLE_LIST_PAGE_SIZE = 20;`,
放在 `loadArticleList`/`renderArticleCards` 附近。所有帶 `limit` 的呼叫都讀這個
常數,不要在多處各自寫死數字。

**分頁狀態**:新增一個模組層級變數 `var currentListPage = 0;`(0-indexed)。
`loadArticleList()` 呼叫 `listArticles({ ...現有 opts, limit:
ARTICLE_LIST_PAGE_SIZE, offset: currentListPage * ARTICLE_LIST_PAGE_SIZE })`。

**判斷「還有下一頁」**:`listArticles` 本身不回傳總筆數,只回傳這一頁的資料列。
用「回傳筆數是否等於 `ARTICLE_LIST_PAGE_SIZE`」當作「可能還有下一頁」的判斷依據
(等於代表這頁被塞滿、可能還有更多;小於代表這是最後一頁)——不額外新增一個
`countArticles` 後端函式來拿精確總數,這個近似判斷法對「上一頁/下一頁」這種
UI 已經夠用,精確總筆數/總頁數不在這次範圍內。

**UI 位置**:在 `ArticleListView.html` 的 `#article-list-results` 下方新增一個
分頁控制區塊(例如 `<div id="article-list-pager" class="pager hidden">`),含
「上一頁」按鈕、目前頁碼文字(純顯示第幾頁,不是可輸入跳頁)、「下一頁」按鈕。

**顯示條件**:分頁控制只在瀏覽模式(`performSearch` 沒被觸發、走的是
`loadArticleList`)顯示;呼叫 `performSearch`(輸入搜尋文字)時整個
`#article-list-pager` 加上 `hidden`,原因同 User Story 5。

**重置頁碼的時機**:`goHome()`、切換 `#list-status-filter`/`#list-category-filter`、
執行搜尋(`performSearch`)這幾個既有的既有事件處理裡,都把 `currentListPage`
重設為 0 再重新載入——沿用現有「換條件就重查」的既有慣例,不特別处理「記住上次
頁碼」這種情境。

**按鈕停用邏輯**:`currentListPage === 0` 時「上一頁」disabled;拿到的資料筆數
小於 `ARTICLE_LIST_PAGE_SIZE` 時「下一頁」disabled。

## Testing Decisions

前端(`.html`/內嵌 `<script>`)沿用專案既有慣例——沒有自動化測試(`google.script.run`
在 Node 裡沒有現成的假接縫)。改完用抽取 `<script>` 內容 + `node --check` 做語法
檢查,並且明確告知使用者這部分需要手動驗收,不自行宣稱「測試通過」。

`listArticles` 本身的 `limit`/`offset` 行為已經有既有測試涵蓋
(`test/Articles.test.js`),本次不修改後端,不需要新增後端測試。

**手動驗收情境建議**(交給實作 ticket 時列在驗收清單):
1. 文章數 > 1 頁時,「下一頁」可以正常換頁、內容確實不同。
2. 最後一頁「下一頁」disabled,第一頁「上一頁」disabled。
3. 切換狀態/分類篩選、或按「上一頁/下一頁」到第 2 頁後再按搜尋,頁碼正確回到
   第 1 頁,不會殘留舊的 `offset`。
4. 搜尋模式下分頁控制整塊隱藏不顯示。

## Out of Scope

- `searchArticles`/`hybrid_search_articles` 的分頁——`spec_search.md` 已經記錄
  這個限制,RPC 本身沒有 `offset` 參數,要做的話得另立 spec 幫 RPC 加參數,不在
  這次範圍。
- 讓使用者自訂每頁筆數的介面(下拉選單選 10/20/50)——先固定一個常數,有需求
  再加。
- 精確的「共 N 頁」/「共 N 篇文章」顯示——需要額外的 count 查詢,這次只做
  「還有沒有下一頁」的近似判斷。
- 「跳到第 N 頁」的輸入框——只做上一頁/下一頁的線性移動。

## Further Notes

- 這個 spec 完成後,`docs/tickets/` 底下的批次操作(`spec_batch_operations.md`)
  的「跨頁全選」問題(該 spec 的 Out of Scope 已經記錄)才有實際的「頁」這個
  概念可以討論,如果之後真的要做跨頁全選,建議在那個時候一併回頭看這裡的分頁
  狀態怎麼暴露給批次操作的模組使用。
