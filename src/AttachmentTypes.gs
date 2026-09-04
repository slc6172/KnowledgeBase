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

if (typeof module !== 'undefined') {
  module.exports = { detectAttachmentType_: detectAttachmentType_ };
}
