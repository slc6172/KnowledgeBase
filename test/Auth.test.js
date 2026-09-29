const { loadGas } = require("./helpers/loadGas");
const {
  fakeConfigWithWritePassword,
  fakeUtilities,
  fakeCacheService,
  fakeLockService,
  fakeLogger,
  fakeResponse
} = require("./helpers/testSetup");

beforeEach(() => {
  fakeConfigWithWritePassword(null); // 預設「還沒設定密碼」,個別測試再覆寫
  fakeUtilities();
  fakeCacheService();
  fakeLockService();
  fakeLogger();
  loadGas("../../src/Config.gs");
  loadGas("../../src/HttpTransport.gs");
  loadGas("../../src/ErrorHandling.gs");
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

  test("returns false (not throws) for non-string input such as undefined/null/numbers", () => {
    fakeConfigWithWritePassword("correct-horse");
    expect(isValidWritePassword_(undefined)).toBe(false);
    expect(isValidWritePassword_(null)).toBe(false);
    expect(isValidWritePassword_(12345)).toBe(false);
  });
});

describe("constantTimeEquals_", () => {
  // 這裡測的是「各種輸入下,判斷結果依然正確」這個功能性等價,不是真的去
  // 斷言「花的時間有沒有相關性」——時間側信道本身是統計層級的性質,微秒級的
  // 計時斷言在 CI 環境天生就不穩定,不是好的單元測試寫法。這些測試存在的
  // 目的,是避免之後有人為了效能或「看起來更簡潔」,把提早跳出迴圈的寫法
  // (例如改回原生 ===,或加一個 if 長度不同就先 return)悄悄加回來。
  test("returns true only when both strings are identical", () => {
    expect(constantTimeEquals_("correct-horse", "correct-horse")).toBe(true);
    expect(constantTimeEquals_("", "")).toBe(true);
  });

  test("returns false for same-length strings that differ at any position (start/middle/end)", () => {
    expect(constantTimeEquals_("Xorrect-horse", "correct-horse")).toBe(false);
    expect(constantTimeEquals_("corXect-horse", "correct-horse")).toBe(false);
    expect(constantTimeEquals_("correct-horsX", "correct-horse")).toBe(false);
  });

  test("returns false when lengths differ, whether the guess is shorter or longer than the secret", () => {
    expect(constantTimeEquals_("correct", "correct-horse")).toBe(false);
    expect(constantTimeEquals_("correct-horse-battery-staple", "correct-horse")).toBe(false);
    expect(constantTimeEquals_("", "correct-horse")).toBe(false);
  });

  test("returns false (not throws) for non-string arguments", () => {
    expect(constantTimeEquals_(undefined, "correct-horse")).toBe(false);
    expect(constantTimeEquals_(null, "correct-horse")).toBe(false);
    expect(constantTimeEquals_(12345, "correct-horse")).toBe(false);
    expect(constantTimeEquals_("correct-horse", undefined)).toBe(false);
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

  test("converts an upstream Supabase failure into the generic data-service message, not the raw error", () => {
    fakeConfigWithWritePassword("correct-horse");
    global.httpFetch_ = jest
      .fn()
      .mockReturnValue(fakeResponse(500, 'column "secret_internal_field" does not exist'));

    let caught;
    try {
      callProtected("correct-horse", "createArticle", [{ title: "t", content_md: "body" }]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/資料服務暫時發生問題/);
    expect(caught.message).not.toMatch(/secret_internal_field/);
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
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"c2","name":"React","parent_id":"c1"}]')) // findCategoryOrThrow_(categoryId)
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"c2","name":"React","parent_id":null}]')); // PATCH
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
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t1","name":"JS"}]')) // findTagOrThrow_
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
      .mockReturnValueOnce(
        fakeResponse(200, '[{"id":"f1","article_id":"a1","name":"設計稿"}]')
      ) // findFolderOrThrow_
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
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-source","name":"JS"}]')) // findTagOrThrow_(sourceTagId)
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"t-target","name":"JavaScript"}]')) // findTagOrThrow_(targetTagId)
      .mockReturnValue(fakeResponse(200, "[]"));
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

  // mycr finding(2026-09,jest --coverage 找出來的):dispatchProtectedCall_
  // 的 20 個 switch case 裡,有 9 個從來沒有專屬的「dispatches to the real
  // X」測試覆蓋過(這幾個底層函式本身在 Articles/Categories/Attachments 的
  // 測試檔裡都有測,但「callProtected 這一層真的有正確接到它」這件事本身
  // 從沒被驗證過)——補齊,讓 20 個 case 全部都至少有一個測試會實際執行到。
  test("dispatches to the real updateArticle when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, '[{"id":"a1","status":"draft"}]'));
    global.httpFetch_ = fetchSpy;

    // 空的 patch(不帶任何欄位)——dispatch 本身有沒有接到位是這裡要驗證的
    // 重點,不需要連帶測 updateArticle_ 內部的欄位更新邏輯(那是
    // Articles.test.js 的責任)。
    const result = callProtected("correct-horse", "updateArticle", ["a1", {}]);

    expect(result).toEqual({ id: "a1", status: "draft", tags: [] });
  });

  test("dispatches to the real deleteArticle when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "deleteArticle", ["a1"]);

    expect(result).toEqual({ deleted: true, id: "a1" });
  });

  test("dispatches to the real setArticleStatus when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, '[{"id":"a1","status":"draft"}]'));
    global.httpFetch_ = fetchSpy;

    // status 用 'draft',避免連帶觸發 setArticleStatus_ 發布路徑才會走的
    // Gemini 呼叫(見 Articles.gs)——那不是這個測試要驗證的範圍。
    const result = callProtected("correct-horse", "setArticleStatus", ["a1", "draft"]);

    expect(result).toEqual({ id: "a1", status: "draft", tags: [] });
  });

  test("dispatches to the real uploadAttachmentFile when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    fakeUtilities("uuid-dispatch");
    const base64Data = Buffer.from("hi").toString("base64");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '{"Key":"a1/uuid-dispatch.png"}'))
      .mockReturnValueOnce(
        fakeResponse(201, JSON.stringify([{ id: "att-1", article_id: "a1", type: "photo" }]))
      );
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "uploadAttachmentFile", [
      "a1",
      "cat.png",
      base64Data,
      "image/png"
    ]);

    expect(result).toEqual({ id: "att-1", article_id: "a1", type: "photo" });
  });

  test("dispatches to the real addAttachmentUrl when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(
        fakeResponse(201, JSON.stringify([{ id: "att-2", article_id: "a1", type: "url" }]))
      );
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "addAttachmentUrl", [
      "a1",
      "https://example.com",
      "範例連結",
      null
    ]);

    expect(result).toEqual({ id: "att-2", article_id: "a1", type: "url" });
  });

  test("dispatches to the real deleteAttachment when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"att-1","file_path":null}]')) // findAttachmentOrThrow_
      .mockReturnValueOnce(fakeResponse(200, "[]")); // DELETE
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "deleteAttachment", ["att-1"]);

    expect(result).toEqual({ deleted: true, id: "att-1" });
  });

  test("dispatches to the real createCategory when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(201, '[{"id":"c1","name":"前端","parent_id":null}]'));
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "createCategory", ["前端", null]);

    expect(result).toEqual({ id: "c1", name: "前端", parent_id: null });
  });

  test("dispatches to the real updateCategory when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"c1","name":"前端"}]')) // findCategoryOrThrow_
      .mockReturnValueOnce(fakeResponse(200, '[{"id":"c1","name":"前端(新)"}]'));
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "updateCategory", ["c1", "前端(新)"]);

    expect(result).toEqual({ id: "c1", name: "前端(新)" });
  });

  test("dispatches to the real deleteCategory when password and functionName are valid", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest.fn().mockReturnValue(fakeResponse(200, "[]"));
    global.httpFetch_ = fetchSpy;

    const result = callProtected("correct-horse", "deleteCategory", ["c1"]);

    expect(result).toEqual({ deleted: true, id: "c1" });
  });

  test("locks out after PASSWORD_LOCKOUT_MAX_FAILURES_ wrong attempts, rejecting even the correct password until the window passes", () => {
    fakeConfigWithWritePassword("correct-horse");
    const fetchSpy = jest.fn();
    global.httpFetch_ = fetchSpy;

    for (let i = 0; i < PASSWORD_LOCKOUT_MAX_FAILURES_; i++) {
      expect(() => callProtected("wrong-" + i, "createArticle", [{ title: "t" }])).toThrow(/密碼錯誤/);
    }
    // 鎖定之後,連正確密碼都被拒絕,且訊息不含「密碼錯誤」四個字(見 Auth.gs
    // 對應註解——避免跟前端偵測「密碼被使用者改過」那段搞混)。
    expect(() => callProtected("correct-horse", "createArticle", [{ title: "t" }])).toThrow(
      /嘗試次數過多/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a successful call clears the failure count, so a handful of earlier mistakes don't carry over", () => {
    fakeConfigWithWritePassword("correct-horse");
    global.httpFetch_ = jest
      .fn()
      .mockReturnValueOnce(fakeResponse(200, "[]")); // batchDeleteArticles: listAttachments 空陣列

    for (let i = 0; i < PASSWORD_LOCKOUT_MAX_FAILURES_ - 1; i++) {
      expect(() => callProtected("wrong-" + i, "createArticle", [{ title: "t" }])).toThrow(/密碼錯誤/);
    }
    // 只差一次就會鎖定,但這次密碼答對,不應該被算進失敗次數、也不該被鎖定。
    expect(() => callProtected("correct-horse", "batchDeleteArticles", [[]])).not.toThrow();
  });

  test("mycr F-05 fix: wraps the lockout-check/compare/record sequence in LockService, so parallel executions can't each read the same stale failure count and dilute the lockout (Apps Script allows up to 30 concurrent executions per user)", () => {
    const lock = fakeLockService();
    fakeConfigWithWritePassword("correct-horse");
    global.httpFetch_ = jest.fn().mockReturnValue(fakeResponse(200, "[]"));

    callProtected("correct-horse", "batchDeleteArticles", [[]]);

    expect(lock.waitLockCalls.length).toBe(1);
    expect(lock.releaseLockCalls).toBe(1);
  });

  test("mycr F-05 fix: releases the lock even when the password check itself throws (already locked out)", () => {
    const lock = fakeLockService();
    fakeConfigWithWritePassword("correct-horse");
    global.httpFetch_ = jest.fn();

    for (let i = 0; i < PASSWORD_LOCKOUT_MAX_FAILURES_; i++) {
      expect(() => callProtected("wrong-" + i, "createArticle", [{ title: "t" }])).toThrow(/密碼錯誤/);
    }
    expect(() => callProtected("correct-horse", "createArticle", [{ title: "t" }])).toThrow(/嘗試次數過多/);

    expect(lock.waitLockCalls.length).toBe(PASSWORD_LOCKOUT_MAX_FAILURES_ + 1);
    expect(lock.releaseLockCalls).toBe(PASSWORD_LOCKOUT_MAX_FAILURES_ + 1); // 連最後一次拋錯也要釋放鎖
  });
});

describe("checkPublicReadRateLimit_", () => {
  test("allows PUBLIC_READ_RATE_LIMIT_PER_HOUR_ calls within the window, then throws on the next one — mycr finding: protects the shared, exhaustible Apps Script UrlFetch daily quota now that the deployment is ANYONE_ANONYMOUS", () => {
    for (let i = 0; i < PUBLIC_READ_RATE_LIMIT_PER_HOUR_; i++) {
      expect(() => checkPublicReadRateLimit_()).not.toThrow();
    }
    expect(() => checkPublicReadRateLimit_()).toThrow(/使用量過大/);
  });

  test("the window is aligned to the clock hour (a fixed bucket derived from the current UTC hour, not a rolling window from first call)", () => {
    const cache = CacheService.getScriptCache();
    const hourBucket = Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000));

    checkPublicReadRateLimit_();

    expect(cache.get("public_read_" + hourBucket)).toBe("1");
  });
});
