// 文件靜態掃描:快速開始的順序、以及舊架構 / 升級敘事不殘留在「現行說明」裡。
// 為什麼要測文件:順序錯了(例如先推 GAS、後部署函式)會讓線上服務有空窗;
// 而過時的「請使用 Legacy service_role」敘述會誘導人照舊做法設定而失敗。
// 本專案的目標是「從無到有佈建」,不維護從舊版升級的步驟——所以這裡不再要求
// README 保留遷移章節,反而守住它不會回來。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

// 「現行說明」= 變更紀錄(歷史)之前的全部章節
const currentDocs = (readme) => readme.slice(0, readme.indexOf("## 已知問題修復紀錄"));

describe("README 快速開始:從無到有的部署順序", () => {
  const readme = read("README.md");
  const at = (needle) => readme.indexOf(needle);

  test("順序:建 Supabase → 部署並冒煙測試代理 → 才設定屬性並推送 GAS → 部署後驗收", () => {
    const supabase = at("### 1. 建立 Supabase 專案");
    const proxy = at("### 2. 部署 Edge Function 代理");
    const smoke = at("curl -s -o /dev/null");
    const gas = at("### 4. 部署到 Apps Script");
    const push = readme.indexOf("clasp push", gas); // 專案結構段落也提到 clasp push,要從步驟 4 之後找
    const accept = at("### 5. 部署後驗收");
    for (const idx of [supabase, proxy, smoke, gas, push, accept]) expect(idx).toBeGreaterThan(-1);
    expect(supabase).toBeLessThan(proxy);
    expect(proxy).toBeLessThan(smoke);
    expect(smoke).toBeLessThan(gas);
    expect(gas).toBeLessThan(push);
    expect(push).toBeLessThan(accept);
  });

  test("現行說明沒有「既有部署的遷移 / 升級步驟」,也不叫人設定 SUPABASE_SERVICE_ROLE_KEY", () => {
    const current = currentDocs(readme);
    expect(current).not.toMatch(/既有部署的遷移步驟/);
    expect(current).not.toMatch(/從「GAS 直連/);
    expect(current).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  test("部署後驗收提醒檢查 Advisors 與 bucket 必須是 private", () => {
    const section = readme.slice(at("### 5. 部署後驗收"), at("### 6. 重建段落向量"));
    expect(section).toMatch(/Advisors/);
    expect(section).toMatch(/不是 public/);
  });
});

describe("現行說明不再要求使用 service_role", () => {
  test("快速開始不再叫人複製 Legacy service_role key", () => {
    const readme = read("README.md");
    const quickStart = readme.slice(readme.indexOf("## 快速開始"), readme.indexOf("## 前端測試方式的說明"));
    expect(quickStart).not.toMatch(/一定要用 Legacy/);
    expect(quickStart).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY[^`]*`、`GEMINI/); // 舊的屬性清單
    expect(quickStart).toMatch(/EDGE_PROXY_SECRET/);
  });

  test("CLAUDE.md 不再有 service_role 直連的敘述,且已移除進行中的本 spec", () => {
    const claude = read("CLAUDE.md");
    expect(claude).not.toMatch(/service_role/);
    expect(claude).not.toMatch(/spec_edge_function_proxy/);
    expect(claude).toMatch(/kb-proxy/);
  });

  test("DESIGN 決策表有代理那一列,且架構圖含 Edge Function", () => {
    const design = read("docs/DESIGN.md");
    expect(design).toMatch(/^\| 17 \|/m);
    expect(design).toMatch(/Edge Function: kb-proxy/);
  });

  test("README 與文件不寫死測試總數", () => {
    const claude = read("CLAUDE.md");
    expect(claude).not.toMatch(/\d{3}\s*個測試/);
  });
});
