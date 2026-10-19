function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = trimProp_(props.getProperty('SUPABASE_URL'));
  if (!supabaseUrl) {
    throw new Error('缺少 Script Property: SUPABASE_URL');
  }
  // X-KB-Proxy-Secret 會隨每個請求送往這個網址;若誤填成 http://,密鑰會以明文
  // 在網路上傳送。錯誤訊息只點名屬性,不回顯任何值。
  if (!/^https:\/\//i.test(supabaseUrl)) {
    throw new Error('Script Property SUPABASE_URL 必須以 https:// 開頭');
  }
  var edgeProxySecret = trimProp_(props.getProperty('EDGE_PROXY_SECRET'));
  if (!edgeProxySecret) {
    throw new Error('缺少 Script Property: EDGE_PROXY_SECRET');
  }
  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    edgeProxySecret: edgeProxySecret,
    geminiApiKey: trimProp_(props.getProperty('GEMINI_API_KEY'))
  };
}

/**
 * 組出代理網址:專案的 Edge Functions 端點 + kb-proxy + 上游路徑(必須以
 * rest/v1/ 或 storage/v1/ 開頭)。由既有的 SUPABASE_URL 推得,不新增網址屬性。
 */
function proxyUrl_(config, upstreamPath) {
  return config.supabaseUrl + '/functions/v1/kb-proxy/' + upstreamPath;
}

/**
 * 從 Script Properties 讀出來的值去頭尾空白/換行——複製貼上共用密鑰時很容易不小心
 * 多帶一個換行或空格,送出去的 X-KB-Proxy-Secret 就會跟代理端的值對不上,
 * 代理會回 401,看起來像「兩端密鑰不一致」但其實只是多了一個看不見的字元。
 */
function trimProp_(value) {
  return value ? value.trim() : value;
}

/**
 * 診斷用(下面 debugConfig_ 的說明):
 * - SUPABASE_URL、GEMINI_API_KEY:印長度跟頭尾幾個字元,可以放心貼給別人看或截圖求助。
 * - EDGE_PROXY_SECRET 與 WRITE_PASSWORD:只印長度與過短警告,絕不印任何片段。
 *
 * 函式名稱刻意帶底線字首,不會出現在 Apps Script 編輯器「選取要執行的函式」
 * 下拉選單裡,也不會被任何頁面載入時就能呼叫——這是刻意的,避免變成不需要
 * 密碼就能觸發的公開端點。要手動執行的話,暫時把底線拿掉存檔、在編輯器選這個
 * 函式執行、看完「執行紀錄」的輸出後再把底線加回來存檔。
 */
/**
 * 密碼強度建議下限——只是給 debugConfig_ 印警告用的參考值,不是硬性擋下
 * 過短密碼的門檻(mycr F-05 修正:這裡刻意選擇「診斷時提醒」而不是「執行期
 * 強制擋下」,因為 getWritePassword_ 在每次寫入請求都會被呼叫,如果在那裡
 * 加上強制長度檢查,任何已經部署、密碼設得比較短的既有環境,這次更新一上線
 * 就會直接把擁有者自己鎖在外面——診斷工具是擁有者自己選擇執行時才會看到,
 * 不會有這個風險,足以達到「提醒擁有者密碼夠不夠長」這個目的)。
 */
var WRITE_PASSWORD_RECOMMENDED_MIN_LENGTH_ = 12;

// 代理共用密鑰建議下限(至少 32 bytes 隨機值);同樣只在診斷時提醒,不在執行期擋下。
var EDGE_PROXY_SECRET_RECOMMENDED_MIN_LENGTH_ = 32;

function debugConfig_() {
  var config = getConfig_();
  function preview(value) {
    if (!value) return '(空)';
    if (value.length <= 12) return value.length + ' 字元(太短,可能貼錯了)';
    return value.length + ' 字元,開頭 "' + value.slice(0, 8) +
      '...",結尾 "...' + value.slice(-4) + '"';
  }
  Logger.log('SUPABASE_URL: ' + config.supabaseUrl);

  // 共用密鑰比照寫入密碼的慣例:只印長度與過短警告,絕不印任何片段。
  // 它是 GAS 與代理之間唯一的憑證,洩漏開頭/結尾幾個字元也會降低被猜中的難度,
  // 跟上面 preview() 印一小段的做法刻意不同。
  var secretLine = 'EDGE_PROXY_SECRET: 已設定,' + config.edgeProxySecret.length + ' 字元';
  if (config.edgeProxySecret.length < EDGE_PROXY_SECRET_RECOMMENDED_MIN_LENGTH_) {
    secretLine +=
      '(建議至少 ' + EDGE_PROXY_SECRET_RECOMMENDED_MIN_LENGTH_ +
      ' 字元的隨機值,例如 64 個十六進位字元——共用密鑰過短容易被暴力猜中)';
  }
  Logger.log(secretLine);
  Logger.log('GEMINI_API_KEY: ' + preview(config.geminiApiKey));

  // 只印長度跟是否過短的警告,絕對不印密碼本身的任何片段——密碼的熵比 API
  // 金鑰低,就算只洩漏開頭/結尾幾個字元,對「可能被猜中」的風險影響也比
  // 金鑰大得多,跟上面 preview() 印一小段的做法刻意不一樣。
  var writePassword = getWritePassword_();
  var writePasswordLine = 'WRITE_PASSWORD: 已設定,' + writePassword.length + ' 字元';
  if (writePassword.length < WRITE_PASSWORD_RECOMMENDED_MIN_LENGTH_) {
    writePasswordLine +=
      '(建議至少 ' + WRITE_PASSWORD_RECOMMENDED_MIN_LENGTH_ +
      ' 字元,太短容易被暴力猜中——鎖定機制不是無限強的保護,密碼本身夠長還是重要的第一道防線)';
  }
  Logger.log(writePasswordLine);
}

if (typeof module !== 'undefined') {
  module.exports = {
    getConfig_: getConfig_,
    proxyUrl_: proxyUrl_,
    debugConfig_: debugConfig_
  };
}
