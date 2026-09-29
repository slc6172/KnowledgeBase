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

/**
 * 只有 Index.html 的 scriptlet 會呼叫 include(),用固定檔名把頁面組起來——
 * 但 include 本身沒有底線字首,任何人都能直接對
 * google.script.run.include(任意檔名) 喊,完全繞過 scriptlet、繞過檔名
 * 原本「寫死在 Index.html 裡」這層防線。這個知識庫不用登入 Google 就能連線,
 * 曝光邊界完全交給函式本身,不能假設「反正只有 scriptlet 會呼叫」。目前這
 * 8 個檔案本來就會透過 Index.html 遞迴組進每個訪客拿到的同一份頁面,所以
 * 繞過去現在還拿不到任何原本不會給的內容;比照 Auth.gs 白名單的作法先把
 * 這裡也鎖起來,是為了避免以後專案裡多了不該公開的檔案時,這裡變成一個
 * 沒有防護的檔案讀取入口。
 */
var INCLUDABLE_FILES_ = [
  'Stylesheet',
  'JavaScript',
  'ArticleListView',
  'ArticleDetailView',
  'ArticleEditorView',
  'ArticleNotFoundView',
  'CategoryManagerView',
  'TagManagerView'
];

function include(filename) {
  if (INCLUDABLE_FILES_.indexOf(filename) === -1) {
    throw new Error('不支援的檔案: ' + filename);
  }
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

if (typeof module !== 'undefined') {
  module.exports = {
    doGet: doGet,
    include: include,
    getWebAppUrl: getWebAppUrl,
    INCLUDABLE_FILES_: INCLUDABLE_FILES_
  };
}
