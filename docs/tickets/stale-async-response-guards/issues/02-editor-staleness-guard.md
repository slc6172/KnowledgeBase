# 02 — 編輯器防過期 + 載入期間鎖住儲存按鈕

**What to build:** `openArticleEditor` 把 `editingArticleId = articleId` 從成功回呼移到函式
最開頭(`google.script.run` 呼叫之前)同步設定。成功回呼套用表單填值之前,檢查
`editingArticleId === articleId`(這裡的 `articleId` 是呼叫 `openArticleEditor` 當下傳入的
參數,透過閉包捕捉,不是回應資料裡的 `article.id`),不等就直接 `return`。同時在函式最開頭呼叫
`setEditorBusy(true)`,成功與失敗回呼都呼叫 `setEditorBusy(false)`(失敗回呼原本只有
`showError`,補上 `setEditorBusy(false)`)。

**Blocked by:** None — can start immediately

**Status:** done

- [x] 模擬 `openArticleEditor(A)` 期間使用者點了「新增文章」(呼叫 `resetEditorForm()`),
      接著 A 的回應才抵達,驗證 `editingArticleId` 維持 `null`、表單欄位維持空白(不是被 A 的
      資料填回來)
- [x] 模擬 `openArticleEditor(A)` 接著立刻 `openArticleEditor(B)`(B 比 A 快抵達),驗證
      最終表單顯示、`editingArticleId` 都對應 B,不是 A
- [x] 驗證 `openArticleEditor` 呼叫當下(同步,不用等任何回應)儲存/發布按鈕就已經是
      disabled,回應抵達(不論成功或失敗)後才解除
- [x] 正常情況(沒有競態,回應依序抵達)行為不變
- [x] 完整測試套件(`npm test`)全數通過
