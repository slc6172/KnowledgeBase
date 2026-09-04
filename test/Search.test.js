const { loadCoreGas, fakeConfigWithGemini, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  loadGas("../../src/Embeddings.gs");
  loadGas("../../src/Articles.gs");
  loadGas("../../src/Search.gs");
});

describe("searchArticles", () => {
  test("throws for an empty or missing queryText before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => searchArticles("")).toThrow(/搜尋文字/);
    expect(() => searchArticles()).toThrow(/搜尋文字/);
    expect(() => searchArticles("   ")).toThrow(/搜尋文字/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("embeds, calls the RPC, enriches with categories/tags, and returns results in RPC order", () => {
    fakeConfigWithGemini();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1, 0.2] } }))
      ) // gemini
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            { id: "a2", title: "B", content_md: "b" },
            { id: "a1", title: "A", content_md: "a" }
          ])
        )
      ) // rpc, in relevance order a2 then a1
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            { id: "a1", title: "A", content_md: "a", categories: null, article_tags: [] },
            { id: "a2", title: "B", content_md: "b", categories: null, article_tags: [] }
          ])
        )
      ); // enrichment, different order than rpc
    global.httpFetch_ = fetchSpy;

    const results = searchArticles("react hooks");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/rpc/hybrid_search_articles",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify({
          query_text: "react hooks",
          query_embedding: [0.1, 0.2],
          tag_ids: []
        })
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/rest/v1/articles?id=in.(a2,a1)&select=id,title,content_md,status,category_id,created_at,updated_at,categories(id,name),article_tags(tags(id,name))",
      expect.objectContaining({ method: "GET" })
    );
    expect(results.map((r) => r.id)).toEqual(["a2", "a1"]); // RPC order preserved
    expect(results[0].tags).toEqual([]); // normalizeArticleRow_ applied
  });

  test("URL-encodes ids in the in.() clause so a comma inside an id can't be mistaken for the list separator", () => {
    fakeConfigWithGemini();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1, 0.2] } }))
      ) // gemini
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([{ id: "a,b" }]))) // rpc
      .mockReturnValueOnce(fakeResponse(200, "[]")); // enrichment
    global.httpFetch_ = fetchSpy;

    searchArticles("react hooks");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("id=in.(" + encodeURIComponent("a,b") + ")"),
      expect.objectContaining({ method: "GET" })
    );
  });

  test("reflects opts.tagIds/matchCount/onlyPublished/maxSemanticDistance/minFullTextSimilarity in the RPC payload when provided", () => {
    fakeConfigWithGemini();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))
      ) // gemini
      .mockReturnValueOnce(fakeResponse(200, "[]")); // rpc (empty, no enrichment follows)
    global.httpFetch_ = fetchSpy;

    const results = searchArticles("react", {
      tagIds: ["tag-1", "tag-2"],
      matchCount: 5,
      onlyPublished: false,
      maxSemanticDistance: 0.4,
      minFullTextSimilarity: 0.5
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/rpc/hybrid_search_articles",
      expect.objectContaining({
        payload: JSON.stringify({
          query_text: "react",
          query_embedding: [0.1],
          tag_ids: ["tag-1", "tag-2"],
          match_count: 5,
          only_published: false,
          max_semantic_distance: 0.4,
          min_full_text_similarity: 0.5
        })
      })
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2); // no enrichment call for an empty RPC result
    expect(results).toEqual([]);
  });

  test("search-relevance/01: omits min_full_text_similarity from the RPC payload when not provided, so the SQL function's own default (0.3) applies", () => {
    fakeConfigWithGemini();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))
      )
      .mockReturnValueOnce(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    searchArticles("react");

    const rpcCall = fetchSpy.mock.calls[1];
    const payload = JSON.parse(rpcCall[1].payload);
    expect(payload).not.toHaveProperty("min_full_text_similarity");
  });

  test("propagates a failed embedding call instead of falling back silently", () => {
    fakeConfigWithGemini();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(500, '{"error":"gemini down"}'));

    expect(() => searchArticles("react")).toThrow(/500.*gemini down/s);
  });

  test("bug fix: throws a clear error instead of a TypeError when the RPC returns a non-array (e.g. PostgREST's ambiguous-function response)", () => {
    fakeConfigWithGemini();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))
      )
      .mockReturnValueOnce(
        fakeResponse(200, '{"message":"Could not choose the best candidate function"}')
      );

    expect(() => searchArticles("react")).toThrow(/非預期的格式|不是陣列/);
  });
});
