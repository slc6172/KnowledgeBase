const { loadGas } = require("./helpers/loadGas");

/**
 * 票 03(spec_chunked_embeddings):切段純函式。
 * 每段最多 1,500 字(JavaScript 字串長度),不重疊,優先在段落邊界切;
 * 超過 40 段不能發布;送去嵌入的文字 = 標題 + 空行 + 段落。
 */
beforeEach(() => {
  loadGas("../../src/Chunking.gs");
});

const MAX = 1500;
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const squash = (s) => s.replace(/\s+/g, "");

describe("splitIntoChunks_: 單段情況", () => {
  test("1,500 字以內是單段,內容原樣保留", () => {
    expect(splitIntoChunks_("短文")).toEqual(["短文"]);
    const exact = "字".repeat(MAX);
    expect(splitIntoChunks_(exact)).toEqual([exact]);
  });

  test.each([[""], ["   \n\n  "], [undefined], [null]])("內容為空(%p)仍是單段(空字串),讓文章至少能以標題被找到", (empty) => {
    expect(splitIntoChunks_(empty)).toEqual([""]);
  });

  test("1,501 字起切成兩段", () => {
    expect(splitIntoChunks_("字".repeat(MAX + 1))).toHaveLength(2);
  });
});

describe("splitIntoChunks_: 切點的優先順序", () => {
  test("段落(空行)邊界優先:相鄰的小段落盡量打包在同一段,且段落不被切開", () => {
    const p = (c) => c.repeat(700);
    const text = [p("甲"), p("乙"), p("丙")].join("\n\n");
    const chunks = splitIntoChunks_(text);
    expect(chunks).toEqual([p("甲") + "\n\n" + p("乙"), p("丙")]);
  });

  test("單一段落過長時退到換行切,不在句子中間下刀", () => {
    const line = (c) => c.repeat(800);
    const text = [line("甲"), line("乙"), line("丙")].join("\n");
    const chunks = splitIntoChunks_(text);
    expect(chunks.every((c) => c.length <= MAX)).toBe(true);
    expect(chunks).toEqual([line("甲"), line("乙"), line("丙")]);
  });

  test("沒有換行時退到句末標點(。!?.!?)切,標點留在前一段", () => {
    const sentence = "這是一個測試句子".repeat(60) + "。"; // 約 481 字
    const text = sentence.repeat(7); // 約 3,367 字,沒有任何換行
    const chunks = splitIntoChunks_(text);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.every((c) => c.length <= MAX)).toBe(true);
    // 每一段都以句號結尾(沒有在句子中間切斷)
    expect(chunks.every((c) => c.endsWith("。"))).toBe(true);
  });

  test("連句末標點都沒有時硬切成不超過 1,500 字的片段", () => {
    const chunks = splitIntoChunks_("a".repeat(4000));
    expect(chunks.map((c) => c.length)).toEqual([1500, 1500, 1000]);
  });

  test("硬切不會切斷代理對(表情符號不會被劈成兩半)", () => {
    const text = "a" + "😀".repeat(1000); // 第 1500 個位置剛好落在某個代理對中間
    const chunks = splitIntoChunks_(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(MAX);
      expect(loneSurrogate.test(c)).toBe(false);
    }
    expect(chunks.join("")).toBe(text);
  });
});

describe("splitIntoChunks_: 不變式", () => {
  const articles = {
    "中文長文(段落 + 換行 + 句子)": Array.from({ length: 60 }, (_, i) => `第${i}節\n` + "內容很長的一個句子。".repeat(20 + (i % 7))).join("\n\n"),
    "英文長文": Array.from({ length: 80 }, (_, i) => `Paragraph ${i}. ` + "The quick brown fox jumps over the lazy dog. ".repeat(5 + (i % 4))).join("\n\n"),
    "混合 + 表情符號": ("段落😀文字。\n\n" + "x".repeat(900) + "\n" + "🙂".repeat(300) + "。").repeat(8)
  };

  test.each(Object.keys(articles))("%s:每段 ≤ 1,500、沒有孤立的代理對、串起來等於原文(忽略空白)、不重疊", (name) => {
    const text = articles[name];
    const chunks = splitIntoChunks_(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(MAX);
      expect(c.length).toBeGreaterThan(0);
      expect(loneSurrogate.test(c)).toBe(false);
    }
    expect(squash(chunks.join(""))).toBe(squash(text)); // 沒有遺漏、沒有重複
  });
});

describe("段數上限", () => {
  test("上限是 40 段;40 段通過、41 段被偵測為超限", () => {
    expect(CHUNK_MAX_COUNT_).toBe(40);
    expect(exceedsChunkLimit_(new Array(40).fill("x"))).toBe(false);
    expect(exceedsChunkLimit_(new Array(41).fill("x"))).toBe(true);
  });

  test("約 6 萬字剛好是 40 段左右,6.1 萬字的無標點長文超限", () => {
    expect(exceedsChunkLimit_(splitIntoChunks_("a".repeat(MAX * 40)))).toBe(false);
    expect(exceedsChunkLimit_(splitIntoChunks_("a".repeat(MAX * 40 + 1)))).toBe(true);
  });
});

describe("buildChunkEmbeddingText_", () => {
  test("送去嵌入的文字 = 標題 + 空行 + 段落;儲存用的段落文字不含標題", () => {
    const chunks = splitIntoChunks_("內文");
    expect(buildChunkEmbeddingText_("標題", chunks[0])).toBe("標題\n\n內文");
    expect(chunks[0]).toBe("內文");
  });

  test("內容為空的單段:嵌入文字只剩標題(仍是合法輸入)", () => {
    expect(buildChunkEmbeddingText_("只有標題", "")).toBe("只有標題\n\n");
  });
});
