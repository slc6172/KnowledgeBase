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
});

describe("regenerateArticleEmbedding_", () => {
  test("embeds title + '\\n\\n' + content_md and PATCHes the result back to articles.embedding", () => {
    fakeConfigWithGemini();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.7, 0.8] } }))
      ) // gemini
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]')); // supabase patch
    global.httpFetch_ = fetchSpy;

    regenerateArticleEmbedding_({ id: "a1", title: "Hi", content_md: "Body" });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      expect.objectContaining({
        payload: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: "Hi\n\nBody" }] },
          outputDimensionality: 768
        })
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/articles?id=eq.a1",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ embedding: [0.7, 0.8] })
      })
    );
  });

  test("URL-encodes article.id containing PostgREST-reserved characters", () => {
    fakeConfigWithGemini();
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))
      )
      .mockReturnValueOnce(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    regenerateArticleEmbedding_({ id: "a&b", title: "Hi", content_md: "Body" });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/articles?id=eq.a%26b",
      expect.objectContaining({ method: "PATCH" })
    );
  });
});
