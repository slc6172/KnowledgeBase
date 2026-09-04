# 01 — 搜尋列疊加標籤篩選

**What to build:** 搜尋列新增標籤篩選 UI(`tag-picker/01` 建好的元件、
`filter` 模式),選取的標籤 id 陣列傳進既有的 `searchArticles(queryText,
opts)` 的 `opts.tagIds`——這條路徑後端完全不用改,`Search.gs` 已經支援。

**Blocked by:** tag-picker/01 — 共用標籤選取元件 + 套用到文章編輯頁(需要
`filter` 模式已經存在)

**Status:** ready-for-agent

- [ ] 搜尋列(`performSearch`/呼叫 `searchArticles` 的入口)新增
      `buildTagPicker(container, { mode: 'filter', onChange: ... })`。
- [ ] 選取標籤變化時,重新呼叫 `searchArticles(queryText, { tagIds:
      選取的id陣列, ...其他既有 opts })`,不影響 `queryText` 為空時原本
      「請提供搜尋文字」的既有驗證行為。
- [ ] 篩選面板上**沒有**打字建立新標籤的輸入框(`filter` 模式的既有規格)。
- [ ] 手動驗收:打搜尋文字 + 勾選 1 個標籤,結果只包含同時符合搜尋字跟這個
      標籤的文章;勾選 2 個標籤時是 AND(必須同時有兩個標籤)——這段行為由
      `hybrid_search_articles` RPC 既有邏輯保證,這張票只需要確認前端有把
      `tagIds` 正確傳過去、UI 上勾選狀態符合預期。
