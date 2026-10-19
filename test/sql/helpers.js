/**
 * SQL 整合測試的共用輔助(docs/specs/spec_chunked_embeddings.md 的新接縫)。
 *
 * 啟用方式:設定環境變數 TEST_DATABASE_URL 指向一個「可建立資料庫、建立角色、建立擴充功能」的
 * PostgreSQL(16 + pgvector)。未設定時,describeSql 會把整批測試標為 skipped,本機的
 * `npm test` 不需要任何資料庫。CI 以 pgvector/pgvector:pg16 服務容器真的執行。
 *
 * 隔離:每個測試檔建立自己專屬的臨時資料庫(Jest 會平行執行多個測試檔),結束後刪除。
 * 模擬 Supabase:先建立 anon / authenticated / service_role 角色與預設授權、預先存在的
 * extensions schema,再執行專案的 docs/schema.sql——因此測得到「RLS 開了但沒有 policy」
 * 與「匿名角色讀寫不到任何東西」這類在 Supabase 上才有意義的行為。
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SQL_ENABLED = Boolean(process.env.TEST_DATABASE_URL);
const describeSql = SQL_ENABLED ? describe : describe.skip;

// KB_SCHEMA_FILE 只給「拿另一份 schema 當對照組」的場合使用(例如驗證 migration、比對搬家前後的行為);
// 一般測試永遠載入專案的 docs/schema.sql。
const SCHEMA_PATH = process.env.KB_SCHEMA_FILE || path.join(__dirname, "../../docs/schema.sql");

function urlForDatabase(baseUrl, dbName) {
  const u = new URL(baseUrl);
  u.pathname = "/" + dbName;
  return u.toString();
}

/** 建立臨時資料庫並載入 schema。回傳 { client, drop }。 */
async function createTestDatabase(schemaSql) {
  const baseUrl = process.env.TEST_DATABASE_URL;
  const dbName = "kbtest_" + process.pid + "_" + Math.random().toString(36).slice(2, 10);
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  // 角色是整個叢集共用的,多個測試檔平行建立時用 exception 吃掉重複
  await admin.query(`
    do $$ begin
      begin create role anon nologin; exception when duplicate_object then null; end;
      begin create role authenticated nologin; exception when duplicate_object then null; end;
      begin create role service_role nologin bypassrls; exception when duplicate_object then null; end;
    end $$;`);
  await admin.query(`create database "${dbName}"`);
  await admin.end();

  const client = new Client({ connectionString: urlForDatabase(baseUrl, dbName) });
  const drop = async () => {
    await client.end().catch(() => {});
    const a = new Client({ connectionString: baseUrl });
    await a.connect();
    await a.query(`drop database if exists "${dbName}" with (force)`);
    await a.end();
  };
  try {
    await client.connect();
    // 模擬 Supabase 專案的出廠狀態:extensions schema 預先存在,三個角色有預設授權
    await client.query(`
      create schema if not exists extensions;
      grant usage on schema public, extensions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
    await client.query(schemaSql === undefined ? fs.readFileSync(SCHEMA_PATH, "utf8") : schemaSql);
  } catch (err) {
    // 載入失敗(例如被刻意改壞的 schema)時一定要清掉連線與臨時資料庫,否則 Jest 會因為
    // 還開著的連線掛住,殘留的資料庫也會越積越多。
    await drop().catch(() => {});
    throw err;
  }
  return { client, drop };
}

/**
 * 檢索測試共用的固定資料集(段落版)。回傳各列的 id,測試用名稱取用。
 * 向量是手工構造的(軸向量與混合向量),距離可精確預期,不需要 Gemini。
 * 單段文章 a1~a5 重現「整篇一個向量」時代的行為基準;a6 是三段的長文,用來驗證「最接近的那一段」。
 */
async function seedBasicDataset(client) {
  const one = async (sql, params) => (await client.query(sql, params)).rows[0].id;
  const ids = {};
  ids.c1 = await one("insert into categories (name) values ('Programming') returning id");
  ids.c2 = await one("insert into categories (name) values ('Cooking') returning id");
  ids.t1 = await one("insert into tags (name) values ('react') returning id");
  ids.t2 = await one("insert into tags (name) values ('db') returning id");
  // chunks:[[文字, 向量字串], ...] — 沒給就是沒有段落
  const art = async (title, content, status, chunks, cat) => {
    const id = await one(
      "insert into articles (title, content_md, status, category_id) values ($1,$2,$3,$4) returning id",
      [title, content, status, cat]
    );
    for (let i = 0; i < (chunks || []).length; i++) {
      await client.query(
        "insert into article_chunks (article_id, chunk_index, content, embedding, embedding_model) values ($1,$2,$3,$4,'test-model/768')",
        [id, i, chunks[i][0], chunks[i][1]]
      );
    }
    return id;
  };
  ids.a1 = await art("React hooks guide", "useState useEffect hooks tutorial", "published", [["useState useEffect hooks tutorial", axisVector(0)]], ids.c1);
  ids.a2 = await art("PostgreSQL index tuning", "btree gin index tuning for postgres", "published", [["btree gin index tuning for postgres", axisVector(1)]], ids.c1);
  ids.a3 = await art("Cooking pasta", "boil water add salt cook pasta", "published", [["boil water add salt cook pasta", axisVector(2)]], ids.c2);
  ids.a4 = await art("React hooks draft", "useState useEffect draft notes", "draft", [["useState useEffect draft notes", axisVector(0)]], ids.c1);
  ids.a5 = await art("React performance", "memo callback hooks performance", "published", [["memo callback hooks performance", mixVector(0, 3, 0.9)]], ids.c1);
  // 三段的長文:前半段與後半段主題不同(重現 F-03:整篇一個向量時,後半段被截斷而找不到)
  ids.a6 = await art(
    "Long mixed article",
    "head about cooking soup\n\nmiddle about gardening\n\ntail about astronomy telescopes",
    "published",
    [
      ["head about cooking soup", axisVector(10)],
      ["middle about gardening", axisVector(11)],
      ["tail about astronomy telescopes", axisVector(12)]
    ],
    ids.c2
  );
  const tag = (a, t) => client.query("insert into article_tags (article_id, tag_id) values ($1,$2)", [ids[a], ids[t]]);
  await tag("a1", "t1");
  await tag("a1", "t2");
  await tag("a2", "t2");
  await tag("a5", "t1");
  return ids;
}

/** 768 維單位向量,第 i 維為 1。距離可精確預期:同軸 0、不同軸 1(cosine)。 */
function axisVector(i) {
  const v = new Array(768).fill(0);
  v[i] = 1;
  return "[" + v.join(",") + "]";
}

/** 兩個軸之間的向量:cos 值 = 與 a 軸的夾角餘弦,其餘落在 b 軸,用來構造「距離 d 的候選」。 */
function mixVector(a, b, weightA) {
  const v = new Array(768).fill(0);
  const wb = Math.sqrt(1 - weightA * weightA);
  v[a] = weightA;
  v[b] = wb;
  return "[" + v.join(",") + "]";
}

module.exports = { SQL_ENABLED, describeSql, createTestDatabase, seedBasicDataset, axisVector, mixVector, SCHEMA_PATH };
