/**
 * 模擬 Apps Script 的單一共用全域命名空間:
 * require 一個 .gs 檔案,把它 export 出來的每個函式掛到 Node 的 global 物件上,
 * 這樣其他 .gs 檔案裡對這些函式的「裸識別字」呼叫(在真正的 Apps Script 裡本來就是
 * 呼叫同一個全域命名空間下的函式)才能在測試環境下正確解析、也才能在測試裡被替換掉。
 */
function loadGas(relPathFromHelpers) {
  const exported = require(relPathFromHelpers);
  Object.assign(global, exported);
  return exported;
}
module.exports = { loadGas };
