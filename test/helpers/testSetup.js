const { loadGas } = require("./loadGas");

function fakeConfig() {
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => {
        if (key === "SUPABASE_URL") return "https://x.supabase.co";
        if (key === "SUPABASE_SERVICE_ROLE_KEY") return "srv-key";
        return null;
      }
    })
  };
}

function fakeConfigWithGemini() {
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => {
        if (key === "SUPABASE_URL") return "https://x.supabase.co";
        if (key === "SUPABASE_SERVICE_ROLE_KEY") return "srv-key";
        if (key === "GEMINI_API_KEY") return "gem-key";
        return null;
      }
    })
  };
}

/**
 * password 傳 null/undefined 模擬「WRITE_PASSWORD 這個 Script Property 根本沒設定」。
 */
function fakeConfigWithWritePassword(password) {
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => {
        if (key === "SUPABASE_URL") return "https://x.supabase.co";
        if (key === "SUPABASE_SERVICE_ROLE_KEY") return "srv-key";
        if (key === "WRITE_PASSWORD") return password || null;
        return null;
      }
    })
  };
}

/**
 * RagChat.gs 需要同時驗證寫入密碼(共用 isValidWritePassword_)跟呼叫 Gemini
 * (需要 GEMINI_API_KEY),比照 fakeConfigWithWritePassword 的模式加輔助函式。
 */
function fakeConfigWithWritePasswordAndGemini(password) {
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => {
        if (key === "SUPABASE_URL") return "https://x.supabase.co";
        if (key === "SUPABASE_SERVICE_ROLE_KEY") return "srv-key";
        if (key === "WRITE_PASSWORD") return password || null;
        if (key === "GEMINI_API_KEY") return "gem-key";
        return null;
      }
    })
  };
}

function fakeResponse(code, bodyText) {
  return {
    getResponseCode: () => code,
    getContentText: () => bodyText
  };
}

function loadCoreGas() {
  fakeConfig();
  loadGas("../../src/Config.gs");
  loadGas("../../src/HttpTransport.gs");
  loadGas("../../src/ErrorHandling.gs");
  loadGas("../../src/SupabaseClient.gs");
}

function fakeUtilities(uuid) {
  global.Utilities = {
    base64Decode: (base64Str) => {
      // 模擬 Apps Script 的行為:回傳一個「位元組陣列」(用 Buffer 算出正確長度即可,
      // 測試只在乎陣列長度跟內容是否可預期,不需要跟真正的 Apps Script 型別一致)。
      const buf = Buffer.from(base64Str, "base64");
      return Array.from(buf);
    },
    getUuid: () => uuid || "fixed-uuid"
  };
}

/**
 * 模擬 Apps Script 的 CacheService.getScriptCache()——真正的服務是所有執行個體
 * 共用同一份快取,測試環境用一個模組層級的 Map 模擬同樣的「跨呼叫持續存在」
 * 行為,足夠驗證語意搜尋頻率限制這種「呼叫幾次之後開始拒絕」的邏輯,不需要
 * 真的實作過期時間的精確語意(get 完全不管 TTL,每個測試呼叫 fakeCacheService()
 * 時都會重新開一個乾淨的 Map,測試之間不會互相汙染)。
 */
function fakeCacheService() {
  var store = new Map();
  global.CacheService = {
    getScriptCache: () => ({
      get: (key) => (store.has(key) ? store.get(key) : null),
      put: (key, value) => {
        store.set(key, value);
      },
      remove: (key) => {
        store.delete(key);
      }
    })
  };
}

/**
 * 模擬 Apps Script 的 HtmlService——只需要 include() 用到的
 * createHtmlOutputFromFile(filename).getContent() 這條鏈,不需要模擬
 * doGet 用的 createTemplateFromFile/evaluate/setTitle/addMetaTag 那整條
 * (doGet 本身沒有可測的邏輯分支,見 WebApp.gs 的註解,目前沒有對應測試)。
 */
function fakeHtmlService() {
  global.HtmlService = {
    createHtmlOutputFromFile: (filename) => ({
      getContent: () => 'content:' + filename
    }),
    // doGet() 一直沒有任何測試覆蓋(mycr 這輪用 jest --coverage 才發現)——
    // 原因之一就是這個 fake 之前只支援 include() 用到的
    // createHtmlOutputFromFile,沒有支援 doGet() 用到的
    // createTemplateFromFile。這裡補上一個最小可用的假模板物件:記錄設到
    // 模板上的屬性(例如 initialArticleId),並讓 evaluate()/setTitle()/
    // addMetaTag() 可以照真正的鏈式呼叫方式串起來,最後回傳的物件上留一個
    // __template 參照,方便測試斷言模板屬性有沒有被設成正確的值。
    createTemplateFromFile: (filename) => {
      var template = { __filename: filename };
      template.evaluate = function () {
        var output = {
          __template: template,
          __title: null,
          __metaTags: [],
          setTitle: function (title) {
            output.__title = title;
            return output;
          },
          addMetaTag: function (name, content) {
            output.__metaTags.push([name, content]);
            return output;
          }
        };
        return output;
      };
      return template;
    }
  };
}

/**
 * 模擬 Apps Script 的 Logger.log——只需要記錄每次呼叫的內容，讓測試能斷言
 * 「上游服務錯誤」轉換機制有沒有把完整原始內容寫進執行紀錄。回傳的物件上的
 * logs 陣列會即時反映後續呼叫，不需要重新取得參照。
 */
function fakeLogger() {
  var logs = [];
  global.Logger = {
    log: (message) => {
      logs.push(message);
    }
  };
  return { logs: logs };
}

/**
 * 模擬 Apps Script 的 LockService.getScriptLock()——測試環境是單執行緒,
 * 不需要真的模擬鎖等待/衝突,只需要讓 waitLock/releaseLock 可以被呼叫、
 * 不拋錯,並記錄呼叫次數/參數方便測試斷言「真的有把某段程式碼包在鎖裡」。
 */
function fakeLockService() {
  var waitLockCalls = [];
  var releaseLockCalls = 0;
  global.LockService = {
    getScriptLock: () => ({
      waitLock: (timeoutMs) => {
        waitLockCalls.push(timeoutMs);
      },
      releaseLock: () => {
        releaseLockCalls++;
      }
    })
  };
  return {
    waitLockCalls: waitLockCalls,
    get releaseLockCalls() { return releaseLockCalls; }
  };
}

module.exports = {
  fakeConfig,
  fakeConfigWithGemini,
  fakeConfigWithWritePassword,
  fakeConfigWithWritePasswordAndGemini,
  fakeUtilities,
  fakeCacheService,
  fakeHtmlService,
  fakeLockService,
  fakeLogger,
  fakeResponse,
  loadCoreGas
};
