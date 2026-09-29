const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

/**
 * mycr F-06 修正(docs/specs/spec_stale_async_response_guards.md）：同一套
 * 「從 JavaScript.html 抓出原始碼、在 jsdom 裡真的執行、手動控制假
 * google.script.run 回應抵達順序」的技巧(見
 * test/ArticleDetailStalenessGuard.test.js),這次驗證的是編輯器。
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
      '<div id="editor-heading"></div>' +
      '<input id="editor-title" value="">' +
      '<select id="editor-category"><option value=""></option></select>' +
      '<div id="editor-attachment-section" class="hidden"></div>' +
      '<div id="editor-attachment-panel"></div>' +
      '<button id="btn-save-draft"></button>' +
      '<button id="btn-publish"></button>' +
      '</body></html>'
  );

  var calls = [];
  var tagPickerCalls = [];

  var context = {
    document: dom.window.document,
    easyMDEInstance: null,
    editorTagPicker: {
      setSelected: function (names) { tagPickerCalls.push(names); },
      getSelected: function () { return []; }
    },
    showView: function () {},
    enterEditor: function () {},
    showEditorAttachmentSection: function () {},
    updateEditorSeal: function () {},
    updateSaveDraftButtonLabel: function () {},
    updatePublishButtonVisibility: function () {},
    showError: function () {},
    google: { script: { run: null } }
  };
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
    extractVarDeclaration("editingArticleId"),
    extractFunction("resetEditorForm"),
    extractFunction("openArticleEditor"),
    extractFunction("setEditorBusy")
  ]
    .filter(Boolean)
    .join("\n\n");
  vm.runInContext(source, context);

  return { context: context, dom: dom, calls: calls, tagPickerCalls: tagPickerCalls };
}

function fakeArticle(id, title) {
  return {
    id: id,
    title: title,
    content_md: title + " body",
    category_id: null,
    status: "draft",
    tags: []
  };
}

describe("mycr F-06 fix: the editor stays consistent with what the user is currently doing, even when a slow load response arrives late", () => {
  test("openArticleEditor(A), user clicks 'new article' before A's response arrives: editingArticleId stays null, the title field stays blank", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;

    ctx.openArticleEditor("a1");
    ctx.resetEditorForm(); // 使用者在 a1 資料回來之前點了「新增文章」

    // a1 的回應這時候才晚到
    sandbox.calls[0].resolve(fakeArticle("a1", "Old title"));

    expect(ctx.editingArticleId).toBeNull();
    var doc = sandbox.dom.window.document;
    expect(doc.getElementById("editor-title").value).toBe("");
  });

  test("openArticleEditor(A) then openArticleEditor(B), with A's response arriving after B's: the form and editingArticleId end up matching B, not A", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;

    ctx.openArticleEditor("a1");
    ctx.openArticleEditor("a2");

    expect(sandbox.calls.length).toBe(2);
    // B(a2)先回應
    sandbox.calls.filter(function (c) { return c.articleId === "a2"; })[0]
      .resolve(fakeArticle("a2", "B title"));
    // A(a1)才晚到
    sandbox.calls.filter(function (c) { return c.articleId === "a1"; })[0]
      .resolve(fakeArticle("a1", "A title"));

    expect(ctx.editingArticleId).toBe("a2");
    var doc = sandbox.dom.window.document;
    expect(doc.getElementById("editor-title").value).toBe("B title");
  });

  test("save/publish buttons are disabled synchronously as soon as openArticleEditor is called, before any response arrives", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;
    var doc = sandbox.dom.window.document;

    ctx.openArticleEditor("a1");

    expect(doc.getElementById("btn-save-draft").disabled).toBe(true);
    expect(doc.getElementById("btn-publish").disabled).toBe(true);

    sandbox.calls[0].resolve(fakeArticle("a1", "A title"));

    expect(doc.getElementById("btn-save-draft").disabled).toBe(false);
    expect(doc.getElementById("btn-publish").disabled).toBe(false);
  });

  test("save/publish buttons are re-enabled even when the load fails", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;
    var doc = sandbox.dom.window.document;

    ctx.openArticleEditor("a1");
    expect(doc.getElementById("btn-save-draft").disabled).toBe(true);

    sandbox.calls[0].reject({ message: "boom" });

    expect(doc.getElementById("btn-save-draft").disabled).toBe(false);
    expect(doc.getElementById("btn-publish").disabled).toBe(false);
  });

  test("no race: a single openArticleEditor call still fills the form normally", () => {
    var sandbox = buildSandbox();
    var ctx = sandbox.context;

    ctx.openArticleEditor("a1");
    sandbox.calls[0].resolve(fakeArticle("a1", "A title"));

    expect(ctx.editingArticleId).toBe("a1");
    var doc = sandbox.dom.window.document;
    expect(doc.getElementById("editor-title").value).toBe("A title");
  });
});
