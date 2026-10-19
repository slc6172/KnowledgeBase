// spec_chunked_embeddings 票 09:文件與實作一致。
// 為什麼要測文件:這次改動取代了一條舊的設計決策(「整篇一個向量、不切 chunk」),
// 舊說法留在文件裡會誤導下一個人;新的接縫(SQL 整合測試、tools/)沒寫下來就等於不存在。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const readmeCurrent = () => {
  const readme = read("README.md");
  return readme.slice(0, readme.indexOf("## 已知問題修復紀錄"));
};

describe("DESIGN.md:決策表與資料流反映分段向量", () => {
  const design = read("docs/DESIGN.md");

  test("舊決策『整篇一個向量(不切 chunk)、存在 articles.embedding』已被取代,不再出現", () => {
    // 「取代了什麼」的歷史說明可以提到舊決策;但不能再有仍在生效的舊叙述(決策列本身、資料流)
    expect(design).not.toMatch(/\| 整篇文章一個向量(不切 chunk),存在/);
    expect(design).not.toMatch(/articles\.embedding/);
    expect(design).not.toMatch(/寫回 `articles\.embedding`/);
  });

  test("新決策寫明:分段、每段約 1,500 字、段落表、原子寫入、段數上限、最近段落", () => {
    expect(design).toMatch(/article_chunks/);
    expect(design).toMatch(/1,500/);
    expect(design).toMatch(/save_article/);
    expect(design).toMatch(/40 段/);
    expect(design).toMatch(/最接近的那一段|最近的那一段|最接近那一段/);
  });

  test("說明為什麼分段(模型輸入上限約 2,048 token、靜默截斷)與被取代的替代方案", () => {
    expect(design).toMatch(/2,048/);
    expect(design).toMatch(/靜默截斷/);
    expect(design).toMatch(/取平均/);
  });

  test("架構圖列出新的 RPC 與段落表;資料庫 RPC 清單包含 merge_tags / save_article / articles_needing_reindex", () => {
    expect(design).toMatch(/article_chunks/);
    for (const rpc of ["merge_tags", "save_article", "articles_needing_reindex"]) expect(design).toContain(rpc);
  });
});

describe("README:快速開始與測試說明", () => {
  const current = readmeCurrent();

  test("快速開始列出全部 RPC 與段落表,並說明 schema 一次建好、不需要升級腳本", () => {
    for (const rpc of ["hybrid_search_articles", "related_articles", "articles_by_tags", "merge_tags", "save_article", "articles_needing_reindex"]) {
      expect(current).toContain(rpc);
    }
    expect(current).toMatch(/article_chunks/);
  });

  test("說明 SQL 整合測試的啟用方式(TEST_DATABASE_URL)與 CI 的 pgvector 服務容器", () => {
    expect(current).toMatch(/TEST_DATABASE_URL/);
    expect(current).toMatch(/pgvector\/pgvector:pg16/);
  });

  test("README 寫明重建工具要在新版上線之後才上傳(不是『目前已部署的版本』),驗證工具則是獨立的", () => {
    expect(current).not.toMatch(/需要專案目前已部署的版本一起存在/);
    expect(current).toMatch(/clasp push 之後|已經是包含分段向量功能的新版本/);
    expect(current).toMatch(/VerifyBatchEmbedding\.gs[^\n]*(獨立|新版程式還沒上線)|獨立[^\n]*VerifyBatchEmbedding/);
  });

  test("說明 tools/ 的重建工具:什麼時候用、三道防護、用完刪除", () => {
    expect(current).toMatch(/tools\/Reindex\.gs/);
    expect(current).toMatch(/REINDEX_ENABLED/);
    expect(current).toMatch(/reindexDryRun/);
    expect(current).toMatch(/刪除/);
  });

  test("專案結構列出 tools/,且前端測試說明之外有 SQL 整合測試的說明", () => {
    expect(current).toMatch(/├── tools\/|tools\/\s+一次性/);
    expect(current).toMatch(/SQL 整合測試/);
  });
});

describe("CLAUDE.md:給下一個協作者的接縫與慣例", () => {
  const claude = read("CLAUDE.md");

  test("記載 SQL 整合測試接縫:TEST_DATABASE_URL、未設定時跳過、每個測試檔自己的臨時資料庫", () => {
    expect(claude).toMatch(/TEST_DATABASE_URL/);
    expect(claude).toMatch(/跳過|skipped/);
    expect(claude).toMatch(/test\/sql\//);
  });

  test("記載 tools/ 資料夾與重建工具的定位(不在 src/、用完即刪、不帶底線的入口)", () => {
    expect(claude).toMatch(/tools\//);
    expect(claude).toMatch(/用完即刪|用完刪除|用完即先刪除/);
  });

  test("記載文章寫入一律走 save_article(單一交易),以及 extensions schema 與 search_path 的規則", () => {
    expect(claude).toMatch(/save_article/);
    expect(claude).toMatch(/extensions/);
    expect(claude).toMatch(/search_path/);
  });

  test("提醒:article_chunks 刻意不在代理白名單;新增資料表要決定開放或刻意不開放", () => {
    expect(claude).toMatch(/article_chunks/);
    expect(claude).toMatch(/INTENTIONALLY_PRIVATE_TABLES|刻意不(對外)?開放/);
  });
});

describe("上線清單(docs/tickets/chunked-embeddings/rollout/)", () => {
  const dir = "docs/tickets/chunked-embeddings/rollout";
  const checklist = () => read(`${dir}/rollout-checklist.md`);

  test("清單的第 0 步說明驗證工具是獨立的、可以在新版上線之前執行;重建工具則在 clasp push 之後", () => {
    const text = checklist();
    expect(text).toMatch(/獨立/);
    expect(text).toMatch(/還沒上線|上線之前|上線前/);
    expect(text.indexOf("reindexDryRun")).toBeGreaterThan(text.indexOf("### 3. 上線新版 GAS"));
    expect(text).toMatch(/Reindex\.gs.{0,40}依賴新版程式/s);
  });

  test("資料夾包含 migration、升級前 schema 快照與清單", () => {
    for (const f of ["migration.sql", "schema-before.sql", "rollout-checklist.md"]) {
      expect(fs.existsSync(path.join(ROOT, dir, f))).toBe(true);
    }
  });

  test("清單涵蓋 spec〈上線〉的每一步,而且順序正確:migration → 部署代理 → clasp push → 重建工具 → 刪檔", () => {
    const text = checklist();
    const order = ["migration", "kb-proxy", "clasp push", "reindexDryRun", "reindexAllArticles", "刪除"].map((k) => text.indexOf(k));
    order.forEach((idx, i) => expect(`${i}:${idx > -1}`).toBe(`${i}:true`));
    // 第一次出現的位置必須是遞增的
    const firsts = ["套用 migration", "部署 Edge Function", "clasp push", "reindexDryRun", "reindexAllArticles", "刪除工具檔"].map((k) => text.indexOf(k));
    firsts.forEach((idx, i) => expect(`${i}:${idx > -1}`).toBe(`${i}:true`));
    expect([...firsts].sort((a, b) => a - b)).toEqual(firsts);
  });

  test("清單明確標示停機窗口、失敗時的處理,以及上線後要移除一次性的 migration 等價性測試", () => {
    const text = checklist();
    expect(text).toMatch(/停機/);
    expect(text).toMatch(/失敗|回滾/);
    expect(text).toMatch(/MigrationEquivalence/);
  });

  test("migration 是單一交易、且標明它不是專案的升級機制", () => {
    const m = read(`${dir}/migration.sql`);
    expect(m).toMatch(/^begin;$/m);
    expect(m.trim()).toMatch(/commit;$/);
    expect(m).toMatch(/不是專案的升級機制/);
  });
});


describe("Gemini 額度(免費層每分鐘 100 個請求、每天 1,000 個,每一段文字算一個)寫進文件", () => {
  test("README 說明額度、對發布與重建的影響,並標明『每一段算一個』是實測推論", () => {
    const current = readmeCurrent();
    expect(current).toMatch(/每分鐘\s*100/);
    expect(current).toMatch(/每天\s*1,000|1,000\s*個/);
    expect(current).toMatch(/每一段(文字)?算一個/);
    expect(current).toMatch(/推論|實測/);
  });

  test("DESIGN.md 的決策記錄額度,以及它對『段數上限 40』與重建工具的意義", () => {
    const design = read("docs/DESIGN.md");
    expect(design).toMatch(/每分鐘\s*100/);
    expect(design).toMatch(/429/);
  });

  test("spec 的 Further Notes 記載 2026-10-03 的批次實測結果(順序一致、41 筆可行、100 筆 429)", () => {
    const spec = read("docs/specs/spec_chunked_embeddings.md");
    expect(spec).toMatch(/2026-10-03[^\n]*(實測|驗證)/);
    expect(spec).toMatch(/順序一致/);
    expect(spec).toMatch(/41 筆/);
  });
});


describe("上線結果與距離門檻的量測(2026-10-08)", () => {
  test("DESIGN.md 記錄量測結果:不相干主題的距離 0.351 低於搜尋門檻 0.4、相關文章門檻 0.6 在現有資料上沒有過濾效果,並寫明為什麼先維持原數字", () => {
    const design = read("docs/DESIGN.md");
    expect(design).toMatch(/0\.351/);
    expect(design).toMatch(/0\.6[^\n]*(沒有過濾|100%)/);
    expect(design).toMatch(/維持 0\.4/);
    expect(design).toMatch(/測試文/);
    expect(design).toMatch(/真實文章/);
  });

  test("上線資料夾附有重新量測門檻的 SQL,而且是唯讀的查詢", () => {
    const sql = read("docs/tickets/chunked-embeddings/rollout/measure-thresholds.sql");
    expect(sql).toMatch(/article_chunks/);
    expect(sql).toMatch(/min\(/i);
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/i);
  });

  test("票 10 記錄上線結果:migration 與代理的版本、資料筆數保留、重建結果、F-03 的端到端證明", () => {
    const t = read("docs/tickets/chunked-embeddings/issues/10-rollout-and-measure.md");
    expect(t).toMatch(/版本 13/);
    expect(t).toMatch(/23\s*\/\s*4\s*\/\s*20\s*\/\s*25\s*\/\s*6/);
    expect(t).toMatch(/47 段/);
    expect(t).toMatch(/0\.067/);
    expect(t).toMatch(/0\.097/);
  });

  test("一次性的 migration 等價性測試已移除(schema.sql 繼續演進後它就不再成立),migration 與快照留在上線資料夾當歷史", () => {
    expect(fs.existsSync(path.join(ROOT, "test/sql/MigrationEquivalence.test.js"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "docs/tickets/chunked-embeddings/rollout/migration.sql"))).toBe(true);
  });
});
