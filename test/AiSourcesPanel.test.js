const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

/**
 * AI 回答的「檢索到的相關文章」面板(docs/specs/spec_ai_sources_panel.md)。
 *
 * 前端沒有 DOM 行為測試的替換接縫,所以沿用既有技巧(見 SearchDegradedNotice.test.js):
 * 從 JavaScript.html 抓出函式原始碼,在 jsdom 裡真的執行,驗證渲染結果;
 * 再加一組靜態文字掃描,守住樣式與舊 class 清除。兩者不能互相取代。
 */

const javaScriptHtml = fs.readFileSync(path.join(__dirname, "../src/JavaScript.html"), "utf8");
const stylesheetHtml = fs.readFileSync(path.join(__dirname, "../src/Stylesheet.html"), "utf8");

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
  const dom = new JSDOM('<!doctype html><html><body><div id="panel"></div></body></html>');
  const opened = [];
  const context = {
    document: dom.window.document,
    // 答案渲染不是本測試的重點:以逐字轉義的假實作代替 marked + DOMPurify
    renderMarkdownSafe_: (text) => String(text).replace(/</g, "&lt;"),
    MD_SANITIZE_CONFIG_AI_: {},
    openArticleDetail: (id) => opened.push(id),
    HISTORY_RETAIN_TURNS: 5,
    conversationHistory: []
  };
  vm.createContext(context);
  const source = ["buildAiSourcesPanel", "renderAiAnswerTurn"].map(extractFunction).filter(Boolean).join("\n\n");
  vm.runInContext(source, context);
  return { context, dom, opened };
}

const newTurn = (sb) => {
  const el = sb.dom.window.document.createElement("div");
  sb.dom.window.document.getElementById("panel").appendChild(el);
  return el;
};
const makeSources = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: "a" + i, title: "標題 " + i, categoryName: i % 2 ? "分類 " + i : null }));
const answer = (sources) => ({ answer: "答案內容", noRelevantArticles: false, sources });

describe("renderAiAnswerTurn: the retrieved-articles panel", () => {
  test("renders one native <details>, collapsed by default (no open attribute)", () => {
    const sb = buildSandbox();
    const turn = newTurn(sb);

    sb.context.renderAiAnswerTurn(turn, "問題", answer(makeSources(3)));

    const panels = turn.querySelectorAll("details");
    expect(panels).toHaveLength(1);
    expect(panels[0].hasAttribute("open")).toBe(false);
    expect(panels[0].open).toBe(false);
  });

  test.each([1, 3, 20])("the summary reads 「檢索到的相關文章(N)」 with N = %i", (n) => {
    const sb = buildSandbox();
    const turn = newTurn(sb);

    sb.context.renderAiAnswerTurn(turn, "問題", answer(makeSources(n)));

    expect(turn.querySelector("details > summary").textContent).toBe("檢索到的相關文章(" + n + ")");
  });

  test("the summary never says 「參考來源」 (the articles are retrieved, not necessarily cited)", () => {
    const sb = buildSandbox();
    const turn = newTurn(sb);

    sb.context.renderAiAnswerTurn(turn, "問題", answer(makeSources(2)));

    expect(turn.textContent).not.toMatch(/參考來源/);
  });

  test("expanded content is a vertical list: one button per source, in the given order", () => {
    const sb = buildSandbox();
    const turn = newTurn(sb);

    sb.context.renderAiAnswerTurn(turn, "問題", answer(makeSources(20)));

    const buttons = turn.querySelectorAll("details button");
    expect(buttons).toHaveLength(20);
    expect(buttons[0].type).toBe("button");
    expect(Array.from(buttons).map((b) => b.querySelector("[class*=title]").textContent)).toEqual(
      makeSources(20).map((s) => s.title)
    );
  });

  test("each row shows the title as primary text and the category name as secondary text", () => {
    const sb = buildSandbox();
    const turn = newTurn(sb);

    sb.context.renderAiAnswerTurn(turn, "問題", answer([{ id: "a1", title: "React Hooks", categoryName: "前端" }]));

    const button = turn.querySelector("details button");
    expect(button.querySelector("[class*=title]").textContent).toBe("React Hooks");
    expect(button.querySelector("[class*=category]").textContent).toBe("前端");
  });

  test("an uncategorized source renders only the title: no secondary element, no separator, no 'null' or blank", () => {
    const sb = buildSandbox();
    const turn = newTurn(sb);

    sb.context.renderAiAnswerTurn(turn, "問題", answer([{ id: "a1", title: "只有標題", categoryName: null }]));

    const button = turn.querySelector("details button");
    expect(button.querySelector("[class*=category]")).toBeNull();
    expect(button.textContent).toBe("只有標題");
    expect(button.textContent).not.toMatch(/null|undefined|·|\||\/|—/);
  });

  test("clicking a row opens that article via the existing openArticleDetail", () => {
    const sb = buildSandbox();
    const turn = newTurn(sb);
    sb.context.renderAiAnswerTurn(turn, "問題", answer(makeSources(3)));

    turn.querySelectorAll("details button")[2].click();

    expect(sb.opened).toEqual(["a2"]);
  });

  test("title and category are inserted as plain text: markup in user data never becomes elements", () => {
    const sb = buildSandbox();
    const turn = newTurn(sb);
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';

    sb.context.renderAiAnswerTurn(turn, "問題", answer([{ id: "a1", title: evil, categoryName: evil }]));

    const panel = turn.querySelector("details");
    expect(panel.querySelector("img")).toBeNull();
    expect(panel.querySelector("script")).toBeNull();
    expect(panel.textContent).toContain(evil); // 以字面文字呈現
  });
});

describe("renderAiAnswerTurn: lifecycle", () => {
  test("every new answer rebuilds the panel collapsed, even if the previous one was expanded", () => {
    const sb = buildSandbox();
    const turn = newTurn(sb);
    sb.context.renderAiAnswerTurn(turn, "第一題", answer(makeSources(3)));
    turn.querySelector("details").open = true;

    sb.context.renderAiAnswerTurn(turn, "第二題", answer(makeSources(2))); // 同一個容器重新渲染

    expect(turn.querySelectorAll("details")).toHaveLength(1);
    expect(turn.querySelector("details").open).toBe(false);
    expect(turn.querySelector("summary").textContent).toBe("檢索到的相關文章(2)");
  });

  test("noRelevantArticles: no panel at all, original message unchanged, nothing added to the history", () => {
    const sb = buildSandbox();
    const turn = newTurn(sb);

    sb.context.renderAiAnswerTurn(turn, "問題", { answer: null, noRelevantArticles: true, sources: [] });

    expect(turn.querySelector("details")).toBeNull();
    expect(turn.textContent).toContain("知識庫沒有相關資料。");
    expect(sb.context.conversationHistory).toHaveLength(0);
  });

  test("the history still accumulates for answered turns and keeps only the latest HISTORY_RETAIN_TURNS", () => {
    const sb = buildSandbox();
    for (let i = 0; i < 7; i++) {
      sb.context.renderAiAnswerTurn(newTurn(sb), "問題" + i, answer(makeSources(1)));
    }

    expect(sb.context.conversationHistory).toHaveLength(5);
    expect(sb.context.conversationHistory[4].question).toBe("問題6");
  });

  test("the answer text is still rendered above the panel", () => {
    const sb = buildSandbox();
    const turn = newTurn(sb);

    sb.context.renderAiAnswerTurn(turn, "問題", answer(makeSources(2)));

    expect(turn.querySelector(".ai-answer__text").textContent).toBe("答案內容");
  });
});

describe("static scan: source and styles", () => {
  const renderSource = (extractFunction("renderAiAnswerTurn") || "") + (extractFunction("buildAiSourcesPanel") || "");

  test("the panel is created with <details>, and the script never forces it open", () => {
    expect(renderSource).toMatch(/createElement\('details'\)/);
    expect(renderSource).not.toMatch(/\.open\s*=\s*true/);
    expect(renderSource).not.toMatch(/setAttribute\(\s*'open'/);
  });

  test("the summary text and count come from the script", () => {
    expect(renderSource).toMatch(/檢索到的相關文章/);
    expect(renderSource).toMatch(/sources\.length/);
  });

  test("title and category are set with textContent, never concatenated into innerHTML", () => {
    const panelSource = extractFunction("buildAiSourcesPanel") || "";
    expect(panelSource).toMatch(/\.textContent\s*=\s*source\.title/);
    expect(panelSource).toMatch(/\.textContent\s*=\s*source\.categoryName/);
    expect(panelSource).not.toMatch(/innerHTML/);
  });

  test("the old pill classes are gone from both the script and the styles", () => {
    expect(javaScriptHtml).not.toMatch(/ai-answer__source/);
    expect(stylesheetHtml).not.toMatch(/ai-answer__source/);
  });

  test("the list button has a minimum height of at least 44px and long titles wrap", () => {
    const rule = stylesheetHtml.match(/\.ai-sources__item\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const minHeight = rule[1].match(/min-height:\s*(\d+)px/);
    expect(minHeight).not.toBeNull();
    expect(Number(minHeight[1])).toBeGreaterThanOrEqual(44);
    expect(rule[1]).toMatch(/(overflow-wrap:\s*anywhere|word-break:\s*break-word|overflow-wrap:\s*break-word)/);
    expect(rule[1]).not.toMatch(/white-space:\s*nowrap/);
  });

  test("the summary is clearly operable: pointer cursor and a focus style", () => {
    expect(stylesheetHtml).toMatch(/\.ai-sources__summary\s*\{[^}]*cursor:\s*pointer/);
    // 允許合併選擇器(summary 與 item 共用同一條聚焦規則)
    expect(stylesheetHtml).toMatch(/\.ai-sources__summary:focus-visible[^{]*\{[^}]*(outline|box-shadow)/);
    expect(stylesheetHtml).toMatch(/\.ai-sources__item:focus-visible[^{]*\{[^}]*(outline|box-shadow)/);
  });

  test("new styles use only the existing design tokens (no hard-coded colors)", () => {
    const blocks = stylesheetHtml.match(/\.ai-sources[^{]*\{[^}]*\}/g) || [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(block).not.toMatch(/rgba?\(/);
    }
  });

  test("the list has no item-count cap and the answer block keeps its existing 60vh scrolling", () => {
    const listRule = stylesheetHtml.match(/\.ai-sources__list\s*\{([^}]*)\}/);
    expect(listRule).not.toBeNull();
    expect(listRule[1]).not.toMatch(/max-height/);
    expect(stylesheetHtml).toMatch(/\.ai-answer\s*\{[^}]*max-height:\s*60vh/);
  });

  test("applies to every viewport: no media query is specific to the new classes", () => {
    const mediaBlocks = stylesheetHtml.match(/@media[^{]*\{(?:[^{}]|\{[^}]*\})*\}/g) || [];
    for (const block of mediaBlocks) expect(block).not.toMatch(/ai-sources/);
  });
});
