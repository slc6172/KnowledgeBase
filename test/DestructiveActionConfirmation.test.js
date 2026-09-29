const fs = require("fs");
const path = require("path");

/**
 * bug fix(2026-09,逐行語意校對找出來的):分類刪除(deleteCategory)原本是
 * 唯一一個「一鍵刪除」動作、點下去沒有先跳 window.confirm() 就直接送出的——
 * 文章(deleteArticle)、附件資料夾(deleteFolder)、標籤(deleteTag)這三個
 * 同樣是一鍵刪除的動作都有。不是刻意的設計(對照「移動分類」/「合併標籤」
 * 那種要先選目標、按「確定」才送出的兩段式互動,那兩個沒有另外疊加
 * confirm() 才是刻意的,靠兩段式互動本身的操作摩擦力取代 confirm(),這個
 * 測試不涵蓋那兩個)。
 *
 * 比照專案既有的前端測試方式(靜態文字掃描原始碼,不做真的 DOM 行為模擬):
 * 對每一個一鍵刪除動作,確認在它真正送出刪除請求(runProtected('deleteX', ...))
 * 的前面一段範圍內,確實出現了 window.confirm(——不是完美的控制流程驗證,
 * 但足以在以後有人不小心把 confirm 拿掉、或複製貼上漏掉時失敗。
 */
describe("every one-click delete action shows window.confirm() before actually deleting (JavaScript.html)", () => {
  const javaScriptHtml = fs.readFileSync(
    path.join(__dirname, "../src/JavaScript.html"),
    "utf8"
  );

  function textBefore(marker, windowSize) {
    const index = javaScriptHtml.indexOf(marker);
    expect(index).toBeGreaterThan(-1);
    return javaScriptHtml.slice(Math.max(0, index - windowSize), index);
  }

  test.each([
    ["deleteArticle", "runProtected(\n      'deleteArticle'", 800],
    ["deleteFolder", "runProtected('deleteFolder'", 800],
    ["deleteTag", "runProtected(\n            'deleteTag'", 800]
  ])("%s is gated by window.confirm( before the runProtected(...) call", (name, marker, windowSize) => {
    expect(textBefore(marker, windowSize)).toEqual(expect.stringContaining("window.confirm("));
  });

  test("deleteCategory: the click handler confirms before calling deleteCategoryNode(...) (the function that actually calls runProtected('deleteCategory', ...) is declared later in the file — hoisted — so the confirm lives at the call site, not right before the runProtected call itself)", () => {
    expect(textBefore("deleteCategoryNode(category.id);", 800)).toEqual(
      expect.stringContaining("window.confirm(")
    );
    // deleteCategoryNode 本身只有這一個呼叫點——如果以後有第二個呼叫點繞過
    // 這道 confirm 直接呼叫它,這裡要能發現。
    const callSites = javaScriptHtml.match(/deleteCategoryNode\(/g) || [];
    expect(callSites.length).toBe(2); // 1 次呼叫 + 1 次 function 宣告本身
  });
});
