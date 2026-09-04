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
 * 組出清單比對的過濾條件(例如 id=in.(a,b)),對每個值分別做 URL 編碼——
 * 值本身如果含有逗號,編碼後就不會被誤判成清單的分隔符。
 */
function inFilter_(column, values) {
  return column + '=in.(' + values.map(encodeURIComponent).join(',') + ')';
}

function supabaseRequest_(method, path, options) {
  options = options || {};
  var config = getConfig_();
  var url = config.supabaseUrl + '/rest/v1/' + path;
  var headers = {
    apikey: config.serviceRoleKey,
    Authorization: 'Bearer ' + config.serviceRoleKey,
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
    throw new Error('Supabase error ' + code + ': ' + text);
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
