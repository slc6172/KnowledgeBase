# 02 — 刪除確認無人使用的 filterArticleIdsByTags_

**What to build:** 確認 `filterArticleIdsByTags_` 沒有任何正式程式碼呼叫(動手刪之前先用
`grep` 確認,不是憑印象判斷)後,刪除函式本體、`module.exports` 裡的項目、
`test/Articles.test.js` 裡它專屬的測試區塊(`describe("filterArticleIdsByTags_", ...)`)。
`uniqueValues_` 不受影響,維持不動(`searchArticles`、Ticket 01 新路徑都還會用到)。

**Blocked by:** 01(要等新路徑真的接上、確認舊函式沒有任何呼叫點之後才能刪)

**Status:** done

- [x] `grep` 確認 `filterArticleIdsByTags_` 除了它自己的定義/匯出/測試之外,沒有任何其他
      呼叫點
- [x] 函式本體、`module.exports` 項目、專屬測試區塊都已刪除
- [x] `uniqueValues_` 維持不動
- [x] 完整測試套件(`npm test`)全數通過
