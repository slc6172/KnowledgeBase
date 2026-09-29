const { loadGas } = require("./helpers/loadGas");
const { fakeHtmlService } = require("./helpers/testSetup");

beforeEach(() => {
  fakeHtmlService();
  loadGas("../../src/WebApp.gs");
});

describe("include", () => {
  test("returns the content of each whitelisted file actually used by Index.html's scriptlets", () => {
    INCLUDABLE_FILES_.forEach((filename) => {
      expect(include(filename)).toBe("content:" + filename);
    });
  });

  test("mycr finding: rejects a filename outside the whitelist instead of passing it straight to HtmlService, so google.script.run.include(...) can't be used to fetch an arbitrary project file", () => {
    expect(() => include("Index")).toThrow(/不支援的檔案/);
    expect(() => include("../SecretFile")).toThrow(/不支援的檔案/);
    expect(() => include("")).toThrow(/不支援的檔案/);
  });
});

describe("doGet", () => {
  // mycr finding(2026-09,jest --coverage 找出來的):doGet 本身一直沒有任何
  // 測試覆蓋——share-link/01 那個 bug 修好之後,只補了針對 Index.html/
  // JavaScript.html 原始碼的靜態文字掃描測試(見
  // ShareLinkOutputEscaping.test.js),從來沒有真的呼叫過 doGet() 驗證
  // e.parameter.article 那一串 null-safety 串接本身的行為。

  test("reads the article id from e.parameter.article and puts it on the template", () => {
    const result = doGet({ parameter: { article: "abc-123" } });
    expect(result.__template.initialArticleId).toBe("abc-123");
    expect(result.__template.__filename).toBe("Index");
  });

  test("falls back to an empty string (not the literal string 'null'/'undefined') when e, e.parameter, or e.parameter.article is missing", () => {
    expect(doGet({ parameter: {} }).__template.initialArticleId).toBe("");
    expect(doGet({}).__template.initialArticleId).toBe("");
    expect(doGet(undefined).__template.initialArticleId).toBe("");
  });

  test("sets the page title and viewport meta tag", () => {
    const result = doGet({});
    expect(result.__title).toBe("知識庫");
    expect(result.__metaTags).toContainEqual([
      "viewport",
      "width=device-width, initial-scale=1"
    ]);
  });
});

describe("getWebAppUrl", () => {
  // mycr finding(2026-09):跟 doGet 一樣,之前完全沒有測試覆蓋——雖然實作
  // 本身很單純(直接包一層 ScriptApp.getService().getUrl()),但既然是
  // PUBLIC_ALLOWLIST(PrivateFunctionExposure.test.js)裡明列的公開函式,
  // 還是值得留一個最基本的行為測試。
  test("returns whatever ScriptApp.getService().getUrl() returns", () => {
    global.ScriptApp = {
      getService: () => ({ getUrl: () => "https://script.google.com/macros/s/xxx/exec" })
    };
    expect(getWebAppUrl()).toBe("https://script.google.com/macros/s/xxx/exec");
  });
});
