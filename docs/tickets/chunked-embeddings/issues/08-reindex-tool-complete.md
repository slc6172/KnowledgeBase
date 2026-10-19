# 08 — 重建工具完成版(正式執行、續跑、自動解除)

**Type:** AFK

**Blocked by:** 03, 04, 06

**Status:** done

**對應 User Story:** 12、13、14、15(見 `docs/specs/spec_chunked_embeddings.md`)

**What to build:** 完成 `tools/Reindex.gs`:`reindexAllArticles` 取得待重建文章(`articles_needing_reindex`)、逐篇切段 → 批次嵌入 → 以 `save_article`(只帶段落)寫入;約 5 分鐘時存檔停止並記錄進度(已處理/剩餘),Property 保留以便續跑;遇到 429 優雅停止;超過 40 段的文章記錄並略過;**全部處理完後自動刪除 `REINDEX_ENABLED`**。換模型時只改 `EMBEDDING_MODEL_ID_` 常數,模型不同的文章自動被視為待重建。

**接縫:** GAS `httpFetch_`、假時鐘。

- [x] 未設或非 `true` 的 Property → 拒絕且不發出請求
- [x] 逐篇處理:每篇一個批次嵌入請求 + 一個 `save_article`(只帶段落與模型,不帶欄位與標籤)
- [x] 時限前停止:達到時間預算後不再開始新文章,日誌記錄進度,Property 保留;再次執行只處理剩餘者
- [x] 全部完成 → Property 被刪除;中途停止或失敗 → 不刪除
- [x] 429 → 停止、日誌說明、Property 保留;其他上游錯誤 → 記錄該篇並繼續下一篇
- [x] 超過 40 段 → 記錄並略過,不使整批失敗
- [x] 日誌與回傳不含文章內容與金鑰
- [x] 文件(工具檔頂端註解)寫明:上傳 → 設 Property → 試跑 → 正式 → 刪檔;換不同維度的模型需改 schema

> **實作註記:** (1) 「完成」的定義:沒有因為時間預算或 429 停下、也沒有失敗的文章 → 自動刪除 `REINDEX_ENABLED`。**超過 40 段的文章只記錄、不算失敗**,所以它們不會讓工具永遠無法完成(它們本來就必須由擁有者拆成多篇);代價是每次執行都會再報告一次。
> (2) 429 以訊息比對 `error 429` 判斷(客戶端的錯誤訊息固定為 `Gemini batch embedding error <狀態碼>: ...`),命中時視為『該停了』而非『這篇失敗』,剩餘篇數含觸發 429 的那一篇。(3) 單篇失敗(Gemini 5xx 或 `save_article` 被拒)記錄 id / 標題 / 前 200 字原因後繼續下一篇;有失敗則 Property 保留,再執行會重試。
> (4) 只送 `p_id` / `p_chunks` / `p_embedding_model`:不帶欄位與標籤,文章的 `updated_at` 與標籤不會被動到(測試與破壞驗證都守住)。(5) 破壞驗證七種:不解除、失敗也解除、不處理 429、忽略時限、誤帶 `p_fields`、單篇失敗中止、超長也硬送,全部變紅。
