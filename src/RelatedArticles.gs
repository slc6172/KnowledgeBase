/**
 * 文章詳情頁「你可能也想看」:呼叫 related_articles RPC,拿一篇文章自己每一段的
 * 向量做最近鄰搜尋(任一段對任一段最近的距離),不呼叫 Gemini(重用文章已經算好、
 * 存在 article_chunks 裡的向量)。
 */
function getRelatedArticles(articleId) {
  return withSafeErrors_('getRelatedArticles', function () {
    checkPublicReadRateLimit_();
    var rankedRows = supabaseRpc_('related_articles', {
      source_article_id: articleId,
      match_count: 3
    });
    if (!rankedRows || rankedRows.length === 0) {
      return [];
    }

    var orderedIds = rankedRows.map(function (row) {
      return row.id;
    });
    var enrichedRows = supabaseSelect_(
      'articles',
      inFilter_('id', orderedIds) +
        '&select=id,title,category_id,created_at,updated_at,' +
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
  });
}

if (typeof module !== 'undefined') {
  module.exports = { getRelatedArticles: getRelatedArticles };
}
