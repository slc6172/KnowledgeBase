const fs = require("fs");
const path = require("path");

/**
 * 視覺淡雅化票(docs/tickets/visual-design-refresh/issues/01-color-tokens-and-
 * button-hierarchy.md)。色彩 token 微調、標籤中性化、按鈕視覺層級——這些全部
 * 是全站共用的 token/class,不需要逐畫面套用,一次改完就是完整的驗收單位。
 */

function extractRule(source, selector) {
  const idx = source.indexOf(selector);
  if (idx === -1) return null;
  const braceStart = source.indexOf("{", idx);
  if (braceStart === -1 || braceStart - idx > selector.length + 10) return null;
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

describe("color token adjustments (Stylesheet.html)", () => {
  const stylesheet = fs.readFileSync(
    path.join(__dirname, "../src/Stylesheet.html"),
    "utf8"
  );
  const rootBlock = extractRule(stylesheet, ":root");

  test("core tokens are adjusted to the lighter/less-saturated values", () => {
    expect(rootBlock).toMatch(/--color-primary:\s*#4F6F60;/);
    expect(rootBlock).toMatch(/--color-accent:\s*#BFA06A;/);
    expect(rootBlock).toMatch(/--color-ink-muted:\s*#7A766E;/);
    expect(rootBlock).toMatch(/--color-border:\s*#EAE6DD;/);
  });

  test("--color-bg is untouched (already light enough)", () => {
    expect(rootBlock).toMatch(/--color-bg:\s*#F6F4F0;/);
  });

  test("new on-color semantic tokens are defined", () => {
    expect(rootBlock).toMatch(/--color-on-primary:\s*#[0-9A-Fa-f]{6};/);
    expect(rootBlock).toMatch(/--color-on-accent:\s*#[0-9A-Fa-f]{6};/);
    expect(rootBlock).toMatch(/--color-on-danger:\s*#[0-9A-Fa-f]{6};/);
  });

  test("the one previously-hardcoded white text now uses the on-primary token", () => {
    const btnPrimaryRule = extractRule(stylesheet, ".btn-primary {");
    expect(btnPrimaryRule).not.toBeNull();
    expect(btnPrimaryRule).toMatch(/color:\s*var\(--color-on-primary\);?/);
    expect(btnPrimaryRule).not.toMatch(/#FFFFFF/);
  });

  test("no stray hardcoded hex colors remain outside :root (each hex value defined only once, in :root)", () => {
    const hexValues = stylesheet.match(/#[0-9A-Fa-f]{6}\b/g) || [];
    const rootBlockHexCount = (rootBlock.match(/#[0-9A-Fa-f]{6}\b/g) || []).length;
    // 每個 hex 值只應該在 :root 出現過一次(token 定義本身),樣式表其他地方
    // 一律透過 var() 引用,不應該再看到任何 hex literal。
    expect(hexValues.length).toBe(rootBlockHexCount);
  });
});

describe("tag neutralization (Stylesheet.html)", () => {
  const stylesheet = fs.readFileSync(
    path.join(__dirname, "../src/Stylesheet.html"),
    "utf8"
  );

  test(".tag no longer uses accent color, uses neutral border/ink-muted tokens instead", () => {
    const tagRule = extractRule(stylesheet, ".tag {");
    expect(tagRule).not.toBeNull();
    expect(tagRule).toMatch(/background:\s*var\(--color-border\);?/);
    expect(tagRule).toMatch(/color:\s*var\(--color-ink-muted\);?/);
    expect(tagRule).not.toMatch(/--color-accent/);
  });
});

describe("lightweight tinted button style (Stylesheet.html)", () => {
  const stylesheet = fs.readFileSync(
    path.join(__dirname, "../src/Stylesheet.html"),
    "utf8"
  );

  test(".btn-tinted is defined using the soft primary background, not a solid fill", () => {
    const rule = extractRule(stylesheet, ".btn-tinted {");
    expect(rule).not.toBeNull();
    expect(rule).toMatch(/background:\s*var\(--color-primary-soft\);?/);
    expect(rule).toMatch(/color:\s*var\(--color-primary\);?/);
  });
});

describe("button reclassification: operational buttons downgraded to .btn-tinted", () => {
  const listView = fs.readFileSync(
    path.join(__dirname, "../src/ArticleListView.html"),
    "utf8"
  );
  const categoryView = fs.readFileSync(
    path.join(__dirname, "../src/CategoryManagerView.html"),
    "utf8"
  );
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );

  test("btn-search uses btn-tinted, not btn-primary", () => {
    expect(listView).toMatch(/id="btn-search" class="btn btn-tinted"/);
    expect(listView).not.toMatch(/id="btn-search" class="btn btn-primary"/);
  });

  test("btn-add-top-category uses btn-tinted, not btn-primary", () => {
    expect(categoryView).toMatch(/id="btn-add-top-category" class="btn btn-tinted"/);
    expect(categoryView).not.toMatch(/id="btn-add-top-category" class="btn btn-primary"/);
  });

  test("dynamically-created category/tag inline confirm buttons use btn-tinted, not btn-primary", () => {
    expect(javaScriptHtml).not.toMatch(/className = 'btn btn-primary category-node__action'/);
    expect(javaScriptHtml).not.toMatch(/className = 'btn btn-primary tag-node__action'/);
    expect(
      (javaScriptHtml.match(/className = 'btn btn-tinted category-node__action'/g) || []).length
    ).toBe(3);
    expect(
      (javaScriptHtml.match(/className = 'btn btn-tinted tag-node__action'/g) || []).length
    ).toBe(2);
  });
});

describe("key actions keep .btn-primary (regression guard, not touched by this ticket)", () => {
  test("btn-publish stays btn-primary", () => {
    const editorView = fs.readFileSync(
      path.join(__dirname, "../src/ArticleEditorView.html"),
      "utf8"
    );
    expect(editorView).toMatch(/id="btn-publish" class="btn btn-primary"/);
  });

  test("btn-new-article stays btn-primary", () => {
    const indexHtml = fs.readFileSync(
      path.join(__dirname, "../src/Index.html"),
      "utf8"
    );
    expect(indexHtml).toMatch(/id="btn-new-article" class="btn btn-primary"/);
  });

  test("btn-article-not-found-home stays btn-primary", () => {
    const notFoundView = fs.readFileSync(
      path.join(__dirname, "../src/ArticleNotFoundView.html"),
      "utf8"
    );
    expect(notFoundView).toMatch(/id="btn-article-not-found-home" class="btn btn-primary"/);
  });

  test("seal (status badge) color rules are untouched", () => {
    const stylesheet = fs.readFileSync(
      path.join(__dirname, "../src/Stylesheet.html"),
      "utf8"
    );
    expect(stylesheet).toMatch(/\.seal--published\s*\{\s*color:\s*var\(--color-primary\);?\s*\}/);
  });

  test(".btn-danger color rules are untouched", () => {
    const stylesheet = fs.readFileSync(
      path.join(__dirname, "../src/Stylesheet.html"),
      "utf8"
    );
    expect(stylesheet).toMatch(/\.btn-danger\s*\{\s*color:\s*var\(--color-danger\);?/);
  });
});
