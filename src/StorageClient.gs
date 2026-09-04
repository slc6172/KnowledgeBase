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
    throw new Error('Supabase Storage ' + errorLabel + ' error ' + code + ': ' + text);
  }
  return text;
}

function storageAuthHeaders_(config, extra) {
  var headers = {
    apikey: config.serviceRoleKey,
    Authorization: 'Bearer ' + config.serviceRoleKey
  };
  if (extra) {
    for (var key in extra) {
      headers[key] = extra[key];
    }
  }
  return headers;
}

function storageUpload_(bucket, path, bytes, mimeType) {
  var config = getConfig_();
  var url = config.supabaseUrl + '/storage/v1/object/' + bucket + '/' + path;
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
  var url = config.supabaseUrl + '/storage/v1/object/' + bucket + '/' + path;
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
  var url = config.supabaseUrl + '/storage/v1/object/sign/' + bucket + '/' + path;
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
  return config.supabaseUrl + '/storage/v1' + body.signedURL;
}

function storageDownload_(bucket, path) {
  var config = getConfig_();
  var url = config.supabaseUrl + '/storage/v1/object/' + bucket + '/' + path;
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
