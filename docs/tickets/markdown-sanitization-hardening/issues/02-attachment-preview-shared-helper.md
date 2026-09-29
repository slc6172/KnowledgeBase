# 02 — md 附件預覽套用共用消毒函式

**What to build:** md 附件預覽(`loadTextPreview` 裡 `mdDiv.innerHTML = ...` 那一行)改叫
`renderMarkdownSafe_(content)`,不再直接呼叫 `DOMPurify.sanitize(marked.parse(...))`。

**Blocked by:** 01(重用它引入的 `renderMarkdownSafe_`)

**Status:** done

- [x] md 附件預覽改叫 `renderMarkdownSafe_`
- [x] 驗證標準設定同一批 payload(收集密碼的 `<form>`、`<style>`、`style` 屬性)在這個渲染點
      也會被擋下
- [x] 完整測試套件(`npm test`)全數通過

(2026-09-22 實作時發現:既有 `test/MarkdownSanitization.test.js` 第三個斷言——數
`DOMPurify.sanitize(marked.parse(` 出現次數是否恰好 4 次——沒辦法逐站點漸進式遷移,
改一個站點就會讓次數不對,不是等 Ticket 5 規劃的「四個都做完才改」那個時間點才會發現。
這張票裡直接退場了那個斷言，逐站點的檢查改成累積在
`test/MarkdownSanitizationBehavior.test.js` 新增的「mycr F-02 fix: every known render
site routes through renderMarkdownSafe_」這個區塊裡，隨每張票同步新增。原本規劃給
Ticket 5 的工作範圍因此需要調整，見該票的更新。)
