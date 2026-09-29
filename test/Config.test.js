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

  test("throws naming SUPABASE_SERVICE_ROLE_KEY when only that is missing", () => {
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => (key === "SUPABASE_URL" ? "https://x.supabase.co" : null)
      })
    };
    expect(() => getConfig_()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  test("returns config with a trailing slash stripped from the URL, GEMINI_API_KEY optional", () => {
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => {
          if (key === "SUPABASE_URL") return "https://x.supabase.co/";
          if (key === "SUPABASE_SERVICE_ROLE_KEY") return "srv-key";
          return null; // GEMINI_API_KEY not set
        }
      })
    };
    expect(getConfig_()).toEqual({
      supabaseUrl: "https://x.supabase.co",
      serviceRoleKey: "srv-key",
      geminiApiKey: null
    });
  });

  test("trims accidental leading/trailing whitespace or newlines from pasted values", () => {
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => {
          if (key === "SUPABASE_URL") return "  https://x.supabase.co \n";
          if (key === "SUPABASE_SERVICE_ROLE_KEY") return "\nsrv-key  ";
          if (key === "GEMINI_API_KEY") return " gem-key\n";
          return null;
        }
      })
    };
    expect(getConfig_()).toEqual({
      supabaseUrl: "https://x.supabase.co",
      serviceRoleKey: "srv-key",
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
          if (key === "SUPABASE_SERVICE_ROLE_KEY") return "srv-key-123456789";
          if (key === "GEMINI_API_KEY") return "gem-key-123456789";
          if (key === "WRITE_PASSWORD") return writePassword;
          return null;
        }
      })
    };
  }

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
