const { loadCoreGas, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  loadGas("../../src/StorageClient.gs");
});

describe("storageUpload_", () => {
  test("POSTs bytes to the object endpoint with the shared-secret and Content-Type headers", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, '{"Id":"x","Key":"attachments/a1/f.png"}'));
    global.httpFetch_ = fetchSpy;
    const bytes = [1, 2, 3];

    const result = storageUpload_("attachments", "a1/f.png", bytes, "image/png");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/functions/v1/kb-proxy/storage/v1/object/attachments/a1/f.png",
      expect.objectContaining({
        method: "post",
        headers: {
          "X-KB-Proxy-Secret": "proxy-secret",
          "Content-Type": "image/png"
        },
        payload: bytes
      })
    );
    expect(result).toEqual({ Id: "x", Key: "attachments/a1/f.png" });
  });

  test("throws with status code and response body on a non-2xx response", () => {
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(413, '{"error":"payload too large"}'));

    expect(() => storageUpload_("attachments", "a1/f.png", [1], "image/png")).toThrow(
      /413.*payload too large/s
    );
  });
});

describe("storageDelete_", () => {
  test("DELETEs the object endpoint with the shared-secret header", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, '{"message":"Successfully deleted"}'));
    global.httpFetch_ = fetchSpy;

    const result = storageDelete_("attachments", "a1/f.png");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/functions/v1/kb-proxy/storage/v1/object/attachments/a1/f.png",
      expect.objectContaining({
        method: "delete",
        headers: {
          "X-KB-Proxy-Secret": "proxy-secret"
        }
      })
    );
    expect(result).toEqual({ message: "Successfully deleted" });
  });

  test("throws with status code and response body on a non-2xx response", () => {
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(404, '{"error":"not found"}'));

    expect(() => storageDelete_("attachments", "missing.png")).toThrow(
      /404.*not found/s
    );
  });
});

describe("storageSignedUrl_", () => {
  test("POSTs expiresIn and returns the full URL built from the relative signedURL", () => {
    const fetchSpy = jest.fn().mockReturnValue(
      fakeResponse(
        200,
        JSON.stringify({
          signedURL: "/object/sign/attachments/a1/f.pdf?token=abc123"
        })
      )
    );
    global.httpFetch_ = fetchSpy;

    const url = storageSignedUrl_("attachments", "a1/f.pdf", 300);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/functions/v1/kb-proxy/storage/v1/object/sign/attachments/a1/f.pdf",
      expect.objectContaining({
        method: "post",
        headers: expect.objectContaining({
          "X-KB-Proxy-Secret": "proxy-secret"
        }),
        payload: JSON.stringify({ expiresIn: 300 })
      })
    );
    expect(url).toBe(
      "https://x.supabase.co/storage/v1/object/sign/attachments/a1/f.pdf?token=abc123"
    );
  });

  test("throws with status code and response body on a non-2xx response", () => {
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(404, '{"error":"not found"}'));

    expect(() => storageSignedUrl_("attachments", "missing.pdf", 300)).toThrow(
      /404.*not found/s
    );
  });
});

describe("storageDownload_", () => {
  test("GETs the object endpoint and returns its text content", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, "print('hello')"));
    global.httpFetch_ = fetchSpy;

    const content = storageDownload_("attachments", "a1/script.py");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/functions/v1/kb-proxy/storage/v1/object/attachments/a1/script.py",
      expect.objectContaining({
        method: "get",
        headers: {
          "X-KB-Proxy-Secret": "proxy-secret"
        }
      })
    );
    expect(content).toBe("print('hello')");
  });

  test("throws with status code and response body on a non-2xx response", () => {
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(404, '{"error":"not found"}'));

    expect(() => storageDownload_("attachments", "missing.py")).toThrow(
      /404.*not found/s
    );
  });
});

describe("mycr F-06: 路徑每一段都經過 URL 編碼,斜線只出現在段與段之間", () => {
  const PREFIX = "https://x.supabase.co/functions/v1/kb-proxy/storage/v1/object/";
  const ok = () => jest.fn().mockReturnValue(fakeResponse(200, '{"signedURL":"/object/sign/x?token=t"}'));

  test.each([
    ["a b/c?d#e", "a%20b/c%3Fd%23e"],
    ["art/報告.pdf", "art/%E5%A0%B1%E5%91%8A.pdf"],
    ["a%2e%2e/b", "a%252e%252e/b"],
    ["clean/uuid-1.png", "clean/uuid-1.png"]
  ])("路徑 %s 編碼為 %s(上傳 / 刪除 / 下載 / 簽名一致)", (raw, encoded) => {
    const spy = ok();
    global.httpFetch_ = spy;

    storageUpload_("attachments", raw, [1], "image/png");
    storageDelete_("attachments", raw);
    storageDownload_("attachments", raw);
    storageSignedUrl_("attachments", raw, 60);

    const urls = spy.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe(PREFIX + "attachments/" + encoded);
    expect(urls[1]).toBe(PREFIX + "attachments/" + encoded);
    expect(urls[2]).toBe(PREFIX + "attachments/" + encoded);
    expect(urls[3]).toBe(PREFIX + "sign/attachments/" + encoded);
  });

  test("路徑中的 ? 與 # 不會變成 query 或 fragment(請求網址只有一個 ? 都沒有)", () => {
    const spy = ok();
    global.httpFetch_ = spy;
    storageDelete_("attachments", "a/b.png?x=1#y");
    expect(spy.mock.calls[0][0]).not.toMatch(/[?#]/);
  });
});
