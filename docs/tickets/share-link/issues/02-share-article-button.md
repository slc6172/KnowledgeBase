# 02 — 分享按鈕

**What to build:** 已發布文章詳情頁新增「分享」按鈕,用
`google.script.url.getLocation()` 組出 `?article=<id>` 連結、複製到剪貼簿、
跳 toast 確認。草稿詳情頁不顯示這顆按鈕。

**Blocked by:** 無,可立即開始(跟 `01 — 開啟分享連結` 各自獨立可驗證,但要
組成完整的「分享→打開」體驗需要兩張票都做完)

**Status:** ready-for-agent

- [ ] `ArticleDetailView.html` 的 `.detail-header__actions` 新增「分享」
      按鈕。
- [ ] 按鈕**只在 `article.status === 'published'` 時顯示**,渲染邏輯放在
      `renderArticleDetail` 裡,跟目前依 `status` 決定 `seal`/`sealLabel`
      的既有寫法同一個位置。
- [ ] 點擊行為:
      ```javascript
      google.script.url.getLocation(function (location) {
        var link = location.href.split('?')[0] + '?article=' + currentDetailArticleId;
        navigator.clipboard.writeText(link).then(function () {
          showToast('連結已複製');
        });
      });
      ```
- [ ] `node --check` 驗證 `JavaScript.html`/`ArticleDetailView.html` 語法
      通過。
- [ ] 手動驗收:
      1. 已發布文章詳情頁出現「分享」按鈕;草稿詳情頁**不**出現。
      2. 點分享按鈕,連結成功複製到剪貼簿,出現「連結已複製」的 toast。
      3. 把複製到的連結貼到新分頁/無痕視窗開啟,確認直接落在該篇文章的
         詳情頁(需要 `01 — 開啟分享連結` 也完成才能驗這一項)。
