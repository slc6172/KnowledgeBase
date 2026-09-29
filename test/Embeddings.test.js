const { loadCoreGas, fakeConfig, fakeConfigWithGemini, fakeResponse } = require("./helpers/testSetup");
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
