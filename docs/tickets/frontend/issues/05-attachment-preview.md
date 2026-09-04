# 05 — 附件線上預覽渲染

**What to build:** 把前一張票「檔名 + 下載連結」的通用附件呈現,換成 DESIGN.md
3.1 節設計的四種真正線上預覽,分別串上已完成的 `getSignedAttachmentUrl`/
`getTextAttachmentContent`。

**Blocked by:** 04 — 文章詳情 + 附件上傳/列表/刪除

**Status:** done

**驗收方式:** 部署後手動操作、對照下列具體行為(建議手動上傳每一種型別的檔案
各一個來驗收)。

- [x] `type='photo'` 的附件:呼叫 `getSignedAttachmentUrl(id)`,把回傳的簽名
      URL 當 `<img src="...">`,畫面上看得到縮圖。
- [x] `type='pdf'` 的附件:呼叫 `getSignedAttachmentUrl(id)`,嵌入
      `<iframe src="...">`,畫面上用瀏覽器原生 PDF 檢視器看得到內容。
- [x] `type='office_doc'` 的附件:呼叫 `getSignedAttachmentUrl(id)`,把回傳的
      URL 包成
      `https://docs.google.com/viewer?url={encodeURIComponent(signedUrl)}&embedded=true`
      塞進 `<iframe>`,畫面上看得到 Google Docs Viewer 渲染的內容。
- [x] `type='code'` 的附件:呼叫 `getTextAttachmentContent(id)`,回傳的純文字
      用 `hljs.highlightElement()` 做語法高亮渲染(依副檔名或內容自動判斷語言,
      沒把握判斷正確也沒關係,hljs 有自動偵測)。
- [x] `type='md_file'` 的附件:呼叫 `getTextAttachmentContent(id)`,回傳的純
      文字用 `marked.parse()` 渲染成 HTML 顯示(跟文章本文用同一套 marked.js
      設定)。
- [x] `type='zip'`/`type='odf_doc'`/`type='url'` 的附件:維持上一張票「檔名/
      連結 + 下載連結」的呈現,不呼叫任何預覽函式(對應 DESIGN.md 3.1 節「無
      線上預覽」的決定)。
- [x] `getTextAttachmentContent` 因檔案過大(超過 1MB)或型別不支援而丟出的
      後端錯誤,畫面上顯示清楚訊息(如「檔案過大,請下載」),不是顯示一片
      空白或未處理的錯誤堆疊。
- [x] `getSignedAttachmentUrl`/`getTextAttachmentContent` 的呼叫只在使用者展開
      /檢視該附件時才觸發(例如點開一個折疊區塊),不是列表一渲染出來就對
      每筆附件都預先呼叫一次——避免文章附件一多,進入詳情頁就要打一大串簽名
      URL/下載請求。
