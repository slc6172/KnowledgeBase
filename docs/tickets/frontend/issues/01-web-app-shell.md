# 01 — Web App 骨架 + 視覺設計系統

**What to build:** `doGet`/`include()` 骨架、`Index.html` 組合四個視圖 partial、
JS 視圖切換邏輯、依 F6 設計方向寫的完整 CSS token 與印章風格狀態徽記元件、頂部
導覽列(App 名稱 + 新增文章按鈕 + 分類管理入口)。這張票不含任何實際資料——四個
視圖先是空殼,只驗證骨架跟視覺系統本身。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

**驗收方式:** 部署 Web App 後手動操作、對照下列具體行為(前端沒有 Jest 測試,
`spec_frontend.md` 的 Testing Decisions 已說明原因)。

- [ ] `WebApp.gs` 的 `doGet(e)` 回傳 `HtmlService.createTemplateFromFile('Index')`
      組出的頁面,含 viewport meta tag。
- [ ] `include(filename)` 函式存在,`Index.html` 用
      `<?!= include('Stylesheet'); ?>` 等 scriptlet 引入 `Stylesheet.html` 與四個
      視圖 partial(`ArticleListView.html`、`ArticleDetailView.html`、
      `ArticleEditorView.html`、`CategoryManagerView.html`)、`JavaScript.html`。
- [ ] 開啟部署後的 Web App URL,看到套用 F6 視覺 token 的頁面(米白底
      `#F6F4F0`、墨色文字 `#2A2926`、深松石綠主色 `#3D5C4E`),不是瀏覽器預設
      樣式。
- [ ] 標題用 Noto Serif TC、內文用 Noto Sans TC,透過 Google Fonts CDN 載入;
      內文基準字級 16px 以上、行高 1.6 以上(不是常見 UI 的 13-14px 密集小字)。
- [ ] 頂部導覽列顯示 App 名稱、「新增文章」按鈕、「分類管理」入口,固定在頁面
      上方。
- [ ] 預設載入頁面時,只有「文章列表」視圖可見,其餘三個視圖(詳情/編輯/分類
      管理)是隱藏的(用 CSS class 控制,不是完全不存在於 DOM)。
- [ ] JS 提供 `showView(name)` 函式,呼叫後正確切換哪個 `.view` 區塊可見,不會
      同時顯示兩個視圖、也不會重新整理頁面或改變網址。
- [ ] 點擊「分類管理」入口會呼叫 `showView('category-manager')`,切換到(目前
      還是空的)分類管理視圖。
- [ ] 有一組 `.seal--published`(實心圓點,`--color-primary` 底色)與
      `.seal--draft`(空心灰圈)的 CSS class 已經定義好、可以在畫面上看到視覺
      效果(這張票不需要真的接資料,放兩個寫死的範例元素驗證樣式即可,後續票
      會拿掉範例、接上真實資料)。
