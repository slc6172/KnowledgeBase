/**
 * 共用密碼守門員。寫入類操作(建立/編輯/刪除文章、附件、分類)一律經過
 * callProtected(password, functionName, args)——前端所有寫入類的
 * google.script.run 呼叫都改成呼叫這個函式,不再直接呼叫下面的白名單函式本身。
 * RagChat.gs 的 askKnowledgeBase 是讀取類操作,不在白名單裡、不經過
 * callProtected,但仍需要驗證密碼,共用同一份 isValidWritePassword_ 判斷式。
 * 讀取類函式(listArticles、getArticle、listAttachments、listFolders、
 * getSignedAttachmentUrl、getTextAttachmentContent、listCategories、listTags、
 * countTagUsage、searchArticles、getRelatedArticles)完全不經過密碼驗證,任何人都
 * 能直接呼叫,對應「未登入則僅能閱讀」——但這 11 個函式仍然共用下面
 * checkPublicReadRateLimit_ 這一層,跟密碼是兩件不同的事:密碼管的是「能不能
 * 寫入/問 AI」,這一層管的是「這個知識庫不用登入 Google 就能連線,任何人反覆
 * 呼叫這些讀取函式都會消耗部署者帳號的 Apps Script UrlFetch 每日配額(一般
 * 帳號每天硬性上限 20,000 次,無法用付費解除),沒有上限的話,燒光配額之後
 * 連擁有者自己都連不上 Supabase」。(listFolders 先前沒被列進這份清單,是
 * 遺漏,細節見 Attachments.gs 對應函式上面的註解。)
 */

// 公開讀取函式(上面列的 11 個)共用的每小時上限——保護的是 Apps Script 本身
// 的 UrlFetch 每日配額,不是 Gemini 額度(Gemini 額度另外由 Search.gs 的
// SEMANTIC_SEARCH_RATE_LIMIT_ 負責,兩者是不同資源,searchArticles 兩層都要
// 過)。寫入路徑(callProtected/askKnowledgeBase)已經有密碼+失敗鎖定擋著,
// 不需要再套用這一層給匿名訪客用的節流。寫成獨立變數方便之後依實際用量調整。
// 用 CacheService 做一個以「整點」對齊的固定時間窗口計數器——Math.floor(現在
// 時間 / 3600000) 在每個 UTC 整點變動,對這個專案設定的 Asia/Taipei
// (UTC+8,整數小時時區)來說,UTC 整點跟台北時間整點是同一個時間點,所以這
// 天然就是「用整點來區隔」,不需要額外的時區換算;不是從第一次呼叫起算的
// 滑動 1 小時,到整點就整批歸零,不是精準的滑動窗口,但比較容易對應「這一個
// 小時燒了多少配額」這種直覺的問法,也夠用。
var PUBLIC_READ_RATE_LIMIT_PER_HOUR_ = 2000;
var PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ = 3600;

function checkPublicReadRateLimit_() {
  var cache = CacheService.getScriptCache();
  var hourKey =
    'public_read_' + Math.floor(Date.now() / (PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_ * 1000));
  var current = Number(cache.get(hourKey)) || 0;
  if (current >= PUBLIC_READ_RATE_LIMIT_PER_HOUR_) {
    throw new Error('目前使用量過大,請稍後再試');
  }
  cache.put(hourKey, String(current + 1), PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_);
}

/**
 * 對上面這個函式、以及 Search.gs 的 checkSemanticSearchRateLimit_、下面的
 * 密碼鎖定機制,做過一次紅隊角度的自我複查,記錄兩個已知、接受的限制(不是
 * 需要修的 bug,是 CacheService 這個工具本身的固有特性):
 *
 * 1. get 再 put 不是原子操作——沒有 compare-and-swap。極端狀況下,如果大量
 *    請求剛好在同一瞬間並發到達(例如剛好卡在上限附近),有可能同時讀到同一個
 *    舊值、各自加一再寫回去,等於少算了幾次增量,實際能通過的次數會比設定的
 *    上限略高一點點。這些數字(2000/hr、20/min、10 次鎖定)本來就是抓「數量級
 *    正確」的節流閘門,不是要做到精確計數,這個誤差不影響它們原本要擋的濫用
 *    情境(持續性爬蟲、暴力破解),不需要為了理論上的邊界情況換成更複雜的
 *    分散式鎖定機制。
 * 2. 這三層節流都依賴 CacheService——如果 Apps Script 的 CacheService 本身
 *    暫時故障,這些函式會直接拋出例外,而不是「放行當作沒有這層保護」,等於
 *    在 CacheService 罕見故障期間,包含讀取在內的整個 app 都會連帶壞掉,
 *    而不是只有節流功能失效。這是刻意接受的權衡:對安全機制來說,「故障時
 *    直接拒絕(fail closed)」通常比「故障時直接放行(fail open)」更安全,
 *    寧可暫時連自己都連不上,也不要在保護機制失效的當下完全不設防。
 * 3. 三層節流的計數器 key 都是全站共用的固定字串,不分呼叫端(不是每個 IP/
 *    session 各自一份配額)。這代表反過來看,單一匿名訪客理論上可以直接
 *    把某一層的額度在短時間內用完,讓當下所有其他訪客一起被擋下來
 *    (讀取/語意搜尋節流),或是讓密碼鎖定持續處於鎖定狀態、任何持有正確
 *    密碼的人在那段時間內都寫不進去——是拿防禦機制本身,對其他訪客/管理者
 *    發動短暫的阻斷服務,而不是原本要擋的「單一惡意來源長期濫用」那種情境。
 *    刻意接受、不拆成每 IP/session 各自計數的理由:(a) 拆開之後,判斷「同一個
 *    呼叫端」本身也不可靠——Apps Script 沒有現成、值得信任的客戶端識別依據
 *    (前端傳來的任何 id 都是呼叫端自己說了算,一樣可以偽造/輪換來繞過),
 *    真的要做，需要額外的識別機制，複雜度換來的防護效果有限;(b) 全站共用
 *    計數器造成的「阻斷」本來就是暫時性的(讀取節流整點重置、語意搜尋節流
 *    每分鐘重置),密碼鎖定的視窗也只有 5 分鐘,不是永久性的拒絕服務;(c) 這
 *    跟完全不設節流比,仍然大幅提高了長期、持續性濫用(燒光 Apps Script/
 *    Gemini 配額、密碼暴力破解)的成本,只是沒辦法同時防住「短暫、一次性讓
 *    別人不方便」這種低成本騷擾。以後如果實際觀測到這被拿來當騷擾手段,再
 *    考慮拆成更細的計數粒度。
 */
function getWritePassword_() {
  var value = PropertiesService.getScriptProperties().getProperty('WRITE_PASSWORD');
  value = value ? value.trim() : value;
  if (!value) {
    throw new Error('缺少 Script Property: WRITE_PASSWORD(尚未設定寫入密碼,無法使用任何寫入功能)');
  }
  return value;
}

/**
 * 白名單:只有這 20 個寫入類函式能透過 callProtected 呼叫,刻意不用
 * this[functionName]/globalThis[functionName] 這種動態呼叫任意全域函式的寫法——
 * 白名單以外一律視為不支援的操作,即使是本專案裡的其他函式(例如讀取類的
 * listArticles)也不行,呼叫端一定要走各自對應的公開函式。
 */
function dispatchProtectedCall_(functionName, args) {
  switch (functionName) {
    case 'createArticle':
      return createArticle_.apply(null, args);
    case 'updateArticle':
      return updateArticle_.apply(null, args);
    case 'deleteArticle':
      return deleteArticle_.apply(null, args);
    case 'setArticleStatus':
      return setArticleStatus_.apply(null, args);
    case 'uploadAttachmentFile':
      return uploadAttachmentFile_.apply(null, args);
    case 'addAttachmentUrl':
      return addAttachmentUrl_.apply(null, args);
    case 'deleteAttachment':
      return deleteAttachment_.apply(null, args);
    case 'createFolder':
      return createFolder_.apply(null, args);
    case 'renameFolder':
      return renameFolder_.apply(null, args);
    case 'deleteFolder':
      return deleteFolder_.apply(null, args);
    case 'createCategory':
      return createCategory_.apply(null, args);
    case 'updateCategory':
      return updateCategory_.apply(null, args);
    case 'moveCategory':
      return moveCategory_.apply(null, args);
    case 'deleteCategory':
      return deleteCategory_.apply(null, args);
    case 'renameTag':
      return renameTag_.apply(null, args);
    case 'deleteTag':
      return deleteTag_.apply(null, args);
    case 'mergeTags':
      return mergeTags_.apply(null, args);
    case 'batchDeleteArticles':
      return batchDeleteArticles_.apply(null, args);
    case 'batchSetArticlesCategory':
      return batchSetArticlesCategory_.apply(null, args);
    case 'batchAddTagsToArticles':
      return batchAddTagsToArticles_.apply(null, args);
    default:
      throw new Error('不支援的操作: ' + functionName);
  }
}

/**
 * 密碼是否正確——只回傳 boolean,不拋出「密碼錯誤」(拋錯是呼叫端的責任,
 * 不是這個判斷式本身)。若 WRITE_PASSWORD 這個 Script Property 本身沒設定,
 * getWritePassword_() 會丟出對應的設定錯誤,這裡不吞掉,原樣往外傳——那是
 * 環境設定問題,跟「密碼答錯」是兩回事。
 *
 * callProtected(寫入白名單)跟 RagChat.gs 的 askKnowledgeBase(讀取類但仍需
 * 密碼)共用這個判斷式,避免兩處密碼比對邏輯各自維護、以後改規則(例如要不要
 * trim、大小寫)容易不同步。
 *
 * 用 constantTimeEquals_ 而不是原生 ===:原本的評估(spec_security_hardening.md
 * 的 Out of Scope)認為密碼鎖定機制已經把單一時間窗口內能嘗試的次數壓得很低
 * (10 次/5 分鐘),要在這麼小的樣本數裡靠時間側信道統計出有意義的訊號,實務
 * 上已經很難——這個結論本身沒有錯,但成本幾乎是零(不需要額外的相依套件、
 * 不影響任何既有行為),換一個不會提早跳出迴圈的比較方式,直接把「要不要靠
 * 統計去賭這條路徑實際上有多難」這個問題本身消掉,不需要再依賴「樣本數太少」
 * 這個前提是否永遠成立。
 */
function isValidWritePassword_(password) {
  return constantTimeEquals_(password, getWritePassword_());
}

/**
 * 常數時間字串比對——不管輸入內容在哪裡第一次跟目標不一樣,都跑完同樣長度
 * 的迴圈才回傳結果,避免用「回應快慢」猜出密碼的哪一段字元先比對失敗。這裡
 * 刻意不在迴圈中途因為找到一個不相符的字元就提早 return(原生 === 底層的
 * 字串比較通常就是找到第一個不同的字元就停),也刻意不因為長度不同就提早
 * return——長度不同時,拿 a 自己的內容當比較對象(必定相等),讓迴圈一樣跑滿
 * a.length 次,最後再用 lengthsMatch 決定真正的比對結果,確保「長度對不對」
 * 跟「內容對不對」都不會透過提早結束迴圈被觀察到。這不是真正密碼學等級的
 * 常數時間保證(JS 引擎本身的 JIT、GC 等都可能引入額外的時間變異,Apps
 * Script 的執行環境也不是為了抵禦側信道攻擊設計的),只是把最主要的那個
 * 「明顯提早結束」訊號拿掉。
 */
function constantTimeEquals_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  var lengthsMatch = a.length === b.length;
  var compareTarget = lengthsMatch ? b : a;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ compareTarget.charCodeAt(i);
  }
  return lengthsMatch && diff === 0;
}

/**
 * 密碼錯誤鎖定機制——這個知識庫不用登入 Google 就能連線,`isValidWritePassword_`
 * 單純是字串比對,沒有這層防護的話,任何人都能寫程式對 callProtected/
 * askKnowledgeBase 做暴力破解,而且每次嘗試都要消耗部署者帳號的 Apps Script
 * 執行配額,等於順便是一支免費的 DoS。這兩個數字獨立寫成變數,方便之後依實際
 * 情況調整。用 CacheService(所有執行個體共用同一份)記錄一段時間窗口內的
 * 失敗次數,超過門檻就直接拒絕、連密碼比對都不做——鎖定期間內即使密碼答對
 * 也一律拒絕,不然「這次答對了但被鎖住」跟「這次答錯」對外的回應不同,等於
 * 洩漏「這次密碼對不對」這個資訊,失去鎖定的意義。callProtected(寫入白名單)
 * 跟 askKnowledgeBase(讀取類但仍需密碼)共用同一個計數器,不分呼叫端——
 * 兩邊面對的是同一個攻擊者、同一組密碼,不能各自獨立計算。錯誤訊息刻意不含
 * 「密碼錯誤」四個字,避免跟前端「偵測到密碼被使用者手動改過」那段
 * (比對 err.message 是否含「密碼錯誤」)搞混,誤把鎖定當成密碼真的錯了而
 * 清掉快取。
 */
var PASSWORD_LOCKOUT_MAX_FAILURES_ = 10;
var PASSWORD_LOCKOUT_WINDOW_SECONDS_ = 300;
var PASSWORD_LOCKOUT_CACHE_KEY_ = 'write_password_failures';

function assertNotLockedOutOnPassword_() {
  var failures = Number(CacheService.getScriptCache().get(PASSWORD_LOCKOUT_CACHE_KEY_)) || 0;
  if (failures >= PASSWORD_LOCKOUT_MAX_FAILURES_) {
    throw new Error('嘗試次數過多,請稍後再試');
  }
}

/**
 * 密碼答對就清空失敗計數(避免正常使用者之前手誤的幾次繼續累計、提早卡到
 * 門檻);答錯就把失敗次數加一,並設定 TTL 讓計數隨時間窗口自動歸零。
 */
function recordPasswordAttemptResult_(wasValid) {
  var cache = CacheService.getScriptCache();
  if (wasValid) {
    cache.remove(PASSWORD_LOCKOUT_CACHE_KEY_);
    return;
  }
  var failures = Number(cache.get(PASSWORD_LOCKOUT_CACHE_KEY_)) || 0;
  cache.put(PASSWORD_LOCKOUT_CACHE_KEY_, String(failures + 1), PASSWORD_LOCKOUT_WINDOW_SECONDS_);
}

/**
 * 密碼比對 + 記錄嘗試結果,整段包在 LockService 的鎖裡(mycr F-05 修正)。
 * 原本 assertNotLockedOutOnPassword_/recordPasswordAttemptResult_ 是各自
 * 獨立的 CacheService get→put,兩步驟之間沒有鎖——Apps Script 允許同一
 * 使用者最多 30 個並行執行,大量平行的密碼猜測請求,可能會讓好幾個執行緒
 * 都讀到同一個「尚未更新」的失敗次數,各自判斷「還沒到門檻」放行、各自把
 * 同一個舊數字加一再寫回去,實際上鎖定計數器可能只被推進遠低於真正嘗試
 * 次數的量——這對讀取節流這類「數量級正確即可」的閘門來說只是可忽略的
 * 誤差,但對密碼鎖定這個機制原本要保護的「暴力破解要花多久」這個性質來說,
 * 差距可以達到一個數量級,不是無關緊要的誤差。密碼嘗試本來就不該高頻,
 * 鎖的成本可以忽略。callProtected(寫入白名單)、askKnowledgeBase
 * (RagChat.gs)都呼叫這裡,不要各自重複實作一次「檢查鎖定 → 比對密碼 →
 * 記錄結果」這段邏輯。
 */
function checkPasswordAndRecordAttempt_(password) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    assertNotLockedOutOnPassword_();
    var valid = isValidWritePassword_(password);
    recordPasswordAttemptResult_(valid);
    return valid;
  } finally {
    lock.releaseLock();
  }
}

function callProtected(password, functionName, args) {
  var valid = checkPasswordAndRecordAttempt_(password);
  if (!valid) {
    throw new Error('密碼錯誤');
  }
  return withSafeErrors_(functionName, function () {
    return dispatchProtectedCall_(functionName, args || []);
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    callProtected: callProtected,
    checkPasswordAndRecordAttempt_: checkPasswordAndRecordAttempt_,
    getWritePassword_: getWritePassword_,
    isValidWritePassword_: isValidWritePassword_,
    constantTimeEquals_: constantTimeEquals_,
    assertNotLockedOutOnPassword_: assertNotLockedOutOnPassword_,
    recordPasswordAttemptResult_: recordPasswordAttemptResult_,
    PASSWORD_LOCKOUT_MAX_FAILURES_: PASSWORD_LOCKOUT_MAX_FAILURES_,
    PASSWORD_LOCKOUT_WINDOW_SECONDS_: PASSWORD_LOCKOUT_WINDOW_SECONDS_,
    checkPublicReadRateLimit_: checkPublicReadRateLimit_,
    PUBLIC_READ_RATE_LIMIT_PER_HOUR_: PUBLIC_READ_RATE_LIMIT_PER_HOUR_,
    PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_: PUBLIC_READ_RATE_LIMIT_WINDOW_SECONDS_
  };
}
