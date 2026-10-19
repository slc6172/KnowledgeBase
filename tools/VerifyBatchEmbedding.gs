/**
 * 一次性驗證:用真實的 Gemini 金鑰實測批次嵌入(batchEmbedContents)。
 * docs/specs/spec_chunked_embeddings.md、票 04。
 *
 * 要回答兩個官方文件沒有(或有爭議)的問題:
 *   (a) 回傳順序:第 i 個向量是不是對應第 i 筆輸入?官方文件說「依請求順序」,但有社群文章
 *       提過順序問題;這裡用三段完全不同的文字,拿批次結果去比對各自單筆呼叫的結果。
 *   (b) 單次請求最多可帶幾筆?官方 API 參考頁沒有寫出數字。這裡實測 40、41、100 筆。
 *
 * ⚠️ 這是「需要時才上傳、用完即刪」的工具檔,不在 src/ 內(clasp 的 rootDir 是 ./src,
 *    一般 `clasp push` 不會帶上去)。入口函式沒有底線,所以只要檔案在已部署的版本裡,
 *    任何人都能呼叫它去消耗你的 Gemini 額度。防護:Script Property REINDEX_ENABLED 必須剛好是
 *    'true' 才會執行;函式只寫執行紀錄、不回傳任何資料;驗證用的都是很短的測試字串,
 *    不會把知識庫的內容送出去。
 *
 * 這個檔案是**獨立、自給自足**的:它要在「新版程式還沒上線」之前執行,所以不依賴任何這次新增的
 * 函式或常數,只用已部署版本一定有的 getConfig_(讀 GEMINI_API_KEY)與 httpFetch_(發出請求)。
 * (第一版呼叫了新版才有的 requestEmbeddingBatch_,在還沒上線的專案裡出現 ReferenceError——
 * 這正是要改成獨立的原因。)內部函式一律用 verify 開頭的專屬名稱,所以新版上線後同時存在也不會衝突。
 *
 * 使用流程:
 *   1. 把這個檔案上傳(貼進)Apps Script 專案(專案裡原本就有的程式不用動);
 *   2. 在「專案設定 → 指令碼屬性」新增 REINDEX_ENABLED = true;
 *   3. 在編輯器選 verifyBatchEmbedding → 執行 → 開啟「執行紀錄」;
 *   4. 把以「[驗證]」開頭的幾行貼回給維護者;
 *   5. 刪除 REINDEX_ENABLED 屬性與這個檔案。
 *
 * 結果怎麼用:
 *   - 「順序一致:否」→ 必須先處理順序問題才能繼續(檢索是以文章為單位取最小距離,錯位不會讓文章找不到,
 *     但會讓「命中的段落文字」對錯位置);
 *   - 「最大成功筆數」小於 40 → 把 src/Embeddings.gs 的 EMBEDDING_BATCH_MAX_ 下修到該數字,
 *     客戶端會自動分批送出。
 */

var VERIFY_PROPERTY_ = 'REINDEX_ENABLED';
// 與 src/Embeddings.gs 的 EMBEDDING_MODEL_NAME_ / EMBEDDING_DIMENSIONS_ 相同的值,但這裡自己定義一份
// (獨立性:不能引用尚未上線的程式)。只是驗證用,不需要與正式程式碼保持同步。
var VERIFY_MODEL_NAME_ = 'gemini-embedding-001';
var VERIFY_DIMENSIONS_ = 768;
var VERIFY_BASE_URL_ = 'https://generativelanguage.googleapis.com/v1beta/models/';
var VERIFY_SIZES_ = [40, 41, 100];
var VERIFY_ORDER_TEXTS_ = [
  'apple pie recipe with cinnamon and butter crust',
  'quantum field theory and gauge symmetry',
  '台北捷運路線圖與轉乘資訊'
];

function assertVerifyEnabled_() {
  var value = PropertiesService.getScriptProperties().getProperty(VERIFY_PROPERTY_);
  if (value !== 'true') {
    throw new Error('驗證函式未啟用:請先在「指令碼屬性」設定 ' + VERIFY_PROPERTY_ + ' = true');
  }
}

// 對 Gemini 發出一個請求。金鑰只放在標頭(不進網址、不進錯誤訊息);
// HTTP 錯誤時丟出的訊息只含狀態碼與回應文字的前 200 字。
function verifyPost_(endpoint, payload, apiKey) {
  var response = httpFetch_(VERIFY_BASE_URL_ + VERIFY_MODEL_NAME_ + ':' + endpoint, {
    method: 'post',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code >= 400) {
    throw new Error('HTTP ' + code + ': ' + String(text).slice(0, 200));
  }
  return JSON.parse(text);
}

function verifySingle_(text, apiKey) {
  var body = verifyPost_(
    'embedContent',
    {
      model: 'models/' + VERIFY_MODEL_NAME_,
      content: { parts: [{ text: text }] },
      outputDimensionality: VERIFY_DIMENSIONS_
    },
    apiKey
  );
  return body.embedding.values;
}

function verifyBatch_(texts, apiKey) {
  var body = verifyPost_(
    'batchEmbedContents',
    {
      requests: texts.map(function (text) {
        return {
          model: 'models/' + VERIFY_MODEL_NAME_,
          content: { parts: [{ text: text }] },
          outputDimensionality: VERIFY_DIMENSIONS_
        };
      })
    },
    apiKey
  );
  if (!Array.isArray(body.embeddings) || body.embeddings.length !== texts.length) {
    throw new Error('回傳的向量數(' + (body.embeddings ? body.embeddings.length : '無') + ')與請求(' + texts.length + ')不符');
  }
  return body.embeddings.map(function (item) {
    return item.values;
  });
}

function cosineSimilarity_(a, b) {
  var dot = 0;
  var na = 0;
  var nb = 0;
  for (var i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function verifyBatchEmbedding() {
  assertVerifyEnabled_();
  var config = getConfig_();
  if (!config.geminiApiKey) {
    throw new Error('缺少 Script Property: GEMINI_API_KEY');
  }

  // (a) 順序:批次結果的第 i 個,應該最接近單筆呼叫算出的第 i 個
  var singles = VERIFY_ORDER_TEXTS_.map(function (text) {
    return verifySingle_(text, config.geminiApiKey);
  });
  var batch = verifyBatch_(VERIFY_ORDER_TEXTS_, config.geminiApiKey);
  var orderOk = true;
  batch.forEach(function (vector, i) {
    var sims = singles.map(function (single) {
      return cosineSimilarity_(vector, single);
    });
    var best = sims.indexOf(Math.max.apply(null, sims));
    if (best !== i) orderOk = false;
    Logger.log(
      '[驗證] 批次第 ' + (i + 1) + ' 筆 與 單筆第 1/2/3 筆的相似度:' +
        sims
          .map(function (x) {
            return x.toFixed(4);
          })
          .join(' / ')
    );
  });
  Logger.log('[驗證] 順序一致:' + (orderOk ? '是' : '否'));

  // (b) 單次請求的筆數上限
  var maxOk = 0;
  var quotaHit = false;
  VERIFY_SIZES_.forEach(function (size) {
    var texts = [];
    for (var i = 0; i < size; i++) texts.push('verify ' + i);
    try {
      verifyBatch_(texts, config.geminiApiKey);
      maxOk = Math.max(maxOk, size);
      Logger.log('[驗證] ' + size + ' 筆 → 成功');
    } catch (e) {
      var message = String(e.message).slice(0, 200);
      if (/HTTP 429/.test(message)) {
        // 429 是「額度或速率限制」,不是「一個請求最多幾筆」。免費層每分鐘只有 100 個請求,
        // 而且(依 2026-10-03 的實測推論)批次裡每一筆文字都算一個——前面幾個測試已經用掉額度,
        // 後面的大批次就會 429。這種失敗不能拿來推論筆數上限。
        quotaHit = true;
        Logger.log('[驗證] ' + size + ' 筆 → 失敗:額度或速率限制(HTTP 429),不是筆數上限。' + message);
      } else {
        Logger.log('[驗證] ' + size + ' 筆 → 失敗:' + message);
      }
    }
  });
  Logger.log('[驗證] 最大成功筆數:' + maxOk + '(只測了 ' + VERIFY_SIZES_.join('、') + ')');
  if (maxOk >= 40) {
    Logger.log('[驗證] 結論:40 筆一個請求可行,EMBEDDING_BATCH_MAX_ = 40 不需要調整。');
  } else if (quotaHit) {
    Logger.log('[驗證] 結論:無法判斷——遇到額度或速率限制(429)。免費層每分鐘只有 100 個請求額度,請等一分鐘後重新執行這個函式。');
  } else {
    Logger.log('[驗證] 結論:單次上限小於 40,請把 EMBEDDING_BATCH_MAX_ 下修到不超過 ' + maxOk + '。');
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    verifyBatchEmbedding: verifyBatchEmbedding
  };
}
