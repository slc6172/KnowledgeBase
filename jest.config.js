module.exports = {
  testEnvironment: "node",
  // supabase/ 底下是 Deno 的 Edge Function 與其測試(deno test 執行),
  // 不是 Jest 測試;明確排除,避免日後有人用 .test.ts 命名就被誤抓。
  testPathIgnorePatterns: ["/node_modules/", "/supabase/"],
  moduleFileExtensions: ["js", "gs", "json"],
  transform: {
    "\\.(js|gs)$": "babel-jest"
  }
};
