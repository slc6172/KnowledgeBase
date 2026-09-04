# 01 — StorageClient 基礎層(Storage REST 上傳/刪除 + 型別自動判斷)

**What to build:** Supabase Storage REST API 的薄包裝(上傳、刪除),以及依副檔名
自動判斷附件 `type` 的邏輯。全部透過既有的 `httpFetch_` 接縫,不直接碰
`UrlFetchApp`。

**Blocked by:** None — can start immediately(沿用 ticket 01/gas-supabase-backend
已經定案的 `httpFetch_`)

**Status:** done

- [x] `storageUpload_(bucket, path, bytes, mimeType)` 對
      `{SUPABASE_URL}/storage/v1/object/{bucket}/{path}` 送出 POST,帶
      `apikey`/`Authorization: Bearer`/`Content-Type`(用傳入的 `mimeType`)標頭,
      body 為傳入的 bytes。
- [x] `storageUpload_` 面對 4xx/5xx 回應會 throw,錯誤訊息包含狀態碼與回應內容。
- [x] `storageDelete_(bucket, path)` 對相同端點格式送出 DELETE;4xx/5xx 同樣 throw。
- [x] `storageUpload_`/`storageDelete_` 都是透過 `httpFetch_` 呼叫,專案裡沒有新增
      任何直接呼叫 `UrlFetchApp` 的地方。
- [x] `detectAttachmentType_(fileName)` 對照(副檔名大小寫不敏感):
      `png/jpg/jpeg/gif/webp/svg` → `photo`、`zip` → `zip`、`md` → `md_file`、
      `doc/docx/xls/xlsx/ppt/pptx` → `office_doc`、`pdf` → `pdf`、
      `odt/ods/odp` → `odf_doc`。
- [x] `detectAttachmentType_` 對不在上述清單的副檔名(含完全沒有副檔名的檔名)一律
      回傳 `code`,不拋錯。
- [x] 用假的 `httpFetch_` 寫測試涵蓋:上傳成功送出正確請求;上傳/刪除面對錯誤回應
      會 throw;型別判斷涵蓋每一類已知副檔名 + 至少一個未知副檔名的情境。
