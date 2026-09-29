/**
 * 「上游服務錯誤」轉換機制。
 *
 * SupabaseClient/StorageClient/Embeddings/RagChat 這幾個模組在呼叫外部服務失敗時，
 * 會用 markUpstreamError_ 建構一個標記過的例外——這個標記代表「這段例外訊息是
 * 第三方服務(Supabase/Supabase Storage/Gemini)的原始回應內容(狀態碼 + 回應本文)，
 * 不該讓匿名或未授權的呼叫端看到」。
 *
 * withSafeErrors_ 是所有對外進入點共用的轉換包裝：抓到帶這個標記的例外時，把完整
 * 原始內容(含操作標籤)寫進執行紀錄，然後另外拋出一句依錯誤分類挑選、對外安全的
 * 通用訊息；抓到沒有這個標記的例外(密碼錯誤、欄位驗證訊息、流量限制訊息等既有的
 * 安全訊息)時，原封不動往外拋，不受影響。
 *
 * 之後任何新的公開函式如果會呼叫這幾個底層模組，應該一律用 withSafeErrors_ 包住
 * 自己的函式主體，而不是自己重新判斷要不要顯示原始錯誤內容。
 */

var UPSTREAM_ERROR_CATEGORY_DATA_ = 'data';
var UPSTREAM_ERROR_CATEGORY_AI_ = 'ai';

var UPSTREAM_ERROR_MESSAGES_ = {};
UPSTREAM_ERROR_MESSAGES_[UPSTREAM_ERROR_CATEGORY_DATA_] = '資料服務暫時發生問題,請稍後再試。';
UPSTREAM_ERROR_MESSAGES_[UPSTREAM_ERROR_CATEGORY_AI_] = 'AI 服務暫時發生問題,請稍後再試。';

/**
 * 建構一個標記為「上游服務錯誤」的例外。
 * message:完整原始內容(狀態碼 + 回應本文)，只會寫進執行紀錄，不會被拋給呼叫端看到。
 * category:UPSTREAM_ERROR_CATEGORY_DATA_ 或 UPSTREAM_ERROR_CATEGORY_AI_，決定
 *          withSafeErrors_ 轉換時要挑哪一句對外安全訊息。
 */
function markUpstreamError_(message, category) {
  var err = new Error(message);
  err.isUpstreamError_ = true;
  err.upstreamCategory_ = category;
  return err;
}

/**
 * 所有對外進入點共用的轉換包裝。
 * label:這次呼叫的操作名稱，只用來讓執行紀錄看得出是哪個操作觸發的，不影響對外訊息。
 * fn:要執行的邏輯(通常就是這個進入點原本的函式主體)。
 */
function withSafeErrors_(label, fn) {
  try {
    return fn();
  } catch (err) {
    if (err && err.isUpstreamError_) {
      Logger.log('[' + label + '] ' + err.message);
      var safeMessage = UPSTREAM_ERROR_MESSAGES_[err.upstreamCategory_] ||
        UPSTREAM_ERROR_MESSAGES_[UPSTREAM_ERROR_CATEGORY_DATA_];
      throw new Error(safeMessage);
    }
    throw err;
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    UPSTREAM_ERROR_CATEGORY_DATA_: UPSTREAM_ERROR_CATEGORY_DATA_,
    UPSTREAM_ERROR_CATEGORY_AI_: UPSTREAM_ERROR_CATEGORY_AI_,
    markUpstreamError_: markUpstreamError_,
    withSafeErrors_: withSafeErrors_
  };
}
