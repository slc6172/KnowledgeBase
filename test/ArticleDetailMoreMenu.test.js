const fs = require("fs");
const path = require("path");

/**
 * Ticket 03(文章詳情頁:更多選單 + 內容/附件 responsive)。窄螢幕(<768px)
 * 下「編輯」常駐顯示,「分享」「刪除」收進由「更多」按鈕開啟、重用 Ticket 02
 * 那套「由下滑入面板」模式的選單。桌面版型(>=768px)三顆按鈕維持原本橫排,
 * 順序不變(分享、編輯、刪除),用 flex order 保證即使 DOM 結構因為窄螢幕
 * 需要重新分組,桌面視覺順序仍跟改動前一致。
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

describe("detail more-menu CSS (Stylesheet.html)", () => {
  const stylesheet = fs.readFileSync(
    path.join(__dirname, "../src/Stylesheet.html"),
    "utf8"
  );
  const mobileBlock = extractMediaBlock(
    stylesheet,
    "@media (max-width: 767px)"
  );

  test("desktop baseline: .detail-more-menu uses display: contents (doesn't change desktop layout)", () => {
    expect(stylesheet).toMatch(/\.detail-more-menu\s*\{[^}]*display:\s*contents;?[^}]*\}/);
  });

  test("desktop button order is pinned via flex order so 分享/編輯/刪除 stay in their original order regardless of DOM grouping", () => {
    expect(stylesheet).toMatch(/#btn-share-article\s*\{[^}]*order:\s*1;?[^}]*\}/);
    expect(stylesheet).toMatch(/#btn-edit-article\s*\{[^}]*order:\s*2;?[^}]*\}/);
    expect(stylesheet).toMatch(/#btn-delete-article\s*\{[^}]*order:\s*3;?[^}]*\}/);
  });

  test("narrow-screen media query turns .detail-more-menu into a fixed bottom sheet, hidden until .is-open", () => {
    expect(mobileBlock).toMatch(/\.detail-more-menu\s*\{[^}]*position:\s*fixed;?[^}]*\}/);
    expect(mobileBlock).toMatch(/\.detail-more-menu\.is-open\s*\{[^}]*display:\s*flex;?[^}]*\}/);
  });

  test("narrow-screen media query shows the more-menu trigger button", () => {
    expect(mobileBlock).toMatch(/#btn-detail-more\s*\{[^}]*display:/);
  });

  test("narrow-screen media query gives the attachment preview iframe a viewport-relative height instead of the fixed 520px", () => {
    expect(mobileBlock).toMatch(/\.attachment-preview__frame\s*\{[^}]*height:\s*\d+vh;?[^}]*\}/);
  });
});

describe("detail more-menu markup (ArticleDetailView.html)", () => {
  const detailView = fs.readFileSync(
    path.join(__dirname, "../src/ArticleDetailView.html"),
    "utf8"
  );

  test("編輯 stays outside the more-menu (always visible)", () => {
    const editIdx = detailView.indexOf('id="btn-edit-article"');
    const menuIdx = detailView.indexOf('id="detail-more-menu"');
    expect(editIdx).toBeGreaterThan(-1);
    expect(editIdx).toBeLessThan(menuIdx);
  });

  test("分享/刪除 are nested inside #detail-more-menu", () => {
    const menuIdx = detailView.indexOf('id="detail-more-menu"');
    const overlayIdx = detailView.indexOf('id="detail-more-menu-overlay"');
    const shareIdx = detailView.indexOf('id="btn-share-article"');
    const deleteIdx = detailView.indexOf('id="btn-delete-article"');
    [shareIdx, deleteIdx].forEach((idx) => {
      expect(idx).toBeGreaterThan(menuIdx);
    });
    expect(shareIdx).toBeLessThan(deleteIdx);
    // overlay is a sibling markup, not necessarily after both items, but must exist
    expect(overlayIdx).toBeGreaterThan(-1);
  });

  test("a more-menu trigger button with an inline SVG icon exists", () => {
    const match = detailView.match(
      /<button[^>]*id="btn-detail-more"[\s\S]*?<\/button>/
    );
    expect(match).not.toBeNull();
    expect(match[0]).toMatch(/<svg[\s\S]*<\/svg>/);
  });

  test("the more-menu overlay reuses the shared drawer-overlay component", () => {
    expect(detailView).toMatch(
      /<div[^>]*id="detail-more-menu-overlay"[^>]*class="drawer-overlay hidden"/
    );
  });
});

describe("detail more-menu open/close wiring (JavaScript.html)", () => {
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );

  test("openDetailMoreMenu / closeDetailMoreMenu are defined", () => {
    expect(javaScriptHtml).toMatch(/function openDetailMoreMenu\s*\(/);
    expect(javaScriptHtml).toMatch(/function closeDetailMoreMenu\s*\(/);
  });

  test("btn-detail-more opens the menu, detail-more-menu-overlay closes it", () => {
    expect(javaScriptHtml).toMatch(
      /getElementById\('btn-detail-more'\)\.addEventListener\('click',\s*openDetailMoreMenu\)/
    );
    expect(javaScriptHtml).toMatch(
      /getElementById\('detail-more-menu-overlay'\)\.addEventListener\('click',\s*closeDetailMoreMenu\)/
    );
  });

  test("existing share/edit/delete click handlers are untouched", () => {
    expect(javaScriptHtml).toMatch(
      /getElementById\('btn-share-article'\)\.addEventListener\('click', function \(\) \{/
    );
    expect(javaScriptHtml).toMatch(
      /getElementById\('btn-edit-article'\)\.addEventListener\('click', function \(\) \{/
    );
    expect(javaScriptHtml).toMatch(
      /getElementById\('btn-delete-article'\)\.addEventListener\('click', function \(\) \{/
    );
  });

  test("clicking 分享 or 刪除 also closes the more-menu (not just the overlay)", () => {
    const shareHandler = javaScriptHtml.match(
      /getElementById\('btn-share-article'\)\.addEventListener\('click', function \(\) \{([\s\S]*?)\n {2}\}\);/
    );
    const deleteHandler = javaScriptHtml.match(
      /getElementById\('btn-delete-article'\)\.addEventListener\('click', function \(\) \{([\s\S]*?)\n {2}\}\);/
    );
    expect(shareHandler).not.toBeNull();
    expect(deleteHandler).not.toBeNull();
    expect(shareHandler[1]).toMatch(/closeDetailMoreMenu\(\)/);
    expect(deleteHandler[1]).toMatch(/closeDetailMoreMenu\(\)/);
  });

  test("the share-visibility toggle (published-only) is untouched", () => {
    expect(javaScriptHtml).toMatch(
      /getElementById\('btn-share-article'\)\.classList\.toggle\(\s*\n?\s*'hidden', article\.status !== 'published'\s*\n?\s*\)/
    );
  });
});
