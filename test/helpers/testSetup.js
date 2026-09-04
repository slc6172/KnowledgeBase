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

module.exports = {
  fakeConfig,
  fakeConfigWithGemini,
  fakeConfigWithWritePassword,
  fakeConfigWithWritePasswordAndGemini,
  fakeUtilities,
  fakeResponse,
  loadCoreGas
};
