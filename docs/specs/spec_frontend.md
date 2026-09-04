---
title: GAS 前端頁面(HtmlService Web App)
status: ready-for-agent
date: 2026-08-15
project: GAS + Supabase 個人知識庫
depends_on: |
  spec_gas_backend.md、spec_attachment_upload.md、spec_attachment_preview.md、
  spec_search.md、spec_categories_tags.md(全部已完成/待完成的後端函式)、
  DESIGN.md、本次 /grilling F1-F6 決策
---

# GAS 前端頁面(HtmlService Web App)— Spec

## Problem Statement

後端函式(文章 CRUD、附件上傳/預覽、搜尋、分類/標籤)都已經完成,但沒有任何操作
介面。使用者要透過 Apps Script 編輯器手動呼叫函式才能用這個知識庫,不是一個真正
可用的產品。本 spec 把這些函式串成一個 GAS Web App。

前端規模跟後端不一樣——後端每個決策都能從 DESIGN.md 直接推導,前端有大量開放式
UX/技術選型決策,已經另外跑過一輪 `/grilling`(F1-F6),決策如下:

- **F1**:單一 HTML 頁面,JS 做視圖切換(SPA 風格),`google.script.run` 呼叫後端。
- **F2**:四個畫面——文章列表(含搜尋列)、文章詳情(內容+附件+預覽)、文章編輯
  (建立/編輯)、分類管理。
- **F3**:Markdown 編輯器用 EasyMDE。
- **F4**:附件上傳不做真正的進度條,上傳中 disable 按鈕 + 文字提示。
- **F5**:列表/搜尋結果顯示標題、分類、標籤、內容摘要、更新時間。
- **F6**:視覺方向——紙感米白底、墨色文字、深松石綠主色、暖銅金輔色,
  Noto Serif TC(標題)+ Noto Sans TC(內文),文章狀態用「印章」風格的圓形徽記
  (實心松石綠=已發布、空心灰圈=草稿)。

也查證了三個要用的外部 CDN 套件目前的載入方式(見 Further Notes)。

## Solution

Apps Script HtmlService 的技術限制決定了檔案結構:一個 Web App 只能回傳單一份
HTML(不能像一般網站分開 serve `.css`/`.js` 檔案),所以用 Apps Script 慣用的
`<?!= include('X'); ?>` scriptlet 把多個 `.html` 檔案在伺服器端組成一份完整頁面
再回傳給瀏覽器。外部 CDN 資源(`<script src="https://...">`)不受此限制,可以正常
使用。

檔案:
- `WebApp.gs` — `doGet(e)`、`include(filename)`
- `Index.html` — 頁面骨架,`<head>` 引入 CDN 套件 + `Stylesheet.html`,`<body>`
  組合四個視圖 partial + `JavaScript.html`
- `Stylesheet.html` — 依 F6 的設計 token 寫的完整 CSS
- `ArticleListView.html`、`ArticleDetailView.html`、`ArticleEditorView.html`、
  `CategoryManagerView.html` — 四個視圖的 HTML 片段(預設用 CSS 隱藏,JS 切換
  顯示哪一個)
- `JavaScript.html` — 視圖切換邏輯 + 所有 `google.script.run` 呼叫 + EasyMDE/
  highlight.js/marked.js 初始化與渲染邏輯

## User Stories

**Web App 骨架與視覺系統**
1. As a knowledge-base user, I want to open the Web App URL and see a styled shell
   (top bar with app name, "new article" button, category-manager entry, and a content
   area) rather than an unstyled page, so the tool feels like a real product from the
   first load.
2. As a knowledge-base user, I want the top bar to let me switch between the article
   list and category manager, so I can navigate without reloading the page (per F1).
3. As a developer, I want `doGet` to serve one assembled `Index.html` via the
   `include()` scriptlet pattern, so the four view partials and shared stylesheet/script
   stay in separate, maintainable files while still shipping as one HTML response (a
   hard constraint of HtmlService, not a stylistic choice).
4. As a knowledge-base user, I want the visual design (colors, type, the seal-style
   status badge) applied consistently across all four views, not just the shell, so the
   whole app feels coherent.

**文章列表 + 搜尋**
5. As a knowledge-base user, I want the article list view to load and show all
   published articles (via `listArticles`) when I first arrive, so I see my content
   immediately without having to search first.
6. As a knowledge-base user, I want a persistent search bar at the top of the list
   view; typing a query and submitting calls `searchArticles` and replaces the list
   with ranked results, so search feels like refining the same list rather than a
   separate mode (per F2's recommendation).
7. As a knowledge-base user, I want each result/list card to show title, category,
   tags, a short snippet of `content_md`, updated date, and the draft/published seal
   badge (per F5), so I can judge relevance without opening the article.
8. As a knowledge-base user, I want clicking a card to open that article's detail view,
   so browsing feels direct.
9. As a knowledge-base user, I want a visible empty state when a search or filter
   returns nothing, telling me plainly that nothing matched, so I don't wonder whether
   something is broken.

**文章編輯(建立 / 編輯)**
10. As a knowledge-base user, I want an EasyMDE-powered Markdown editor for the article
    body, loaded from CDN, so I get toolbar affordances (bold, links, lists) without a
    bespoke implementation.
11. As a knowledge-base user, I want a category dropdown populated from
    `listCategories`, so I can file the article without leaving the editor.
12. As a knowledge-base user, I want a tag input that suggests existing tags (from
    `listTags`) as I type, letting me pick an existing one or type a new one, matching
    the autocomplete-with-free-entry behavior already decided in DESIGN.md.
13. As a knowledge-base user, I want a "Save draft" action that calls `createArticle`
    or `updateArticle` (depending on whether I'm creating or editing) without changing
    publish status, so I can save work in progress.
14. As a knowledge-base user, I want a "Publish" action that calls `setArticleStatus`
    (or creates as draft then immediately publishes, for a brand-new article), so
    embedding generation and searchability kick in per the already-built backend logic.
15. As a knowledge-base user, I want editing an existing article to pre-fill the title,
    body, category, and tags from `getArticle`, so I'm not starting from a blank slate.

**文章詳情 + 附件**
16. As a knowledge-base user, I want the detail view to render the article body as
    HTML via marked.js, so I read formatted content, not raw Markdown source.
17. As a knowledge-base user, I want the detail view to list all attachments (via
    `listAttachments`) with their type, name, and a delete control, so I can see and
    manage everything attached to the article.
18. As a knowledge-base user, I want to upload a file attachment by picking a file,
    which gets read client-side and sent as base64 to `uploadAttachmentFile`, with the
    upload button disabled and a "Uploading..." label while it's in flight (per F4 —
    no real progress bar).
19. As a knowledge-base user, I want to add a URL attachment by pasting a link and an
    optional label, calling `addAttachmentUrl`.
20. As a knowledge-base user, I want each attachment previewed appropriately by type:
    `photo` as an inline thumbnail (via `getSignedAttachmentUrl` as the `<img src>`),
    `pdf` embedded in an `<iframe>` (via `getSignedAttachmentUrl`), `office_doc`
    embedded via Google Docs Viewer wrapping the signed URL, `code`/`md_file` rendered
    as syntax-highlighted text / rendered Markdown (via `getTextAttachmentContent` +
    highlight.js / marked.js), and `zip`/`odf_doc`/`url` shown as a filename/link with
    no inline preview — matching DESIGN.md 3.1 and the already-built backend functions
    exactly.
21. As a knowledge-base user, I want deleting an attachment to call `deleteAttachment`
    and remove it from the view immediately, so the UI stays in sync.
22. As a knowledge-base user, I want a visible draft/published seal badge and an edit
    entry point on the detail view, so status and the path to editing are always
    obvious.

**分類管理**
23. As a knowledge-base user, I want the category manager to show existing categories
    grouped by parent (top-level categories with their children nested under them), so
    the 2-level structure is visually obvious.
24. As a knowledge-base user, I want to create a new top-level category or a child of
    an existing top-level category, calling `createCategory`, with a clear error shown
    if I try to nest a 3rd level (the backend already rejects this; the UI just needs
    to surface the error message).
25. As a knowledge-base user, I want to rename or delete a category from this view,
    calling `updateCategory`/`deleteCategory`.

**錯誤處理與可靠性**
26. As a knowledge-base user, I want every `google.script.run` call to have a failure
    handler that shows the server's error message somewhere visible (not just a
    console error), so a thrown backend error (e.g. "找不到文章") is never silently
    swallowed.
27. As a knowledge-base user, I want buttons that trigger a server call to be disabled
    while that call is in flight, so I can't double-submit (e.g. clicking "Publish"
    twice).

## Implementation Decisions

**檔案結構與 HtmlService 慣例**
- `WebApp.gs`:
  ```js
  function doGet(e) {
    return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('知識庫')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  }
  ```
  這是 Apps Script 官方慣用的多檔案合併模式,不是本 spec 發明的技巧。
- `Index.html` 用 `<?!= include('Stylesheet'); ?>`、
  `<?!= include('ArticleListView'); ?>` 等 scriptlet 依序組進頁面,`JavaScript.html`
  放在 `</body>` 前用同樣方式引入。

**視圖切換**
- 四個視圖各自是一個 `<section id="view-xxx" class="view">` 區塊,預設除了
  `view-article-list` 都帶 `hidden` class;JS 提供一個 `showView(name)` 函式切換
  `hidden` class,不做真正的路由/網址切換(URL 不隨視圖改變,符合 F1 的 SPA 決策,
  瀏覽器上一頁/下一頁不特別處理)。

**視覺設計 token(F6 落地到 CSS 變數)**
```css
:root {
  --color-bg: #F6F4F0;
  --color-ink: #2A2926;
  --color-primary: #3D5C4E;   /* 深松石綠 */
  --color-accent: #B08B4F;    /* 暖銅金 */
  --color-border: #E4E0D8;
  --font-display: 'Noto Serif TC', serif;
  --font-body: 'Noto Sans TC', sans-serif;
  --font-mono: 'Noto Sans Mono', ui-monospace, monospace;
}
body { font-size: 16px; line-height: 1.65; }
```
狀態徽記(印章風格):`.seal--published`(實心 `--color-primary` 圓點)、
`.seal--draft`(空心灰圈,`border: 2px solid #9C9890`)——一個小型 `<span>` 元件,
在列表卡片、詳情頁、編輯頁都重複使用同一份 CSS class。

**外部 CDN 套件**(2026-08-15 查證過的目前可用載入方式)
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.css">
<script src="https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/marked/lib/marked.umd.js"></script>
<script src="https://cdn.jsdelivr.net/highlight.js/latest/highlight.min.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/highlight.js/latest/styles/github.min.css">
```
（highlight.js 的配色主題檔名可以換成跟 F6 米白/墨色調性更搭的主題,實作時再挑,
不影響載入方式本身）。Google Fonts(Noto Serif/Sans TC)用標準
`<link href="https://fonts.googleapis.com/css2?family=...">` 引入。

**附件上傳的 base64 轉換**(客戶端)
```js
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]); // 去掉 data:...;base64, 前綴
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

**附件預覽的四種串接方式**(直接對應 DESIGN.md 3.1 節跟已完成的後端函式,前端
只是把它們接上對應的 HTML 元素):
- `photo`:`getSignedAttachmentUrl(id)` → `<img src="{url}">`
- `pdf`:`getSignedAttachmentUrl(id)` → `<iframe src="{url}">`
- `office_doc`:`getSignedAttachmentUrl(id)` →
  `<iframe src="https://docs.google.com/viewer?url={encodeURIComponent(url)}&embedded=true">`
- `code`/`md_file`:`getTextAttachmentContent(id)` → `code` 用
  `hljs.highlightElement()` 渲染、`md_file` 用 `marked.parse()` 渲染
- `zip`/`odf_doc`/`url`:純顯示檔名(或 `url`/`file_name`)+ 下載連結,不呼叫任何
  預覽函式

**錯誤處理慣例**:所有 `google.script.run` 呼叫統一用
`.withSuccessHandler(...).withFailureHandler((err) => showError(err.message))` 的
寫法,`showError` 是一個共用的小 toast/訊息列元件,不用瀏覽器原生 `alert()`。

## Testing Decisions

前端(HTML/CSS/JS in HtmlService)無法比照後端用 Jest + 假的 `httpFetch_` 測試——
沒有一個能在 Node 裡跑的「假 google.script.run」的既有慣例可以直接沿用。這個 spec
的可驗證性改成:

- **手動驗收**:每張票的 acceptance criteria 用「部署後手動操作、對照畫面/行為」
  的方式驗收,不強求自動化測試(跟後端的紅-綠-重構模式不同,如果之後想加前端自動
  化測試,`google.script.run` 需要先被包一層可替換的介面,類似後端的 `httpFetch_`
  接縫,這超出本 spec 範圍)。
- 每個視圖的 acceptance criteria 都寫成「使用者可觀察到的具體行為」(例如「上傳中
  按鈕會 disable 並顯示文字」),讓手動驗收有明確的檢查點,不是空泛的「介面看起來
  合理」。

## Out of Scope

- 前端自動化測試基礎建設(需要另立 spec 討論怎麼幫 `google.script.run` 開接縫)。
- 分頁/無限捲動(`searchArticles`/`listArticles` 目前一次回傳的量對個人知識庫來說
  夠用,見對應 spec 的 Out of Scope)。
- 深色模式、多語系切換。
- 拖曳排序、批次操作(批次刪除文章/附件)。
- 離線支援、PWA。
- 附件的「換檔案」(重新上傳取代既有檔案)——目前設計是刪除舊附件、上傳新附件
  兩步驟。

## Further Notes

- 這次額外查證了 EasyMDE、marked.js、highlight.js 三個套件目前(2026-08-15)的
  jsDelivr CDN 載入方式,Implementation Decisions 裡列的 `<script>`/`<link>` 標籤
  是查證後的結果,不是憑印象寫的。
- Apps Script 的 `doGet`/`HtmlService.createTemplateFromFile`/`include()` scriptlet
  模式是穩定多年的官方慣用法,沒有另外查證版本更新的必要。
- `google.script.run` 的請求大小/執行時間限制沿用先前 `spec_attachment_upload.md`
  Further Notes 提過的 Apps Script 平台限制,本 spec 不重複列出。
