# 02 — 刪除文章不再受公開讀取節流牽連

**What to build:** `deleteArticle_` 在刪除前用來找出要一併清掉的附件(Storage 檔案)的檢查,在
共用的匿名讀取節流額度被用滿時,仍然能完整成功——附件清單讀得到、Storage 檔案照常清除、文章照常
被刪除。新增一個不節流的內部附件清單讀取,只給寫入路徑用,公開的 `listAttachments` 對外行為
(節流、回傳形狀)完全不變,內部改委派給這個新的內部讀取。命名方式比照 `Attachments.gs` 裡其他
內部函式的既有慣例(底線字首)。這個內部讀取跟 Ticket 01 引入的文章讀取是不同檔案、不同的內部
函式,彼此獨立,不共用程式碼。

**Blocked by:** None — can start immediately (可與 Ticket 01 平行進行)

**Status:** done

- [x] 把共用節流計數器灌到上限後呼叫 `deleteArticle_`,仍完整成功(附件清單讀得到、每個有
      `file_path` 的附件觸發 Storage 刪除、文章本身照常被刪除)
- [x] 外部直接呼叫 `listAttachments` 時,節流行為完全不變(既有測試不動)
- [x] 新增的內部讀取以底線字首命名,`test/PrivateFunctionExposure.test.js` 的靜態掃描繼續通過
- [x] 完整測試套件(`npm test`)全數通過
