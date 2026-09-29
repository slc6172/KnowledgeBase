const { loadGas } = require("./helpers/loadGas");
const { fakeLogger } = require("./helpers/testSetup");

beforeEach(() => {
  loadGas("../../src/ErrorHandling.gs");
});

describe("markUpstreamError_ + withSafeErrors_", () => {
  test("上游服務錯誤(資料類)被轉換成對外安全的通用訊息", () => {
    const logger = fakeLogger();
    const raw = markUpstreamError_("Supabase error 400: bad filter", UPSTREAM_ERROR_CATEGORY_DATA_);

    expect(() => {
      withSafeErrors_("searchArticles", () => {
        throw raw;
      });
    }).toThrow(/資料服務暫時發生問題/);
  });

  test("上游服務錯誤(AI 類)被轉換成對外安全的通用訊息", () => {
    fakeLogger();
    const raw = markUpstreamError_("Gemini embedding error 429: rate limited", UPSTREAM_ERROR_CATEGORY_AI_);

    expect(() => {
      withSafeErrors_("searchArticles", () => {
        throw raw;
      });
    }).toThrow(/AI 服務暫時發生問題/);
  });

  test("轉換後的對外訊息不包含原始上游內容", () => {
    fakeLogger();
    const raw = markUpstreamError_("Supabase error 500: column \"secret_internal_field\" does not exist", UPSTREAM_ERROR_CATEGORY_DATA_);

    try {
      withSafeErrors_("getArticle", () => {
        throw raw;
      });
    } catch (err) {
      expect(err.message).not.toMatch(/secret_internal_field/);
      return;
    }
    throw new Error("預期應該要拋出例外");
  });

  test("原始內容(含操作標籤)會被寫進執行紀錄", () => {
    const logger = fakeLogger();
    const raw = markUpstreamError_("Supabase Storage upload error 413: payload too large", UPSTREAM_ERROR_CATEGORY_DATA_);

    expect(() => {
      withSafeErrors_("uploadAttachment", () => {
        throw raw;
      });
    }).toThrow();

    expect(logger.logs.length).toBe(1);
    expect(logger.logs[0]).toContain("uploadAttachment");
    expect(logger.logs[0]).toContain("Supabase Storage upload error 413: payload too large");
  });

  test("沒有標記的例外原封不動往外拋，不寫進執行紀錄", () => {
    const logger = fakeLogger();

    expect(() => {
      withSafeErrors_("callProtected", () => {
        throw new Error("密碼錯誤");
      });
    }).toThrow("密碼錯誤");

    expect(logger.logs.length).toBe(0);
  });

  test("沒有丟出例外時，正常回傳 fn 的結果", () => {
    fakeLogger();
    const result = withSafeErrors_("listArticles", () => 42);
    expect(result).toBe(42);
  });

  test("falls back to the data-service message when a marked error has an unrecognized category", () => {
    fakeLogger();
    const raw = markUpstreamError_("Something unexpected", "some-future-category-nobody-added-yet");

    expect(() => {
      withSafeErrors_("someFunction", () => {
        throw raw;
      });
    }).toThrow(/資料服務暫時發生問題/);
  });
});
