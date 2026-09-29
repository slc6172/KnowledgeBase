/**
 * 附件的建立(檔案 / URL)、列出、刪除、線上預覽(簽名 URL + 純文字內容)。
 */
var TEXT_PREVIEWABLE_TYPES_ = ['code', 'md_file'];
var TEXT_PREVIEW_MAX_BYTES_ = 1 * 1024 * 1024;
// 上傳單一附件的檔案大小上限——平台本身(google.script.run)對單次呼叫傳入
// 的參數總大小約有 50MB 硬限制,base64 編碼又會再放大約 1.33 倍,所以這個
// 上限本來就不可能真的頂到平台限制;這裡是應用層自己設的合理上限,避免手滑
// 傳一個超大檔案把 Storage 額度吃掉,不是在防平台限制(細節見 README 已知
// 問題修復紀錄)。
var ATTACHMENT_UPLOAD_MAX_BYTES_ = 20 * 1024 * 1024;

/**
 * 從檔名取出副檔名(不含點),沒有副檔名時回傳空字串。
 */
function fileExtension_(fileName) {
  var parts = fileName.split('.');
  return parts.length > 1 ? parts.pop() : '';
}

function uploadAttachmentFile_(articleId, fileName, base64Data, mimeType, folderId) {
  var bytes = Utilities.base64Decode(base64Data);
  if (bytes.length > ATTACHMENT_UPLOAD_MAX_BYTES_) {
    throw new Error(
      '檔案過大(上限 ' + (ATTACHMENT_UPLOAD_MAX_BYTES_ / 1024 / 1024) + 'MB),無法上傳: ' + fileName
    );
  }
  // Storage 路徑刻意不放原始檔名(可能含中文/特殊字元)——只用 uuid + 副檔名,
  // 純 ASCII、不需要任何編碼處理,徹底避開中文檔名在 URL 路徑裡的編碼問題。
  // 原始檔名(含中文)完整保留在下面的 file_name 欄位,存在 DB 裡沒有編碼疑慮。
  var ext = fileExtension_(fileName);
  var path = articleId + '/' + Utilities.getUuid() + (ext ? '.' + ext : '');
  // 不直接用呼叫端傳來的 mimeType 當 Storage 物件的 Content-Type——伺服器端
  // 從副檔名反查一份固定的安全清單,細節跟原因見 AttachmentTypes.gs 的
  // resolveUploadContentType_ 註解。mimeType 參數保留在函式簽章裡只是為了
  // 不動到既有呼叫端(前端)的呼叫方式,實際上這裡不再使用它。
  var contentType = resolveUploadContentType_(fileName);
  storageUpload_('attachments', path, bytes, contentType);

  var row = {
    article_id: articleId,
    type: detectAttachmentType_(fileName),
    file_path: path,
    file_name: fileName,
    file_size: bytes.length,
    folder_id: folderId || null
  };
  var inserted;
  try {
    inserted = supabaseInsert_('attachments', [row]);
  } catch (insertErr) {
    // DB 這筆 insert 失敗時,Storage 裡的檔案已經真的寫進去了——如果不做任何
    // 處理,會留下一個沒有任何 DB 記錄指向、應用程式自己也找不到的孤兒檔案
    // (跟 deleteArticle_ 「先刪 Storage 再刪 DB」時考慮過的問題是同一種,只是
    // 方向相反)。這裡盡力補償清理剛剛上傳的物件;清理本身失敗就只記錄下來,
    // 不能讓清理失敗蓋掉原本真正的錯誤(insertErr 才是呼叫端該看到的錯誤)。
    try {
      storageDelete_('attachments', path);
    } catch (cleanupErr) {
      Logger.log(
        '補償清理孤兒檔案失敗,需要手動處理:attachments/' + path + '(' + cleanupErr.message + ')'
      );
    }
    throw insertErr;
  }
  return inserted[0];
}

function addAttachmentUrl_(articleId, url, label, folderId) {
  // 附件的自訂網址只接受一般網頁連結,拒絕會被瀏覽器當成可執行程式碼的
  // 協定(例如網址列打開就會執行的那種寫法),不是白名單協定一律拒絕,
  // 不特別列出被擋下的協定名稱(細節見 README 已知問題修復紀錄)。
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('附件網址只接受 http/https 開頭的一般網頁連結');
  }
  var row = {
    article_id: articleId,
    type: 'url',
    url: url,
    file_name: label || url,
    folder_id: folderId || null
  };
  var inserted = supabaseInsert_('attachments', [row]);
  return inserted[0];
}

/**
 * 跟公開的 listAttachments 讀同一筆資料,但不套用 checkPublicReadRateLimit_——
 * 只給寫入路徑內部呼叫用(mycr F-01 修正,見
 * docs/specs/spec_article_write_consistency.md)。
 */
function listAttachmentRowsInternal_(articleId) {
  return supabaseSelect_(
    'attachments',
    'select=*,attachment_folders(id,name)&' + eqFilter_('article_id', articleId) + '&order=created_at.asc'
  );
}

function listAttachments(articleId) {
  return withSafeErrors_('listAttachments', function () {
    checkPublicReadRateLimit_();
    return listAttachmentRowsInternal_(articleId);
  });
}

/**
 * attachment-folders/01——資料夾綁在單一篇文章底下(不是全站共用),讀取類,
 * 不進 Auth.gs 白名單。(這個函式先前沒有被列進 Auth.gs 開頭那份「10 個公開
 * 讀取函式」的清單裡,是遺漏,不是刻意排除——它跟其他讀取函式一樣不需要密碼、
 * 一樣會打一次 Supabase,理當一起套用 checkPublicReadRateLimit_,見 Auth.gs
 * 對應清單的更正。)
 */
function listFolders(articleId) {
  return withSafeErrors_('listFolders', function () {
    checkPublicReadRateLimit_();
    return supabaseSelect_('attachment_folders', eqFilter_('article_id', articleId) + '&order=name.asc');
  });
}

function createFolder_(articleId, name) {
  if (!name || String(name).trim() === '') {
    throw new Error('資料夾名稱不能是空白');
  }
  // 不預先查重——unique(article_id, name) 約束會自然擋下重複名稱,交由呼叫端
  // 接住 Supabase 回傳的錯誤(比照 renameTag 對唯一鍵的態度)。
  var inserted = supabaseInsert_('attachment_folders', [{ article_id: articleId, name: name }]);
  return inserted[0];
}

function findFolderOrThrow_(folderId) {
  var rows = supabaseSelect_('attachment_folders', eqFilter_('id', folderId));
  if (!rows || rows.length === 0) {
    throw new Error('找不到資料夾: ' + folderId);
  }
  return rows[0];
}

function renameFolder_(folderId, newName) {
  if (!newName || String(newName).trim() === '') {
    throw new Error('資料夾名稱不能是空白');
  }
  findFolderOrThrow_(folderId);
  var updated = supabaseUpdate_('attachment_folders', eqFilter_('id', folderId), { name: newName });
  return updated[0];
}

function deleteFolder_(folderId) {
  // 裡面的附件不手動處理——schema.sql 的 attachments.folder_id 是
  // on delete set null(不是 cascade),DB 層自動把附件的 folder_id 清成
  // null,附件本身不受影響(比照 deleteTag 對 article_tags FK cascade 的
  // 態度,只是這裡换成 set null)。
  supabaseDelete_('attachment_folders', eqFilter_('id', folderId));
  return { deleted: true, id: folderId };
}

function findAttachmentOrThrow_(attachmentId) {
  var rows = supabaseSelect_('attachments', eqFilter_('id', attachmentId));
  if (!rows || rows.length === 0) {
    throw new Error('找不到附件: ' + attachmentId);
  }
  return rows[0];
}

function deleteAttachment_(attachmentId) {
  var attachment = findAttachmentOrThrow_(attachmentId);
  if (attachment.file_path) {
    storageDelete_('attachments', attachment.file_path);
  }
  supabaseDelete_('attachments', eqFilter_('id', attachmentId));
  return { deleted: true, id: attachmentId };
}

// 簽名連結效期上限(秒):呼叫端可以要求比這個短的效期,但不能要求更長。
// 連結一旦簽出去,存取就直接打 Supabase Storage,不再經過 Apps Script 或
// 密碼機制——效期沒有上限的話,任何能呼叫這個函式的人(讀取本來就對任何人
// 開放,細節見 spec_security_hardening.md)都能繞過前端預設值,要一個幾乎
// 不會過期的連結。沒帶第二個參數時,直接套用這個上限當預設值。
var ATTACHMENT_SIGNED_URL_MAX_SECONDS_ = 3600;

function getSignedAttachmentUrl(attachmentId, expiresInSeconds) {
  return withSafeErrors_('getSignedAttachmentUrl', function () {
    checkPublicReadRateLimit_();
    var attachment = findAttachmentOrThrow_(attachmentId);
    if (!attachment.file_path) {
      throw new Error('此附件沒有對應的檔案(file_path 為空),無法產生簽名連結: ' + attachmentId);
    }
    var requested = expiresInSeconds || ATTACHMENT_SIGNED_URL_MAX_SECONDS_;
    return storageSignedUrl_(
      'attachments',
      attachment.file_path,
      Math.min(requested, ATTACHMENT_SIGNED_URL_MAX_SECONDS_)
    );
  });
}

function getTextAttachmentContent(attachmentId) {
  return withSafeErrors_('getTextAttachmentContent', function () {
    checkPublicReadRateLimit_();
    var attachment = findAttachmentOrThrow_(attachmentId);
    if (TEXT_PREVIEWABLE_TYPES_.indexOf(attachment.type) === -1) {
      throw new Error('此附件不支援純文字預覽(type=' + attachment.type + '): ' + attachmentId);
    }
    if (attachment.file_size > TEXT_PREVIEW_MAX_BYTES_) {
      throw new Error('檔案過大,無法線上預覽,請下載: ' + attachmentId);
    }
    return storageDownload_('attachments', attachment.file_path);
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    uploadAttachmentFile_: uploadAttachmentFile_,
    addAttachmentUrl_: addAttachmentUrl_,
    listAttachmentRowsInternal_: listAttachmentRowsInternal_,
    listAttachments: listAttachments,
    listFolders: listFolders,
    createFolder_: createFolder_,
    renameFolder_: renameFolder_,
    deleteFolder_: deleteFolder_,
    deleteAttachment_: deleteAttachment_,
    getSignedAttachmentUrl: getSignedAttachmentUrl,
    getTextAttachmentContent: getTextAttachmentContent
  };
}
