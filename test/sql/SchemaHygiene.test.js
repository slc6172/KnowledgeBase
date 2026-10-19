const { describeSql, createTestDatabase } = require("./helpers");

/**
 * 票 01(spec_chunked_embeddings):資料庫衛生。
 * - vector / pg_trgm 不在 public(Supabase 安全顧問 Lint 0014)
 * - 每個函式都固定 search_path(Lint 0011)
 * - 每張表都開啟 RLS,而且匿名角色讀寫不到任何東西
 */
describeSql("schema 衛生(真實 PostgreSQL)", () => {
  let db;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  test("schema.sql 在全新資料庫上載入成功,且六張資料表都存在", async () => {
    const { rows } = await db.client.query(
      "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
    );
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(["article_tags", "articles", "attachment_folders", "attachments", "categories", "tags"])
    );
  });

  test("vector 與 pg_trgm 兩個擴充功能都在 extensions schema", async () => {
    const { rows } = await db.client.query(
      "select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname in ('vector','pg_trgm') order by 1"
    );
    expect(rows).toEqual([
      { extname: "pg_trgm", nspname: "extensions" },
      { extname: "vector", nspname: "extensions" }
    ]);
  });

  test("public schema 裡沒有任何屬於擴充功能的函式或型別", async () => {
    const fn = await db.client.query(
      `select count(*)::int as n from pg_proc p join pg_depend d on d.objid = p.oid and d.deptype = 'e'
       where p.pronamespace = 'public'::regnamespace`
    );
    const ty = await db.client.query(
      `select count(*)::int as n from pg_type t join pg_depend d on d.objid = t.oid and d.deptype = 'e'
       where t.typnamespace = 'public'::regnamespace`
    );
    expect(fn.rows[0].n).toBe(0);
    expect(ty.rows[0].n).toBe(0);
  });

  test("public 裡每一個函式都固定 search_path = public, extensions", async () => {
    const { rows } = await db.client.query(
      "select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace and prokind = 'f' order by 1"
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const missing = rows.filter((r) => !(r.proconfig || []).includes("search_path=public, extensions")).map((r) => r.proname);
    expect(missing).toEqual([]);
  });

  test("public 裡每一張資料表都開啟 RLS,而且沒有任何 policy", async () => {
    const { rows } = await db.client.query(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1"
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
    const policies = await db.client.query("select count(*)::int as n from pg_policies where schemaname = 'public'");
    expect(policies.rows[0].n).toBe(0);
  });

  test("匿名角色(anon)讀不到任何資料,也寫不進任何資料", async () => {
    await db.client.query("insert into categories (name) values ('visible-to-service-only')");
    await db.client.query("begin");
    try {
      await db.client.query("set local role anon");
      const read = await db.client.query("select count(*)::int as n from categories");
      expect(read.rows[0].n).toBe(0); // RLS 開啟且沒有 policy → 看到 0 列,不是看到資料
      await expect(db.client.query("insert into categories (name) values ('x')")).rejects.toThrow(/row-level security/);
    } finally {
      await db.client.query("rollback");
    }
  });
});
