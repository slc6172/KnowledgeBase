# 03 — 查詢向量快取與節流計數點後移

**What to build:** 同一句查詢在 60 秒內只呼叫一次 Gemini 嵌入:取得查詢向量時先查 `CacheService`,命中直接回傳(不呼叫 Gemini、不計語意搜尋節流);未命中才檢查節流、呼叫 Gemini、寫入快取。快取只是最佳化,任何讀寫例外都不得讓搜尋失敗。

**Blocked by:** None — can start immediately

**Status:** done

**接縫:** GAS 端 `httpFetch_` + `fakeCacheService`(需讓它支援 TTL 的假時鐘,不破壞既有測試)。

- [x] 同一句查詢第二次不呼叫 Gemini、不增加語意節流計數;換一句查詢重新呼叫
- [x] 快取鍵為雜湊(不含查詢明文),含 `EMBEDDING_MODEL_ID_`:模型識別字串不同不命中
- [x] 超過 60 秒失效
- [x] 快取讀或寫丟出例外(含值過大)時搜尋照常完成
- [x] Gemini 失敗(降級)時不寫入快取;降級行為與現況相同
- [x] 節流用完時,快取命中的查詢仍可成功;連續兩次相同查詢只消耗一次節流計數
