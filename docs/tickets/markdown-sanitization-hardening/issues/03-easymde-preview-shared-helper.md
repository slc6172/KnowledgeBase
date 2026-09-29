# 03 — EasyMDE 編輯器 preview 套用共用消毒函式

**What to build:** `initEasyMDE` 裡覆寫的 `previewRender` 改叫 `renderMarkdownSafe_(plainText)`,
不再直接呼叫 `DOMPurify.sanitize(marked.parse(...))`。`test/EasyMdePreviewSanitization.test.js`
現有斷言「`previewRender` 裡 `DOMPurify.sanitize(` 包住 `marked.parse(`」改成斷言「`previewRender`
呼叫 `renderMarkdownSafe_(...)`」,維持同一個保障(這個渲染點不會退回 EasyMDE 自己未消毒的預設
行為)。

**Blocked by:** 01(重用它引入的 `renderMarkdownSafe_`)

**Status:** done

- [x] `previewRender` 改叫 `renderMarkdownSafe_`
- [x] `test/EasyMdePreviewSanitization.test.js` 的斷言改成檢查呼叫 `renderMarkdownSafe_`,
      而不是檢查 `DOMPurify.sanitize(`/`marked.parse(` 的巢狀順序
- [x] 驗證標準設定同一批 payload 在這個渲染點也會被擋下
- [x] 完整測試套件(`npm test`)全數通過
