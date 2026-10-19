/**
 * 通用的 Supabase(PostgREST)REST 呼叫層。
 * 所有實際的網路傳輸都透過 httpFetch_(見 HttpTransport.gs)進行,
 * 這個檔案本身不直接碰 UrlFetchApp。
 */

/**
 * 組出單一等於比對的過濾條件(例如 id=eq.123),對值做 URL 編碼,避免值裡的
 * 保留字元(& 會被誤判成下一個 query 參數的開始、逗號在清單語境下是分隔符
 * 等)意外改變查詢語意。呼叫端自己用 & 串接多個過濾條件跟 select=/order=
 * 這類非過濾條件的參數,不區分欄位是不是自由文字輸入,一律套用(細節見
 * README 已知問題修復紀錄)。
 */
function eqFilter_(column, value) {
  return column + '=eq.' + encodeURIComponent(value);
}

/**
 * 把值包成 PostgREST 認得的雙引號字串,並跳脫內部的反斜線/雙引號——只用在
 * inFilter_,不用在 eqFilter_,理由見下面 inFilter_ 的完整說明。
 */
function postgrestQuoteValue_(value) {
  var escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return '"' + escaped + '"';
}

/**
 * 組出清單比對的過濾條件(例如 id=in.("a","b")),每個值都先做 PostgREST
 * 雙引號跳脫、再做 URL 編碼。
 *
 * 2026-09 這裡的處理方式來回改過兩次,過程值得記錄下來:
 * 1. 一開始只做 encodeURIComponent,查到 PostgREST 官方文件(Reserved
 *    characters 那段)跟一個真實的 GitHub issue #701(in.() 清單裡的值
 *    如果含逗號,會被誤判成清單的分隔符,查不到東西、不拋錯),改成
 *    eqFilter_/inFilter_ 都額外包一層 PostgREST 雙引號。
 * 2. 部署到真實 Supabase 後發現這個修法把 eqFilter_ 弄壞了——UUID 欄位
 *    直接 400、TEXT 欄位安靜地查不到任何東西,整個復原回純 encodeURIComponent
 *    (README 已知問題修復紀錄第 65 條)。
 * 3. 用 Context7 直接查 PostgREST 官方文件(不是上次誤用的 Supabase
 *    Realtime 文件)才看清楚:文件裡所有「值要包雙引號」的範例,清一色只
 *    出現在 in.()/or=()/and=() 這種需要解析清單或多重條件的語境,eq. 的
 *    範例(包含一個示範自訂 UUID 格式過濾的官方範例)全部是裸值、不加
 *    引號——這代表 eq. 的文法根本不預期、也不會剝掉外層引號,in.() 的
 *    文法才會。使用者實際對自己 Supabase 專案上一個真實的 UUID 主鍵做了
 *    一次唯讀測試(`id=in.(%22<真實 uuid>%22)`),正確查到資料,證實
 *    in.() 確實會把引號剝掉才轉型,不會像 eq. 那樣把引號當成值的一部分。
 *    這裡才重新加回這層跳脫,eqFilter_ 維持原狀不動。
 * 目前 inFilter_ 實際的呼叫點(Articles.gs/RelatedArticles.gs/Search.gs)
 * 用的都是 UUID,不管有沒有真的含保留字元,加雙引號都是安全、跟不加語意
 * 相同的寫法;以後如果哪個呼叫點改成傳自由文字(例如標籤名稱清單),這裡
 * 已經先擋好了,不需要另外記得處理。
 */
function inFilter_(column, values) {
  return (
    column +
    '=in.(' +
    values
      .map(function (v) {
        return encodeURIComponent(postgrestQuoteValue_(v));
      })
      .join(',') +
    ')'
  );
}

function supabaseRequest_(method, path, options) {
  options = options || {};
  var config = getConfig_();
  // 送往 Edge Function 代理(kb-proxy),路徑與 query 原封不動;代理負責驗證共用
  // 密鑰、白名單、換上 Supabase 新版 secret key。GAS 不再持有任何 Supabase 金鑰,
  // 也不送 apikey / Authorization(它們只由代理在上游那一跳使用)。
  var url = proxyUrl_(config, 'rest/v1/' + path);
  var headers = {
    'X-KB-Proxy-Secret': config.edgeProxySecret,
    'Content-Type': 'application/json'
  };
  if (options.prefer) {
    headers['Prefer'] = options.prefer;
  }

  var params = {
    method: method,
    headers: headers,
    muteHttpExceptions: true
  };
  if (options.payload !== undefined) {
    params.payload = JSON.stringify(options.payload);
  }

  var response = httpFetch_(url, params);
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code >= 400) {
    throw markUpstreamError_('Supabase error ' + code + ': ' + text, UPSTREAM_ERROR_CATEGORY_DATA_);
  }
  return text ? JSON.parse(text) : null;
}

function supabaseSelect_(table, queryString) {
  return supabaseRequest_('GET', table + (queryString ? '?' + queryString : ''));
}

function supabaseInsert_(table, rows) {
  return supabaseRequest_('POST', table, {
    payload: rows,
    prefer: 'return=representation'
  });
}

function supabaseUpdate_(table, filterQuery, patch) {
  return supabaseRequest_('PATCH', table + '?' + filterQuery, {
    payload: patch,
    prefer: 'return=representation'
  });
}

function supabaseDelete_(table, filterQuery) {
  return supabaseRequest_('DELETE', table + '?' + filterQuery, {
    prefer: 'return=representation'
  });
}

function supabaseRpc_(fnName, args) {
  return supabaseRequest_('POST', 'rpc/' + fnName, {
    payload: args,
    prefer: 'return=representation'
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    postgrestQuoteValue_: postgrestQuoteValue_,
    eqFilter_: eqFilter_,
    inFilter_: inFilter_,
    supabaseRequest_: supabaseRequest_,
    supabaseSelect_: supabaseSelect_,
    supabaseInsert_: supabaseInsert_,
    supabaseUpdate_: supabaseUpdate_,
    supabaseDelete_: supabaseDelete_,
    supabaseRpc_: supabaseRpc_
  };
}
