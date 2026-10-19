const { describeSql, createTestDatabase } = require("./helpers");

/**
 * 票 02:merge_tags 在單一交易內完成標籤合併(取代 GAS 逐篇多步驟、中途失敗會留下半成品的流程)。
 */
describeSql("merge_tags(真實 PostgreSQL)", () => {
  let db;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  const one = async (sql, params) => (await db.client.query(sql, params)).rows[0];
  const links = async () =>
    (await db.client.query("select a.title, t.name from article_tags at join articles a on a.id = at.article_id join tags t on t.id = at.tag_id order by 1,2")).rows.map(
      (r) => r.title + ":" + r.name
    );

  // 每個測試自己建資料,結束時清掉,互不影響
  let s, t, onlySource, both, onlyTarget;
  beforeEach(async () => {
    s = (await one("insert into tags (name) values ('JS') returning id")).id;
    t = (await one("insert into tags (name) values ('JavaScript') returning id")).id;
    const art = async (title) => (await one("insert into articles (title, content_md) values ($1, 'x') returning id", [title])).id;
    onlySource = await art("only-source");
    both = await art("both");
    onlyTarget = await art("only-target");
    const link = (a, tag) => db.client.query("insert into article_tags (article_id, tag_id) values ($1,$2)", [a, tag]);
    await link(onlySource, s);
    await link(both, s);
    await link(both, t);
    await link(onlyTarget, t);
  });
  afterEach(async () => {
    await db.client.query("drop trigger if exists boom on tags");
    await db.client.query("delete from articles");
    await db.client.query("delete from tags");
  });

  test("一般搬移:只有來源的文章改指向目標;來源標籤被刪除;回傳目標標籤", async () => {
    const res = await one("select * from merge_tags($1, $2)", [s, t]);
    expect(res.id).toBe(t);
    expect(res.name).toBe("JavaScript");
    expect(await links()).toEqual(["both:JavaScript", "only-source:JavaScript", "only-target:JavaScript"]);
    expect((await db.client.query("select 1 from tags where id = $1", [s])).rowCount).toBe(0);
  });

  test("同時擁有兩個標籤的文章只剩一筆關聯(不會撞 unique)", async () => {
    await db.client.query("select merge_tags($1, $2)", [s, t]);
    const n = await one("select count(*)::int as n from article_tags where article_id = $1", [both]);
    expect(n.n).toBe(1);
  });

  test("來源等於目標 → 拒絕,資料不動", async () => {
    await expect(db.client.query("select merge_tags($1, $1)", [s])).rejects.toThrow(/source and target must differ/);
    expect(await links()).toEqual(["both:JS", "both:JavaScript", "only-source:JS", "only-target:JavaScript"]);
  });

  test("來源或目標標籤不存在 → 拒絕,資料不動", async () => {
    const ghost = "00000000-0000-4000-8000-000000000000";
    await expect(db.client.query("select merge_tags($1, $2)", [ghost, t])).rejects.toThrow(/source tag not found/);
    await expect(db.client.query("select merge_tags($1, $2)", [s, ghost])).rejects.toThrow(/target tag not found/);
    expect(await links()).toEqual(["both:JS", "both:JavaScript", "only-source:JS", "only-target:JavaScript"]);
  });

  test("原子性:最後刪除來源標籤時失敗 → 前面搬過的關聯全部回到原狀", async () => {
    await db.client.query(`
      create function boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
      create trigger boom before delete on tags for each row execute function boom();`);
    await expect(db.client.query("select merge_tags($1, $2)", [s, t])).rejects.toThrow(/boom/);
    expect(await links()).toEqual(["both:JS", "both:JavaScript", "only-source:JS", "only-target:JavaScript"]);
    expect((await db.client.query("select 1 from tags where id = $1", [s])).rowCount).toBe(1);
  });

  test("匿名角色呼叫 merge_tags 什麼都動不了(RLS 開啟且沒有 policy)", async () => {
    await db.client.query("begin");
    try {
      await db.client.query("set local role anon");
      await expect(db.client.query("select merge_tags($1, $2)", [s, t])).rejects.toThrow(/not found/);
    } finally {
      await db.client.query("rollback");
    }
    expect(await links()).toEqual(["both:JS", "both:JavaScript", "only-source:JS", "only-target:JavaScript"]);
  });
});
