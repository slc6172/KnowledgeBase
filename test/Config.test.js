const { loadGas } = require("./helpers/loadGas");
const { fakeLogger } = require("./helpers/testSetup");

describe("getConfig_", () => {
  beforeEach(() => {
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: () => null
      })
    };
    loadGas("../../src/Config.gs");
  });

  test("throws naming SUPABASE_URL when it is missing", () => {
    expect(() => getConfig_()).toThrow(/SUPABASE_URL/);
  });

  test("throws naming EDGE_PROXY_SECRET when only that is missing (no service_role key is needed any more)", () => {
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => (key === "SUPABASE_URL" ? "https://x.supabase.co" : null)
      })
    };
    expect(() => getConfig_()).toThrow(/EDGE_PROXY_SECRET/);
  });

  test("mycr F-10: rejects a non-https SUPABASE_URL, because X-KB-Proxy-Secret would otherwise be sent in cleartext", () => {
    ["http://x.supabase.co", "ftp://x.supabase.co", "x.supabase.co"].forEach((badUrl) => {
      global.PropertiesService = {
        getScriptProperties: () => ({
          getProperty: (key) => (key === "SUPABASE_URL" ? badUrl : "some-secret-value")
        })
      };
      expect(() => getConfig_()).toThrow(/SUPABASE_URL.*https/);
      // 錯誤訊息不得回顯共用密鑰
      try {
        getConfig_();
      } catch (e) {
        expect(String(e.message)).not.toContain("some-secret-value");
      }
    });
  });

  test("mycr F-10: accepts an https SUPABASE_URL regardless of letter case in the scheme", () => {
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => (key === "SUPABASE_URL" ? "HTTPS://x.supabase.co/" : "some-secret-value")
      })
    };
    expect(getConfig_().supabaseUrl).toBe("HTTPS://x.supabase.co");
  });

  test("returns config with a trailing slash stripped from the URL, GEMINI_API_KEY optional", () => {
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => {
          if (key === "SUPABASE_URL") return "https://x.supabase.co/";
          if (key === "EDGE_PROXY_SECRET") return "proxy-secret";
          return null; // GEMINI_API_KEY not set
        }
      })
    };
    expect(getConfig_()).toEqual({
      supabaseUrl: "https://x.supabase.co",
      edgeProxySecret: "proxy-secret",
      geminiApiKey: null
    });
  });

  test("trims accidental leading/trailing whitespace or newlines from pasted values", () => {
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => {
          if (key === "SUPABASE_URL") return "  https://x.supabase.co \n";
          if (key === "EDGE_PROXY_SECRET") return "\nproxy-secret  ";
          if (key === "GEMINI_API_KEY") return " gem-key\n";
          return null;
        }
      })
    };
    expect(getConfig_()).toEqual({
      supabaseUrl: "https://x.supabase.co",
      edgeProxySecret: "proxy-secret",
      geminiApiKey: "gem-key"
    });
  });
});

describe("debugConfig_", () => {
  function setupProps(writePassword) {
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => {
          if (key === "SUPABASE_URL") return "https://x.supabase.co";
          if (key === "EDGE_PROXY_SECRET") return "p".repeat(64);
          if (key === "GEMINI_API_KEY") return "gem-key-123456789";
          if (key === "WRITE_PASSWORD") return writePassword;
          return null;
        }
      })
    };
  }

  test("prints only the length of EDGE_PROXY_SECRET, never any fragment of it, and never mentions service_role", () => {
    const secret = "abcdefghij".repeat(6) + "wxyz"; // 64 字元,開頭/結尾都有可辨識片段
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => {
          if (key === "SUPABASE_URL") return "https://x.supabase.co";
          if (key === "EDGE_PROXY_SECRET") return secret;
          if (key === "GEMINI_API_KEY") return "gem-key-123456789";
          if (key === "WRITE_PASSWORD") return "a-plenty-long-write-password";
          return null;
        }
      })
    };
    const logger = fakeLogger();
    loadGas("../../src/Config.gs");
    loadGas("../../src/Auth.gs");

    debugConfig_();

    const line = logger.logs.find((l) => l.indexOf("EDGE_PROXY_SECRET") === 0);
    expect(line).toBeDefined();
    expect(line).toMatch(/64 字元/);
    expect(line).not.toMatch(/abcdefgh/); // 開頭片段
    expect(line).not.toMatch(/wxyz/); // 結尾片段
    expect(line).not.toMatch(/建議/); // 夠長,沒有警告
    expect(logger.logs.join("\n")).not.toMatch(/service_role|SERVICE_ROLE/i);
  });

  test("warns when EDGE_PROXY_SECRET is shorter than 32 characters, still without logging any part of it", () => {
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => {
          if (key === "SUPABASE_URL") return "https://x.supabase.co";
          if (key === "EDGE_PROXY_SECRET") return "short-secret-abc";
          if (key === "GEMINI_API_KEY") return "gem-key-123456789";
          if (key === "WRITE_PASSWORD") return "a-plenty-long-write-password";
          return null;
        }
      })
    };
    const logger = fakeLogger();
    loadGas("../../src/Config.gs");
    loadGas("../../src/Auth.gs");

    debugConfig_();

    const line = logger.logs.find((l) => l.indexOf("EDGE_PROXY_SECRET") === 0);
    expect(line).toMatch(/16 字元/);
    expect(line).toMatch(/建議至少 32/);
    expect(line).not.toMatch(/short-secret/);
    expect(line).not.toMatch(/abc/);
  });

  test("mycr F-05 fix: warns when WRITE_PASSWORD is shorter than the recommended minimum, without ever logging any part of the password itself", () => {
    setupProps("short1");
    const logger = fakeLogger();
    loadGas("../../src/Config.gs");
    loadGas("../../src/Auth.gs");

    debugConfig_();

    const writePasswordLine = logger.logs.find((l) => l.indexOf("WRITE_PASSWORD") === 0);
    expect(writePasswordLine).toBeDefined();
    expect(writePasswordLine).toMatch(/6 字元/);
    expect(writePasswordLine).toMatch(/建議/); // 有警告字樣
    expect(writePasswordLine).not.toMatch(/short1/); // 絕對不能包含密碼本身
  });

  test("mycr F-05 fix: no warning when WRITE_PASSWORD already meets the recommended minimum length", () => {
    setupProps("a-plenty-long-write-password");
    const logger = fakeLogger();
    loadGas("../../src/Config.gs");
    loadGas("../../src/Auth.gs");

    debugConfig_();

    const writePasswordLine = logger.logs.find((l) => l.indexOf("WRITE_PASSWORD") === 0);
    expect(writePasswordLine).toBeDefined();
    expect(writePasswordLine).not.toMatch(/建議/);
  });
});
