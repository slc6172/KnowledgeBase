---
title: 分享文章連結
status: ready-for-agent
date: 2026-09-01
project: GAS + Supabase 個人/團隊知識庫
depends_on: 無
---

# 分享文章連結 — Spec

## Problem Statement

這個 app 是不換網址的單頁 SPA(F1 決策,`JavaScript.html` 裡的 `showView` 註解有記錄),
`doGet(e)` 完全不讀 `e.parameter`,想把某一篇文章的連結傳給別人,現在唯一的辦法是口頭告訴
對方文章標題、讓對方自己在列表裡找,沒有辦法直接分享一個「打開就到那篇文章」的連結。

## Solution

`doGet(e)` 讀 `e.parameter.article`,把這個 id 原樣傳進模板;前端啟動時如果帶了這個初始 id,
直接跳過文章列表、開啟到指定文章的詳情頁,失敗(文章不存在/已被刪除/已變回草稿)時顯示一個
專屬的「找不到這篇文章」畫面,不沿用現有蓋在畫面上的錯誤 toast。已發布文章的詳情頁新增一顆
「分享」按鈕,用 `google.script.url.getLocation()` 組出 `?article=<id>` 連結、複製到剪貼簿、
跳 toast 確認。不改變平常瀏覽時的網址列行為(不加 `history.pushState`),維持 F1 決策不動。

## User Stories

1. As a knowledge-base user, I want to click a "share" button on a published article and get
   a copyable link, so I can send a colleague straight to that article instead of describing
   how to find it.
2. As a knowledge-base user, I want visiting that link to open directly to the article's
   detail view (skipping the article list), so the recipient doesn't have to search for it.
3. As a knowledge-base user, I want a clear confirmation that the link was copied, so I know
   the action succeeded without having to check my clipboard manually.
4. As a knowledge-base user, I want a friendly "article not found" screen (with a way back
   to the article list) if I open a stale or invalid share link, so I'm not left staring at
   a blank page with only an error toast.
5. As a knowledge-base user, I want the share button to appear only on published articles
   (not drafts), so I'm not casually encouraged to share unfinished content — even though a
   draft link would technically still work if someone already has it.
6. As a developer, I want normal in-app navigation (clicking through the article list) to
   keep behaving exactly as it does today — no URL changes, no history entries — so this
   feature doesn't touch the app's existing single-page, no-URL-routing design (F1 決策).

## Implementation Decisions

**`WebApp.gs`:`doGet(e)` 修改**

```javascript
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  template.initialArticleId = (e && e.parameter && e.parameter.article) || null;
  return template
    .evaluate()
    .setTitle('知識庫')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
```

不新增額外的輔助函式(例如原本設想的 `resolveInitialArticle_`)——這裡只是把查詢參數原樣傳進
模板,沒有可測的邏輯分支;是否存在、格式對不對,交給前端呼叫 `getArticle` 時走既有的錯誤處理
路徑統一判斷(見下方前端邏輯),不在 `doGet` 這一層做任何驗證或預先查詢。這也是為什麼
**這份 spec 不新增 `test/WebApp.test.js`**——`WebApp.gs` 目前沒有、之後也不會有可測的分支邏輯。

**`Index.html`**:在 `<?!= include('JavaScript'); ?>` 之前插入一小段 scriptlet,把初始文章 id
變成一個全域 JS 變數:

```html
<script>var INITIAL_ARTICLE_ID = <?!= JSON.stringify(initialArticleId) ?>;</script>
```

**`JavaScript.html` 修改**:

- 新增 `openArticleDetailFromShareLink(articleId)`,跟既有 `openArticleDetail(articleId)` 分開、
  各自獨立(不共用同一個失敗處理路徑,避免這次新增的分支意外影響既有的一般瀏覽行為):

  ```javascript
  function openArticleDetailFromShareLink(articleId) {
    currentDetailArticleId = articleId;
    showView('article-detail');
    google.script.run
      .withSuccessHandler(function (article) {
        renderArticleDetail(article);
        mountAttachmentPanel(document.getElementById('detail-attachment-panel'), articleId);
        loadRelatedArticles(articleId);
      })
      .withFailureHandler(function () {
        showView('article-not-found');
      })
      .getArticle(articleId);
  }
  ```

- 啟動邏輯(現有 `loadArticleList(); loadCategoryFilterOptions(); loadBatchCategoryOptions(); initEasyMDE();` 那段)前面加判斷:

  ```javascript
  loadCategoryFilterOptions();
  loadBatchCategoryOptions();
  initEasyMDE();
  if (INITIAL_ARTICLE_ID) {
    openArticleDetailFromShareLink(INITIAL_ARTICLE_ID);
  } else {
    loadArticleList();
  }
  ```

  `loadCategoryFilterOptions`/`loadBatchCategoryOptions`/`initEasyMDE` 這幾個初始化跟顯示哪個
  view 無關,維持一律執行。

- 新增「找不到這篇文章」畫面(新檔案 `ArticleNotFoundView.html`,在 `Index.html` 跟其他 view 一起
  `include`):一段文字說明 + 一顆「回文章列表」按鈕,按下去呼叫 `showView('article-list');
  loadArticleList();`(比照 `#btn-home` 既有的回列表邏輯)。

- `ArticleDetailView.html` 的 `.detail-header__actions` 新增「分享」按鈕,**只在
  `article.status === 'published'` 時顯示**(對應 User Story 5,渲染邏輯放在
  `renderArticleDetail` 裡,跟目前依 `status` 決定 `seal`/`sealLabel` 的既有寫法同一個位置)。
  點擊行為:

  ```javascript
  google.script.url.getLocation(function (location) {
    var link = location.href.split('?')[0] + '?article=' + currentDetailArticleId;
    navigator.clipboard.writeText(link).then(function () {
      showToast('連結已複製');
    });
  });
  ```

  `google.script.url.getLocation()` 是 Apps Script HtmlService 既有的 client-side API,專門用來
  在頁面內拿到目前部署的 Web App 網址,不需要自己拼湊或寫死網址。

## Testing Decisions

這份 spec 大部分改動在前端(`JavaScript.html`/`Index.html`/新的 `ArticleNotFoundView.html`),
後端 `doGet` 只是原樣傳遞查詢參數、沒有分支邏輯——延續既有慣例,不寫自動化測試。

**要測的模組**:無(沒有新增或修改任何 `.gs` 函式的行為邏輯,`getArticle` 本身不變)。

**前端手動驗收清單**(這次沒有自動化測試可以擋,手動驗收要涵蓋齊全):

1. 已發布文章詳情頁出現「分享」按鈕;草稿詳情頁**不**出現。
2. 點分享按鈕,連結成功複製到剪貼簿,出現「連結已複製」的 toast。
3. 用複製到的連結(帶 `?article=<id>`)直接開啟 app(新分頁/無痕視窗),確認直接落在該篇文章
   的詳情頁,不會先看到文章列表閃一下。
4. 用一個不存在的 id(例如把連結裡的 id 改亂)開啟,確認看到「找不到這篇文章」畫面,而不是
   空白畫面疊錯誤 toast;按「回文章列表」能正確回到列表並看到資料。
5. 正常情況(沒有帶 `?article=` 參數)開啟 app,行為跟這次改動之前完全一樣——直接看到文章
   列表,不受這次改動影響。
6. 一般瀏覽時(點文章卡片進詳情頁、切換各種 view)瀏覽器網址列**不會**改變——確認 F1 決策沒有
   被這次改動打破。

## Out of Scope

- 平常瀏覽時同步更新網址列(`history.pushState`)——維持 F1 決策,只做「分享按鈕主動組連結」
  這一種方式,不做網址即時同步。
- 分享連結的存取控制/追蹤(例如記錄連結被開啟幾次、設定連結有效期限)——`getArticle` 現有的
  無密碼讀取模型完全不變,這份 spec 純粹是「讓已經可讀的內容多一個好取得連結的入口」。
- 分享其他類型頁面(分類/標籤篩選後的列表、搜尋結果)——這次只做單篇文章的分享連結。
- 草稿文章的分享按鈕——這次刻意不做(User Story 5),但注意這不是安全性限制,只是不主動
  提供入口;已經拿到草稿連結的人一樣打得開(`getArticle` 本來就不分草稿/已發布都能讀)。

## Further Notes

`openArticleDetailFromShareLink` 特意不重用既有 `openArticleDetail`/`loadArticleDetail` 的失敗
處理邏輯(那條路徑失敗時只跳 `showError` toast,畫面留在原地),是因為兩種情境的「原地」不一樣
——一般瀏覽失敗時背後還有文章列表可看,toast 蓋一下就好;透過分享連結進來失敗時背後什麼都沒有,
需要一個真正的專屬畫面而不是空白畫面疊 toast。拆成兩個獨立函式雖然有一點重複的程式碼
(`showView('article-detail')`、`mountAttachmentPanel`、`loadRelatedArticles` 這幾行),但避免
了「一般瀏覽的失敗處理」意外被這次新增的分支影響到,對既有功能的風險比較小。
