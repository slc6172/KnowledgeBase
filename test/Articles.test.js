const { loadCoreGas, fakeConfigWithGemini, fakeCacheService, fakeLogger, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  fakeCacheService();
  loadGas("../../src/Auth.gs");
  loadGas("../../src/StorageClient.gs");
  loadGas("../../src/AttachmentTypes.gs");
  loadGas("../../src/Attachments.gs");
  loadGas("../../src/Embeddings.gs");
  loadGas("../../src/Articles.gs");
});

describe("findOrCreateTag_", () => {
  test("reuses an existing tag when the name already exists", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, '[{"id":"tag-1","name":"react"}]'));
    global.httpFetch_ = fetchSpy;

    const tag = findOrCreateTag_("react");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/tags?name=eq.react",
      expect.objectContaining({ method: "GET" })
    );
    expect(tag).toEqual({ id: "tag-1", name: "react" });
  });

  test("creates a new tag when the name doesn't exist yet", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, "[]")) // select: not found
      .mockReturnValueOnce(fakeResponse(201, '[{"id":"tag-2","name":"vue"}]')); // insert
    global.httpFetch_ = fetchSpy;

    const tag = findOrCreateTag_("vue");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/tags",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([{ name: "vue" }])
      })
    );
    expect(tag).toEqual({ id: "tag-2", name: "vue" });
  });

  test("URL-encodes a tag name containing PostgREST-reserved characters", () => {
    // 標籤名稱是使用者自由輸入的欄位,& 這種字元如果不編碼,會被誤判成
    // 多一個 query 參數,可能意外影響查詢語意(細節見 README 已知問題修復
    // 紀錄)。
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    findOrCreateTag_("a&b");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/tags?name=eq.a%26b",
      expect.objectContaining({ method: "GET" })
    );
  });
});

describe("syncArticleTags_", () => {
  test("deletes existing article_tags rows then reinserts resolved tag ids", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t1","name":"react"}]')) // find react
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t2","name":"vue"}]')) // find vue
      .mockReturnValueOnce(fakeResponse(200, "")) // delete existing
      .mockReturnValueOnce(fakeResponse(201, "[]")); // insert new links
    global.httpFetch_ = fetchSpy;

    syncArticleTags_("article-1", ["react", "vue"]);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/rest/v1/article_tags?article_id=eq.article-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "https://x.supabase.co/rest/v1/article_tags",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([
          { article_id: "article-1", tag_id: "t1" },
          { article_id: "article-1", tag_id: "t2" }
        ])
      })
    );
  });
});

describe("getArticle", () => {
  test("mycr finding: converts an upstream Supabase failure into the generic data-service message", () => {
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(500, 'column "secret_internal_field" does not exist'));

    let caught;
    try {
      getArticle("a1");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/資料服務暫時發生問題/);
    expect(caught.message).not.toMatch(/secret_internal_field/);
  });

  test("mycr finding: is subject to the shared public-read rate limit (ANYONE_ANONYMOUS deployment)", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => getArticle("a1")).toThrow(/使用量過大/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns the article with category kept and tags flattened from article_tags", () => {
    const row = {
      id: "a1",
      title: "Hello",
      content_md: "content",
      category_id: "cat1",
      status: "draft",
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
      categories: { id: "cat1", name: "Tech" },
      article_tags: [
        { tags: { id: "t1", name: "react" } },
        { tags: { id: "t2", name: "vue" } }
      ]
    };
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(200, JSON.stringify([row])));

    const article = getArticle("a1");

    expect(article).toEqual({
      id: "a1",
      title: "Hello",
      content_md: "content",
      category_id: "cat1",
      status: "draft",
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
      categories: { id: "cat1", name: "Tech" },
      tags: [
        { id: "t1", name: "react" },
        { id: "t2", name: "vue" }
      ]
    });
  });

  test("throws a clear not-found error when Supabase returns an empty array", () => {
    global.httpFetch_ = jest.fn().mockReturnValue(fakeResponse(200, "[]"));

    expect(() => getArticle("missing-id")).toThrow(/找不到文章.*missing-id/);
  });
});

describe("createArticle", () => {
  test("rejects a missing title before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => createArticle_({ content_md: "content" })).toThrow(/標題/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("rejects a whitespace-only title before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => createArticle_({ title: "   ", content_md: "content" })).toThrow(/標題/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("inserts with status='draft' and returns the full article via getArticle", () => {
    const insertedRow = { id: "a1" };
    const fullRow = {
      id: "a1",
      title: "Hello",
      content_md: "content",
      category_id: "cat1",
      status: "draft",
      categories: { id: "cat1", name: "Tech" },
      article_tags: []
    };
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(201, JSON.stringify([insertedRow])))
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([fullRow])));
    global.httpFetch_ = fetchSpy;

    const article = createArticle_({
      title: "Hello",
      content_md: "content",
      category_id: "cat1"
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/rest/v1/articles",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([
          {
            title: "Hello",
            content_md: "content",
            category_id: "cat1",
            status: "draft"
          }
        ])
      })
    );
    expect(article).toEqual({
      id: "a1",
      title: "Hello",
      content_md: "content",
      category_id: "cat1",
      status: "draft",
      categories: { id: "cat1", name: "Tech" },
      tags: []
    });
  });

  test("syncs tag_names when provided", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(201, '[{"id":"a1"}]')) // insert article
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t1","name":"react"}]')) // find tag
      .mockReturnValueOnce(fakeResponse(200, "")) // delete existing links
      .mockReturnValueOnce(fakeResponse(201, "[]")) // insert links
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            {
              id: "a1",
              title: "Hello",
              content_md: "content",
              category_id: null,
              status: "draft",
              categories: null,
              article_tags: [{ tags: { id: "t1", name: "react" } }]
            }
          ])
        )
      ); // getArticle
    global.httpFetch_ = fetchSpy;

    const article = createArticle_({
      title: "Hello",
      content_md: "content",
      tag_names: ["react"]
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "https://x.supabase.co/rest/v1/article_tags",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([{ article_id: "a1", tag_id: "t1" }])
      })
    );
    expect(article.tags).toEqual([{ id: "t1", name: "react" }]);
  });

  test("mycr F-01 fix: still succeeds when the shared public-read rate limit is already exhausted (owner's write shouldn't be blocked by anonymous read traffic)", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    const insertedRow = { id: "a1" };
    const fullRow = {
      id: "a1",
      title: "Hello",
      content_md: "content",
      category_id: null,
      status: "draft",
      categories: null,
      article_tags: []
    };
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(201, JSON.stringify([insertedRow])))
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([fullRow])));
    global.httpFetch_ = fetchSpy;

    const article = createArticle_({ title: "Hello", content_md: "content" });

    expect(article.id).toBe("a1");
  });
});

describe("listArticles", () => {
  test("mycr finding: converts an upstream Supabase failure into the generic data-service message", () => {
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(500, 'column "secret_internal_field" does not exist'));

    let caught;
    try {
      listArticles();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/資料服務暫時發生問題/);
    expect(caught.message).not.toMatch(/secret_internal_field/);
  });

  test("mycr finding: is subject to the shared public-read rate limit (ANYONE_ANONYMOUS deployment)", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => listArticles()).toThrow(/使用量過大/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("builds status/category filters, pagination and order, and normalizes rows", () => {
    const row = {
      id: "a1",
      title: "Hello",
      status: "published",
      category_id: "cat1",
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
      categories: { id: "cat1", name: "Tech" },
      article_tags: [{ tags: { id: "t1", name: "react" } }]
    };
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, JSON.stringify([row])));
    global.httpFetch_ = fetchSpy;

    const results = listArticles({
      status: "published",
      categoryId: "cat1",
      limit: 10,
      offset: 20
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/articles?" +
        "select=id,title,status,category_id,created_at,updated_at," +
        "categories(id,name),article_tags(tags(id,name))" +
        "&order=updated_at.desc" +
        "&status=eq.published" +
        "&category_id=eq.cat1" +
        "&limit=10" +
        "&offset=20",
      expect.objectContaining({ method: "GET" })
    );
    expect(results).toEqual([
      {
        id: "a1",
        title: "Hello",
        status: "published",
        category_id: "cat1",
        created_at: "2026-01-01",
        updated_at: "2026-01-02",
        categories: { id: "cat1", name: "Tech" },
        tags: [{ id: "t1", name: "react" }]
      }
    ]);
  });

  test("defaults limit to 50 and omits status/category/offset when not given", () => {
    global.httpFetch_ = jest.fn().mockReturnValue(fakeResponse(200, "[]"));

    listArticles({});

    expect(global.httpFetch_).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/articles?" +
        "select=id,title,status,category_id,created_at,updated_at," +
        "categories(id,name),article_tags(tags(id,name))" +
        "&order=updated_at.desc" +
        "&limit=50",
      expect.objectContaining({ method: "GET" })
    );
  });

  test("rejects a non-numeric limit/offset instead of concatenating it raw into the query string", () => {
    // limit/offset 語意上不是「過濾條件」，之前沒有跟著 eqFilter_/inFilter_ 一起
    // 做防護，複掃時發現同樣是呼叫端可控值、字串相加組進 URL——而且 listArticles
    // 是公開讀取函式，不需要密碼就能呼叫，風險比原本 ticket 04 抓到的欄位更高
    // （細節見 README 已知問題修復紀錄）。非數字一律當成沒有提供，落回預設值。
    global.httpFetch_ = jest.fn().mockReturnValue(fakeResponse(200, "[]"));

    listArticles({ limit: "1&select=*,secret_column", offset: "1&malicious=x" });

    const calledUrl = global.httpFetch_.mock.calls[0][0];
    expect(calledUrl).not.toMatch(/select=\*,secret_column|malicious/);
    expect(calledUrl).toContain("&limit=50");
    expect(calledUrl).not.toContain("&offset=");
  });

  test("mycr F-04 fix: filters by tagIds via the articles_by_tags RPC (filtering/ordering/pagination done in SQL), then enriches just that page's ids", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            { id: "a2", title: "B", status: "published", category_id: null, created_at: "x", updated_at: "2" },
            { id: "a1", title: "A", status: "published", category_id: null, created_at: "x", updated_at: "1" }
          ])
        )
      ) // rpc, already filtered/ordered/paginated in SQL — a2 before a1
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            // 補查回來的順序刻意跟 RPC 順序不同,驗證真的有依 RPC 順序重新排列
            { id: "a1", title: "A", status: "published", category_id: null, created_at: "x", updated_at: "1", categories: null, article_tags: [] },
            { id: "a2", title: "B", status: "published", category_id: null, created_at: "x", updated_at: "2", categories: null, article_tags: [] }
          ])
        )
      ); // enrichment
    global.httpFetch_ = fetchSpy;

    const results = listArticles({ tagIds: ["t1", "t2"] });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/rest/v1/rpc/articles_by_tags",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify({ tag_ids: ["t1", "t2"], lim: 50 })
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/articles?" +
        "id=in.(%22a2%22,%22a1%22)" +
        "&select=id,title,status,category_id,created_at,updated_at,categories(id,name),article_tags(tags(id,name))",
      expect.objectContaining({ method: "GET" })
    );
    expect(results.map((r) => r.id)).toEqual(["a2", "a1"]); // RPC 順序保留,不是補查回來的順序
  });

  test("mycr F-04 fix: returns [] and skips the enrichment query when the RPC finds no matching article", () => {
    const fetchSpy = jest.fn().mockReturnValueOnce(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    const results = listArticles({ tagIds: ["t1", "t2"] });

    expect(results).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("mycr F-04 fix: combines tagIds with status and categoryId (AND) via status_filter/category_id_filter", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([{ id: "a1" }])))
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify([{ id: "a1", categories: null, article_tags: [] }]))
      );
    global.httpFetch_ = fetchSpy;

    listArticles({ tagIds: ["t1"], status: "published", categoryId: "cat1" });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/rest/v1/rpc/articles_by_tags",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify({
          tag_ids: ["t1"],
          lim: 50,
          status_filter: "published",
          category_id_filter: "cat1"
        })
      })
    );
  });

  test("mycr F-04 fix: dedupes tagIds before sending to the RPC", () => {
    const fetchSpy = jest.fn().mockReturnValueOnce(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    listArticles({ tagIds: ["t1", "t1", "t2"] });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/rest/v1/rpc/articles_by_tags",
      expect.objectContaining({
        payload: JSON.stringify({ tag_ids: ["t1", "t2"], lim: 50 })
      })
    );
  });

  test("mycr F-04 fix: succeeds when far more articles match than the old ~42-article URL-length limit (this is the regression the fix targets)", () => {
    const manyIds = Array.from({ length: 100 }, (_, i) => "a" + i);
    const rpcRows = manyIds.map((id) => ({ id: id, title: id, status: "published", category_id: null, created_at: "x", updated_at: "x" }));
    const enrichedRows = manyIds.map((id) => ({ id: id, title: id, status: "published", category_id: null, created_at: "x", updated_at: "x", categories: null, article_tags: [] }));
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify(rpcRows)))
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify(enrichedRows)));
    global.httpFetch_ = fetchSpy;

    const results = listArticles({ tagIds: ["t1"], limit: 100 });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/rest/v1/rpc/articles_by_tags",
      expect.objectContaining({ method: "POST" })
    );
    expect(results.length).toBe(100);
  });

  test("behaves exactly as before when tagIds is empty or absent", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    listArticles({ tagIds: [] });
    listArticles({});

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mock.calls.forEach((call) => {
      expect(call[0]).not.toMatch(/rest\/v1\/article_tags\?|&id=in\./);
    });
  });
});

describe("uniqueValues_", () => {
  test("removes duplicates while preserving first-seen order", () => {
    expect(uniqueValues_(["t1", "t1", "t2", "t1", "t3"])).toEqual(["t1", "t2", "t3"]);
    expect(uniqueValues_([])).toEqual([]);
    expect(uniqueValues_(["a"])).toEqual(["a"]);
  });
});

describe("updateArticle", () => {
  test("rejects clearing the title to an empty string before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => updateArticle_("a1", { title: "" })).toThrow(/標題/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("rejects a whitespace-only title before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => updateArticle_("a1", { title: "   " })).toThrow(/標題/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("patches only the fields present in data, and doesn't touch tags when tag_names is absent", () => {
    const currentRow = {
      id: "a1",
      title: "Old title",
      content_md: "old content",
      category_id: null,
      status: "draft",
      categories: null,
      article_tags: []
    };
    const finalRow = {
      id: "a1",
      title: "Old title",
      content_md: "new content",
      category_id: null,
      status: "draft",
      categories: null,
      article_tags: []
    };
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([currentRow]))) // pre-read (touches content_md, so status must be checked first)
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]')) // patch (draft, so no embedding step)
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([finalRow]))); // read-back for return value
    global.httpFetch_ = fetchSpy;

    const article = updateArticle_("a1", { content_md: "new content" });

    expect(fetchSpy).toHaveBeenCalledTimes(3); // no tag-related calls, no Gemini call for a draft
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/articles?id=eq.a1",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ content_md: "new content" })
      })
    );
    expect(article.content_md).toBe("new content");
  });

  test("replaces the tag set (and skips PATCH) when only tag_names is given", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t9","name":"vue"}]')) // find tag
      .mockReturnValueOnce(fakeResponse(200, "")) // delete existing links
      .mockReturnValueOnce(fakeResponse(201, "[]")) // insert new link
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            {
              id: "a1",
              title: "Old title",
              content_md: "old",
              category_id: null,
              status: "draft",
              categories: null,
              article_tags: [{ tags: { id: "t9", name: "vue" } }]
            }
          ])
        )
      ); // getArticle
    global.httpFetch_ = fetchSpy;

    const article = updateArticle_("a1", { tag_names: ["vue"] });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/article_tags?article_id=eq.a1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/rest/v1/article_tags",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([{ article_id: "a1", tag_id: "t9" }])
      })
    );
    expect(article.tags).toEqual([{ id: "t9", name: "vue" }]);
  });

  test("regenerates embedding when content_md changes on a published article", () => {
    fakeConfigWithGemini();
    const currentRow = {
      id: "a1",
      title: "Old title",
      content_md: "old content",
      category_id: null,
      status: "published",
      categories: null,
      article_tags: []
    };
    const finalRow = {
      id: "a1",
      title: "Old title",
      content_md: "new content",
      category_id: null,
      status: "published",
      categories: null,
      article_tags: []
    };
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([currentRow]))) // pre-read (existence + status check)
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.3, 0.4] } }))
      ) // gemini, called before any write
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]')) // single combined patch
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([finalRow]))); // read-back for return value
    global.httpFetch_ = fetchSpy;

    const article = updateArticle_("a1", { content_md: "new content" });

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      expect.anything()
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/rest/v1/articles?id=eq.a1",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ content_md: "new content", embedding: [0.3, 0.4] })
      })
    );
    expect(article.content_md).toBe("new content");
  });

  test("does not touch embedding when only category_id changes on a published article", () => {
    const publishedRow = {
      id: "a1",
      title: "Old title",
      content_md: "old",
      category_id: "cat2",
      status: "published",
      categories: { id: "cat2", name: "New Cat" },
      article_tags: []
    };
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]')) // patch category_id
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([publishedRow]))); // getArticle
    global.httpFetch_ = fetchSpy;

    updateArticle_("a1", { category_id: "cat2" });

    expect(fetchSpy).toHaveBeenCalledTimes(2); // no embedding call
  });

  test("mycr F-01 fix: still succeeds when the shared public-read rate limit is already exhausted, for edits that do and don't touch content", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    const draftRow = {
      id: "a1",
      title: "Old title",
      content_md: "old",
      category_id: null,
      status: "draft",
      categories: null,
      article_tags: []
    };

    // 只改分類(不碰內文,舊順序不變的那條路)
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]')) // patch category_id
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([draftRow]))); // read-back
    expect(() => updateArticle_("a1", { category_id: "cat9" })).not.toThrow();

    // 改內文(有先讀一次判斷狀態的那條路)
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([draftRow]))) // pre-read
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]')) // patch
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([draftRow]))); // read-back
    expect(() => updateArticle_("a1", { content_md: "new" })).not.toThrow();
  });

  test("mycr F-01 fix: when Gemini fails while updating a published article's content, no PATCH is sent to articles at all (no partial commit)", () => {
    fakeConfigWithGemini();
    const publishedRow = {
      id: "a1",
      title: "Old title",
      content_md: "old content",
      category_id: null,
      status: "published",
      categories: null,
      article_tags: []
    };
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([publishedRow]))) // pre-read
      .mockReturnValueOnce(fakeResponse(500, '{"error":"boom"}')); // gemini fails
    global.httpFetch_ = fetchSpy;

    expect(() => updateArticle_("a1", { content_md: "new content" })).toThrow();

    expect(fetchSpy).toHaveBeenCalledTimes(2); // pre-read + failed gemini call, nothing more
    fetchSpy.mock.calls.forEach((call) => {
      expect(call[1]).not.toEqual(expect.objectContaining({ method: "PATCH" }));
    });
  });
});

describe("embedding error propagation", () => {
  test("mycr F-01 fix: a non-2xx Gemini response makes setArticleStatus_('published') throw before any PATCH is sent (no partial commit)", () => {
    fakeConfigWithGemini();
    const currentRow = {
      id: "a1",
      title: "Hi",
      content_md: "Body",
      category_id: null,
      status: "draft",
      categories: null,
      article_tags: []
    };
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([currentRow]))) // pre-read (existence check)
      .mockReturnValueOnce(fakeResponse(500, '{"error":"boom"}')); // gemini fails
    global.httpFetch_ = fetchSpy;

    expect(() => setArticleStatus_("a1", "published")).toThrow(/500.*boom/s);

    expect(fetchSpy).toHaveBeenCalledTimes(2); // pre-read + failed gemini call, nothing more
    fetchSpy.mock.calls.forEach((call) => {
      expect(call[1]).not.toEqual(expect.objectContaining({ method: "PATCH" }));
    });
  });
});

describe("deleteArticle", () => {
  test("issues a DELETE for the article and returns a confirmation object (no attachments)", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, "[]")) // listAttachments: none
      .mockReturnValueOnce(fakeResponse(200, "")); // articles DELETE
    global.httpFetch_ = fetchSpy;

    const result = deleteArticle_("a1");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/rest/v1/attachments?select=*,attachment_folders(id,name)&article_id=eq.a1&order=created_at.asc",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/articles?id=eq.a1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(result).toEqual({ deleted: true, id: "a1" });
  });

  test("deletes the Storage file for each file-backed attachment before deleting the article", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            { id: "att-1", article_id: "a1", type: "photo", file_path: "a1/x.png" },
            { id: "att-2", article_id: "a1", type: "url", url: "https://x.com", file_path: null }
          ])
        )
      ) // listAttachments
      .mockReturnValueOnce(fakeResponse(200, '{"message":"deleted"}')) // storage delete for att-1
      .mockReturnValueOnce(fakeResponse(200, "")); // articles DELETE
    global.httpFetch_ = fetchSpy;

    deleteArticle_("a1");

    // 只有 att-1(有 file_path)觸發 Storage 刪除,att-2(url 型)沒有
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/storage/v1/object/attachments/a1/x.png",
      expect.objectContaining({ method: "delete" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/rest/v1/articles?id=eq.a1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("continues deleting the article even if one attachment's Storage delete fails", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([{ id: "att-1", article_id: "a1", type: "photo", file_path: "a1/x.png" }])
        )
      ) // listAttachments
      .mockReturnValueOnce(fakeResponse(404, '{"error":"not found"}')) // storage delete fails
      .mockReturnValueOnce(fakeResponse(200, "")); // articles DELETE still happens

    global.httpFetch_ = fetchSpy;

    const result = deleteArticle_("a1");

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ deleted: true, id: "a1" });
  });

  test("mycr F-01 fix: still succeeds when the shared public-read rate limit is already exhausted (owner's write shouldn't be blocked by anonymous read traffic)", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([{ id: "att-1", article_id: "a1", type: "photo", file_path: "a1/x.png" }])
        )
      ) // listAttachments
      .mockReturnValueOnce(fakeResponse(200, '{"message":"deleted"}')) // storage delete
      .mockReturnValueOnce(fakeResponse(200, "")); // articles DELETE
    global.httpFetch_ = fetchSpy;

    const result = deleteArticle_("a1");

    expect(result).toEqual({ deleted: true, id: "a1" });
  });
});

describe("setArticleStatus", () => {
  test("throws for an invalid status before making any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => setArticleStatus_("a1", "archived")).toThrow(
      /draft.*published/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("publishing updates status, fetches the article, and triggers embedding exactly once", () => {
    fakeConfigWithGemini();
    const currentRow = {
      id: "a1",
      title: "Hi",
      content_md: "Body",
      category_id: null,
      status: "draft",
      categories: null,
      article_tags: []
    };
    const finalRow = {
      id: "a1",
      title: "Hi",
      content_md: "Body",
      category_id: null,
      status: "published",
      categories: null,
      article_tags: []
    };
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([currentRow]))) // pre-read (existence check + embedding text source)
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1, 0.2] } }))
      ) // gemini, called before any write
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]')) // single combined patch
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([finalRow]))); // read-back for return value
    global.httpFetch_ = fetchSpy;

    const article = setArticleStatus_("a1", "published");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      expect.anything()
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/rest/v1/articles?id=eq.a1",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ status: "published", embedding: [0.1, 0.2] })
      })
    );
    expect(fetchSpy).toHaveBeenCalledTimes(4); // exactly one embedding call in there
    expect(article.status).toBe("published");
  });

  test("setting back to draft does not touch embedding", () => {
    const fullRow = {
      id: "a1",
      title: "Hi",
      content_md: "Body",
      category_id: null,
      status: "draft",
      categories: null,
      article_tags: []
    };
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]')) // patch status
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([fullRow]))); // getArticle
    global.httpFetch_ = fetchSpy;

    setArticleStatus_("a1", "draft");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("mycr F-01 fix: still succeeds when the shared public-read rate limit is already exhausted, both publishing and unpublishing", () => {
    fakeConfigWithGemini();
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    const draftRow = {
      id: "a1",
      title: "Hi",
      content_md: "Body",
      category_id: null,
      status: "draft",
      categories: null,
      article_tags: []
    };
    const publishedRow = Object.assign({}, draftRow, { status: "published" });

    // 取消發布(舊順序不變的那條路)
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]')) // patch status
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([draftRow]))); // read-back
    expect(() => setArticleStatus_("a1", "draft")).not.toThrow();

    // 發布(有先讀一次算 embedding 的那條路)
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([draftRow]))) // pre-read
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))) // gemini
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]')) // combined patch
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([publishedRow]))); // read-back
    expect(() => setArticleStatus_("a1", "published")).not.toThrow();
  });
});

describe("batchDeleteArticles", () => {
  test("rejects a batch larger than 200 items before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;
    const tooMany = Array.from({ length: 201 }, (_, i) => "a" + i);

    expect(() => batchDeleteArticles_(tooMany)).toThrow(/200/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("deletes each article and returns { succeeded, failed: [] } when all succeed", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, "[]")) // a1 listAttachments
      .mockReturnValueOnce(fakeResponse(200, "")) // a1 DELETE
      .mockReturnValueOnce(fakeResponse(200, "[]")) // a2 listAttachments
      .mockReturnValueOnce(fakeResponse(200, "")); // a2 DELETE
    global.httpFetch_ = fetchSpy;

    const result = batchDeleteArticles_(["a1", "a2"]);

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(result).toEqual({ succeeded: ["a1", "a2"], failed: [] });
  });

  test("a single failure is captured without stopping the rest of the batch", () => {
    fakeLogger();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, "[]")) // a1 listAttachments
      .mockReturnValueOnce(fakeResponse(200, "")) // a1 DELETE
      .mockReturnValueOnce(fakeResponse(500, "boom")) // a2 listAttachments -> throws
      .mockReturnValueOnce(fakeResponse(200, "[]")) // a3 listAttachments
      .mockReturnValueOnce(fakeResponse(200, "")); // a3 DELETE
    global.httpFetch_ = fetchSpy;

    const result = batchDeleteArticles_(["a1", "a2", "a3"]);

    expect(fetchSpy).toHaveBeenCalledTimes(5); // a3 still got processed after a2 failed
    expect(result.succeeded).toEqual(["a1", "a3"]);
    expect(result.failed).toEqual([
      { id: "a2", message: expect.stringContaining("資料服務暫時發生問題") }
    ]);
  });
});

describe("batchSetArticlesCategory", () => {
  test("rejects a batch larger than 200 items before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;
    const tooMany = Array.from({ length: 201 }, (_, i) => "a" + i);

    expect(() => batchSetArticlesCategory_(tooMany, "cat-x")).toThrow(/200/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("PATCHes category_id independently for each article, categoryId can be null", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]'))
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a2"}]'));
    global.httpFetch_ = fetchSpy;

    const result = batchSetArticlesCategory_(["a1", "a2"], null);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/rest/v1/articles?id=eq.a1",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ category_id: null })
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/articles?id=eq.a2",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ category_id: null })
      })
    );
    expect(result).toEqual({ succeeded: ["a1", "a2"], failed: [] });
  });

  test("mycr finding: an id that matches 0 rows (nonexistent article) is reported as failed, not silently counted as succeeded", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]')) // a1 exists
      .mockReturnValueOnce(fakeResponse(200, "[]")); // a2 doesn't exist — PATCH matches 0 rows, no error
    global.httpFetch_ = fetchSpy;

    const result = batchSetArticlesCategory_(["a1", "a2"], "cat-x");

    expect(result.succeeded).toEqual(["a1"]);
    expect(result.failed).toEqual([{ id: "a2", message: expect.stringContaining("找不到文章") }]);
  });

  test("a single failure is captured without stopping the rest of the batch", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]'))
      .mockReturnValueOnce(fakeResponse(500, "boom"))
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a3"}]'));
    global.httpFetch_ = fetchSpy;

    const result = batchSetArticlesCategory_(["a1", "a2", "a3"], "cat-x");

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.succeeded).toEqual(["a1", "a3"]);
    expect(result.failed).toEqual([{ id: "a2", message: expect.stringContaining("500") }]);
  });
});

describe("batchAddTagsToArticles", () => {
  test("rejects a batch larger than 200 items before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;
    const tooMany = Array.from({ length: 201 }, (_, i) => "a" + i);

    expect(() => batchAddTagsToArticles_(tooMany, ["JS"])).toThrow(/200/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("mycr finding: rejects more than 200 tagNames before any network call, matching the sibling batch functions' bound check", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;
    const tooManyTags = Array.from({ length: 201 }, (_, i) => "tag" + i);

    expect(() => batchAddTagsToArticles_(["a1"], tooManyTags)).toThrow(/200/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("only inserts tags an article doesn't already have, leaving existing tags untouched", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-js","name":"JS"}]')) // findOrCreateTag_("JS")
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-react","name":"React"}]')) // findOrCreateTag_("React")
      .mockReturnValueOnce(
        fakeResponse(200, '[{"article_id":"a1","tag_id":"t-js"}]')
      ) // a1 already has JS, missing React
      .mockReturnValueOnce(
        fakeResponse(200, '[{"article_id":"a1","tag_id":"t-react"}]')
      ); // insert only the missing one
    global.httpFetch_ = fetchSpy;

    const result = batchAddTagsToArticles_(["a1"], ["JS", "React"]);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "https://x.supabase.co/rest/v1/article_tags",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([{ article_id: "a1", tag_id: "t-react" }])
      })
    );
    expect(result).toEqual({ succeeded: ["a1"], failed: [] });
  });

  test("creates a new tag via findOrCreateTag_ when it doesn't already exist", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, "[]")) // GET tags?name=eq.NewTag -> not found
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-new","name":"NewTag"}]')) // POST tags (create)
      .mockReturnValueOnce(fakeResponse(200, "[]")) // a1 has no existing tags
      .mockReturnValueOnce(fakeResponse(200, '[{"article_id":"a1","tag_id":"t-new"}]')); // insert
    global.httpFetch_ = fetchSpy;

    batchAddTagsToArticles_(["a1"], ["NewTag"]);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/tags",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([{ name: "NewTag" }])
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "https://x.supabase.co/rest/v1/article_tags",
      expect.objectContaining({
        payload: JSON.stringify([{ article_id: "a1", tag_id: "t-new" }])
      })
    );
  });

  test("a single failure is captured without stopping the rest of the batch", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-js","name":"JS"}]')) // findOrCreateTag_("JS")
      .mockReturnValueOnce(fakeResponse(500, "boom")) // a1 existing-tags lookup -> throws
      .mockReturnValueOnce(fakeResponse(200, "[]")) // a2 has no existing tags
      .mockReturnValueOnce(fakeResponse(200, '[{"article_id":"a2","tag_id":"t-js"}]')); // insert for a2
    global.httpFetch_ = fetchSpy;

    const result = batchAddTagsToArticles_(["a1", "a2"], ["JS"]);

    expect(fetchSpy).toHaveBeenCalledTimes(4); // a2 still got processed after a1 failed
    expect(result.succeeded).toEqual(["a2"]);
    expect(result.failed).toEqual([{ id: "a1", message: expect.stringContaining("500") }]);
  });
});
