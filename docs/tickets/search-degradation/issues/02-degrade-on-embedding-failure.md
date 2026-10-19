# 02 — 產生查詢向量失敗時降級為關鍵字搜尋

**What to build:** 公開搜尋在「產生查詢向量」失敗時,改用空向量呼叫同一個 RPC,只取回關鍵字
比對結果,並回傳 `degraded: true`;降級原因寫進日誌(不含金鑰)。降級只涵蓋產生向量這一步,
之後的任何錯誤照舊拋出;AI 問答完全不降級。

**Blocked by:** 01 — 回傳形狀

**Status:** done

**接縫(spec〈Testing Decisions〉接縫 1):** GAS 端 `httpFetch_`。

**手動驗證:** spec 手動驗證清單 (a) 以 NULL 向量在 SQL Editor 呼叫 RPC、(b) 金鑰改成無效值後
搜尋、(c) 還原金鑰、(e) 降級時 AI 問答顯示原本錯誤(需搭配 03 的前端)。

- [x] Gemini 回 429 → `degraded: true`,送往 RPC 的向量為空,RPC 結果經補資料後回傳
- [x] Gemini 回 500、`httpFetch_` 拋網路例外、回 200 但格式異常、`GEMINI_API_KEY` 缺漏
      → 皆 `degraded: true`
- [x] Gemini 成功 → `degraded: false`,RPC 收到向量
- [x] 降級且 RPC 回空 → `{ articles: [], degraded: true }`
- [x] 降級時標籤篩選、筆數、僅已發布、門檻等選填參數仍正確傳給 RPC
- [x] 降級時 RPC 本身失敗仍拋錯(維持既有安全訊息);補資料查詢失敗仍拋錯
- [x] 空字串、過長、任一層節流觸發 → 仍拋錯、不降級、不呼叫 Gemini / RPC
- [x] 降級時語意搜尋節流計數仍遞增
- [x] 降級原因被記錄(含錯誤分類與訊息),日誌內容不含 API 金鑰,也不回傳給前端
- [x] `askKnowledgeBase`:embedding 失敗行為與現況相同(報錯、不降級);
      既有 RagChat 測試不需修改斷言即全數通過

> **實作註記:** (1) 「空向量」實作為 JSON `null`(spec 已用真實 PostgreSQL 16 + pgvector 0.6.0 驗證;
> 空陣列會因 `vector(768)` 維度檢查失敗)。(2) Search.test.js 中兩個舊測試的前提被 spec 定案行為取代:
> 「公開搜尋 Gemini 失敗 → 通用 AI 訊息」與「Gemini 失敗不降級」。前者由降級測試取代;後者改為驗證
> 不降級路徑(`searchArticlesInternal_(…, false)`)與 `askKnowledgeBase`(RagChat.test.js 新增一個測試,
> 既有斷言未改)。(3) 日誌在寫入前會把 `GEMINI_API_KEY` 字串遮蔽(上游錯誤本文理論上不含金鑰,屬多一層防護)。
> (4) 破壞驗證:拿掉金鑰遮蔽、拿掉「不允許降級就拋錯」兩種改動都會使測試變紅。
