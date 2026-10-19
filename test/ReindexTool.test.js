const { loadCoreGas, fakeLogger, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

/**
 * 票 03(spec_chunked_embeddings):一次性重建工具的骨架與試跑。
 * 工具檔在 tools/(不在 src/),需要時才手動上傳到 Apps Script 專案,用完刪除。
 */
let deletedProps;
function fakeProps(extra) {
  deletedProps = [];
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => {
        const all = Object.assign(
          { SUPABASE_URL: "https://x.supabase.co", EDGE_PROXY_SECRET: "proxy-secret", GEMINI_API_KEY: "gem-key" },
          extra
        );
        return all[key] === undefined ? null : all[key];
      },
      deleteProperty: (key) => {
        deletedProps.push(key);
      }
    })
  };
}

let logs;
beforeEach(() => {
  loadCoreGas();
  logs = fakeLogger().logs;
  loadGas("../../src/Embeddings.gs");
  loadGas("../../src/Chunking.gs");
  loadGas("../../tools/Reindex.gs");
});

const PROXY = "https://x.supabase.co/functions/v1/kb-proxy/";
const article = (id, title, content) => ({ id, title, content_md: content });

describe("reindexDryRun: 開關", () => {
  test.each([[undefined], ["false"], ["TRUE"], ["yes"], [""], ["1"]])(
    "REINDEX_ENABLED=%p → 拒絕,且不發出任何請求(試跑也受控)",
    (value) => {
      fakeProps({ REINDEX_ENABLED: value });
      const fetchSpy = jest.fn();
      global.httpFetch_ = fetchSpy;

      expect(() => reindexDryRun()).toThrow(/REINDEX_ENABLED/);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );
});

describe("reindexDryRun: 試跑只讀取、只寫日誌", () => {
  test("開啟後:一個 RPC 取得待重建清單 + 讀取文章內容;不呼叫 Gemini、不做任何寫入;日誌含文章數、段數、預估請求數", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([{ id: "a1" }, { id: "a2" }])))
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify([article("a1", "短文", "一句話"), article("a2", "長文", "x".repeat(3200))]))
      );
    global.httpFetch_ = fetchSpy;

    const result = reindexDryRun();

    expect(result).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe(PROXY + "rest/v1/rpc/articles_needing_reindex");
    expect(fetchSpy.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchSpy.mock.calls[0][1].payload)).toEqual({ current_model: "gemini-embedding-001/768" });
    expect(fetchSpy.mock.calls[1][1].method).toBe("GET");
    expect(fetchSpy.mock.calls[1][0]).toContain("rest/v1/articles?select=id,title,content_md&id=in.(");
    // 沒有任何一個請求碰 Gemini
    expect(fetchSpy.mock.calls.every((c) => !String(c[0]).includes("generativelanguage"))).toBe(true);

    const text = logs.join("\n");
    expect(text).toMatch(/待重建文章\s*2\s*篇/);
    expect(text).toMatch(/共\s*4\s*段/); // 1 段 + 3 段(3200 字硬切成 1500/1500/200)
    expect(text).toMatch(/預估\s*Gemini\s*請求\s*2\s*次/);
  });

  test("沒有待重建的文章:只發出一個請求,日誌說明", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    const fetchSpy = jest.fn().mockReturnValueOnce(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    reindexDryRun();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toMatch(/沒有需要重建/);
  });

  test("超過 40 段的文章:日誌列出 id 與標題,不計入預估請求,不讓整批失敗", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([{ id: "a1" }, { id: "huge" }])))
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify([article("a1", "正常", "短"), article("huge", "超長文章", "x".repeat(61000))]))
      );

    reindexDryRun();

    const text = logs.join("\n");
    expect(text).toMatch(/超過\s*40\s*段/);
    expect(text).toContain("huge");
    expect(text).toContain("超長文章");
    expect(text).toMatch(/待重建文章\s*1\s*篇/); // 只有正常的那篇可處理
    expect(text).toMatch(/預估\s*Gemini\s*請求\s*1\s*次/);
  });

  test("待重建文章很多時分批讀取內容(每批 50 篇),不會把幾百個 id 塞進同一個網址", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    const ids = Array.from({ length: 120 }, (_, i) => ({ id: "id-" + i }));
    const fetchSpy = jest.fn().mockReturnValueOnce(fakeResponse(200, JSON.stringify(ids))).mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    reindexDryRun();

    expect(fetchSpy).toHaveBeenCalledTimes(1 + 3); // 120 篇 = 50 + 50 + 20
    const urls = fetchSpy.mock.calls.slice(1).map((c) => c[0]);
    urls.forEach((u) => expect(u.length).toBeLessThan(2000));
  });

  test("日誌不含文章內容,也不含任何金鑰", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([{ id: "a1" }])))
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify([article("a1", "標題", "機密內容-SECRET-BODY")])));

    reindexDryRun();

    const text = logs.join("\n");
    expect(text).not.toContain("SECRET-BODY");
    expect(text).not.toContain("proxy-secret");
    expect(text).not.toContain("gem-key");
  });

  test("上游錯誤時丟出錯誤(由編輯器顯示),不吞掉", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    global.httpFetch_ = jest.fn().mockReturnValueOnce(fakeResponse(500, "boom"));
    expect(() => reindexDryRun()).toThrow();
  });
});

describe("模型識別字串", () => {
  test("EMBEDDING_MODEL_ID_ 由模型名稱與維度組成,並與 generateEmbedding_ 實際使用的值一致", () => {
    expect(EMBEDDING_MODEL_NAME_).toBe("gemini-embedding-001");
    expect(EMBEDDING_DIMENSIONS_).toBe(768);
    expect(EMBEDDING_MODEL_ID_).toBe("gemini-embedding-001/768");

    fakeProps({});
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, JSON.stringify({ embedding: { values: [0.1] } })));
    global.httpFetch_ = fetchSpy;
    generateEmbedding_("x");
    expect(fetchSpy.mock.calls[0][0]).toContain("models/" + EMBEDDING_MODEL_NAME_ + ":embedContent");
    expect(JSON.parse(fetchSpy.mock.calls[0][1].payload).outputDimensionality).toBe(EMBEDDING_DIMENSIONS_);
  });
});


// ---- 票 08:reindexAllArticles ------------------------------------------------

describe("reindexAllArticles", () => {
  const RPC_URL = PROXY + "rest/v1/rpc/articles_needing_reindex";
  const SAVE_URL = PROXY + "rest/v1/rpc/save_article";
  const isGemini = (u) => String(u).includes("generativelanguage.googleapis.com");

  // 假世界:candidates = 待重建文章(含內容);hooks 可針對特定文章讓 Gemini / save 失敗,或推進時鐘
  function world(candidates, hooks = {}) {
    const calls = [];
    const saves = [];
    const w = { calls, saves };
    w.fetch = jest.fn((url, params) => {
      const method = String((params && params.method) || "get").toUpperCase();
      const body = params && params.payload ? JSON.parse(params.payload) : undefined;
      calls.push({ url, method, body });
      if (url === RPC_URL) return fakeResponse(200, JSON.stringify(candidates.map((a) => ({ id: a.id }))));
      if (url.startsWith(PROXY + "rest/v1/articles?")) {
        const wanted = decodeURIComponent(url.match(/id=in\.\((.*)\)/)[1]).replace(/"/g, "").split(",");
        return fakeResponse(200, JSON.stringify(candidates.filter((a) => wanted.includes(a.id))));
      }
      if (isGemini(url)) {
        // 這個批次屬於哪篇文章:從第一筆文字的標題辨認(嵌入文字 = 標題 + 空行 + 段落)
        const firstText = body.requests[0].content.parts[0].text;
        const title = firstText.split("\n\n")[0];
        if (hooks.onGemini) {
          const forced = hooks.onGemini(title);
          if (forced) return forced;
        }
        const embeddings = body.requests.map((r, i) => ({ values: Object.assign(new Array(768).fill(0), { 0: i + 1 }) }));
        return fakeResponse(200, JSON.stringify({ embeddings }));
      }
      if (url === SAVE_URL) {
        if (hooks.onSave) {
          const forced = hooks.onSave(body);
          if (forced) return forced;
        }
        saves.push(body);
        return fakeResponse(200, "{}");
      }
      throw new Error("unexpected request " + method + " " + url);
    });
    global.httpFetch_ = w.fetch;
    return w;
  }
  const art = (n, content) => ({ id: "id-" + n, title: "標題" + n, content_md: content === undefined ? "內容" + n : content });
  const geminiCalls = (w) => w.calls.filter((c) => isGemini(c.url));

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([[undefined], ["false"], ["TRUE"], [""]])("REINDEX_ENABLED=%p → 拒絕,不發出任何請求", (value) => {
    fakeProps({ REINDEX_ENABLED: value });
    const spy = jest.fn();
    global.httpFetch_ = spy;
    expect(() => reindexAllArticles()).toThrow(/REINDEX_ENABLED/);
    expect(spy).not.toHaveBeenCalled();
    expect(deletedProps).toEqual([]);
  });

  test("正常流程:每篇一個批次嵌入請求 + 一個 save_article(只帶段落與模型);全部完成後自動刪除 Property;不回傳資料", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    const w = world([art(1), art(2, "x".repeat(3200))]);

    const result = reindexAllArticles();

    expect(result).toBeUndefined();
    expect(geminiCalls(w)).toHaveLength(2);
    expect(w.saves).toHaveLength(2);
    // 只帶段落與模型:沒有欄位、沒有標籤(文章的 updated_at 與標籤不會被動到)
    w.saves.forEach((body) => expect(Object.keys(body).sort()).toEqual(["p_chunks", "p_embedding_model", "p_id"]));
    expect(w.saves[0].p_id).toBe("id-1");
    expect(w.saves[0].p_embedding_model).toBe("gemini-embedding-001/768");
    expect(w.saves[0].p_chunks.map((c) => c.content)).toEqual(["內容1"]);
    expect(w.saves[1].p_chunks).toHaveLength(3); // 3200 字 → 1500 / 1500 / 200
    expect(w.saves[1].p_chunks.map((c) => c.embedding[0])).toEqual([1, 2, 3]); // 第 i 段配第 i 個向量
    // 嵌入文字帶標題
    expect(geminiCalls(w)[0].body.requests[0].content.parts[0].text).toBe("標題1\n\n內容1");
    expect(deletedProps).toEqual(["REINDEX_ENABLED"]);
    expect(logs.join("\n")).toMatch(/已處理\s*2\s*篇/);
  });

  test("沒有待重建的文章:視為完成,同樣自動刪除 Property", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    const w = world([]);
    reindexAllArticles();
    expect(w.calls).toHaveLength(1);
    expect(deletedProps).toEqual(["REINDEX_ENABLED"]);
    expect(logs.join("\n")).toMatch(/沒有需要重建/);
  });

  test("時間預算用完:不再開始新文章,記錄已處理 / 剩餘,Property 保留以便續跑", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    let now = 1000000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const w = world([art(1), art(2), art(3)], {
      onGemini: (title) => {
        if (title === "標題1") now += REINDEX_TIME_BUDGET_MS_ + 1000; // 第一篇處理完就超過預算
      }
    });

    reindexAllArticles();

    expect(w.saves.map((b) => b.p_id)).toEqual(["id-1"]); // 只做了第一篇
    expect(geminiCalls(w)).toHaveLength(1);
    expect(deletedProps).toEqual([]); // 保留 Property
    const text = logs.join("\n");
    expect(text).toMatch(/已處理\s*1\s*篇/);
    expect(text).toMatch(/剩餘\s*2\s*篇/);
    expect(text).toMatch(/再執行一次/);
  });

  test("續跑:第二次執行只拿到剩餘的文章(待重建清單由資料庫依 embedding_model 判斷),做完才解除", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    const w = world([art(2), art(3)]); // 第一篇在前一次已經完成,不會再出現在待重建清單
    reindexAllArticles();
    expect(w.saves.map((b) => b.p_id)).toEqual(["id-2", "id-3"]);
    expect(deletedProps).toEqual(["REINDEX_ENABLED"]);
  });

  test("Gemini 回 429:優雅停止,後面的文章不再嘗試,Property 保留,日誌說明", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    const w = world([art(1), art(2), art(3)], {
      onGemini: (title) => (title === "標題2" ? fakeResponse(429, '{"error":{"message":"quota"}}') : null)
    });

    reindexAllArticles();

    expect(w.saves.map((b) => b.p_id)).toEqual(["id-1"]);
    expect(geminiCalls(w)).toHaveLength(2); // 第 3 篇沒有嘗試
    expect(deletedProps).toEqual([]);
    expect(logs.join("\n")).toMatch(/429|額度|速率/);
  });

  test("Gemini 回 429:日誌說明免費層的額度(每分鐘 100、每天 1,000,每一段算一個請求),並告訴擁有者先等一分鐘再執行;若仍失敗可能是當天額度用完", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    world([art(1), art(2)], { onGemini: (title) => (title === "標題2" ? fakeResponse(429, "{}") : null) });
    reindexAllArticles();
    const text = logs.join("\n");
    expect(text).toMatch(/每分鐘/);
    expect(text).toMatch(/每天|當天|隔天/);
    expect(text).toMatch(/等.{0,6}分鐘/);
    expect(text).toMatch(/每一段/);
  });

  test("其他 Gemini 錯誤(500):記錄該篇(id、標題、簡短原因)並繼續下一篇;有失敗就不解除 Property", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    const w = world([art(1), art(2), art(3)], {
      onGemini: (title) => (title === "標題2" ? fakeResponse(500, "upstream boom") : null)
    });

    reindexAllArticles();

    expect(w.saves.map((b) => b.p_id)).toEqual(["id-1", "id-3"]);
    expect(deletedProps).toEqual([]);
    const text = logs.join("\n");
    expect(text).toMatch(/失敗\s*1\s*篇/);
    expect(text).toContain("id-2");
    expect(text).toContain("標題2");
  });

  test("save_article 失敗:同樣記錄該篇並繼續下一篇,不使整批失敗", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    const w = world([art(1), art(2)], {
      onSave: (body) => (body.p_id === "id-1" ? fakeResponse(400, '{"message":"too many chunks"}') : null)
    });

    reindexAllArticles();

    expect(w.saves.map((b) => b.p_id)).toEqual(["id-2"]);
    expect(deletedProps).toEqual([]);
    expect(logs.join("\n")).toMatch(/失敗\s*1\s*篇/);
  });

  test("超過 40 段的文章:記錄並略過,不使整批失敗;其餘做完就算完成並解除 Property", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    const w = world([art(1), art(2, "x".repeat(61000)), art(3)]);

    reindexAllArticles();

    expect(w.saves.map((b) => b.p_id)).toEqual(["id-1", "id-3"]);
    expect(geminiCalls(w)).toHaveLength(2); // 超長那篇完全沒有呼叫 Gemini
    expect(deletedProps).toEqual(["REINDEX_ENABLED"]);
    const text = logs.join("\n");
    expect(text).toMatch(/超過\s*40\s*段/);
    expect(text).toContain("id-2");
  });

  test("日誌與錯誤訊息不含文章內容與金鑰", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    world([art(1, "機密內容-SECRET-BODY"), art(2, "另一篇機密-SECRET-TWO")], {
      onGemini: (title) => (title === "標題2" ? fakeResponse(500, "boom") : null)
    });

    reindexAllArticles();

    const text = logs.join("\n");
    expect(text).not.toContain("SECRET-BODY");
    expect(text).not.toContain("SECRET-TWO");
    expect(text).not.toContain("proxy-secret");
    expect(text).not.toContain("gem-key");
  });

  test("沒有發出任何寫入文章欄位的請求:只有 save_article(只帶段落)", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    const w = world([art(1), art(2)]);
    reindexAllArticles();
    const writes = w.calls.filter((c) => c.method !== "GET" && !isGemini(c.url) && c.url !== RPC_URL);
    expect(writes.every((c) => c.url === SAVE_URL)).toBe(true);
  });
});
