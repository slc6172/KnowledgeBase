const fs = require("fs");
const path = require("path");

/**
 * marked.parse() 的結果曾經直接指定給 innerHTML,Markdown 允許內嵌原生
 * HTML,內容裡的可執行內容會被原樣執行(細節見 README 已知問題修復紀錄)。
 * 這個測試不走 loadGas/global,直接讀原始碼文字比對,確保:
 * 1. 不會再有「marked.parse 的結果直接指定給 innerHTML」這種舊的、有問題的
 *    寫法。
 * 2. 三個已知的呼叫點(文章內文、md 附件預覽、AI 問答回答)都先經過消毒再
 *    指定給 innerHTML。
 * 3. Index.html 有載入消毒函式庫。
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

  test("JavaScript.html sanitizes markdown at all three known render sites", () => {
    const sanitizedCalls = javaScriptHtml.match(
      /DOMPurify\.sanitize\(\s*marked\.parse\(/g
    );
    expect(sanitizedCalls).not.toBeNull();
    expect(sanitizedCalls.length).toBe(3);
  });
});
