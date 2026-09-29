const fs = require("fs");
const path = require("path");

/**
 * Apps Script 的規則:專案裡所有沒有底線字首的頂層函式,一律自動暴露成
 * 用戶端可以直接呼叫的公開端點(google.script.run),跟這個函式有沒有被
 * 前端程式碼實際呼叫過無關。
 *
 * 這個測試原本是手動維護一份「應該私有的函式清單」,只檢查清單裡的每個
 * 函式有沒有帶底線——代表以後如果新增一個原本該私有卻忘記加底線的輔助
 * 函式,只要沒有人記得同步把它加進那份清單,這個測試不會自動抓到。
 * 2026-09 這輪 /mycr 複查換成窮舉式掃描:掃過 src/ 底下所有 .gs 檔案,
 * 抓出全部頂層函式宣告,只有在下面 PUBLIC_ALLOWLIST 裡的名字才允許不帶
 * 底線,其他一律要求帶底線——新增一個不帶底線的頂層函式,如果沒有同步
 * 把它加進這份允許清單,測試會直接失敗,不需要另外記得反過來維護一份
 * 「應該私有」的清單。
 */

const SRC_DIR = path.join(__dirname, "../src");

/**
 * 這份清單是「刻意設計成公開、可以被 google.script.run 直接呼叫」的頂層
 * 函式,每一個都要能對應到下面其中一種防護:
 * - Auth.gs 開頭列出的 11 個公開讀取函式(密碼門檻不適用,但有
 *   checkPublicReadRateLimit_ 節流)
 * - 密碼保護的兩個進入點:callProtected(內部用固定 switch 白名單 dispatch,
 *   不是動態函式查找)、askKnowledgeBase(密碼驗證在函式內部完成,不是靠
 *   底線擋)
 * - Apps Script Web App 固定進入點(doGet)、已有自己白名單保護的檔案讀取
 *   入口(include)、純回傳部署網址不含任何敏感資訊(getWebAppUrl)
 *
 * 新增任何一個不帶底線的頂層函式,都要先想清楚「這個真的應該讓任何人都能
 * 直接呼叫」、想清楚要套用上面哪一種防護,再加進這份清單——不能只是為了
 * 讓測試通過就加。
 */
const PUBLIC_ALLOWLIST = new Set([
  // Auth.gs 開頭列出的 11 個公開讀取函式
  "getArticle",
  "listArticles",
  "listAttachments",
  "listFolders",
  "getSignedAttachmentUrl",
  "getTextAttachmentContent",
  "listCategories",
  "listTags",
  "countTagUsage",
  "searchArticles",
  "getRelatedArticles",
  // 密碼保護的兩個進入點
  "callProtected",
  "askKnowledgeBase",
  // Web App 固定進入點 / 已有白名單保護 / 純回傳部署網址
  "doGet",
  "include",
  "getWebAppUrl"
]);

function extractTopLevelFunctionNames(source) {
  const names = [];
  const regex = /^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  let match;
  while ((match = regex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

const gsFiles = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".gs"));

const allTopLevelFunctions = gsFiles.flatMap((file) => {
  const source = fs.readFileSync(path.join(SRC_DIR, file), "utf8");
  return extractTopLevelFunctionNames(source).map((name) => [file, name]);
});

const exposedFunctions = allTopLevelFunctions.filter(([, name]) => !name.endsWith("_"));

describe("every non-underscore top-level .gs function is on the reviewed public allowlist", () => {
  test.each(exposedFunctions)(
    "%s: %s is exposed to google.script.run and must be an intentional, reviewed entry point",
    (file, name) => {
      expect(PUBLIC_ALLOWLIST.has(name)).toBe(true);
    }
  );

  test("PUBLIC_ALLOWLIST has no stale entries that no longer exist as exposed functions in src/", () => {
    // 反方向也要鎖住:清單裡如果留著一個早就被改成底線、或整個函式被刪掉的
    // 舊名字,代表清單本身沒有跟著程式碼同步更新,一樣是需要修正的落差。
    const declaredExposedNames = new Set(exposedFunctions.map(([, name]) => name));
    PUBLIC_ALLOWLIST.forEach((name) => {
      expect(declaredExposedNames.has(name)).toBe(true);
    });
  });

  test("sanity check: the scan actually found a non-trivial number of functions (guards against a broken regex silently matching nothing and making every test above vacuously pass)", () => {
    expect(allTopLevelFunctions.length).toBeGreaterThan(30);
    expect(exposedFunctions.length).toBeGreaterThan(10);
  });
});
