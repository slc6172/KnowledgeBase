# 03 — 資料夾改名/刪除

**What to build:** `Attachments.gs` 新增 `renameFolder`/`deleteFolder`,
02 建好的分組區塊標題旁加一個小選單(改名/刪除資料夾)。刪除資料夾時只解散
分組,裡面的附件變回未分類,**不**連帶刪除附件。

**Blocked by:** 02 — 附件面板依資料夾分組顯示(小選單掛在分組區塊標題上)

**Status:** ready-for-agent

- [ ] `Attachments.gs` 新增 `renameFolder(folderId, newName)`:
      `supabaseUpdate('attachment_folders', 'id=eq.' + folderId, { name:
      newName })`,回傳更新後的列。
- [ ] `Attachments.gs` 新增 `deleteFolder(folderId)`:`supabaseDelete(
      'attachment_folders', 'id=eq.' + folderId)`,回傳 `{ deleted: true,
      id: folderId }`——**不**手動處理裡面的附件,依賴 schema 的
      `on delete set null` 讓 DB 自動把附件的 `folder_id` 清成 `null`。
- [ ] `Auth.gs` 白名單新增 `renameFolder`、`deleteFolder`(白名單從 18 筆
      〔含 01 新增的 `createFolder`〕變成 20 筆)。
- [ ] 分組區塊標題旁的小選單提供「改名」「刪除資料夾」,互動模式比照
      `TagManagerView` 的 view row 小動作按鈕。「未分類」這個虛擬分組
      **不**顯示這個選單(它不對應真實的 `attachment_folders` 列)。
- [ ] 用假的 `httpFetch_` 寫測試(擴充 `test/Attachments.test.js`):
      1. `renameFolder`/`deleteFolder` 送出正確的 PATCH/DELETE 請求跟回傳值,
         比照 `test/Tags.test.js` 的 `renameTag`/`deleteTag` 測試風格。
      2. `Auth.gs`:兩個新函式都能透過 `callProtected` 正確轉呼叫。
- [ ] 手動驗收:改名一個資料夾、確認附件面板正確顯示新名稱;刪除一個資料夾、
      確認裡面的附件還在、變回未分類分組,不是被一起刪除。
