const fs = require("fs");
const path = require("path");

/**
 * bug fix(2026-09):新增文章時,前一篇文章的內容/標籤會以「殘影」形式殘留在
 * 表單裡——實際的表單狀態(easyMDEInstance.value()、editorTagPicker.getSelected()）
 * 其實已經正確清空,只是畫面沒有正確重繪。根因是 handleNewArticleClick_ 原本
 * 在 #view-article-editor 還是 display:none 的時候就呼叫 resetEditorForm()
 * (裡面會呼叫 easyMDEInstance.value('')),CodeMirror 內部用來量測文字換行/
 * 寬度的 getBoundingClientRect 在隱藏元素上量出來全部是 0,量錯的結果不會在
 * 容器之後變成可見時自動重新計算,畫面會卡著上一篇文章存檔當下的最後顯示
 * 內容。修法:把 showView('article-editor') 移到 resetEditorForm()/
 * enterEditor() 之前,並且在 resetEditorForm()/openArticleEditor() 裡都補上
 * easyMDEInstance.codemirror.refresh() 當保險,不完全依賴呼叫順序。
 *
 * 前端這裡比照專案既有的測試方式(見 EditorToolbarAndFormStacking.test.js 等):
 * 靜態文字掃描原始碼,不做真的 DOM/EasyMDE 行為模擬——鎖住的是「呼叫順序」跟
 * 「保險呼叫本身有沒有在」,不是實際重繪結果本身(那需要真的瀏覽器環境)。
 */
describe("article-editor view is made visible before EasyMDE/CodeMirror is mutated (JavaScript.html)", () => {
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );

  function extractFunctionBody(fnName) {
    const startMatch = javaScriptHtml.match(
      new RegExp("function\\s+" + fnName + "\\s*\\([^)]*\\)\\s*\\{")
    );
    if (!startMatch) return null;
    var start = startMatch.index + startMatch[0].length;
    // 從開頭大括號後面開始數,找到對應的結尾大括號(單純的括號計數,這幾個
    // 函式裡沒有字串/註解裡藏著不成對大括號的情況,這樣寫就夠用)。
    var depth = 1;
    var i = start;
    while (depth > 0 && i < javaScriptHtml.length) {
      if (javaScriptHtml[i] === "{") depth++;
      else if (javaScriptHtml[i] === "}") depth--;
      i++;
    }
    return javaScriptHtml.slice(start, i - 1);
  }

  test("handleNewArticleClick_ calls showView('article-editor') before resetEditorForm()", () => {
    const body = extractFunctionBody("handleNewArticleClick_");
    expect(body).not.toBeNull();
    const showViewIndex = body.indexOf("showView('article-editor')");
    const resetIndex = body.indexOf("resetEditorForm()");
    expect(showViewIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(-1);
    expect(showViewIndex).toBeLessThan(resetIndex);
  });

  test("resetEditorForm() calls codemirror.refresh() right after clearing the EasyMDE value", () => {
    const body = extractFunctionBody("resetEditorForm");
    expect(body).not.toBeNull();
    const clearIndex = body.indexOf("easyMDEInstance.value('')");
    const refreshIndex = body.indexOf("easyMDEInstance.codemirror.refresh()");
    expect(clearIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeLessThan(refreshIndex);
  });

  test("openArticleEditor still shows the view before it sets the EasyMDE value (existing-article edit path was already correct — guard against regressing it)", () => {
    const body = extractFunctionBody("openArticleEditor");
    expect(body).not.toBeNull();
    const showViewIndex = body.indexOf("showView('article-editor')");
    const setValueIndex = body.indexOf("easyMDEInstance.value(article.content_md");
    expect(showViewIndex).toBeGreaterThan(-1);
    expect(setValueIndex).toBeGreaterThan(-1);
    expect(showViewIndex).toBeLessThan(setValueIndex);
  });

  test("openArticleEditor also calls codemirror.refresh() after setting the value (same defense-in-depth as resetEditorForm)", () => {
    const body = extractFunctionBody("openArticleEditor");
    expect(body).not.toBeNull();
    const setValueIndex = body.indexOf("easyMDEInstance.value(article.content_md");
    const refreshIndex = body.indexOf("easyMDEInstance.codemirror.refresh()");
    expect(setValueIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(-1);
    expect(setValueIndex).toBeLessThan(refreshIndex);
  });
});
