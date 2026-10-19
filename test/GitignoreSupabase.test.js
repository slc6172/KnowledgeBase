// .gitignore 必須擋住 Supabase CLI 與環境變數檔會產生的本地檔案。
// 為什麼:`supabase link` 會在 supabase/.temp/ 寫入專案 ref 與連線資訊;
// 本機若放 .env 存密鑰,一旦被 `git add -A` 帶進版控就等於外洩——
// 這個專案的設計目標正是「Supabase 與代理的密鑰都不進版控」。
const fs = require("fs");
const path = require("path");

const lines = fs
  .readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

describe(".gitignore 涵蓋 Supabase CLI 與環境變數檔", () => {
  test.each(["supabase/.temp/", "supabase/.branches/", ".env", ".env.*", "supabase/.env", "supabase/.env.*"])(
    "含有 %s",
    (entry) => {
      expect(lines).toContain(entry);
    }
  );

  test("沒有誤擋要提交的 Edge Function 原始碼與設定", () => {
    const wouldIgnoreAll = lines.some((l) => l === "supabase/" || l === "supabase" || l === "*.ts" || l === "*.toml");
    expect(wouldIgnoreAll).toBe(false);
  });

  test("沿用既有規則:.clasp.json 不進版控、.clasp.json.example 保留", () => {
    expect(lines).toContain(".clasp.json");
    expect(lines).not.toContain(".clasp.json.example");
  });
});
