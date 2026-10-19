// 靜態掃描:GAS 原始碼不得再出現 service_role 相關字樣。
// 為什麼:遷移到 Edge Function 代理後,GAS 不再持有 Supabase 萬能金鑰;
// 這個測試確保舊路徑不會被遺留、或日後不小心復活(連註解殘留也一併擋下,
// 因為過時的註解會讓人誤以為 GAS 仍需要該金鑰)。
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const FORBIDDEN = /service[_-]?role/i;

describe("GAS 原始碼不再出現 service_role", () => {
  const files = fs.readdirSync(SRC).filter((f) => /\.(gs|html|json)$/.test(f));

  test("有掃描到檔案(避免因為沒資料而空轉)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test.each(files)("%s 不含 service_role / SERVICE_ROLE / serviceRoleKey", (file) => {
    const text = fs.readFileSync(path.join(SRC, file), "utf8");
    expect(text).not.toMatch(FORBIDDEN);
  });

  test("Config.gs 也不再讀取 SUPABASE_SERVICE_ROLE_KEY 這個屬性", () => {
    const text = fs.readFileSync(path.join(SRC, "Config.gs"), "utf8");
    expect(text).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(text).toMatch(/EDGE_PROXY_SECRET/);
  });
});
