// Edge Function 進入點:只負責把 Deno 執行環境接到 handleRequest。
// 所有邏輯都在 handler.ts(可注入 env / fetch,以 Deno 測試涵蓋);這個檔案
// 刻意保持薄到沒有分支,因此不另寫測試。
import { handleRequest } from "./handler.ts";

Deno.serve((request: Request) =>
  handleRequest(request, {
    env: Deno.env.toObject(),
    fetch: (url, init) => fetch(url, init),
  })
);
