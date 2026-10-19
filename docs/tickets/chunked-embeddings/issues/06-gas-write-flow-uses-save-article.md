# 06 — GAS 寫入流程改走 `save_article`

**Type:** AFK

**Blocked by:** 03, 04, 05

**Status:** done

**對應 User Story:** 1、2、3、4、5(見 `docs/specs/spec_chunked_embeddings.md`)

**What to build:** 建立文章、更新文章、發布、取消發布四條流程改為組出 payload 後只送**一個** `save_article` 請求:標籤名稱先經 `findOrCreateTag_` 轉成 ID;發布與更新已發布文章時,先切段、檢查段數(超過 40 段在呼叫 Gemini 之前就拒絕,訊息含實際段數與上限)、再批次嵌入、一起送出。Gemini 失敗時不呼叫 `save_article`。移除 `syncArticleTags_` 與各流程內的多步驟呼叫。取消發布只改狀態。對使用者:長文發布後全部段落都被索引;儲存失敗不會留下半成品。

**接縫:** GAS `httpFetch_`。

- [x] 建立:一個 `save_article` 請求(欄位 + 標籤,無段落)
- [x] 更新草稿:一個請求(欄位 + 標籤,無段落);更新已發布:欄位 + 標籤 + 全部段落
- [x] 發布:一個請求(狀態 + 段落);取消發布:一個請求(只有狀態)
- [x] 段落內容與切段結果一致;每段向量對應該段;`embedding_model` 為目前常數
- [x] 超過 40 段:不呼叫 Gemini、不呼叫 `save_article`,丟出含段數與上限的安全訊息;草稿儲存不受影響
- [x] Gemini 失敗:不呼叫 `save_article`,回傳既有的安全 AI 錯誤
- [x] `save_article` 失敗:回傳既有的安全資料錯誤;沒有任何其他寫入請求
- [x] `syncArticleTags_` 已移除;`deleteArticle_`、批次改分類/加標籤行為不變
- [x] 舊的多步驟流程測試被新行為測試取代

> **實作註記:** (1) 保留既有語意:`updateArticle_` 只有在 `title` 或 `content_md` 被帶上、而且文章已發布時才重算向量(只改分類或標籤不重算);`category_id` 明確給 `null` 是清除分類;什麼都沒給是 no-op(沒有任何寫入請求)。
> (2) **順序**:Gemini 在任何寫入之前呼叫,而且「新標籤的建立」排在 Gemini 成功之後——Gemini 失敗時連殘留的新標籤都不會有(有測試,且破壞驗證確認會變紅)。標籤建立本身是獨立冪等動作,即使之後 `save_article` 失敗,殘留的只是一個沒人引用的標籤。
> (3) 只改標籤或只改分類時不帶 `p_fields` / `p_chunks`,資料庫因此不會動到 `updated_at`、也不會重寫段落。(4) 取消發布只改狀態,不讀取、不呼叫 Gemini,段落由資料庫保留。
> (5) 舊測試處理:`Articles.test.js` 裡被新行為取代的 14 個區塊(含整個 `syncArticleTags_` 與『embedding error propagation』describe)已移除,業務規則改寫進 `ArticleWriteFlow.test.js`(29 個),不是刪掉了事;`Auth.test.js` 的分派測試與 F-09 的靜態掃描下限(15 → 8,目前實際 11 個呼叫點)隨之更新。
> (6) 超過 40 段的訊息:「這篇文章太長(切成 N 段,上限 40 段,約 6 萬字),無法發布。請拆成多篇,或縮短內容;草稿不受這個限制。」(7) 破壞驗證:五種(標籤順序、段數上限、p_fields 誤送、向量錯位、取消發布誤算)全部變紅。
