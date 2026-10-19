# 01 — `searchArticles` 回傳形狀改為 `{ articles, degraded }`

**What to build:** 公開的 `searchArticles` 改回傳含 `articles` 與 `degraded` 的物件(本票 `degraded`
一律為 `false`,尚未有降級行為);檢索主體抽成可指定「是否允許降級」的內部函式,
`askKnowledgeBase` 改走不允許降級的路徑並維持拿到純文章陣列;前端搜尋成功處理改讀新形狀。
這張票交付後整條搜尋路徑(後端 → 前端)行為與現況完全相同,只是形狀已就位。

**Blocked by:** None — can start immediately

**Status:** done

**接縫(spec〈Testing Decisions〉):** GAS 端 `httpFetch_`;前端在 jsdom 執行 `JavaScript.html`
函式(既有 prior art)+ 靜態文字掃描。

- [x] 成功搜尋回傳 `{ articles, degraded: false }`,`articles` 的順序、內容與現況相同
- [x] RPC 回空(含 null)時回傳 `{ articles: [], degraded: false }`
- [x] 送往 Gemini / RPC 的請求內容、輸入驗證、兩層節流的順序與行為不變
- [x] `askKnowledgeBase` 的所有既有行為(含 embedding 失敗照舊報錯、輸入驗證、節流、
      選填參數)不變;既有 RagChat 測試不需修改斷言即全數通過
- [x] 內部檢索函式以底線字尾命名,不成為 `google.script.run` 公開端點
- [x] 前端搜尋成功處理改讀 `articles`;狀態/分類前端篩選、卡片渲染、
      過期回應防護行為不變;既有前端測試僅更新回傳形狀
- [x] 既有 Search 測試僅更新回傳形狀斷言即通過(Gemini 失敗相關的兩個測試由 02 處理)

> **調整註記:** 原驗收寫「前端讀取 `articles` 與 `degraded`」。本票尚無任何程式使用 `degraded`,
> 若先讀取會成為死碼(專案偏好不留死碼),因此讀取 `degraded` 移到票 03(spec 的靜態掃描案例
> 「搜尋成功處理讀取 articles 與 degraded」仍由 03 涵蓋)。另外 `searchArticlesInternal_` 的第三個參數
> 在本票只被傳遞、尚未分支,分支行為由票 02 以測試驅動加入。
