# 05 — 收尾:確認四個呼叫點都有測試涵蓋到、退場過時的靜態斷言

**（2026-09-22 計畫更新,實作 Ticket 02 時發現）**原本這張票規劃的工作是「等 Ticket 01–04
全部做完,一次把 `test/MarkdownSanitization.test.js` 第三個斷言改寫成檢查四個呼叫點」。
實作 Ticket 02 時發現這個順序有問題:那個斷言數的是「原始碼裡恰好出現 4 次
`DOMPurify.sanitize(marked.parse(` 這個字串」,這種全域式的計數沒辦法逐站點漸進式遷移——
改一個站點,字串出現次數就不對了,不是等四個都改完才會發現。所以那個斷言已經提前在 Ticket 02
退場(整段刪除,原因記在 Ticket 02 的內嵌註記裡),逐站點的檢查改成放進
`test/MarkdownSanitizationBehavior.test.js` 的「mycr F-02 fix: every known render site
routes through renderMarkdownSafe_」這個區塊,隨 Ticket 02(md 附件預覽)、03(EasyMDE
preview)、04(AI 回答)各自完成時同步新增各自的檢查。

**What to build:** 等 Ticket 01–04 全部完成後,確認 `test/MarkdownSanitizationBehavior.test.js`
的「mycr F-02 fix: every known render site routes through renderMarkdownSafe_」這個區塊裡,
四個已知呼叫點(文章內文、md 附件預覽、AI 問答回答、EasyMDE `previewRender`)都各自有一個
斷言,檢查它們呼叫的是 `renderMarkdownSafe_(...)`。如果哪個站點在對應的票裡漏了加,這裡補上;
如果四個都已經在各自的票裡加齊了,這張票就是純驗證、不需要再改程式碼。

**Blocked by:** 01、02、03、04(全部)

**Status:** done

- [x] 四個已知呼叫點各自都有一個斷言,檢查呼叫的是 `renderMarkdownSafe_(...)`,分散或集中在
      同一個 describe 區塊都可以,重點是四個都要有,不能漏
- [x] 完整測試套件(`npm test`)全數通過
