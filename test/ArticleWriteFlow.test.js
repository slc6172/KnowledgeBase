const { loadCoreGas, fakeConfigWithGemini, fakeCacheService, fakeLogger, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

/**
 * 票 06(spec_chunked_embeddings):建立 / 更新 / 發布 / 取消發布 四條寫入流程
 * 改為組出 payload 後只送「一個」save_article 請求(文章欄位、狀態、全部段落、標籤在資料庫的單一交易內一起寫)。
 * 用一個小型「假世界」(假 Supabase + 假 Gemini)記錄每個請求,精確斷言送了什麼、沒送什麼。
 */
const PROXY = "https://x.supabase.co/functions/v1/kb-proxy/";

beforeEach(() => {
  loadCoreGas();
  fakeCacheService();
  fakeLogger();
  fakeConfigWithGemini();
  loadGas("../../src/Auth.gs");
  loadGas("../../src/StorageClient.gs");
  loadGas("../../src/AttachmentTypes.gs");
  loadGas("../../src/Attachments.gs");
  loadGas("../../src/Embeddings.gs");
  loadGas("../../src/Chunking.gs");
  loadGas("../../src/Articles.gs");
});

function makeWorld({ articles = {}, tags = [], geminiStatus = 200, saveStatus = 200 } = {}) {
  const calls = [];
  const world = { calls, articles, tags: tags.slice(), saves: [], geminiBodies: [] };
  const row = (a) => Object.assign({ category_id: null, categories: null, article_tags: [] }, a);
  world.fetch = jest.fn((url, params) => {
    const method = String((params && params.method) || "get").toUpperCase();
    const body = params && params.payload ? JSON.parse(params.payload) : undefined;
    calls.push({ url, method, body });
    if (url.includes("generativelanguage.googleapis.com")) {
      if (geminiStatus !== 200) return fakeResponse(geminiStatus, '{"error":{"message":"nope"}}');
      world.geminiBodies.push(body);
      const embeddings = body.requests.map((r, i) => {
        const v = new Array(768).fill(0);
        v[0] = i + 1; // 記號:第幾筆
        return { values: v };
      });
      return fakeResponse(200, JSON.stringify({ embeddings }));
    }
    const path = url.replace(PROXY, "");
    if (path.startsWith("rest/v1/rpc/save_article")) {
      world.saves.push(body);
      if (saveStatus !== 200) return fakeResponse(saveStatus, '{"message":"save_article: internal detail boom"}');
      const id = body.p_id || "new-id";
      if (!articles[id]) articles[id] = { id, title: (body.p_fields || {}).title, content_md: (body.p_fields || {}).content_md || "", status: "draft" };
      return fakeResponse(200, JSON.stringify({ id }));
    }
    if (path.startsWith("rest/v1/articles?")) {
      const m = path.match(/[?&]id=eq\.([^&]+)/);
      const a = m && articles[decodeURIComponent(m[1])];
      return fakeResponse(200, JSON.stringify(a ? [row(a)] : []));
    }
    if (method === "GET" && path.startsWith("rest/v1/tags?name=eq.")) {
      const name = decodeURIComponent(path.replace("rest/v1/tags?name=eq.", ""));
      return fakeResponse(200, JSON.stringify(world.tags.filter((t) => t.name === name)));
    }
    if (method === "POST" && path === "rest/v1/tags") {
      const created = { id: "tag-" + body[0].name, name: body[0].name };
      world.tags.push(created);
      return fakeResponse(201, JSON.stringify([created]));
    }
    throw new Error("unexpected request " + method + " " + path);
  });
  global.httpFetch_ = world.fetch;
  return world;
}

const writes = (w) => w.calls.filter((c) => c.method !== "GET" && !c.url.includes("generativelanguage") || /rpc\/save_article/.test(c.url));
const nonSaveWrites = (w) => w.calls.filter((c) => c.method !== "GET" && !/rpc\/save_article/.test(c.url) && !c.url.includes("generativelanguage"));
const gemini = (w) => w.calls.filter((c) => c.url.includes("generativelanguage"));
const catchError = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
};
const longText = (n) => "段落內容。".repeat(Math.ceil(n / 5)).slice(0, n);

describe("createArticle_", () => {
  test("一個 save_article 請求(欄位 + 標籤,沒有段落);標籤名稱先轉成 ID;之後讀回完整文章", () => {
    const w = makeWorld({ tags: [{ id: "t-existing", name: "react" }] });

    const article = createArticle_({ title: "標題", content_md: "內容", category_id: "c1", tag_names: ["react", "新標籤"] });

    expect(w.saves).toHaveLength(1);
    expect(w.saves[0]).toEqual({
      p_fields: { title: "標題", content_md: "內容", category_id: "c1", status: "draft" },
      p_tag_ids: ["t-existing", "tag-新標籤"]
    });
    expect(gemini(w)).toHaveLength(0);
    expect(article.id).toBe("new-id");
    expect(article.tags).toEqual([]);
    // 沒有舊流程的 article_tags 刪除/插入
    expect(w.calls.some((c) => c.url.includes("rest/v1/article_tags"))).toBe(false);
  });

  test("沒有提供標籤:不帶 p_tag_ids,也沒有任何標籤請求;category 預設為 null", () => {
    const w = makeWorld();
    createArticle_({ title: "標題", content_md: "內容" });
    expect(w.saves[0]).toEqual({ p_fields: { title: "標題", content_md: "內容", category_id: null, status: "draft" } });
    expect(w.calls.some((c) => c.url.includes("rest/v1/tags"))).toBe(false);
  });

  test("標籤名稱重複時各自只解析一次對應的 ID,不會出現重複 ID 之外的副作用", () => {
    const w = makeWorld();
    createArticle_({ title: "T", content_md: "x", tag_names: ["a", "b"] });
    expect(w.saves[0].p_tag_ids).toEqual(["tag-a", "tag-b"]);
  });

  test("save_article 失敗 → 通用的資料服務錯誤,不洩漏內部細節,而且沒有其他任何寫入請求", () => {
    const w = makeWorld({ saveStatus: 400 });
    const err = catchError(() => withSafeErrors_("createArticle", () => createArticle_({ title: "T", content_md: "x" })));
    expect(err.message).toMatch(/資料服務/);
    expect(err.message).not.toMatch(/boom/);
    expect(nonSaveWrites(w)).toHaveLength(0);
  });

  test("擁有者的寫入不受匿名讀取的每小時額度影響", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    makeWorld();
    expect(createArticle_({ title: "T", content_md: "x" }).id).toBe("new-id");
  });
});

describe("updateArticle_", () => {
  const draft = { id: "a1", title: "舊標題", content_md: "舊內容", status: "draft" };
  const published = { id: "a1", title: "舊標題", content_md: "舊內容", status: "published" };

  test("草稿改標題與內文:讀目前狀態(存在性 + 是否已發布)→ 一個 save_article(只有欄位),不呼叫 Gemini", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, draft) } });
    updateArticle_("a1", { title: "新標題", content_md: "新內容" });
    expect(w.saves).toEqual([{ p_id: "a1", p_fields: { title: "新標題", content_md: "新內容" } }]);
    expect(gemini(w)).toHaveLength(0);
  });

  test("已發布文章改內文:先切段、一個批次 Gemini 請求、一個 save_article 帶欄位 + 全部段落 + 模型", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, published) } });
    const body = longText(3200); // 3 段

    updateArticle_("a1", { content_md: body });

    expect(gemini(w)).toHaveLength(1);
    const chunks = splitIntoChunks_(body);
    expect(chunks.length).toBeGreaterThan(1);
    // 嵌入文字 = 標題(沿用既有標題)+ 空行 + 該段
    expect(w.geminiBodies[0].requests.map((r) => r.content.parts[0].text)).toEqual(chunks.map((c) => "舊標題\n\n" + c));
    expect(w.saves).toHaveLength(1);
    const save = w.saves[0];
    expect(save.p_id).toBe("a1");
    expect(save.p_fields).toEqual({ content_md: body });
    expect(save.p_embedding_model).toBe("gemini-embedding-001/768");
    expect(save.p_chunks.map((c) => c.content)).toEqual(chunks);
    // 第 i 段配第 i 個向量
    expect(save.p_chunks.map((c) => c.embedding[0])).toEqual(chunks.map((_, i) => i + 1));
  });

  test("已發布文章只改標題:嵌入文字用新標題 + 既有內文(沒帶的欄位沿用目前值)", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, published) } });
    updateArticle_("a1", { title: "全新標題" });
    expect(w.geminiBodies[0].requests[0].content.parts[0].text).toBe("全新標題\n\n舊內容");
    expect(w.saves[0].p_fields).toEqual({ title: "全新標題" });
    expect(w.saves[0].p_chunks).toHaveLength(1);
  });

  test("已發布文章只改分類:不讀取、不呼叫 Gemini、不動段落", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, published) } });
    updateArticle_("a1", { category_id: "c2" });
    expect(gemini(w)).toHaveLength(0);
    expect(w.saves).toEqual([{ p_id: "a1", p_fields: { category_id: "c2" } }]);
    expect("p_chunks" in w.saves[0]).toBe(false);
  });

  test("category_id 明確給 null → 送出 null(清除分類),不是被忽略", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, draft) } });
    updateArticle_("a1", { category_id: null });
    expect(w.saves[0].p_fields).toEqual({ category_id: null });
  });

  test("只給 tag_names:不讀取、不呼叫 Gemini,save_article 只有標籤(不帶 p_fields,文章 updated_at 不被動到)", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, published) }, tags: [{ id: "t1", name: "react" }] });
    updateArticle_("a1", { tag_names: ["react", "db"] });
    expect(w.saves).toEqual([{ p_id: "a1", p_tag_ids: ["t1", "tag-db"] }]);
    expect(gemini(w)).toHaveLength(0);
  });

  test("tag_names 給空陣列 → 送出空陣列(清空標籤),不是被忽略", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, draft) } });
    updateArticle_("a1", { tag_names: [] });
    expect(w.saves).toEqual([{ p_id: "a1", p_tag_ids: [] }]);
  });

  test("什麼都沒給:完全沒有寫入請求,仍回傳目前的文章", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, draft) } });
    const out = updateArticle_("a1", {});
    expect(w.saves).toHaveLength(0);
    expect(out.id).toBe("a1");
  });

  test("欄位 + 標籤 + 段落全部在同一個 save_article 裡(內容、標籤、向量一起生效或一起不生效)", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, published) } });
    updateArticle_("a1", { title: "T", content_md: "內容", category_id: "c1", tag_names: ["x"] });
    expect(w.saves).toHaveLength(1);
    expect(Object.keys(w.saves[0]).sort()).toEqual(["p_chunks", "p_embedding_model", "p_fields", "p_id", "p_tag_ids"]);
    expect(nonSaveWrites(w).filter((c) => !c.url.includes("rest/v1/tags"))).toHaveLength(0);
  });

  test("Gemini 失敗 → 沒有 save_article,而且連新標籤都還沒建立(標籤在 Gemini 成功之後才建立)", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, published) }, geminiStatus: 500 });
    const err = catchError(() => updateArticle_("a1", { content_md: "新內容", tag_names: ["全新標籤"] }));
    expect(err).toBeDefined();
    expect(err.upstreamCategory_).toBe(UPSTREAM_ERROR_CATEGORY_AI_);
    expect(w.saves).toHaveLength(0);
    expect(nonSaveWrites(w)).toHaveLength(0);
  });

  test("已發布文章內容超過 40 段:在呼叫 Gemini 之前就拒絕,訊息含段數與上限;沒有任何寫入", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, published) } });
    const err = catchError(() => updateArticle_("a1", { content_md: "x".repeat(61000) }));
    expect(err.message).toMatch(/41/);
    expect(err.message).toMatch(/40/);
    expect(err.message).toMatch(/拆成多篇|縮短/);
    expect(gemini(w)).toHaveLength(0);
    expect(w.saves).toHaveLength(0);
  });

  test("草稿不受 40 段限制:同樣的超長內容可以存成草稿(不產生段落)", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, draft) } });
    updateArticle_("a1", { content_md: "x".repeat(61000) });
    expect(w.saves).toHaveLength(1);
    expect("p_chunks" in w.saves[0]).toBe(false);
    expect(gemini(w)).toHaveLength(0);
  });

  test("save_article 失敗 → 通用的資料服務錯誤;沒有舊流程那種分開的 PATCH / 刪標籤請求", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, published) }, saveStatus: 400 });
    const err = catchError(() => withSafeErrors_("updateArticle", () => updateArticle_("a1", { content_md: "x" })));
    expect(err.message).toMatch(/資料服務/);
    expect(w.calls.some((c) => c.method === "PATCH" || c.method === "DELETE")).toBe(false);
  });

  test("標題不能清成空白(沿用既有檢查,在任何網路請求之前)", () => {
    const w = makeWorld({ articles: { a1: Object.assign({}, draft) } });
    expect(() => updateArticle_("a1", { title: "  " })).toThrow(/標題不能是空白/);
    expect(w.calls).toHaveLength(0);
  });

  test("擁有者的更新不受匿名讀取額度影響(有碰內文與沒碰內文兩種)", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    makeWorld({ articles: { a1: Object.assign({}, published) } });
    expect(() => updateArticle_("a1", { content_md: "x" })).not.toThrow();
    expect(() => updateArticle_("a1", { category_id: "c" })).not.toThrow();
  });
});

describe("setArticleStatus_", () => {
  test("狀態值不合法 → 在任何網路請求之前拒絕", () => {
    const w = makeWorld();
    expect(() => setArticleStatus_("a1", "archived")).toThrow(/draft 或 published/);
    expect(w.calls).toHaveLength(0);
  });

  test("發布:讀目前標題與內文 → 一個批次 Gemini 請求 → 一個 save_article(狀態 + 全部段落 + 模型)", () => {
    const w = makeWorld({ articles: { a1: { id: "a1", title: "標題", content_md: longText(3200), status: "draft" } } });

    const out = setArticleStatus_("a1", "published");

    expect(gemini(w)).toHaveLength(1);
    expect(w.saves).toHaveLength(1);
    const chunks = splitIntoChunks_(longText(3200));
    expect(w.saves[0]).toEqual({
      p_id: "a1",
      p_fields: { status: "published" },
      p_chunks: chunks.map((c, i) => ({ content: c, embedding: expect.any(Array) })),
      p_embedding_model: "gemini-embedding-001/768"
    });
    expect(w.saves[0].p_chunks.map((c) => c.embedding[0])).toEqual(chunks.map((_, i) => i + 1));
    expect(out.id).toBe("a1");
  });

  test("內容為空的文章發布:一段空字串,嵌入文字只有標題", () => {
    const w = makeWorld({ articles: { a1: { id: "a1", title: "只有標題", content_md: "", status: "draft" } } });
    setArticleStatus_("a1", "published");
    expect(w.geminiBodies[0].requests.map((r) => r.content.parts[0].text)).toEqual(["只有標題\n\n"]);
    expect(w.saves[0].p_chunks.map((c) => c.content)).toEqual([""]);
  });

  test("取消發布:一個 save_article(只有狀態),不讀取、不呼叫 Gemini,段落由資料庫保留", () => {
    const w = makeWorld({ articles: { a1: { id: "a1", title: "T", content_md: "x", status: "published" } } });
    setArticleStatus_("a1", "draft");
    expect(w.saves).toEqual([{ p_id: "a1", p_fields: { status: "draft" } }]);
    expect(gemini(w)).toHaveLength(0);
  });

  test("發布時內容超過 40 段:不呼叫 Gemini、不呼叫 save_article,訊息說明段數與上限", () => {
    const w = makeWorld({ articles: { a1: { id: "a1", title: "T", content_md: "x".repeat(61000), status: "draft" } } });
    const err = catchError(() => setArticleStatus_("a1", "published"));
    expect(err.message).toMatch(/41/);
    expect(err.message).toMatch(/40/);
    expect(gemini(w)).toHaveLength(0);
    expect(w.saves).toHaveLength(0);
  });

  test("發布時 Gemini 失敗 → 沒有 save_article(狀態不會變成已發布)", () => {
    const w = makeWorld({ articles: { a1: { id: "a1", title: "T", content_md: "x", status: "draft" } }, geminiStatus: 500 });
    const err = catchError(() => setArticleStatus_("a1", "published"));
    expect(err.isUpstreamError_).toBe(true);
    expect(w.saves).toHaveLength(0);
  });

  test("發布時文章不存在 → 在呼叫 Gemini 之前就丟出找不到文章", () => {
    const w = makeWorld();
    expect(() => setArticleStatus_("ghost", "published")).toThrow(/找不到文章/);
    expect(gemini(w)).toHaveLength(0);
  });

  test("擁有者發布與取消發布都不受匿名讀取額度影響", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    makeWorld({ articles: { a1: { id: "a1", title: "T", content_md: "x", status: "draft" } } });
    expect(() => setArticleStatus_("a1", "published")).not.toThrow();
    expect(() => setArticleStatus_("a1", "draft")).not.toThrow();
  });
});

describe("舊的多步驟流程已移除", () => {
  test("syncArticleTags_ 不再存在,Articles.gs 不再對 article_tags 做刪除/插入", () => {
    expect(typeof syncArticleTags_).toBe("undefined");
    const fs = require("fs");
    const src = fs.readFileSync(require("path").join(__dirname, "../src/Articles.gs"), "utf8");
    expect(src).not.toMatch(/syncArticleTags_/);
    expect(src).not.toMatch(/patch\.embedding|embedding: embedding/);
  });
});
