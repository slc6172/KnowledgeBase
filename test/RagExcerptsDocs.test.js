// 文件靜態掃描(spec_rag_excerpts.md):決策、變更紀錄、慣例都要寫回文件。
const fs = require("fs");
const path = require("path");
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// 取決策表中以「| N |」開頭的那一列
const designRow = (design, n) => {
  const match = design.match(new RegExp("^\\| " + n + " \\|.*$", "m"));
  return match ? match[0] : "";
};

describe("AI 問答節錄與查詢向量快取的文件", () => {
  const design = read("docs/DESIGN.md");

  test("DESIGN.md 決策 24:AI 問答由整篇全文改為節錄(篇數、字數上限、標示、風險)", () => {
    const row = designRow(design, 24);
    expect(row).toMatch(/AI 問答/);
    expect(row).toMatch(/節錄/);
    expect(row).toMatch(/8 篇/);
    expect(row).toMatch(/1,500/);
    expect(row).toMatch(/第 N 段/);
    expect(row).toMatch(/文章開頭/);
    expect(row).toMatch(/F-14/);
    // 被排除的替代方案與已知風險要留下紀錄
    expect(row).toMatch(/被排除/);
    expect(row).toMatch(/以偏概全|不足/);
  });

  test("DESIGN.md 決策 25:查詢向量快取與額度規則(60 秒、雜湊鍵、模型識別、節流計數點、公開讀取額度)", () => {
    const row = designRow(design, 25);
    expect(row).toMatch(/查詢向量快取/);
    expect(row).toMatch(/60 秒/);
    expect(row).toMatch(/SHA-256/);
    expect(row).toMatch(/模型識別/);
    expect(row).toMatch(/節流/);
    expect(row).toMatch(/公開讀取額度/);
    expect(row).toMatch(/第四個/);
    expect(row).toMatch(/opts/);
    expect(row).toMatch(/F-08/);
  });

  test("DESIGN.md 資料流:搜尋提到快取、有 AI 問答的資料流並說明節錄", () => {
    const flows = design.slice(design.indexOf("## 3. 主要資料流"), design.indexOf("## 4."));
    expect(flows).toMatch(/\*\*搜尋\*\*[\s\S]*快取/);
    expect(flows).toMatch(/\*\*AI 問答\*\*[\s\S]*節錄/);
  });

  test("README:有新的變更紀錄(F-14、F-08),並在 Gemini 額度段落說明一次搜尋只算一次嵌入", () => {
    const readme = read("README.md");
    const entry = readme.slice(readme.indexOf("98. **AI 問答改送節錄"), readme.indexOf("## 開發過程文件"));
    expect(entry.length).toBeGreaterThan(0);
    expect(entry).toMatch(/F-14/);
    expect(entry).toMatch(/F-08/);
    expect(entry).toMatch(/節錄/);
    expect(entry).toMatch(/查詢向量快取/);
    // 不要在文件裡寫測試總數(寫死的數字會過期)
    expect(entry).not.toMatch(/\d+\s*(個測試|tests?\b|項測試)/);

    const quota = readme.slice(readme.indexOf("**Gemini 額度"), readme.indexOf("### 7. 跑測試"));
    expect(quota).toMatch(/一次搜尋只算一次嵌入/);
  });

  test("CLAUDE.md:新增「內部開關絕不能從公開函式的 opts 讀取」慣例", () => {
    const claude = read("CLAUDE.md");
    expect(claude).toMatch(/內部開關絕不能從公開函式的 `opts` 讀取/);
    expect(claude).toMatch(/skipPublicReadRateLimit/);
  });

  test("spec_ai_sources_panel.md 的 Further Notes 指向本 spec,不再說 AI 問答送全文是待評估", () => {
    const spec = read("docs/specs/spec_ai_sources_panel.md");
    const notes = spec.slice(spec.indexOf("## Further Notes"));
    expect(notes).toMatch(/spec_rag_excerpts\.md/);
    expect(notes).not.toMatch(/之後可評估降低 RAG 專用的檢索筆數/);
  });

  test("spec_rag_excerpts.md 已經擁有者確認:status 不再是 needs-review", () => {
    const spec = read("docs/specs/spec_rag_excerpts.md");
    const frontMatter = spec.slice(0, spec.indexOf("\n---", 4));
    expect(frontMatter).toMatch(/status: ready-for-agent/);
    expect(frontMatter).not.toMatch(/needs-review/);
  });

  test("README 功能描述與架構圖反映節錄與查詢向量快取,測試輔助說明含 CacheService", () => {
    const readme = read("README.md");
    const features = readme.slice(readme.indexOf("- **AI 知識庫問答**"), readme.indexOf("- **響應式版型**"));
    expect(features).toMatch(/節錄/);
    const diagram = readme.slice(readme.indexOf("```mermaid"), readme.indexOf("```", readme.indexOf("```mermaid") + 10));
    expect(diagram).toMatch(/查詢向量快取/);
    expect(readme).toMatch(/假 httpFetch_\/PropertiesService\/CacheService\/Utilities/);
  });

  test("README 較早條目裡「AI 問答仍送全文 / F-14 待處理」的敘述都指向第 98 條,不會誤導讀者", () => {
    const readme = read("README.md");
    // 三種過時說法:「仍送整篇全文」「F-14 + F-08(待處理)」「最多 20 篇文章全文」
    const stale = /AI 問答仍送整篇全文|F-14 \+ F-08|最多 20 篇文章全文/g;
    const history = readme.slice(0, readme.indexOf("98. **AI 問答改送節錄"));
    const hits = [];
    let m;
    while ((m = stale.exec(history)) !== null) {
      hits.push(history.slice(m.index, m.index + 120));
    }
    expect(hits.length).toBeGreaterThanOrEqual(4);
    hits.forEach((h) => expect(h).toMatch(/第 98 條/));
  });

  test("spec_chunked_embeddings.md 的後續說明指向 spec_rag_excerpts.md(F-14、F-08 已處理)", () => {
    const spec = read("docs/specs/spec_chunked_embeddings.md");
    const notes = spec.slice(spec.indexOf("## Further Notes"));
    expect(notes).toMatch(/spec_rag_excerpts\.md/);
    expect(notes).not.toMatch(/F-14 與 F-08（?\(?AI 問答成本、重複嵌入[^\n]*仍待後續/);
  });
});
