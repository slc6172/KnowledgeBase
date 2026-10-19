const { loadCoreGas, fakeConfig, fakeConfigWithGemini, fakeLogger, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  loadGas("../../src/Embeddings.gs");
});

describe("generateEmbedding_", () => {
  test("throws when GEMINI_API_KEY is not configured", () => {
    fakeConfig(); // no GEMINI_API_KEY
    expect(() => generateEmbedding_("hello")).toThrow(/GEMINI_API_KEY/);
  });

  test("calls gemini-embedding-001 with the right headers/payload and returns embedding.values", () => {
    fakeConfigWithGemini();
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, JSON.stringify({ embedding: { values: [0.1, 0.2] } })));
    global.httpFetch_ = fetchSpy;

    const values = generateEmbedding_("hello world");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      expect.objectContaining({
        method: "post",
        headers: expect.objectContaining({ "x-goog-api-key": "gem-key" }),
        payload: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: "hello world" }] },
          outputDimensionality: 768
        })
      })
    );
    expect(values).toEqual([0.1, 0.2]);
  });

  test("throws when Gemini responds with a non-2xx status", () => {
    fakeConfigWithGemini();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(429, '{"error":"rate limited"}'));

    expect(() => generateEmbedding_("hello")).toThrow(/429.*rate limited/s);
  });

  test("throws a clear message (not a raw TypeError) when the 2xx response has no embedding.values", () => {
    fakeConfigWithGemini();
    global.httpFetch_ = jest.fn().mockReturnValue(fakeResponse(200, JSON.stringify({})));

    expect(() => generateEmbedding_("hello")).toThrow(/AI 服務回應格式異常/);
  });
});

// ---- spec_chunked_embeddings 票 04:批次嵌入 ---------------------------------

describe("generateEmbeddingsBatch_", () => {
  beforeEach(() => {
    fakeLogger(); // withSafeErrors_ 會寫日誌
  });
  const DIM = 768;
  // 第一個元素帶著「這是第幾筆」的記號,其餘填 0:用來檢查回傳順序有沒有對回輸入
  const vecWithMark = (mark) => {
    const v = new Array(DIM).fill(0);
    v[0] = mark;
    return v;
  };
  // 假 Gemini:依請求裡每筆文字結尾的數字回傳對應記號的向量
  const echoMarkServer = () =>
    jest.fn().mockImplementation((url, params) => {
      const requests = JSON.parse(params.payload).requests;
      const embeddings = requests.map((r) => {
        const mark = Number(r.content.parts[0].text.replace(/\D+/g, "") || 0);
        return { values: vecWithMark(mark) };
      });
      return fakeResponse(200, JSON.stringify({ embeddings }));
    });

  const catchError = (fn) => {
    try {
      fn();
    } catch (e) {
      return e;
    }
    return undefined;
  };

  test("輸入為空陣列 → 回傳空陣列,不發出請求,也不需要金鑰", () => {
    fakeConfig(); // 沒有 GEMINI_API_KEY
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;
    expect(generateEmbeddingsBatch_([])).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("缺少 GEMINI_API_KEY → 明確錯誤", () => {
    fakeConfig();
    expect(() => generateEmbeddingsBatch_(["x"])).toThrow(/GEMINI_API_KEY/);
  });

  test("請求形狀:一次請求、每筆含 model / content / outputDimensionality,金鑰只放標頭", () => {
    fakeConfigWithGemini();
    const fetchSpy = echoMarkServer();
    global.httpFetch_ = fetchSpy;

    generateEmbeddingsBatch_(["text 1", "text 2", "text 3"]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, params] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents");
    expect(url).not.toContain("gem-key");
    expect(params.method).toBe("post");
    expect(params.headers["x-goog-api-key"]).toBe("gem-key");
    expect(JSON.parse(params.payload)).toEqual({
      requests: ["text 1", "text 2", "text 3"].map((t) => ({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: t }] },
        outputDimensionality: 768
      }))
    });
  });

  test("第 i 個回傳向量對應第 i 筆輸入", () => {
    fakeConfigWithGemini();
    global.httpFetch_ = echoMarkServer();
    const out = generateEmbeddingsBatch_(["chunk 7", "chunk 3", "chunk 9", "chunk 1"]);
    expect(out.map((v) => v[0])).toEqual([7, 3, 9, 1]);
    expect(out.every((v) => v.length === 768)).toBe(true);
  });

  test("超過單次批次上限時自動分批,結果依序合併", () => {
    fakeConfigWithGemini();
    const fetchSpy = echoMarkServer();
    global.httpFetch_ = fetchSpy;
    const texts = Array.from({ length: EMBEDDING_BATCH_MAX_ * 2 + 5 }, (_, i) => "chunk " + i);

    const out = generateEmbeddingsBatch_(texts);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].payload).requests).toHaveLength(EMBEDDING_BATCH_MAX_);
    expect(JSON.parse(fetchSpy.mock.calls[2][1].payload).requests).toHaveLength(5);
    expect(out.map((v) => v[0])).toEqual(texts.map((_, i) => i));
  });

  test.each([
    ["向量數比輸入少", (n) => ({ embeddings: Array.from({ length: n - 1 }, () => ({ values: new Array(768).fill(0) })) })],
    ["向量數比輸入多", (n) => ({ embeddings: Array.from({ length: n + 1 }, () => ({ values: new Array(768).fill(0) })) })],
    ["缺少 embeddings 欄位", () => ({})],
    ["embeddings 不是陣列", () => ({ embeddings: "oops" })],
    ["其中一個向量維度不是 768", (n) => ({ embeddings: Array.from({ length: n }, (_, i) => ({ values: new Array(i === 1 ? 3 : 768).fill(0) })) })],
    ["其中一個元素沒有 values", (n) => ({ embeddings: Array.from({ length: n }, (_, i) => (i === 0 ? {} : { values: new Array(768).fill(0) })) })]
  ])("回應異常(%s)→ 分類為 AI 的上游錯誤,整批視為失敗", (name, makeBody) => {
    fakeConfigWithGemini();
    global.httpFetch_ = jest.fn().mockReturnValue(fakeResponse(200, JSON.stringify(makeBody(3))));

    const err = catchError(() => generateEmbeddingsBatch_(["a", "b", "c"]));

    expect(err).toBeDefined();
    expect(err.isUpstreamError_).toBe(true);
    expect(err.upstreamCategory_).toBe(UPSTREAM_ERROR_CATEGORY_AI_);
    expect(err.message).not.toContain("gem-key");
    // 經 withSafeErrors_ 後使用者只看到安全訊息
    expect(() => withSafeErrors_("batch", () => generateEmbeddingsBatch_(["a", "b", "c"]))).toThrow(/AI 服務暫時發生問題/);
  });

  test.each([[400], [429], [500]])("Gemini 回 %i → AI 分類的上游錯誤,訊息不含金鑰", (code) => {
    fakeConfigWithGemini();
    global.httpFetch_ = jest.fn().mockReturnValue(fakeResponse(code, '{"error":{"message":"quota"}}'));

    const err = catchError(() => generateEmbeddingsBatch_(["a"]));

    expect(err.isUpstreamError_).toBe(true);
    expect(err.upstreamCategory_).toBe(UPSTREAM_ERROR_CATEGORY_AI_);
    expect(err.message).toContain(String(code));
    expect(err.message).not.toContain("gem-key");
  });

  test("某一批失敗 → 整個呼叫失敗,不回傳部分結果", () => {
    fakeConfigWithGemini();
    const ok = echoMarkServer();
    let calls = 0;
    global.httpFetch_ = jest.fn().mockImplementation((u, p) => {
      calls += 1;
      return calls === 2 ? fakeResponse(500, "boom") : ok(u, p);
    });
    const texts = Array.from({ length: EMBEDDING_BATCH_MAX_ + 1 }, (_, i) => "chunk " + i);
    expect(() => generateEmbeddingsBatch_(texts)).toThrow();
  });

  test("批次大小是單一常數,且不超過資料庫的段數上限(40)", () => {
    expect(EMBEDDING_BATCH_MAX_).toBeGreaterThanOrEqual(1);
    expect(EMBEDDING_BATCH_MAX_).toBeLessThanOrEqual(40);
  });

  test("查詢向量的單筆函式行為不變(沿用同一組模型常數)", () => {
    fakeConfigWithGemini();
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, JSON.stringify({ embedding: { values: [0.5] } })));
    global.httpFetch_ = fetchSpy;
    expect(generateEmbedding_("q")).toEqual([0.5]);
    expect(fetchSpy.mock.calls[0][0]).toContain(":embedContent");
  });
});
