# 05 — 刪除流程的孤兒檔案記錄 + CI 衛生 + 移除過期預覽檔

**What to build:** (F-15)`deleteArticle_` 刪 Storage 檔案失敗時,不再靜默吞掉:寫一行日誌,內容
含附件的 `file_path`(方便事後手動清理孤兒檔案),但仍不中斷整個刪除流程。(F-17)CI 的 job 加
`timeout-minutes`、`setup-node` 啟用 npm 快取;`CLAUDE.md` 註明 ES5 風格的 `var` 是刻意慣例、不要遷移。
同時刪除早已過期的 `docs/preview/Preview.html`(舊快照、載入未鎖版本且無 SRI 的 CDN),並清掉文件裡
所有對它的指向。使用者看到的行為:刪文章流程不變。

**Blocked by:** None — can start immediately

**Status:** done

**接縫:** GAS 端 `httpFetch_` + `Logger.log` 假實作(刪除流程);靜態文字掃描(CI 設定、文件不再指向已刪除的檔案)。

- [x] 某個附件的 Storage 刪除回 5xx:文章仍被刪除、回傳 `{ deleted: true }`、日誌含該附件的 `file_path`;其他附件照常刪除
- [x] 日誌不含密鑰、不含檔案內容
- [x] 全部 Storage 刪除成功時不寫任何孤兒檔案日誌
- [x] `.github/workflows/test.yml` 有 `timeout-minutes`,`setup-node` 有 `cache: npm`,且 action 仍以 commit SHA 固定
- [x] `docs/preview/` 不存在;README、CLAUDE.md、DESIGN.md 與任何測試都不再指向 `Preview.html`
- [x] `CLAUDE.md` 說明 `var` 是刻意慣例

> **實作註記:** (1) 日誌內容與 `uploadAttachmentFile_` 補償清理失敗的格式一致(含路徑與上游錯誤訊息,不含密鑰、不含檔案內容)。
> `deleteAttachment_` 的刪除順序**沒有動**(行為改動,依先前討論只補日誌)。(2) 刪除 `docs/preview/Preview.html` 時,
> 連同只為它存在的 `test/PreviewMarkdownSanitization.test.js` 一併刪除;真正的 Markdown 消毒行為仍由
> `MarkdownSanitizationBehavior.test.js` 守護。歷史文件(各 spec、票、README 變更紀錄、舊 mycr 報告)裡對它的提及是當時的紀錄,
> 保留不改。(3) `var` 慣例寫進 `CLAUDE.md` 的「GAS 程式慣例」。
