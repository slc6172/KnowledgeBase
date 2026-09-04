const { loadGas } = require("./helpers/loadGas");
const {
  fakeConfigWithWritePasswordAndGemini,
  fakeResponse
} = require("./helpers/testSetup");

beforeEach(() => {
  fakeConfigWithWritePasswordAndGemini(null); // 預設「還沒設定密碼」,個別測試再覆寫
  loadGas("../../src/Config.gs");
  loadGas("../../src/HttpTransport.gs");
  loadGas("../../src/SupabaseClient.gs");
  loadGas("../../src/Auth.gs");
  loadGas("../../src/Embeddings.gs");
  loadGas("../../src/Articles.gs");
  loadGas("../../src/Search.gs");
  loadGas("../../src/RagChat.gs");
});

describe("askKnowledgeBase", () => {
  test("throws '密碼錯誤' and makes no network calls when the password is wrong", () => {
    fakeConfigWithWritePasswordAndGemini("correct-horse");
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => askKnowledgeBase("react hooks", "wrong", [])).toThrow(/密碼錯誤/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns noRelevantArticles:true and never calls Gemini generateContent when searchArticles finds nothing", () => {
    fakeConfigWithWritePasswordAndGemini("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))
      ) // gemini embedding (inside searchArticles)
      .mockReturnValueOnce(fakeResponse(200, "[]")); // hybrid_search_articles RPC: no results
    global.httpFetch_ = fetchSpy;

    const result = askKnowledgeBase("react hooks", "correct-horse", []);

    expect(fetchSpy).toHaveBeenCalledTimes(2); // embedding + RPC only, no generateContent call
    expect(result).toEqual({ answer: null, noRelevantArticles: true, sources: [] });
  });

  test("calls Gemini generateContent with a prompt grounded in the retrieved articles, and returns answer + sources", () => {
    fakeConfigWithWritePasswordAndGemini("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))
      ) // gemini embedding (inside searchArticles)
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify([{ id: "a1", title: "React Hooks 入門" }]))
      ) // hybrid_search_articles RPC
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            {
              id: "a1",
              title: "React Hooks 入門",
              content_md: "useState 用來管理狀態。",
              categories: null,
              article_tags: []
            }
          ])
        )
      ) // enrichment select
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "useState 是一個 React Hook。" }] } }]
          })
        )
      ); // gemini generateContent
    global.httpFetch_ = fetchSpy;

    const result = askKnowledgeBase("什麼是 useState", "correct-horse", []);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
      expect.objectContaining({
        method: "post",
        headers: expect.objectContaining({ "x-goog-api-key": "gem-key" })
      })
    );
    const sentPrompt = JSON.parse(fetchSpy.mock.calls[3][1].payload).contents[0].parts[0].text;
    expect(sentPrompt).toEqual(expect.stringContaining("只根據"));
    expect(sentPrompt).toEqual(expect.stringContaining("useState 用來管理狀態。"));
    expect(sentPrompt).toEqual(expect.stringContaining("什麼是 useState"));

    expect(result).toEqual({
      answer: "useState 是一個 React Hook。",
      noRelevantArticles: false,
      sources: [{ id: "a1", title: "React Hooks 入門" }]
    });
  });

  test("includes conversation history in the Gemini prompt without changing the retrieval call", () => {
    fakeConfigWithWritePasswordAndGemini("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))
      ) // gemini embedding
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify([{ id: "a1", title: "React Hooks 入門" }]))
      ) // rpc
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            {
              id: "a1",
              title: "React Hooks 入門",
              content_md: "useEffect 用來處理副作用。",
              categories: null,
              article_tags: []
            }
          ])
        )
      ) // enrichment
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "跟 useState 的差別是..." }] } }]
          })
        )
      ); // generateContent
    global.httpFetch_ = fetchSpy;

    const history = [{ question: "什麼是 useState", answer: "useState 是一個 React Hook。" }];
    askKnowledgeBase("那 useEffect 呢", "correct-horse", history);

    // 檢索(第 2 通呼叫,hybrid_search_articles RPC)不吃歷史,payload 跟沒有
    // 歷史時完全一樣的形狀。
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/rpc/hybrid_search_articles",
      expect.objectContaining({
        payload: JSON.stringify({
          query_text: "那 useEffect 呢",
          query_embedding: [0.1],
          tag_ids: [],
          only_published: true,
          max_semantic_distance: 0.4
        })
      })
    );

    // 歷史只出現在餵給 Gemini 的 prompt 裡。
    const sentPrompt = JSON.parse(fetchSpy.mock.calls[3][1].payload).contents[0].parts[0].text;
    expect(sentPrompt).toEqual(expect.stringContaining("什麼是 useState"));
    expect(sentPrompt).toEqual(expect.stringContaining("useState 是一個 React Hook。"));
  });

  test("propagates a failed Gemini generateContent call instead of falling back silently", () => {
    fakeConfigWithWritePasswordAndGemini("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } }))
      ) // gemini embedding
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify([{ id: "a1", title: "React Hooks 入門" }]))
      ) // rpc
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            {
              id: "a1",
              title: "React Hooks 入門",
              content_md: "useState 用來管理狀態。",
              categories: null,
              article_tags: []
            }
          ])
        )
      ) // enrichment
      .mockReturnValueOnce(fakeResponse(500, '{"error":"gemini down"}')); // generateContent fails
    global.httpFetch_ = fetchSpy;

    expect(() => askKnowledgeBase("什麼是 useState", "correct-horse", [])).toThrow(
      /500.*gemini down/s
    );
  });
});
