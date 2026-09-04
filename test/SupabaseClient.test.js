const { loadGas } = require("./helpers/loadGas");

function fakeConfig() {
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => {
        if (key === "SUPABASE_URL") return "https://x.supabase.co";
        if (key === "SUPABASE_SERVICE_ROLE_KEY") return "srv-key";
        return null;
      }
    })
  };
}

function fakeResponse(code, bodyText) {
  return {
    getResponseCode: () => code,
    getContentText: () => bodyText
  };
}

beforeEach(() => {
  fakeConfig();
  loadGas("../../src/Config.gs");
  loadGas("../../src/HttpTransport.gs");
  loadGas("../../src/SupabaseClient.gs");
});

describe("supabaseRequest", () => {
  test("GET sends apikey/Authorization/Content-Type headers and returns parsed JSON", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, '[{"id":1}]'));
    global.httpFetch_ = fetchSpy;

    const result = supabaseRequest_("GET", "articles?select=*");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/articles?select=*",
      expect.objectContaining({
        method: "GET",
        headers: {
          apikey: "srv-key",
          Authorization: "Bearer srv-key",
          "Content-Type": "application/json"
        }
      })
    );
    expect(result).toEqual([{ id: 1 }]);
  });

  test("POST with a payload option sends JSON body and Prefer header", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(201, '[{"id":2}]'));
    global.httpFetch_ = fetchSpy;

    supabaseRequest_("POST", "articles", {
      payload: [{ title: "hi" }],
      prefer: "return=representation"
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/articles",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([{ title: "hi" }]),
        headers: expect.objectContaining({ Prefer: "return=representation" })
      })
    );
  });

  test("throws with status code and response body when the response is >= 400", () => {
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(400, '{"message":"bad filter"}'));

    expect(() => supabaseRequest_("GET", "articles?bad=x")).toThrow(
      /400.*bad filter/s
    );
  });

  test("returns null when the response body is empty (e.g. a 204)", () => {
    global.httpFetch_ = jest.fn().mockReturnValue(fakeResponse(204, ""));

    expect(supabaseRequest_("DELETE", "articles?id=eq.1")).toBeNull();
  });
});

describe("eqFilter_ / inFilter_", () => {
  test("eqFilter_ builds a plain column=eq.value clause", () => {
    expect(eqFilter_("id", "123")).toBe("id=eq.123");
  });

  test("eqFilter_ URL-encodes values containing PostgREST-reserved characters", () => {
    // & 會被誤判成下一個 query 參數的開始,, 在 in.() 語境下是清單分隔符——
    // 這裡確認就算是單一 eq 過濾條件,一樣統一做編碼,不區分欄位是不是自由
    // 文字輸入。
    expect(eqFilter_("name", "a&b,c")).toBe("name=eq." + encodeURIComponent("a&b,c"));
  });

  test("inFilter_ builds a column=in.(v1,v2) clause", () => {
    expect(inFilter_("id", ["a", "b"])).toBe("id=in.(a,b)");
  });

  test("inFilter_ URL-encodes each value so a comma inside a value can't be mistaken for the list separator", () => {
    expect(inFilter_("name", ["a,b", "c"])).toBe(
      "name=in.(" + encodeURIComponent("a,b") + ",c)"
    );
  });
});

describe("wrapper functions", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;
  });

  test("supabaseSelect issues a GET to table?queryString", () => {
    supabaseSelect_("articles", "select=*&status=eq.draft");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/articles?select=*&status=eq.draft",
      expect.objectContaining({ method: "GET" })
    );
  });

  test("supabaseInsert issues a POST with return=representation", () => {
    supabaseInsert_("articles", [{ title: "hi" }]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/articles",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([{ title: "hi" }]),
        headers: expect.objectContaining({ Prefer: "return=representation" })
      })
    );
  });

  test("supabaseUpdate issues a PATCH to table?filterQuery with return=representation", () => {
    supabaseUpdate_("articles", "id=eq.1", { title: "new" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/articles?id=eq.1",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ title: "new" }),
        headers: expect.objectContaining({ Prefer: "return=representation" })
      })
    );
  });

  test("supabaseDelete issues a DELETE to table?filterQuery", () => {
    supabaseDelete_("articles", "id=eq.1");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/articles?id=eq.1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("supabaseRpc issues a POST to rpc/{fnName} with the args as payload", () => {
    supabaseRpc_("hybrid_search_articles", { query_text: "react" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/rpc/hybrid_search_articles",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify({ query_text: "react" })
      })
    );
  });
});
