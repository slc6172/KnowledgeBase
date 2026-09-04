/**
 * RAG 問答——搜尋列升級的 AI 回答區塊(spec_rag_qa.md)。讀取類操作,不進
 * Auth.gs 白名單、不透過 callProtected,但仍需要驗證密碼,共用
 * isValidWritePassword_ 判斷式。只有持有有效寫入密碼的使用者才會觸發 Gemini
 * 呼叫——這個密碼門檻本身就是這次的用量節流機制,見 spec 的說明。
 */
function askKnowledgeBase(queryText, password, history) {
  if (!isValidWritePassword_(password)) {
    throw new Error('密碼錯誤');
  }

  // max_semantic_distance 從函式預設的 0.6 收緊到 0.4——使用者實測「test」
  // 跟「clasp」這兩篇完全不相關的文章,語意距離量出來是 0.539,比 0.6 的
  // 預設門檻還近,會被誤判成「夠相關」而混進檢索結果、進而污染 AI 答案的
  // 依據來源。這個數字是文章數量還很少時的粗略校準,文章變多、有更多樣本
  // 可以比對「真的相關」跟「真的不相關」的實際距離差異之後,可能需要再調。
  var articles = searchArticles(queryText, { onlyPublished: true, maxSemanticDistance: 0.4 });
  if (!articles || articles.length === 0) {
    return { answer: null, noRelevantArticles: true, sources: [] };
  }

  var promptText = buildRagPrompt_(queryText, articles, history || []);
  var answer = generateRagAnswer_(promptText);

  return {
    answer: answer,
    noRelevantArticles: false,
    sources: articles.map(function (a) {
      return { id: a.id, title: a.title };
    })
  };
}

function buildRagPrompt_(queryText, articles, history) {
  var articlesText = articles
    .map(function (a, i) {
      return '文章 ' + (i + 1) + ':' + a.title + '\n' + a.content_md;
    })
    .join('\n\n');

  var historyText = history
    .map(function (turn) {
      return '問:' + turn.question + '\n答:' + turn.answer;
    })
    .join('\n\n');

  return (
    '你是知識庫的問答助理。請只根據下面「參考文章」的內容回答「使用者問題」,' +
    '不要使用你自己的一般知識。如果參考文章不足以回答問題,請明確告訴使用者' +
    '知識庫沒有相關資料,不要編造答案。\n\n' +
    '=== 參考文章 ===\n' + articlesText + '\n\n' +
    (historyText ? '=== 先前的對話 ===\n' + historyText + '\n\n' : '') +
    '=== 使用者問題 ===\n' + queryText
  );
}

/**
 * 呼叫模式沿用 Embeddings.gs 的 generateEmbedding_——httpFetch_、
 * x-goog-api-key header、muteHttpExceptions、檢查 response code。
 * 模型選用 gemini-3.5-flash:純文字生成任務,查證 Gemini API 文件當下(2026-08)
 * 官方快速上手範例採用的一般文字生成模型,不是 gemini-3.7-flash 那種主打複雜
 * coding/agentic 場景的旗艦模型——這個功能只是根據檢索到的文章組一段回答,
 * 用較輕量的模型即可。
 */
function generateRagAnswer_(promptText) {
  var config = getConfig_();
  if (!config.geminiApiKey) {
    throw new Error('缺少 Script Property: GEMINI_API_KEY');
  }
  var url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
  var payload = {
    contents: [{ parts: [{ text: promptText }] }]
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
    throw new Error('Gemini generateContent error ' + code + ': ' + text);
  }
  var body = JSON.parse(text);
  return body.candidates[0].content.parts[0].text;
}

if (typeof module !== 'undefined') {
  module.exports = { askKnowledgeBase: askKnowledgeBase };
}
