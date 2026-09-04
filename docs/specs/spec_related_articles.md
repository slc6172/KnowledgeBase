---
title: 相關文章推薦
status: ready-for-agent
date: 2026-08-29
project: GAS + Supabase 個人/團隊知識庫
depends_on: schema.sql(hybrid_search_articles、articles.embedding)、spec_search.md(已完成)
---

# 相關文章推薦 — Spec

## Problem Statement

每篇已發布文章都已經有 768 維的 `embedding`(`DESIGN.md` 決策 #6、#8),但這個
向量目前只在使用者主動打字搜尋時,透過 `hybrid_search_articles` 被拿來做語意
比對——文章詳情頁本身沒有任何「延伸閱讀」的功能,使用者看完一篇文章後,不知道
知識庫裡還有哪些相關內容,除非自己想到關鍵字回去搜。

## Solution

文章詳情頁底下加一個「你可能也想看」區塊,拿這篇文章自己的 `embedding` 做最近鄰
搜尋,列出語意最相近的其他已發布文章。純向量比對,不牽涉關鍵字/RRF 融合,也
不需要另外呼叫 Gemini(直接重用文章自己已經算好、存在 DB 裡的向量)。

## User Stories

1. As a knowledge-base user, I want to see a "你可能也想看" section at the bottom of
   an article's detail page, so I can discover related content without manually
   searching.
2. As a knowledge-base user, I want the recommendations to only include published
   articles, so I never land on a draft I (or someone else) can't fully access the
   context of.
3. As a knowledge-base user, I want the current article itself excluded from its own
   recommendations, so the list isn't wasted on something I'm already reading.
4. As a knowledge-base user, I want recommendations filtered by the same relevance
   threshold `hybrid_search_articles` already uses, so a knowledge base with few
   articles doesn't force irrelevant matches just to fill a quota.
5. As a knowledge-base user, I want to see up to 3 related articles, so the section
   stays a lightweight "extended reading" list rather than crowding the detail page.
6. As a knowledge-base user, I want a draft article (no embedding yet) or a published
   article whose embedding failed to fall back to simply showing no recommendations
   (empty section, not an error), so viewing the article itself is never blocked by
   this feature.
7. As a developer, I want this to reuse the existing `articles.embedding` column
   without triggering any new Gemini API call, so this feature has no incremental
   Gemini cost.

## Implementation Decisions

**新增一個 Postgres 函式 `related_articles(source_article_id uuid, match_count int
default 3)`**,放進 `schema.sql`(比照 `hybrid_search_articles` 的既有寫法,一樣是
`security definer`、對 `articles` 表操作):

- 先用 `source_article_id` 查出該文章的 `embedding`(若查無此文章或
  `embedding is null`,回傳空集合,不報錯——對應 User Story 6)。
- 用 `<=>`(pgvector 的 cosine distance 運算子,與 `hybrid_search_articles`
  現有用法一致)比對其他 `status = 'published'` 且 `id <>
  source_article_id` 的文章。
- 沿用 `hybrid_search_articles` 現有的 `max_semantic_distance`(0.6)當篩選門檻,
  距離超過門檻的文章不回傳(對應 User Story 4;不足 `match_count` 篇時就回傳
  現有篩到的幾篇,不湊數)。
- `order by embedding <=> (該文章的 embedding) limit match_count`,回傳
  `articles` 原始欄位(跟 `hybrid_search_articles` 一樣是 `returns setof
  articles`,不含 `categories`/`article_tags` 的 join)。

**GAS 端新增 `RelatedArticles.gs`,單一函式 `getRelatedArticles(articleId)`**:

1. 呼叫 `supabaseRpc('related_articles', { source_article_id: articleId,
   match_count: 3 })`。
2. 跟 `Search.gs` 的 `searchArticles` 同樣的手法:用 RPC 回傳的 id 清單做一次
   `supabaseSelect('articles', 'id=in.(...)&select=...')` 補上
   `categories(id,name)`/`article_tags(tags(id,name))`,依 RPC 原始順序(相關性
   由近到遠)重新排列,再跑過 `normalizeArticleRow_` 攤平 `tags`。
3. RPC 回傳空陣列時直接回傳 `[]`,不做補查詢(跟 `Search.gs` 同樣的處理)。
4. 讀取類函式,不經過 `Auth.gs`/`callProtected`,任何人都能呼叫——跟
   `searchArticles`/`listArticles` 同一類。

**前端**:`ArticleDetailView.html` 的附件區塊(`<h3>附件</h3>`)後面(或前面,
UI 細節留給實作者判斷順序)新增一個「你可能也想看」區塊,`openArticleDetail`
載入文章詳情的同時呼叫 `getRelatedArticles(articleId)`,拿到結果後用跟
`renderArticleCards` 類似但精簡的卡片(標題 + 分類,不需要完整的
snippet/tags/狀態徽記,因為只會是已發布文章)呈現,點擊直接
`openArticleDetail(相關文章.id)` 切換過去。空陣列時整個區塊不顯示(不顯示
「沒有相關文章」這種空狀態文字,直接隱藏,對應 User Story 6 的「不擋住本來要看
的文章」精神)。

## Testing Decisions

**後端(SQL)**:`related_articles` 函式本身沒有自動化測試框架可用(專案目前對
`schema.sql` 裡的 Postgres 函式沒有 SQL 層級的測試,`hybrid_search_articles` 也
沒有),維持現狀,不在這次新增 SQL 測試基礎設施。實作完成後建議手動在 Supabase
SQL editor 跑一次 smoke test(比照 `spec_search.md` Further Notes 提到的
「屆時做一次端到端 smoke test」的作法)。

**GAS 端(`RelatedArticles.gs`)**:延續既有模式,透過假的 `httpFetch_` 驗證行為,
`test/Search.test.js` 是最直接的 prior art(同樣是「RPC → 補查詢 → 依原始順序
重排 → normalize」的流程)。

**關鍵測試情境**
1. 呼叫 `getRelatedArticles(articleId)` 時,RPC payload 正確帶
   `source_article_id`、`match_count: 3`。
2. RPC 回傳空陣列時,直接回傳 `[]`,不發出補查詢的網路呼叫。
3. RPC 回傳的 id 清單順序與補查詢結果順序不同時,最終回傳陣列仍依照 RPC 的
   原始(相關性)順序——沿用 `Search.gs` 已經驗證過的重排序邏輯寫法。
4. 回傳的每筆文章都跑過 `normalizeArticleRow_`(`tags` 是陣列、沒有
   `article_tags` 欄位)。

**前端**沒有自動化測試(既有慣例),`node --check` 驗證語法,明確告知使用者
需要手動驗收。

**手動驗收情境建議**:
1. 有相關文章的已發布文章,詳情頁能看到「你可能也想看」且點擊能正確切換過去。
2. 沒有相關文章(知識庫文章太少或都不相關)時,整個區塊不顯示,不留空白標題。
3. 草稿文章(沒有 `embedding`)的詳情頁不會因為這個區塊而報錯或卡住。

## Out of Scope

- 呼叫 Gemini 產生「為什麼推薦這篇」之類的說明文字——這個功能刻意設計成不牽涉
  Gemini,維持零增量成本。
- 相關文章的相關性分數顯示給使用者看——只排序,不顯示數字。
- 對草稿文章也算相關性推薦——只從已發布文章算,也只推薦已發布文章(User
  Story 2)。
- 使用者對推薦結果的回饋機制(例如「不感興趣」按鈕)——這次只做最基本的
  展示。

## Further Notes

- `related_articles` 函式在概念上幾乎是 `hybrid_search_articles` 拿掉關鍵字比對
  的簡化版,但刻意寫成獨立函式而不是重用/參數化 `hybrid_search_articles`——
  後者的輸入是一段查詢文字 + 向量,這裡的輸入是「一篇已存在的文章」,語意不同
  (不需要再對 `query_text` 算 `pg_trgm` 相似度),硬共用會讓其中一個函式的介面
  變得不自然。
