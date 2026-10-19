# 02 — 標籤合併原子化(`merge_tags`)

**Type:** AFK

**Blocked by:** 01

**Status:** done

**對應 User Story:** 6、18(見 `docs/specs/spec_chunked_embeddings.md`)

**What to build:** 新增資料庫函式 `merge_tags`:單一交易內完成標籤合併(同時擁有來源與目標標籤的文章只刪除指向來源的關聯,其餘改指向目標,最後刪除來源標籤);來源等於目標或任一標籤不存在則拒絕;失敗整筆回滾。加入代理的 RPC 白名單,`mergeTags_` 改為一次 RPC 呼叫,取代逐篇多步驟流程。對使用者的行為不變,只是中途失敗不會留下一半搬完的狀態。

**接縫:** SQL 整合測試(原子性);GAS `httpFetch_`;Deno `handleRequest`。

- [x] SQL:一般搬移、同時擁有兩個標籤的文章、來源等於目標被拒絕、標籤不存在被拒絕、失敗時整筆回滾(資料不動)
- [x] SQL:函式固定 `search_path`
- [x] GAS:`mergeTags_` 只送出一個 `merge_tags` 請求;回傳值與現行相同;上游錯誤仍轉成安全訊息
- [x] Deno:`merge_tags` 在 RPC 白名單內且僅允許 POST;`EdgeFunctionProxyConfig` 的一致性測試涵蓋
- [x] 舊的逐篇多步驟測試被新行為的測試取代(不是刪掉而不補)

> **實作註記:** (1) GAS 保留 `findTagOrThrow_` 的兩次預檢,使用者仍看到清楚的「找不到標籤」;資料庫端的 `merge_tags` 另外檢查並拒絕(兩次檢查之間標籤被刪的極小機率情況由它擋下)。
> (2) 原本的 `TAG_MERGE_MAX_ARTICLES_ = 200`(避免逐篇請求撞 6 分鐘時限)在單一交易下沒有意義,連同它的測試一併移除。
> (3) 函式不加 `security definer`,匿名角色呼叫時因 RLS 什麼都動不了(有測試)。(4) 破壞驗證:SQL 兩種、GAS 一種、白名單一種,都變紅。(5) **這張票改了 `handler.ts`,與其餘票一起在票 10 重新部署。**
