---
title: GAS 後端 — Supabase REST Client + 文章 CRUD
status: ready-for-agent
date: 2026-08-15
project: GAS + Supabase 個人知識庫
depends_on: schema.sql (見 gas_supabase_kb_design/schema.sql), DESIGN.md
---

# GAS 後端:Supabase REST Client + 文章 CRUD — Spec

## Problem Statement

使用者要打造一個「文章為核心、附件為支撐」的個人知識庫,以 Google Apps Script(GAS)
作為操作介面、Supabase(Postgres)作為資料儲存。資料庫 schema 已經設計完成
(`schema.sql`),但目前使用者還不方便建立/測試真正的 Supabase 專案。在資料庫還沒
連上之前,需要先把 GAS 端「跟 Supabase 溝通、管理文章生命週期」的後端邏輯寫出來、
並且能在沒有真實 Supabase 連線的情況下驗證邏輯正確性,這樣一旦 Supabase 就緒,
可以直接接上而不用重寫。

此外,依先前定案:單人使用(不做 Auth/RLS)、GAS 以伺服器端代理呼叫 Supabase(金鑰
存 Script Properties,不進瀏覽器)、文章內容為 Markdown、發布時需同步呼叫 Gemini
API 產生 embedding 向量。這些限制都要反映在後端邏輯裡。

## Solution

在 GAS 專案裡建立一組伺服器端函式:

1. **Config**:從 Script Properties 讀取 Supabase URL、service_role key、Gemini API
   key,缺任何一項就丟出清楚的錯誤訊息。
2. **SupabaseClient**:一個通用的 Supabase REST(PostgREST)呼叫層,所有實際的
   HTTP 請求都收斂到單一一個可替換的底層函式(`httpFetch_`),上層再包出
   select/insert/update/delete/rpc 這幾個好用的介面。
3. **Articles**:文章的建立、編輯、查詢(單筆/列表)、刪除,以及標籤同步邏輯,全部
   建立在 SupabaseClient 之上,不直接碰 `UrlFetchApp`。
4. **Embeddings**:文章狀態轉為 `published`,或已發布文章的標題/內容被修改時,
   自動呼叫 Gemini `gemini-embedding-001` 產生 768 維向量並寫回 `articles.embedding`。

因為所有網路呼叫都收斂在 `httpFetch_` 這一個接縫,CRUD 邏輯本身(query 怎麼組、
tag 怎麼同步、什麼時候該重新產生 embedding)可以用假的 `httpFetch_` 回應獨立測試,
不需要真的連上 Supabase 或 Gemini,解決「schema 還沒法測」的當前限制。

## User Stories

**設定與金鑰管理**
1. As a developer setting up the project, I want to write Supabase URL / service_role
   key / Gemini API key into Script Properties via a one-time setup function, so that
   credentials never appear in source code or reach the browser.
2. As a developer, I want a clear thrown error naming exactly which Script Property is
   missing, so that I can fix configuration without guessing.

**SupabaseClient(通用 REST 層)**
3. As a developer, I want one generic function that issues authenticated REST calls to
   Supabase, so that every table operation shares the same headers and error handling.
4. As a developer, I want select/insert/update/delete/rpc helper functions built on the
   generic client, so that Articles.gs never has to construct raw PostgREST requests by
   hand.
5. As a developer, I want a 4xx/5xx response from Supabase to throw a descriptive Error
   containing the status code and response body, so that failures are diagnosable from
   the Apps Script execution log.
6. As a developer, I want every outgoing HTTP call to pass through a single injectable
   function, so that I can substitute a fake implementation in tests and validate CRUD
   logic without a live Supabase connection.
7. As a developer, I want insert/update calls to request `Prefer: return=representation`,
   so that I get the affected row back without an extra round-trip GET.

**建立與編輯文章**
8. As a knowledge-base user, I want to create a new article with title, Markdown
   content, an optional category, and a list of tag names, so that it's saved with
   `status = 'draft'` by default.
9. As a knowledge-base user, I want tag names that don't exist yet to be created
   automatically when I save an article, so that I never have to pre-register tags.
10. As a knowledge-base user, I want tag names that already exist to be reused rather
    than duplicated, so that my tag list doesn't fragment.
11. As a knowledge-base user, I want to edit an existing article's title, content, or
    category independently, so that partial edits don't require resending everything.
12. As a knowledge-base user, I want saving an edit with a new tag list to fully replace
    the article's previous tag associations, so that removed tags no longer apply.
13. As a knowledge-base user, I want to fetch one article by ID together with its
    category and tags in a single call, so that a detail/edit view has everything it
    needs.
14. As a knowledge-base user, I want a clear "not found" error when I request an article
    ID that doesn't exist, so that the caller can show an appropriate message instead of
    crashing on empty data.
15. As a knowledge-base user, I want to list articles filtered by status and/or
    category, ordered by most recently updated first, so that I can browse my knowledge
    base without loading everything.
16. As a knowledge-base user, I want article lists to support `limit`/`offset`
    pagination, so that a growing collection stays fast to load.
17. As a knowledge-base user, I want article list results to omit the (potentially
    large) embedding vector field, so that list calls stay lightweight.
18. As a knowledge-base user, I want to delete an article, so that outdated content is
    permanently removed (hard delete, no recovery — matches the earlier "no recycle
    bin" decision).
19. As a knowledge-base user, I want deleting an article to also remove its tag
    associations automatically, so that no orphaned join rows remain (relies on the
    `on delete cascade` foreign key already defined in `schema.sql`).

**草稿 / 發布與 Embedding**
20. As a knowledge-base user, I want a newly created or still-draft article to not
    trigger any Gemini API call, so that I don't spend embedding quota while still
    writing.
21. As a knowledge-base user, I want an article to automatically get an embedding when I
    change its status to `published`, so that it becomes findable by semantic search
    later.
22. As a knowledge-base user, I want a published article's embedding to be regenerated
    automatically whenever its title or content changes, so that the stored vector never
    drifts out of sync with the visible text.
23. As a knowledge-base user, I want edits that touch only category or tags (not title
    or content) on a published article to NOT trigger a new embedding call, so that
    unrelated metadata edits don't waste API quota.
24. As a developer, I want the embedding request to use the `gemini-embedding-001`
    model with `outputDimensionality: 768`, so that the returned vector matches the
    `articles.embedding vector(768)` column already defined in `schema.sql`.
25. As a developer, I want a failed embedding call (e.g. Gemini API error) to throw
    rather than silently leave `embedding` unset, so that a "published but not actually
    searchable" article never happens invisibly.

**可測試性**
26. As a developer, I want to exercise every Articles.gs function against a fake
    `httpFetch_` that returns scripted PostgREST-shaped responses, so that I can verify
    correctness (request shape, tag-sync behavior, embedding-trigger conditions) before
    a real Supabase project exists.
27. As a developer, I want the embedding-trigger logic tested independently of the
    Supabase calls, so that I can confirm the "draft skip / publish trigger / edit
    trigger / metadata-only skip" rules are each correct.

## Implementation Decisions

**檔案結構**(Apps Script `.gs` 檔)
- `Config.gs` — `getConfig_()` 讀取並驗證 Script Properties;`setupScriptProperties()`
  作為一次性手動執行的設定函式。
- `SupabaseClient.gs` — `httpFetch_(url, params)`(唯一的底層 HTTP 呼叫,預設實作為
  `UrlFetchApp.fetch`,測試時替換);`supabaseRequest(method, path, options)`;
  `supabaseSelect/Insert/Update/Delete/Rpc(...)` 這幾個薄包裝。
- `Articles.gs` — `createArticle`、`updateArticle`、`setArticleStatus`、`getArticle`、
  `listArticles`、`deleteArticle`,以及私有的 `syncArticleTags_`、`findOrCreateTag_`、
  `normalizeArticleRow_`。
- `Embeddings.gs` — 私有的 `generateEmbedding_(text)`、`regenerateArticleEmbedding_(article)`。

**認證方式**:所有請求一律用 Supabase **service_role key**(Script Properties 讀出,
不外流到瀏覽器),對應先前決策——單人使用、不啟用 Supabase Auth / RLS。

**PostgREST 呼叫慣例**
- Base URL:`{SUPABASE_URL}/rest/v1/{table}`。
- Headers:`apikey`、`Authorization: Bearer {service_role_key}`、
  `Content-Type: application/json`,insert/update 另加
  `Prefer: return=representation`。
- 錯誤:回應碼 ≥ 400 一律 throw `Error`,訊息包含狀態碼與原始回應內容。

**文章欄位**(對應 `schema.sql` 的 `articles` 表):
`id`、`title`、`content_md`、`category_id`、`status`(`draft` | `published`)、
`embedding`(`vector(768)`,由本 spec 的邏輯寫入)、`created_at`、`updated_at`。

**標籤同步策略**:`syncArticleTags_` 採「先刪光再整批重建」——每次存檔都刪掉該文章
現有的 `article_tags` 記錄,再依傳入的 `tag_names` 重新插入。邏輯簡單、正確性有保證;
先前已確認規模小,效能不是考量。`findOrCreateTag_` 用完全相符的 `name` 比對,查無則
新建一筆 `tags` 記錄。

**Embedding 觸發規則**(對應 DESIGN.md 決策 #6、#13):
- `status` 仍是 `draft`:不呼叫 Gemini。
- `setArticleStatus(id, 'published')`:一定呼叫一次(不論這是第一次發布還是重新發布)。
- `updateArticle(id, data)` 且文章目前 `status === 'published'`:只有當 `data` 有帶
  `title` 或 `content_md` 才觸發重新產生;只改 `category_id` 或 `tag_names` 不觸發。
- 送進 Gemini 的文字:`title + '\n\n' + content_md`(Markdown 原文,不需要先去格式化,
  對應先前「純 Markdown」決策)。

**Embedding API 呼叫方式**(2026-08-15 查證現行 Gemini API 文件後更新):
- Endpoint:`POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent`
- Header:`x-goog-api-key: {GEMINI_API_KEY}`
- Payload:
  ```json
  {
    "model": "models/gemini-embedding-001",
    "content": { "parts": [{ "text": "..." }] },
    "outputDimensionality": 768
  }
  ```
  > **2026-08-18 更新**:原本照官方文件寫成 `embedContentConfig: {
  > outputDimensionality: 768 }`(文件把最外層的 `outputDimensionality` 標為
  > deprecated、建議改用 `embedContentConfig`)。但實際呼叫時
  > `embedContentConfig` 巢狀寫法會噴錯,改回最外層的 `outputDimensionality`
  > 才真的能動——這裡以實際測試結果為準,不採用文件建議的寫法。
- Response:`{ "embedding": { "values": [ ... 768 個浮點數 ... ] } }`,取
  `body.embedding.values` 寫回 `articles.embedding`。
- 非 2xx 回應一律 throw,不吞掉錯誤。

## Testing Decisions

好測試只驗證外部行為(送出去的請求長什麼樣、函式回傳/丟出什麼),不綁定內部實作
細節(例如不去斷言某個私有輔助函式有沒有被呼叫)。由於是全新專案,沒有既有測試可
參考;建議用 `clasp` 把 `.gs` 當一般 JS 模組,搭配 Node + Jest 在 Apps Script 執行環境
之外跑測試,並注入假的 `httpFetch_`(不需要 stub 全域的 `UrlFetchApp`/
`PropertiesService`,因為所有網路呼叫都已經收斂在這一個接縫)。

**要測的模組**:`SupabaseClient.gs`(請求組裝與錯誤處理)、`Articles.gs`(CRUD
orchestration、tag 同步、embedding 觸發判斷)、`Embeddings.gs`(送給 Gemini 的
payload 形狀、回應解析)。

**關鍵測試情境**
1. `createArticle` 送出的 insert payload 帶 `status: 'draft'`,且過程中沒有呼叫
   embedding。
2. `setArticleStatus(id, 'published')` 恰好觸發一次 embedding 呼叫,並把回傳的向量
   透過 PATCH 寫回 `articles.embedding`。
3. `setArticleStatus(id, '不合法的值')` 在發出任何網路請求之前就 throw。
4. `updateArticle` 對一篇已發布文章改 `content_md`:觸發 embedding 重新產生;同一篇
   文章只改 `category_id`:不觸發。
5. `syncArticleTags_` 遇到已存在的標籤名稱時重用既有 `tag_id`,不會新建重複標籤。
6. `supabaseRequest` 面對模擬的 4xx 回應會 throw,錯誤訊息包含狀態碼與回應內容。
7. `getArticle` 對空陣列回應(查無此文章)丟出清楚的「not found」錯誤,而不是回傳
   `undefined` 或整個崩潰。
8. `listArticles` 組出的 query string 正確帶入 `status`/`category_id` 篩選、
   `order=updated_at.desc`,以及 `limit`/`offset`。

## Out of Scope

- GAS 前端頁面(HTML/CSS/JS 操作介面)——另立 spec。
- 附件上傳與線上預覽(Storage bucket、簽名 URL、pdf/code/office_doc 預覽)——另立 spec。
- 分類(categories)管理 CRUD——本 spec 的文章函式接受既有 `category_id`,但不建立/
  編輯分類本身。
- 標籤管理 CRUD 超出「存檔時 find-or-create」以外的操作(改名、刪除、合併標籤)——
  不在此 spec。
- 搜尋功能(呼叫 `hybrid_search_articles` RPC、關鍵字/標籤/語意搜尋整合)——另立 spec。
- Supabase Auth / RLS / 多人權限——依先前「單人使用」決策明確排除,若未來要開放團隊
  使用需要另一份 spec。
- 文章版本歷史——依先前決策明確排除。
- 實際把 `schema.sql` 套用到一個真正的 Supabase 專案——目前使用者尚不方便進行,本
  spec 改用假的 `httpFetch_` 回應驗證邏輯,取代對真實資料庫的依賴。

## Further Notes

- **模型名稱更新**:先前 `DESIGN.md` 決策 #6 寫的是 Gemini `text-embedding-004`。
  查證目前(2026-08-15)Gemini API 官方文件後發現 `gemini-embedding-001` 已經是
  GA(正式版)模型,Google 官方建議盡快從 `text-embedding-004` 遷移過去。本 spec
  直接採用 `gemini-embedding-001`(用 `outputDimensionality: 768` 對齊既有的
  `vector(768)` 欄位,不需要改 schema)。建議之後找機會把 `DESIGN.md` 決策 #6 也同步
  更新成 `gemini-embedding-001`,避免兩份文件不一致。
- `schema.sql`(已交付)是本 spec 引用的資料表/欄位命名依據,本 spec 不修改它。
- 等真正的 Supabase 專案就緒後,除了這裡的 mock 測試,建議再手動跑一次「建立 →
  發布 → 查詢 → 刪除」一篇測試用文章的 smoke test,確認 mock 沒漏掉真實 PostgREST
  的邊界情況(例如 query string 的實際語法細節)。
- **PostgREST 保留字元跳脫的補充,後來證實查證方式有誤、已復原
  (2026-09)**：上面這條「query string 的實際語法細節」當時提醒要注意、
  但沒有具體展開的地方,`/mycr` 這輪逐行核對時一度以為查到了答案:過濾
  條件的值如果包含逗號、括號、雙引號、反斜線,PostgREST 會當成自己過濾
  語法的保留字元,不是單純 URL 編碼就能處理,當時新增了
  `postgrestQuoteValue_`,把 `eqFilter_`/`inFilter_` 的值都包上一層
  PostgREST 風格的雙引號再做 URL 編碼(README 第 57 條)。**部署到真實的
  Supabase 專案後才發現這個修法本身是錯的**——PostgREST 對 `eq.`/`in.()`
  這種過濾器並不會把值兩側額外包的雙引號當分隔符剝掉,而是整段(含引號
  字元)原封不動拿去跟欄位型別轉型比對,UUID 欄位收到帶引號的值會直接
  400,TEXT 欄位則是永遠比對不到資料、篩選結果安靜地變空。造成大範圍的
  生產環境迴歸(發布文章、標籤改名等多處操作出錯,文章列表初始畫面是空
  的),已經整個復原成單純 `encodeURIComponent` 的寫法,細節見 README
  已知問題修復紀錄第 65 條。查證時引用的 Supabase Realtime 文件範例很可能
  是 Realtime 自己的 broadcast filter DSL,跟 PostgREST REST API 本身的
  過濾語法是不同的解析器,誤把兩者當成同一套規則——這是這輪最主要的
  教訓:查官方文件不能取代真的部署到目標環境驗證,尤其是像過濾條件語法
  這種容易被相似但不同的子系統文件混淆的細節。**後續(README 第 66 條)
  用 Context7 connector 重新查證 + 請使用者在真實 Supabase 專案上對一個
  真正的 UUID 主鍵做了一次唯讀測試之後,確認 `in.()` 這個語法本身確實會
  正確剝掉雙引號才轉型,跟 `eq.` 不一樣——`inFilter_` 已經重新加回雙引號
  跳脫,`eqFilter_` 維持不動。**「PostgREST 呼叫慣例」段落目前的正確
  結論是:`eq.` 純量過濾器不需要、也不能加額外跳脫;`in.()` 清單過濾器
  需要,且已經修好。
