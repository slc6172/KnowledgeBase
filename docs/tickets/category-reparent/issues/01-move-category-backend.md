# 01 — 分類換父層級:moveCategory 函式

**What to build:** 新增獨立的 `moveCategory(categoryId, newParentId)`,只負責
變更分類的父層級(改名維持用既有的 `updateCategory`,不擴充它),維持既有的
2 層限制,超過限制或會產生循環的移動直接擋掉並回傳清楚的錯誤。

**Blocked by:** None — 依賴已完成的 `categories-tags/01`(`findCategoryOrThrow_`、
2 層限制的既有邏輯)。

**Status:** ready-for-agent

- [ ] `moveCategory(categoryId, null)`(移到頂層)直接送出 `parent_id: null`
      的更新,不做額外查詢,成功回傳更新後的列。
- [ ] `categoryId === newParentId` 時直接 throw「不能把分類移動到自己底下」,
      不發出任何網路呼叫。
- [ ] `categoryId` 或 `newParentId` 查無資料時,throw 既有格式的「找不到分類:
      {id}」。
- [ ] `newParentId` 指向一個本身已經是子分類的分類(`parent_id` 不是
      `null`)時,throw「分類最多只能有 2 層」(沿用 `createCategory` 既有的
      錯誤文字),不呼叫更新。
- [ ] `categoryId` 本身目前有子分類時(移動會直接產生 3 層),throw「這個分類
      底下還有子分類,無法移動到別的分類底下」,不呼叫更新。
- [ ] 正常情境(移動一個沒有子分類的分類到一個頂層目標分類底下)成功送出
      更新,回傳更新後的列。
- [ ] `Auth.gs` 白名單新增 `moveCategory`,`callProtected` 能正確轉呼叫;密碼
      錯誤時丟出「密碼錯誤」、不執行 `moveCategory`。
- [ ] 用假的 `httpFetch_` 寫測試涵蓋以上所有情境,比照
      `test/Categories.test.js` 既有的 `createCategory` 2 層限制測試寫法。
