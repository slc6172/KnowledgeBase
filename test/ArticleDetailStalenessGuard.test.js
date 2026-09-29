const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

/**
 * mycr F-06 修正(docs/specs/spec_stale_async_response_guards.md）：
 * google.script.run 的每次呼叫是獨立執行，回應不保證依序抵達。這個檔案直接
 * 從 JavaScript.html 的原始碼文字裡抓出相關函式，在 jsdom 環境裡真的執行，
 * 用一個可以手動控制回應抵達順序的假 google.script.run，驗證「畫面最終
 * 顯示的內容」而不是只檢查程式碼裡有沒有某個 if 判斷式——這是這個 finding
 * 真正在意的事：使用者實際會看到什麼。
 *
 * openArticleDetail 本身還會呼叫 showView/mountAttachmentPanel，這兩個跟
 * 這張票要驗證的行為無關，用最簡單的 no-op 代替，不整份載入
 * JavaScript.html（那需要建出跟 Index.html 一樣的完整 DOM 結構跟
 * EasyMDE/highlight.js 等第三方函式庫，超出這張票的需要）。
 */

const javaScriptHtml = fs.readFileSync(
  path.join(__dirname, "../src/JavaScript.html"),
  "utf8"
);

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

function extractVarDeclaration(varName) {
  const m = javaScriptHtml.match(new RegExp("var\\s+" + varName + "\\s*=\\s*[^;]+;"));
  return m ? m[0] : null;
}

function buildSandbox() {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
      '<div id="detail-seal"></div>' +
      '<button id="btn-share-article" class=""></button>' +
      '<div id="detail-category"></div>' +
      '<div id="detail-updated"></div>' +
      '<div id="detail-title"></div>' +
      '<div id="detail-tags"></div>' +
      '<div id="detail-content"></div>' +
      '<div id="detail-related-articles" class="hidden"></div>' +
      '<div id="detail-related-articles-list"></div>' +
      '<div id="detail-attachment-panel"></div>' +
      '</body></html>'
  );

  var calls = []; // 記錄每次「假 google.script.run」呼叫，讓測試手動控制回應抵達順序

  var context = {
    document: dom.window.document,
    formatDate: function (x) { return x; },
    escapeHtml: function (x) { return x; },
    renderMarkdownSafe_: function (x) { return x; },
    showView: function () {},
    mountAttachmentPanel: function () {},
    google: { script: { run: null } }
  };
  // google.script.run 每次呼叫鏈結尾的方法名稱（getArticle/getRelatedArticles）
  // 在呼叫當下才知道，用一個小 Proxy 讓 withFailureHandler 回傳的物件可以
  // 接受任何方法名稱，不用為每個 RPC 名稱各寫一次。
  context.google.script.run = {
    withSuccessHandler: function (onSuccess) {
      return {
        withFailureHandler: function (onFailure) {
          return new Proxy({}, {
            get: function (target, fnName) {
              return function (articleId) {
                calls.push({ fn: fnName, articleId: articleId, resolve: onSuccess, reject: onFailure });
              };
            }
          });
        }
      };
    }
  };

  vm.createContext(context);

  var source = [
    extractVarDeclaration("currentDetailArticleId"),
    extractFunction("openArticleDetail"),
    extractFunction("openArticleDetailFromShareLink"),
    extractFunction("loadArticleDetail"),
    extractFunction("renderArticleDetail"),
    extractFunction("loadRelatedArticles"),
    extractFunction("renderRelatedArticles")
  ]
    .filter(Boolean)
    .join("\n\n");
  vm.runInContext(source, context);

  return { context: context, dom: dom, calls: calls };
}

function fakeArticle(id, title) {
  return {
    id: id,
    title: title,
    content_md: title + " body",
    status: "published",
    categories: null,
    tags: [],
    updated_at: "2026-01-01"
  };
}

describe("mycr F-06 fix: article detail stays consistent with the last-opened article, even when an earlier open's response arrives later", () => {
  test("openArticleDetail(A) then openArticleDetail(B), with A's response arriving after B's: the detail view shows B, not A", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;

    ctx.openArticleDetail("a1");
    ctx.openArticleDetail("a2");

    expect(sandbox.calls.length).toBe(4); // getArticle+getRelatedArticles ×2

    // B(a2)先回應
    sandbox.calls.filter(function (c) { return c.articleId === "a2" && c.fn === "getArticle"; })[0]
      .resolve(fakeArticle("a2", "B title"));
    // A(a1)才晚到
    sandbox.calls.filter(function (c) { return c.articleId === "a1" && c.fn === "getArticle"; })[0]
      .resolve(fakeArticle("a1", "A title"));

    var doc = sandbox.dom.window.document;
    expect(doc.getElementById("detail-title").textContent).toBe("B title");
  });

  test("openArticleDetail(A) then openArticleDetail(B): related articles also end up showing B's results, not A's", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;

    ctx.openArticleDetail("a1");
    ctx.openArticleDetail("a2");

    var relatedCalls = sandbox.calls.filter(function (c) { return c.fn === "getRelatedArticles"; });
    expect(relatedCalls.length).toBe(2);

    // B(a2)先回應
    relatedCalls.filter(function (c) { return c.articleId === "a2"; })[0]
      .resolve([{ id: "x", title: "related to B", categories: null }]);
    // A(a1)才晚到
    relatedCalls.filter(function (c) { return c.articleId === "a1"; })[0]
      .resolve([{ id: "y", title: "related to A", categories: null }]);

    var doc = sandbox.dom.window.document;
    expect(doc.getElementById("detail-related-articles-list").textContent).toContain("related to B");
    expect(doc.getElementById("detail-related-articles-list").textContent).not.toContain("related to A");
  });

  test("openArticleDetailFromShareLink also guards against a stale response (defense in depth, even though nothing else can navigate before page load finishes)", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;

    ctx.openArticleDetailFromShareLink("a1");
    // 使用者在分享連結載入完成前，點開了另一篇文章
    ctx.openArticleDetail("a2");

    var getArticleCalls = sandbox.calls.filter(function (c) { return c.fn === "getArticle"; });
    // a2 先回應
    getArticleCalls.filter(function (c) { return c.articleId === "a2"; })[0]
      .resolve(fakeArticle("a2", "B title"));
    // a1(分享連結)才晚到
    getArticleCalls.filter(function (c) { return c.articleId === "a1"; })[0]
      .resolve(fakeArticle("a1", "A title"));

    var doc = sandbox.dom.window.document;
    expect(doc.getElementById("detail-title").textContent).toBe("B title");
  });

  test("no race: a single openArticleDetail call still renders normally", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;

    ctx.openArticleDetail("a1");
    sandbox.calls.filter(function (c) { return c.fn === "getArticle"; })[0]
      .resolve(fakeArticle("a1", "A title"));

    var doc = sandbox.dom.window.document;
    expect(doc.getElementById("detail-title").textContent).toBe("A title");
  });
});
