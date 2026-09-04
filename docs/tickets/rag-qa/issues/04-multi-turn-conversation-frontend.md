# 04 — RAG 問答:多輪對話

**What to build:** 在單輪 AI 回答的基礎上,加上前端記憶體管理的對話歷史——
保留最近 N 輪問答、疊加顯示成聊天記錄、重整頁面時清空。

**Blocked by:** 03 — RAG 問答:搜尋頁 AI 回答區塊(單輪)

**Status:** ready-for-agent

**驗收方式:** 部署後手動操作、對照下列具體行為。

- [ ] 新增 `HISTORY_RETAIN_TURNS` 常數(預設 5),前端維護一個
      `conversationHistory` 陣列(`[{ question, answer }, ...]`),只保留最近
      `HISTORY_RETAIN_TURNS` 輪,超過時裁掉最舊的一輪。
- [ ] 每次呼叫 `askKnowledgeBase` 時,帶上目前的 `conversationHistory`。
- [ ] 成功產生答案的輪次(不是 `noRelevantArticles: true`、也不是錯誤)才會
      被加進 `conversationHistory`,查無資料或失敗的輪次不計入歷史。
- [ ] 連續問兩個有上下文關聯的問題(例如接著問「那另一篇呢」這種代名詞式
      追問),確認 AI 的回答讀得到前一輪的問答內容、回答連貫。
- [ ] 每一輪的新問答疊加顯示在 `#ai-answer-panel` 裡(新的附加在後面,不清空
      舊的),可以往下捲動看到之前輪次的問答。
- [ ] 搜尋結果列表(`#article-list-results`)只反映最新一輪查詢的結果,不會
      每輪都各自留一份結果列表快照。
- [ ] 重整頁面或呼叫 `goHome()` 時,`conversationHistory` 陣列與
      `#ai-answer-panel` 的畫面內容一併清空,恢復成初始狀態。
- [ ] 沒有密碼快取的使用者這整套多輪對話機制完全不會被觸發(維持 03 已經
      驗收過的「沒密碼完全不提」)。
