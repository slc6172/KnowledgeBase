---
title: AI 回答的「檢索到的相關文章」改為預設收合面板
status: ready-for-agent
date: 2026-09-28
project: GAS + Supabase 個人/團隊知識庫
depends_on: spec_rag_qa.md(已完成)、spec_responsive_layout.md(已完成)、spec_visual_design_refresh.md(已完成)
---

# AI 回答來源面板 — Spec

**Triage label**:`ready-for-agent`

**來源**:`/grilling` 對談定案(2026-09-28);研究參考見〈Further Notes〉。

## Problem Statement

AI 問答每次回答後,答案下方會把**所有檢索到的文章標題**做成膠囊按鈕全部攤開。`askKnowledgeBase` 沒有指定筆數,
所以預設最多 **20 篇**,窄螢幕上會排成好幾列,把答案本身擠到一邊、拉長整個面板。

另外還有一個命名問題:這些文章是**檢索結果**,不是 Gemini 實際引用的——提示詞沒有要求標註引用。目前的「來源」
呈現會讓人誤以為答案是根據這些文章逐一得出。

## Solution

把來源區改成**預設收合**的原生 `<details>` 面板:標題列寫「檢索到的相關文章(N)」,點擊展開後是**垂直列表**,每列顯示
文章標題與分類名稱;點某一列就開啟該文章(維持現有行為)。答案本身成為視覺重心,來源需要時才展開,措辭也如實反映
「這是檢索到的文章」。

## User Stories

**知識庫使用者**

1. As a 知識庫使用者, I want AI 答案下方的文章清單預設收合, so that 我先看到答案而不是一長串按鈕
2. As a 知識庫使用者, I want 收合的標題列顯示檢索到的文章數量, so that 不展開也知道範圍有多大
3. As a 知識庫使用者, I want 展開後看到每篇文章的標題與所屬分類, so that 我能快速判斷該點哪一篇
4. As a 知識庫使用者, I want 未分類的文章只顯示標題、不出現空白或「null」, so that 畫面乾淨
5. As a 知識庫使用者, I want 點擊列表中的文章能開啟該文章, so that 我可以查證答案
6. As a 手機使用者, I want 列表是垂直排列且每列有足夠大的點擊範圍, so that 不會誤觸
7. As a 知識庫使用者, I want 長標題在窄螢幕上自動換行而不是撐破版面, so that 我讀得到完整標題
8. As a 知識庫使用者, I want 每次新的回答都重新回到收合狀態, so that 畫面行為一致可預期
9. As a 知識庫使用者, I want 用鍵盤也能展開/收合並選取文章, so that 操作不限於觸控與滑鼠
10. As a 知識庫使用者, I want 標題列的措辭寫「檢索到的相關文章」而不是「參考來源」, so that 我不會誤以為每篇都是答案的實際依據

**擁有者 / 開發者**

11. As an 擁有者, I want 查無相關資料的回答仍然完全不顯示此面板, so that 「知識庫沒有相關資料」的訊息維持原樣
12. As a 開發者, I want 來源資料形狀的變更集中在 `askKnowledgeBase` 的回傳值, so that 影響範圍清楚
13. As a 開發者, I want 分類名稱與標題都以純文字方式插入畫面, so that 使用者資料不會變成可執行內容
14. As a 開發者, I want 這次改動不碰檢索、提示詞與 Gemini 呼叫, so that 回答內容與用量完全不變

## Implementation Decisions

**後端(`askKnowledgeBase` 回傳值)**

- `sources` 陣列每個元素由 `{ id, title }` 擴充為 `{ id, title, categoryName }`。`categoryName` 取自檢索時已一併查回的分類關聯(不需額外請求);文章未分類時為 `null`。
- 順序、數量(仍為所有檢索到的文章)、`noRelevantArticles` 情況(`sources` 為空陣列)不變。提示詞、檢索、Gemini 呼叫完全不動。

**前端(`renderAiAnswerTurn` 的來源區)**

- 有來源時,渲染一個原生 `<details>`(不加 `open`,預設收合)。`<summary>` 文字格式:「檢索到的相關文章(N)」,N 為 `sources.length`。
- 展開內容為垂直列表,每列一個可點擊按鈕:主要文字為文章標題,次要文字為分類名稱(`categoryName` 為空時完全不渲染次要文字與其分隔符)。點擊呼叫既有的 `openArticleDetail(source.id)`。
- 標題與分類名稱以 `textContent` 設定,不以字串拼接進 `innerHTML`。
- 列的點擊範圍高度不小於 44px;長標題自動換行;面板維持既有的 `.ai-answer` 捲動行為(最大高度 60vh),來源列表不另設筆數上限。
- 每次渲染新一輪回答都重新建立面板,因此每次都回到收合。
- 套用所有螢幕寬度,不做僅限手機的分支。
- 舊的膠囊樣式(`ai-answer__source` 相關規則)被新樣式取代,不保留死碼。新樣式使用專案既有的設計 token(顏色、圓角、字型),與視覺設計一致;`<summary>` 需有明確的可操作外觀(指標樣式、聚焦樣式)。
- `noRelevantArticles` 的顯示、`conversationHistory` 的累積邏輯不變。

**文件**

- README 新增變更紀錄一條;RAG 相關 spec 不改(歷史文件),本 spec 為後續補充。

## Testing Decisions

**好測試**:後端只驗證回傳值形狀;前端沒有 DOM 行為測試接縫,以靜態文字掃描 + 手動實測把關(專案既有做法)。

**接縫(全為既有接縫,無新增)**

1. **GAS 端:`httpFetch_`。**
2. **前端:靜態文字掃描測試 + 部署後手動實測。**

**後端測試案例**(更新 `RagChat` 既有測試):

- 有分類的文章 → `sources` 元素含 `categoryName`;未分類 → `categoryName` 為 `null`。
- 多篇文章 → 順序與檢索順序一致、數量與檢索結果相同。
- `noRelevantArticles` 情況 → `sources` 仍為空陣列,行為與現況相同。
- 既有的其他 RagChat 測試維持通過(除 `sources` 形狀斷言需更新外,不需其他修改)。

**前端靜態掃描案例**:來源區以 `<details>` 建立且渲染時不帶 `open`;`summary` 文字含「檢索到的相關文章」與數量;標題與分類以 `textContent` 設定;舊的膠囊 class 已不存在於腳本與樣式;列表按鈕的最小高度規則存在。

**手動驗證清單**(部署後,含約 375px 窄螢幕):預設收合;展開後為垂直列表;20 篇時可捲動、不撐破版面;長標題換行;未分類文章無殘留分隔符;點擊開啟文章;下一輪回答回到收合;鍵盤可展開與選取;查無資料時不出現面板。

**Prior art**:`test/RagChat.test.js`(現有 `sources` 斷言)、`test/NavDrawer.test.js`、`test/VisualDesignRefresh.test.js`、`test/DestructiveActionConfirmation.test.js`(前端靜態掃描風格)。

## Out of Scope

- 只顯示 Gemini 實際引用的文章(需修改提示詞要求標註引用並解析輸出,是另一個功能)。
- 內文摘要(開頭幾十字不代表命中原因,容易誤導)。
- 限制檢索筆數、限制顯示筆數、「顯示更多」按鈕。
- 修改提示詞、檢索、Gemini 呼叫或模型。
- 重建 `docs/preview/Preview.html`(它目前是舊快照,沒有 AI 回答區塊)。

## Further Notes

- **後續已處理**:RAG 提示詞送最多 20 篇文章全文的問題,已由 `docs/specs/spec_rag_excerpts.md` 處理(改送節錄、最多 8 篇),本面板的數量(N)因此最多 8 篇。
- **與搜尋降級 spec 相互獨立**:兩者動到 `JavaScript.html` 的不同函式(搜尋成功處理 vs. AI 回答渲染),實作順序不拘。
- **參考 repo**:`lobehub/lobehub` 的 `src/features/Conversation/Messages/components/FileChunks/index.tsx`(檢索到的內容預設收合、點擊展開,窄螢幕友善)與同目錄 `ChunkItem.tsx`(展開後的單項呈現)。本專案不採用其片段(chunk)呈現,因為文章整篇作為一個檢索單位。
