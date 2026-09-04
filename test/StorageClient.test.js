const { loadCoreGas, fakeResponse } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  loadGas("../../src/StorageClient.gs");
});

describe("storageUpload_", () => {
  test("POSTs bytes to the object endpoint with apikey/Authorization/Content-Type", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, '{"Id":"x","Key":"attachments/a1/f.png"}'));
    global.httpFetch_ = fetchSpy;
    const bytes = [1, 2, 3];

    const result = storageUpload_("attachments", "a1/f.png", bytes, "image/png");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/storage/v1/object/attachments/a1/f.png",
      expect.objectContaining({
        method: "post",
        headers: {
          apikey: "srv-key",
          Authorization: "Bearer srv-key",
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
  test("DELETEs the object endpoint with apikey/Authorization", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, '{"message":"Successfully deleted"}'));
    global.httpFetch_ = fetchSpy;

    const result = storageDelete_("attachments", "a1/f.png");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/storage/v1/object/attachments/a1/f.png",
      expect.objectContaining({
        method: "delete",
        headers: {
          apikey: "srv-key",
          Authorization: "Bearer srv-key"
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
      "https://x.supabase.co/storage/v1/object/sign/attachments/a1/f.pdf",
      expect.objectContaining({
        method: "post",
        headers: expect.objectContaining({
          apikey: "srv-key",
          Authorization: "Bearer srv-key"
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
      "https://x.supabase.co/storage/v1/object/attachments/a1/script.py",
      expect.objectContaining({
        method: "get",
        headers: {
          apikey: "srv-key",
          Authorization: "Bearer srv-key"
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
