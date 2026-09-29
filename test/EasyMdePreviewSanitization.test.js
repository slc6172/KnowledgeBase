const fs = require("fs");
const path = require("path");

/**
 * mycr finding(mycr-report-2026-09-20-unbiased-rescan.md Finding 1，High）：
 * EasyMDE 工具列保留了內建的 preview 按鈕，這個功能是函式庫自己內部用 Marked
 * 渲染的，預設不消毒（GitHub 官方安全公告 GHSA-85q9-7467-r53q）。文章編輯器
 * 不需要密碼就能打開（openArticleEditor 呼叫的是公開讀取函式 getArticle），
 * 等於任何匿名訪客都可能觸發這條路徑。
 *
 * 比照專案既有的前端測試方式（靜態文字掃描原始碼，不做真的 DOM/瀏覽器行為
 * 模擬），見 AttachmentMultiUpload.test.js 的 extractFunctionBody 寫法。
 */
describe("EasyMDE editor preview sanitization (JavaScript.html)", () => {
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );

  function extractFunctionBody(fnName) {
    const startMatch = javaScriptHtml.match(
      new RegExp("function\\s+" + fnName + "\\s*\\([^)]*\\)\\s*\\{")
    );
    if (!startMatch) return null;
    var start = startMatch.index + startMatch[0].length;
    var depth = 1;
    var i = start;
    while (depth > 0 && i < javaScriptHtml.length) {
      if (javaScriptHtml[i] === "{") depth++;
      else if (javaScriptHtml[i] === "}") depth--;
      i++;
    }
    return javaScriptHtml.slice(start, i - 1);
  }

  test("mycr finding: initEasyMDE overrides previewRender to route through the app's own sanitize-then-render pipeline, not EasyMDE's unsanitized default", () => {
    const body = extractFunctionBody("initEasyMDE");
    expect(body).not.toBeNull();

    expect(body).toEqual(expect.stringContaining("previewRender"));
    // mycr F-02 修正(docs/specs/spec_markdown_sanitization_hardening.md）：
    // 四個渲染點合併成共用的 renderMarkdownSafe_ 之後，這裡改成檢查
    // previewRender 呼叫這個共用函式——同一個保障（這個渲染點不會退回
    // EasyMDE 自己未消毒的預設行為），只是不再直接檢查 DOMPurify/marked
    // 的巢狀呼叫順序（那件事現在是 renderMarkdownSafe_ 自己的責任，見
    // test/MarkdownSanitizationBehavior.test.js）。
    expect(body).toEqual(expect.stringContaining("renderMarkdownSafe_("));
  });
});
