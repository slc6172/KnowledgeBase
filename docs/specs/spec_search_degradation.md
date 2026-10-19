---
title: 搜尋降級(語意搜尋失敗時仍回傳關鍵字結果)
status: ready-for-agent
date: 2026-09-28
project: GAS + Supabase 個人/團隊知識庫
depends_on: spec_search.md(已完成)、spec_search_relevance.md(已完成)、spec_stale_async_response_guards.md(已完成)
---

# 搜尋降級 — Spec

**Triage label**:`ready-for-agent`

**來源**:`/grilling` 對談定案(2026-09-28);研究參考見〈Further Notes〉。

## Problem Statement

`searchArticles` 一定要先呼叫 Gemini 產生查詢向量,再帶著向量呼叫 `hybrid_search_articles`。只要 Gemini
那一步失敗(配額用盡 429、伺服器 5xx、逾時、金鑰缺漏或失效),**整個搜尋就失敗**,使用者看到錯誤訊息、
什麼結果都沒有——即使 Hybrid Search 裡的關鍵字(`pg_trgm`)那一半根本不需要向量,資料庫也完全正常。

## Solution

`searchArticles` 在「產生查詢向量」失敗時,改用**空向量**呼叫同一個 RPC,只取回關鍵字比對的結果,並在回傳值裡標記
`degraded`。前端在結果列表上方顯示一則不阻擋操作的提示,說明目前僅為關鍵字比對。搜尋不再因為 Gemini 而整個壞掉,
同時因為提示一律顯示,擁有者不會在毫不知情下長期停留在降級狀態。

**已驗證的事實(2026-09-28,真實 PostgreSQL 16 + pgvector 0.6.0,執行專案 schema 檔):**
`hybrid_search_articles` 收到 NULL 向量時,語意那一路自然為空(`向量 <=> NULL` 為 NULL,條件不成立),關鍵字那一路照常
回傳;函式簽名不變、**不需要任何 schema 變更、不需要在 Supabase 執行任何 SQL**。同時實測降級模式的品質限制:關鍵字那一路
要求整篇(標題+內文)的 trigram 相似度 ≥ 0.3,短查詢(例如「React」)可能回傳 0 筆。

## User Stories

**搜尋使用者**

1. As a 知識庫使用者, I want Gemini 暫時不可用時搜尋仍然能回傳結果, so that 我不會因為外部服務問題完全無法找資料
2. As a 知識庫使用者, I want 看到明確的提示知道目前只是關鍵字比對, so that 我理解結果為什麼可能比平常少
3. As a 知識庫使用者, I want 提示不阻擋我操作也不需要額外點擊, so that 我可以照常瀏覽與開啟文章
4. As a 知識庫使用者, I want 降級模式下查無結果時看到專屬的說明, so that 我知道「沒找到」可能只是語意搜尋暫時不可用,稍後再試也許就有
5. As a 知識庫使用者, I want 下一次搜尋自動重新嘗試語意搜尋, so that Gemini 恢復後不需要任何額外操作就回到完整功能
6. As a 知識庫使用者, I want 降級時標籤篩選、狀態篩選、分類篩選仍然照常運作, so that 縮小範圍的方式不受影響
7. As a 知識庫使用者, I want 舊的搜尋結果或降級提示不會蓋掉最新一次搜尋的畫面, so that 快速連續搜尋時畫面不會錯亂

**擁有者**

8. As an 擁有者, I want Gemini 金鑰缺漏或失效時搜尋也降級而不是整個壞掉, so that 團隊仍能找資料,而我從一直出現的提示就能發現金鑰有問題
9. As an 擁有者, I want 每次降級的原因被寫進日誌(不含金鑰), so that 我能事後判斷是配額、逾時還是設定錯誤
10. As an 擁有者, I want 降級**只**涵蓋「產生查詢向量」這一步, so that 資料庫查詢失敗等真正的錯誤不會被降級掩蓋
11. As an 擁有者, I want 既有的兩層搜尋節流照舊, so that 降級不會變成繞過用量保護的途徑
12. As an 擁有者, I want 不需要執行任何資料庫遷移, so that 部署只是推送 GAS 程式

**開發者**

13. As a 開發者, I want AI 問答(`askKnowledgeBase`)的行為完全不變, so that 這次改動不波及 RAG 的錯誤處理與測試
14. As a 開發者, I want 降級狀態以明確的回傳欄位傳遞而不是附加在陣列上, so that 它能通過 `google.script.run` 的 JSON 序列化
15. As a 開發者, I want 既有搜尋測試只需配合新回傳形狀更新斷言, so that 我確信檢索邏輯本身沒被動到

## Implementation Decisions

**降級範圍**

- 降級只包住「產生查詢向量」這一個呼叫。該呼叫拋出的**任何**錯誤都降級,包含:Gemini 回應碼 ≥ 400(含 429)、網路例外/逾時、回應格式異常、`GEMINI_API_KEY` 缺漏。理由:設定錯誤若讓搜尋整個壞掉,團隊完全無法使用;若安靜降級,擁有者永遠不知道金鑰壞了——因此**提示必須一律顯示**,且原因寫入日誌。
- 降級後以空向量呼叫既有的 `hybrid_search_articles`,其餘 RPC 參數(標籤、筆數、門檻、僅已發布)與後續補資料流程完全不變。
- 空向量之後的任何錯誤(RPC 失敗、補資料查詢失敗、回傳非陣列)照舊拋出,**不降級**。
- 關鍵字門檻**沿用現行預設值**,降級時不放寬。放寬與否待累積真實資料後另議。
- 每次搜尋都會先重新嘗試產生向量(不做快取熔斷),因此 Gemini 恢復後下一次搜尋自動回復完整功能。
- 既有的輸入驗證(空字串、長度上限)與兩層節流(公開讀取節流、語意搜尋節流)維持在原本位置與順序,降級模式同樣計數。

**回傳形狀**

- 公開的 `searchArticles` 回傳形狀由「文章陣列」改為 `{ articles, degraded }`(`degraded` 為布林)。`google.script.run` 會丟掉附加在陣列上的屬性,所以不能用陣列屬性傳遞。
- 將檢索主體抽成內部函式,回傳同樣形狀,並可指定「是否允許降級」。公開 `searchArticles` 允許降級;`askKnowledgeBase` 改呼叫**不允許降級**的路徑,並維持拿到純文章陣列。`askKnowledgeBase` 的所有既有行為(含 embedding 失敗時照舊報錯、輸入驗證、兩層節流、選填參數處理)完全不變。
- 降級原因以既有日誌機制記錄(含錯誤分類與訊息,不含金鑰);不回傳給前端。

**前端**

- 搜尋成功處理改讀 `articles` 與 `degraded`;既有的狀態/分類前端篩選、卡片渲染、過期回應防護(序號比對)照舊,提示的顯示/隱藏也必須受同一套過期防護約束。
- `degraded` 為真時,在結果列表上方顯示不阻擋操作的提示,文字語意為:「語意搜尋暫時無法使用,以下僅為關鍵字比對結果,結果可能較少。」提示沒有「重試」按鈕(再按一次搜尋即重試)。
- 降級且篩選後結果為零時,空狀態改為專屬訊息,語意為:「關鍵字比對沒有找到結果。語意搜尋目前無法使用,稍後再試可能會有更多結果。」
- 每次新搜尋、回到一般列表模式時,提示必須先清除,避免殘留。
- AI 回答區塊(RAG)的行為不變:embedding 失敗時照舊顯示錯誤,不使用降級結果。

**其他**

- 相關文章推薦使用文章已儲存的向量,不呼叫 Gemini,不受此問題影響,不需修改。
- 不需要 schema 變更,不需要修改 `hybrid_search_articles`。
- README 新增變更紀錄一條;設計文件決策表新增一列(降級策略與其限制)。
- `docs/preview/Preview.html` 目前是舊快照(沒有 AI 回答區塊、其內嵌腳本與 mock 為舊版陣列形狀),本 spec **不要求**重建;前端驗證以靜態掃描測試 + 部署後手動實測為主。

## Testing Decisions

**好測試**:只驗證外部可觀察行為——送給 Gemini / Supabase 的請求內容、回傳值、拋出的錯誤;沿用專案慣例,以假的 `httpFetch_` 決定回應。

**接縫(全為既有接縫,無新增)**

1. **GAS 端:`httpFetch_`。**
2. **前端:靜態文字掃描測試**(讀前端原始碼比對關鍵元素與寫法)+ 部署後手動實測。前端沒有 DOM 行為測試接縫,維持現況。

**GAS 端測試案例**

- Gemini 回 429 → 回傳 `degraded: true`;送往 RPC 的向量為空;RPC 假回應的文章經補資料後回傳。
- Gemini 回 500、`httpFetch_` 拋出網路例外、回 200 但格式異常、`GEMINI_API_KEY` 缺漏 → 皆 `degraded: true`。
- Gemini 成功 → `degraded: false`,RPC 收到向量(既有測試僅更新回傳形狀斷言)。
- 降級且 RPC 回空 → `{ articles: [], degraded: true }`。
- 降級時標籤篩選、筆數、僅已發布、門檻等選填參數仍正確傳給 RPC。
- 降級時 RPC 本身失敗 → 仍拋錯(不被降級吞掉);補資料查詢失敗 → 仍拋錯。
- 空字串、過長、任一層節流觸發 → 仍拋錯,不降級,且不呼叫 Gemini / RPC。
- 降級時語意搜尋節流計數仍遞增。
- 降級原因被記錄,且日誌內容不含 API 金鑰。
- `askKnowledgeBase`:embedding 失敗 → 行為與現況相同(報錯、不降級);既有 RagChat 測試不需修改斷言即全數通過。

**前端靜態掃描案例**:列表視圖含降級提示元素(固定 id);搜尋成功處理讀取 `articles` 與 `degraded`;降級空狀態文字存在;提示在新搜尋開始時被清除。

**手動驗證清單**:(a) 在 Supabase SQL Editor 以 NULL 向量呼叫 RPC 確認回傳;(b) 暫時把 `GEMINI_API_KEY` 改成無效值,搜尋 → 出現提示與關鍵字結果,日誌有原因;(c) 還原金鑰,再搜尋 → 提示消失;(d) 降級時搜尋短詞 → 出現降級空狀態訊息;(e) 降級時 AI 問答區塊顯示原本的錯誤;(f) 快速連續搜尋不會殘留舊提示。

**Prior art**:`test/Search.test.js`、`test/RagChat.test.js`、`test/ArticleListSearchStalenessGuard.test.js`(前端靜態掃描 + 過期防護)、`test/NavDrawer.test.js`(靜態掃描風格)。

## Out of Scope

- Gemini 呼叫的重試與退避(backlog #2,另立 spec;實作後會降低降級頻率)。
- AI 問答的降級或重試。
- 放寬降級模式的關鍵字門檻、改用 ILIKE 等其他備援搜尋。
- 熔斷快取(Gemini 持續失敗時跳過嘗試)。
- 寫入路徑(發布時產生文章向量)的失敗處理。
- schema 變更、`hybrid_search_articles` 修改。
- 重建 `docs/preview/Preview.html`。

## Further Notes

- **降級品質有限**:短查詢常回 0 筆(實測「React」0 筆)。降級模式的價值是「長一點、貼近標題/內容的查詢仍可用」與「不整個壞掉」,不是完整取代語意搜尋。累積真實文章資料後可評估放寬降級門檻。
- **延遲風險**:每次搜尋先嘗試 Gemini,若失敗型態是逾時,搜尋會被拖慢後才降級;429/5xx 通常很快。若實際觀察到問題,再考慮熔斷快取。
- **與 Edge Function 遷移 spec 相互獨立**:兩者動到不同模組,唯一共同點是測試設定的假設定(遷移 spec 會改假設定的金鑰項目),合併時衝突輕微。
- **參考 repo**:`lobehub/lobehub` 的 `packages/prompts/src/prompts/knowledgeBaseQA/formatSearchResults.ts`——其中一路檢索失敗時仍回傳另一路結果並附註。Archon v1 沒有對應的降級設計,不需參考。
- 本 spec 的實驗方法:沙箱內 `apt-get install postgresql postgresql-16-pgvector`,載入專案 schema 檔後以 NULL 向量呼叫函式;Supabase 實際版本可能不同,故保留手動驗證 (a)。
