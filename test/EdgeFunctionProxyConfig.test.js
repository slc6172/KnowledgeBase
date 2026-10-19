// kb-proxy Edge Function 的靜態設定檢查(讀原始檔文字斷言,專案既有風格)。
// 代理核心本身的行為測試是 Deno 測試(supabase/functions/kb-proxy/handler_test.ts),
// 這裡只守住「Jest 這一側能看見、且容易被悄悄改壞」的設定。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("kb-proxy 函式設定檔", () => {
  test("明確宣告關閉平台 JWT 驗證(新版 API key 不是 JWT,預設值會讓 GAS 全部 401)", () => {
    const toml = read("supabase/config.toml");
    expect(toml).toMatch(/^\[functions\.kb-proxy\]\s*\nverify_jwt\s*=\s*false\s*$/m);
  });

  test("進入點把 Deno 執行環境的 env 與 fetch 注入 handleRequest", () => {
    const entry = read("supabase/functions/kb-proxy/index.ts");
    expect(entry).toMatch(/handleRequest/);
    expect(entry).toMatch(/Deno\.serve/);
    expect(entry).toMatch(/Deno\.env/);
  });
});

describe("Jest 與 Deno 測試互不干擾", () => {
  test("Jest 設定排除 supabase/ 目錄,不會誤把 Deno 測試檔當成 Jest 測試", () => {
    const config = require("../jest.config.js");
    const ignore = config.testPathIgnorePatterns || [];
    expect(ignore.some((pattern) => new RegExp(pattern).test("/repo/supabase/functions/kb-proxy/x.test.ts"))).toBe(true);
  });

  test("代理核心與測試不使用遠端 URL 或 jsr: 匯入(沙箱與供應鏈限制)", () => {
    for (const rel of ["supabase/functions/kb-proxy/handler.ts", "supabase/functions/kb-proxy/handler_test.ts"]) {
      const source = read(rel);
      expect(source).not.toMatch(/from\s+["'](https?:|jsr:|npm:)/);
      expect(source).not.toMatch(/import\s*\(\s*["'](https?:|jsr:|npm:)/);
    }
  });
});

describe("代理白名單與資料庫 schema、GAS 呼叫點保持一致(忘記更新白名單時立刻發現)", () => {
  const handler = read("supabase/functions/kb-proxy/handler.ts");
  const listOf = (name) => {
    const m = handler.match(new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`));
    return m[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1)).sort();
  };

  // 刻意不對 GAS 開放的資料表:所有讀寫都經資料庫函式(save_article / articles_needing_reindex …),
  // GAS 完全不需要直接存取。要新增這類資料表必須明確寫在這裡——忘了加進白名單的表會讓下一個測試變紅,
  // 而不是被悄悄當成「刻意不開放」。
  const INTENTIONALLY_PRIVATE_TABLES = ["article_chunks"];

  test("資料表白名單 = schema 檔裡所有 create table − 刻意不對外開放的清單", () => {
    const schema = read("docs/schema.sql");
    const tables = [...schema.matchAll(/^create table (?:if not exists )?(\w+)/gim)]
      .map((m) => m[1])
      .filter((name) => !INTENTIONALLY_PRIVATE_TABLES.includes(name))
      .sort();
    expect(listOf("ALLOWED_TABLES")).toEqual(tables);
  });

  test("刻意不開放的資料表確實存在於 schema,而且沒有出現在白名單(清單不會悄悄過期)", () => {
    const schema = read("docs/schema.sql");
    const allTables = [...schema.matchAll(/^create table (?:if not exists )?(\w+)/gim)].map((m) => m[1]);
    for (const name of INTENTIONALLY_PRIVATE_TABLES) {
      expect(allTables).toContain(name);
      expect(listOf("ALLOWED_TABLES")).not.toContain(name);
    }
  });

  test("GAS 沒有任何程式直接存取刻意不開放的資料表(只能透過資料庫函式)", () => {
    const srcDir = path.join(ROOT, "src");
    const all = fs.readdirSync(srcDir).filter((f) => f.endsWith(".gs")).map((f) => read(`src/${f}`)).join("\n");
    for (const name of INTENTIONALLY_PRIVATE_TABLES) {
      expect(all).not.toMatch(new RegExp("supabase(?:Select|Insert|Update|Delete)_\\('" + name + "'"));
    }
  });

  test("RPC 白名單 = schema 檔裡所有對外 RPC(排除 touch_updated_at 觸發器函式)", () => {
    const schema = read("docs/schema.sql");
    const fns = [...schema.matchAll(/^create or replace function (\w+)\(/gim)]
      .map((m) => m[1])
      .filter((name) => name !== "touch_updated_at")
      .sort();
    expect(listOf("ALLOWED_RPCS")).toEqual(fns);
  });

  test("GAS 現行呼叫的每張資料表與每個 RPC 都在白名單內", () => {
    const srcDir = path.join(ROOT, "src");
    const all = fs.readdirSync(srcDir).filter((f) => f.endsWith(".gs")).map((f) => read(`src/${f}`)).join("\n");
    const tables = new Set([...all.matchAll(/supabase(?:Select|Insert|Update|Delete)_\('(\w+)'/g)].map((m) => m[1]));
    const rpcs = new Set([...all.matchAll(/supabaseRpc_\('(\w+)'/g)].map((m) => m[1]));
    expect(tables.size).toBeGreaterThan(0);
    expect(rpcs.size).toBeGreaterThan(0);
    for (const t of tables) expect(listOf("ALLOWED_TABLES")).toContain(t);
    for (const r of rpcs) expect(listOf("ALLOWED_RPCS")).toContain(r);
  });

  test("Storage 只放行 attachments bucket,且 GAS 只對這個 bucket 呼叫 Storage", () => {
    expect(handler).toMatch(/export const ALLOWED_BUCKET = "attachments"/);
    const srcDir = path.join(ROOT, "src");
    const all = fs.readdirSync(srcDir).filter((f) => f.endsWith(".gs")).map((f) => read(`src/${f}`)).join("\n");
    const buckets = new Set([...all.matchAll(/storage(?:Upload|Delete|Download)_\(\s*'(\w+)'/g)].map((m) => m[1]));
    expect([...buckets]).toEqual(["attachments"]);
  });
});

describe("mycr F-09:GAS 的每個資料表 PATCH / DELETE 都帶列篩選(與代理的『必須帶篩選』規則一致)", () => {
  // 代理對資料表的 PATCH / DELETE 要求至少一個 eq. / in. 篩選;GAS 端若有哪個呼叫忘了帶,
  // 上線後會變成 403。這裡在 Jest 這一側提早發現。
  const srcDir = path.join(ROOT, "src");
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".gs") && f !== "SupabaseClient.gs");

  // 回傳 [{ file, table, filterArg }]:第二個引數的原始文字
  const callSites = (source, file) => {
    const sites = [];
    const re = /supabase(?:Update|Delete)_\('(\w+)',\s*/g;
    let m;
    while ((m = re.exec(source)) !== null) {
      // 取到第一個「深度為 0 的逗號或右括號」為止
      let depth = 0;
      let i = re.lastIndex;
      const start = i;
      for (; i < source.length; i++) {
        const c = source[i];
        if (c === "(") depth++;
        else if (c === ")") {
          if (depth === 0) break;
          depth--;
        } else if (c === "," && depth === 0) break;
      }
      sites.push({ file, table: m[1], filterArg: source.slice(start, i).trim(), source });
    }
    return sites;
  };

  const isFilterExpression = (site) => {
    const arg = site.filterArg;
    if (/^(eqFilter_|inFilter_)\(/.test(arg)) return true;
    // 變數:同檔案裡必須能找到它是由 eqFilter_/inFilter_ 組出來的
    if (/^\w+$/.test(arg)) {
      return new RegExp("(?:var|let|const)\\s+" + arg + "\\s*=\\s*(?:eqFilter_|inFilter_)\\(").test(site.source);
    }
    return false;
  };

  const all = files.flatMap((f) => callSites(read(`src/${f}`), f));

  test("確實掃到呼叫點(避免正規式壞掉而空轉)", () => {
    // 目前有 11 個(文章寫入流程改走 save_article 之後,呼叫點變少了);這個下限只是為了確認
    // 掃描的正規式沒有壞掉而空轉,不是在鎖定確切數字。
    expect(all.length).toBeGreaterThanOrEqual(8);
  });

  test("每一個 supabaseUpdate_ / supabaseDelete_ 的第二個引數都是 eqFilter_ / inFilter_ 組出來的", () => {
    const bad = all.filter((site) => !isFilterExpression(site)).map((s) => `${s.file}: ${s.table} <- ${s.filterArg}`);
    expect(bad).toEqual([]);
  });

  test("掃描邏輯本身:能抓出沒帶篩選的呼叫點(破壞驗證用的內建樣本)", () => {
    const fake = "supabaseDelete_('articles', '');\nsupabaseUpdate_('tags', buildSomething(), { a: 1 });\nvar f = 'x';\nsupabaseDelete_('tags', f);";
    const sites = callSites(fake, "fake.gs");
    expect(sites).toHaveLength(3);
    expect(sites.every((site) => !isFilterExpression(site))).toBe(true);
    const good = "var filter = eqFilter_('a', 1);\nsupabaseDelete_('tags', filter);\nsupabaseUpdate_('tags', inFilter_('id', ids), {});";
    expect(callSites(good, "good.gs").every(isFilterExpression)).toBe(true);
  });
});

describe("mycr F-04:文件記載共用密鑰最小長度,且與代理常數一致", () => {
  test("README 說明至少 32 字元,且代理的 MIN_SECRET_LENGTH 是 32", () => {
    expect(read("supabase/functions/kb-proxy/handler.ts")).toMatch(/export const MIN_SECRET_LENGTH = 32;/);
    const readme = read("README.md");
    expect(readme).toMatch(/至少要 32 個字元/);
    expect(readme).toMatch(/一律回 500/);
  });
});
