const { describeSql, createTestDatabase, axisVector } = require("./helpers");

/**
 * 票 05:段落表 article_chunks 與原子寫入 RPC save_article。
 * 向量用手工構造的軸向量,不需要 Gemini。
 */
describeSql("save_article / article_chunks(真實 PostgreSQL)", () => {
  let db;
  const MODEL = "gemini-embedding-001/768";
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    if (db) await db.drop();
  });
  afterEach(async () => {
    await db.client.query("delete from articles");
    await db.client.query("delete from tags");
    await db.client.query("delete from categories");
  });

  const q = (sql, params) => db.client.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows[0];
  const chunk = (content, axis) => ({ content, embedding: JSON.parse(axisVector(axis)) });
  const save = (args) =>
    q("select * from save_article(p_id => $1, p_fields => $2::jsonb, p_tag_ids => $3::uuid[], p_chunks => $4::jsonb, p_embedding_model => $5)", [
      args.id === undefined ? null : args.id,
      args.fields === undefined ? null : JSON.stringify(args.fields),
      args.tags === undefined ? null : args.tags,
      args.chunks === undefined ? null : JSON.stringify(args.chunks),
      args.model === undefined ? null : args.model
    ]);
  const tag = async (name) => (await one("insert into tags (name) values ($1) returning id", [name])).id;
  const chunksOf = async (id) => (await q("select chunk_index, content, embedding_model from article_chunks where article_id = $1 order by chunk_index", [id])).rows;
  const tagNames = async (id) =>
    (await q("select t.name from article_tags at join tags t on t.id = at.tag_id where at.article_id = $1 order by 1", [id])).rows.map((r) => r.name);
  // 寫入前後的完整快照:文章列、標籤關聯、段落——用來證明「失敗時三者都沒動」
  const snapshot = async (id) => ({
    article: (await q("select title, content_md, status, category_id, updated_at from articles where id = $1", [id])).rows[0],
    tags: await tagNames(id),
    chunks: (await q("select chunk_index, content, embedding::text as emb, embedding_model from article_chunks where article_id = $1 order by 1", [id])).rows
  });

  describe("建立與更新", () => {
    test("建立草稿(含標籤):回傳文章列、預設草稿、標籤已建立、沒有段落", async () => {
      const t1 = await tag("react");
      const t2 = await tag("db");
      const { rows } = await save({ fields: { title: "新文章", content_md: "內容" }, tags: [t1, t2] });
      expect(rows[0].title).toBe("新文章");
      expect(rows[0].status).toBe("draft");
      expect(await tagNames(rows[0].id)).toEqual(["db", "react"]);
      expect(await chunksOf(rows[0].id)).toEqual([]);
    });

    test("建立時一定要有標題", async () => {
      await expect(save({ fields: { content_md: "沒有標題" } })).rejects.toThrow(/title required/);
      await expect(save({})).rejects.toThrow(/title required/);
      expect((await one("select count(*)::int as n from articles")).n).toBe(0);
    });

    test("更新:只動有提供的欄位;沒提供的不變;category_id 明確給 null 代表清除分類", async () => {
      const cat = (await one("insert into categories (name) values ('C') returning id")).id;
      const created = (await save({ fields: { title: "舊標題", content_md: "舊內容", category_id: cat } })).rows[0];

      const updated = (await save({ id: created.id, fields: { title: "新標題" } })).rows[0];
      expect(updated.title).toBe("新標題");
      expect(updated.content_md).toBe("舊內容");
      expect(updated.category_id).toBe(cat);

      const cleared = (await save({ id: created.id, fields: { category_id: null } })).rows[0];
      expect(cleared.category_id).toBeNull();
      expect(cleared.title).toBe("新標題");
    });

    test("更新不存在的文章 → 拒絕", async () => {
      await expect(save({ id: "00000000-0000-4000-8000-000000000000", fields: { title: "x" } })).rejects.toThrow(/article not found/);
    });

    test("非法狀態 → 拒絕", async () => {
      await expect(save({ fields: { title: "x", content_md: "y", status: "archived" } })).rejects.toThrow(/invalid status/);
    });
  });

  describe("標籤", () => {
    test("整組取代以差集完成:保留的關聯列不被刪除再重建(xmin 不變),多的刪除、新的加入", async () => {
      const [a, b, c] = [await tag("a"), await tag("b"), await tag("c")];
      const art = (await save({ fields: { title: "T", content_md: "x" }, tags: [a, b] })).rows[0];
      const before = (await one("select xmin::text as x from article_tags where article_id = $1 and tag_id = $2", [art.id, b])).x;

      await save({ id: art.id, tags: [b, c] });

      expect(await tagNames(art.id)).toEqual(["b", "c"]);
      const after = (await one("select xmin::text as x from article_tags where article_id = $1 and tag_id = $2", [art.id, b])).x;
      expect(after).toBe(before);
    });

    test("空清單 = 清空標籤;未提供 = 不動;重複的 id 不會出錯", async () => {
      const [a, b] = [await tag("a"), await tag("b")];
      const art = (await save({ fields: { title: "T", content_md: "x" }, tags: [a, b] })).rows[0];
      await save({ id: art.id, fields: { title: "T2" } }); // 未提供標籤
      expect(await tagNames(art.id)).toEqual(["a", "b"]);
      await save({ id: art.id, tags: [a, a, a] });
      expect(await tagNames(art.id)).toEqual(["a"]);
      await save({ id: art.id, tags: [] });
      expect(await tagNames(art.id)).toEqual([]);
    });
  });

  describe("段落", () => {
    test("發布:狀態 + 段落一起寫,段落序號依陣列順序從 0 起,記錄模型", async () => {
      const art = (await save({ fields: { title: "T", content_md: "x" } })).rows[0];
      const res = (await save({ id: art.id, fields: { status: "published" }, chunks: [chunk("第一段", 0), chunk("第二段", 1)], model: MODEL })).rows[0];
      expect(res.status).toBe("published");
      expect(await chunksOf(art.id)).toEqual([
        { chunk_index: 0, content: "第一段", embedding_model: MODEL },
        { chunk_index: 1, content: "第二段", embedding_model: MODEL }
      ]);
    });

    test("段落整批取代:舊段落消失,不會留下多餘的舊序號", async () => {
      const art = (await save({ fields: { title: "T", content_md: "x" }, chunks: [chunk("a", 0), chunk("b", 1), chunk("c", 2)], model: MODEL })).rows[0];
      await save({ id: art.id, chunks: [chunk("只剩一段", 5)], model: MODEL });
      expect(await chunksOf(art.id)).toEqual([{ chunk_index: 0, content: "只剩一段", embedding_model: MODEL }]);
    });

    test("取消發布只改狀態,段落保留", async () => {
      const art = (await save({ fields: { title: "T", content_md: "x", status: "published" }, chunks: [chunk("留著", 0)], model: MODEL })).rows[0];
      const res = (await save({ id: art.id, fields: { status: "draft" } })).rows[0];
      expect(res.status).toBe("draft");
      expect((await chunksOf(art.id)).map((c) => c.content)).toEqual(["留著"]);
    });

    test("只重建段落(欄位與標籤都不給):文章欄位、標籤、updated_at 都不動", async () => {
      const t = await tag("keep");
      const art = (await save({ fields: { title: "T", content_md: "x", status: "published" }, tags: [t] })).rows[0];
      const before = await snapshot(art.id);
      await new Promise((r) => setTimeout(r, 20)); // 讓「若被誤改 updated_at」能被看出來
      await save({ id: art.id, chunks: [chunk("新段落", 3)], model: MODEL });
      const after = await snapshot(art.id);
      expect(after.article).toEqual(before.article); // 含 updated_at
      expect(after.tags).toEqual(before.tags);
      expect(after.chunks.map((c) => c.content)).toEqual(["新段落"]);
    });

    test("段數剛好 40 通過;41 拒絕", async () => {
      const art = (await save({ fields: { title: "T", content_md: "x" } })).rows[0];
      const many = (n) => Array.from({ length: n }, (_, i) => chunk("段" + i, i % 700));
      await save({ id: art.id, chunks: many(40), model: MODEL });
      expect((await chunksOf(art.id)).length).toBe(40);
      await expect(save({ id: art.id, chunks: many(41), model: MODEL })).rejects.toThrow(/too many chunks/);
      expect((await chunksOf(art.id)).length).toBe(40); // 41 段那次沒有動到任何東西
    });

    test("提供段落時必須同時給模型", async () => {
      const art = (await save({ fields: { title: "T", content_md: "x" } })).rows[0];
      await expect(save({ id: art.id, chunks: [chunk("a", 0)] })).rejects.toThrow(/embedding_model required/);
    });

    test("內容為空字串的段落是合法的(空文章仍有一段)", async () => {
      const art = (await save({ fields: { title: "空", content_md: "" }, chunks: [chunk("", 0)], model: MODEL })).rows[0];
      expect(await chunksOf(art.id)).toEqual([{ chunk_index: 0, content: "", embedding_model: MODEL }]);
    });

    test("刪除文章連帶刪除段落(cascade)", async () => {
      const art = (await save({ fields: { title: "T", content_md: "x" }, chunks: [chunk("a", 0)], model: MODEL })).rows[0];
      await q("delete from articles where id = $1", [art.id]);
      expect((await one("select count(*)::int as n from article_chunks")).n).toBe(0);
    });
  });

  describe("原子性:任何一步失敗,文章欄位、段落、標籤三者都維持原狀", () => {
    let art;
    let keepTag;
    beforeEach(async () => {
      keepTag = await tag("keep");
      art = (await save({ fields: { title: "原標題", content_md: "原內容", status: "published" }, tags: [keepTag], chunks: [chunk("原段落", 0)], model: MODEL })).rows[0];
    });

    const attemptsThatMustFail = {
      "非法狀態": (id, t) => ({ id, fields: { title: "新標題", status: "bogus" }, tags: [], chunks: [chunk("新段落", 1)], model: MODEL }),
      "41 段": (id, t) => ({ id, fields: { title: "新標題" }, tags: [], chunks: Array.from({ length: 41 }, (_, i) => chunk("x" + i, i)), model: MODEL }),
      "第二段向量維度錯誤": (id, t) => ({
        id,
        fields: { title: "新標題" },
        tags: [],
        chunks: [chunk("好的", 0), { content: "壞的", embedding: [1, 2, 3] }],
        model: MODEL
      }),
      "標籤不存在(外鍵失敗)": (id, t) => ({
        id,
        fields: { title: "新標題" },
        tags: ["00000000-0000-4000-8000-000000000000"],
        chunks: [chunk("新段落", 1)],
        model: MODEL
      }),
      "段落缺少向量": (id, t) => ({ id, fields: { title: "新標題" }, tags: [], chunks: [{ content: "沒有向量" }], model: MODEL })
    };

    test.each(Object.keys(attemptsThatMustFail))("%s", async (name) => {
      const before = await snapshot(art.id);
      await expect(save(attemptsThatMustFail[name](art.id, keepTag))).rejects.toThrow();
      const after = await snapshot(art.id);
      expect(after).toEqual(before);
      expect(after.article.title).toBe("原標題");
      expect(after.tags).toEqual(["keep"]);
      expect(after.chunks.map((c) => c.content)).toEqual(["原段落"]);
    });

    test("建立新文章時失敗 → 連文章本身都不會留下", async () => {
      const n0 = (await one("select count(*)::int as n from articles")).n;
      await expect(save({ fields: { title: "半成品", content_md: "x" }, tags: ["00000000-0000-4000-8000-000000000000"] })).rejects.toThrow();
      expect((await one("select count(*)::int as n from articles")).n).toBe(n0);
    });
  });

  describe("articles_needing_reindex", () => {
    const needing = async () => (await q("select id from articles_needing_reindex($1)", [MODEL])).rows.map((r) => r.id);

    test("已發布且沒有段落 → 需要;模型相同 → 不需要;任一段模型不同 → 需要;草稿 → 不需要", async () => {
      const pubNoChunks = (await save({ fields: { title: "無段落", content_md: "x", status: "published" } })).rows[0].id;
      const pubCurrent = (await save({ fields: { title: "新模型", content_md: "x", status: "published" }, chunks: [chunk("a", 0)], model: MODEL })).rows[0].id;
      const pubOld = (await save({ fields: { title: "舊模型", content_md: "x", status: "published" }, chunks: [chunk("a", 0)], model: "old-model/768" })).rows[0].id;
      const pubMixed = (await save({ fields: { title: "混合", content_md: "x", status: "published" }, chunks: [chunk("a", 0), chunk("b", 1)], model: MODEL })).rows[0].id;
      await q("update article_chunks set embedding_model = 'old-model/768' where article_id = $1 and chunk_index = 1", [pubMixed]);
      const draft = (await save({ fields: { title: "草稿", content_md: "x" } })).rows[0].id;

      const got = await needing();
      expect(got.sort()).toEqual([pubNoChunks, pubOld, pubMixed].sort());
      expect(got).not.toContain(pubCurrent);
      expect(got).not.toContain(draft);
    });

    test("沒有任何文章時回傳空集合", async () => {
      expect(await needing()).toEqual([]);
    });
  });

  describe("權限", () => {
    test("匿名角色讀不到段落,也無法透過 save_article 寫入任何東西", async () => {
      const art = (await save({ fields: { title: "T", content_md: "x" }, chunks: [chunk("a", 0)], model: MODEL })).rows[0];
      await q("begin");
      try {
        await q("set local role anon");
        expect((await one("select count(*)::int as n from article_chunks")).n).toBe(0);
        await expect(save({ fields: { title: "駭客", content_md: "x" } })).rejects.toThrow(/row-level security/);
      } finally {
        await q("rollback");
      }
      expect((await chunksOf(art.id)).length).toBe(1);
      expect((await one("select count(*)::int as n from articles")).n).toBe(1);
    });
  });
});
