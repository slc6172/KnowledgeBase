/**
 * 呼叫 Gemini gemini-embedding-001 產生 embedding 向量。
 *
 * 「算出向量之後要不要寫回資料庫、要不要跟其他欄位合併成單一次 PATCH」由
 * 呼叫端(Articles.gs 的 updateArticle_/setArticleStatus_)自己決定——mycr
 * F-01 修正之前,這裡曾經有一個 regenerateArticleEmbedding_ 包辦「算好就
 * 立刻另外 PATCH 寫回」,但那個寫法正是 F-01 要修的部分提交問題的一部分
 * (見 docs/specs/spec_article_write_consistency.md),兩個呼叫端都改成先
 * 呼叫這裡的 generateEmbedding_、自己決定何時合併寫入之後,那個函式沒有
 * 任何呼叫端了,已經刪除。
 */
// 嵌入模型與維度的單一定義處(查詢向量、段落向量、重建工具共用)。
// 維度必須與資料庫 article_chunks.embedding 的 extensions.vector(768) 一致(有測試守住);
// 換成「同維度」的新模型只要改 EMBEDDING_MODEL_NAME_,段落表的 embedding_model 欄位會讓
// 重建工具把舊模型產生的段落視為待重建。換成「不同維度」的模型需要改 schema,工具處理不了。
var EMBEDDING_MODEL_NAME_ = 'gemini-embedding-001';
var EMBEDDING_DIMENSIONS_ = 768;
var EMBEDDING_MODEL_ID_ = EMBEDDING_MODEL_NAME_ + '/' + EMBEDDING_DIMENSIONS_;

function generateEmbedding_(text) {
  var config = getConfig_();
  if (!config.geminiApiKey) {
    throw new Error('缺少 Script Property: GEMINI_API_KEY');
  }
  var url =
    'https://generativelanguage.googleapis.com/v1beta/models/' + EMBEDDING_MODEL_NAME_ + ':embedContent';
  var payload = {
    model: 'models/' + EMBEDDING_MODEL_NAME_,
    content: { parts: [{ text: text }] },
    outputDimensionality: EMBEDDING_DIMENSIONS_
  };
  var response = httpFetch_(url, {
    method: 'post',
    headers: {
      'x-goog-api-key': config.geminiApiKey,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var responseText = response.getContentText();
  if (code >= 400) {
    throw markUpstreamError_('Gemini embedding error ' + code + ': ' + responseText, UPSTREAM_ERROR_CATEGORY_AI_);
  }
  var body = JSON.parse(responseText);
  if (!body.embedding || !body.embedding.values) {
    throw new Error('AI 服務回應格式異常,請稍後再試。');
  }
  return body.embedding.values;
}

// 單一 batchEmbedContents 請求最多帶幾筆。這個數字不超過資料庫的段數上限(40),所以正常情況
// 一篇文章只需要一個請求。官方 API 參考沒有寫出筆數上限;票 04 的驗證函式
// (tools/VerifyBatchEmbedding.gs)會用真實金鑰實測。若實測發現上限小於 40,把這個常數
// 往下改即可——generateEmbeddingsBatch_ 會自動分批送出、依序合併,呼叫端不用動。
var EMBEDDING_BATCH_MAX_ = 40;

/**
 * 一個 batchEmbedContents 請求。每筆的 model 必須與外層一致(官方規定),
 * 回傳的 embeddings 依請求的相同順序排列(官方文件明載,本專案另有測試鎖住)。
 * 回應不符預期(向量數不對、維度不是 EMBEDDING_DIMENSIONS_、缺欄位)一律視為上游 AI 錯誤:
 * 呼叫端因此不會把殘缺的向量寫進資料庫。金鑰只放在標頭,不進網址、不進錯誤訊息。
 */
function requestEmbeddingBatch_(texts, apiKey) {
  var url =
    'https://generativelanguage.googleapis.com/v1beta/models/' + EMBEDDING_MODEL_NAME_ + ':batchEmbedContents';
  var payload = {
    requests: texts.map(function (text) {
      return {
        model: 'models/' + EMBEDDING_MODEL_NAME_,
        content: { parts: [{ text: text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS_
      };
    })
  };
  var response = httpFetch_(url, {
    method: 'post',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var responseText = response.getContentText();
  if (code >= 400) {
    throw markUpstreamError_('Gemini batch embedding error ' + code + ': ' + responseText, UPSTREAM_ERROR_CATEGORY_AI_);
  }
  var body = JSON.parse(responseText);
  var embeddings = body && body.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw markUpstreamError_(
      'Gemini batch embedding: 回傳的向量數與請求不符(請求 ' + texts.length + ' 筆)',
      UPSTREAM_ERROR_CATEGORY_AI_
    );
  }
  return embeddings.map(function (item, i) {
    if (!item || !Array.isArray(item.values) || item.values.length !== EMBEDDING_DIMENSIONS_) {
      throw markUpstreamError_(
        'Gemini batch embedding: 第 ' + (i + 1) + ' 筆向量缺少 values 或維度不是 ' + EMBEDDING_DIMENSIONS_,
        UPSTREAM_ERROR_CATEGORY_AI_
      );
    }
    return item.values;
  });
}

/**
 * 把多段文字算成多個向量(依輸入順序)。超過 EMBEDDING_BATCH_MAX_ 時自動分批。
 * 任何一批失敗整個呼叫就失敗,不回傳部分結果。
 */
function generateEmbeddingsBatch_(texts) {
  if (!texts || texts.length === 0) return [];
  var config = getConfig_();
  if (!config.geminiApiKey) {
    throw new Error('缺少 Script Property: GEMINI_API_KEY');
  }
  var results = [];
  for (var i = 0; i < texts.length; i += EMBEDDING_BATCH_MAX_) {
    var batch = requestEmbeddingBatch_(texts.slice(i, i + EMBEDDING_BATCH_MAX_), config.geminiApiKey);
    batch.forEach(function (values) {
      results.push(values);
    });
  }
  return results;
}

if (typeof module !== 'undefined') {
  module.exports = {
    EMBEDDING_BATCH_MAX_: EMBEDDING_BATCH_MAX_,
    requestEmbeddingBatch_: requestEmbeddingBatch_,
    generateEmbeddingsBatch_: generateEmbeddingsBatch_,
    EMBEDDING_MODEL_NAME_: EMBEDDING_MODEL_NAME_,
    EMBEDDING_DIMENSIONS_: EMBEDDING_DIMENSIONS_,
    EMBEDDING_MODEL_ID_: EMBEDDING_MODEL_ID_,
    generateEmbedding_: generateEmbedding_
  };
}
