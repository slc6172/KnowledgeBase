const { loadGas } = require("./helpers/loadGas");

describe("httpFetch_", () => {
  test("delegates to UrlFetchApp.fetch with the same url and params, returning its result", () => {
    const fakeResponse = { fake: "response" };
    const fetch = jest.fn().mockReturnValue(fakeResponse);
    global.UrlFetchApp = { fetch };
    loadGas("../../src/HttpTransport.gs");

    const result = httpFetch_("https://example.com", { method: "get" });

    expect(fetch).toHaveBeenCalledWith("https://example.com", { method: "get" });
    expect(result).toBe(fakeResponse);
  });
});
