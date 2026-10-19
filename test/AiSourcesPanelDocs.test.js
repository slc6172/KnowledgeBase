// 文件靜態掃描:AI 來源面板的變更紀錄必須存在,且 CLAUDE.md 不再把已完成的 spec 列為「進行中」。
const fs = require("fs");
const path = require("path");
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("AI 來源面板的文件", () => {
  test("README 有變更紀錄,措辭說明是「檢索結果」而非 Gemini 實際引用", () => {
    const readme = read("README.md");
    const entry = readme.slice(readme.indexOf("91. **AI 回答的"), readme.indexOf("## 開發過程文件"));
    expect(entry.length).toBeGreaterThan(0);
    expect(entry).toMatch(/檢索結果/);
    expect(entry).toMatch(/categoryName/);
    expect(entry).toMatch(/預設收合/);
  });

  test("CLAUDE.md 不再有「進行中」的 spec 清單(三份 spec 都已完成)", () => {
    const claude = read("CLAUDE.md");
    expect(claude).not.toMatch(/## 進行中/);
    expect(claude).not.toMatch(/spec_ai_sources_panel|spec_search_degradation|spec_edge_function_proxy/);
  });
});
