# 02 — 套用到批次加標籤面板

**What to build:** 批次操作的 `batch-tag-input` 換成呼叫 01 建好的
`buildTagPicker(..., { mode: 'edit' })`,拿掉原本手刻、跟編輯頁各自獨立的輸入
邏輯,兩處共用同一份元件程式碼。

**Blocked by:** 01 — 共用標籤選取元件 + 套用到文章編輯頁

**Status:** ready-for-agent

- [ ] `batch-tag-input` 改呼叫 `buildTagPicker(container, { mode: 'edit',
      onChange: ... })`,`onChange` 接回原本組陣列送給
      `runProtected('batchAddTagsToArticles', [articleIds, tagNames], ...)`
      的既有邏輯——**不修改** `Articles.gs` 的 `batchAddTagsToArticles`,這張
      票純粹是換前端呼叫的輸入元件。
- [ ] 展開清單瀏覽/勾選、打字建立新標籤兩種方式在批次面板都要能用,行為跟
      文章編輯頁一致(同一顆元件)。
- [ ] `node --check` 驗證 `JavaScript.html` 語法通過。
- [ ] 手動驗收:批次選取多篇文章、用展開清單勾選一個既有標籤 + 打字建立一個
      新標籤,套用後確認所有選取的文章都正確加上這兩個標籤,`Articles.gs`
      既有的 `batchAddTagsToArticles` 行為(重複標籤不會造成錯誤等)不受
      影響。
