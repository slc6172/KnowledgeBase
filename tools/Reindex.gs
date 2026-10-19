/**
 * 一次性工具:重建所有已發布文章的「段落向量」。
 * docs/specs/spec_chunked_embeddings.md 〈重建工具〉、票 03(試跑)與票 08(正式執行)。
 *
 * ⚠️ 這是「需要時才上傳、用完即刪」的工具檔,不在 src/ 內:clasp 的 rootDir 是 ./src,
 *    一般 `clasp push` 不會把它帶上去。它的入口函式刻意不加底線(底線函式在 Apps Script
 *    編輯器的「執行」選單裡看不到,無法手動執行)。
 *    風險:入口函式沒有底線,代表只要這個檔案在已部署的 Web App 版本裡,任何人都能透過
 *    google.script.run 呼叫它。所以有三道防護,而且用完一定要刪除檔案:
 *      1. Script Property REINDEX_ENABLED 必須剛好是 'true',否則一律拒絕(試跑也是);
 *      2. 全部處理完成後自動刪除這個 Property(就算忘了刪檔案,工具也已失效);
 *      3. 入口函式不回傳任何資料,結果只寫在執行紀錄裡。
 *
 * ⚠️ 這個工具依賴新版程式才有的函式(splitIntoChunks_、generateEmbeddingsBatch_、save_article 這個
 *    RPC 等),所以**必須在新版程式上線之後才能上傳**——也就是專案已經是包含分段向量功能的新版本
 *    (已經 clasp push 並發了新版 Web App)。在還沒上線的舊版專案裡執行會出現 ReferenceError。
 *    (相對地,tools/VerifyBatchEmbedding.gs 是獨立的,可以在新版上線之前執行。)
 *
 * 使用流程:
 *   1. 把這個檔案上傳(貼進)Apps Script 專案;
 *   2. 在「專案設定 → 指令碼屬性」新增 REINDEX_ENABLED = true;
 *   3. 先執行 reindexDryRun,看執行紀錄裡的文章數、段數、預估 Gemini 請求數,確認無誤;
 *   4. 再執行 reindexAllArticles(正式);時間不夠會自動存檔停下,再執行一次即可接續;
 *   5. 完成後(紀錄會說明,REINDEX_ENABLED 也會自動消失)刪除這個檔案。
 *   將來換嵌入模型:改 src/Embeddings.gs 的 EMBEDDING_MODEL_NAME_,重新部署,再照上面流程跑一次。
 *   注意:向量維度寫在資料庫欄位型別上(768);換成「不同維度」的模型需要先改 schema,
 *   這個工具處理不了。
 */

var REINDEX_PROPERTY_ = 'REINDEX_ENABLED';
// 讀取文章內容時每批的篇數:id 清單放在網址裡,不能太長。
var REINDEX_FETCH_BATCH_ = 50;
// Apps Script 單次執行上限是 6 分鐘。留一點餘裕,約 5 分鐘時存檔停止、記錄進度,
// 之後再執行一次就會接續(待重建清單由資料庫依 embedding_model 判斷,已完成的不會再出現)。
var REINDEX_TIME_BUDGET_MS_ = 5 * 60 * 1000;

function assertReindexEnabled_() {
  var value = PropertiesService.getScriptProperties().getProperty(REINDEX_PROPERTY_);
  if (value !== 'true') {
    throw new Error('重建工具未啟用:請先在「指令碼屬性」設定 ' + REINDEX_PROPERTY_ + ' = true');
  }
}

/**
 * 取得「待重建」的文章(已發布,且沒有任何段落、或有段落的模型與目前不同),
 * 連同內容一起讀回。article_chunks 不對 GAS 開放,所以待重建清單由資料庫的
 * articles_needing_reindex 函式提供。
 */
function fetchReindexCandidates_() {
  var rows = supabaseRpc_('articles_needing_reindex', { current_model: EMBEDDING_MODEL_ID_ });
  var ids = (rows || []).map(function (row) {
    return row.id;
  });
  var articles = [];
  for (var i = 0; i < ids.length; i += REINDEX_FETCH_BATCH_) {
    var batch = ids.slice(i, i + REINDEX_FETCH_BATCH_);
    var fetched = supabaseSelect_('articles', 'select=id,title,content_md&' + inFilter_('id', batch));
    fetched.forEach(function (article) {
      articles.push(article);
    });
  }
  return articles;
}

/**
 * 試跑:只讀取、只寫日誌。不呼叫 Gemini、不寫入任何資料、不回傳任何東西。
 */
function reindexDryRun() {
  assertReindexEnabled_();

  var articles = fetchReindexCandidates_();
  if (articles.length === 0) {
    Logger.log('沒有需要重建的文章。');
    return;
  }

  var processable = 0;
  var totalChunks = 0;
  var oversize = [];
  articles.forEach(function (article) {
    var chunks = splitIntoChunks_(article.content_md);
    if (exceedsChunkLimit_(chunks)) {
      oversize.push({ id: article.id, title: article.title, chunks: chunks.length });
      return;
    }
    processable += 1;
    totalChunks += chunks.length;
  });

  Logger.log('[試跑] 待重建文章 ' + processable + ' 篇,共 ' + totalChunks + ' 段。');
  // 每篇文章一個批次嵌入請求(段數不超過 40)
  Logger.log('[試跑] 預估 Gemini 請求 ' + processable + ' 次。');
  if (oversize.length > 0) {
    Logger.log('[試跑] 超過 ' + CHUNK_MAX_COUNT_ + ' 段、會被略過的文章 ' + oversize.length + ' 篇(不計入上面的數字):');
    oversize.forEach(function (item) {
      Logger.log('  - ' + item.id + ' 「' + item.title + '」(' + item.chunks + ' 段)');
    });
  }
}

// 單篇失敗的簡短原因:只取訊息的前 200 字。上游錯誤訊息只含服務端的錯誤說明,
// 不含文章內容與金鑰(金鑰只放在請求標頭)。
function shortReason_(err) {
  return String((err && err.message) || err).slice(0, 200);
}

/**
 * 正式執行:替每一篇待重建的文章重新切段、批次嵌入,再用 save_article(只帶段落與模型)寫入。
 * - 每篇文章一個批次 Gemini 請求 + 一個 save_article;單篇失敗只記錄、繼續下一篇;
 * - 時間預算用完、或 Gemini 回 429 → 優雅停止並記錄進度,Property 保留,再執行一次即可接續;
 * - 超過 40 段的文章記錄後略過,不使整批失敗;
 * - 全部處理完(沒有因為時限或 429 停下、也沒有失敗的文章)→ 自動刪除 REINDEX_ENABLED,
 *   工具就此失效。結果只寫在執行紀錄裡,不回傳任何資料,日誌不含文章內容與金鑰。
 */
function reindexAllArticles() {
  assertReindexEnabled_();
  var startedAt = Date.now();

  var articles = fetchReindexCandidates_();
  if (articles.length === 0) {
    Logger.log('沒有需要重建的文章。');
    finishReindex_();
    return;
  }

  var done = 0;
  var oversize = [];
  var failed = [];
  var stopReason = null;
  var index = 0;
  for (; index < articles.length; index++) {
    if (Date.now() - startedAt >= REINDEX_TIME_BUDGET_MS_) {
      stopReason = '時間預算用完(單次執行上限 6 分鐘)';
      break;
    }
    var article = articles[index];
    var chunks = splitIntoChunks_(article.content_md);
    if (exceedsChunkLimit_(chunks)) {
      oversize.push({ id: article.id, title: article.title, chunks: chunks.length });
      continue;
    }
    try {
      var vectors = generateEmbeddingsBatch_(
        chunks.map(function (chunk) {
          return buildChunkEmbeddingText_(article.title, chunk);
        })
      );
      supabaseRpc_('save_article', {
        p_id: article.id,
        p_chunks: chunks.map(function (chunk, i) {
          return { content: chunk, embedding: vectors[i] };
        }),
        p_embedding_model: EMBEDDING_MODEL_ID_
      });
      done += 1;
    } catch (err) {
      if (/error 429/.test(String(err && err.message))) {
        // 免費層:每分鐘 100 個請求、每天 1,000 個(依官方文件);依實測推論,每一段文字算一個請求。
        // 所以一篇 40 段的文章就用掉每分鐘額度的 40%。通常等一分鐘再執行就好;若等了仍然 429,
        // 可能是當天額度用完了(每天太平洋時間午夜重置),隔天再執行。
        stopReason = 'Gemini 回覆 429(額度或速率限制:免費層每分鐘 100 個請求、每天 1,000 個,每一段文字算一個)。' +
          '請等一分鐘再執行一次;若仍然 429,可能是當天額度用完,隔天再試';
        break;
      }
      failed.push({ id: article.id, title: article.title, reason: shortReason_(err) });
    }
  }

  var remaining = articles.length - index; // 因為停下而「還沒輪到」的篇數
  Logger.log('[重建] 已處理 ' + done + ' 篇。');
  if (oversize.length > 0) {
    Logger.log('[重建] 超過 ' + CHUNK_MAX_COUNT_ + ' 段、已略過的文章 ' + oversize.length + ' 篇(需要拆成多篇才能發布):');
    oversize.forEach(function (item) {
      Logger.log('  - ' + item.id + ' 「' + item.title + '」(' + item.chunks + ' 段)');
    });
  }
  if (failed.length > 0) {
    Logger.log('[重建] 失敗 ' + failed.length + ' 篇(再執行一次會重試):');
    failed.forEach(function (item) {
      Logger.log('  - ' + item.id + ' 「' + item.title + '」:' + item.reason);
    });
  }
  if (stopReason) {
    Logger.log('[重建] 提前停止:' + stopReason + '。剩餘 ' + remaining + ' 篇尚未處理;REINDEX_ENABLED 保留,請再執行一次接續。');
    return;
  }
  if (failed.length > 0) {
    Logger.log('[重建] 有失敗的文章,REINDEX_ENABLED 保留;排除原因後再執行一次。');
    return;
  }
  finishReindex_();
}

// 全部完成:自動刪除開關,工具就此失效(就算忘了刪檔案,也不會再被人觸發)。
function finishReindex_() {
  PropertiesService.getScriptProperties().deleteProperty(REINDEX_PROPERTY_);
  Logger.log('[重建] 全部完成,已自動刪除 ' + REINDEX_PROPERTY_ + '。請把這個工具檔從專案中刪除。');
}

if (typeof module !== 'undefined') {
  module.exports = {
    REINDEX_TIME_BUDGET_MS_: REINDEX_TIME_BUDGET_MS_,
    reindexDryRun: reindexDryRun,
    reindexAllArticles: reindexAllArticles
  };
}
