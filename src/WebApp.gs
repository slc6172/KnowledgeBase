/**
 * Web App 進入點。Apps Script HtmlService 的標準多檔案合併慣例:
 * doGet 回傳一個組好的模板,include() 讓 Index.html 用 scriptlet 把其他
 * .html 檔案(樣式表、各視圖、JS)串成一份完整頁面回傳給瀏覽器。
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  // share-link/01——原樣傳遞查詢參數,不在這裡驗證/預先查詢文章存不存在,
  // 交給前端呼叫 getArticle 時走既有錯誤處理路徑統一判斷(見
  // openArticleDetailFromShareLink)。這裡沒有可測的邏輯分支,不需要另外的
  // 輔助函式或測試檔。
  // 沒有帶參數時 fallback 用空字串、不是 null——這個值會被印進頁面元素的
  // 資料屬性,若印成字面上的 null,前端讀出來會是非空字串,誤判成「有帶
  // 分享連結參數」(細節見 README 已知問題修復紀錄)。
  template.initialArticleId = (e && e.parameter && e.parameter.article) || '';
  return template
    .evaluate()
    .setTitle('知識庫')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * share-link/02 的 bug fix——分享按鈕原本用
 * google.script.url.getLocation() 想拿目前網址,但那個 API 回傳的
 * location 物件只有 hash/parameter/parameters 三個欄位,根本沒有 href,
 * 用 location.href 一定是 undefined,導致分享按鈕點下去在 callback 裡
 * 丟出未被接住的 TypeError、畫面上完全沒反應。改成呼叫這個函式,直接用
 * ScriptApp.getService().getUrl() 拿到真正部署的 Web App 網址(/exec)。
 * 讀取類函式,不需要密碼保護,不進 Auth.gs 白名單。
 */
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}
