const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

/**
 * 搜尋降級(docs/specs/spec_search_degradation.md)的前端行為。
 *
 * 前端沒有 DOM 行為測試的替換接縫(google.script.run),所以沿用
 * ArticleListSearchStalenessGuard.test.js 的技巧:從 JavaScript.html 抓出函式原始碼,
 * 在 jsdom 裡真的執行,手動控制假 google.script.run 的回應抵達順序。
 * 另外加一組靜態文字掃描,守住 HTML 裡固定的元素與文字。
 */

const javaScriptHtml = fs.readFileSync(path.join(__dirname, "../src/JavaScript.html"), "utf8");
const listViewHtml = fs.readFileSync(path.join(__dirname, "../src/ArticleListView.html"), "utf8");

const NOTICE_TEXT = "語意搜尋暫時無法使用,以下僅為關鍵字比對結果,結果可能較少。";
const DEGRADED_EMPTY_TEXT = "關鍵字比對沒有找到結果。語意搜尋目前無法使用,稍後再試可能會有更多結果。";
const NORMAL_EMPTY_TEXT = "沒有符合的文章。";

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

function buildSandbox(filters) {
  filters = filters || {};
  const dom = new JSDOM(
    "<!doctype html><html><body>" +
      '<div id="search-degraded-notice" class="hidden">' + NOTICE_TEXT + "</div>" +
      '<div id="article-list-results"></div>' +
      '<button id="btn-search"></button>' +
      "</body></html>"
  );
  const calls = [];
  const context = {
    document: dom.window.document,
    escapeHtml: (x) => x,
    formatDate: (x) => x,
    buildSnippet: (x) => x,
    showError: () => {},
    hideAiAnswerPanel: () => {},
    loadAiAnswer: () => {},
    getSelectedStatusFilter: () => filters.status || "all",
    getSelectedCategoryFilter: () => filters.category || null,
    getSelectedTagIds: () => [],
    updateArticleListPager: () => {},
    hideArticleListPager: () => {},
    ARTICLE_LIST_PAGE_SIZE: 20,
    currentListPage: 0,
    articleResultsRequestSeq_: 0,
    selectMode: false,
    selectedArticleIds: {},
    currentListArticles: [],
    google: { script: { run: null } }
  };
  context.google.script.run = {
    withSuccessHandler(onSuccess) {
      return {
        withFailureHandler(onFailure) {
          return new Proxy({}, {
            get(target, fnName) {
              return function () {
                calls.push({ fn: fnName, args: Array.prototype.slice.call(arguments), resolve: onSuccess, reject: onFailure });
              };
            }
          });
        }
      };
    }
  };
  vm.createContext(context);
  const source = [
    "setSearchBusy",
    "setSearchDegradedNotice",
    "renderArticleCards",
    "loadArticleList",
    "performSearch"
  ]
    .map(extractFunction)
    .filter(Boolean)
    .join("\n\n");
  vm.runInContext(source, context);
  return { context, dom, calls };
}

const article = (id, title, status) => ({
  id, title, status: status || "published", category_id: null, categories: null, tags: [], updated_at: "x"
});
const noticeEl = (sb) => sb.dom.window.document.getElementById("search-degraded-notice");
const noticeVisible = (sb) => !noticeEl(sb).classList.contains("hidden");
const resultsText = (sb) => sb.dom.window.document.getElementById("article-list-results").textContent;
const searchCalls = (sb) => sb.calls.filter((c) => c.fn === "searchArticles");

describe("search degradation notice: shown only for the latest degraded search", () => {
  test("a degraded response shows the notice and still renders the keyword results", () => {
    const sb = buildSandbox();
    sb.context.performSearch("react");

    searchCalls(sb)[0].resolve({ articles: [article("a1", "關鍵字命中")], degraded: true });

    expect(noticeVisible(sb)).toBe(true);
    expect(resultsText(sb)).toContain("關鍵字命中");
  });

  test("a non-degraded response leaves the notice hidden", () => {
    const sb = buildSandbox();
    sb.context.performSearch("react");

    searchCalls(sb)[0].resolve({ articles: [article("a1", "正常結果")], degraded: false });

    expect(noticeVisible(sb)).toBe(false);
  });

  test("starting a new search clears a notice left by the previous degraded search before its response arrives", () => {
    const sb = buildSandbox();
    sb.context.performSearch("first");
    searchCalls(sb)[0].resolve({ articles: [article("a1", "x")], degraded: true });
    expect(noticeVisible(sb)).toBe(true);

    sb.context.performSearch("second"); // 回應還沒到

    expect(noticeVisible(sb)).toBe(false);
  });

  test("going back to the normal list (loadArticleList) clears the notice", () => {
    const sb = buildSandbox();
    sb.context.performSearch("first");
    searchCalls(sb)[0].resolve({ articles: [article("a1", "x")], degraded: true });

    sb.context.loadArticleList();

    expect(noticeVisible(sb)).toBe(false);
  });

  test("a stale degraded response (older search arriving after a newer one) neither shows the notice nor overwrites the newer results", () => {
    const sb = buildSandbox();
    sb.context.performSearch("older");
    sb.context.performSearch("newer");
    const [older, newer] = searchCalls(sb);

    newer.resolve({ articles: [article("n1", "newer result")], degraded: false });
    older.resolve({ articles: [article("o1", "older result")], degraded: true });

    expect(noticeVisible(sb)).toBe(false);
    expect(resultsText(sb)).toContain("newer result");
    expect(resultsText(sb)).not.toContain("older result");
  });

  test("a degraded search response arriving after the user already went back to the list does not show the notice", () => {
    const sb = buildSandbox();
    sb.context.performSearch("react");
    sb.context.loadArticleList();
    const search = searchCalls(sb)[0];
    const list = sb.calls.filter((c) => c.fn === "listArticles")[0];

    list.resolve([article("l1", "list result")]);
    search.resolve({ articles: [article("s1", "search result")], degraded: true });

    expect(noticeVisible(sb)).toBe(false);
    expect(resultsText(sb)).toContain("list result");
  });

  test("a failed search leaves the notice hidden", () => {
    const sb = buildSandbox();
    sb.context.performSearch("first");
    searchCalls(sb)[0].resolve({ articles: [], degraded: true });
    sb.context.performSearch("second");

    searchCalls(sb)[1].reject({ message: "boom" });

    expect(noticeVisible(sb)).toBe(false);
  });
});

describe("search degradation notice: the empty state", () => {
  test("degraded and no results → the dedicated message", () => {
    const sb = buildSandbox();
    sb.context.performSearch("React");

    searchCalls(sb)[0].resolve({ articles: [], degraded: true });

    expect(resultsText(sb)).toContain(DEGRADED_EMPTY_TEXT);
    expect(resultsText(sb)).not.toContain(NORMAL_EMPTY_TEXT);
  });

  test("degraded, results exist but the front-end status filter removes them all → still the dedicated message", () => {
    const sb = buildSandbox({ status: "draft" });
    sb.context.performSearch("react");

    searchCalls(sb)[0].resolve({ articles: [article("a1", "已發布的", "published")], degraded: true });

    expect(resultsText(sb)).toContain(DEGRADED_EMPTY_TEXT);
  });

  test("not degraded and no results → the original empty message, unchanged", () => {
    const sb = buildSandbox();
    sb.context.performSearch("react");

    searchCalls(sb)[0].resolve({ articles: [], degraded: false });

    expect(resultsText(sb)).toContain(NORMAL_EMPTY_TEXT);
    expect(resultsText(sb)).not.toContain(DEGRADED_EMPTY_TEXT);
  });

  test("the plain article list's empty state is unchanged", () => {
    const sb = buildSandbox();
    sb.context.loadArticleList();

    sb.calls[0].resolve([]);

    expect(resultsText(sb)).toContain(NORMAL_EMPTY_TEXT);
  });
});

describe("search degradation notice: static markup and source", () => {
  test("the list view has the notice element with a fixed id, hidden by default, above the results", () => {
    const tag = listViewHtml.match(/<[a-z]+[^>]*id="search-degraded-notice"[^>]*>/);
    expect(tag).not.toBeNull();
    expect(tag[0]).toMatch(/class="[^"]*\bhidden\b[^"]*"/);
    expect(listViewHtml.indexOf("search-degraded-notice")).toBeLessThan(listViewHtml.indexOf('id="article-list-results"'));
  });

  test("the notice text is the specified wording and offers no retry button (searching again is the retry)", () => {
    const m = listViewHtml.match(/id="search-degraded-notice"[^>]*>([\s\S]*?)<\/div>/);
    expect(m[1]).toContain(NOTICE_TEXT);
    expect(m[1]).not.toMatch(/<button/i);
  });

  test("the notice does not block interaction (not a modal, not fixed over the page)", () => {
    const style = fs.readFileSync(path.join(__dirname, "../src/Stylesheet.html"), "utf8");
    const rule = style.match(/\.search-degraded-notice\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).not.toMatch(/position:\s*(fixed|absolute)/);
  });

  test("the search success handler reads both articles and degraded from the result object", () => {
    const fn = extractFunction("performSearch");
    expect(fn).toMatch(/result\.articles/);
    expect(fn).toMatch(/result\.degraded/);
  });

  test("the degraded empty-state wording exists in the front-end source", () => {
    expect(javaScriptHtml).toContain(DEGRADED_EMPTY_TEXT);
  });

  test("the notice is cleared at the start of both performSearch and loadArticleList", () => {
    expect(extractFunction("performSearch")).toMatch(/setSearchDegradedNotice\(false\)/);
    expect(extractFunction("loadArticleList")).toMatch(/setSearchDegradedNotice\(false\)/);
  });
});
