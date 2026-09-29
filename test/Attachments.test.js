const {
  loadCoreGas,
  fakeUtilities,
  fakeCacheService,
  fakeLogger,
  fakeResponse
} = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  fakeCacheService();
  loadGas("../../src/Auth.gs");
  loadGas("../../src/StorageClient.gs");
  loadGas("../../src/AttachmentTypes.gs");
  loadGas("../../src/Attachments.gs");
});

describe("uploadAttachmentFile", () => {
  test("mycr finding: when the DB insert fails after a successful Storage upload, best-effort deletes the just-uploaded object before rethrowing", () => {
    fakeUtilities("uuid-orphan");
    fakeLogger();
    const base64Data = Buffer.from("hello").toString("base64");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '{"Key":"a1/uuid-orphan.png"}')) // storage upload
      .mockReturnValueOnce(fakeResponse(409, "insert or update on table \"attachments\" violates foreign key constraint")) // db insert fails
      .mockReturnValueOnce(fakeResponse(200, "")); // compensating storage delete
    global.httpFetch_ = fetchSpy;

    let caught;
    try {
      uploadAttachmentFile_("stale-article", "cat.png", base64Data, "image/png");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/409/);
    expect(caught.isUpstreamError_).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/storage/v1/object/attachments/stale-article/uuid-orphan.png",
      expect.objectContaining({ method: "delete" })
    );
  });

  test("mycr finding: if the compensating Storage cleanup itself fails, logs it but still rethrows the original insert error (not the cleanup error)", () => {
    fakeUtilities("uuid-orphan2");
    const logger = fakeLogger();
    const base64Data = Buffer.from("hello").toString("base64");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '{"Key":"a1/uuid-orphan2.png"}')) // storage upload
      .mockReturnValueOnce(fakeResponse(409, "fk violation")) // db insert fails
      .mockReturnValueOnce(fakeResponse(500, "storage also down")); // compensating delete also fails
    global.httpFetch_ = fetchSpy;

    let caught;
    try {
      uploadAttachmentFile_("stale-article", "cat.png", base64Data, "image/png");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/fk violation/);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(logger.logs.some((l) => /uuid-orphan2\.png/.test(l))).toBe(true);
  });

  test("rejects a file over the 20MB cap before any network call", () => {
    fakeUtilities("uuid-oversize");
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;
    // 20MB + 1 byte 的假資料,base64 編碼後解出來剛好超過上限一個 byte。
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1, "a").toString("base64");

    expect(() =>
      uploadAttachmentFile_("a1", "big.zip", oversized, "application/zip")
    ).toThrow(/20\s*MB|過大/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("decodes base64, uploads to Storage, and inserts the attachments row", () => {
    fakeUtilities("uuid-1");
    const base64Data = Buffer.from("hello").toString("base64"); // 5 bytes
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '{"Key":"a1/uuid-1.png"}')) // storage upload
      .mockReturnValueOnce(
        fakeResponse(
          201,
          JSON.stringify([
            {
              id: "att-1",
              article_id: "a1",
              type: "photo",
              file_path: "a1/uuid-1.png",
              file_name: "cat.png",
              file_size: 5
            }
          ])
        )
      ); // insert attachments row
    global.httpFetch_ = fetchSpy;

    const attachment = uploadAttachmentFile_("a1", "cat.png", base64Data, "image/png");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/storage/v1/object/attachments/a1/uuid-1.png",
      expect.objectContaining({
        method: "post",
        headers: expect.objectContaining({ "Content-Type": "image/png" }),
        payload: Array.from(Buffer.from("hello"))
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/attachments",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([
          {
            article_id: "a1",
            type: "photo",
            file_path: "a1/uuid-1.png",
            file_name: "cat.png",
            file_size: 5,
            folder_id: null
          }
        ])
      })
    );
    expect(attachment.id).toBe("att-1");
  });

  test("ignores the caller-supplied mimeType and forces octet-stream for svg, even if the caller claims image/svg+xml", () => {
    // svg 被 detectAttachmentType_ 歸類成 photo,但它本質上是可以帶 <script>
    // 的 XML 文件——signed URL 被直接在新分頁開啟時,瀏覽器會依 Content-Type
    // 決定怎麼解析,不能照抄呼叫端宣稱的 mimeType。這裡刻意呼叫端還是宣稱
    // image/svg+xml,驗證伺服器端不理會這個宣稱、一律送 octet-stream。
    fakeUtilities("uuid-svg");
    const base64Data = Buffer.from("<svg onload=alert(1)></svg>").toString("base64");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '{"Key":"a1/uuid-svg.svg"}'))
      .mockReturnValueOnce(
        fakeResponse(
          201,
          JSON.stringify([{ id: "att-svg", article_id: "a1", type: "photo" }])
        )
      );
    global.httpFetch_ = fetchSpy;

    uploadAttachmentFile_("a1", "logo.svg", base64Data, "image/svg+xml");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/storage/v1/object/attachments/a1/uuid-svg.svg",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/octet-stream" })
      })
    );
  });

  test("ignores a mismatched caller-supplied mimeType for a known-safe extension (server value always wins)", () => {
    // 呼叫端就算刻意亂報 mimeType(這裡宣稱 text/html),只要副檔名在安全
    // 清單裡,伺服器端還是用清單裡的值,不會被呼叫端牽著走。
    fakeUtilities("uuid-lie");
    const base64Data = Buffer.from("hello").toString("base64");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '{"Key":"a1/uuid-lie.png"}'))
      .mockReturnValueOnce(
        fakeResponse(201, JSON.stringify([{ id: "att-lie", article_id: "a1", type: "photo" }]))
      );
    global.httpFetch_ = fetchSpy;

    uploadAttachmentFile_("a1", "cat.png", base64Data, "text/html");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/storage/v1/object/attachments/a1/uuid-lie.png",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "image/png" })
      })
    );
  });

  test("keeps the Storage path pure ASCII (uuid + extension) for Chinese/Unicode filenames", () => {
    fakeUtilities("uuid-2");
    const base64Data = Buffer.from("hi").toString("base64");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '{"Key":"a1/uuid-2.pdf"}'))
      .mockReturnValueOnce(
        fakeResponse(
          201,
          JSON.stringify([
            {
              id: "att-9",
              article_id: "a1",
              type: "pdf",
              file_path: "a1/uuid-2.pdf",
              file_name: "部署檢查清單.pdf",
              file_size: 2
            }
          ])
        )
      );
    global.httpFetch_ = fetchSpy;

    uploadAttachmentFile_("a1", "部署檢查清單.pdf", base64Data, "application/pdf");

    // Storage 路徑不含任何中文字元或編碼過的中文字元，只有 uuid + 副檔名
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/storage/v1/object/attachments/a1/uuid-2.pdf",
      expect.objectContaining({ method: "post" })
    );
    // 完整原始檔名（含中文）原封不動存進 DB 的 file_name
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/attachments",
      expect.objectContaining({
        payload: JSON.stringify([
          {
            article_id: "a1",
            type: "pdf",
            file_path: "a1/uuid-2.pdf",
            file_name: "部署檢查清單.pdf",
            file_size: 2,
            folder_id: null
          }
        ])
      })
    );
  });

  test("attachment-folders/01: includes folder_id in the insert payload when folderId is given", () => {
    fakeUtilities("uuid-3");
    const base64Data = Buffer.from("hi").toString("base64");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '{"Key":"a1/uuid-3.png"}'))
      .mockReturnValueOnce(fakeResponse(201, '[{"id":"att-10"}]'));
    global.httpFetch_ = fetchSpy;

    uploadAttachmentFile_("a1", "cat.png", base64Data, "image/png", "folder-1");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/attachments",
      expect.objectContaining({
        payload: JSON.stringify([
          {
            article_id: "a1",
            type: "photo",
            file_path: "a1/uuid-3.png",
            file_name: "cat.png",
            file_size: 2,
            folder_id: "folder-1"
          }
        ])
      })
    );
  });
});

describe("addAttachmentUrl", () => {
  test("inserts a type='url' row with the given label", () => {
    const fetchSpy = jest.fn().mockReturnValue(
      fakeResponse(
        201,
        JSON.stringify([
          {
            id: "att-2",
            article_id: "a1",
            type: "url",
            url: "https://example.com/doc",
            file_name: "Official docs",
            file_path: null
          }
        ])
      )
    );
    global.httpFetch_ = fetchSpy;

    const attachment = addAttachmentUrl_("a1", "https://example.com/doc", "Official docs");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/attachments",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([
          {
            article_id: "a1",
            type: "url",
            url: "https://example.com/doc",
            file_name: "Official docs",
            folder_id: null
          }
        ])
      })
    );
    expect(attachment.id).toBe("att-2");
  });

  test("defaults file_name to the url when no label is given", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(201, '[{"id":"att-3"}]'));
    global.httpFetch_ = fetchSpy;

    addAttachmentUrl_("a1", "https://example.com/doc");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/attachments",
      expect.objectContaining({
        payload: JSON.stringify([
          {
            article_id: "a1",
            type: "url",
            url: "https://example.com/doc",
            file_name: "https://example.com/doc",
            folder_id: null
          }
        ])
      })
    );
  });

  test("attachment-folders/01: includes folder_id in the insert payload when folderId is given", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(201, '[{"id":"att-4"}]'));
    global.httpFetch_ = fetchSpy;

    addAttachmentUrl_("a1", "https://example.com/doc", "Official docs", "folder-2");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/attachments",
      expect.objectContaining({
        payload: JSON.stringify([
          {
            article_id: "a1",
            type: "url",
            url: "https://example.com/doc",
            file_name: "Official docs",
            folder_id: "folder-2"
          }
        ])
      })
    );
  });

  test("rejects a javascript: URL before any network call", () => {
    // 附件的自訂網址前後端都只接受一般網頁連結,避免存入會被瀏覽器當成
    // 可執行程式碼的網址(細節見 README 已知問題修復紀錄)。
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => addAttachmentUrl_("a1", "javascript:alert(1)", "label")).toThrow(/http/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("rejects a data: URL before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() =>
      addAttachmentUrl_("a1", "data:text/html,payload", "label")
    ).toThrow(/http/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("accepts http:// as well as https://", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(201, JSON.stringify([{ id: "att-5", type: "url" }])));
    global.httpFetch_ = fetchSpy;

    expect(() => addAttachmentUrl_("a1", "http://example.com/doc", "label")).not.toThrow();
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("listAttachments", () => {
  test("mycr finding: converts an upstream Supabase failure into the generic data-service message", () => {
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(500, 'column "secret_internal_field" does not exist'));

    let caught;
    try {
      listAttachments("a1");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/資料服務暫時發生問題/);
    expect(caught.message).not.toMatch(/secret_internal_field/);
  });

  test("mycr finding: is subject to the shared public-read rate limit (ANYONE_ANONYMOUS deployment)", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => listAttachments("a1")).toThrow(/使用量過大/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("filters by article_id, orders by created_at ascending, and embeds folder info", () => {
    const rows = [
      { id: "att-1", article_id: "a1", type: "photo", attachment_folders: { id: "f1", name: "設計稿" } },
      { id: "att-2", article_id: "a1", type: "url", attachment_folders: null }
    ];
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, JSON.stringify(rows)));
    global.httpFetch_ = fetchSpy;

    const result = listAttachments("a1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/attachments?select=*,attachment_folders(id,name)&article_id=eq.a1&order=created_at.asc",
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual(rows);
  });
});

describe("listFolders", () => {
  test("mycr finding: converts an upstream Supabase failure into the generic data-service message", () => {
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(500, 'column "secret_internal_field" does not exist'));

    let caught;
    try {
      listFolders("a1");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/資料服務暫時發生問題/);
    expect(caught.message).not.toMatch(/secret_internal_field/);
  });

  test("mycr finding: is subject to the shared public-read rate limit — was missing from Auth.gs's documented list of public read functions until this scan (ANYONE_ANONYMOUS deployment)", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => listFolders("a1")).toThrow(/使用量過大/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("filters by article_id and orders by name ascending", () => {
    const rows = [
      { id: "f1", article_id: "a1", name: "設計稿" },
      { id: "f2", article_id: "a1", name: "測試資料" }
    ];
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, JSON.stringify(rows)));
    global.httpFetch_ = fetchSpy;

    const result = listFolders("a1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/attachment_folders?article_id=eq.a1&order=name.asc",
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual(rows);
  });
});

describe("createFolder", () => {
  test("rejects a missing/whitespace-only name before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => createFolder_("a1", "   ")).toThrow(/名稱/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("inserts a new folder scoped to the article", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(201, '[{"id":"f3","article_id":"a1","name":"設計稿"}]'));
    global.httpFetch_ = fetchSpy;

    const folder = createFolder_("a1", "設計稿");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/attachment_folders",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([{ article_id: "a1", name: "設計稿" }])
      })
    );
    expect(folder.id).toBe("f3");
  });
});

describe("renameFolder", () => {
  test("rejects a missing/whitespace-only name before any network call", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => renameFolder_("f1", "   ")).toThrow(/名稱/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("mycr finding: throws a clear error (not silently returning undefined) when folderId doesn't exist", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    expect(() => renameFolder_("no-such-id", "設計稿 v2")).toThrow(/找不到資料夾/);
  });

  test("PATCHes the folder's name and returns the updated row", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValue(fakeResponse(200, '[{"id":"f1","article_id":"a1","name":"設計稿 v2"}]'));
    global.httpFetch_ = fetchSpy;

    const folder = renameFolder_("f1", "設計稿 v2");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/attachment_folders?id=eq.f1",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ name: "設計稿 v2" })
      })
    );
    expect(folder).toEqual({ id: "f1", article_id: "a1", name: "設計稿 v2" });
  });

  test("URL-encodes a folderId containing PostgREST-reserved characters", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(200, '[{"id":"a&b","article_id":"a1","name":"舊名稱"}]')
      ) // findFolderOrThrow_
      .mockReturnValueOnce(fakeResponse(200, "[]")); // PATCH
    global.httpFetch_ = fetchSpy;

    renameFolder_("a&b", "名稱");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/attachment_folders?id=eq.a%26b",
      expect.objectContaining({ method: "PATCH" })
    );
  });
});

describe("deleteFolder", () => {
  test("DELETEs the folder by id and returns { deleted: true, id } without touching attachments", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    const result = deleteFolder_("f1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/attachment_folders?id=eq.f1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1); // 只刪資料夾本身,不額外碰 attachments
    expect(result).toEqual({ deleted: true, id: "f1" });
  });
});

describe("deleteAttachment", () => {
  test("throws a clear not-found error and makes no deletion calls when the id doesn't exist", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    expect(() => deleteAttachment_("missing-id")).toThrow(/找不到附件.*missing-id/);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the lookup select, no deletes
  });

  test("deletes the Storage object first, then the DB row, for a file attachment", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            { id: "att-1", article_id: "a1", file_path: "a1/uuid_cat.png" }
          ])
        )
      ) // lookup
      .mockReturnValueOnce(fakeResponse(200, '{"message":"deleted"}')) // storage delete
      .mockReturnValueOnce(fakeResponse(200, "")); // db delete
    global.httpFetch_ = fetchSpy;

    const result = deleteAttachment_("att-1");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/storage/v1/object/attachments/a1/uuid_cat.png",
      expect.objectContaining({ method: "delete" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://x.supabase.co/rest/v1/attachments?id=eq.att-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(result).toEqual({ deleted: true, id: "att-1" });
  });

  test("skips the Storage call entirely for a url-type attachment", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([{ id: "att-2", article_id: "a1", file_path: null, type: "url" }])
        )
      ) // lookup
      .mockReturnValueOnce(fakeResponse(200, "")); // db delete
    global.httpFetch_ = fetchSpy;

    deleteAttachment_("att-2");

    expect(fetchSpy).toHaveBeenCalledTimes(2); // lookup + db delete only
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/rest/v1/attachments?id=eq.att-2",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

describe("getSignedAttachmentUrl", () => {
  test("mycr finding: converts an upstream Supabase failure into the generic data-service message", () => {
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(500, 'column "secret_internal_field" does not exist'));

    let caught;
    try {
      getSignedAttachmentUrl("att-1");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/資料服務暫時發生問題/);
    expect(caught.message).not.toMatch(/secret_internal_field/);
  });

  test("mycr finding: is subject to the shared public-read rate limit (ANYONE_ANONYMOUS deployment)", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => getSignedAttachmentUrl("att-1")).toThrow(/使用量過大/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("looks up a file-backed attachment and returns its signed URL, defaulting expiresIn to the 3600s (1hr) cap", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([{ id: "att-1", article_id: "a1", file_path: "a1/f.pdf" }])
        )
      ) // lookup
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ signedURL: "/object/sign/attachments/a1/f.pdf?token=x" }))
      ); // sign
    global.httpFetch_ = fetchSpy;

    const url = getSignedAttachmentUrl("att-1");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/storage/v1/object/sign/attachments/a1/f.pdf",
      expect.objectContaining({
        method: "post",
        payload: JSON.stringify({ expiresIn: 3600 })
      })
    );
    expect(url).toBe("https://x.supabase.co/storage/v1/object/sign/attachments/a1/f.pdf?token=x");
  });

  test("caps a caller-requested expiresInSeconds above 3600 at the 1hr maximum (mycr finding: expiresIn had no server-side ceiling)", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([{ id: "att-1", article_id: "a1", file_path: "a1/f.pdf" }])
        )
      )
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ signedURL: "/object/sign/attachments/a1/f.pdf?token=x" }))
      );
    global.httpFetch_ = fetchSpy;

    // 呼叫端(繞過前端直接呼叫 google.script.run)要求 10 年效期,伺服器端一律夾到上限。
    getSignedAttachmentUrl("att-1", 315360000);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/storage/v1/object/sign/attachments/a1/f.pdf",
      expect.objectContaining({ payload: JSON.stringify({ expiresIn: 3600 }) })
    );
  });

  test("honors a caller-provided expiresInSeconds shorter than the cap", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([{ id: "att-1", article_id: "a1", file_path: "a1/f.pdf" }])
        )
      )
      .mockReturnValueOnce(
        fakeResponse(200, JSON.stringify({ signedURL: "/object/sign/attachments/a1/f.pdf?token=x" }))
      );
    global.httpFetch_ = fetchSpy;

    getSignedAttachmentUrl("att-1", 60);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/storage/v1/object/sign/attachments/a1/f.pdf",
      expect.objectContaining({ payload: JSON.stringify({ expiresIn: 60 }) })
    );
  });

  test("throws for a url-type attachment (no file_path) and makes no Storage call", () => {
    const fetchSpy = jest.fn().mockReturnValue(
      fakeResponse(
        200,
        JSON.stringify([{ id: "att-2", article_id: "a1", file_path: null, type: "url" }])
      )
    );
    global.httpFetch_ = fetchSpy;

    expect(() => getSignedAttachmentUrl("att-2")).toThrow(/沒有對應的檔案|file_path/);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the lookup, no sign call
  });

  test("throws a 'not found' error for a missing attachment id", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    expect(() => getSignedAttachmentUrl("missing-id")).toThrow(/找不到附件.*missing-id/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("getTextAttachmentContent", () => {
  test("mycr finding: converts an upstream Supabase failure into the generic data-service message", () => {
    fakeLogger();
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(500, 'column "secret_internal_field" does not exist'));

    let caught;
    try {
      getTextAttachmentContent("att-1");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/資料服務暫時發生問題/);
    expect(caught.message).not.toMatch(/secret_internal_field/);
  });

  test("mycr finding: is subject to the shared public-read rate limit (ANYONE_ANONYMOUS deployment)", () => {
    global.CacheService.getScriptCache().put(
      "public_read_" + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000)),
      String(PUBLIC_READ_RATE_LIMIT_PER_HOUR_)
    );
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => getTextAttachmentContent("att-1")).toThrow(/使用量過大/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns the downloaded text for a code-type attachment within the size limit", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            { id: "att-1", article_id: "a1", type: "code", file_path: "a1/s.py", file_size: 100 }
          ])
        )
      ) // lookup
      .mockReturnValueOnce(fakeResponse(200, "print('hi')")); // download
    global.httpFetch_ = fetchSpy;

    const content = getTextAttachmentContent("att-1");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://x.supabase.co/storage/v1/object/attachments/a1/s.py",
      expect.objectContaining({ method: "get" })
    );
    expect(content).toBe("print('hi')");
  });

  test("also works for a md_file-type attachment", () => {
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(
          200,
          JSON.stringify([
            { id: "att-2", article_id: "a1", type: "md_file", file_path: "a1/n.md", file_size: 50 }
          ])
        )
      )
      .mockReturnValueOnce(fakeResponse(200, "# Notes"));
    global.httpFetch_ = fetchSpy;

    expect(getTextAttachmentContent("att-2")).toBe("# Notes");
  });

  test("throws for a type that isn't code or md_file, without calling download", () => {
    const fetchSpy = jest.fn().mockReturnValue(
      fakeResponse(
        200,
        JSON.stringify([
          { id: "att-3", article_id: "a1", type: "zip", file_path: "a1/x.zip", file_size: 100 }
        ])
      )
    );
    global.httpFetch_ = fetchSpy;

    expect(() => getTextAttachmentContent("att-3")).toThrow(/不支援純文字預覽/);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the lookup
  });

  test("throws for a file over 1MB, without calling download", () => {
    const fetchSpy = jest.fn().mockReturnValue(
      fakeResponse(
        200,
        JSON.stringify([
          {
            id: "att-4",
            article_id: "a1",
            type: "code",
            file_path: "a1/big.py",
            file_size: 1024 * 1024 + 1
          }
        ])
      )
    );
    global.httpFetch_ = fetchSpy;

    expect(() => getTextAttachmentContent("att-4")).toThrow(/檔案過大/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("throws a 'not found' error for a missing attachment id", () => {
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    expect(() => getTextAttachmentContent("missing-id")).toThrow(/找不到附件.*missing-id/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
