const fs = require("fs");
const path = require("path");

/**
 * 分享連結帶入的文章 id 曾經直接用不跳脫樣板標籤塞進指令碼區塊,導致內容裡的
 * 字元可以提早結束外層區塊、注入任意可執行內容(細節見 README 已知問題修復
 * 紀錄)。這個測試不走 loadGas/global,直接讀原始碼文字比對,確保:
 * 1. 舊的、有問題的寫法不會再出現。
 * 2. 新的做法(先寫進頁面元素的資料屬性,搭配平台自動跳脫的樣板標籤輸出)
 *    確實存在。
 * 3. 前端啟動邏輯確實改成從這個資料屬性讀值。
 */

describe("share-link article id is no longer printed unescaped into a script block", () => {
  const indexHtml = fs.readFileSync(
    path.join(__dirname, "../src/Index.html"),
    "utf8"
  );
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );

  test("Index.html no longer force-prints initialArticleId into a script block", () => {
    expect(indexHtml).not.toMatch(
      /<\?!=\s*JSON\.stringify\(\s*initialArticleId\s*\)\s*\?>/
    );
  });

  test("Index.html prints initialArticleId through the auto-escaping attribute form", () => {
    expect(indexHtml).toMatch(
      /data-initial-article-id="<\?=\s*initialArticleId\s*\?>"/
    );
  });

  test("JavaScript.html reads the article id from the data attribute", () => {
    expect(javaScriptHtml).toMatch(/document\.body\.dataset\.initialArticleId/);
  });
});
