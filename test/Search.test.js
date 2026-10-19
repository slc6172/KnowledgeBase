const { loadCoreGas, fakeConfig, fakeConfigWithGemini, fakeCacheService, fakeLogger, fakeResponse } = require("./helpers/testSetup");
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
  test("degradation: when Gemini embedding returns 429, still calls the RPC with an empty (null) vector and returns the enriched results with degraded:true", () => {
    fakeConfigWithGemini();
    fakeLogger();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(429, '{"error":"quota"}')) // gemini embedding fails
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([{ id: "a1", title: "A", content_md: "a" }]))) // rpc
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([{ id: "a1", title: "A", content_md: "a", categories: null, article_tags: [] }])
        )
      ); // enrichment
    global.httpFetch_ = fetchSpy;

    const result = searchArticles("react hooks");

    expect(result.degraded).toBe(true);
    expect(result.articles.map((r) => r.id)).toEqual(["a1"]);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/rpc/hybrid_search_articles",
      expect.objectContaining({
        method: "POST",
        // 空向量 = JSON null:已用真實 PostgreSQL 16 + pgvector 驗證 hybrid_search_articles
        // 收到 NULL 時語意那一路自然為空、關鍵字那一路照常回傳(空陣列 [] 則會因
        // vector(768) 維度檢查而失敗,不能用)。
        payload: JSON.stringify({ query_text: "react hooks", query_embedding: null, tag_ids: [] })
      })
    );
  });

  describe("degradation triggers: every failure of the embedding step (and only that step) degrades", () => {
    const rpcAndEnrichment = (fetchSpy) =>
      fetchSpy
        .mockReturnValueOnce(fakeResponse(200, JSON.stringify([{ id: "a1", title: "A", content_md: "a" }]))) // rpc
        .mockReturnValueOnce(
          fakeResponse(
            200,
            JSON.stringify([{ id: "a1", title: "A", content_md: "a", categories: null, article_tags: [] }])
          )
        ); // enrichment

    test.each([
      ["Gemini returns 500", (spy) => spy.mockReturnValueOnce(fakeResponse(500, "boom"))],
      [
        "httpFetch_ throws a network exception / timeout",
        (spy) =>
          spy.mockImplementationOnce(() => {
            throw new Error("Exception: Timeout");
          })
      ],
      [
        "Gemini returns 200 with a malformed body (no embedding.values)",
        (spy) => spy.mockReturnValueOnce(fakeResponse(200, JSON.stringify({ unexpected: true })))
      ],
      [
        "Gemini returns 200 with a non-JSON body",
        (spy) => spy.mockReturnValueOnce(fakeResponse(200, "<html>bad gateway</html>"))
      ]
    ])("%s → degraded:true and the RPC still runs", (_label, arrangeGemini) => {
      fakeConfigWithGemini();
      fakeLogger();
      const fetchSpy = jest.fn();
      arrangeGemini(fetchSpy);
      rpcAndEnrichment(fetchSpy);
      global.httpFetch_ = fetchSpy;

      const result = searchArticles("react");

      expect(result.degraded).toBe(true);
      expect(result.articles.map((r) => r.id)).toEqual(["a1"]);
      expect(JSON.parse(fetchSpy.mock.calls[1][1].payload).query_embedding).toBeNull();
    });

    test("GEMINI_API_KEY missing → degraded:true, Gemini is never called, the RPC still runs", () => {
      fakeConfig(); // 沒有 GEMINI_API_KEY
      fakeLogger();
      const fetchSpy = jest.fn();
      rpcAndEnrichment(fetchSpy);
      global.httpFetch_ = fetchSpy;

      const result = searchArticles("react");

      expect(result.degraded).toBe(true);
      expect(fetchSpy.mock.calls[0][0]).toMatch(/rpc\/hybrid_search_articles$/); // 第一個請求就是 RPC
    });
  });

  describe("degradation: everything after the embedding step behaves exactly as before", () => {
    test("RPC returns empty while degraded → { articles: [], degraded: true }, no enrichment call", () => {
      fakeConfigWithGemini();
      fakeLogger();
      const fetchSpy = jest
        .fn()
        .mockReturnValueOnce(fakeResponse(429, "quota"))
        .mockReturnValueOnce(fakeResponse(200, "[]"));
      global.httpFetch_ = fetchSpy;

      expect(searchArticles("React")).toEqual({ articles: [], degraded: true });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    test("optional filters (tagIds, matchCount, onlyPublished, thresholds) are still passed to the RPC while degraded", () => {
      fakeConfigWithGemini();
      fakeLogger();
      const fetchSpy = jest
        .fn()
        .mockReturnValueOnce(fakeResponse(503, "unavailable"))
        .mockReturnValueOnce(fakeResponse(200, "[]"));
      global.httpFetch_ = fetchSpy;

      searchArticles("react", {
        tagIds: ["t1", "t2", "t1"],
        matchCount: 7,
        onlyPublished: true,
        maxSemanticDistance: 0.4,
        minFullTextSimilarity: 0.2
      });

      expect(JSON.parse(fetchSpy.mock.calls[1][1].payload)).toEqual({
        query_text: "react",
        query_embedding: null,
        tag_ids: ["t1", "t2"],
        match_count: 7,
        only_published: true,
        max_semantic_distance: 0.4,
        min_full_text_similarity: 0.2
      });
    });

    test("RPC failure while degraded still throws the generic data-service message (not swallowed by the degradation)", () => {
      fakeConfigWithGemini();
      fakeLogger();
      global.httpFetch_ = jest
        .fn()
        .mockReturnValueOnce(fakeResponse(429, "quota"))
        .mockReturnValueOnce(fakeResponse(500, 'column "secret_internal_field" does not exist'));

      let caught;
      try {
        searchArticles("react");
      } catch (err) {
        caught = err;
      }
      expect(caught.message).toMatch(/資料服務暫時發生問題/);
      expect(caught.message).not.toMatch(/secret_internal_field/);
    });

    test("RPC non-array response while degraded still throws", () => {
      fakeConfigWithGemini();
      fakeLogger();
      global.httpFetch_ = jest
        .fn()
        .mockReturnValueOnce(fakeResponse(429, "quota"))
        .mockReturnValueOnce(fakeResponse(200, JSON.stringify({ message: "ambiguous" })));

      expect(() => searchArticles("react")).toThrow(/資料服務暫時發生問題/);
    });

    test("enrichment query failure while degraded still throws (not swallowed)", () => {
      fakeConfigWithGemini();
      fakeLogger();
      global.httpFetch_ = jest
        .fn()
        .mockReturnValueOnce(fakeResponse(429, "quota"))
        .mockReturnValueOnce(fakeResponse(200, JSON.stringify([{ id: "a1" }])))
        .mockReturnValueOnce(fakeResponse(500, "enrichment broke"));

      expect(() => searchArticles("react")).toThrow(/資料服務暫時發生問題/);
    });
  });

  describe("degradation: guards and logging", () => {
    test("the semantic-search throttle counter still increments in degraded mode (degradation is not a way around the usage protection)", () => {
      fakeConfigWithGemini();
      fakeLogger();
      global.httpFetch_ = jest.fn().mockImplementation((url) =>
        /generativelanguage/.test(url) ? fakeResponse(429, "quota") : fakeResponse(200, "[]")
      );
      const windowKey =
        "semantic_search_" + Math.floor(Date.now() / (SEMANTIC_SEARCH_RATE_LIMIT_WINDOW_SECONDS_ * 1000));

      searchArticles("one");
      searchArticles("two");

      expect(Number(global.CacheService.getScriptCache().get(windowKey))).toBe(2);
    });

    test("when the semantic-search throttle trips, it throws (no degradation) and neither Gemini nor the RPC is called", () => {
      fakeConfigWithGemini();
      const fetchSpy = jest.fn();
      global.httpFetch_ = fetchSpy;
      global.CacheService.getScriptCache().put(
        "semantic_search_" + Math.floor(Date.now() / (SEMANTIC_SEARCH_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
        String(SEMANTIC_SEARCH_RATE_LIMIT_)
      );

      expect(() => searchArticles("react")).toThrow(/太頻繁/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("logs the degradation reason with its category and message", () => {
      fakeConfigWithGemini();
      const logger = fakeLogger();
      global.httpFetch_ = jest
        .fn()
        .mockReturnValueOnce(fakeResponse(429, '{"error":"quota exceeded"}'))
        .mockReturnValueOnce(fakeResponse(200, "[]"));

      searchArticles("react");

      const line = logger.logs.find((l) => /降級/.test(l));
      expect(line).toBeDefined();
      expect(line).toMatch(/\[searchArticles\]/);
      expect(line).toMatch(/ai/); // 錯誤分類
      expect(line).toMatch(/429/);
      expect(line).toMatch(/quota exceeded/);
    });

    test("the logged reason never contains the Gemini API key, even if the upstream error body echoes it", () => {
      fakeConfigWithGemini();
      const logger = fakeLogger();
      global.httpFetch_ = jest
        .fn()
        .mockReturnValueOnce(fakeResponse(400, "API key not valid: gem-key. Please pass a valid API key."))
        .mockReturnValueOnce(fakeResponse(200, "[]"));

      searchArticles("react");

      expect(logger.logs.join("\n")).not.toContain("gem-key");
      expect(logger.logs.some((l) => /降級/.test(l))).toBe(true);
    });

    test("the degradation reason is not returned to the caller (only the boolean flag is)", () => {
      fakeConfigWithGemini();
      fakeLogger();
      global.httpFetch_ = jest
        .fn()
        .mockReturnValueOnce(fakeResponse(429, '{"error":"quota exceeded"}'))
        .mockReturnValueOnce(fakeResponse(200, "[]"));

      const result = searchArticles("react");

      expect(Object.keys(result).sort()).toEqual(["articles", "degraded"]);
      expect(JSON.stringify(result)).not.toMatch(/quota/);
    });
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

    const result = searchArticles("react hooks");
    const results = result.articles;

    expect(result.degraded).toBe(false); // 向量產生成功 → 不是降級結果
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/rpc/hybrid_search_articles",
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?id=in.(%22a2%22,%22a1%22)&select=id,title,content_md,status,category_id,created_at,updated_at,categories(id,name),article_tags(tags(id,name))",
      expect.objectContaining({ method: "GET" })
    );
    expect(results.map((r) => r.id)).toEqual(["a2", "a1"]); // RPC order preserved
    expect(results[0].tags).toEqual([]); // normalizeArticleRow_ applied
  });

  test("returns { articles: [], degraded: false } when the RPC returns null, without any enrichment call", () => {
    fakeConfigWithGemini();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))) // gemini
      .mockReturnValueOnce(fakeResponse(200, "null")); // rpc
    global.httpFetch_ = fetchSpy;

    expect(searchArticles("react")).toEqual({ articles: [], degraded: false });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/rpc/hybrid_search_articles",
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
    expect(results).toEqual({ articles: [], degraded: false });
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/rpc/hybrid_search_articles",
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

  test("the non-degrading path (used by askKnowledgeBase) still propagates a failed embedding call with the generic AI-service message, and never calls the RPC", () => {
    fakeConfigWithGemini();
    fakeLogger();
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(500, '{"error":"gemini down"}'));
    global.httpFetch_ = fetchSpy;

    expect(() => searchArticlesInternal_("react", {}, false)).toThrow(/AI 服務暫時發生問題/);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // 只有 Gemini 那一次,沒有 RPC
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

describe("mycr F-13: searchArticles 對非陣列的 tagIds 的處理", () => {
  test.each([["abc"], [{ a: 1 }], [5], [true]])(
    "opts.tagIds=%p 不是陣列 → 視為沒有標籤篩選(tag_ids: []),不丟 TypeError",
    (badTagIds) => {
      fakeConfigWithGemini();
      const fetchSpy = jest
        .fn()
        .mockReturnValueOnce(fakeResponse(200, JSON.stringify({ embedding: { values: [0.1, 0.2] } }))) // gemini
        .mockReturnValueOnce(fakeResponse(200, "[]")); // rpc:無結果就不會有補查
      global.httpFetch_ = fetchSpy;

      expect(() => searchArticles("react", { tagIds: badTagIds })).not.toThrow();
      expect(JSON.parse(fetchSpy.mock.calls[1][1].payload).tag_ids).toEqual([]);
    }
  );
});
