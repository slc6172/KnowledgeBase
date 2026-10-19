const { loadGas } = require("./helpers/loadGas");

function fakeConfig() {
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => {
        if (key === "SUPABASE_URL") return "https://x.supabase.co";
        if (key === "EDGE_PROXY_SECRET") return "proxy-secret";
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
  loadGas("../../src/ErrorHandling.gs");
  loadGas("../../src/SupabaseClient.gs");
});

describe("supabaseRequest", () => {
  test("GET goes through the proxy with only the shared-secret and Content-Type headers, and returns parsed JSON", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, '[{"id":1}]'));
    global.httpFetch_ = fetchSpy;

    const result = supabaseRequest_("GET", "articles?select=*");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?select=*",
      expect.objectContaining({
        method: "GET",
        headers: {
          "X-KB-Proxy-Secret": "proxy-secret",
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles",
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

describe("postgrestQuoteValue_", () => {
  // 只用在 inFilter_,不用在 eqFilter_——這裡測的是這個函式本身的行為,
  // 不是它在哪裡被呼叫。詳細的來回過程見 SupabaseClient.gs 的 inFilter_
  // 上方註解。
  test("wraps any value in double quotes", () => {
    expect(postgrestQuoteValue_("123")).toBe('"123"');
    expect(postgrestQuoteValue_("hello")).toBe('"hello"');
  });

  test("escapes an internal backslash before escaping an internal double quote (order matters, otherwise the escaping backslash added for the quote would itself get escaped)", () => {
    expect(postgrestQuoteValue_('a\\b')).toBe('"a\\\\b"');
    expect(postgrestQuoteValue_('a"b')).toBe('"a\\"b"');
    expect(postgrestQuoteValue_('a\\"b')).toBe('"a\\\\\\"b"');
  });

  test("leaves a comma or parenthesis inside the value untouched (they only need the surrounding quotes, not their own escaping)", () => {
    expect(postgrestQuoteValue_("a,b")).toBe('"a,b"');
    expect(postgrestQuoteValue_("a(b)")).toBe('"a(b)"');
  });
});

describe("eqFilter_ / inFilter_", () => {
  test("eqFilter_ builds a plain column=eq.value clause — deliberately NOT PostgREST-quoted", () => {
    // 2026-09 這裡曾經一度改成也包 PostgREST 雙引號,部署後發現 PostgREST
    // 的 eq. 語法根本不會把外層引號剝掉,UUID 欄位直接 400——已經復原,
    // 細節見 SupabaseClient.gs 的 inFilter_ 上方註解、README 已知問題
    // 修復紀錄第 65 條。這個測試名稱特別強調「deliberately NOT」,是為了
    // 避免以後有人看到 inFilter_ 有包雙引號,誤以為 eqFilter_ 這裡也應該
    // 要有、把這行「修好」。
    expect(eqFilter_("id", "123")).toBe("id=eq.123");
  });

  test("eqFilter_ URL-encodes values containing special characters, without any extra PostgREST quoting", () => {
    expect(eqFilter_("name", "a&b,c")).toBe("name=eq." + encodeURIComponent("a&b,c"));
  });

  test("inFilter_ builds a column=in.(\"v1\",\"v2\") clause, each value PostgREST-quoted then URL-encoded", () => {
    // 跟 eqFilter_ 不同,in.() 的清單語法會把值兩側的雙引號正確剝掉才轉型
    // ——這點已經在真實的 Supabase 專案上,對一個真正的 UUID 主鍵實測
    // 驗證過(唯讀查詢,查得到資料),不是只憑文件推測。
    expect(inFilter_("id", ["a", "b"])).toBe(
      "id=in.(" + encodeURIComponent('"a"') + "," + encodeURIComponent('"b"') + ")"
    );
  });

  test("inFilter_ correctly round-trips a value containing a comma instead of it being mistaken for the list separator", () => {
    expect(inFilter_("name", ["a,b", "c"])).toBe(
      "name=in.(" + encodeURIComponent('"a,b"') + "," + encodeURIComponent('"c"') + ")"
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?select=*&status=eq.draft",
      expect.objectContaining({ method: "GET" })
    );
  });

  test("supabaseInsert issues a POST with return=representation", () => {
    supabaseInsert_("articles", [{ title: "hi" }]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles",
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?id=eq.1",
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
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/articles?id=eq.1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("supabaseRpc issues a POST to rpc/{fnName} with the args as payload", () => {
    supabaseRpc_("hybrid_search_articles", { query_text: "react" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/functions/v1/kb-proxy/rest/v1/rpc/hybrid_search_articles",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify({ query_text: "react" })
      })
    );
  });
});
