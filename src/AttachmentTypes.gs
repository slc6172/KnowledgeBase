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

/**
 * 從檔名取出「可以安全放進 Storage 物件鍵」的副檔名(不含點,保留原本大小寫)。
 * 只接受 1–10 個英數字元;其他任何情況(沒有點、只有開頭的點、點在最後、含空白 / ? / # /
 * 斜線 / % / 非 ASCII 字元、超過 10 個字元)一律回傳空字串,也就是「當成沒有副檔名」
 * ——不拒絕上傳,原始檔名完整保留在資料庫 file_name 欄位。
 * 類型偵測、上傳 Content-Type 判斷、物件鍵三處共用這一個函式(mycr F-06),
 * 不安全的副檔名在三處的行為因此一致:未知副檔名 → code / application/octet-stream。
 */
function fileExtension_(fileName) {
  var name = String(fileName);
  var dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  var ext = name.slice(dot + 1);
  return /^[A-Za-z0-9]{1,10}$/.test(ext) ? ext : '';
}

function detectAttachmentType_(fileName) {
  return ATTACHMENT_EXTENSION_MAP_[fileExtension_(fileName).toLowerCase()] || 'code';
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
  return ATTACHMENT_SAFE_CONTENT_TYPES_[fileExtension_(fileName).toLowerCase()] || 'application/octet-stream';
}

if (typeof module !== 'undefined') {
  module.exports = {
    fileExtension_: fileExtension_,
    detectAttachmentType_: detectAttachmentType_,
    resolveUploadContentType_: resolveUploadContentType_
  };
}
