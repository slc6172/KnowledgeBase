# 01 — 附件線上預覽:簽名 URL + 純文字內容

**What to build:** 延伸既有的 `StorageClient.gs`/`Attachments.gs`,補上兩種預覽
所需的後端能力——任何檔案型附件都能拿到短效簽名 URL(給 pdf/office_doc/photo 等
前端渲染用),以及 code/md_file 附件的純文字內容(給語法高亮/Markdown 渲染用,
1MB 大小上限)。並把附件查詢邏輯收斂成一個共用私有函式。

**Blocked by:** None — can start immediately(沿用既有的 `httpFetch_` 接縫、
已完成的 `storageUpload_`/`storageDelete_`/`Attachments.gs`)

**Status:** done

- [x] `storageSignedUrl_(bucket, path, expiresInSeconds)` 對
      `{SUPABASE_URL}/storage/v1/object/sign/{bucket}/{path}` 送出 POST,body 帶
      `{"expiresIn": expiresInSeconds}`;把回應裡的**相對路徑** `signedURL` 組成
      `{SUPABASE_URL}/storage/v1{signedURL}` 這樣完整可用的 URL 後回傳。
- [x] `storageSignedUrl_` 面對非 2xx 回應會 throw,訊息包含狀態碼與回應內容。
- [x] `storageDownload_(bucket, path)` 對 `{SUPABASE_URL}/storage/v1/object/{bucket}/{path}`
      送出 GET,回傳回應內容的文字(`getContentText()`)。
- [x] `storageDownload_` 面對非 2xx 回應會 throw,訊息包含狀態碼與回應內容。
- [x] `getSignedAttachmentUrl(attachmentId, expiresInSeconds)`:查到的附件有
      `file_path`(任何檔案型附件,不限 pdf/office_doc)時呼叫 `storageSignedUrl_`
      並回傳結果。
- [x] `expiresInSeconds` 省略時,實際送給 Storage 的 `expiresIn` 是 `300`。
- [x] `getSignedAttachmentUrl` 對 `file_path` 為 null(`type='url'`)的附件丟出
      清楚錯誤,且不呼叫 `storageSignedUrl_`。
- [x] `getSignedAttachmentUrl` 對查無的附件 ID 丟出「找不到附件」錯誤。
- [x] `getTextAttachmentContent(attachmentId)`:對 `type` 為 `code` 或 `md_file`
      且 `file_size` 未超過 1MB 的附件,呼叫 `storageDownload_` 並回傳結果。
- [x] `getTextAttachmentContent` 對其他 `type` 的附件丟出清楚錯誤(「此附件不支援
      純文字預覽」),且不呼叫 `storageDownload_`。
- [x] `getTextAttachmentContent` 對 `file_size` 超過 1MB(`1 * 1024 * 1024`)的
      附件丟出清楚錯誤(「檔案過大,無法線上預覽,請下載」),且不呼叫
      `storageDownload_`。
- [x] `getTextAttachmentContent` 對查無的附件 ID 丟出「找不到附件」錯誤。
- [x] 新增私有 `findAttachmentOrThrow_(attachmentId)`,`deleteAttachment`、
      `getSignedAttachmentUrl`、`getTextAttachmentContent` 三個函式都改用它做附件
      查詢,不各自重複同一段查詢+錯誤處理邏輯。
- [x] `deleteAttachment` 既有的測試(not-found / 檔案型附件 / url 型附件)全部
      維持通過,確認抽出共用函式沒有改變它的外部行為。
- [x] 用假的 `httpFetch_` 寫測試涵蓋以上每一條行為。
