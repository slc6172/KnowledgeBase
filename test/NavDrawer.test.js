const fs = require("fs");
const path = require("path");

/**
 * Ticket 01(響應式基礎建設與導覽抽屜)。窄螢幕(<768px)下,頂端導覽列的
 * 「新增文章/分類管理/標籤管理」收進漢堡選單開啟的側邊抽屜,抽屜額外多一個
 * 「文章列表」項目。桌面版型(>=768px)維持原本橫排導覽列。
 *
 * 前端沒有 DOM/google.script.run 測試接縫,延續既有的靜態文字掃描模式:
 * 直接讀 Stylesheet.html / Index.html / JavaScript.html 原始碼文字比對。
 */

function extractBraceBlock(source, startNeedle) {
  const startIdx = source.indexOf(startNeedle);
  if (startIdx === -1) return null;
  const braceStart = source.indexOf("{", startIdx);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

describe("768px breakpoint convention", () => {
  const stylesheet = fs.readFileSync(
    path.join(__dirname, "../src/Stylesheet.html"),
    "utf8"
  );

  test("Stylesheet.html defines a <768px narrow-screen media query", () => {
    expect(stylesheet).toMatch(/@media\s*\(max-width:\s*767px\)/);
  });
});

describe("hamburger menu + nav drawer markup (Index.html)", () => {
  const indexHtml = fs.readFileSync(
    path.join(__dirname, "../src/Index.html"),
    "utf8"
  );

  test("a hamburger toggle button exists using a hand-drawn inline SVG icon (not a unicode glyph)", () => {
    const toggleMatch = indexHtml.match(
      /<button[^>]*id="btn-nav-toggle"[\s\S]*?<\/button>/
    );
    expect(toggleMatch).not.toBeNull();
    expect(toggleMatch[0]).toMatch(/<svg[\s\S]*<\/svg>/);
  });

  test("the drawer contains the four expected items with '文章列表' first", () => {
    const ids = [
      "btn-drawer-article-list",
      "btn-drawer-new-article",
      "btn-drawer-category-manager",
      "btn-drawer-tag-manager",
    ];
    const indices = ids.map((id) => indexHtml.indexOf(id));
    indices.forEach((idx) => expect(idx).toBeGreaterThan(-1));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  test("the drawer's '文章列表' item is labelled correctly", () => {
    const match = indexHtml.match(
      /<button[^>]*id="btn-drawer-article-list"[^>]*>([\s\S]*?)<\/button>/
    );
    expect(match).not.toBeNull();
    expect(match[1]).toContain("文章列表");
  });

  test("btn-home (brand, existing home behaviour) is untouched", () => {
    expect(indexHtml).toMatch(/id="btn-home"/);
  });
});

describe("nav drawer open/close wiring (JavaScript.html)", () => {
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );

  test("openNavDrawer / closeNavDrawer are defined", () => {
    expect(javaScriptHtml).toMatch(/function openNavDrawer\s*\(/);
    expect(javaScriptHtml).toMatch(/function closeNavDrawer\s*\(/);
  });

  test("btn-nav-toggle opens the drawer, nav-drawer-overlay closes it", () => {
    expect(javaScriptHtml).toMatch(
      /getElementById\('btn-nav-toggle'\)\.addEventListener\('click',\s*openNavDrawer\)/
    );
    expect(javaScriptHtml).toMatch(
      /getElementById\('nav-drawer-overlay'\)\.addEventListener\('click',\s*closeNavDrawer\)/
    );
  });

  test("each of the four drawer items is wired to a click handler that also closes the drawer", () => {
    [
      "btn-drawer-article-list",
      "btn-drawer-new-article",
      "btn-drawer-category-manager",
      "btn-drawer-tag-manager",
    ].forEach((id) => {
      const handlerMatch = javaScriptHtml.match(
        new RegExp(
          "getElementById\\('" + id + "'\\)\\.addEventListener\\('click', function \\(\\) \\{([\\s\\S]*?)\\n  \\}\\);"
        )
      );
      expect(handlerMatch).not.toBeNull();
      expect(handlerMatch[1]).toMatch(/closeNavDrawer\(\)/);
    });
  });

  test("drawer's new-article/category-manager/tag-manager items reuse the same handler functions as the existing desktop buttons (no duplicated logic)", () => {
    expect(javaScriptHtml).toMatch(/function handleNewArticleClick_?\s*\(/);
    expect(javaScriptHtml).toMatch(/function handleCategoryManagerClick_?\s*\(/);
    expect(javaScriptHtml).toMatch(/function handleTagManagerClick_?\s*\(/);
  });
});
