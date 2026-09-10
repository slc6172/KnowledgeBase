const fs = require("fs");
const path = require("path");

/**
 * Ticket 04(文章編輯器:精簡工具列 + 窄螢幕表單堆疊)。EasyMDE 工具列全平台
 * (桌面+手機)統一改成精簡過的自訂組合,移除雙欄預覽(side-by-side)、全螢幕
 * (fullscreen)、使用說明(guide),不依斷點動態切換、不重建編輯器實例。
 *
 * 編輯表單本身(.field 系列)已經是預設 block 版面、輸入框已經是
 * width: 100%,窄螢幕堆疊本來就已經滿足,這張票不需要額外改動,詳見 ticket
 * 檔案裡的驗收紀錄。
 */

describe("EasyMDE toolbar configuration (JavaScript.html)", () => {
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );

  function extractToolbarArray() {
    const match = javaScriptHtml.match(/toolbar:\s*(\[[\s\S]*?\])/);
    if (!match) return null;
    // eslint-disable-next-line no-eval
    return eval(match[1]);
  }

  test("initEasyMDE explicitly configures a toolbar (not left as the EasyMDE default)", () => {
    expect(javaScriptHtml).toMatch(/function initEasyMDE\s*\(\)\s*\{[\s\S]*?toolbar:\s*\[/);
  });

  test("the configured toolbar excludes side-by-side, fullscreen, and guide", () => {
    const toolbar = extractToolbarArray();
    expect(toolbar).not.toBeNull();
    expect(toolbar).not.toContain("side-by-side");
    expect(toolbar).not.toContain("fullscreen");
    expect(toolbar).not.toContain("guide");
  });

  test("the configured toolbar keeps the common formatting actions", () => {
    const toolbar = extractToolbarArray();
    ["bold", "italic", "heading", "quote", "link", "preview"].forEach((item) => {
      expect(toolbar).toContain(item);
    });
    // 清單至少留一種(有序或無序皆可,不強制兩種都留)
    expect(
      toolbar.includes("unordered-list") || toolbar.includes("ordered-list")
    ).toBe(true);
  });

  test("there is only one toolbar configuration (not a second one for a narrower breakpoint / rebuilt instance)", () => {
    const matches = javaScriptHtml.match(/toolbar:\s*\[/g) || [];
    expect(matches.length).toBe(1);
  });
});

describe("attachment file input stays a plain, unrestricted native picker (JavaScript.html)", () => {
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );

  test("the attachment file input has no accept/capture restriction narrowing mobile source selection", () => {
    const match = javaScriptHtml.match(/<input type="file"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match[0]).not.toMatch(/accept=/);
    expect(match[0]).not.toMatch(/capture=/);
  });
});

describe("editor form fields already stack on narrow screens (ArticleEditorView.html + Stylesheet.html)", () => {
  const editorView = fs.readFileSync(
    path.join(__dirname, "../src/ArticleEditorView.html"),
    "utf8"
  );
  const stylesheet = fs.readFileSync(
    path.join(__dirname, "../src/Stylesheet.html"),
    "utf8"
  );

  test("each form field is its own block-level .field container (no horizontal grouping to undo on narrow screens)", () => {
    const fieldCount = (editorView.match(/class="field"/g) || []).length;
    expect(fieldCount).toBeGreaterThanOrEqual(4);
  });

  test("text/select inputs inside .field are already full width", () => {
    expect(stylesheet).toMatch(
      /\.field input\[type="text"\],\s*\n\s*\.field select\s*\{[^}]*width:\s*100%;?[^}]*\}/
    );
  });
});
