/**
 * 專案裡唯一呼叫 UrlFetchApp 的地方。
 * 這是整個 SupabaseClient 的測試接縫:測試時把這個函式整個換成假的實作,
 * 上層(supabaseRequest 及其呼叫者)完全不用知道底下是真的網路請求還是假資料。
 */
function httpFetch_(url, params) {
  return UrlFetchApp.fetch(url, params);
}

if (typeof module !== 'undefined') {
  module.exports = { httpFetch_: httpFetch_ };
}
