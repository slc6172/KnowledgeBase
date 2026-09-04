# 01 — 開啟分享連結

**What to build:** `doGet(e)` 讀 `e.parameter.article`,把 id 原樣傳進模板;
前端啟動時如果帶了這個初始 id,直接跳過文章列表、開啟到指定文章的詳情頁,
失敗(文章不存在/已被刪除)時顯示專屬的「找不到這篇文章」畫面。可以用手動
打網址(`?article=<id>`)測試,不需要分享按鈕存在。

**Blocked by:** 無,可立即開始

**Status:** ready-for-agent

- [ ] `WebApp.gs` 的 `doGet(e)` 改成:
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
      不新增額外的輔助函式——這裡沒有可測的邏輯分支,是否存在/格式對不對交給
      前端呼叫 `getArticle` 時走既有錯誤處理路徑統一判斷。**不需要新增
      `test/WebApp.test.js`**。
- [ ] `Index.html` 在 `<?!= include('JavaScript'); ?>` 之前插入:
      `<script>var INITIAL_ARTICLE_ID = <?!= JSON.stringify(initialArticleId) ?>;</script>`
- [ ] 新增 `openArticleDetailFromShareLink(articleId)`,跟既有
      `openArticleDetail(articleId)` **各自獨立**(不共用失敗處理路徑):
      呼叫 `getArticle(articleId)`,成功時 `renderArticleDetail` +
      `mountAttachmentPanel` + `loadRelatedArticles`,失敗時
      `showView('article-not-found')`。
- [ ] 啟動邏輯(`loadArticleList(); loadCategoryFilterOptions();
      loadBatchCategoryOptions(); initEasyMDE();` 那段):
      `loadCategoryFilterOptions`/`loadBatchCategoryOptions`/`initEasyMDE`
      一律執行;`INITIAL_ARTICLE_ID` 有值時呼叫
      `openArticleDetailFromShareLink(INITIAL_ARTICLE_ID)` 取代
      `loadArticleList()`,沒有值時維持呼叫 `loadArticleList()`。
- [ ] 新增 `ArticleNotFoundView.html`(在 `Index.html` 跟其他 view 一起
      `include`):文字說明 + 「回文章列表」按鈕,按下去呼叫
      `showView('article-list'); loadArticleList();`(比照 `#btn-home`
      既有的回列表邏輯)。
- [ ] `node --check` 驗證 `JavaScript.html`/`Index.html`(含新檔案)語法
      通過。
- [ ] 手動驗收:
      1. 用帶 `?article=<存在的id>` 的網址開啟,直接落在該篇文章詳情頁,
         不會先看到文章列表閃一下。
      2. 用帶不存在 id 的網址開啟,看到「找不到這篇文章」畫面(不是空白畫面
         疊錯誤 toast),按「回文章列表」正確回到列表並看到資料。
      3. 沒有帶 `?article=` 參數開啟,行為跟這次改動之前完全一樣。
      4. 一般瀏覽(點文章卡片、切換各種 view)瀏覽器網址列**不會**改變——
         確認沒有打破既有的「不換網址」單頁 SPA 設計。
