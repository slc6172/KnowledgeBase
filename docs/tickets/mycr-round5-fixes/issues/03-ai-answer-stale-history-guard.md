# 03 — AI 回應晚到時不污染對話歷史

**What to build:** 使用者送出搜尋(AI 回答還在跑)後清空搜尋回到列表,舊的 AI 回應晚到時,不會再被
寫進對話歷史,因此下一次提問不會把「已經被丟掉的上一輪問答」當成上下文送給 Gemini;兩個搜尋重疊時,
歷史順序也不會顛倒。(F-07)畫面行為不變:仍然每次建立專屬回答區塊、被丟棄的回應不渲染。

**Blocked by:** None — can start immediately

**Status:** done

**接縫:** `extractFunction` + jsdom 執行 `JavaScript.html` 的 `loadAiAnswer` / `renderAiAnswerTurn` /
`hideAiAnswerPanel`(與 `AiSourcesPanel.test.js` 同一做法);假的 `google.script.run` 讓測試自己決定回應何時抵達。

- [x] 搜尋 A → 在 A 的回應抵達前清空搜尋 → A 的回應抵達:`conversationHistory` 仍為空、回答區塊不顯示
- [x] 清空後再問 B:送給後端的歷史只含 B 之前真正顯示過的輪次(不含 A)
- [x] A、B 重疊:A 後送出但先抵達、B 先送出但後抵達時,只有仍是「目前這一輪」的回應進入歷史,且順序與顯示順序一致
- [x] 正常單一搜尋流程(送出 → 抵達)行為不變,歷史累積與保留輪數上限不變
- [x] 既有 AI 前端測試不需修改斷言即通過

> **實作註記:** 守衛只有一行:成功處理器先檢查 `turnEl.isConnected`。不另外維護序號——每輪都有專屬的 `turnEl`,
> 面板被清空或被更新的搜尋取代時它就脫離文件,「還接在文件上」就等於「仍是畫面上的那一輪」。守衛放在處理器而不是
> `renderAiAnswerTurn` 內,因為既有的 `AiSourcesPanel` 測試會直接用未接上文件的元素呼叫 `renderAiAnswerTurn`。
> 失敗處理器沒有加守衛:過期的「密碼錯誤」本來就該清掉快取的密碼。
