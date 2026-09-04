# 03 — RAG 問答:搜尋頁 AI 回答區塊(單輪)

**What to build:** 搜尋結果下方新增 AI 回答區塊。只有已經持有密碼快取的使用者
會自動觸發並看到這個區塊,沒有密碼快取的使用者完全不會觸發任何 Gemini 呼叫、
也看不到任何相關提示。這張票先只處理單輪問答,不含對話歷史疊加(下一張票
處理)。

**Blocked by:** 02 — RAG 問答:askKnowledgeBase 函式

**Status:** ready-for-agent

**驗收方式:** 部署後手動操作、對照下列具體行為。

- [ ] 沒有密碼快取(`cachedWritePassword` 為空)時執行搜尋,`#ai-answer-panel`
      維持隱藏,**不**呼叫 `askKnowledgeBase`,也**不**跳出密碼輸入 modal——
      這個檢查是直接讀 `cachedWritePassword` 變數,不是呼叫會跳窗的
      `getWritePassword_()`。
- [ ] 已經有密碼快取(例如先前編輯過文章)時執行搜尋,自動呼叫
      `askKnowledgeBase`,AI 回答自動顯示在 `#ai-answer-panel`,不需要使用者
      額外按任何按鈕解鎖。
- [ ] 既有的搜尋結果列表(`#article-list-results`)完全不受影響——有沒有
      密碼快取、有沒有觸發 AI 回答,搜尋結果列表的內容與行為都跟改動前一樣。
- [ ] AI 回答查無相關資料(`noRelevantArticles: true`)時,顯示明確的
      「知識庫沒有相關資料」訊息,不是空白或誤導使用者以為系統壞掉。
- [ ] AI 回答附上引用的文章標題,可以點擊直接切換到那篇文章。
- [ ] `askKnowledgeBase` 呼叫失敗且錯誤訊息符合密碼錯誤的格式時,清掉
      `cachedWritePassword`,AI 區塊安靜隱藏回去,**不**彈出錯誤 toast、
      **不**影響搜尋結果本身的顯示。
- [ ] `askKnowledgeBase` 呼叫因為其他原因失敗(例如 Gemini 呼叫失敗)時,
      `#ai-answer-panel` 顯示一行清楚的錯誤文字,不擋住搜尋結果本身。
- [ ] 呼叫進行中時,`#ai-answer-panel` 顯示載入中狀態,不是空白。
