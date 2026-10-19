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

// 查詢向量快取(spec_rag_excerpts.md,mycr 第五輪 F-08):搜尋時前端會先發文章列表、
// 再發 AI 問答,兩者是同一句查詢;快取讓第二個請求直接取用第一個算好的向量,
// 一次搜尋只花一次 Gemini 嵌入額度與一次語意搜尋節流計數。
// 存活 60 秒:夠涵蓋「列表 → AI」的間隔,又不會讓換模型後的舊向量留太久。
// 快取是「最佳化而不是依賴」——讀寫的任何例外都吞掉、退回照舊呼叫 Gemini。
var QUERY_EMBEDDING_CACHE_PREFIX_ = 'qemb_';
var QUERY_EMBEDDING_CACHE_TTL_SECONDS_ = 60;

/**
 * 快取鍵 = 前綴 + SHA-256(模型識別字串 + 換行 + 修剪過的查詢文字) 的十六進位。
 * 鍵是雜湊,查詢明文不會出現在快取鍵裡(快取是全站共用的);
 * 把模型識別字串放進雜湊,換模型時舊快取自然失效,不會拿舊模型的向量去比對新模型的段落。
 */
function queryEmbeddingCacheKey_(queryText) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    EMBEDDING_MODEL_ID_ + '\n' + queryText.trim(),
    Utilities.Charset.UTF_8
  );
  var hex = digest
    .map(function (b) {
      // computeDigest 回傳有號位元組(-128..127),先換成 0..255 再轉十六進位
      var value = b < 0 ? b + 256 : b;
      return (value < 16 ? '0' : '') + value.toString(16);
    })
    .join('');
  return QUERY_EMBEDDING_CACHE_PREFIX_ + hex;
}

/** 讀快取;沒命中、內容不對、或任何例外一律回傳 null。 */
function readQueryEmbeddingCache_(queryText) {
  try {
    var cached = CacheService.getScriptCache().get(queryEmbeddingCacheKey_(queryText));
    if (!cached) return null;
    var vector = JSON.parse(cached);
    return Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS_ ? vector : null;
  } catch (ignored) {
    return null;
  }
}

/** 寫快取;任何例外(含值過大)都吞掉。 */
function writeQueryEmbeddingCache_(queryText, vector) {
  try {
    CacheService.getScriptCache().put(
      queryEmbeddingCacheKey_(queryText),
      JSON.stringify(vector),
      QUERY_EMBEDDING_CACHE_TTL_SECONDS_
    );
  } catch (ignored) {
    // 快取只是最佳化:寫不進去,下一次照舊呼叫 Gemini 即可
  }
}

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

/**
 * 記錄降級原因(含錯誤分類與訊息)。上游錯誤訊息是 Gemini 的原始回應本文,理論上
 * 不該含金鑰,但這裡仍把金鑰字串遮蔽掉再寫入——日誌可能被貼出去求助,多一層防護成本很低。
 */
function logSearchDegradation_(err) {
  var message = String((err && err.message) || err);
  try {
    var apiKey = getConfig_().geminiApiKey;
    if (apiKey) message = message.split(apiKey).join('[已遮蔽]');
  } catch (ignored) {
    // 設定本身讀不到時沒有金鑰可遮蔽,照常記錄即可
  }
  var category = (err && err.upstreamCategory_) || 'other';
  Logger.log('[searchArticles] 語意搜尋降級為關鍵字比對(' + category + '): ' + message);
}

/**
 * 公開的搜尋進入點。回傳 { articles, degraded }:
 * - articles:依相關性排序的文章陣列(形狀同過去直接回傳的陣列)
 * - degraded:布林,語意搜尋暫時不可用、只回傳關鍵字比對結果時為 true
 *
 * 為什麼是物件而不是「在陣列上掛屬性」:google.script.run 序列化時會丟掉
 * 附加在陣列上的非索引屬性,前端永遠讀不到。
 */
function searchArticles(queryText, opts) {
  var result = searchArticlesInternal_(queryText, opts, true);
  // matchedChunk(命中段落,每篇最多約 1,500 字)是內部給 AI 問答用的資料,前端不需要,
  // 不值得讓每篇文章多帶這一大段;只有內部呼叫者(searchArticlesInternal_)拿得到。
  return {
    articles: result.articles.map(function (article) {
      var copy = {};
      Object.keys(article).forEach(function (key) {
        if (key !== 'matchedChunk') copy[key] = article[key];
      });
      return copy;
    }),
    degraded: result.degraded
  };
}

/**
 * 檢索主體。allowDegrade 決定「產生查詢向量失敗」時要不要降級成只用關鍵字:
 * 公開搜尋允許;askKnowledgeBase 不允許(RAG 拿到品質低落的關鍵字結果會產生
 * 誤導性的答案,寧可如實報錯)。函式名稱帶底線,不會成為 google.script.run 端點。
 */
function searchArticlesInternal_(queryText, opts, allowDegrade, skipPublicReadRateLimit) {
  return withSafeErrors_('searchArticles', function () {
    // skipPublicReadRateLimit 是「第四個內部參數」,只有伺服器內部程式碼(askKnowledgeBase)
    // 會傳 true;**絕不能改成從 opts 讀取**——searchArticles 是匿名訪客可呼叫的公開函式,
    // opts 完全由呼叫端控制,開關放在 opts 裡等於任何人傳 { skipPublicReadRateLimit: true }
    // 就能繞過公開讀取額度(有測試守住)。AI 問答本來就要寫入密碼,不該去消耗匿名訪客共用的額度。
    if (skipPublicReadRateLimit !== true) checkPublicReadRateLimit_();
    opts = opts || {};
    if (!queryText || !queryText.trim()) {
      throw new Error('請提供搜尋文字');
    }
    if (queryText.length > SEARCH_QUERY_MAX_LENGTH_) {
      throw new Error('搜尋文字過長(上限 ' + SEARCH_QUERY_MAX_LENGTH_ + ' 字),請縮短後再試');
    }

    // 降級範圍刻意只包住「產生查詢向量」這一個呼叫:Hybrid Search 的關鍵字(pg_trgm)
    // 那一半不需要向量,Gemini 掛掉(配額 429、5xx、逾時、金鑰缺漏/失效)不該讓整個
    // 搜尋跟著壞掉。這裡抓「任何」錯誤而不只是 HTTP 錯誤——金鑰設錯如果讓搜尋整個
    // 壞掉,團隊完全無法使用;安靜降級的話擁有者又永遠不知道金鑰壞了,所以前端提示
    // 一律顯示、原因寫進日誌。空向量之後的任何錯誤(RPC、補資料)都不降級,照舊拋出。
    var embedding = readQueryEmbeddingCache_(queryText);
    var degraded = false;
    if (!embedding) {
      // 節流只在「快取沒命中、真的要呼叫 Gemini 之前」計數:快取命中不花 Gemini 額度,
      // 所以不佔節流。這個檢查刻意放在降級的 try 外面——節流拒絕要如實報錯,不能降級。
      checkSemanticSearchRateLimit_();
      try {
        embedding = generateEmbedding_(queryText);
        writeQueryEmbeddingCache_(queryText, embedding);
      } catch (embeddingErr) {
        if (!allowDegrade) throw embeddingErr;
        degraded = true;
        embedding = null;
        logSearchDegradation_(embeddingErr);
      }
    }

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
      tag_ids: uniqueValues_(normalizeTagIds_(opts.tagIds))
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
      return { articles: [], degraded: degraded };
    }
    // hybrid_search_articles 應該永遠回傳陣列(table:id、命中段落序號/文字、語意距離;
    // GAS 只取 id,再另外查詢整列補上分類與標籤)。如果收到的不是
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
      return { articles: [], degraded: degraded };
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
    // 命中段落:RPC 已回傳每篇最接近查詢的那一段(只被關鍵字命中時三個欄位都是 null)。
    var chunkById = {};
    rankedRows.forEach(function (row) {
      chunkById[row.id] =
        row.best_chunk_content === null || row.best_chunk_content === undefined
          ? null
          : {
              index: row.best_chunk_index,
              content: row.best_chunk_content,
              distance: row.semantic_distance
            };
    });

    var articles = orderedIds
      .map(function (id) {
        return byId[id];
      })
      .filter(function (row) {
        return row !== undefined;
      })
      .map(normalizeArticleRow_)
      .map(function (article) {
        article.matchedChunk = chunkById[article.id] || null;
        return article;
      });
    return { articles: articles, degraded: degraded };
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    searchArticles: searchArticles,
    searchArticlesInternal_: searchArticlesInternal_,
    SEARCH_QUERY_MAX_LENGTH_: SEARCH_QUERY_MAX_LENGTH_,
    SEMANTIC_SEARCH_RATE_LIMIT_: SEMANTIC_SEARCH_RATE_LIMIT_,
    SEMANTIC_SEARCH_RATE_LIMIT_WINDOW_SECONDS_: SEMANTIC_SEARCH_RATE_LIMIT_WINDOW_SECONDS_
  };
}
