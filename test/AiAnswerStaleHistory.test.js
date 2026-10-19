const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

/**
 * mycr F-07:AI 回應晚到時,不能再寫進對話歷史。
 *
 * loadAiAnswer 每次呼叫都建立專屬的 turnEl 並清空面板,所以「舊回應不會畫到新畫面上」
 * 本來就成立;但成功處理器沒有檢查這一輪是否還在畫面上,renderAiAnswerTurn 照樣把
 * 問答推進 conversationHistory。情境:搜尋 A(AI 還在跑)→ 清空搜尋回到列表
 * (hideAiAnswerPanel 清空歷史)→ A 的回應抵達 → A 被推回歷史 → 下一次問 B 時
 * 被當成上下文送給 Gemini。
 *
 * 沿用既有技巧:從 JavaScript.html 抓出函式原始碼,在 jsdom 裡真的執行,
 * google.script.run 換成讓測試自己決定「回應何時抵達」的假實作。
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
  const dom = new JSDOM('<!doctype html><html><body><div id="ai-answer-panel" class="hidden"></div></body></html>');
  const calls = []; // 每次呼叫 askKnowledgeBase 的紀錄
  const context = {
    document: dom.window.document,
    cachedWritePassword: "pw",
    conversationHistory: [],
    HISTORY_RETAIN_TURNS: Number(javaScriptHtml.match(/var HISTORY_RETAIN_TURNS\s*=\s*(\d+)/)[1]),
    MD_SANITIZE_CONFIG_AI_: {},
    renderMarkdownSafe_: (md) => "<p>" + md + "</p>",
    buildAiSourcesPanel: () => dom.window.document.createElement("details"),
    escapeHtml: (s) => String(s),
    google: {
      script: {
        get run() {
          const chain = {
            withSuccessHandler(fn) { chain.success = fn; return chain; },
            withFailureHandler(fn) { chain.failure = fn; return chain; },
            askKnowledgeBase(q, pw, history) {
              calls.push({
                question: q,
                // 送出當下的歷史快照(之後 conversationHistory 被改動也不影響斷言)
                history: JSON.parse(JSON.stringify(history)),
                success: chain.success,
                failure: chain.failure
              });
            }
          };
          return chain;
        }
      }
    }
  };
  vm.createContext(context);
  const source = ["hideAiAnswerPanel", "renderAiAnswerTurn", "loadAiAnswer"].map(extractFunction).filter(Boolean).join("\n\n");
  vm.runInContext(source, context);
  return { sb: context, calls, doc: dom.window.document };
}

const answer = (text) => ({ answer: text, sources: [], noRelevantArticles: false });
const history = (sb) => JSON.parse(JSON.stringify(sb.conversationHistory));

describe("loadAiAnswer: 對話歷史與過期回應 (mycr F-07)", () => {
  test("正常流程:送出 → 抵達,問答被寫進歷史並顯示在畫面上", () => {
    const { sb, calls, doc } = buildSandbox();
    sb.loadAiAnswer("問題A");
    calls[0].success(answer("答案A"));

    expect(history(sb)).toEqual([{ question: "問題A", answer: "答案A" }]);
    expect(doc.getElementById("ai-answer-panel").textContent).toContain("問題A");
  });

  test("搜尋 A → 在 A 抵達前清空搜尋 → A 晚到:歷史仍為空,畫面不出現 A 的回答", () => {
    const { sb, calls, doc } = buildSandbox();
    sb.loadAiAnswer("問題A");
    sb.hideAiAnswerPanel(); // 使用者清空搜尋,回到列表
    calls[0].success(answer("答案A"));

    expect(history(sb)).toEqual([]);
    const panel = doc.getElementById("ai-answer-panel");
    expect(panel.textContent).toBe("");
    expect(panel.classList.contains("hidden")).toBe(true);
  });

  test("A 晚到被丟棄之後再問 B:送給後端的歷史不含 A", () => {
    const { sb, calls } = buildSandbox();
    sb.loadAiAnswer("問題A");
    sb.hideAiAnswerPanel();
    calls[0].success(answer("答案A"));

    sb.loadAiAnswer("問題B");
    expect(calls[1].question).toBe("問題B");
    expect(calls[1].history).toEqual([]);
  });

  test("兩個搜尋重疊(A 先送、B 後送):B 先抵達、A 後抵達 → 只有 B 進入歷史", () => {
    const { sb, calls, doc } = buildSandbox();
    sb.loadAiAnswer("問題A");
    sb.loadAiAnswer("問題B");
    calls[1].success(answer("答案B"));
    calls[0].success(answer("答案A"));

    expect(history(sb)).toEqual([{ question: "問題B", answer: "答案B" }]);
    const text = doc.getElementById("ai-answer-panel").textContent;
    expect(text).toContain("問題B");
    expect(text).not.toContain("問題A");
  });

  test("兩個搜尋重疊:A 先抵達、B 後抵達 → 同樣只有 B(A 的畫面早已被 B 取代)", () => {
    const { sb, calls } = buildSandbox();
    sb.loadAiAnswer("問題A");
    sb.loadAiAnswer("問題B");
    calls[0].success(answer("答案A"));
    calls[1].success(answer("答案B"));

    expect(history(sb)).toEqual([{ question: "問題B", answer: "答案B" }]);
  });

  test("連續多輪追問:歷史依序累積,送出時帶著之前每一輪,超過保留輪數上限就只留最近幾輪", () => {
    const { sb, calls } = buildSandbox();
    const turns = sb.HISTORY_RETAIN_TURNS + 2;
    for (let n = 1; n <= turns; n++) {
      sb.loadAiAnswer("問題" + n);
      calls[n - 1].success(answer("答案" + n));
    }

    expect(calls[1].history).toEqual([{ question: "問題1", answer: "答案1" }]);
    expect(history(sb)).toHaveLength(sb.HISTORY_RETAIN_TURNS);
    expect(history(sb)[sb.HISTORY_RETAIN_TURNS - 1]).toEqual({ question: "問題" + turns, answer: "答案" + turns });
  });

  test("查無相關文章的輪次不計入歷史(既有行為不變)", () => {
    const { sb, calls } = buildSandbox();
    sb.loadAiAnswer("冷門問題");
    calls[0].success({ noRelevantArticles: true });

    expect(history(sb)).toEqual([]);
  });
});
