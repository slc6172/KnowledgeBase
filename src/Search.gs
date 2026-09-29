/**
 * 搜尋頁串接:呼叫 hybrid_search_articles RPC,補上 categories/tags,
 * 依 RPC 的相關性排序回傳。
 */

// 語意搜尋(呼叫 Gemini Embedding API)的頻率上限——這個知識庫不用登入 Google
// 就能連線,搜尋是完全公開的讀取功能,沒有密碼門檻擋著,任何人都能無限次觸發
// 真正花錢/佔用 Gemini API 額度的呼叫;這兩個數字就是用來擋住這件事的節流
// 設定,獨立寫成變數方便之後依實際用量調整,不要在別的地方寫死。用
// CacheService(所有執行個體共用同一份)做一個簡單的固定時間窗口計數器——
// 不是精準的滑動窗口,窗口邊界前後瞬間最壞情況會放行到接近 2 倍上限的請求量,
// 但這裡的目的是「擋住持續性的濫用/擋住把額度燒光」,不需要為了更精準的演算法
// 增加複雜度。這個檢查刻意放在 searchArticles 本身、不是只放在搜尋框的入口——
// askKnowledgeBase 內部也會呼叫 searchArticles,兩邊燒的是同一份 Gemini 額度,
// 必須共用同一個計數器,不能各自獨立計算。
var SEMANTIC_SEARCH_RATE_LIMIT_ = 20;
var SEMANTIC_SEARCH_RATE_LIMIT_WINDOW_SECONDS_ = 60;

// 搜尋文字(searchArticles 直接呼叫,askKnowledgeBase 的 queryText 也會經過
// 這裡)的長度上限——頻率已經被下面的 SEMANTIC_SEARCH_RATE_LIMIT_ 擋住,但
// 單次請求的「大小」本身沒有上限:20 次/分鐘 × 刻意灌爆的巨大 queryText,
// 仍然可能明顯放大 Gemini Embedding API 的 token 成本(2026-09 這輪 /mycr
// 複查才第一次被問出來)。1000 字對搜尋框/RAG 問題來說已經很寬裕,獨立寫成
// 變數方便之後依實際用量調整。
var SEARCH_QUERY_MAX_LENGTH_ = 1000;

function checkSemanticSearchRateLimit_() {
  var cache = CacheService.getScriptCache();
  var windowKey =
    'semantic_search_' +
    Math.floor(Date.now() / (SEMANTIC_SEARCH_RATE_LIMIT_WINDOW_SECONDS_ * 1000));
  var current = Number(cache.get(windowKey)) || 0;
  if (current >= SEMANTIC_SEARCH_RATE_LIMIT_) {
    throw new Error('搜尋太頻繁,請稍後再試');
  }
  cache.put(windowKey, String(current + 1), SEMANTIC_SEARCH_RATE_LIMIT_WINDOW_SECONDS_);
}

function searchArticles(queryText, opts) {
  return withSafeErrors_('searchArticles', function () {
    checkPublicReadRateLimit_();
    opts = opts || {};
    if (!queryText || !queryText.trim()) {
      throw new Error('請提供搜尋文字');
    }
    if (queryText.length > SEARCH_QUERY_MAX_LENGTH_) {
      throw new Error('搜尋文字過長(上限 ' + SEARCH_QUERY_MAX_LENGTH_ + ' 字),請縮短後再試');
    }
    checkSemanticSearchRateLimit_();

    var embedding = generateEmbedding_(queryText);

    // tag_ids 去重後才送進 hybrid_search_articles RPC——這個 RPC 內部用
    // `having count(distinct tag_id) = array_length(tag_ids, 1)` 判斷
    // 「同時擁有全部指定標籤」,如果呼叫端傳進來的 tagIds 本身有重複值,
    // array_length 沒有跟著去重,門檻會比任何文章實際可能符合的相異標籤數
    // 還高,導致真正符合的文章被誤判排除。在 GAS 這層去重比改 schema.sql
    // 的 RPC 定義更輕量,不需要使用者手動跑資料庫遷移(Articles.gs 的
    // listArticlesByTags_ 對 articles_by_tags RPC 也是同樣的做法)。
    var rpcArgs = {
      query_text: queryText,
      query_embedding: embedding,
      tag_ids: uniqueValues_(opts.tagIds || [])
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
      throw markUpstreamError_(
        'hybrid_search_articles 回傳了非預期的格式(不是陣列)。' +
        '這通常代表資料庫裡同時存在新舊兩個版本的 hybrid_search_articles 函式,' +
        '導致 PostgREST 無法判斷要呼叫哪一個——請確認舊版本的函式簽名已經被明確' +
        'drop 掉,只留下最新的版本。原始回傳內容:' + JSON.stringify(rankedRows),
        UPSTREAM_ERROR_CATEGORY_DATA_
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
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    searchArticles: searchArticles,
    SEARCH_QUERY_MAX_LENGTH_: SEARCH_QUERY_MAX_LENGTH_,
    SEMANTIC_SEARCH_RATE_LIMIT_: SEMANTIC_SEARCH_RATE_LIMIT_,
    SEMANTIC_SEARCH_RATE_LIMIT_WINDOW_SECONDS_: SEMANTIC_SEARCH_RATE_LIMIT_WINDOW_SECONDS_
  };
}
