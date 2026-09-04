/**
 * 附件的建立(檔案 / URL)、列出、刪除、線上預覽(簽名 URL + 純文字內容)。
 */
var TEXT_PREVIEWABLE_TYPES_ = ['code', 'md_file'];
var TEXT_PREVIEW_MAX_BYTES_ = 1 * 1024 * 1024;

/**
 * 從檔名取出副檔名(不含點),沒有副檔名時回傳空字串。
 */
function fileExtension_(fileName) {
  var parts = fileName.split('.');
  return parts.length > 1 ? parts.pop() : '';
}

function uploadAttachmentFile_(articleId, fileName, base64Data, mimeType, folderId) {
  var bytes = Utilities.base64Decode(base64Data);
  // Storage 路徑刻意不放原始檔名(可能含中文/特殊字元)——只用 uuid + 副檔名,
  // 純 ASCII、不需要任何編碼處理,徹底避開中文檔名在 URL 路徑裡的編碼問題。
  // 原始檔名(含中文)完整保留在下面的 file_name 欄位,存在 DB 裡沒有編碼疑慮。
  var ext = fileExtension_(fileName);
  var path = articleId + '/' + Utilities.getUuid() + (ext ? '.' + ext : '');
  storageUpload_('attachments', path, bytes, mimeType);

  var row = {
    article_id: articleId,
    type: detectAttachmentType_(fileName),
    file_path: path,
    file_name: fileName,
    file_size: bytes.length,
    folder_id: folderId || null
  };
  var inserted = supabaseInsert_('attachments', [row]);
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

function listAttachments(articleId) {
  return supabaseSelect_(
    'attachments',
    'select=*,attachment_folders(id,name)&' + eqFilter_('article_id', articleId) + '&order=created_at.asc'
  );
}

/**
 * attachment-folders/01——資料夾綁在單一篇文章底下(不是全站共用),讀取類,
 * 不進 Auth.gs 白名單。
 */
function listFolders(articleId) {
  return supabaseSelect_('attachment_folders', eqFilter_('article_id', articleId) + '&order=name.asc');
}

function createFolder_(articleId, name) {
  // 不預先查重——unique(article_id, name) 約束會自然擋下重複名稱,交由呼叫端
  // 接住 Supabase 回傳的錯誤(比照 renameTag 對唯一鍵的態度)。
  var inserted = supabaseInsert_('attachment_folders', [{ article_id: articleId, name: name }]);
  return inserted[0];
}

function renameFolder_(folderId, newName) {
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

function getSignedAttachmentUrl(attachmentId, expiresInSeconds) {
  var attachment = findAttachmentOrThrow_(attachmentId);
  if (!attachment.file_path) {
    throw new Error('此附件沒有對應的檔案(file_path 為空),無法產生簽名連結: ' + attachmentId);
  }
  return storageSignedUrl_(
    'attachments',
    attachment.file_path,
    expiresInSeconds || 300
  );
}

function getTextAttachmentContent(attachmentId) {
  var attachment = findAttachmentOrThrow_(attachmentId);
  if (TEXT_PREVIEWABLE_TYPES_.indexOf(attachment.type) === -1) {
    throw new Error('此附件不支援純文字預覽(type=' + attachment.type + '): ' + attachmentId);
  }
  if (attachment.file_size > TEXT_PREVIEW_MAX_BYTES_) {
    throw new Error('檔案過大,無法線上預覽,請下載: ' + attachmentId);
  }
  return storageDownload_('attachments', attachment.file_path);
}

if (typeof module !== 'undefined') {
  module.exports = {
    uploadAttachmentFile_: uploadAttachmentFile_,
    addAttachmentUrl_: addAttachmentUrl_,
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
