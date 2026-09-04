# 01 — 文章列表分頁

**What to build:** 文章列表(瀏覽模式,不是搜尋結果)加上固定筆數的上一頁/下一頁
分頁控制。`listArticles` 的 `limit`/`offset` 已經存在,這張票純粹是前端串接,不
修改任何後端函式。

**Blocked by:** None — `listArticles(opts)` 的 `limit`/`offset` 支援已完成
(`gas-supabase-backend/02`),文章列表本身已完成(`frontend/02`)。

**Status:** ready-for-agent

**驗收方式:** 部署後手動操作、對照下列具體行為。

- [ ] 新增一個頁筆數常數(例如 `ARTICLE_LIST_PAGE_SIZE = 20`),所有帶 `limit`
      的呼叫都讀這個常數,不在多處各自寫死數字。
- [ ] 瀏覽模式(`loadArticleList`)下,文章列表下方顯示分頁控制:「上一頁」
      按鈕、目前頁碼、「下一頁」按鈕。
- [ ] 第一頁時「上一頁」disabled;拿到的資料筆數小於頁筆數常數時「下一頁」
      disabled(用「回傳筆數是否等於頁筆數」判斷是否還有下一頁,不新增後端
      count 函式)。
- [ ] 點「下一頁」/「上一頁」時,`listArticles` 的呼叫帶正確的
      `limit`/`offset`,列表內容確實換成不同頁的資料。
- [ ] 切換狀態篩選、分類篩選、或按 `goHome()` 時,頁碼重設回第 1 頁再重新
      查詢,不殘留舊的 `offset`。
- [ ] 輸入搜尋文字執行搜尋(`performSearch`)時,分頁控制整塊隱藏——搜尋結果
      目前不支援分頁(既有限制,`spec_search.md` 已記錄),不能顯示會誤導使用者
      的分頁按鈕。
- [ ] 文章數不足一頁時(例如只有 5 篇),分頁控制仍然顯示但兩個按鈕都
      disabled,不是整個隱藏(讓使用者知道「這就是全部了」而不是介面消失)。
