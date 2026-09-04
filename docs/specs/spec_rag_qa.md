---
title: RAG 問答(共用密碼門檻 + 多輪對話)
status: ready-for-agent
date: 2026-08-29
project: GAS + Supabase 個人/團隊知識庫
depends_on: spec_search.md(已完成)、Auth.gs 的共用密碼機制(已完成)、DESIGN.md(開頭願景「未來可接 Gemini API 做問答」、決策 #6 Embedding)
---

# RAG 問答(共用密碼門檻 + 多輪對話) — Spec

## Problem Statement

`DESIGN.md` 開頭就把「未來可接 Gemini API 做問答」列為這個知識庫的願景之一,
現在條件已經成熟:每篇已發布文章都有 768 維 `embedding`,`hybrid_search_articles`
RPC 跟 `Search.gs` 的 `searchArticles` 都已經完成並測試通過。缺的只有「把搜尋
結果餵給 Gemini、生成一段有根據的回答」這一步——目前搜尋列只能列出相關文章,
使用者還是得自己一篇一篇點開來找答案。

這個功能會在既有的 query embedding 呼叫之外,每次問答**額外多打一次** Gemini
`generateContent`。這個專案上一個 session 才剛為了「避免使用者誤按發布鍵、
重複觸發 embedding、浪費 Gemini API quota」修過連續 3 個 UI bug——這次的 AI
問答功能同樣要正視 Gemini 用量的問題,而且量級不同:發布是低頻的寫入操作,
問答預期會是使用頻率最高的功能之一。

## Solution

搜尋結果列表下方新增一個 AI 回答區塊,只有**目前已經持有有效寫入密碼快取**
(`cachedWritePassword` 不為空)的使用者才會自動看到、自動觸發;沒有密碼快取的
使用者完全不會觸發任何 Gemini 呼叫,連 AI 區塊的提示都不出現——密碼門檻本身
就是這次的用量節流機制,不另外設計限流。支援多輪對話,對話歷史存在前端記憶體
(不持久化),保留輪數是一個可調整的程式碼常數。每輪的文章檢索只看當下這句話,
歷史只用來讓 Gemini 組出通順、有上下文的回答,不做「用歷史重寫查詢」這種
額外的 API 呼叫。

## User Stories

**基本問答**

1. As a knowledge-base user with a cached write password, I want an AI-generated
   answer to appear below the search results when I search, so I get a synthesized
   answer instead of having to read through multiple articles myself.
2. As a knowledge-base user, I want the AI answer to cite which articles it drew from
   (clickable titles), so I can verify the answer against the source and read further
   if needed.
3. As a knowledge-base user, I want a query with no relevant articles found to produce
   a clear "知識庫沒有相關資料" message instead of Gemini answering from its own
   general knowledge, so I can trust that every AI answer I see is actually grounded
   in my knowledge base.
4. As a knowledge-base user, I want the existing search results list to remain exactly
   as it is today (unaffected by whether an AI answer is shown), so I can still quickly
   scan article titles even when I don't need the AI summary.

**存取控制**

5. As a knowledge-base user without a cached write password, I want to see only the
   plain search results with no mention of an AI answer feature — no prompt, no
   button, no error — so the experience for read-only/unauthorized users stays exactly
   as it is today.
6. As a knowledge-base user who has already entered the write password earlier in this
   browsing session (e.g. to edit an article), I want the AI answer to appear
   automatically on my next search without being asked for the password again, so
   authorization "just works" the same way it already does for write actions.
7. As a developer, I want the password-checking logic shared between the existing
   write-action gate (`callProtected`) and this new read-adjacent AI gate, so the two
   don't drift into inconsistent comparison behavior over time.

**多輪對話**

8. As a knowledge-base user, I want to ask a follow-up question and have the AI
   remember what we just discussed, so I can have a natural back-and-forth instead of
   repeating context in every query.
9. As a knowledge-base user, I want each turn's AI answer to still be grounded in a
   fresh search for that turn's question (not reusing the previous turn's retrieved
   articles), so a genuinely different follow-up question gets genuinely different,
   relevant sources.
10. As a knowledge-base user, I want to see my conversation (questions + AI answers)
    stack up on screen as I keep asking, so I can scroll back and re-read earlier
    answers in the same session.
11. As a knowledge-base user, I want the conversation history to reset when I reload
    the page, consistent with how the write-password cache already resets on reload
    (this app has no login/account system, so there's no natural place to persist a
    conversation across sessions).
12. As a developer, I want the number of retained turns to be a single adjustable
    constant in the source, so it can be tuned later without hunting through the code.

## Implementation Decisions

### 密碼驗證邏輯共用(Auth.gs 重構)

- 從 `callProtected` 裡把密碼比對抽成獨立函式 `isValidWritePassword_(password)`
  (回傳 boolean:`password === getWritePassword_()`)。`callProtected` 改成呼叫
  `isValidWritePassword_`,錯誤時仍然丟出「密碼錯誤」,對外行為不變。
- `Auth.gs` 檔案開頭的註解需要更新——目前寫的是「寫入類操作的密碼守門員」,
  重構後它同時服務寫入白名單(`callProtected`)跟這次新增的讀取類 AI 問答
  (`askKnowledgeBase`),註解要反映這個新的角色。

### 新函式:`askKnowledgeBase(queryText, password, history)`

放在新檔案 `RagChat.gs`,不修改 `Search.gs`(`searchArticles` 保持完全公開、
介面/回傳形狀都不變,行為對現有呼叫端/既有測試零影響——對應 User Story 4、7 的
精神:新功能不該讓一個已經穩定、已測試的既有介面背負額外的可選行為)。

1. `isValidWritePassword_(password)` 驗證失敗時,直接丟出「密碼錯誤」——**這個
   函式本身不是 `callProtected` 白名單的一員**,前端呼叫這個函式的方式見下方
   「前端」章節,並不透過 `callProtected`/`Auth.gs` 白名單 switch(它是讀取類
   操作,不是寫入類,語意上不屬於那個白名單;但仍然需要驗證密碼,所以是一條
   獨立於現有白名單機制的新路徑,只是共用同一個 `isValidWritePassword_` 判斷
   式)。
2. 驗證通過後,呼叫既有的 `searchArticles(queryText, { onlyPublished: true })`
   拿到這一輪的相關文章(內部重用,不重新實作檢索邏輯)。
3. 沒有任何相關文章(空陣列)時,直接回傳
   `{ answer: null, noRelevantArticles: true, sources: [] }`,**不呼叫 Gemini**
   ——對應 User Story 3,同時也省下一次不必要的 API 呼叫。
4. 有相關文章時,組一段 prompt:把 `history`(呼叫端傳入的前幾輪
   問題+回答,見下方「多輪對話」)、這一輪檢索到的文章(標題 + `content_md`
   或其摘要)、使用者這次的問題組合起來,要求 Gemini 只根據提供的文章內容
   回答,找不到答案就明講(這條指令是 prompt 裡的規則,不是額外的程式邏輯)。
5. 呼叫 Gemini `generateContent`——沿用 `Embeddings.gs` 的
   `generateEmbedding_` 已經驗證過的呼叫模式(`httpFetch_`、
   `x-goog-api-key` header、JSON payload、`muteHttpExceptions: true`、檢查
   response code)。**用哪個 generateContent 模型需要在實作 ticket 開始時
   查證 Gemini API 最新文件再定案**——`generateEmbedding_` 當初也是先用
   `text-embedding-004`、後來查證後更新成 `gemini-embedding-001`
   (`DESIGN.md` 決策 #6 的附註),這次比照辦理,不在 spec 階段寫死一個可能
   已經過期的模型名稱。
6. 回傳 `{ answer: <Gemini 生成的文字>, noRelevantArticles: false, sources:
   [{ id, title }, ...] }`(`sources` 取自步驟 2 檢索到的文章,對應 User
   Story 2 的引用來源)。
7. Gemini 呼叫失敗時直接讓錯誤往外傳(沿用 `Search.gs` 對 Gemini/RPC 失敗
   「不做 try/catch 降級」的既有原則),前端接住錯誤後的呈現方式見下方
   「前端」章節。

### 多輪對話

- 檢索(步驟 2)**不**參考 `history`——每輪的 `searchArticles` 呼叫只用當下這句
  `queryText`,不做「用歷史重寫查詢」的額外 Gemini 呼叫(對應 User Story 9 的
  「新問題要有新的相關來源」,同時避免每輪變成 3 次 API 呼叫的複雜度/成本
  上升)。`history` 只出現在步驟 4 組 prompt 的階段,讓 Gemini 讀得到「剛才
  聊過什麼」來組出通順的回答與代名詞指涉,不影響檢索本身。
- 保留輪數:新增常數 `HISTORY_RETAIN_TURNS = 5`(放在 `RagChat.gs` 或
  `JavaScript.html`,由呼叫端——前端——負責只傳最近 N 輪給
  `askKnowledgeBase`,`RagChat.gs` 本身不做裁切,單純使用呼叫端傳入的
  `history` 陣列,對稱於 `spec_pagination.md` 的 `ARTICLE_LIST_PAGE_SIZE`
  同一種「程式碼常數,之後自己改」的做法)。
- `history` 的資料形狀:`[{ question, answer }, ...]`,只包含成功產生答案的
  輪次(`noRelevantArticles: true` 或錯誤的輪次不計入歷史,避免污染後續
  prompt)。

### 前端(`JavaScript.html` + `ArticleListView.html`)

- `ArticleListView.html` 新增 AI 回答區塊容器(例如
  `<div id="ai-answer-panel" class="hidden"></div>`),放在
  `#article-list-results` 附近(搜尋結果列表維持在畫面上,AI 區塊是額外新增的
  區塊,不是取代——對應 User Story 4)。
- `performSearch(queryText)` 現有邏輯完全不變;額外新增一段邏輯:
  **直接檢查 `cachedWritePassword` 這個既有變數是否為真值**(不是呼叫
  `getWritePassword_()`——那個函式在沒有快取時會跳出密碼輸入框,這裡絕對不能
  觸發跳窗,對應 User Story 5、6:沒密碼要完全安靜,不能因為搜尋這個平常不需要
  密碼的動作意外跳出密碼 modal)。
  - `cachedWritePassword` 為空:`#ai-answer-panel` 維持/加上 `hidden`,不呼叫
    `askKnowledgeBase`,流程到此結束(對應 User Story 5)。
  - `cachedWritePassword` 有值:呼叫
    `google.script.run.askKnowledgeBase(queryText, cachedWritePassword,
    最近 HISTORY_RETAIN_TURNS 輪的 conversationHistory)`,顯示載入中狀態,
    成功時把新的一輪(問題 + 回答)疊加進畫面上的對話紀錄區塊,同時
    `push` 進 `conversationHistory`(前端記憶體陣列,結構同上,超過
    `HISTORY_RETAIN_TURNS` 輪時裁掉最舊的一輪)。
- 錯誤處理:`askKnowledgeBase` 的 `withFailureHandler` 裡,若錯誤訊息符合
  `/密碼錯誤/`(沿用 `runProtected` 既有的判斷方式),清掉
  `cachedWritePassword` 並讓 AI 區塊安靜隱藏、只顯示原本的搜尋結果,**不**
  彈出錯誤 toast、**不**中斷或影響搜尋結果本身的顯示(這是加值功能,答錯密碼
  不該打斷使用者原本能用的搜尋——但因為前端現在是主動拿 `cachedWritePassword`
  去呼叫、不是重新輸入密碼,理論上不會發生「這次剛輸入就錯」的情境,這裡的
  密碼錯誤只會發生在密碼被使用者手動改過 Script Property、但瀏覽器還快取著
  舊密碼這種邊緣情況);其他非密碼錯誤(例如 Gemini 呼叫失敗)則在
  `#ai-answer-panel` 裡顯示一行清楚的錯誤文字(不擋住搜尋結果本身)。
- 畫面呈現(對應 User Story 10):AI 對話疊加顯示成類似聊天記錄(每輪的問題
  +回答都留在 `#ai-answer-panel` 裡,新的一輪附加在後面,不清空舊的),但
  `#article-list-results` 的搜尋結果列表只反映最新一輪查詢(不需要每輪都留一份
  結果列表快照)。
- 重整頁面/`goHome()` 時,`conversationHistory` 陣列與 `#ai-answer-panel` 的
  畫面內容一併清空(對應 User Story 11,比照 `cachedWritePassword` 的既有生命
  週期)。

## Testing Decisions

延續既有模式:透過假的 `httpFetch_` 驗證行為,`test/Embeddings.test.js`
(Gemini API 呼叫的既有 mock 模式)、`test/Search.test.js`(重用其他模組函式、
空結果提前回傳)、`test/Auth.test.js`(密碼驗證相關)都是直接的 prior art。

**要測的模組**:`Auth.gs`(抽出 `isValidWritePassword_` 後,`callProtected` 的
既有測試應該維持全過,不需要改動斷言;新增針對 `isValidWritePassword_` 本身的
測試)、`RagChat.gs`(新檔案)。

**關鍵測試情境**
1. `isValidWritePassword_`:密碼正確/錯誤分別回傳 `true`/`false`,不拋錯誤
   (拋錯是 `callProtected` 這一層的責任,不是這個判斷式本身)。
2. `callProtected` 重構後的既有測試(`test/Auth.test.js`)全部維持通過,行為
   不變。
3. `askKnowledgeBase`:密碼錯誤時直接 throw「密碼錯誤」,不呼叫
   `searchArticles`、不呼叫 Gemini。
4. `askKnowledgeBase`:密碼正確但 `searchArticles` 回傳空陣列時,直接回傳
   `{ answer: null, noRelevantArticles: true, sources: [] }`,不呼叫 Gemini
   `generateContent`(用假的 `httpFetch_` 斷言只有 embedding 相關的呼叫、沒有
   generateContent 的呼叫)。
5. `askKnowledgeBase`:密碼正確且有相關文章時,依序驗證(a) 呼叫
   `searchArticles`,(b) 呼叫 Gemini `generateContent` 且 payload 裡包含這次的
   問題與檢索到的文章內容,(c) 回傳的 `sources` 對應到檢索結果的 `id`/`title`。
6. `askKnowledgeBase`:傳入非空的 `history` 時,`generateContent` 的 payload
   內容包含歷史問答(驗證 prompt 組裝有把 `history` 放進去)。
7. `generateContent` 回傳非 2xx 時,`askKnowledgeBase` 讓錯誤往外傳(不做
   try/catch 降級),對齊 `Search.gs`/`Embeddings.gs` 的既有原則。

**前端**沒有自動化測試(既有慣例),`node --check` 驗證語法,明確告知使用者
需要手動驗收,重點驗收情境:
- 沒有密碼快取時搜尋,完全不出現 AI 相關的任何提示或按鈕。
- 有密碼快取時搜尋,AI 回答自動出現、附引用文章可點擊。
- 查無相關文章時顯示「沒有相關資料」而不是 Gemini 自由回答。
- 連續問兩個有上下文關聯的問題(例如「那另一篇呢」這種代名詞式追問),確認
  AI 讀得到前一輪的問答(即使檢索本身不吃歷史,回答應該還是連貫的)。

## Out of Scope

- 用對話歷史重寫/改寫檢索查詢——這次每輪檢索只看當下這句話,見「多輪對話」
  決策的說明。如果之後「代名詞式追問檢索不到正確文章」變成常見的實際痛點,
  應該另立 spec 討論查詢改寫(會多一次 API 呼叫,成本/複雜度需要重新評估)。
- 除了「需要密碼快取」以外的額外用量節流(例如每人每天問答次數上限)——密碼
  門檻本身就是這次的節流機制,先上線觀察真實用量,有需要再回頭做,見
  Problem Statement 的說明,不在這次預先設計。
- 對話歷史的持久化(重整頁面後還在、跨裝置同步)——這個專案沒有使用者帳號
  系統,見 Implementation Decisions 的說明,歷史只存在前端記憶體。
- 串流(streaming)回答——`generateContent` 這次用一般的同步呼叫,不做逐字
  串流顯示。
- 回答的重新生成(regenerate)/使用者對回答的評分或回饋機制。
- 搜尋結果列表本身的呈現方式改動——維持 `spec_search.md`/現有
  `renderArticleCards` 的既有樣子,這次只在它下面/旁邊新增 AI 區塊。

## Further Notes

- `askKnowledgeBase` 之所以獨立於 `Auth.gs` 既有的 `callProtected` 白名單
  之外(不透過 `dispatchProtectedCall_` 的 switch),是因為那個白名單的既有
  語意明確是「寫入類操作」(`Auth.gs` 檔案開頭原本的註解就是這樣寫的),
  `askKnowledgeBase` 是讀取類操作、只是額外需要密碼驗證——把它塞進寫入白名單
  會混淆這個 switch 原本「白名單以外一律視為不支援的寫入操作」的用意。抽出
  `isValidWritePassword_` 讓兩條路徑共用同一份判斷邏輯,但呼叫的入口(前端怎麼
  呼叫、要不要先跳出密碼 modal)刻意保持不同,對應這次「沒密碼要完全安靜、
  不能跳窗」這個和既有寫入流程明顯不同的體驗要求。
- Gemini `generateContent` 的實際模型名稱、`generationConfig`(例如
  `temperature`/`maxOutputTokens`)這些細節有意留給實作 ticket 決定並在動手前
  查證最新文件——這不是遺漏,是刻意的作法,理由見 Implementation Decisions
  第 5 點。
