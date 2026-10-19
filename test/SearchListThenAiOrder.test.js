const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

/**
 * spec_rag_excerpts.md(mycr F-08):搜尋時前端必須「文章列表回來之後才發 AI 問答請求」,
 * 讓列表請求先把查詢向量放進伺服器端快取、AI 請求直接取用,一次搜尋只嵌入一次。
 *
 * 沿用既有技巧:從 JavaScript.html 抓出真實的 performSearch / loadAiAnswer 原始碼,
 * 在 jsdom 裡執行;google.script.run 換成由測試決定「回應何時抵達」的假實作。
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

function buildSandbox({ password = "pw" } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="ai-answer-panel" class="hidden"></div></body></html>');
  const events = []; // 依發生順序:"searchArticles" | "askKnowledgeBase" | "render" | "error"
  const calls = []; // google.script.run 的呼叫:{ fn, args, success, failure }
  const context = {
    document: dom.window.document,
    cachedWritePassword: password,
    conversationHistory: [],
    articleResultsRequestSeq_: 0,
    setSearchBusy: () => {},
    hideArticleListPager: () => {},
    setSearchDegradedNotice: () => {},
    getSelectedStatusFilter: () => "all",
    getSelectedCategoryFilter: () => null,
    getSelectedTagIds: () => [],
    renderArticleCards: () => events.push("render"),
    showError: () => events.push("error"),
    escapeHtml: (s) => String(s),
    renderAiAnswerTurn: () => {},
    google: {
      script: {
        get run() {
          // 每次 google.script.run 都是一條新的鏈;鏈上的 withSuccessHandler/withFailureHandler
          // 回傳同一個 Proxy,其餘任何方法名稱都視為「伺服器端函式」並記錄呼叫。
          const handlers = {};
          const proxy = new Proxy(handlers, {
            get(target, name) {
              if (name === "withSuccessHandler") {
                return (fn) => {
                  target.success = fn;
                  return proxy;
                };
              }
              if (name === "withFailureHandler") {
                return (fn) => {
                  target.failure = fn;
                  return proxy;
                };
              }
              return (...args) => {
                events.push(String(name));
                calls.push({ fn: String(name), args, success: target.success, failure: target.failure });
              };
            }
          });
          return proxy;
        }
      }
    }
  };
  vm.createContext(context);
  const source = ["hideAiAnswerPanel", "loadAiAnswer", "performSearch"].map(extractFunction).join("\n\n");
  vm.runInContext(source, context);
  return { sb: context, events, calls };
}

const listCalls = (calls) => calls.filter((c) => c.fn === "searchArticles");
const askCalls = (calls) => calls.filter((c) => c.fn === "askKnowledgeBase");

describe("performSearch: article list first, AI answer only after the list request completes", () => {
  test("right after performSearch only the list request is out — no AI request yet", () => {
    const { sb, calls } = buildSandbox();

    sb.performSearch("react");

    expect(calls.map((c) => c.fn)).toEqual(["searchArticles"]);
  });

  test("list success → the list is rendered first, then the AI request is sent (with the same query)", () => {
    const { sb, events, calls } = buildSandbox();
    sb.performSearch("react");

    calls[0].success({ articles: [], degraded: false });

    expect(events).toEqual(["searchArticles", "render", "askKnowledgeBase"]);
    expect(askCalls(calls)[0].args[0]).toBe("react");
  });

  test("list failure → the error is shown, then the AI request is still sent", () => {
    const { sb, events, calls } = buildSandbox();
    sb.performSearch("react");

    calls[0].failure({ message: "boom" });

    expect(events).toEqual(["searchArticles", "error", "askKnowledgeBase"]);
  });

  test("degraded list (semantic search unavailable) → the AI request is still sent", () => {
    const { sb, calls } = buildSandbox();
    sb.performSearch("react");

    calls[0].success({ articles: [], degraded: true });

    expect(askCalls(calls).length).toBe(1);
  });

  test("a list request superseded by a newer search never triggers an AI request (success or failure)", () => {
    const { sb, calls } = buildSandbox();
    sb.performSearch("old");
    sb.performSearch("new");
    const [oldList, newList] = listCalls(calls);

    oldList.success({ articles: [], degraded: false });
    expect(askCalls(calls).length).toBe(0);
    oldList.failure({ message: "late failure" });
    expect(askCalls(calls).length).toBe(0);

    newList.success({ articles: [], degraded: false });
    expect(askCalls(calls).map((c) => c.args[0])).toEqual(["new"]);
  });

  test("no cached password → no AI request at all (existing behaviour), the panel stays hidden", () => {
    const { sb, calls } = buildSandbox({ password: null });
    sb.performSearch("react");

    calls[0].success({ articles: [], degraded: false });

    expect(askCalls(calls).length).toBe(0);
    expect(sb.document.getElementById("ai-answer-panel").classList.contains("hidden")).toBe(true);
  });
});
