const { loadCoreGas, fakeConfig, fakeCacheService, fakeLogger, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  fakeCacheService();
  loadGas("../../src/Auth.gs");
  loadGas("../../src/Articles.gs");
  loadGas("../../src/RelatedArticles.gs");
});

describe("getRelatedArticles", () => {
  test("mycr finding: converts an upstream Supabase failure into the generic data-service message", () => {
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(500, 'column "secret_internal_field" does not exist'));

    let caught;
    try {
      getRelatedArticles("a1");
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

    expect(() => getRelatedArticles("a1")).toThrow(/使用量過大/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("calls related_articles with source_article_id/match_count:3, and returns [] with no further calls when the RPC returns no rows", () => {
    fakeConfig();
    const fetchSpy = jest.fn().mockReturnValueOnce(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    const results = getRelatedArticles("a1");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/rpc/related_articles",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify({ source_article_id: "a1", match_count: 3 })
      })
    );
    expect(results).toEqual([]);
  });

  test("enriches with categories/tags, preserves RPC relevance order, and normalizes rows", () => {
    fakeConfig();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([{ id: "a2", title: "B" }, { id: "a1", title: "A" }])
        )
      ) // rpc, relevance order a2 then a1
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            { id: "a1", title: "A", categories: null, article_tags: [] },
            { id: "a2", title: "B", categories: null, article_tags: [] }
          ])
        )
      ); // enrichment, different order than rpc
    global.httpFetch_ = fetchSpy;

    const results = getRelatedArticles("source-1");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?id=in.(%22a2%22,%22a1%22)&select=id,title,category_id,created_at,updated_at,categories(id,name),article_tags(tags(id,name))",
      expect.objectContaining({ method: "GET" })
    );
    expect(results.map((r) => r.id)).toEqual(["a2", "a1"]); // RPC order preserved
    expect(results[0].tags).toEqual([]); // normalizeArticleRow_ applied
  });

  test("URL-encodes ids in the in.() clause so a comma inside an id can't be mistaken for the list separator", () => {
    fakeConfig();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([{ id: "a,b" }])))
      .mockReturnValueOnce(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    getRelatedArticles("source-1");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("id=in.(" + encodeURIComponent('"a,b"') + ")"),
      expect.objectContaining({ method: "GET" })
    );
  });
});
