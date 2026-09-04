const {
  loadCoreGas,
  fakeUtilities,
  fakeResponse
} = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  loadGas("../../src/StorageClient.gs");
  loadGas("../../src/AttachmentTypes.gs");
  loadGas("../../src/Attachments.gs");
});

describe("uploadAttachmentFile", () => {
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
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    renameFolder_("a&b", "名稱");

    expect(fetchSpy).toHaveBeenCalledWith(
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
  test("looks up a file-backed attachment and returns its signed URL, defaulting expiresIn to 300", () => {
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
        payload: JSON.stringify({ expiresIn: 300 })
      })
    );
    expect(url).toBe("https://x.supabase.co/storage/v1/object/sign/attachments/a1/f.pdf?token=x");
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
