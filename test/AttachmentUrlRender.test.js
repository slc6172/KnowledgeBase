const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

/**
 * mycr F-12:URL 型附件在「渲染」時也要檢查協定。
 *
 * 寫入時已經有兩道檢查(前端 isSafeAttachmentUrl_、後端 addAttachmentUrl_),
 * 但渲染端原本直接把資料庫裡的值指定給 <a href>。現況資料只能經由後端寫入,
 * 所以不可利用;這裡補的是縱深防禦——資料庫裡若出現 javascript: / data: 之類
 * 的值(舊資料、手動改庫、未來新增的寫入路徑忘了驗證),畫面上也不會變成可點擊的連結。
 *
 * 沿用既有技巧:從 JavaScript.html 抓出函式原始碼,在 jsdom 裡真的執行。
 * buildAttachmentItemEl 的其餘依賴以最小假實作代替。
 */

const javaScriptHtml = fs.readFileSync(path.join(__dirname, "../src/JavaScript.html"), "utf8");

function extractFunction(fnName) {
  const startMatch = javaScriptHtml.match(new RegExp("function\\s+" + fnName + "\\s*\\([^)]*\\)\\s*\\{"));
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
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const context = {
    document: dom.window.document,
    PREVIEWABLE_TYPES: [],
    formatFileSize: (n) => n + " B",
    toggleAttachmentPreview: () => {},
    runProtected: () => {},
    refresh: () => {},
    showError: () => {}
  };
  vm.createContext(context);
  const source = ["isSafeAttachmentUrl_", "buildAttachmentItemEl"].map(extractFunction).filter(Boolean).join("\n\n");
  vm.runInContext(source, context);
  return context;
}

const urlAtt = (url, fileName) => ({ id: "att1", type: "url", url, file_name: fileName });

describe("buildAttachmentItemEl: URL attachments (mycr F-12)", () => {
  test("an https URL renders as a link that opens in a new tab with noopener noreferrer", () => {
    const sb = buildSandbox();
    const el = sb.buildAttachmentItemEl(urlAtt("https://example.com/doc", "範例文件"));
    const link = el.querySelector("a");

    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("https://example.com/doc");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toBe("範例文件");
  });

  test("an http URL is still a link (plain web links are allowed)", () => {
    const sb = buildSandbox();
    const el = sb.buildAttachmentItemEl(urlAtt("http://example.com/", null));
    expect(el.querySelector("a")).not.toBeNull();
  });

  test.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    " https://leading-space.example.com",
    "//example.com/protocol-relative",
    "file:///etc/passwd"
  ])("a stored value that is not an http(s) URL (%s) is shown as plain text, never as a link", (badUrl) => {
    const sb = buildSandbox();
    const el = sb.buildAttachmentItemEl(urlAtt(badUrl, "可疑連結"));

    expect(el.querySelector("a")).toBeNull();
    expect(el.querySelector("[href]")).toBeNull();
    // 仍然要看得到這筆附件(擁有者才知道要去清掉),而且是純文字
    expect(el.textContent).toContain("可疑連結");
  });

  test("with no file_name the unsafe URL itself is displayed as text (still not a link)", () => {
    const sb = buildSandbox();
    const el = sb.buildAttachmentItemEl(urlAtt("javascript:alert(1)", null));

    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toContain("javascript:alert(1)");
  });
});
