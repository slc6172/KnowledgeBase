const fs = require("fs");
const path = require("path");

/**
 * feature(附件多檔案上傳):比照專案既有的前端測試方式(靜態文字掃描原始碼,
 * 不做真的 DOM/瀏覽器行為模擬),見 ArticleEditorResetOrdering.test.js /
 * DestructiveActionConfirmation.test.js。鎖住的是結構性質(呼叫順序、資料夾
 * 只解析一次、逐檔案序列而非平行、單一檔案失敗不中止批次),不是實際上傳結果
 * 本身(那需要真的瀏覽器環境)。
 */
describe("attachment multi-file upload (JavaScript.html)", () => {
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
    var depth = 1;
    var i = start;
    while (depth > 0 && i < javaScriptHtml.length) {
      if (javaScriptHtml[i] === "{") depth++;
      else if (javaScriptHtml[i] === "}") depth--;
      i++;
    }
    return javaScriptHtml.slice(start, i - 1);
  }

  test("the file input allows selecting multiple files", () => {
    expect(javaScriptHtml).toEqual(
      expect.stringContaining('class="attachment-panel-file-input" multiple')
    );
  });

  test("handleUploadClick_ rejects a batch over the max file count before calling resolveFolderId or any google.script.run", () => {
    const body = extractFunctionBody("handleUploadClick_");
    expect(body).not.toBeNull();

    const capCheckIndex = body.indexOf("ATTACHMENT_UPLOAD_BATCH_MAX_FILES_");
    const resolveFolderIndex = body.indexOf("resolveFolderId(");
    expect(capCheckIndex).toBeGreaterThan(-1);
    expect(resolveFolderIndex).toBeGreaterThan(-1);
    expect(capCheckIndex).toBeLessThan(resolveFolderIndex);
  });

  test("resolveFolderId is called exactly once per upload click (in handleUploadClick_, not inside the per-file loop)", () => {
    const clickBody = extractFunctionBody("handleUploadClick_");
    const loopBody = extractFunctionBody("uploadNextFile_");
    expect(clickBody).not.toBeNull();
    expect(loopBody).not.toBeNull();

    const clickCalls = clickBody.match(/resolveFolderId\(/g) || [];
    expect(clickCalls.length).toBe(1);
    expect(loopBody).not.toEqual(expect.stringContaining("resolveFolderId("));
  });

  test("uploadNextFile_ chains sequentially (not Promise.all) and advances to the next file from both the success and the failure callback", () => {
    const body = extractFunctionBody("uploadNextFile_");
    expect(body).not.toBeNull();
    expect(body).not.toEqual(expect.stringContaining("Promise.all"));

    // runProtected(name, args, onSuccess, onFailure) — both callbacks must
    // recurse into uploadNextFile_ so one file's failure doesn't stop the batch.
    const recursiveCalls = body.match(/uploadNextFile_\(/g) || [];
    expect(recursiveCalls.length).toBeGreaterThanOrEqual(2);
  });

  test("refresh() is called once, after the whole batch finishes, not once per file inside uploadNextFile_", () => {
    const loopBody = extractFunctionBody("uploadNextFile_");
    expect(loopBody).not.toBeNull();
    expect(loopBody).not.toEqual(expect.stringContaining("refresh()"));

    const clickBody = extractFunctionBody("handleUploadClick_");
    expect(clickBody).not.toBeNull();
    expect(clickBody).toEqual(expect.stringContaining("refresh()"));
  });

  test("the upload button is wired to handleUploadClick_", () => {
    expect(javaScriptHtml).toEqual(
      expect.stringContaining("uploadBtn.addEventListener('click', handleUploadClick_)")
    );
  });
});
