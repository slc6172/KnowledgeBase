// docs/schema.sql 與設計文件必須描述「最終狀態」,以全新的 Supabase 專案為前提。
// 本專案目標是從無到有佈建,不維護升級腳本:schema 不得靠 alter / drop 補丁堆疊,
// 文件也不得殘留已經不是事實的舊說法(這些都曾經發生過,見 README 變更紀錄第 94 條)。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
// 只看可執行的 SQL,不看註解
const sqlOnly = (sql) => sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

describe("docs/schema.sql 是最終狀態,不含升級補丁", () => {
  const schema = read("docs/schema.sql");
  const code = sqlOnly(schema);

  test("沒有 drop table / drop index / drop column", () => {
    expect(code).not.toMatch(/\bdrop\s+(table|index|column)\b/i);
  });

  test("沒有對既有資料表追加欄位的 alter table ... add column", () => {
    expect(code).not.toMatch(/alter\s+table\s+\w+\s+add\s+column/i);
  });

  test("attachments 的 folder_id 內嵌在 create table,且 attachment_folders 先於 attachments 建立", () => {
    const folders = code.search(/create table attachment_folders\b/i);
    const attachments = code.search(/create table attachments\b/i);
    expect(folders).toBeGreaterThan(-1);
    expect(attachments).toBeGreaterThan(folders);
    const attachmentsDef = code.slice(attachments, code.indexOf(");", attachments));
    expect(attachmentsDef).toMatch(/folder_id\s+uuid\s+references\s+attachment_folders\(id\)\s+on delete set null/i);
  });

  test("關鍵字搜尋只有一個 trigram 索引,且運算式與 hybrid_search_articles 的比對運算式一致", () => {
    const trgmIndexes = code.match(/create index \w+\s+on articles\s+using gin/gi) || [];
    expect(trgmIndexes).toHaveLength(1);
    expect(code).toMatch(/using gin \(\(title \|\| ' ' \|\| content_md\) extensions\.gin_trgm_ops\)/i);
    expect(code).toMatch(/similarity\(a\.title \|\| ' ' \|\| a\.content_md, query_text\)/);
  });

  test("vector 與 pg_trgm 建在 extensions schema,型別與運算子類別使用全限定名稱(不依賴 search_path)", () => {
    expect(code).toMatch(/create extension if not exists vector\s+with schema extensions;/i);
    expect(code).toMatch(/create extension if not exists pg_trgm\s+with schema extensions;/i);
    expect(code).not.toMatch(/(^|[^.\w])vector\(768\)/m); // 一律寫成 extensions.vector(768)
    expect(code).not.toMatch(/[^.\w]vector_cosine_ops/);
    expect(code).not.toMatch(/[^.\w]gin_trgm_ops/);
  });

  test("所有函式都固定 search_path = public, extensions", () => {
    const fnCount = (code.match(/create or replace function \w+\(/gi) || []).length;
    const fixed = (code.match(/set search_path = public, extensions/gi) || []).length;
    expect(fnCount).toBeGreaterThanOrEqual(4);
    expect(fixed).toBe(fnCount);
  });

  test("搜尋用的向量只存在 article_chunks:articles 沒有 embedding 欄位、沒有舊的向量索引", () => {
    const articlesDef = code.slice(code.search(/create table articles\b/i), code.indexOf(");", code.search(/create table articles\b/i)));
    expect(articlesDef).not.toMatch(/\bembedding\b/i);
    expect(code).not.toMatch(/articles_embedding_idx/);
    expect(code).toMatch(/create table article_chunks\b/i);
    expect(code).toMatch(/article_chunks_embedding_idx/);
  });

  test("所有資料表都開啟 RLS", () => {
    ["categories", "tags", "articles", "article_tags", "attachments", "attachment_folders", "article_chunks"].forEach((t) => {
      expect(code).toMatch(new RegExp("alter table " + t + " enable row level security;", "i"));
    });
  });

  test("說明文字不再把 GAS 描述成持有 service_role key 的直連架構", () => {
    expect(schema).not.toMatch(/GAS 後端專用 service_role/);
    expect(schema).not.toMatch(/\{uuid\}_\{file_name\}/);
    expect(schema).toMatch(/kb-proxy/);
  });

  test("hybrid_search_articles 的預設語意距離門檻與註解一致(0.4)", () => {
    expect(code).toMatch(/max_semantic_distance\s+float default 0\.4/);
    expect(schema).toMatch(/預設 0\.4/);
    expect(schema).not.toMatch(/0\.6 是經驗值起點/);
  });
});

describe("DESIGN.md 與現況一致", () => {
  const design = read("docs/DESIGN.md");

  test("儲存路徑是 {article_id}/{uuid}[.副檔名],不是舊的 {uuid}_{file_name}", () => {
    expect(design).not.toMatch(/\{uuid\}_\{file_?name\}/);
  });

  test("沒有已經不存在的函式名稱 getCodeAttachmentContent;預覽函式是 getTextAttachmentContent", () => {
    expect(design).not.toMatch(/getCodeAttachmentContent/);
    expect(design).toMatch(/getTextAttachmentContent/);
  });

  test("架構圖含 AI 問答與 attachment_folders,不再寫「未來 QA」", () => {
    expect(design).toMatch(/attachment_folders/);
    expect(design).toMatch(/generateContent\(AI 問答\)/);
    expect(design).not.toMatch(/未來 QA/);
  });

  test("決策表沒有「不做 RLS」這種與現況矛盾的說法,也沒有「原為直連」的升級敘事", () => {
    expect(design).not.toMatch(/不做 Supabase Auth \/ RLS/);
    expect(design).not.toMatch(/原為直連/);
    expect(design).not.toMatch(/由第 2 列的直連改為經代理/);
  });
});

describe("CLAUDE.md 記載從無到有原則", () => {
  test("明確寫出不以升級為設計前提,且 schema.sql 是最終狀態", () => {
    const claude = read("CLAUDE.md");
    expect(claude).toMatch(/從無到有/);
    expect(claude).toMatch(/最終狀態/);
  });
});
