# 05 — 段落表與原子寫入 RPC(`save_article`)

**Type:** AFK

**Blocked by:** 01

**Status:** done

**對應 User Story:** 3、4、5、18、20(見 `docs/specs/spec_chunked_embeddings.md`)

**What to build:** 新資料表 `article_chunks`(文章連帶刪除、同文章段落序號唯一、段落文字、768 維向量、`embedding_model`、HNSW cosine 索引、RLS 開啟且無 policy,**不加入代理資料表白名單**)。新 RPC `save_article`:單一交易建立/更新文章欄位、狀態、整批取代段落、整組取代標籤;各部分獨立可選;段數上限 40;失敗整筆回滾。另一個輔助 RPC `articles_needing_reindex(模型)`:回傳「已發布且沒有任何段落、或有段落的模型不同」的文章 ID(重建工具用,無法直接讀段落表)。三個 RPC(`save_article`、`merge_tags` 已在 02、`articles_needing_reindex`)固定 `search_path`;代理 RPC 白名單新增 `save_article`、`articles_needing_reindex`。

**接縫:** SQL 整合測試(主要);Deno `handleRequest`;`EdgeFunctionProxyConfig`(白名單 = schema,並明列刻意不開放的 `article_chunks`)。

- [x] 建立草稿(含標籤)、更新欄位、發布(帶段落)、取消發布(只改狀態,段落保留)、只重建段落(欄位與標籤不動)
- [x] 標籤整組取代以差集完成(保留的關聯列不被刪除再重建);空清單 = 清空;未提供 = 不動
- [x] **原子性**:非法狀態、段數 41、向量維度錯誤、序號不連續 → 文章欄位、段落、標籤三者都維持原狀
- [x] 段數剛好 40 通過;段落整批取代時舊段落消失
- [x] 刪除文章連帶刪除段落
- [x] `articles_needing_reindex`:涵蓋無段落、模型不同、模型相同(不回傳)、草稿(不回傳)
- [x] 匿名角色讀寫不到 `article_chunks`;RLS 為七張表全開
- [x] Deno:兩個新 RPC 在白名單且僅 POST;對 `article_chunks` 直接請求回 403
- [x] `EdgeFunctionProxyConfig`:資料表白名單 = schema 全部資料表 − 明列的刻意不開放清單

> **實作註記:** (1) 驗收條件裡的「段落序號不連續被拒絕」**不適用**:段落序號由陣列順序決定(從 0 起),呼叫端無法傳入不連續的序號,所以這條在設計上不可能發生;改以「整批取代時舊序號不會殘留」的測試覆蓋。
> (2) `p_fields` 為 null(只重建段落、或只改標籤)時**不執行 UPDATE**——否則 `touch_updated_at` 觸發器會讓文章的 `updated_at` 變新,重建工具跑完所有文章就會在列表裡洗版;有測試守住,破壞驗證也確認會變紅。
> (3) 標籤差集:`delete ... where tag_id <> all(...)` 加 `insert ... on conflict do nothing`,以 `xmin` 證明保留的關聯列沒有被重寫。(4) 原子性測試涵蓋非法狀態、41 段、第二段向量維度錯誤、標籤不存在(外鍵)、段落缺少向量五種失敗,每種都比對『文章列 + 標籤 + 段落』寫入前後的完整快照;plpgsql 函式本身就是單一交易,所以這裡的重點是確認我們沒有用任何會跳出交易的寫法。
> (5) 資料表白名單測試改為『schema 全部資料表 − 明列的刻意不開放清單』,並新增兩條:清單不會悄悄過期、GAS 原始碼沒有直接存取私有表。(6) **這張票改了 `handler.ts`(RPC 白名單 +2),與其餘票一起在票 10 重新部署。**
