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
function generateEmbedding_(text) {
  var config = getConfig_();
  if (!config.geminiApiKey) {
    throw new Error('缺少 Script Property: GEMINI_API_KEY');
  }
  var url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';
  var payload = {
    model: 'models/gemini-embedding-001',
    content: { parts: [{ text: text }] },
    outputDimensionality: 768
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

if (typeof module !== 'undefined') {
  module.exports = {
    generateEmbedding_: generateEmbedding_
  };
}
