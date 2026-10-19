// 上傳 GitHub 前的檔案狀態檢查:授權刻意留空、README 有實測紀錄、沒有密鑰殘留。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("授權維持留空(擁有者明確指示,不附加 LICENSE)", () => {
  test("package.json 沒有 license 欄位,且仍是 private", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg).not.toHaveProperty("license");
    expect(pkg.private).toBe(true);
  });

  test("專案根目錄沒有 LICENSE / LICENCE / COPYING 檔", () => {
    const names = fs.readdirSync(ROOT).map((n) => n.toUpperCase());
    expect(names.filter((n) => /^(LICEN[SC]E|COPYING)/.test(n))).toEqual([]);
  });

  test("README 授權段落維持「未附加 LICENSE」", () => {
    const readme = read("README.md");
    expect(readme.slice(readme.indexOf("## 授權"))).toMatch(/未附加 LICENSE/);
  });
});

describe("README 的實測紀錄", () => {
  const readme = read("README.md");

  test.each(["89.", "90.", "91.", "92."])("第 %s 條存在", (n) => {
    expect(readme).toMatch(new RegExp("^" + n.replace(".", "\\.") + " \\*\\*", "m"));
  });

  test("第 89 條記錄了實測結果與「大檔上傳尚未實測」", () => {
    const entry = readme.slice(readme.indexOf("89. **"), readme.indexOf("90. **"));
    expect(entry).toMatch(/401[\s\S]*403[\s\S]*200/);
    expect(entry).toMatch(/尚未實測:大檔上傳/);
  });

  test("第 92 條記錄了 RLS 不一致與補開,並說明 WARN 未處理", () => {
    const entry = readme.slice(readme.indexOf("92. **"), readme.indexOf("## 開發過程文件"));
    expect(entry).toMatch(/enable_rls_on_kb_tables/);
    expect(entry).toMatch(/search_path/);
  });
});

describe("版本號一致", () => {
  test("package.json 與 package-lock.json 的專案版本相同", () => {
    const pkg = JSON.parse(read("package.json"));
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
  });
});

describe("沒有真實密鑰殘留在可提交的檔案裡", () => {
  const SKIP = new Set(["node_modules", ".git", ".mycr"]);
  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  })(ROOT);

  test("有掃描到檔案", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  test("沒有長度像真的 sb_secret_ / sb_publishable_ 金鑰,也沒有 JWT 格式的金鑰", () => {
    const real = /sb_(secret|publishable)_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./;
    const hits = files.filter((f) => real.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
