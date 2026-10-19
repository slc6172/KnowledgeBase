# 07 — 檢索改用段落並移除 `articles.embedding`

**Type:** AFK

**Blocked by:** 05(建議在 06 之後)

**Status:** done

**對應 User Story:** 1、7、8、9、10、11、17(見 `docs/specs/spec_chunked_embeddings.md`)

**What to build:** `hybrid_search_articles` 語意那一路改為「每篇文章最接近的那一段」的 cosine 距離(門檻語意不變,預設 0.4);關鍵字那一路、融合排序、篩選、降級行為不變;回傳除了文章 ID 與順序外,額外回傳命中段落序號與文字(僅語意命中時有值)。`related_articles` 改為任一段相近即命中(取每篇候選文章的最小距離,門檻 0.6,排除自己與草稿,最多 3 篇)。移除 `articles.embedding` 欄位與它的索引。GAS 搜尋、相關文章、AI 問答配合新的回傳形狀(AI 問答仍送整篇全文;命中段落欄位這次不使用)。

**接縫:** SQL 整合測試(主要);GAS `httpFetch_`。

- [x] SQL:長文**最後一段**的內容查得到(以校準向量重現 F-03 的烹飪/天文情境)
- [x] SQL:語意門檻;僅已發布;分類與標籤篩選;關鍵字那一路與融合排序與舊行為一致;查詢向量為空時只剩關鍵字結果
- [x] SQL:命中段落序號與文字正確;只由關鍵字命中時為空
- [x] SQL:相關文章 —— 任一段相近即命中、排除自己與草稿、最多 3 篇、門檻 0.6
- [x] SQL:`articles` 沒有 `embedding` 欄位;舊簽名的函式不存在
- [x] GAS:搜尋與相關文章能處理新回傳形狀;結果順序、降級提示、AI 問答行為不變
- [x] `schema.sql` 靜態掃描更新(無 `articles.embedding`、無 `articles_embedding_idx`)

> **實作註記:** (1) `hybrid_search_articles` 回傳型別改為 `table(id, best_chunk_index, best_chunk_content, semantic_distance)`;`related_articles` 仍回傳文章列(`setof articles`)。GAS 兩處都只取 `.id` 再另外查詢整列,所以**GAS 不需要改程式碼**,只更新了註解。命中段落欄位這次沒有被 GAS 使用(留給 AI 問答只送命中段落的後續項目),只由 SQL 測試覆蓋。
> (2) 基準:單段文章 a1~a5 沿用票 01 的期望值與資料,行為完全相同;新增三段長文 a6 重現 F-03(尾段內容查得到、命中第 2 段)。(3) 效能備註寫在 schema 註解:語意那一路先過濾門檻、再用視窗函式取每篇最近的一段,沒有用到 HNSW 做近似最近鄰;個人 / 小團隊規模足夠。
> (4) **破壞驗證抓到一個測試盲點**:把語意預設門檻改成 0.9,原本 20 個測試居然全過——沒有任何測試真的依賴「預設 0.4」。補上距離 0.5 / 0.35 / 0.45 的邊界測試與相關文章 0.55 / 0.65 的邊界測試後,0.9、0.3(語意)與 0.8、0.5(相關)四種門檻錯誤都會變紅。(5) `articles.embedding` 與 `articles_embedding_idx` 已移除,有 SQL 與靜態兩層守門。
> (6) 其餘破壞驗證:只看第 0 段、不去重、相關文章只用來源第 0 段、把草稿也推薦、降級時仍回傳段落欄位,全部變紅。
