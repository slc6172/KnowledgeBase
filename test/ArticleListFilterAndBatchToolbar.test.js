const fs = require("fs");
const path = require("path");

/**
 * Ticket 02(文章列表:搜尋/篩選面板 + 批次工具列貼底)。窄螢幕(<768px)下,
 * 狀態/分類/標籤三個篩選欄位收進一個由「篩選」按鈕開啟、從螢幕底部滑入的
 * 面板;搜尋框跟「選取」按鈕維持常駐。批次工具列在窄螢幕貼底固定。
 *
 * 桌面版型(>=768px)必須維持原本橫排、`display: contents` 讓 filter-panel
 * 這個新增的包裹容器在盒模型上「消失」,子元素直接變成 .search-bar 的 flex
 * item,版面不變。
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

describe("filter panel CSS (Stylesheet.html)", () => {
  const stylesheet = fs.readFileSync(
    path.join(__dirname, "../src/Stylesheet.html"),
    "utf8"
  );
  const mobileBlock = extractMediaBlock(
    stylesheet,
    "@media (max-width: 767px)"
  );

  test("desktop baseline: .filter-panel uses display: contents so it doesn't change the desktop flex row", () => {
    expect(stylesheet).toMatch(/\.filter-panel\s*\{[^}]*display:\s*contents;?[^}]*\}/);
  });

  test("narrow-screen media query overrides .filter-panel into a fixed bottom sheet, hidden until .is-open", () => {
    expect(mobileBlock).not.toBeNull();
    expect(mobileBlock).toMatch(/\.filter-panel\s*\{[^}]*position:\s*fixed;?[^}]*\}/);
    expect(mobileBlock).toMatch(/\.filter-panel\.is-open\s*\{[^}]*display:\s*flex;?[^}]*\}/);
  });

  test("narrow-screen media query shows the filter trigger button", () => {
    expect(mobileBlock).toMatch(/#btn-open-filter-panel\s*\{[^}]*display:/);
  });

  test("narrow-screen media query docks the batch toolbar to the bottom of the screen", () => {
    expect(mobileBlock).toMatch(/\.batch-toolbar\s*\{[^}]*position:\s*fixed;?[\s\S]*?bottom:\s*0;?[^}]*\}/);
  });
});

describe("filter panel markup (ArticleListView.html)", () => {
  const listView = fs.readFileSync(
    path.join(__dirname, "../src/ArticleListView.html"),
    "utf8"
  );

  test("status/category/tag filters are nested inside #filter-panel, between it and the search button", () => {
    const panelIdx = listView.indexOf('id="filter-panel"');
    const searchBtnIdx = listView.indexOf('id="btn-search"');
    const statusIdx = listView.indexOf('id="list-status-filter"');
    const categoryIdx = listView.indexOf('id="list-category-filter"');
    const tagIdx = listView.indexOf('id="list-tag-filter-container"');

    expect(panelIdx).toBeGreaterThan(-1);
    [statusIdx, categoryIdx, tagIdx].forEach((idx) => {
      expect(idx).toBeGreaterThan(panelIdx);
      expect(idx).toBeLessThan(searchBtnIdx);
    });
  });

  test("a filter trigger button with an inline SVG icon exists", () => {
    const match = listView.match(
      /<button[^>]*id="btn-open-filter-panel"[\s\S]*?<\/button>/
    );
    expect(match).not.toBeNull();
    expect(match[0]).toMatch(/<svg[\s\S]*<\/svg>/);
  });

  test("a filter-panel overlay exists, reusing the shared drawer-overlay component", () => {
    expect(listView).toMatch(
      /<div[^>]*id="filter-panel-overlay"[^>]*class="drawer-overlay hidden"/
    );
  });

  test("the search input and select-mode button stay outside the filter panel (not collapsed into it)", () => {
    const panelIdx = listView.indexOf('id="filter-panel"');
    const searchInputIdx = listView.indexOf('id="search-input"');
    const selectModeIdx = listView.indexOf('id="btn-select-mode"');
    expect(searchInputIdx).toBeGreaterThan(-1);
    expect(searchInputIdx).toBeLessThan(panelIdx);
    expect(selectModeIdx).toBeGreaterThan(panelIdx);
  });
});

describe("filter panel open/close wiring (JavaScript.html)", () => {
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );

  test("openFilterPanel / closeFilterPanel are defined", () => {
    expect(javaScriptHtml).toMatch(/function openFilterPanel\s*\(/);
    expect(javaScriptHtml).toMatch(/function closeFilterPanel\s*\(/);
  });

  test("btn-open-filter-panel opens the panel, filter-panel-overlay closes it", () => {
    expect(javaScriptHtml).toMatch(
      /getElementById\('btn-open-filter-panel'\)\.addEventListener\('click',\s*openFilterPanel\)/
    );
    expect(javaScriptHtml).toMatch(
      /getElementById\('filter-panel-overlay'\)\.addEventListener\('click',\s*closeFilterPanel\)/
    );
  });

  test("existing filter behaviour (auto re-search on status/category change) is untouched", () => {
    expect(javaScriptHtml).toMatch(
      /getElementById\('list-status-filter'\)\.addEventListener\('change'/
    );
    expect(javaScriptHtml).toMatch(
      /getElementById\('list-category-filter'\)\.addEventListener\('change'/
    );
  });
});
