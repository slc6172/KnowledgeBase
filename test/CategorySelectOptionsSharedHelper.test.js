const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

/**
 * mycr F-11 修正:三個地方(列表篩選、批次改分類、編輯器)原本各自重複
 * 實作同一段「把分類清單畫成平鋪 <select>,子分類縮排」的邏輯,合併成
 * 一個共用函式 buildCategorySelectOptions_。同一套「從 JavaScript.html
 * 抓原始碼、在 jsdom 裡真的執行」的技巧(見
 * test/ArticleDetailStalenessGuard.test.js)。
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
      '<select id="list-category-filter"></select>' +
      '<select id="batch-category-select"></select>' +
      '<select id="editor-category"></select>' +
      '</body></html>'
  );

  var context = {
    document: dom.window.document,
    showError: function () {},
    cachedCategories: [],
    google: { script: { run: null } }
  };
  context.google.script.run = {
    withSuccessHandler: function (onSuccess) {
      return {
        withFailureHandler: function () {
          return new Proxy({}, {
            get: function (target, fnName) {
              return function () { context.__lastResolve = onSuccess; };
            }
          });
        }
      };
    }
  };

  vm.createContext(context);

  var source = [
    extractFunction("buildCategorySelectOptions_"),
    extractFunction("loadCategoryFilterOptions"),
    extractFunction("loadBatchCategoryOptions"),
    extractFunction("renderCategoryOptions")
  ]
    .filter(Boolean)
    .join("\n\n");
  vm.runInContext(source, context);

  return { context: context, dom: dom };
}

var sampleCategories = [
  { id: "c1", name: "Top", parent_id: null },
  { id: "c2", name: "Child", parent_id: "c1" }
];

describe("mycr F-11 fix: category <select> tree-building is shared across all three call sites", () => {
  test("buildCategorySelectOptions_ builds a flat tree (top-level then indented children) with the given empty-option label", () => {
    var sandbox = buildSandbox();
    var select = sandbox.dom.window.document.getElementById("editor-category");

    sandbox.context.buildCategorySelectOptions_(select, sampleCategories, "自訂空標籤", false);

    var options = Array.prototype.slice.call(select.options);
    expect(options.map(function (o) { return o.textContent; })).toEqual([
      "自訂空標籤",
      "Top",
      "\u3000\u2514 Child"
    ]);
    expect(options.map(function (o) { return o.value; })).toEqual(["", "c1", "c2"]);
  });

  test("preserveValue=true keeps the previously selected value after rebuilding", () => {
    var sandbox = buildSandbox();
    var select = sandbox.dom.window.document.getElementById("editor-category");
    select.innerHTML = '<option value="c2">old</option>';
    select.value = "c2";

    sandbox.context.buildCategorySelectOptions_(select, sampleCategories, "未分類", true);

    expect(select.value).toBe("c2");
  });

  test("preserveValue=false does not try to restore a previous value (e.g. batch-set-category, which should always start unselected)", () => {
    var sandbox = buildSandbox();
    var select = sandbox.dom.window.document.getElementById("batch-category-select");

    sandbox.context.buildCategorySelectOptions_(select, sampleCategories, "未分類", false);

    expect(select.value).toBe("");
  });

  test("loadCategoryFilterOptions routes through the shared helper with '全部分類' as the empty label", () => {
    var sandbox = buildSandbox();
    sandbox.context.loadCategoryFilterOptions();
    sandbox.context.__lastResolve(sampleCategories);

    var select = sandbox.dom.window.document.getElementById("list-category-filter");
    expect(select.options[0].textContent).toBe("全部分類");
    expect(select.options.length).toBe(3);
  });

  test("loadBatchCategoryOptions routes through the shared helper with '未分類' as the empty label", () => {
    var sandbox = buildSandbox();
    sandbox.context.loadBatchCategoryOptions();
    sandbox.context.__lastResolve(sampleCategories);

    var select = sandbox.dom.window.document.getElementById("batch-category-select");
    expect(select.options[0].textContent).toBe("未分類");
    expect(select.options.length).toBe(3);
  });

  test("renderCategoryOptions (editor) routes through the shared helper, reading from cachedCategories", () => {
    var sandbox = buildSandbox();
    sandbox.context.cachedCategories = sampleCategories;
    sandbox.context.renderCategoryOptions();

    var select = sandbox.dom.window.document.getElementById("editor-category");
    expect(select.options[0].textContent).toBe("未分類");
    expect(select.options.length).toBe(3);
  });
});
