const { loadCoreGas, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  loadGas("../../src/Tags.gs");
});

describe("listTags", () => {
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
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    renameTag_("a&b", "名稱");

    expect(fetchSpy).toHaveBeenCalledWith(
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
      .mockReturnValueOnce(fakeResponse(200, '[{"article_id":"a1","tag_id":"t-source"}]')) // source rows
      .mockReturnValueOnce(fakeResponse(200, "[]")) // target rows (a1 not in target)
      .mockReturnValueOnce(fakeResponse(200, '[{"article_id":"a1","tag_id":"t-target"}]')) // UPDATE result
      .mockReturnValueOnce(fakeResponse(200, "[]")) // DELETE tags result
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-target","name":"JavaScript"}]')); // refetch target
    global.httpFetch_ = fetchSpy;

    const result = mergeTags_("t-source", "t-target");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/rest/v1/article_tags?tag_id=eq.t-source",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/article_tags?tag_id=eq.t-target",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/rest/v1/article_tags?article_id=eq.a1&tag_id=eq.t-source",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ tag_id: "t-target" })
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "https://x.supabase.co/rest/v1/tags?id=eq.t-source",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      5,
      "https://x.supabase.co/rest/v1/tags?id=eq.t-target",
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual({ id: "t-target", name: "JavaScript" });
  });

  test("article has both source and target tags: DELETEs its source article_tags row instead of UPDATEing", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"article_id":"a2","tag_id":"t-source"}]')) // source rows
      .mockReturnValueOnce(fakeResponse(200, '[{"article_id":"a2","tag_id":"t-target"}]')) // target rows: a2 already has target too
      .mockReturnValueOnce(fakeResponse(200, "[]")) // DELETE the source row
      .mockReturnValueOnce(fakeResponse(200, "[]")) // DELETE tags result
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-target","name":"JavaScript"}]')); // refetch target
    global.httpFetch_ = fetchSpy;

    mergeTags_("t-source", "t-target");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/rest/v1/article_tags?article_id=eq.a2&tag_id=eq.t-source",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
