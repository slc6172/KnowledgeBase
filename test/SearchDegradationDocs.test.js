// 文件靜態掃描:降級策略必須被記錄在使用者會看的地方,
// 且文件不得誤導(例如說需要資料庫遷移,或把 AI 問答也寫成會降級)。
const fs = require("fs");
const path = require("path");
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("搜尋降級的文件", () => {
  const readme = read("README.md");
  const entry = readme.slice(readme.indexOf("90. **語意搜尋失敗時降級為關鍵字搜尋**"), readme.indexOf("## 開發過程文件"));

  test("README 有變更紀錄,並寫明不需要資料庫遷移、AI 問答不降級、短查詢的已知限制", () => {
    expect(entry.length).toBeGreaterThan(0);
    expect(entry).toMatch(/不需要任何\s*schema 變更/);
    expect(entry).toMatch(/askKnowledgeBase/);
    expect(entry).toMatch(/短查詢/);
    expect(entry).toMatch(/`\{ articles, degraded \}`/);
  });

  test("DESIGN 決策表有降級策略那一列", () => {
    expect(read("docs/DESIGN.md")).toMatch(/^\| 18 \| 搜尋降級策略/m);
  });

  test("CLAUDE.md 已把本 spec 從「進行中」移除,並記錄新的回傳形狀慣例", () => {
    const claude = read("CLAUDE.md");
    expect(claude).not.toMatch(/spec_search_degradation/);
    expect(claude).toMatch(/\{ articles, degraded \}/);
  });
});
