const fs = require("fs");
const path = require("path");

/**
 * 前端行為測試(test/MarkdownSanitizationBehavior.test.js、
 * test/PreviewMarkdownSanitization.test.js)驗證的是 node_modules 裡的
 * marked/dompurify 實體檔案,而正式環境實際載入的是 Index.html 用 CDN
 * 鎖定版本的那一份——兩邊版本一旦不一樣,測試就是在驗證一個訪客根本沒在
 * 用的版本,通過也沒有意義。
 *
 * package.json 用 `^` 範圍的話,`npm update` 或自動更新工具(Dependabot)
 * 會悄悄把它升到跟 Index.html 不同的版本,CI 照樣綠燈。所以這兩個套件在
 * package.json 必須是精確版本,而且要跟 Index.html 鎖定的版本相同。
 * 要升級這兩個函式庫,必須 Index.html(版本號 + SRI hash)、package.json、
 * package-lock.json 一起改。
 */

const ROOT = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(ROOT, "src", "Index.html"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));

function pinnedCdnVersion(packageName) {
  const re = new RegExp("cdn\\.jsdelivr\\.net/npm/" + packageName + "@(\\d+\\.\\d+\\.\\d+)/");
  const match = indexHtml.match(re);
  return match ? match[1] : null;
}

describe("測試用的 marked/dompurify 版本跟 Index.html 鎖定的 CDN 版本一致", () => {
  ["marked", "dompurify"].forEach((name) => {
    test(name + ": Index.html 有鎖定精確版本(避免下面的比對因為沒資料而空轉)", () => {
      expect(pinnedCdnVersion(name)).not.toBeNull();
    });

    test(name + ": package.json 是精確版本(沒有 ^ 或 ~),且等於 Index.html 鎖定的版本", () => {
      expect(pkg.devDependencies[name]).toBe(pinnedCdnVersion(name));
    });

    test(name + ": package-lock.json 實際解析出來的版本也等於 Index.html 鎖定的版本", () => {
      expect(lock.packages["node_modules/" + name].version).toBe(pinnedCdnVersion(name));
    });
  });
});
