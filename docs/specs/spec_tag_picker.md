---
title: 標籤選取元件補強(瀏覽下拉 + 既有自由輸入)
status: ready-for-agent
date: 2026-09-01
project: GAS + Supabase 個人/團隊知識庫
depends_on: 無(spec_tag_filter.md 會使用這份 spec 定義的元件,但兩份可以獨立實作/驗收)
---

# 標籤選取元件補強(瀏覽下拉 + 既有自由輸入)— Spec

## Problem Statement

目前文章編輯頁(`editor-tag-input`)、批次加標籤面板(`batch-tag-input`)的標籤選取都是純
「打字 + 自動建議 + Enter 新增」的自由輸入模式——這個模式很適合「隨手建立新標籤」,但完全
不適合「我想看看目前有哪些標籤、直接挑一個」這種情境:使用者得先想起標籤怎麼拼、或打幾個字
才能觸發自動建議,沒辦法像分類下拉選單那樣一眼看到所有選項。分類的下拉選單解決了「瀏覽既有
選項」的問題,但代價是分類下拉沒辦法建立新分類(得去分類管理頁);標籤如果直接照搬同一套,
會失去現有「打字直接建立新標籤」這個好用的能力。

## Solution

打造一顆共用的標籤選取元件,同時保留現有的自由輸入(文字 + 自動建議 + 建立新標籤),並在
旁邊加一個「瀏覽全部標籤」的展開按鈕,點開後列出目前所有標籤(checkbox 清單),點選即可加入,
不用打字。這顆元件有兩種模式:**編輯模式**(輸入 + 瀏覽都開放,包含建立新標籤)給文章編輯頁
跟批次加標籤面板用;**篩選模式**(只能瀏覽/勾選既有標籤,關閉打字建立新標籤)給
`spec_tag_filter.md` 的標籤篩選 UI 用。

## User Stories

1. As a knowledge-base user, I want to browse the full list of existing tags and click to
   add one, so I don't have to remember exact tag names or spelling.
2. As a knowledge-base user, I want to still be able to type a new tag name and create it on
   the spot, so tagging remains as fast as it is today for new tags.
3. As a knowledge-base user, I want the browse list and the free-text input to work
   together on the same field (not as two separate, disconnected controls), so I'm not
   forced to pick one interaction style upfront.
4. As a knowledge-base user, I want the same tag-picking experience in the article editor
   and the batch "add tags" panel, so the interaction feels consistent across the app.
5. As a knowledge-base user, I want the tag filter (from `spec_tag_filter.md`) to use the
   same browsing list, but without the ability to type a brand-new tag name — since
   filtering only makes sense against tags that already exist.
6. As a knowledge-base user, I want tags I've already selected to be visually distinguished
   in the browse list (e.g. checked/highlighted), so I can tell at a glance which ones are
   already applied while browsing for more.

## Implementation Decisions

**純前端變動**,不涉及任何 `.gs` 函式或 schema 改動——`listTags()` 已經存在,提供元件需要的
資料來源。

**`JavaScript.html` 新增共用函式 `buildTagPicker(container, options)`**:

- `options.mode`:`'edit'`(預設,含自由輸入 + 建立新標籤)或 `'filter'`(只讀瀏覽,不能打字建立)。
- `options.selectedTagIds`:目前已選取的標籤 id 陣列(初始狀態)。
- `options.onChange(selectedTagIds)`:選取變化時的 callback,呼叫端(編輯頁/批次面板/篩選列)
  自行決定要怎麼用這個陣列(存進表單狀態、或觸發重新查詢)。
- 元件內部結構:延用現有 `editor-tag-input` 的文字輸入 + 自動建議 + chips 顯示(`mode: 'edit'`
  時才顯示輸入框;`mode: 'filter'` 時完全不渲染輸入框),旁邊新增一個小箭頭/按鈕,點擊展開一個
  `checkbox` 清單(資料來源 `listTags()`,依名稱排序),清單裡已選取的標籤打勾且視覺上區分
  (對應 User Story 6)。勾選/取消勾選直接更新 chips 顯示跟觸發 `onChange`,跟打字新增標籤共用
  同一份內部選取狀態,不是兩套各自獨立的資料。

**套用位置**(三處都改呼叫 `buildTagPicker`,拿掉各自原本手刻的輸入邏輯,合併成呼叫同一顆
共用函式,減少重複程式碼):

1. `ArticleEditorView.html` 的 `editor-tag-input` → `buildTagPicker(..., { mode: 'edit' })`。
2. 批次操作的 `batch-tag-input` → `buildTagPicker(..., { mode: 'edit' })`。
3. `spec_tag_filter.md` 的標籤篩選列 → `buildTagPicker(..., { mode: 'filter' })`。

**標籤清單資料**:三處呼叫都各自呼叫一次 `listTags()`(不做全站共用快取)——標籤數量級對這個
專案不大,重複呼叫的成本可忽略,維持現有 `loadTagManagerList` 之類函式各自獨立呼叫的既有風格,
不為此額外設計一個共用的全域快取層。

## Testing Decisions

純前端變動,沒有 `.gs` 函式可測,延續既有慣例:`node --check` 驗證語法,不寫自動化測試。

**手動驗收清單**(這次特別重要,因為三個套用點共用同一顆元件,任何一處的邊界情況都可能連帶
影響其他兩處):

1. 文章編輯頁:展開瀏覽清單、點選一個既有標籤、確認 chips 正確顯示;接著打字建立一個全新標籤、
   確認也正確加入 chips;存檔後確認兩種方式加的標籤都正確寫入。
2. 批次加標籤面板:同上兩種方式都要驗證,並確認批次套用到多篇文章後,`Articles.gs` 既有的
   `batchAddTagsToArticles` 行為不受影響(這次沒有動這個函式,只是換了前端呼叫的元件)。
3. 標籤篩選列:確認展開清單能勾選/取消勾選,**確認沒有打字輸入框出現**(`mode: 'filter'` 的
   輸入框隱藏邏輯是這次新增的分支,容易漏測)。
4. 三處都要驗證「已選取的標籤在瀏覽清單裡有打勾/視覺區分」(User Story 6)。

## Out of Scope

- 標籤瀏覽清單的排序/搜尋框(清單本身若標籤數量很多要不要能再篩選)——這次維持依名稱字母
  排序的完整清單,不額外加清單內搜尋。
- 全站共用的標籤資料快取——三處各自獨立呼叫 `listTags()`,不做快取層。
- 改變 `Tags.gs`/`Articles.gs`/`batchAddTagsToArticles` 既有函式的行為或簽名——這份 spec 純粹
  是換前端的輸入 UI,後端資料流完全不變。

## Further Notes

`mode: 'filter'` 拿掉打字建立新標籤,是因為篩選情境下「建立一個現在還沒有任何文章使用的新
標籤」沒有意義(篩選結果一定是空的)——這不是元件功能被閹割,而是這個模式下讓使用者打字建立
新標籤只會製造困惑,直接拿掉這個選項比留著但每次都得不到有意義結果來得清楚。
