# 05 — 前端:列表完成後才發 AI 請求

**What to build:** `performSearch` 先發文章列表請求,列表的處理器(成功或失敗)完成後才呼叫 `loadAiAnswer`,讓列表請求先把查詢向量放進快取、AI 請求直接取用。

**Blocked by:** 03 — 查詢向量快取與節流計數點後移

**Status:** done

**接縫(spec 接縫 2):** `extractFunction` + jsdom,假 `google.script.run` 由測試決定回應何時抵達。

- [x] `loadAiAnswer` 在列表請求的處理器完成之後才被呼叫(成功與失敗兩種)
- [x] 列表請求在途中被新搜尋取代時,舊的不觸發 AI 請求
- [x] 沒有密碼快取時不發 AI 請求(既有行為)
- [x] 列表降級時 AI 請求仍會發出
- [x] `Search`、`AiAnswerStaleHistory`、`ArticleListSearchStalenessGuard` 等既有測試依新順序更新,過期回應防護不變
