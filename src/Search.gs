/**
 * 搜尋頁串接:呼叫 hybrid_search_articles RPC,補上 categories/tags,
 * 依 RPC 的相關性排序回傳。
 */
function searchArticles(queryText, opts) {
  opts = opts || {};
  if (!queryText || !queryText.trim()) {
    throw new Error('請提供搜尋文字');
  }

  var embedding = generateEmbedding_(queryText);

  var rpcArgs = {
    query_text: queryText,
    query_embedding: embedding,
    tag_ids: opts.tagIds || []
  };
  if (opts.matchCount !== undefined) rpcArgs.match_count = opts.matchCount;
  if (opts.onlyPublished !== undefined) rpcArgs.only_published = opts.onlyPublished;
  if (opts.maxSemanticDistance !== undefined) {
    rpcArgs.max_semantic_distance = opts.maxSemanticDistance;
  }
  if (opts.minFullTextSimilarity !== undefined) {
    rpcArgs.min_full_text_similarity = opts.minFullTextSimilarity;
  }

  var rankedRows = supabaseRpc_('hybrid_search_articles', rpcArgs);
  if (!rankedRows) {
    return [];
  }
  // hybrid_search_articles 應該永遠回傳陣列(setof articles)。如果收到的不是
  // 陣列,幾乎都是資料庫端有兩個同名但參數不同的函式版本同時存在,PostgREST
  // 無法判斷要呼叫哪一個、回傳了描述衝突的物件而不是查詢結果——這種情況給出
  // 明確的錯誤訊息,而不是讓後面的 .map 丟出看不出原因的 TypeError。
  if (!Array.isArray(rankedRows)) {
    throw new Error(
      'hybrid_search_articles 回傳了非預期的格式(不是陣列)。' +
      '這通常代表資料庫裡同時存在新舊兩個版本的 hybrid_search_articles 函式,' +
      '導致 PostgREST 無法判斷要呼叫哪一個——請確認舊版本的函式簽名已經被明確' +
      'drop 掉,只留下最新的版本。原始回傳內容:' + JSON.stringify(rankedRows)
    );
  }
  if (rankedRows.length === 0) {
    return [];
  }

  var orderedIds = rankedRows.map(function (row) {
    return row.id;
  });
  var enrichedRows = supabaseSelect_(
    'articles',
    inFilter_('id', orderedIds) +
      '&select=id,title,content_md,status,category_id,created_at,updated_at,' +
      'categories(id,name),article_tags(tags(id,name))'
  );

  var byId = {};
  enrichedRows.forEach(function (row) {
    byId[row.id] = row;
  });

  return orderedIds
    .map(function (id) {
      return byId[id];
    })
    .filter(function (row) {
      return row !== undefined;
    })
    .map(normalizeArticleRow_);
}

if (typeof module !== 'undefined') {
  module.exports = { searchArticles: searchArticles };
}
