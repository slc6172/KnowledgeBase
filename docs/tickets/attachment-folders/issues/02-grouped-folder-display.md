# 02 — 附件面板依資料夾分組顯示

**What to build:** 文章詳情頁的附件面板(`mountAttachmentPanel`)改成依
`attachment_folders` embed 資料把附件分組成可收合區塊,搭配既有的型態徽章
一起顯示,取代 01 那張票「至少看得出所屬資料夾」的陽春顯示。

**Blocked by:** 01 — 建立資料夾 + 上傳時分類

**Status:** ready-for-agent

- [ ] `mountAttachmentPanel` 渲染時,先用 `listAttachments` 回傳的
      `attachment_folders(id,name)` embed 資料把附件分組:沒有 `folder_id`
      的附件歸到「未分類」這個虛擬分組(不對應任何一筆真實的
      `attachment_folders` 列)。
- [ ] 每個分組是一個可收合區塊(`<details>`/`<summary>` 或既有摺疊 UI 的
      既有寫法),區塊標題顯示資料夾名稱,裡面的附件維持既有的型態徽章顯示
      邏輯不變。
- [ ] 「未分類」分組固定排在最後(已分類內容優先顯示)。
- [ ] 手動驗收:一篇文章有多個資料夾 + 未分類附件時,附件面板正確分組顯示、
      收合/展開功能正常,型態徽章維持既有樣式。
