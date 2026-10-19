# 04 — AI 問答不消耗公開讀取額度,且 `opts` 無法繞過

**What to build:** `askKnowledgeBase` 本來就要密碼,不再消耗匿名訪客共用的公開讀取額度(2,000 次/小時)。「跳過額度」只能由伺服器內部程式碼以 `searchArticlesInternal_` 的第四個參數設定,絕不從呼叫端可控的 `opts` 讀取。

**Blocked by:** None — can start immediately

**Status:** done

**接縫:** GAS 端 `httpFetch_` + `fakeCacheService`(讀額度計數)。

- [x] `askKnowledgeBase` 不增加公開讀取額度計數;仍須先通過密碼與鎖定機制
- [x] 匿名 `searchArticles` 仍增加計數
- [x] 匿名在 `opts` 夾帶 `skipPublicReadRateLimit` 及其他同義鍵,額度照樣計數與擋下
- [x] `PrivateFunctionExposure` 等既有守門測試維持通過
