---
title: 分類換父層級
status: ready-for-agent
date: 2026-08-29
project: GAS + Supabase 個人/團隊知識庫
depends_on: spec_categories_tags.md(已完成,本 spec 是它當初 Out of Scope 留下的缺口)、DESIGN.md(決策 #4)
---

# 分類換父層級 — Spec

## Problem Statement

`spec_categories_tags.md` 當初把「分類重新指定父分類」明確列為 Out of Scope。
現況是分類建立後,`updateCategory(categoryId, name)` 只能改名字,沒有任何路徑
可以把一個既有的頂層分類改成某個分類的子分類,或反過來把子分類獨立成頂層——
一旦一開始分類分錯層級,唯一的補救方法是刪掉重建(並且遺失所有已經指向這個
分類的文章關聯,因為 `articles.category_id` 只存單一分類 id)。

## Solution

新增一個獨立的 `moveCategory(categoryId, newParentId)` 函式,只負責變更
`parent_id`,不動名稱(改名已經有 `updateCategory` 負責)。維持既有的 2 層限制
(`DESIGN.md` 決策 #4),超過限制的移動直接擋掉並回傳清楚的錯誤。分類管理頁的
既有樹狀畫面(`renderCategoryTree`/`buildCategoryNode`)擴充操作按鈕來觸發這個
新函式。

## User Stories

1. As a knowledge-base user, I want to move a top-level category to become a child of
   another top-level category, so I can fix an organization mistake without deleting
   and recreating the category (and losing its article associations).
2. As a knowledge-base user, I want to move a child category back to top-level, so I
   can undo a mistaken nesting or reorganize my category tree as it grows.
3. As a knowledge-base user, I want moving a category that already has children to be
   rejected with a clear error when the move would create a 3rd level, so the existing
   2-level limit (`DESIGN.md` decision #4) stays enforced consistently, the same way
   `createCategory` already enforces it.
4. As a knowledge-base user, I want moving a category to become its own child (or a
   child of its own child) to be rejected, so I can't accidentally create a cycle that
   would break the tree.
5. As a knowledge-base user, I want moving a category to a `newParentId` that doesn't
   exist to fail with a clear "找不到分類" error, consistent with how the rest of the
   app reports missing records.
6. As a knowledge-base user, I want the category management page to let me trigger a
   move directly from the existing tree view, so I don't need a separate screen for
   this.
7. As a developer, I want this to be a small, single-purpose function (like
   `setArticleStatus` is separate from `updateArticle`) rather than an optional 3rd
   argument bolted onto the already-tested `updateCategory`, so the existing rename
   behavior and its tests stay untouched.

## Implementation Decisions

**新增 `moveCategory(categoryId, newParentId)`,放在 `Categories.gs`。**
`newParentId` 可以是 `null`(代表移到頂層)。

驗證順序(沿用 `findCategoryOrThrow_` 既有的查無報錯模式):

1. `findCategoryOrThrow_(categoryId)` 找出要移動的分類,查無時丟出既有格式的
   「找不到分類: {id}」。
2. 若 `newParentId` 是 `null`(移到頂層),直接 `supabaseUpdate('categories',
   'id=eq.' + categoryId, { parent_id: null })`,不需要其他檢查(頂層本身不會
   超過層級限制,也不可能形成循環)。
3. 若 `newParentId` 有值:
   a. `categoryId === newParentId` 時直接丟出「不能把分類移動到自己底下」,不
      查資料庫。
   b. `findCategoryOrThrow_(newParentId)` 找出目標父分類,查無時丟出既有格式的
      「找不到分類: {id}」。
   c. 若目標父分類自己的 `parent_id` 不是 `null`(代表它自己已經是子分類),
      丟出「分類最多只能有 2 層」——沿用 `createCategory` 現有的錯誤文字,讓
      使用者看到一致的訊息。
   d. 若 `categoryId` 本身目前有子分類(需要一次 `supabaseSelect('categories',
      'parent_id=eq.' + categoryId)` 查詢),丟出「這個分類底下還有子分類,無法
      移動到別的分類底下」——移動一個已經有子分類的分類會直接產生 3 層,對應
      User Story 3。
   e. 通過以上檢查才執行 `supabaseUpdate('categories', 'id=eq.' + categoryId,
      { parent_id: newParentId })`。

**不處理的循環情境**:因為 2 層限制已經排除了「移動有子分類的分類」跟「移到
已經是子分類的分類底下」這兩種情境,理論上不可能出現更深的循環(例如
A→B→A),不需要额外寫遞迴偵測——2 層的樹狀結構本身就讓循環偵測簡化成上面
c、d 兩條規則的組合。

**回傳值**:比照 `updateCategory`,回傳更新後的分類列(`supabaseUpdate` 的
回傳值取第一筆)。

**`Auth.gs` 白名單**:新增一筆 `case 'moveCategory': return
moveCategory.apply(null, args);`,共用同一組 `getWritePassword_`/密碼比對邏輯,
是寫入類操作(改變資料),跟 `updateCategory`/`deleteCategory` 同一層級的防護。

**前端(分類管理頁)**:`buildCategoryNode` 的 `renderViewRow` 新增一個「移動」
按鈕(頂層與子分類節點都顯示,對應 User Story 1、2 都要能做)。點擊後展開一個
下拉選單,選項是「設為頂層分類」+ 所有「目前 `parent_id` 為 null 且不是自己」
的頂層分類(避免選到會直接違反 2 層限制的選項,介面上先過濾掉一部分,但後端
仍然完整做上面 3a-3d 的驗證,不能只靠前端過濾)。選定後呼叫
`runProtected('moveCategory', [category.id, 選的值或 null], ...)`,成功後
`loadCategoryTree()` 重新載入整棵樹(移動後父子關係整個變了,直接重抓比在前端
手動搬運 DOM 節點簡單可靠)。

## Testing Decisions

延續既有模式:透過假的 `httpFetch_` 驗證行為,`test/Categories.test.js` 的既有
`createCategory` 2 層限制測試是最直接的 prior art。

**要測的模組**:`Categories.gs`(新增 `moveCategory`)、`Auth.gs`(白名單新增
一筆)。

**關鍵測試情境**
1. `moveCategory(id, null)` 直接送出 `parent_id: null` 的 PATCH,不做額外查詢。
2. `categoryId === newParentId` 時直接 throw,不發出任何網路呼叫。
3. `newParentId` 查無資料時,throw「找不到分類」,不繼續做子分類檢查。
4. `newParentId` 指向一個本身已經是子分類的分類時,throw「分類最多只能有
   2 層」,不呼叫子分類查詢或 PATCH。
5. `categoryId` 本身目前有子分類時(查詢回傳非空陣列),throw「這個分類底下
   還有子分類」,不呼叫 PATCH。
6. 正常情境(移動一個沒有子分類的分類,到一個頂層目標分類底下)成功送出
   PATCH,回傳更新後的列。
7. `Auth.gs`:`callProtected(正確密碼, 'moveCategory', [id, newParentId])` 正確
   轉呼叫;密碼錯誤時跟其他既有白名單函式一樣丟出「密碼錯誤」,不執行
   `moveCategory`。

## Out of Scope

- 超過 2 層的巢狀分類——維持 `DESIGN.md` 決策 #4 的既有限制,這次不重新開放
  討論層級數。
- 批次移動多個分類——一次移動一個。
- 移動時順便處理「原本掛在這個分類下的文章」——`articles.category_id` 完全
  不受影響,移動分類只改變分類彼此的樹狀關係,不影響文章的分類指向。

## Further Notes

- `moveCategory` 拆成獨立函式而不是擴充 `updateCategory`,是刻意延續專案已有的
  `setArticleStatus`(獨立於 `updateArticle`)這個先例——單一職責的小函式,
  比在一個已經有測試覆蓋的函式上加 optional 參數更不容易破壞既有行為。

- **Implementation Decisions 第 2 點「移到頂層不需要其他檢查」的更正
  (2026-09)**：這句話原本的理由(「頂層本身不會超過層級限制,也不可能
  形成循環」)只回答了「為什麼不用做 2 層限制/循環偵測那兩項檢查」,沒有
  回答「要不要驗證 `categoryId` 本身存在」這件事——這兩者是不同的問題,
  spec 當初把它們混在一起用同一句「不需要其他檢查」帶過,是規劃階段的
  疏漏,不是刻意權衡過的決定。`/mycr` 這輪逐行核對程式碼跟這份 spec 時
  發現:照 spec 原文實作的結果是,`categoryId` 不存在時,`supabaseUpdate`
  對 PostgREST 送出的 PATCH 會 match 到 0 筆,回傳空陣列,函式最後
  `return updated[0]` 就是 `undefined`——不是清楚的錯誤,呼叫端(包含
  `callProtected` 的呼叫者)拿到的是一個沒有意義的空結果。這跟本 spec
  User Story 5(`newParentId` 找不到時要回傳清楚的「找不到分類」錯誤)其實
  是同一個精神,只是 User Story 5 只寫到 `newParentId` 那一側,沒有對稱地
  涵蓋「移到頂層」分支的 `categoryId` 本身。已經修正:這個分支開頭補上
  `findCategoryOrThrow_(categoryId)`,不存在時一樣拋出「找不到分類: {id}」,
  跟「移到某個父分類底下」那個分支的第一步驗證對齊。2 層限制/循環偵測那兩項
  檢查維持原判斷,確實不需要,這部分的原始推理沒有錯。細節與測試見 README
  已知問題修復紀錄第 59 條。
