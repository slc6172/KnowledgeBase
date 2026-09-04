/**
 * 呼叫 Gemini gemini-embedding-001 產生 embedding 向量,
 * 以及把文章的 embedding 重新產生並寫回資料庫。
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
  var text = response.getContentText();
  if (code >= 400) {
    throw new Error('Gemini embedding error ' + code + ': ' + text);
  }
  var body = JSON.parse(text);
  return body.embedding.values;
}

function regenerateArticleEmbedding_(article) {
  var text = article.title + '\n\n' + article.content_md;
  var embedding = generateEmbedding_(text);
  supabaseUpdate_('articles', eqFilter_('id', article.id), { embedding: embedding });
}

if (typeof module !== 'undefined') {
  module.exports = {
    generateEmbedding_: generateEmbedding_,
    regenerateArticleEmbedding_: regenerateArticleEmbedding_
  };
}
