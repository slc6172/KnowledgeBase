const { loadGas } = require("./helpers/loadGas");

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

describe("setupScriptProperties", () => {
  test("writes SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY and WRITE_PASSWORD", () => {
    const setProperties = jest.fn();
    global.PropertiesService = {
      getScriptProperties: () => ({ setProperties })
    };
    loadGas("../../src/Config.gs");

    setupScriptProperties_();

    expect(setProperties).toHaveBeenCalledTimes(1);
    expect(Object.keys(setProperties.mock.calls[0][0]).sort()).toEqual([
      "GEMINI_API_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_URL",
      "WRITE_PASSWORD"
    ]);
  });
});
