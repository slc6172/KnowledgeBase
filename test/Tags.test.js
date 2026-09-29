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
      "https://x.supabase.co/rest/v1/tags?select=*&order=name.asc",
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
      "https://x.supabase.co/rest/v1/tags?id=eq.t1",
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
      "https://x.supabase.co/rest/v1/tags?id=eq.a%26b",
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
      "https://x.supabase.co/rest/v1/tags?id=eq.t1",
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
      "https://x.supabase.co/rest/v1/article_tags?tag_id=eq.t1&select=article_id",
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

  test("article only has the source tag: UPDATEs its article_tags row to the target, then deletes the source tag and returns the target's latest data", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-source","name":"JS"}]')) // findTagOrThrow_(sourceTagId)
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-target","name":"JavaScript"}]')) // findTagOrThrow_(targetTagId)
      .mockReturnValueOnce(fakeResponse(200, '[{"article_id":"a1","tag_id":"t-source"}]')) // source rows
      .mockReturnValueOnce(fakeResponse(200, "[]")) // target rows (a1 not in target)
      .mockReturnValueOnce(fakeResponse(200, '[{"article_id":"a1","tag_id":"t-target"}]')) // UPDATE result
      .mockReturnValueOnce(fakeResponse(200, "[]")) // DELETE tags result
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-target","name":"JavaScript"}]')); // refetch target
    global.httpFetch_ = fetchSpy;

    const result = mergeTags_("t-source", "t-target");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/rest/v1/article_tags?tag_id=eq.t-source",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "https://x.supabase.co/rest/v1/article_tags?tag_id=eq.t-target",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      5,
      "https://x.supabase.co/rest/v1/article_tags?article_id=eq.a1&tag_id=eq.t-source",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ tag_id: "t-target" })
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      6,
      "https://x.supabase.co/rest/v1/tags?id=eq.t-source",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      7,
      "https://x.supabase.co/rest/v1/tags?id=eq.t-target",
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual({ id: "t-target", name: "JavaScript" });
  });

  test("article has both source and target tags: DELETEs its source article_tags row instead of UPDATEing", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-source","name":"JS"}]')) // findTagOrThrow_(sourceTagId)
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-target","name":"JavaScript"}]')) // findTagOrThrow_(targetTagId)
      .mockReturnValueOnce(fakeResponse(200, '[{"article_id":"a2","tag_id":"t-source"}]')) // source rows
      .mockReturnValueOnce(fakeResponse(200, '[{"article_id":"a2","tag_id":"t-target"}]')) // target rows: a2 already has target too
      .mockReturnValueOnce(fakeResponse(200, "[]")) // DELETE the source row
      .mockReturnValueOnce(fakeResponse(200, "[]")) // DELETE tags result
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-target","name":"JavaScript"}]')); // refetch target
    global.httpFetch_ = fetchSpy;

    mergeTags_("t-source", "t-target");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      5,
      "https://x.supabase.co/rest/v1/article_tags?article_id=eq.a2&tag_id=eq.t-source",
      expect.objectContaining({ method: "DELETE" })
    );
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

  test("mycr finding: throws before any article_tags/network call when the source tag is used by more than TAG_MERGE_MAX_ARTICLES_ articles", () => {
    const sourceRows = new Array(TAG_MERGE_MAX_ARTICLES_ + 1).fill(null).map((_, i) => ({
      article_id: "a" + i,
      tag_id: "t-source"
    }));
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-source","name":"JS"}]')) // findTagOrThrow_(sourceTagId)
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-target","name":"JavaScript"}]')) // findTagOrThrow_(targetTagId)
      .mockReturnValueOnce(fakeResponse(200, JSON.stringify(sourceRows))); // source rows: over the limit
    global.httpFetch_ = fetchSpy;

    expect(() => mergeTags_("t-source", "t-target")).toThrow(/無法一次合併/);
    // 超過上限就直接拒絕,不會再多打一次「target rows」的請求。
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
