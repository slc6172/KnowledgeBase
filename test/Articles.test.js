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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/tags?name=eq.react",
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/tags",
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/tags?name=eq.a%26b",
      expect.objectContaining({ method: "GET" })
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?" +
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?" +
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/rpc/articles_by_tags",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify({ tag_ids: ["t1", "t2"], lim: 50 })
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?" +
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/rpc/articles_by_tags",
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/rpc/articles_by_tags",
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/rpc/articles_by_tags",
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/attachments?select=*,attachment_folders(id,name)&article_id=eq.a1&order=created_at.asc",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?id=eq.a1",
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
      "https://x.supabase.co/functions/v1/kb-proxy/storage/v1/object/attachments/a1/x.png",
      expect.objectContaining({ method: "delete" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?id=eq.a1",
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?id=eq.a1",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ category_id: null })
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?id=eq.a2",
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/article_tags",
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/tags",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([{ name: "NewTag" }])
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/article_tags",
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

describe("mycr F-13: listArticles 對匿名呼叫端傳入的參數做型別與範圍檢查", () => {
  const BASE = "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?";
  const lastUrl = () => global.httpFetch_.mock.calls[0][0];
  const emptyOk = () => {
    global.httpFetch_ = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
  };

  test.each([
    [0, 50],
    [-5, 50],
    [0.5, 50],
    ["abc", 50],
    [null, 50],
    [NaN, 50],
    [1.5, 1],
    [2.7, 2],
    [7, 7],
    ["25", 25],
    [100, 100],
    [101, 100],
    [100000, 100],
    [Infinity, 50]
  ])("limit=%p → 送出的 limit 是 %p(一律落在 1–100)", (input, expected) => {
    emptyOk();
    listArticles({ limit: input });
    expect(lastUrl()).toContain("&limit=" + expected);
    expect(lastUrl().match(/&limit=(\d+)/)[1] * 1).toBeGreaterThanOrEqual(1);
    expect(lastUrl().match(/&limit=(\d+)/)[1] * 1).toBeLessThanOrEqual(100);
  });

  test.each([[-1], [1.5], ["x"], [NaN], [Infinity], [0], [null], [undefined]])(
    "offset=%p 不合法 → 不帶 offset",
    (input) => {
      emptyOk();
      listArticles({ offset: input });
      expect(lastUrl()).not.toContain("offset");
    }
  );

  test("offset 為正整數照舊帶入;大得離譜的值夾到上限,不會把 1e+21 這種字串送給 PostgREST", () => {
    emptyOk();
    listArticles({ offset: 40 });
    expect(lastUrl()).toContain("&offset=40");

    emptyOk();
    listArticles({ offset: 1e21 });
    expect(lastUrl()).toContain("&offset=100000");
    expect(lastUrl()).not.toMatch(/e\+/);
  });

  test.each([["abc"], [{ a: 1 }], [5], [null], [true]])(
    "tagIds=%p 不是陣列 → 視為沒有標籤篩選:不呼叫 articles_by_tags、不丟 TypeError",
    (input) => {
      emptyOk();
      expect(() => listArticles({ tagIds: input })).not.toThrow();
      expect(lastUrl().startsWith(BASE + "select=id,title")).toBe(true);
      expect(lastUrl()).not.toContain("rpc/articles_by_tags");
    }
  );

  test("tagIds 是合法陣列 → 仍走 articles_by_tags RPC,去重,limit 同樣受上限約束", () => {
    global.httpFetch_ = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    listArticles({ tagIds: ["t1", "t1", "t2"], limit: 100000 });
    const [url, params] = global.httpFetch_.mock.calls[0];
    expect(url).toContain("rpc/articles_by_tags");
    expect(JSON.parse(params.payload)).toEqual({ tag_ids: ["t1", "t2"], lim: 100 });
  });

  test("tagIds 是空陣列 → 與沒有篩選相同(既有行為)", () => {
    emptyOk();
    listArticles({ tagIds: [] });
    expect(lastUrl()).not.toContain("rpc/");
  });
});

describe("mycr F-15: deleteArticle_ 刪除 Storage 檔案失敗時留下可追蹤的日誌", () => {
  const attachmentsList = (rows) => fakeResponse(200, JSON.stringify(rows));

  test("某個附件的 Storage 刪除回 5xx:文章仍被刪除、日誌含該附件路徑、其他附件照常刪除", () => {
    const { logs } = fakeLogger();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        attachmentsList([
          { id: "att-1", article_id: "a1", type: "photo", file_path: "a1/orphan.png" },
          { id: "att-2", article_id: "a1", type: "pdf", file_path: "a1/fine.pdf" }
        ])
      )
      .mockReturnValueOnce(fakeResponse(503, "storage unavailable")) // att-1 刪除失敗
      .mockReturnValueOnce(fakeResponse(200, '{"message":"deleted"}')) // att-2 成功
      .mockReturnValueOnce(fakeResponse(200, "")); // articles DELETE
    global.httpFetch_ = fetchSpy;

    const result = deleteArticle_("a1");

    expect(result).toEqual({ deleted: true, id: "a1" });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy.mock.calls[2][0]).toContain("storage/v1/object/attachments/a1/fine.pdf");
    expect(fetchSpy.mock.calls[3][1].method).toBe("DELETE");

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("attachments/a1/orphan.png");
    expect(logs[0]).toMatch(/孤兒|手動/);
    expect(logs[0]).not.toContain("a1/fine.pdf");
  });

  test("日誌不含共用密鑰", () => {
    const { logs } = fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(attachmentsList([{ id: "att-1", article_id: "a1", type: "photo", file_path: "a1/x.png" }]))
      .mockReturnValueOnce(fakeResponse(500, "boom"))
      .mockReturnValueOnce(fakeResponse(200, ""));

    deleteArticle_("a1");

    expect(logs.join("\n")).not.toContain("proxy-secret");
  });

  test("全部 Storage 刪除都成功時,不寫任何孤兒檔案日誌", () => {
    const { logs } = fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(attachmentsList([{ id: "att-1", article_id: "a1", type: "photo", file_path: "a1/x.png" }]))
      .mockReturnValueOnce(fakeResponse(200, '{"message":"deleted"}'))
      .mockReturnValueOnce(fakeResponse(200, ""));

    deleteArticle_("a1");

    expect(logs).toEqual([]);
  });

  test("url 型附件(沒有 file_path)不會觸發 Storage 刪除,也不寫日誌", () => {
    const { logs } = fakeLogger();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(attachmentsList([{ id: "att-2", article_id: "a1", type: "url", file_path: null }]))
      .mockReturnValueOnce(fakeResponse(200, ""));
    global.httpFetch_ = fetchSpy;

    deleteArticle_("a1");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(logs).toEqual([]);
  });
});

describe("mycr F-13: 前端頁面大小不超過後端 limit 上限(否則分頁會被悄悄截斷)", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

  test("ARTICLE_LIST_PAGE_SIZE <= LIST_LIMIT_MAX_,且 tag 篩選等現行用法的 limit 也在範圍內", () => {
    const pageSize = Number(read("src/JavaScript.html").match(/var ARTICLE_LIST_PAGE_SIZE\s*=\s*(\d+)/)[1]);
    const max = Number(read("src/Articles.gs").match(/var LIST_LIMIT_MAX_\s*=\s*(\d+)/)[1]);
    const def = Number(read("src/Articles.gs").match(/var LIST_LIMIT_DEFAULT_\s*=\s*(\d+)/)[1]);
    expect(pageSize).toBeGreaterThanOrEqual(1);
    expect(pageSize).toBeLessThanOrEqual(max);
    expect(def).toBeLessThanOrEqual(max);
  });

  test("掃描邏輯本身:頁面大小超過上限時會被抓到(內建樣本)", () => {
    const extract = (src, re) => Number(src.match(re)[1]);
    expect(extract("var ARTICLE_LIST_PAGE_SIZE = 150;", /var ARTICLE_LIST_PAGE_SIZE\s*=\s*(\d+)/)).toBeGreaterThan(
      extract("var LIST_LIMIT_MAX_ = 100;", /var LIST_LIMIT_MAX_\s*=\s*(\d+)/)
    );
  });
});
