const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

/**
 * mycr F-06 修正(docs/specs/spec_stale_async_response_guards.md）：同一套
 * 「從 JavaScript.html 抓出原始碼、在 jsdom 裡真的執行、手動控制假
 * google.script.run 回應抵達順序」的技巧(見
 * test/ArticleDetailStalenessGuard.test.js),這次驗證的是文章列表/搜尋——
 * 這兩個函式寫進同一塊畫面(都呼叫 renderArticleCards),必須共用同一個
 * 請求序號,所以特別要驗證「跨函式交錯呼叫」的情境,不能只測同一種呼叫
 * 連續兩次。
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

function buildSandbox() {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
      '<div id="search-degraded-notice" class="hidden"></div>' +
      '<div id="article-list-results"></div>' +
      '<button id="btn-search"></button>' +
      '</body></html>'
  );

  var calls = [];

  var context = {
    document: dom.window.document,
    escapeHtml: function (x) { return x; },
    formatDate: function (x) { return x; },
    buildSnippet: function (x) { return x; },
    hideAiAnswerPanel: function () {},
    loadAiAnswer: function () {}, // 有自己獨立的安全機制(見 spec),這裡不需要真的執行
    getSelectedStatusFilter: function () { return "all"; },
    getSelectedCategoryFilter: function () { return null; },
    getSelectedTagIds: function () { return []; },
    updateArticleListPager: function () {},
    hideArticleListPager: function () {},
    ARTICLE_LIST_PAGE_SIZE: 20,
    currentListPage: 0,
    articleResultsRequestSeq_: 0,
    selectMode: false,
    selectedArticleIds: {},
    currentListArticles: [],
    google: { script: { run: null } }
  };
  context.google.script.run = {
    withSuccessHandler: function (onSuccess) {
      return {
        withFailureHandler: function (onFailure) {
          return new Proxy({}, {
            get: function (target, fnName) {
              return function () {
                var args = Array.prototype.slice.call(arguments);
                calls.push({ fn: fnName, args: args, resolve: onSuccess, reject: onFailure });
              };
            }
          });
        }
      };
    }
  };

  vm.createContext(context);

  var source = [
    extractFunction("setSearchBusy"),
    extractFunction("setSearchDegradedNotice"),
    extractFunction("renderArticleCards"),
    extractFunction("loadArticleList"),
    extractFunction("performSearch")
  ]
    .filter(Boolean)
    .join("\n\n");
  vm.runInContext(source, context);

  return { context: context, dom: dom, calls: calls };
}

function fakeArticle(id, title) {
  return { id: id, title: title, status: "published", categories: null, tags: [], updated_at: "x" };
}

function cardsText(sandbox) {
  return sandbox.dom.window.document.getElementById("article-list-results").textContent;
}

describe("mycr F-06 fix: the article list/search results always end up matching the most recent request, regardless of arrival order", () => {
  test("loadArticleList() called twice, with the first call's response arriving after the second's: the list shows the second call's results", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;

    ctx.loadArticleList();
    ctx.loadArticleList();

    expect(sandbox.calls.length).toBe(2);
    sandbox.calls[1].resolve([fakeArticle("a2", "second call article")]);
    sandbox.calls[0].resolve([fakeArticle("a1", "first call article")]);

    expect(cardsText(sandbox)).toContain("second call article");
    expect(cardsText(sandbox)).not.toContain("first call article");
  });

  test("loadArticleList() then performSearch(...), with the (earlier) list call's response arriving after the (later) search call's: the list shows the search results, not the stale browse results — loadArticleList and performSearch must share one sequence counter", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;

    ctx.loadArticleList();
    ctx.performSearch("query");

    var listCall = sandbox.calls.filter(function (c) { return c.fn === "listArticles"; })[0];
    var searchCall = sandbox.calls.filter(function (c) { return c.fn === "searchArticles"; })[0];
    expect(listCall).toBeDefined();
    expect(searchCall).toBeDefined();

    // 比較晚呼叫的 performSearch 反而先回應,比較早呼叫的 loadArticleList 才晚到
    searchCall.resolve({ articles: [fakeArticle("s1", "search result")], degraded: false });
    listCall.resolve([fakeArticle("l1", "browse result")]);

    expect(cardsText(sandbox)).toContain("search result");
    expect(cardsText(sandbox)).not.toContain("browse result");
  });

  test("performSearch(...) then loadArticleList(), with the (earlier) search call's response arriving after the (later) list call's: the list shows the browse results, not the stale search results", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;

    ctx.performSearch("query");
    ctx.loadArticleList();

    var listCall = sandbox.calls.filter(function (c) { return c.fn === "listArticles"; })[0];
    var searchCall = sandbox.calls.filter(function (c) { return c.fn === "searchArticles"; })[0];

    listCall.resolve([fakeArticle("l1", "browse result")]);
    searchCall.resolve({ articles: [fakeArticle("s1", "search result")], degraded: false });

    expect(cardsText(sandbox)).toContain("browse result");
    expect(cardsText(sandbox)).not.toContain("search result");
  });

  test("no race: a single loadArticleList() call still renders normally", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;

    ctx.loadArticleList();
    sandbox.calls[0].resolve([fakeArticle("a1", "only article")]);

    expect(cardsText(sandbox)).toContain("only article");
  });
});
