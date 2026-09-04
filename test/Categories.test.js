const { loadCoreGas, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  loadGas("../../src/Categories.gs");
});

describe("listCategories", () => {
  test("selects all categories ordered by name", () => {
    const rows = [
      { id: "c1", name: "前端", parent_id: null },
      { id: "c2", name: "後端", parent_id: null }
    ];
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, JSON.stringify(rows)));
    global.httpFetch_ = fetchSpy;

    const result = listCategories();

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/categories?select=*&order=name.asc",
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual(rows);
  });
});

describe("createCategory", () => {
  test("inserts a top-level category when parentId is not given", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(201, '[{"id":"c1","name":"前端","parent_id":null}]'));
    global.httpFetch_ = fetchSpy;

    const category = createCategory_("前端");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/categories",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([{ name: "前端", parent_id: null }])
      })
    );
    expect(category.id).toBe("c1");
  });

  test("throws when parentId points to a category that already has a parent, without inserting", () => {
    const fetchSpy = jest.fn().mockReturnValue(
      fakeResponse(
        200,
        JSON.stringify([{ id: "c2", name: "子分類A", parent_id: "c1" }])
      )
    ); // lookup of the given parentId returns a category that itself has a parent
    global.httpFetch_ = fetchSpy;

    expect(() => createCategory_("孫分類", "c2")).toThrow(/最多只能有 2 層/);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the lookup, no insert
  });

  test("succeeds when parentId points to a top-level category", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify([{ id: "c1", name: "前端", parent_id: null }]))
      ) // lookup: c1 is top-level
      .mockReturnValueOnce(
        fakeResponse(201, '[{"id":"c2","name":"React","parent_id":"c1"}]')
      ); // insert
    global.httpFetch_ = fetchSpy;

    const category = createCategory_("React", "c1");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/categories",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([{ name: "React", parent_id: "c1" }])
      })
    );
    expect(category.id).toBe("c2");
  });
});

describe("updateCategory", () => {
  test("PATCHes only the name", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, '[{"id":"c1","name":"新名稱"}]'));
    global.httpFetch_ = fetchSpy;

    const category = updateCategory_("c1", "新名稱");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/categories?id=eq.c1",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ name: "新名稱" })
      })
    );
    expect(category.name).toBe("新名稱");
  });

  test("URL-encodes a categoryId containing PostgREST-reserved characters", () => {
    // categoryId 目前的呼叫端都只會傳資料庫產生的 UUID,但 eqFilter_ 對任何
    // 欄位一律編碼,不假設呼叫端只會傳「看起來安全」的值(縱深防禦,細節見
    // README 已知問題修復紀錄)。
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    updateCategory_("a&b", "名稱");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/categories?id=eq.a%26b",
      expect.objectContaining({ method: "PATCH" })
    );
  });
});

describe("deleteCategory", () => {
  test("DELETEs the category by id", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, ""));
    global.httpFetch_ = fetchSpy;

    const result = deleteCategory_("c1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/categories?id=eq.c1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(result).toEqual({ deleted: true, id: "c1" });
  });
});

describe("moveCategory", () => {
  test("moving to top level (newParentId=null) PATCHes only parent_id, with no lookups first", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, '[{"id":"c2","name":"React","parent_id":null}]'));
    global.httpFetch_ = fetchSpy;

    const category = moveCategory_("c2", null);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/categories?id=eq.c2",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ parent_id: null })
      })
    );
    expect(category.parent_id).toBe(null);
  });

  test("throws when categoryId equals newParentId, before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => moveCategory_("c1", "c1")).toThrow(/不能把分類移動到自己底下/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("throws '找不到分類' when categoryId doesn't exist", () => {
    const fetchSpy = jest.fn().mockReturnValueOnce(fakeResponse(200, "[]")); // lookup of categoryId
    global.httpFetch_ = fetchSpy;

    expect(() => moveCategory_("c-missing", "c-target")).toThrow(/找不到分類: c-missing/);
  });

  test("throws '找不到分類' when newParentId doesn't exist", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"c1","name":"前端","parent_id":null}]')) // lookup categoryId
      .mockReturnValueOnce(fakeResponse(200, "[]")); // lookup newParentId
    global.httpFetch_ = fetchSpy;

    expect(() => moveCategory_("c1", "c-missing-parent")).toThrow(/找不到分類: c-missing-parent/);
  });

  test("throws '分類最多只能有 2 層' when newParentId is itself a child, without checking children or updating", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"c1","name":"前端","parent_id":null}]')) // lookup categoryId
      .mockReturnValueOnce(
        fakeResponse(200, '[{"id":"c2","name":"子分類A","parent_id":"c0"}]')
      ); // lookup newParentId: itself has a parent
    global.httpFetch_ = fetchSpy;

    expect(() => moveCategory_("c1", "c2")).toThrow(/最多只能有 2 層/);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // only the two lookups, no children check or update
  });

  test("throws when categoryId itself has children, without updating", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"c1","name":"前端","parent_id":null}]')) // lookup categoryId
      .mockReturnValueOnce(
        fakeResponse(200, '[{"id":"c-target","name":"後端","parent_id":null}]')
      ) // lookup newParentId: top-level, passes 2-level check
      .mockReturnValueOnce(
        fakeResponse(200, '[{"id":"c1a","name":"React","parent_id":"c1"}]')
      ); // children-of-categoryId query: c1 has a child
    global.httpFetch_ = fetchSpy;

    expect(() => moveCategory_("c1", "c-target")).toThrow(/還有子分類/);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/rest/v1/categories?parent_id=eq.c1",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3); // two lookups + children check, no update
  });

  test("succeeds when categoryId has no children and newParentId is top-level", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"c1","name":"前端","parent_id":null}]')) // lookup categoryId
      .mockReturnValueOnce(
        fakeResponse(200, '[{"id":"c-target","name":"後端","parent_id":null}]')
      ) // lookup newParentId: top-level
      .mockReturnValueOnce(fakeResponse(200, "[]")) // children-of-categoryId query: none
      .mockReturnValueOnce(
        fakeResponse(200, '[{"id":"c1","name":"前端","parent_id":"c-target"}]')
      ); // the actual move
    global.httpFetch_ = fetchSpy;

    const category = moveCategory_("c1", "c-target");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "https://x.supabase.co/rest/v1/categories?id=eq.c1",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ parent_id: "c-target" })
      })
    );
    expect(category.parent_id).toBe("c-target");
  });
});
