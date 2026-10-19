# 02 — 附件 Storage 路徑只接受安全字元,並逐段編碼

**What to build:** 上傳附件時,Storage 物件鍵一定是乾淨的 `{文章 UUID}/{uuid}[.副檔名]`。(F-06)
副檔名只接受 1–10 個英數字元,其他任何情況(含特殊字元、空白、非 ASCII、超長)一律當成「沒有副檔名」,
不擋使用者上傳;`articleId` 必須是 UUID 格式,否則在送出任何請求之前就拒絕;所有 Storage 呼叫把路徑
每一段做 URL 編碼後再組進網址。使用者看到的行為:正常檔案不受影響,檔名再怪也能上傳(原始檔名仍完整
保留在資料庫 `file_name`)。

**Blocked by:** None — can start immediately

**Status:** done

**接縫:** GAS 端 `httpFetch_`(檢查送出請求的網址與寫進資料庫的 `file_path`)。

- [x] 檔名 `報告.pdf`、`a.tar.gz`、`photo.PNG` → 物件鍵副檔名分別為 `pdf`、`gz`、`PNG`,`file_path` 與實際送出的網址一致
- [x] 副檔名含 `?`、`#`、`/`、空白、`%`、非 ASCII,或長度超過 10 → 當成無副檔名,網址與 `file_path` 都只有 `{articleId}/{uuid}`
- [x] `articleId` 不是 UUID(含 `..`、含 `?`、空字串)→ 丟出明確錯誤,不送出任何 Storage 請求、不寫資料庫
- [x] `storageUpload_` / `storageDelete_` / `storageDownload_` / 簽名網址產生:路徑中的特殊字元被編碼,斜線只出現在段與段之間
- [x] 類型偵測(`detectAttachmentType_`)與上傳 content-type 判斷使用同一個副檔名函式,行為與現況相同
- [x] 既有附件測試不需修改斷言即通過(只有新增案例)

> **實作註記:** (1) 原驗收寫「既有附件測試不需修改斷言即通過」。加入 UUID 驗證後,既有上傳測試與 `Auth.test.js` 的上傳
> 分派案例原本用的 `"a1"` 不是合法的文章 id,所以**輸入**換成 UUID(斷言語意不變,只是字串跟著換);先換輸入並確認全綠,
> 才寫新行為的紅燈測試。(2) `fileExtension_` 從 `Attachments.gs` 搬到 `AttachmentTypes.gs`,並讓 `detectAttachmentType_`、
> `resolveUploadContentType_` 共用——原本三處各自用 `split('.').pop()`。(3) 只有開頭一個點的檔名(`.hidden`)視為無副檔名
> (Unix dotfile 慣例);副檔名保留原本大小寫(`photo.PNG` → `.PNG`),類型與 content-type 比對時才轉小寫。
> (4) 只改 `uploadAttachmentFile_` 做 UUID 驗證;`addAttachmentUrl_`、`createFolder_` 的 articleId 走 JSON body / query、
> 不進路徑,資料庫的 uuid 欄位本來就會拒絕。
