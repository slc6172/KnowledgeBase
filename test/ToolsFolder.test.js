const fs = require("fs");
const path = require("path");

/**
 * 票 03:tools/ 是「需要時才手動上傳、用完即刪」的一次性工具,不能被 clasp 推送,
 * 而且只有明確的入口函式才不帶底線(才會變成 google.script.run 的公開端點)。
 */
const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("tools/ 資料夾", () => {
  test("clasp 的 rootDir 是 ./src,所以 tools/ 不會被一般推送帶上去", () => {
    const clasp = JSON.parse(read(".clasp.json.example"));
    expect(clasp.rootDir).toBe("./src");
    expect(fs.existsSync(path.join(ROOT, "tools/Reindex.gs"))).toBe(true);
  });

  test("src/ 裡沒有任何重建工具的入口函式(它們只存在於 tools/)", () => {
    const srcDir = path.join(ROOT, "src");
    const all = fs.readdirSync(srcDir).filter((f) => f.endsWith(".gs")).map((f) => read(`src/${f}`)).join("\n");
    expect(all).not.toMatch(/function\s+reindex\w*\s*\(/);
  });

  test("tools/ 底下每個檔案只有明確的入口函式不帶底線,其餘一律是私有函式", () => {
    const toolFiles = fs.readdirSync(path.join(ROOT, "tools")).filter((f) => f.endsWith(".gs"));
    expect(toolFiles).toEqual(expect.arrayContaining(["Reindex.gs", "VerifyBatchEmbedding.gs"]));
    // 票 08 完成後會再加入 reindexAllArticles
    const allowed = new Set(["reindexDryRun", "reindexAllArticles", "verifyBatchEmbedding"]);
    const publicNames = toolFiles.flatMap((f) =>
      [...read(`tools/${f}`).matchAll(/^function\s+(\w+)\s*\(/gm)].map((m) => m[1]).filter((n) => !n.endsWith("_"))
    );
    expect(publicNames).toEqual(expect.arrayContaining(["reindexDryRun", "verifyBatchEmbedding"]));
    expect(publicNames.filter((n) => !allowed.has(n))).toEqual([]);
  });

  test("驗證函式的說明寫明:用完刪除、受 REINDEX_ENABLED 控管", () => {
    const head = read("tools/VerifyBatchEmbedding.gs").slice(0, 2500);
    expect(head).toMatch(/REINDEX_ENABLED/);
    expect(head).toMatch(/刪除/);
  });

  test("檔案頂端的說明寫明用法:REINDEX_ENABLED、先試跑、用完刪除", () => {
    const head = read("tools/Reindex.gs").slice(0, 2500);
    expect(head).toMatch(/REINDEX_ENABLED/);
    expect(head).toMatch(/reindexDryRun/);
    expect(head).toMatch(/刪除/);
  });

  test("重建工具的說明寫明:必須在新版程式(含分段向量)上線之後才能上傳,因為它依賴新版才有的函式", () => {
    const head = read("tools/Reindex.gs").slice(0, 3500);
    expect(head).toMatch(/clasp push 之後|新版程式.{0,12}上線之後|已經是包含分段向量/);
    expect(head).toMatch(/splitIntoChunks_|generateEmbeddingsBatch_|save_article/);
  });

  test("向量維度與資料庫欄位一致:schema 的 vector(768) = EMBEDDING_DIMENSIONS_", () => {
    const dims = Number(read("src/Embeddings.gs").match(/var EMBEDDING_DIMENSIONS_\s*=\s*(\d+)/)[1]);
    expect(read("docs/schema.sql")).toMatch(new RegExp("extensions\\.vector\\(" + dims + "\\)"));
  });
});
