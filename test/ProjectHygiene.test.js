// 專案衛生的靜態檢查:已移除的過期檔案不再被現行文件指向、刻意的編碼慣例有被記載。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
// 「現行說明」= README 變更紀錄(歷史)之前的全部章節
const readmeCurrent = () => {
  const readme = read("README.md");
  return readme.slice(0, readme.indexOf("## 已知問題修復紀錄"));
};

describe("mycr F-17:過期的 docs/preview/Preview.html 已移除", () => {
  test("docs/preview 目錄不存在", () => {
    expect(fs.existsSync(path.join(ROOT, "docs/preview"))).toBe(false);
  });

  test("README 現行章節、CLAUDE.md、DESIGN.md 都不再指向它", () => {
    for (const [name, text] of [
      ["README(現行章節)", readmeCurrent()],
      ["CLAUDE.md", read("CLAUDE.md")],
      ["docs/DESIGN.md", read("docs/DESIGN.md")]
    ]) {
      expect(`${name}: ${/Preview\.html|docs\/preview/.test(text)}`).toBe(`${name}: false`);
    }
  });

  test("沒有任何測試檔再讀取 docs/preview(守護已刪除檔案的測試也一併移除)", () => {
    const testDir = path.join(ROOT, "test");
    const offenders = fs
      .readdirSync(testDir)
      .filter((f) => f.endsWith(".js") && f !== "ProjectHygiene.test.js")
      .filter((f) => /docs\/preview|Preview\.html/.test(read(`test/${f}`)));
    expect(offenders).toEqual([]);
  });
});

describe("mycr F-17:var 是刻意的編碼慣例,有被記載", () => {
  test("CLAUDE.md 說明 src 使用 ES5 風格的 var,不要遷移成 let / const", () => {
    const claude = read("CLAUDE.md");
    expect(claude).toMatch(/var/);
    expect(claude).toMatch(/刻意/);
    expect(claude).toMatch(/let\s*\/\s*const|let 與 const|`let`/);
  });
});
