/**
 * Supabase Storage REST API 的薄包裝(上傳/刪除/簽名 URL/下載)。
 * 跟 SupabaseClient.gs 平行,但打的是 /storage/v1/ 而不是 /rest/v1/。
 * 一樣透過 httpFetch_ 呼叫,不直接碰 UrlFetchApp。
 */
function storageFetch_(url, params, errorLabel) {
  var response = httpFetch_(url, params);
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code >= 400) {
    throw markUpstreamError_('Supabase Storage ' + errorLabel + ' error ' + code + ': ' + text, UPSTREAM_ERROR_CATEGORY_DATA_);
  }
  return text;
}

// 只送共用密鑰給代理;apikey / Authorization 由代理在上游那一跳自己加。
function storageAuthHeaders_(config, extra) {
  var headers = {
    'X-KB-Proxy-Secret': config.edgeProxySecret
  };
  if (extra) {
    for (var key in extra) {
      headers[key] = extra[key];
    }
  }
  return headers;
}

// 把 bucket 與物件鍵「每一段」分別做 URL 編碼後再用斜線接起來:斜線只出現在段與段之間,
// 物件鍵裡的 ? # % 空白 非 ASCII 字元不可能變成 query / fragment / 路徑結構(mycr F-06)。
// 正常的物件鍵({UUID}/{uuid}.副檔名)全是安全字元,編碼後與原值相同。
function storageObjectPath_(bucket, path) {
  return [bucket]
    .concat(String(path).split('/'))
    .map(encodeURIComponent)
    .join('/');
}

function storageUpload_(bucket, path, bytes, mimeType) {
  var config = getConfig_();
  var url = proxyUrl_(config, 'storage/v1/object/' + storageObjectPath_(bucket, path));
  var text = storageFetch_(
    url,
    {
      method: 'post',
      headers: storageAuthHeaders_(config, {
        'Content-Type': mimeType || 'application/octet-stream'
      }),
      payload: bytes,
      muteHttpExceptions: true
    },
    'upload'
  );
  return JSON.parse(text);
}

function storageDelete_(bucket, path) {
  var config = getConfig_();
  var url = proxyUrl_(config, 'storage/v1/object/' + storageObjectPath_(bucket, path));
  var text = storageFetch_(
    url,
    {
      method: 'delete',
      headers: storageAuthHeaders_(config),
      muteHttpExceptions: true
    },
    'delete'
  );
  return JSON.parse(text);
}

function storageSignedUrl_(bucket, path, expiresInSeconds) {
  var config = getConfig_();
  var url = proxyUrl_(config, 'storage/v1/object/sign/' + storageObjectPath_(bucket, path));
  var text = storageFetch_(
    url,
    {
      method: 'post',
      headers: storageAuthHeaders_(config, { 'Content-Type': 'application/json' }),
      payload: JSON.stringify({ expiresIn: expiresInSeconds }),
      muteHttpExceptions: true
    },
    'sign'
  );
  var body = JSON.parse(text);
  // 簽名 URL 是給瀏覽器直連 Supabase Storage 的(token 已內含於 URL),
  // 所以刻意用公開專案網址、不經代理。
  return config.supabaseUrl + '/storage/v1' + body.signedURL;
}

function storageDownload_(bucket, path) {
  var config = getConfig_();
  var url = proxyUrl_(config, 'storage/v1/object/' + storageObjectPath_(bucket, path));
  return storageFetch_(
    url,
    {
      method: 'get',
      headers: storageAuthHeaders_(config),
      muteHttpExceptions: true
    },
    'download'
  );
}

if (typeof module !== 'undefined') {
  module.exports = {
    storageUpload_: storageUpload_,
    storageDelete_: storageDelete_,
    storageSignedUrl_: storageSignedUrl_,
    storageDownload_: storageDownload_
  };
}
