const { loadGas } = require("./helpers/loadGas");
const {
  fakeConfigWithWritePassword,
  fakeUtilities,
  fakeResponse
} = require("./helpers/testSetup");

beforeEach(() => {
  fakeConfigWithWritePassword(null); // 預設「還沒設定密碼」,個別測試再覆寫
  fakeUtilities();
  loadGas("../../src/Config.gs");
  loadGas("../../src/HttpTransport.gs");
  loadGas("../../src/SupabaseClient.gs");
  loadGas("../../src/StorageClient.gs");
  loadGas("../../src/AttachmentTypes.gs");
  loadGas("../../src/Attachments.gs");
  loadGas("../../src/Embeddings.gs");
  loadGas("../../src/Articles.gs");
  loadGas("../../src/Categories.gs");
  loadGas("../../src/Tags.gs");
  loadGas("../../src/Auth.gs");
});

describe("isValidWritePassword_", () => {
  test("returns true for the correct password, without throwing", () => {
    fakeConfigWithWritePassword("correct-horse");
    expect(isValidWritePassword_("correct-horse")).toBe(true);
  });

  test("returns false for the wrong password, without throwing", () => {
    fakeConfigWithWritePassword("correct-horse");
    expect(isValidWritePassword_("wrong")).toBe(false);
  });
});

describe("callProtected", () => {
  test("throws naming WRITE_PASSWORD when it isn't configured, before any dispatch", () => {
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() => callProtected("anything", "createArticle", [{ title: "t" }])).toThrow(
      /WRITE_PASSWORD/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("throws a clear error and never calls httpFetch_ when the password is wrong", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() =>
      callProtected("wrong-guess", "createArticle", [{ title: "t" }])
    ).toThrow(/密碼錯誤/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("throws a clear error and never calls httpFetch_ when functionName isn't whitelisted", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() =>
      callProtected("correct-horse", "listArticles", [])
    ).toThrow(/不支援的操作: listArticles/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("dispatches to the real createArticle and returns its result when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest
      .fn()
      // createArticle 內部:insert articles
      .mockReturnValueOnce(
        fakeResponse(201, '[{"id":"a1","title":"t","content_md":"body","category_id":null,"status":"draft"}]')
      )
      // createArticle 內部:getArticle(a1) 補查詢
      .mockReturnValueOnce(
        fakeResponse(
          200,
          '[{"id":"a1","title":"t","content_md":"body","category_id":null,"status":"draft","categories":null,"article_tags":[]}]'
        )
      );
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "createArticle", [
      { title: "t", content_md: "body" }
    ]);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://x.supabase.co/rest/v1/articles",
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual({
      id: "a1",
      title: "t",
      content_md: "body",
      category_id: null,
      status: "draft",
      categories: null,
      tags: []
    });
  });

  test("dispatches to the real moveCategory when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"c2","name":"React","parent_id":null}]'));
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "moveCategory", ["c2", null]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/categories?id=eq.c2",
      expect.objectContaining({
        method: "PATCH",
        payload: JSON.stringify({ parent_id: null })
      })
    );
    expect(result.parent_id).toBe(null);
  });

  test("dispatches to the real renameTag when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t1","name":"JavaScript"}]'));
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "renameTag", ["t1", "JavaScript"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/tags?id=eq.t1",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(result.name).toBe("JavaScript");
  });

  test("dispatches to the real createFolder when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(201, '[{"id":"f1","article_id":"a1","name":"設計稿"}]')
      );
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "createFolder", ["a1", "設計稿"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/attachment_folders",
      expect.objectContaining({
        method: "POST",
        payload: JSON.stringify([{ article_id: "a1", name: "設計稿" }])
      })
    );
    expect(result).toEqual({ id: "f1", article_id: "a1", name: "設計稿" });
  });

  test("listFolders is a read-only function and is rejected as unsupported, like other read-only functions", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    expect(() =>
      callProtected("correct-horse", "listFolders", ["a1"])
    ).toThrow(/不支援的操作: listFolders/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("dispatches to the real renameFolder when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"f1","article_id":"a1","name":"設計稿 v2"}]'));
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "renameFolder", ["f1", "設計稿 v2"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/attachment_folders?id=eq.f1",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(result.name).toBe("設計稿 v2");
  });

  test("dispatches to the real deleteFolder when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest.fn().mockReturnValueOnce(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "deleteFolder", ["f1"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/attachment_folders?id=eq.f1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(result).toEqual({ deleted: true, id: "f1" });
  });

  test("dispatches to the real deleteTag when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest.fn().mockReturnValueOnce(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "deleteTag", ["t1"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/tags?id=eq.t1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(result).toEqual({ deleted: true, id: "t1" });
  });

  test("dispatches to the real mergeTags when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    callProtected("correct-horse", "mergeTags", ["t-source", "t-target"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/article_tags?tag_id=eq.t-source",
      expect.objectContaining({ method: "GET" })
    );
  });

  test("dispatches to the real batchDeleteArticles when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, "[]")) // listAttachments
      .mockReturnValueOnce(fakeResponse(200, "")); // DELETE
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "batchDeleteArticles", [["a1"]]);

    expect(result).toEqual({ succeeded: ["a1"], failed: [] });
  });

  test("dispatches to the real batchSetArticlesCategory when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest.fn().mockReturnValueOnce(fakeResponse(200, '[{"id":"a1"}]'));
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "batchSetArticlesCategory", [["a1"], "cat-x"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x.supabase.co/rest/v1/articles?id=eq.a1",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(result).toEqual({ succeeded: ["a1"], failed: [] });
  });

  test("dispatches to the real batchAddTagsToArticles when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-js","name":"JS"}]'))
      .mockReturnValueOnce(fakeResponse(200, "[]"))
      .mockReturnValueOnce(fakeResponse(200, '[{"article_id":"a1","tag_id":"t-js"}]'));
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "batchAddTagsToArticles", [["a1"], ["JS"]]);

    expect(result).toEqual({ succeeded: ["a1"], failed: [] });
  });
});
