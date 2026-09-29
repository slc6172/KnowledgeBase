function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = trimProp_(props.getProperty('SUPABASE_URL'));
  if (!supabaseUrl) {
    throw new Error('缺少 Script Property: SUPABASE_URL');
  }
  var serviceRoleKey = trimProp_(props.getProperty('SUPABASE_SERVICE_ROLE_KEY'));
  if (!serviceRoleKey) {
    throw new Error('缺少 Script Property: SUPABASE_SERVICE_ROLE_KEY');
  }
  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    serviceRoleKey: serviceRoleKey,
    geminiApiKey: trimProp_(props.getProperty('GEMINI_API_KEY'))
  };
}

/**
 * 從 Script Properties 讀出來的值去頭尾空白/換行——複製貼上金鑰時很容易不小心
 * 多帶一個換行或空格,這種情況送出去的 Authorization header 會是錯的值,
 * Supabase 那邊會認不出是 service_role,進而退回成類似 anon 的權限,
 * 導致 Storage 這種預設就有 RLS 保護的服務出現「new row violates row-level
 * security policy」這種讓人摸不著頭緒的錯誤。
 */
function trimProp_(value) {
  return value ? value.trim() : value;
}

/**
 * 診斷用:只印金鑰的長度跟頭尾幾個字元,不會把完整金鑰印出來,可以放心貼給
 * 別人看或截圖求助,不會洩漏金鑰本身。
 *
 * 用來確認:
 * 1. 金鑰有沒有讀到(長度不是 0)
 * 2. 讀到的是不是「看起來像」service_role/secret key,而不是 anon/publishable
 *    key(service_role 的舊版格式開頭通常是 eyJ...,新版格式開頭是
 *    sb_secret_...;如果你看到開頭是 sb_publishable_ 或很短的字串,就代表貼錯
 *    金鑰了)
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

function debugConfig_() {
  var config = getConfig_();
  function preview(value) {
    if (!value) return '(空)';
    if (value.length <= 12) return value.length + ' 字元(太短,可能貼錯了)';
    return value.length + ' 字元,開頭 "' + value.slice(0, 8) +
      '...",結尾 "...' + value.slice(-4) + '"';
  }
  Logger.log('SUPABASE_URL: ' + config.supabaseUrl);
  Logger.log('SUPABASE_SERVICE_ROLE_KEY: ' + preview(config.serviceRoleKey));
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
    debugConfig_: debugConfig_
  };
}
