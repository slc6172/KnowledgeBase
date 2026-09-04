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
}

/**
 * 一次性執行:把下面的預留字串換成真正的值後執行一次,把金鑰跟寫入密碼寫進
 * Script Properties。執行完可以把這個函式內容清掉或留著,值不會出現在原始碼
 * 版本以外的地方,也不會傳到瀏覽器。
 * WRITE_PASSWORD 是共用密碼(見 Auth.gs 的 callProtected)——寫入類操作(建立/
 * 編輯/刪除文章、附件、分類)都需要它,讀取類操作不受影響。
 *
 * 函式名稱刻意帶底線字首,原因跟理由都同 debugConfig_ 上面的說明:不會出現在
 * 編輯器的函式下拉選單、也不會被任何頁面載入時就能呼叫。要執行這個一次性設定,
 * 一樣是暫時把底線拿掉存檔、在編輯器選這個函式執行、跑完後把底線加回來存檔——
 * 這樣可以避免它變成任何呼叫端都能觸發的端點(觸發後果是整個 app 連密碼帶
 * 金鑰一起被重設成這裡寫死的預留字串)。
 */
function setupScriptProperties_() {
  var props = PropertiesService.getScriptProperties();
  props.setProperties({
    SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'YOUR_SERVICE_ROLE_KEY',
    GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY',
    WRITE_PASSWORD: 'YOUR_WRITE_PASSWORD'
  });
}

if (typeof module !== 'undefined') {
  module.exports = { getConfig_: getConfig_, setupScriptProperties_: setupScriptProperties_ };
}
