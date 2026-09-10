const fs = require("fs");
const path = require("path");

/**
 * Ticket 05(分類/標籤管理頁窄螢幕堆疊)。節點列(.category-node__row /
 * .tag-node__row)在窄螢幕下允許自然換行,不做額外的收合選單或觸控優化
 * (依 Q1 定案:這兩個管理頁是低頻操作,「能用、允許直向堆疊即可」)。
 */

function extractMediaBlock(source, query) {
  const idx = source.indexOf(query);
  if (idx === -1) return null;
  const braceStart = source.indexOf("{", idx);
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

describe("category/tag manager row wrapping (Stylesheet.html)", () => {
  const stylesheet = fs.readFileSync(
    path.join(__dirname, "../src/Stylesheet.html"),
    "utf8"
  );
  const mobileBlock = extractMediaBlock(
    stylesheet,
    "@media (max-width: 767px)"
  );

  test("narrow-screen media query lets .category-node__row wrap instead of squeezing/overflowing", () => {
    expect(mobileBlock).toMatch(/\.category-node__row\s*\{[^}]*flex-wrap:\s*wrap;?[^}]*\}/);
  });

  test("narrow-screen media query lets .tag-node__row wrap instead of squeezing/overflowing", () => {
    expect(mobileBlock).toMatch(/\.tag-node__row\s*\{[^}]*flex-wrap:\s*wrap;?[^}]*\}/);
  });

  test("desktop baseline for these rows is untouched (still a plain flex row, no wrap forced there)", () => {
    expect(stylesheet).toMatch(/\.category-node__row\s*\{[^}]*display:\s*flex;?[^}]*\}/);
    expect(stylesheet).toMatch(/\.tag-node__row\s*\{[^}]*display:\s*flex;?[^}]*\}/);
  });
});

describe("category/tag row action logic is untouched (JavaScript.html)", () => {
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );

  test("rename/move/delete button classes for category nodes are untouched", () => {
    expect(javaScriptHtml).toMatch(/renameBtn\.className = 'btn category-node__action'/);
    expect(javaScriptHtml).toMatch(/moveBtn\.className = 'btn category-node__action'/);
    expect(javaScriptHtml).toMatch(/deleteBtn\.className = 'btn category-node__action category-node__delete'/);
  });
});
