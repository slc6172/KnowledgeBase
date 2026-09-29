# Spec：附件上傳改為單次多選檔案

**Triage label**：`ready-for-agent`

**來源**：`/grill-me` 設計討論,使用者要求把附件上傳從單次單選檔案改成單次多選檔案,且多選時
所有檔案共用同一次資料夾設定。

## Problem Statement

現有附件上傳的檔案輸入元素(`<input type="file">`)沒有 `multiple` 屬性,一次只能選一個檔案。
使用者要為一篇文章一次附上多個檔案時,必須重複「選檔案 → 點上傳 → 等完成」好幾輪,尤其是要把
多個檔案歸進同一個資料夾時,每一輪都要重新輸入/選擇同一個資料夾名稱,體驗繁瑣。原始
`spec_attachment_upload.md` 當時把批次上傳明列為 Out of Scope,這次補上。

## Solution

檔案輸入元素加上 `multiple` 屬性。選取多個檔案後,先比照現有單檔案流程解析一次資料夾(既有的
`resolveFolderId` 完全不用改,本來就是在送出上傳前解析一次),解析出的 `folderId` 整批共用。
接著**依序**(不平行)對每個檔案各自呼叫一次既有的 `uploadAttachmentFile`——後端函式簽章與行為
完全不變,不新增任何後端批次函式。單一檔案失敗不會中止整批,全部跑完後用一則總結訊息告訴使用者
成功/失敗的檔案數與各自原因。一次最多接受 20 個檔案,超過在前端直接擋下、不送出任何請求。

## User Stories

1. As a knowledge-base user, I want to select multiple files at once for an article's
   attachments, so I don't have to repeat the whole select-and-upload cycle for every
   single file.
2. As a knowledge-base user, I want all files in one multi-file selection to be assigned
   to the same folder (the one I typed/picked before uploading), so I don't have to
   re-enter or re-pick the folder for every file.
3. As a knowledge-base user, I want files to still land in 未分類 together (no
   `folder_id`) if I didn't type a folder name, matching today's single-file behavior.
4. As a knowledge-base user, I want one file's upload failure (too large, transient
   error, etc.) to not stop the rest of the batch from being tried, so a single bad file
   doesn't cost me the other successful uploads.
5. As a knowledge-base user, I want a clear summary after a multi-file upload finishes,
   telling me how many succeeded and, for each failure, which file and why, so I know
   exactly what to retry.
6. As a knowledge-base user, I want to still be able to select just one file (multi-select
   doesn't force multiple), so the existing single-file workflow doesn't regress.
7. As a knowledge-base user, I want a clear error if I select more than 20 files at once,
   shown before anything is uploaded, so I know to split into smaller batches rather than
   having some files silently skipped.
8. As a knowledge-base user, I want to see upload progress (e.g. "上傳中…(2/5)") while a
   multi-file batch is running, so I know it's working and roughly how far along it is.
9. As a developer, I want the existing per-file size limit
   (`ATTACHMENT_UPLOAD_MAX_BYTES_`) and content-type detection to keep working unchanged
   for each file in a batch, so multi-file upload doesn't bypass any existing validation.
10. As a developer, I want the backend `uploadAttachmentFile_` function to remain
    completely untouched, so the well-tested single-file path (and its established
    ~50MB `google.script.run` payload ceiling) isn't put at risk by cramming multiple
    files' base64 payloads into one call.
11. As a developer, I want the password prompt to still only appear once per batch (not
    once per file), so uploading 10 files doesn't mean 10 password prompts.

## Implementation Decisions

- 檔案輸入元素(`attachment-panel-file-input`)加上 `multiple` 屬性,`fileInput.files` 從
  單一檔案變成 `FileList`。
- 新增一個前端常數(`ATTACHMENT_UPLOAD_BATCH_MAX_FILES_ = 20`),上傳前先檢查
  `fileInput.files.length`,超過就顯示錯誤、不做任何後續動作(不解析資料夾、不呼叫任何
  `google.script.run`)。
- 資料夾解析維持現狀——`resolveFolderId` 在整批開始前呼叫一次,解析出的 `folderId` 重複用在
  這一批所有檔案的 `uploadAttachmentFile` 呼叫上,不對每個檔案各自解析。
- 依序(一次一個)呼叫既有的 `uploadAttachmentFile`(透過 `runProtected`,不新增任何後端
  函式,`uploadAttachmentFile_` 簽章與行為完全不變)——等上一個檔案有結果(成功或失敗)才開始
  下一個。這樣可以避免密碼還沒快取時多個檔案同時觸發密碼輸入框的競態,也讓「上傳中(N/M)」這種
  進度文字天然好維護。
- 單一檔案失敗不中止整批,收集每個檔案的結果(成功/失敗 + 失敗訊息),全部跑完後統一顯示一個
  總結 toast:全部成功時維持既有的「已上傳」訊息風格(檔案數 >1 時改成「已上傳 N 個檔案」);
  有失敗時列出失敗的檔名與錯誤訊息(錯誤訊息本身已經是後端轉換過的安全通用訊息,不需要額外
  處理),例如「已上傳 3 個檔案,1 個失敗:big.zip(資料服務暫時發生問題,請稍後再試。)」。
- 上傳按鈕在整個批次執行期間維持 disabled,文字顯示「上傳中…(目前進度/總數)」,跟現有單檔案
  「上傳中…」的視覺風格一致,只是多了進度數字。
- 整批結束後(不論成功失敗),重設 `fileInput.value`、重設資料夾輸入框,並呼叫一次
  `refresh()` 重新整理附件清單(不是每個檔案各自 refresh 一次,避免多次重複的列表重繪)。

## Testing Decisions

- 後端完全沒有變動,不需要新增/修改任何 `.gs` 檔案或對應測試——這次的邊界完全在前端。
- 前端測試延續專案現有的**靜態文字掃描**慣例(抽取函式主體、比對呼叫順序或關鍵字是否出現,
  不是真的 DOM/瀏覽器行為模擬),參考 `ArticleEditorResetOrdering.test.js`/
  `DestructiveActionConfirmation.test.js` 這類寫法。
- 關鍵情境:
  1. file input 元素有 `multiple` 屬性。
  2. 選取檔案數超過批次上限時,在呼叫任何 `google.script.run`/`resolveFolderId` 之前就先擋
     下並顯示錯誤。
  3. 資料夾解析(`resolveFolderId`)在整批上傳流程裡只呼叫一次,不是每個檔案各自呼叫一次。
  4. `uploadAttachmentFile` 依序呼叫(等前一個檔案有結果才呼叫下一個),不是同時平行送出。
  5. 單一檔案失敗後,批次仍會繼續處理其餘檔案(不會提早中止迴圈)。
  6. 整批結束後只呼叫一次 `refresh()`,不是每個檔案各自呼叫。

## Out of Scope

- 拖拉上傳(drag and drop)——現有 UI 是點擊選取,這次不新增拖放區。
- 每個檔案各自的即時進度列——維持整體「上傳中(N/M)」的輕量回饋,不做逐檔案的視覺化進度。
- 批次總大小上限(所有檔案加總的位元組數)——既有的單檔案 20MB 上限不變,批次上傳因為是逐
  檔案各自呼叫,不會有把多檔案塞進同一次呼叫而超過平台 50MB 上限的風險,不需要額外的總量上限。
- 後端批次上傳函式——見上面 Implementation Decisions,刻意維持後端單檔案函式不變。
- 同一批次裡多個檔案分別歸進不同資料夾——這次維持「一批只對應一個資料夾(或都不分類)」,跟
  一次只能選一個資料夾的既有 UI 一致。

## Further Notes

- 原始 `spec_attachment_upload.md` 的 Out of Scope 明列「批次刪除/批次上傳」,這份 spec 補上
  批次**上傳**的部分(批次刪除是文章層級的既有功能,跟這裡的附件批次上傳是不同東西,不受影響,
  已在 `spec_attachment_upload.md` 補上對應的 Further Notes 更正說明)。
- 決策脈絡:選擇前端迴圈而不是新增後端批次函式,關鍵依據是既有程式碼裡
  `uploadAttachmentFile_` 上方註解記載的 `google.script.run` 單次呼叫約 50MB payload
  上限——如果之後想改成後端批次函式,務必先重新檢視這個限制會不會被多檔案的 base64 payload
  加總打穿。
- 密碼快取(`cachedWritePassword`)搭配「整批依序執行」是刻意的搭配——如果未來想把批次改成
  平行送出以加快速度,要先解決「密碼還沒快取時可能同時觸發多個密碼輸入框」這個競態,不能只是
  把迴圈改成平行送出就沒事。
- **擁有者部署後實測確認,多檔案上傳功能沒有任何異常。**
