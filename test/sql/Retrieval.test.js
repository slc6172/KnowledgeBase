const { describeSql, createTestDatabase, seedBasicDataset, axisVector, mixVector } = require("./helpers");

/**
 * 票 07:檢索改用段落。
 * - 單段文章的行為與「整篇一個向量」時代完全相同(票 01 的基準,用同一批資料與期望值);
 * - 長文的任何一段符合都找得到(F-03 的根本修復),命中的段落序號與文字一併回傳;
 * - 相關文章:任一段對任一段;
 * - articles.embedding 欄位與它的索引已移除。
 */
describeSql("段落檢索(真實 PostgreSQL)", () => {
  let db;
  let ids;
  beforeAll(async () => {
    db = await createTestDatabase();
    ids = await seedBasicDataset(db.client);
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  const vec = (a, b, w) => (b === undefined ? axisVector(a) : mixVector(a, b, w));
  // 取回 hybrid_search_articles 的結果,保留函式輸出的順序(with ordinality)
  const search = async (text, embedding, extra = "") =>
    (
      await db.client.query(
        `select a.title, h.best_chunk_index, h.best_chunk_content, h.semantic_distance
           from hybrid_search_articles($1, $2::extensions.vector${extra}) with ordinality as h(id, best_chunk_index, best_chunk_content, semantic_distance, ord)
           join articles a on a.id = h.id
          order by h.ord`,
        [text, embedding]
      )
    ).rows;
  const titles = async (...args) => (await search(...args)).map((r) => r.title);

  describe("單段文章:行為與整篇向量時代相同", () => {
    test("語意搜尋:只回傳已發布且距離在門檻內的文章,依距離排序", async () => {
      expect(await titles("hooks", axisVector(0))).toEqual(["React hooks guide", "React performance"]);
    });

    test("only_published=false 時草稿也會出現", async () => {
      const got = await titles("hooks", axisVector(0), ", only_published => false");
      expect(got).toHaveLength(3);
      expect(got).toEqual(expect.arrayContaining(["React hooks guide", "React hooks draft", "React performance"]));
      expect(got[got.length - 1]).toBe("React performance");
    });

    test("標籤篩選:AND 語意", async () => {
      const got = (
        await db.client.query(
          "select a.title from hybrid_search_articles($1, $2::extensions.vector, tag_ids => $3) h join articles a on a.id = h.id",
          ["hooks", axisVector(0), [ids.t2]]
        )
      ).rows.map((r) => r.title);
      expect(got).toEqual(["React hooks guide"]);
    });

    test("查詢向量為空(降級)時只剩關鍵字結果,而且沒有命中段落", async () => {
      const rows = (
        await db.client.query(
          "select a.title, h.best_chunk_index, h.best_chunk_content from hybrid_search_articles($1, null) h join articles a on a.id = h.id",
          ["Cooking pasta boil water add salt cook pasta"]
        )
      ).rows;
      expect(rows).toEqual([{ title: "Cooking pasta", best_chunk_index: null, best_chunk_content: null }]);
    });

    test("語意距離超過門檻的文章不會出現", async () => {
      expect(await titles("zzzz", axisVector(7))).toEqual([]);
    });

    test("預設語意門檻是 0.4:距離 0.5 的文章預設不出現,放寬到 0.6 才出現", async () => {
      const q = mixVector(0, 9, 0.5); // 與 React hooks guide(軸 0)的距離 = 1 - 0.5 = 0.5
      expect(await titles("zzzz", q)).toEqual([]);
      expect(await titles("zzzz", q, ", max_semantic_distance => 0.6")).toEqual(
        expect.arrayContaining(["React hooks guide"])
      );
    });

    test("距離剛好在門檻內(0.35)的文章會出現,出現在門檻外(0.45)的不會", async () => {
      expect(await titles("zzzz", mixVector(0, 9, 0.65))).toContain("React hooks guide"); // 距離 0.35
      expect(await titles("zzzz", mixVector(0, 9, 0.55))).not.toContain("React hooks guide"); // 距離 0.45
    });

    test("單段文章的命中段落就是第 0 段,距離與預期相符", async () => {
      const rows = await search("hooks", axisVector(0));
      expect(rows[0]).toMatchObject({ title: "React hooks guide", best_chunk_index: 0, best_chunk_content: "useState useEffect hooks tutorial" });
      expect(rows[0].semantic_distance).toBeCloseTo(0, 6);
      expect(rows[1].semantic_distance).toBeCloseTo(0.1, 6); // React performance
    });
  });

  describe("長文:任何一段符合都找得到(F-03)", () => {
    test("最後一段的內容查得到,命中的是第 2 段(整篇一個向量時代這會是找不到的)", async () => {
      const rows = await search("astronomy", axisVector(12));
      expect(rows.map((r) => r.title)).toEqual(["Long mixed article"]);
      expect(rows[0]).toMatchObject({ best_chunk_index: 2, best_chunk_content: "tail about astronomy telescopes" });
    });

    test("第一段與中間段也各自找得到,命中段落序號正確", async () => {
      expect((await search("soup", axisVector(10)))[0]).toMatchObject({ title: "Long mixed article", best_chunk_index: 0 });
      expect((await search("garden", axisVector(11)))[0]).toMatchObject({ title: "Long mixed article", best_chunk_index: 1 });
    });

    test("命中的是『最接近的那一段』:查詢介於第 1、2 段之間但偏第 1 段 → 第 1 段", async () => {
      const rows = await search("x", mixVector(11, 12, 0.9));
      expect(rows[0]).toMatchObject({ title: "Long mixed article", best_chunk_index: 1 });
      expect(rows[0].semantic_distance).toBeCloseTo(0.1, 6);
    });

    test("多段都落在門檻內時,這篇文章只出現一次", async () => {
      const both = "[" + JSON.parse(axisVector(10)).map((x, i) => (i === 10 || i === 11 ? Math.SQRT1_2 : 0)).join(",") + "]";
      const rows = await search("x", both);
      expect(rows.filter((r) => r.title === "Long mixed article")).toHaveLength(1);
      expect(rows[0].semantic_distance).toBeCloseTo(1 - Math.SQRT1_2, 6);
    });

    test("關鍵字與語意都命中時,命中段落有值", async () => {
      const rows = await search("tail about astronomy telescopes", axisVector(12));
      expect(rows.find((r) => r.title === "Long mixed article").best_chunk_index).toBe(2);
    });
  });

  describe("相關文章:任一段對任一段", () => {
    const related = async (id, extra = "") =>
      (await db.client.query(`select title from related_articles($1${extra})`, [id])).rows.map((r) => r.title);

    test("單段文章:距離在 0.6 內、排除自己與草稿(與基準相同)", async () => {
      expect(await related(ids.a1)).toEqual(["React performance"]);
    });

    test("長文的『尾段』與另一篇文章相近 → 互為相關文章(整篇向量時代做不到)", async () => {
      const a7 = (
        await db.client.query(
          "insert into articles (title, content_md, status) values ('Astronomy note','n','published') returning id"
        )
      ).rows[0].id;
      await db.client.query(
        "insert into article_chunks (article_id, chunk_index, content, embedding, embedding_model) values ($1,0,'telescopes',$2,'test-model/768')",
        [a7, axisVector(12)]
      );
      expect(await related(ids.a6)).toEqual(["Astronomy note"]);
      expect(await related(a7)).toEqual(["Long mixed article"]); // 反方向也成立
      await db.client.query("delete from articles where id = $1", [a7]);
    });

    test("相關文章預設門檻是 0.6:距離 0.55 的出現,距離 0.65 的不出現", async () => {
      const mk = async (name, w) => {
        const id = (await db.client.query("insert into articles (title, content_md, status) values ($1,'n','published') returning id", [name])).rows[0].id;
        await db.client.query(
          "insert into article_chunks (article_id, chunk_index, content, embedding, embedding_model) values ($1,0,'c',$2,'test-model/768')",
          [id, mixVector(12, 20, w)]
        );
        return id;
      };
      const near = await mk("Near055", 0.45); // 與軸 12 的距離 = 1 - 0.45 = 0.55
      const far = await mk("Far065", 0.35); // 距離 0.65
      const got = await related(ids.a6);
      expect(got).toContain("Near055");
      expect(got).not.toContain("Far065");
      for (const id of [near, far]) await db.client.query("delete from articles where id = $1", [id]);
    });

    test("超過 0.6 的不算:距離約 0.7 的候選不會出現", async () => {
      const far = (await db.client.query("insert into articles (title, content_md, status) values ('Far','n','published') returning id")).rows[0].id;
      await db.client.query(
        "insert into article_chunks (article_id, chunk_index, content, embedding, embedding_model) values ($1,0,'far',$2,'test-model/768')",
        [far, mixVector(12, 5, 0.3)] // 與 axis12 的距離 = 1 - 0.3 = 0.7
      );
      expect(await related(ids.a6)).not.toContain("Far");
      await db.client.query("delete from articles where id = $1", [far]);
    });

    test("最多回傳 match_count 篇,依最近距離排序", async () => {
      const made = [];
      for (const [name, w] of [["R1", 0.99], ["R2", 0.95], ["R3", 0.9], ["R4", 0.85]]) {
        const id = (await db.client.query("insert into articles (title, content_md, status) values ($1,'n','published') returning id", [name])).rows[0].id;
        await db.client.query(
          "insert into article_chunks (article_id, chunk_index, content, embedding, embedding_model) values ($1,0,'c',$2,'test-model/768')",
          [id, mixVector(12, 5 + made.length, w)]
        );
        made.push(id);
      }
      expect(await related(ids.a6)).toEqual(["R1", "R2", "R3"]);
      expect(await related(ids.a6, ", match_count => 1")).toEqual(["R1"]);
      for (const id of made) await db.client.query("delete from articles where id = $1", [id]);
    });

    test("來源文章沒有段落(例如從沒發布過)或不存在 → 回傳空集合,不報錯", async () => {
      const draft = (await db.client.query("insert into articles (title, content_md) values ('No chunks','n') returning id")).rows[0].id;
      expect(await related(draft)).toEqual([]);
      expect(await related("00000000-0000-4000-8000-000000000000")).toEqual([]);
      await db.client.query("delete from articles where id = $1", [draft]);
    });

    test("草稿不會被推薦(即使它有段落)", async () => {
      expect(await related(ids.a1)).not.toContain("React hooks draft");
    });
  });

  describe("標籤篩選文章列表(不變)", () => {
    test("AND 語意與狀態篩選", async () => {
      const both = (await db.client.query("select title from articles_by_tags($1)", [[ids.t1, ids.t2]])).rows.map((r) => r.title);
      expect(both).toEqual(["React hooks guide"]);
      const t1 = (await db.client.query("select title from articles_by_tags($1, 'published')", [[ids.t1]])).rows.map((r) => r.title);
      expect(t1.sort()).toEqual(["React hooks guide", "React performance"]);
    });
  });

  describe("articles.embedding 已移除", () => {
    test("articles 資料表沒有 embedding 欄位,舊索引不存在", async () => {
      const col = await db.client.query("select 1 from information_schema.columns where table_name = 'articles' and column_name = 'embedding'");
      expect(col.rowCount).toBe(0);
      const idx = await db.client.query("select 1 from pg_indexes where indexname = 'articles_embedding_idx'");
      expect(idx.rowCount).toBe(0);
    });

    test("三個檢索函式各只有一個版本(沒有新舊簽名並存)", async () => {
      const { rows } = await db.client.query(
        "select proname, count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace and proname in ('hybrid_search_articles','related_articles','articles_by_tags') group by 1 order by 1"
      );
      expect(rows).toEqual([
        { proname: "articles_by_tags", n: 1 },
        { proname: "hybrid_search_articles", n: 1 },
        { proname: "related_articles", n: 1 }
      ]);
    });
  });
});
