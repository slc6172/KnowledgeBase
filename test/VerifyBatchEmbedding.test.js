const { loadCoreGas, fakeLogger, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

/**
 * 票 04 的人工驗證函式(tools/VerifyBatchEmbedding.gs):由擁有者在 Apps Script 編輯器執行,
 * 用真實金鑰實測 (a) 批次回傳順序是否與請求一致、(b) 單次請求最多可帶幾筆。
 * 這裡驗證函式本身的邏輯(開關、日誌、不洩漏、不回傳),真實 API 的結果由擁有者貼回。
 */
function fakeProps(extra) {
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => {
        const all = Object.assign({ SUPABASE_URL: "https://x.supabase.co", EDGE_PROXY_SECRET: "proxy-secret", GEMINI_API_KEY: "gem-key" }, extra);
        return all[key] === undefined ? null : all[key];
      }
    })
  };
}

// 每段文字對應一個獨特的軸向量,所以順序對不對可以用相似度看出來
const axisFor = (text) => {
  const v = new Array(768).fill(0);
  v[(text.charCodeAt(0) * 7 + text.length) % 768] = 1;
  return v;
};

function fakeGemini({ reverseBatch = false, maxBatch = 100, quotaItems = Infinity } = {}) {
  let used = 0; // 模擬免費層「每分鐘 N 個請求、每一筆文字算一個」:累計超過就 429
  return jest.fn().mockImplementation((url, params) => {
    const body = JSON.parse(params.payload);
    used += String(url).endsWith(":embedContent") ? 1 : body.requests.length;
    if (used > quotaItems) {
      return fakeResponse(429, '{"error":{"code":429,"message":"You exceeded your current quota"}}');
    }
    if (String(url).endsWith(":embedContent")) {
      return fakeResponse(200, JSON.stringify({ embedding: { values: axisFor(body.content.parts[0].text) } }));
    }
    const requests = body.requests;
    if (requests.length > maxBatch) return fakeResponse(400, '{"error":{"message":"too many requests in batch"}}');
    let embeddings = requests.map((r) => ({ values: axisFor(r.content.parts[0].text) }));
    if (reverseBatch) embeddings = embeddings.reverse();
    return fakeResponse(200, JSON.stringify({ embeddings }));
  });
}

let logs;
beforeEach(() => {
  loadCoreGas();
  logs = fakeLogger().logs;
  // 刻意「不」載入 src/Embeddings.gs:這支驗證函式是在新版程式上線「之前」執行的,
  // 擁有者專案裡已部署的版本沒有任何這次新增的函式(第一版就是因為呼叫了 requestEmbeddingBatch_
  // 而在擁有者的專案裡出現 ReferenceError)。它只能依賴舊版本一定有的 getConfig_ 與 httpFetch_。
  loadGas("../../tools/VerifyBatchEmbedding.gs");
});

describe("verifyBatchEmbedding", () => {
  test.each([[undefined], ["false"], ["TRUE"], [""]])("REINDEX_ENABLED=%p → 拒絕,不發出任何請求", (value) => {
    fakeProps({ REINDEX_ENABLED: value });
    const spy = jest.fn();
    global.httpFetch_ = spy;
    expect(() => verifyBatchEmbedding()).toThrow(/REINDEX_ENABLED/);
    expect(spy).not.toHaveBeenCalled();
  });

  test("一切正常:順序一致、40/41/100 筆都成功;只寫日誌、不回傳", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    global.httpFetch_ = fakeGemini();

    const result = verifyBatchEmbedding();

    expect(result).toBeUndefined();
    const text = logs.join("\n");
    expect(text).toMatch(/順序一致:是/);
    expect(text).toMatch(/40 筆 → 成功/);
    expect(text).toMatch(/41 筆 → 成功/);
    expect(text).toMatch(/100 筆 → 成功/);
    expect(text).toMatch(/最大成功筆數:100/);
  });

  test("回傳順序被打亂 → 日誌明確指出『順序一致:否』", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    global.httpFetch_ = fakeGemini({ reverseBatch: true });
    verifyBatchEmbedding();
    expect(logs.join("\n")).toMatch(/順序一致:否/);
  });

  test("單次上限是 40 → 41 與 100 筆被記錄為失敗(含 HTTP 狀態),最大成功筆數為 40,並提示下修常數的條件", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    global.httpFetch_ = fakeGemini({ maxBatch: 40 });
    verifyBatchEmbedding();
    const text = logs.join("\n");
    expect(text).toMatch(/40 筆 → 成功/);
    expect(text).toMatch(/41 筆 → 失敗.*400/);
    expect(text).toMatch(/100 筆 → 失敗/);
    expect(text).toMatch(/最大成功筆數:40/);
  });

  test("單次上限小於 40(例如 10)→ 40 筆也失敗,日誌建議把 EMBEDDING_BATCH_MAX_ 下修", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    global.httpFetch_ = fakeGemini({ maxBatch: 10 });
    verifyBatchEmbedding();
    const text = logs.join("\n");
    expect(text).toMatch(/40 筆 → 失敗/);
    expect(text).toMatch(/EMBEDDING_BATCH_MAX_/);
  });

  test("429 是額度/速率限制,不是筆數上限:100 筆遇到 429 時,日誌明說這一點,結論仍是 40 筆可行(因為 40 筆成功了)", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    // 3 + 3 + 40 + 41 = 87 筆之後,再送 100 筆就超過每分鐘 100 的額度(與擁有者的實測一致)
    global.httpFetch_ = fakeGemini({ quotaItems: 100 });
    verifyBatchEmbedding();
    const text = logs.join("\n");
    expect(text).toMatch(/40 筆 → 成功/);
    expect(text).toMatch(/41 筆 → 成功/);
    expect(text).toMatch(/100 筆 → 失敗.*429.*額度|100 筆 → 失敗.*額度.*429/s);
    expect(text).toMatch(/不是筆數上限/);
    expect(text).toMatch(/最大成功筆數:41/);
    expect(text).toMatch(/40 筆一個請求可行/);
  });

  test("連 40 筆都遇到 429(額度已被用掉):結論是『無法判斷』並要求等一分鐘重跑,絕不建議下修批次大小", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    global.httpFetch_ = fakeGemini({ quotaItems: 10 }); // 順序測試用掉 6 筆,40 筆就爆了
    verifyBatchEmbedding();
    const text = logs.join("\n");
    expect(text).toMatch(/無法判斷/);
    expect(text).toMatch(/等.{0,6}分鐘/);
    expect(text).not.toMatch(/下修到不超過/);
  });

  test("日誌不含金鑰", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    global.httpFetch_ = fakeGemini({ maxBatch: 40 });
    verifyBatchEmbedding();
    const text = logs.join("\n");
    expect(text).not.toContain("gem-key");
    expect(text).not.toContain("proxy-secret");
  });

  test("驗證用的批次很小的測試字串,不是真實文章內容(不會把知識庫內容送去 Gemini)", () => {
    fakeProps({ REINDEX_ENABLED: "true" });
    const spy = fakeGemini();
    global.httpFetch_ = spy;
    verifyBatchEmbedding();
    spy.mock.calls.forEach(([url, params]) => {
      expect(String(url)).toContain("generativelanguage.googleapis.com");
      expect(String(url)).not.toContain("supabase");
    });
  });
});


describe("驗證函式必須能在『新版程式還沒上線』的專案裡執行", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "../tools/VerifyBatchEmbedding.gs"), "utf8");
  // 去掉註解與字串字面值:只檢查真正的程式識別字(日誌裡提醒擁有者去調整某個常數的『文字』不算引用)
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");

  test("不引用任何只存在於新版 src/ 的函式或常數(只能用舊版就有的 getConfig_ 與 httpFetch_)", () => {
    const newOnly = [
      "requestEmbeddingBatch_",
      "generateEmbeddingsBatch_",
      "generateEmbedding_", // 舊版其實有,但它之後會被改寫;獨立實作才不會受部署狀態影響
      "EMBEDDING_MODEL_NAME_",
      "EMBEDDING_DIMENSIONS_",
      "EMBEDDING_MODEL_ID_",
      "EMBEDDING_BATCH_MAX_",
      "splitIntoChunks_",
      "markUpstreamError_",
      "supabaseRpc_"
    ];
    const used = newOnly.filter((name) => code.includes(name));
    expect(used).toEqual([]);
  });

  test("說明裡不再要求『需要專案目前已部署的版本』,而是寫明它是獨立的", () => {
    expect(source.slice(0, 3000)).toMatch(/獨立|自給自足|不依賴/);
  });

  test("即使專案裡已經有新版的 Embeddings.gs,也不會與它的名稱衝突(兩者都載入仍能執行)", () => {
    loadGas("../../src/Embeddings.gs");
    loadGas("../../tools/VerifyBatchEmbedding.gs");
    fakeProps({ REINDEX_ENABLED: "true" });
    global.httpFetch_ = fakeGemini();
    expect(() => verifyBatchEmbedding()).not.toThrow();
  });
});
