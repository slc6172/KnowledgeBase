/**
 * 文章切段(純函式,不碰網路、不碰試算表)。docs/specs/spec_chunked_embeddings.md。
 *
 * 為什麼要切段:嵌入模型(gemini-embedding-001)單筆輸入上限約 2,048 token,超過的部分會被
 * 靜默截斷(2026-10-02 線上實測確認)。整篇只算一個向量,長文後半段對檢索而言就不存在。
 * 切成多段、每段各算一個向量,搜尋才看得到文章的每個位置。
 *
 * 規則:
 * - 每段最多 CHUNK_MAX_CHARS_ 字(以 JavaScript 字串長度計)。即使最壞情況 1 字 1 token,
 *   1,500 字也低於 2,048 的上限,所以不需要實測 token 數。
 * - 不重疊。優先在段落(空行)邊界切;單一段落仍過長 → 換行;再不行 → 句末標點;
 *   最後才硬切(硬切不切斷代理對)。相鄰的小單位盡量打包在同一段。
 * - 1,500 字以內是單段(與舊的「整篇一個向量」行為等價);內容空白仍是單段(空字串),
 *   讓文章至少能以標題被找到。
 * - 段數上限 CHUNK_MAX_COUNT_:超過就不能發布(呼叫端在呼叫 Gemini 之前檢查)。
 */

var CHUNK_MAX_CHARS_ = 1500;
var CHUNK_MAX_COUNT_ = 40;

// 句末:全形句號/驚嘆號/問號、半形 !? 、以及「後面接空白或字串結尾」的半形句點
// (避免把 3.14、e.g. 這類中間的點當成句子結束)。標點留在前一句。
var CHUNK_SENTENCE_PATTERN_ = /[\s\S]*?(?:[。！？!?]+|\.+(?=\s|$))|[\s\S]+$/g;

function splitSentences_(text) {
  return text.match(CHUNK_SENTENCE_PATTERN_) || [text];
}

// 由粗到細的切點:段落 → 換行 → 句子。joiner 是「把相鄰小單位打包回同一段」時接回去的字串。
var CHUNK_SPLITTERS_ = [
  {
    split: function (text) {
      return text.split(/\n{2,}/);
    },
    joiner: '\n\n'
  },
  {
    split: function (text) {
      return text.split('\n');
    },
    joiner: '\n'
  },
  { split: splitSentences_, joiner: '' }
];

function hardCutChunk_(text, max) {
  var out = [];
  var start = 0;
  while (start < text.length) {
    var end = Math.min(start + max, text.length);
    if (end < text.length) {
      // 切點前一個字元是高代理(表情符號等的前半)→ 往前退一格,不把一個字劈成兩半
      var code = text.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    out.push(text.slice(start, end));
    start = end;
  }
  return out;
}

function splitAtLevel_(text, level) {
  var max = CHUNK_MAX_CHARS_;
  if (text.length <= max) return [text];
  if (level >= CHUNK_SPLITTERS_.length) return hardCutChunk_(text, max);

  var splitter = CHUNK_SPLITTERS_[level];
  var out = [];
  var current = '';
  splitter.split(text).forEach(function (part) {
    if (part.trim() === '') return;
    if (part.length > max) {
      // 這個單位本身就太長:先把手上打包到一半的收掉,再交給更細的切點處理。
      // 細切出來的片段各自成段,不再和鄰居打包(才不會需要猜它們原本是怎麼接的)。
      if (current !== '') {
        out.push(current);
        current = '';
      }
      splitAtLevel_(part, level + 1).forEach(function (piece) {
        out.push(piece);
      });
      return;
    }
    if (current === '') {
      current = part;
    } else if (current.length + splitter.joiner.length + part.length <= max) {
      current += splitter.joiner + part;
    } else {
      out.push(current);
      current = part;
    }
  });
  if (current !== '') out.push(current);
  return out;
}

/**
 * 回傳段落文字陣列(至少一個元素)。切點兩側的空白會被修掉,其餘內容不遺漏、不重複。
 */
function splitIntoChunks_(contentMd) {
  var text = contentMd === undefined || contentMd === null ? '' : String(contentMd);
  if (text.trim() === '') return [''];
  if (text.length <= CHUNK_MAX_CHARS_) return [text];
  return splitAtLevel_(text, 0)
    .map(function (chunk) {
      return chunk.replace(/^\s+|\s+$/g, '');
    })
    .filter(function (chunk) {
      return chunk !== '';
    });
}

function exceedsChunkLimit_(chunks) {
  return chunks.length > CHUNK_MAX_COUNT_;
}

/**
 * 送去嵌入的文字:標題 + 空行 + 段落,讓每一段的向量都帶著文章主題的脈絡。
 * 資料庫存的段落文字只含該段本身(不含標題)。
 */
function buildChunkEmbeddingText_(title, chunkText) {
  return String(title) + '\n\n' + chunkText;
}

if (typeof module !== 'undefined') {
  module.exports = {
    CHUNK_MAX_CHARS_: CHUNK_MAX_CHARS_,
    CHUNK_MAX_COUNT_: CHUNK_MAX_COUNT_,
    splitIntoChunks_: splitIntoChunks_,
    exceedsChunkLimit_: exceedsChunkLimit_,
    buildChunkEmbeddingText_: buildChunkEmbeddingText_
  };
}
