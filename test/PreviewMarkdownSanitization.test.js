const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

/**
 * mycr F-11 修正:docs/preview/Preview.html(本機開發輔助工具,不是部署
 * 檔案)原本把 marked.parse() 的結果直接指定給 innerHTML,完全沒有消毒。
 * 同一套「抓原始碼、在 jsdom 裡真的載入 marked/DOMPurify 的 UMD/browser
 * bundle、在 vm 沙箱裡執行」的技巧(見
 * test/MarkdownSanitizationBehavior.test.js),這次驗證的是 Preview.html
 * 自己的 renderMarkdownSafe_。
 */

const previewHtml = fs.readFileSync(
  path.join(__dirname, "../docs/preview/Preview.html"),
  "utf8"
);
const markedUmdSource = fs.readFileSync(
  path.join(__dirname, "../node_modules/marked/lib/marked.umd.js"),
  "utf8"
);
const dompurifySource = fs.readFileSync(
  path.join(__dirname, "../node_modules/dompurify/dist/purify.min.js"),
  "utf8"
);

function extractDeclaration(varName) {
  const startMatch = previewHtml.match(new RegExp("var\\s+" + varName + "\\s*=\\s*\\{"));
  if (!startMatch) return null;
  const braceStart = startMatch.index + startMatch[0].length - 1;
  let depth = 1;
  let i = braceStart + 1;
  while (depth > 0 && i < previewHtml.length) {
    if (previewHtml[i] === "{") depth++;
    else if (previewHtml[i] === "}") depth--;
    i++;
  }
  return previewHtml.slice(startMatch.index, i) + ";";
}

function extractFunction(fnName) {
  const startMatch = previewHtml.match(
    new RegExp("function\\s+" + fnName + "\\s*\\([^)]*\\)\\s*\\{")
  );
  if (!startMatch) return null;
  let depth = 1;
  let i = startMatch.index + startMatch[0].length;
  while (depth > 0 && i < previewHtml.length) {
    if (previewHtml[i] === "{") depth++;
    else if (previewHtml[i] === "}") depth--;
    i++;
  }
  return previewHtml.slice(startMatch.index, i);
}

function buildSandbox() {
  const dom = new JSDOM("", { url: "https://example.com/" });
  const context = { window: dom.window };
  vm.createContext(context);
  vm.runInContext(markedUmdSource, context);
  vm.runInContext(dompurifySource, context);
  const source = [
    extractDeclaration("MD_SANITIZE_CONFIG_"),
    extractFunction("renderMarkdownSafe_")
  ]
    .filter(Boolean)
    .join("\n\n");
  vm.runInContext(source, context);
  return context;
}

describe("mycr F-11 fix: docs/preview/Preview.html sanitizes markdown before rendering it", () => {
  test("MD_SANITIZE_CONFIG_ and renderMarkdownSafe_ are both present", () => {
    const sandbox = buildSandbox();
    expect(sandbox.MD_SANITIZE_CONFIG_).toBeDefined();
    expect(typeof sandbox.renderMarkdownSafe_).toBe("function");
  });

  test("strips a password-collecting form (same standard profile as src/JavaScript.html)", () => {
    const sandbox = buildSandbox();
    const html = sandbox.renderMarkdownSafe_(
      '<form action="https://evil.example"><input type="password"></form>'
    );
    expect(html).not.toMatch(/<form/i);
  });

  test("leaves normal markdown intact", () => {
    const sandbox = buildSandbox();
    const html = sandbox.renderMarkdownSafe_("# Title\n\n**bold**");
    expect(html).toMatch(/<h1>Title<\/h1>/);
    expect(html).toMatch(/<strong>bold<\/strong>/);
  });

  test("both known render sites (article detail, md attachment preview) call renderMarkdownSafe_, not marked.parse directly into innerHTML", () => {
    expect(previewHtml).not.toMatch(/\.innerHTML\s*=\s*marked\.parse\(/);
    const detailMatch = previewHtml.match(
      /getElementById\('detail-content'\)\.innerHTML\s*=\s*([^;]+);/
    );
    expect(detailMatch).not.toBeNull();
    expect(detailMatch[1]).toMatch(/renderMarkdownSafe_\(/);

    const mdPreviewMatch = previewHtml.match(/mdDiv\.innerHTML\s*=\s*([^;]+);/);
    expect(mdPreviewMatch).not.toBeNull();
    expect(mdPreviewMatch[1]).toMatch(/renderMarkdownSafe_\(/);
  });
});
