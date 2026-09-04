const fs = require("fs");
const path = require("path");

/**
 * isSafeAttachmentUrl_ 是 JavaScript.html 裡一個不依賴 DOM 的純函式,這裡把
 * 函式文字從原始碼抽出來,用 Function 建構子還原成真正可以呼叫的函式,寫
 * 行為測試(不是只比對文字)。附件網址欄位存檔前應該先擋下非 http/https
 * 開頭的網址(細節見 README 已知問題修復紀錄)。
 */

function extractIsSafeAttachmentUrl(javaScriptHtml) {
  const match = javaScriptHtml.match(
    /function isSafeAttachmentUrl_\(url\) \{([\s\S]*?)\n\s*\}/
  );
  if (!match) return null;
  return new Function("url", match[1]);
}

describe("attachment URL protocol validation (client-side)", () => {
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );
  const isSafeAttachmentUrl_ = extractIsSafeAttachmentUrl(javaScriptHtml);

  test("isSafeAttachmentUrl_ is defined in JavaScript.html", () => {
    expect(isSafeAttachmentUrl_).not.toBeNull();
  });

  test("accepts http:// and https:// URLs", () => {
    expect(isSafeAttachmentUrl_("https://example.com/doc")).toBe(true);
    expect(isSafeAttachmentUrl_("http://example.com/doc")).toBe(true);
  });

  test("rejects javascript:/data: URLs", () => {
    expect(isSafeAttachmentUrl_("javascript:alert(1)")).toBe(false);
    expect(isSafeAttachmentUrl_("data:text/html,payload")).toBe(false);
  });

  test("the attachment-url form checks isSafeAttachmentUrl_ before calling runProtected('addAttachmentUrl', ...)", () => {
    const validationCallIndex = javaScriptHtml.indexOf("isSafeAttachmentUrl_(url)");
    const submitCallIndex = javaScriptHtml.indexOf(
      "runProtected(\n          'addAttachmentUrl'"
    );
    expect(validationCallIndex).toBeGreaterThan(-1);
    expect(submitCallIndex).toBeGreaterThan(-1);
    expect(validationCallIndex).toBeLessThan(submitCallIndex);
  });
});
