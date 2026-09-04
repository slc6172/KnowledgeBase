# 01 — 批次操作:batchDeleteArticles / batchSetArticlesCategory / batchAddTagsToArticles

**What to build:** `Articles.gs` 新增三個批次函式:批次刪除、批次設定分類、
批次新增標籤。三個函式統一回傳 `{ succeeded, failed }`,單筆處理失敗不中斷
整批。批次加標籤要處理「文章已經有部分要加的標籤」的重疊情況,不違反
`article_tags` 的 unique constraint。

**Blocked by:** None — 依賴既有的 `deleteArticle`、`findOrCreateTag_`。

**Status:** ready-for-agent

- [ ] `batchDeleteArticles(articleIds)`:對每個 id 呼叫既有的 `deleteArticle`
      (重用它已經處理好的附件 Storage 清理邏輯,不重新實作刪除本身),用
      `try/catch` 包住每一筆;全部成功時 `succeeded` 含全部 id、`failed` 是空
      陣列;其中一筆失敗時,那筆進 `failed`(含錯誤訊息)、其餘仍在
      `succeeded`,且流程不中斷(驗證後續文章仍然被處理到)。
- [ ] `batchSetArticlesCategory(articleIds, categoryId)`:`categoryId` 可以是
      `null`;對每個 id 各自送出獨立的更新請求(不透過 `updateArticle`,直接
      更新 `category_id` 欄位),同樣包 `try/catch`、回傳
      `{ succeeded, failed }`。
- [ ] `batchAddTagsToArticles(articleIds, tagNames)`:先用 `findOrCreateTag_`
      把 `tagNames` 轉成 `tagIds`;對每篇文章,先查目前已有的標籤、只對缺少的
      標籤新增關聯,已存在的標籤不重複插入,不影響文章原有的其他標籤。
- [ ] `batchAddTagsToArticles`:`tagNames` 對應到不存在的標籤時,透過
      `findOrCreateTag_` 建立新標籤。
- [ ] 三個批次函式都驗證「任一筆處理失敗不影響其餘文章繼續被處理」——用測試
      模擬其中一筆失敗,確認其他筆仍正確送出請求。
- [ ] `Auth.gs` 白名單新增 `batchDeleteArticles`、
      `batchSetArticlesCategory`、`batchAddTagsToArticles` 三筆;密碼錯誤時
      三個函式都不會被實際執行到。
- [ ] 用假的 `httpFetch_` 寫測試涵蓋以上情境,比照
      `test/Articles.test.js` 既有的 `deleteArticle` 測試與
      `tag-management/01` 的重疊 pair 處理邏輯。
