const fs = require("fs");
const path = require("path");

/**
 * marked.parse() 的結果曾經直接指定給 innerHTML,Markdown 允許內嵌原生
 * HTML,內容裡的可執行內容會被原樣執行(細節見 README 已知問題修復紀錄)。
 * 這個測試不走 loadGas/global,直接讀原始碼文字比對,確保:
 * 1. 不會再有「marked.parse 的結果直接指定給 innerHTML」這種舊的、有問題的
 *    寫法。
 * 2. Index.html 有載入消毒函式庫。
 *
 * 「四個已知的呼叫點都有經過消毒」這件事,原本這裡有第三個斷言用數
 * `DOMPurify.sanitize(marked.parse(` 出現次數的方式檢查——mycr F-02 修正
 * (docs/specs/spec_markdown_sanitization_hardening.md)把四個呼叫點合併成
 * 共用的 renderMarkdownSafe_ 函式之後,這種數字串次數的檢查沒辦法逐站點
 * 漸進式遷移(改一個站點就會讓次數不對,不是等四個都改完才會發現),已經
 * 移除;逐站點的檢查現在累積在 test/MarkdownSanitizationBehavior.test.js
 * 的「mycr F-02 fix: every known render site routes through
 * renderMarkdownSafe_」這個區塊裡,隨著每個呼叫點遷移完成而新增。
 */

describe("markdown rendered into innerHTML is sanitized first", () => {
  const indexHtml = fs.readFileSync(
    path.join(__dirname, "../src/Index.html"),
    "utf8"
  );
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );

  test("Index.html loads the DOMPurify library", () => {
    expect(indexHtml).toMatch(/dompurify/i);
  });

  test("JavaScript.html no longer assigns marked.parse(...) straight to innerHTML", () => {
    expect(javaScriptHtml).not.toMatch(/\.innerHTML\s*=\s*marked\.parse\(/);
  });
});
