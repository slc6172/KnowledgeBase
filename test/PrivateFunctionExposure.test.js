const fs = require("fs");
const path = require("path");

/**
 * 這批函式原本是 Auth.gs 白名單裡的寫入函式、SupabaseClient.gs 的泛用資料庫存取
 * 函式,以及 Config.gs 的一次性初始化/診斷函式。Apps Script 的規則是:專案裡所有
 * 沒有底線字首的頂層函式,一律會自動暴露成用戶端可以直接呼叫的公開端點,跟這個
 * 函式有沒有被前端程式碼實際呼叫過無關。
 *
 * 這個規則沒辦法透過一般的行為測試驗證——測試環境沒辦法真的模擬「有沒有暴露給
 * 用戶端」這件平台層級的行為,所以改成直接檢查原始碼文字:只要這裡列出的函式
 * 宣告時仍然帶底線字首,就代表它們維持在不會被平台自動暴露的狀態。
 */

const TARGETS = [
  { file: "Articles.gs", names: [
    "createArticle",
    "updateArticle",
    "deleteArticle",
    "setArticleStatus",
    "batchDeleteArticles",
    "batchSetArticlesCategory",
    "batchAddTagsToArticles"
  ] },
  { file: "Categories.gs", names: [
    "createCategory",
    "updateCategory",
    "moveCategory",
    "deleteCategory"
  ] },
  { file: "Tags.gs", names: [
    "renameTag",
    "deleteTag",
    "mergeTags"
  ] },
  { file: "Attachments.gs", names: [
    "uploadAttachmentFile",
    "addAttachmentUrl",
    "deleteAttachment",
    "createFolder",
    "renameFolder",
    "deleteFolder"
  ] },
  { file: "SupabaseClient.gs", names: [
    "supabaseRequest",
    "supabaseSelect",
    "supabaseInsert",
    "supabaseUpdate",
    "supabaseDelete",
    "supabaseRpc"
  ] },
  { file: "Config.gs", names: [
    "debugConfig",
    "setupScriptProperties"
  ] }
];

const CASES = TARGETS.flatMap(({ file, names }) =>
  names.map((name) => [file, name])
);

describe("write functions and generic Supabase proxy functions stay private", () => {
  test.each(CASES)(
    "%s declares %s with a trailing underscore (not exposed to google.script.run)",
    (file, name) => {
      const filePath = path.join(__dirname, "../src", file);
      const source = fs.readFileSync(filePath, "utf8");
      const privateDeclaration = new RegExp("function\\s+" + name + "_\\s*\\(");
      const publicDeclaration = new RegExp("function\\s+" + name + "\\s*\\(");

      expect(source).toMatch(privateDeclaration);
      expect(source).not.toMatch(publicDeclaration);
    }
  );
});
