# 02 — RAG 問答:askKnowledgeBase 函式

**What to build:** 新增 `RagChat.gs` 的 `askKnowledgeBase(queryText, password,
history)`——驗證密碼、重用 `searchArticles` 做檢索、查無相關文章時不呼叫
Gemini、有相關文章時組 prompt(含歷史問答)呼叫 Gemini `generateContent`、
回傳含引用來源。不修改 `Search.gs`,`searchArticles` 的介面與行為完全不變。

**Blocked by:** 01 — Auth.gs:抽出共用的密碼驗證函式

**Status:** ready-for-agent

- [ ] 密碼驗證失敗時(`isValidWritePassword_` 回傳 `false`),直接 throw
      「密碼錯誤」,不呼叫 `searchArticles`、不呼叫 Gemini。
- [ ] 密碼正確時,呼叫既有的 `searchArticles(queryText, { onlyPublished: true
      })` 取得這一輪的相關文章(內部重用,不重新實作檢索邏輯)。
- [ ] `searchArticles` 回傳空陣列時,直接回傳
      `{ answer: null, noRelevantArticles: true, sources: [] }`,**不呼叫**
      Gemini `generateContent`(用假的 `httpFetch_` 驗證只有既有的搜尋相關
      呼叫、沒有 generateContent 的呼叫)。
- [ ] 有相關文章時,組出的 prompt 要求 Gemini 只根據提供的文章內容回答、
      找不到答案就明講,不使用它自己的一般知識回答。
- [ ] `history`(格式:`[{ question, answer }, ...]`)非空時,prompt 內容
      包含這些歷史問答,讓回答能延續對話上下文;`history` 只影響 prompt
      組裝,**不**影響這一輪 `searchArticles` 的檢索(檢索只看當下的
      `queryText`)。
- [ ] Gemini 呼叫沿用 `generateEmbedding_` 已驗證過的呼叫模式(`httpFetch_`、
      `x-goog-api-key` header、JSON payload、`muteHttpExceptions: true`、
      檢查 response code)。呼叫前先查證 Gemini API 目前建議的
      `generateContent` 模型名稱,不要沿用可能已經過期的名稱。
- [ ] 成功時回傳 `{ answer, noRelevantArticles: false, sources: [{ id, title
      }, ...] }`,`sources` 對應到這一輪 `searchArticles` 檢索到的文章。
- [ ] Gemini 呼叫回傳非 2xx 時,讓錯誤直接往外傳(不做 try/catch 降級),對齊
      `Search.gs`/`Embeddings.gs` 既有的錯誤處理原則。
- [ ] 這個函式**不**加進 `Auth.gs` 的白名單 switch(它是讀取類操作,不透過
      `callProtected`),但共用 `isValidWritePassword_` 做密碼驗證。
- [ ] 用假的 `httpFetch_` 寫測試涵蓋以上所有情境,比照
      `test/Embeddings.test.js`(Gemini API mock)與 `test/Search.test.js`
      (重用其他模組、空結果提前回傳)的既有模式。
