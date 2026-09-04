# 02 — 附件建立、列表、刪除

**What to build:** 附件的完整建立/查詢/刪除生命週期——檔案型附件上傳到 Storage 並
建立 DB 記錄、URL 型附件直接建立 DB 記錄、依文章列出附件、刪除附件時連同 Storage
物件一併清掉(URL 型附件跳過 Storage 步驟)。

**Blocked by:** 01 — StorageClient 基礎層

**Status:** done

- [x] `uploadAttachmentFile(articleId, fileName, base64Data, mimeType)` 依序:用
      `Utilities.base64Decode` 解碼 → 組出
      `{articleId}/{uuid}_{encodeURIComponent(fileName)}` 路徑(uuid 用
      `Utilities.getUuid()`)→ 呼叫 `storageUpload_` 上傳 → 在 `attachments` 表插入
      一筆記錄(`type` 用 `detectAttachmentType_` 判斷、`file_path`、`file_name`、
      `file_size`),回傳建立的記錄。
- [x] `file_size` 是解碼後的 byte 長度,不是 base64 字串長度。
- [x] 路徑帶入的 uuid 確保同一篇文章、同名的兩次上傳不會在 Storage 互相覆蓋。
- [x] `addAttachmentUrl(articleId, url, label)` 插入一筆 `type='url'` 的記錄,
      `file_path` 為 null;沒給 `label` 時 `file_name` 退回用 `url` 本身。
- [x] `listAttachments(articleId)` 依 `article_id` 篩選、依 `created_at` 由舊到新
      排序回傳。
- [x] `deleteAttachment(attachmentId)` 先查出該筆附件;查無該 ID 時丟出清楚的
      「找不到附件」錯誤,且不會發出任何刪除呼叫。
- [x] 查到的附件 `file_path` 不是 null 時,先呼叫 `storageDelete_` 清掉 Storage
      物件,成功後才刪 `attachments` 那筆 DB 記錄。
- [x] 查到的附件是 `type='url'`(`file_path` 為 null)時,完全不呼叫
      `storageDelete_`,只刪 DB 記錄。
- [x] `Utilities.base64Decode` 與 `Utilities.getUuid` 在測試中可以整個換成假實作
      (比照 `PropertiesService` 的做法),讓路徑與 byte 長度可預期、好斷言。
- [x] 用假的 `httpFetch_` + 假的 `Utilities` 寫測試涵蓋以上每一條行為。
