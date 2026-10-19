const { loadCoreGas, fakeCacheService, fakeLogger, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  fakeCacheService();
  loadGas("../../src/Auth.gs");
  loadGas("../../src/Tags.gs");
});

describe("listTags", () => {
  test("mycr finding: converts an upstream Supabase failure into the generic data-service message", () => {
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(500, 'column "secret_internal_field" does not exist'));

    let caught;
    try {
      listTags();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/資料服務暫時發生問題/);
    expect(caught.message).not.toMatch(/secret_internal_field/);
  });

  test("mycr finding: listTags/countTagUsage are subject to the shared public-read rate limit (ANYONE_ANONYMOUS deployment)", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => listTags()).toThrow(/使用量過大/);
    expect(() => countTagUsage("t1")).toThrow(/使用量過大/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("selects all tags ordered by name", () => {
    const rows = [
      { id: "t1", name: "react" },
      { id: "t2", name: "vue" }
    ];
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, JSON.stringify(rows)));
    global.httpFetch_ = fetchSpy;

    const result = listTags();

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/tags?select=*&order=name.asc",
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual(rows);
  });
});

describe("renameTag", () => {
  test("rejects a missing/whitespace-only name before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => renameTag_("t1", "   ")).toThrow(/名稱/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("mycr finding: throws a clear error (not silently returning undefined) when tagId doesn't exist", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    expect(() => renameTag_("no-such-id", "JavaScript")).toThrow(/找不到標籤/);
  });

  test("PATCHes the tag's name and returns the updated row", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, '[{"id":"t1","name":"JavaScript"}]'));
    global.httpFetch_ = fetchSpy;

    const tag = renameTag_("t1", "JavaScript");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/tags?id=eq.t1",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ name: "JavaScript" })
      })
    );
    expect(tag).toEqual({ id: "t1", name: "JavaScript" });
  });

  test("URL-encodes a tagId containing PostgREST-reserved characters", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"a&b","name":"舊名稱"}]')) // findTagOrThrow_
      .mockReturnValueOnce(fakeResponse(200, "[]")); // PATCH
    global.httpFetch_ = fetchSpy;

    renameTag_("a&b", "名稱");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/tags?id=eq.a%26b",
      expect.objectContaining({ method: "PATCH" })
    );
  });
});

describe("deleteTag", () => {
  test("DELETEs the tag by id and returns { deleted: true, id }", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    const result = deleteTag_("t1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/tags?id=eq.t1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(result).toEqual({ deleted: true, id: "t1" });
  });
});

describe("countTagUsage", () => {
  test("mycr finding: converts an upstream Supabase failure into the generic data-service message", () => {
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(500, 'column "secret_internal_field" does not exist'));

    let caught;
    try {
      countTagUsage("t1");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/資料服務暫時發生問題/);
    expect(caught.message).not.toMatch(/secret_internal_field/);
  });

  test("counts how many article_tags rows reference the tag", () => {
    const rows = [{ article_id: "a1" }, { article_id: "a2" }, { article_id: "a3" }];
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, JSON.stringify(rows)));
    global.httpFetch_ = fetchSpy;

    const result = countTagUsage("t1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/article_tags?tag_id=eq.t1&select=article_id",
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual({ count: 3 });
  });
});

describe("mergeTags", () => {
  test("throws when sourceTagId equals targetTagId, before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => mergeTags_("t1", "t1")).toThrow(/來源與目標標籤不能相同/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("mycr finding: throws a clear error (not silently returning undefined) when sourceTagId or targetTagId doesn't exist", () => {
    const fetchSpyMissingSource = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, "[]")); // findTagOrThrow_(sourceTagId) finds nothing
    global.httpFetch_ = fetchSpyMissingSource;
    expect(() => mergeTags_("missing-source", "t-target")).toThrow(/找不到標籤/);
    expect(fetchSpyMissingSource).toHaveBeenCalledTimes(1);

    const fetchSpyMissingTarget = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-source","name":"JS"}]')) // findTagOrThrow_(sourceTagId) ok
      .mockReturnValueOnce(fakeResponse(200, "[]")); // findTagOrThrow_(targetTagId) finds nothing
    global.httpFetch_ = fetchSpyMissingTarget;
    expect(() => mergeTags_("t-source", "missing-target")).toThrow(/找不到標籤/);
    // 目標標籤不存在,在還沒開始搬動任何 article_tags 資料之前就要擋下來——
    // 不會像修法之前那樣跑完整個迴圈之後才發現、回傳 undefined。
    expect(fetchSpyMissingTarget).toHaveBeenCalledTimes(2);
  });

  test("票 02:兩個標籤都存在時,只送出一個 merge_tags RPC 請求(搬移全部在資料庫的單一交易內),回傳目標標籤", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-source","name":"JS"}]')) // findTagOrThrow_(source)
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-target","name":"JavaScript"}]')) // findTagOrThrow_(target)
      .mockReturnValueOnce(fakeResponse(200, '{"id":"t-target","name":"JavaScript"}')); // merge_tags
    global.httpFetch_ = fetchSpy;

    const result = mergeTags_("t-source", "t-target");

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/rpc/merge_tags",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify({ source_tag_id: "t-source", target_tag_id: "t-target" })
      })
    );
    expect(result).toEqual({ id: "t-target", name: "JavaScript" });
  });

  test("票 02:RPC 回傳單元素陣列時也能正確取出目標標籤", () => {
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"s","name":"JS"}]'))
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t","name":"JavaScript"}]'))
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t","name":"JavaScript"}]'));

    expect(mergeTags_("s", "t")).toEqual({ id: "t", name: "JavaScript" });
  });

  test("票 02:不再有『來源標籤最多掛在幾篇文章』的上限——來源有幾百篇文章也只是同一個請求", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"s","name":"JS"}]'))
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t","name":"JavaScript"}]'))
      .mockReturnValueOnce(fakeResponse(200, '{"id":"t","name":"JavaScript"}'));
    global.httpFetch_ = fetchSpy;

    expect(() => mergeTags_("s", "t")).not.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(typeof TAG_MERGE_MAX_ARTICLES_).toBe("undefined");
  });

  test("票 02:merge_tags 失敗時轉成通用的資料服務錯誤,不洩漏內部細節,而且之後沒有任何其他請求", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"s","name":"JS"}]'))
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t","name":"JavaScript"}]'))
      .mockReturnValueOnce(fakeResponse(400, '{"message":"merge_tags: boom internal detail"}'));
    global.httpFetch_ = fetchSpy;

    let caught;
    try {
      withSafeErrors_("mergeTags", () => mergeTags_("s", "t"));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/資料服務/);
    expect(caught.message).not.toMatch(/boom internal detail/);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
