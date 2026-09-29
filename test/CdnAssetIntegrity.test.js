const fs = require("fs");
const path = require("path");

/**
 * Index.html 載入的 5 個 CDN 資源(easymde/marked/dompurify/highlight.js,
 * highlight.js 另外還有一份 CSS)原本完全沒有版本鎖定、也沒有 SRI 完整性
 * 驗證——如果 jsdelivr 被 MITM,或這幾個套件的發布權限被盜、惡意版本被
 * 發布出來,會被默默套用到每個訪客身上,包含擁有者自己輸入寫入密碼的當下。
 * DOMPurify 又是整個專案唯一的 XSS 防線,风险更高。
 *
 * 修法是加一個 CDN_PIN_VERSIONS_ 開關:true 時鎖定版本號 + 用 integrity
 * 屬性驗證雜湊,false 時退回原本不鎖版本、不驗證的寫法(給刻意要檢查/升級
 * 版本時用,固定雜湊沒辦法配「一直變動的最新版」)。
 *
 * 這個測試不走 loadGas/HtmlService(GAS 樣板的 <? ?> 控制流程沒辦法在這個
 * Node 測試環境裡真的執行),直接讀原始碼文字做靜態檢查,確保:
 * 1. 開關本身存在,預設是 true(鎖定)。
 * 2. 鎖定分支裡,這 6 個資源全部有 integrity 屬性,格式正確。
 * 3. 未鎖定分支保留原本的、不鎖版本也不驗證的寫法(切換回去才不會因為
 *    雜湊對不上最新版而打不開網站)。
 */

describe("CDN asset pinning + SRI in Index.html", () => {
  const indexHtml = fs.readFileSync(
    path.join(__dirname, "../src/Index.html"),
    "utf8"
  );

  test("defines the CDN_PIN_VERSIONS_ toggle, defaulting to true (pinned + verified)", () => {
    expect(indexHtml).toMatch(/var\s+CDN_PIN_VERSIONS_\s*=\s*true\s*;/);
  });

  test("the pinned branch gives all 6 CDN assets a version number and a sha384 integrity hash", () => {
    const pinnedBranch = indexHtml.split("<? if (CDN_PIN_VERSIONS_) { ?>")[1].split("<? } else {")[0];
    const taggedUrls = pinnedBranch.match(/href="[^"]+"|src="[^"]+"/g) || [];

    expect(taggedUrls.length).toBe(6);
    taggedUrls.forEach((url) => {
      expect(url).toMatch(/@\d+\.\d+\.\d+\//); // 版本號寫死在網址裡
    });

    const integrityAttrs = pinnedBranch.match(/integrity="sha384-[A-Za-z0-9+/=]+"/g) || [];
    expect(integrityAttrs.length).toBe(6);
  });

  test("the unpinned (update-checking) branch has no version pin and no integrity hash, so it can follow jsdelivr's latest build", () => {
    const unpinnedBranch = indexHtml.split("<? } else { ?>")[1].split("<? } ?>")[0];

    expect(unpinnedBranch).not.toMatch(/integrity=/);
    expect(unpinnedBranch).not.toMatch(/@\d+\.\d+\.\d+\//);
    // 但還是同樣 4 套函式庫、同樣 6 個資源,不是切換時漏東西。
    expect((unpinnedBranch.match(/href="[^"]+"|src="[^"]+"/g) || []).length).toBe(6);
  });
});
