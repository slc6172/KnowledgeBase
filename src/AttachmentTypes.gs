/**
 * 依副檔名自動判斷附件的 type。
 */
var ATTACHMENT_EXTENSION_MAP_ = {
  png: 'photo', jpg: 'photo', jpeg: 'photo', gif: 'photo', webp: 'photo', svg: 'photo',
  zip: 'zip',
  md: 'md_file',
  doc: 'office_doc', docx: 'office_doc', xls: 'office_doc', xlsx: 'office_doc',
  ppt: 'office_doc', pptx: 'office_doc',
  pdf: 'pdf',
  odt: 'odf_doc', ods: 'odf_doc', odp: 'odf_doc'
};

function detectAttachmentType_(fileName) {
  var parts = fileName.split('.');
  var ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
  return ATTACHMENT_EXTENSION_MAP_[ext] || 'code';
}

/**
 * 上傳時實際寫入 Storage 物件的 Content-Type——刻意不信任呼叫端傳來的
 * mimeType 參數,改成伺服器端從副檔名反查這份固定的安全清單。
 * uploadAttachmentFile_ 雖然是密碼保護的函式,但任何知道密碼的人都能繞過
 * 前端 UI 直接呼叫,宣稱任意的 mimeType——如果照單全收拿去設成 Storage
 * 物件的 Content-Type,簽名連結被在新分頁直接打開時,瀏覽器就會依這個
 * 宣稱的值決定怎麼解析檔案內容:image/svg+xml、text/html 這類類型即使
 * 跟真正的副檔名對不上,還是可能被當成文件解析、執行內嵌的 <script>
 * (SVG 是最經典的例子——ATTACHMENT_EXTENSION_MAP_ 把它歸進 photo,但
 * SVG 本質上是可以帶 <script> 的 XML 文件,不是單純的點陣圖)。
 * 這份清單只收「已知安全、瀏覽器不會當成可執行文件解析」的副檔名,沒在
 * 清單裡的(包含 svg、以及任何被 detectAttachmentType_ 歸類成 code 的
 * 未知副檔名),一律強制回傳 application/octet-stream——瀏覽器對這個
 * Content-Type 只會提示下載,不會嘗試解析執行,不管呼叫端當初宣稱的
 * mimeType 是什麼。
 */
var ATTACHMENT_SAFE_CONTENT_TYPES_ = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
  md: 'text/markdown',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation'
};

function resolveUploadContentType_(fileName) {
  var parts = fileName.split('.');
  var ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
  return ATTACHMENT_SAFE_CONTENT_TYPES_[ext] || 'application/octet-stream';
}

if (typeof module !== 'undefined') {
  module.exports = {
    detectAttachmentType_: detectAttachmentType_,
    resolveUploadContentType_: resolveUploadContentType_
  };
}
