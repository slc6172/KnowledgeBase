const { loadCoreGas, fakeConfigWithGemini, fakeCacheService, fakeLogger, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  fakeCacheService();
  loadGas("../../src/Auth.gs");
  loadGas("../../src/Embeddings.gs");
  loadGas("../../src/Articles.gs");
  loadGas("../../src/Search.gs");
});

describe("searchArticles", () => {
  test("mycr finding: converts an upstream Gemini embedding failure into the generic AI-service message", () => {
    fakeConfigWithGemini();
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(429, '{"error":"rate limited"}')); // gemini embedding

    let caught;
    try {
      searchArticles("useState");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/AI 服務暫時發生問題/);
    expect(caught.message).not.toMatch(/rate limited/);
  });

  test("mycr finding: converts an upstream Supabase RPC failure into the generic data-service message", () => {
    fakeConfigWithGemini();
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))) // gemini embedding
      .mockReturnValueOnce(fakeResponse(500, 'column "secret_internal_field" does not exist')); // rpc

    let caught;
    try {
      searchArticles("useState");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/資料服務暫時發生問題/);
    expect(caught.message).not.toMatch(/secret_internal_field/);
  });

  test("mycr finding: is also subject to the shared public-read rate limit, layered on top of its own semantic-search-specific limit (two different shared resources — UrlFetch quota vs Gemini quota)", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    // 一般讀取上限先擋下來,連 queryText 驗證、語意搜尋頻率限制都還沒輪到。
    expect(() => searchArticles("react")).toThrow(/使用量過大/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("throws for an empty or missing queryText before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => searchArticles("")).toThrow(/搜尋文字/);
    expect(() => searchArticles()).toThrow(/搜尋文字/);
    expect(() => searchArticles("   ")).toThrow(/搜尋文字/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("mycr finding: throws for queryText longer than SEARCH_QUERY_MAX_LENGTH_, before any network call (bounds per-request payload size, independent of the 20/min frequency limit)", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    const tooLong = "a".repeat(SEARCH_QUERY_MAX_LENGTH_ + 1);
    const exactlyAtLimit = "a".repeat(SEARCH_QUERY_MAX_LENGTH_);

    expect(() => searchArticles(tooLong)).toThrow(/搜尋文字過長/);
    expect(fetchSpy).not.toHaveBeenCalled();

    // 剛好等於上限不算過長——只有「超過」才擋,這裡確認到目前為止還沒
    // 因為長度被擋下來(embedding 呼叫本身有沒有成功是下一個測試的責任,
    // 這裡只驗證長度檢查本身的邊界)。
    fakeConfigWithGemini();
    fetchSpy.mockReturnValueOnce(fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } })));
    fetchSpy.mockReturnValueOnce(fakeResponse(200, "[]"));
    expect(() => searchArticles(exactlyAtLimit)).not.toThrow();
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
      "https://x.supabase.co/rest/v1/articles?id=in.(%22a2%22,%22a1%22)&select=id,title,content_md,status,category_id,created_at,updated_at,categories(id,name),article_tags(tags(id,name))",
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
      expect.stringContaining("id=in.(" + encodeURIComponent('"a,b"') + ")"),
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

  test("mycr finding: deduplicates opts.tagIds before sending tag_ids to the RPC, so a duplicate tagId doesn't inflate the AND-match threshold hybrid_search_articles computes from array_length(tag_ids, 1)", () => {
    fakeConfigWithGemini();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } })))
      .mockReturnValueOnce(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    searchArticles("react", { tagIds: ["tag-1", "tag-1", "tag-2"] });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/rpc/hybrid_search_articles",
      expect.objectContaining({
        payload: JSON.stringify({
          query_text: "react",
          query_embedding: [0.1],
          tag_ids: ["tag-1", "tag-2"]
        })
      })
    );
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
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(500, '{"error":"gemini down"}'));

    expect(() => searchArticles("react")).toThrow(/AI 服務暫時發生問題/);
  });

  test("bug fix: throws a clear error instead of a TypeError when the RPC returns a non-array (e.g. PostgREST's ambiguous-function response)", () => {
    fakeConfigWithGemini();
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))
      )
      .mockReturnValueOnce(
        fakeResponse(200, '{"message":"Could not choose the best candidate function"}')
      );

    expect(() => searchArticles("react")).toThrow(/資料服務暫時發生問題/);
  });

  test("mycr finding: the non-array RPC response error is routed through the same generic-message conversion as other upstream errors, not shown raw to the caller", () => {
    fakeConfigWithGemini();
    const logger = fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))
      )
      .mockReturnValueOnce(
        fakeResponse(200, '{"message":"Could not choose the best candidate function"}')
      );

    let caught;
    try {
      searchArticles("react");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/資料服務暫時發生問題/);
    expect(caught.message).not.toMatch(/Could not choose the best candidate function/);
    expect(
      logger.logs.some((l) => /Could not choose the best candidate function/.test(l))
    ).toBe(true);
  });
});

describe("searchArticles semantic search rate limit", () => {
  function fetchThatAnswersGeminiAndEmptyRpc() {
    return jest.fn((url) => {
      if (String(url).indexOf("embedContent") !== -1) {
        return fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }));
      }
      return fakeResponse(200, "[]"); // rpc: empty result, no enrichment call follows
    });
  }

  test("allows calls up to SEMANTIC_SEARCH_RATE_LIMIT_ within the window, then rejects further calls without touching Gemini/the RPC", () => {
    fakeConfigWithGemini();
    const fetchSpy = fetchThatAnswersGeminiAndEmptyRpc();
    global.httpFetch_ = fetchSpy;

    for (let i = 0; i < SEMANTIC_SEARCH_RATE_LIMIT_; i++) {
      expect(() => searchArticles("query " + i)).not.toThrow();
    }
    const callsBeforeLimit = fetchSpy.mock.calls.length;

    expect(() => searchArticles("one too many")).toThrow(/太頻繁/);
    expect(fetchSpy.mock.calls.length).toBe(callsBeforeLimit); // 被擋下時完全沒有再打 Gemini/RPC
  });

  test("rejects when the shared counter is already at the limit, regardless of who incremented it (e.g. other callers in the same window)", () => {
    fakeConfigWithGemini();
    global.CacheService.getScriptCache().put("semantic_search_" + Math.floor(Date.now() / (SEMANTIC_SEARCH_RATE_LIMIT_WINDOW_SECONDS_ * 1000)), String(SEMANTIC_SEARCH_RATE_LIMIT_));
    const fetchSpy = fetchThatAnswersGeminiAndEmptyRpc();
    global.httpFetch_ = fetchSpy;

    expect(() => searchArticles("anything")).toThrow(/太頻繁/);
  });
});
