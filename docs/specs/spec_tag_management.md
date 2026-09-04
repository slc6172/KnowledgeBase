---
title: 標籤管理補完(改名/刪除/合併)
status: ready-for-agent
date: 2026-08-29
project: GAS + Supabase 個人/團隊知識庫
depends_on: spec_categories_tags.md(已完成,本 spec 是它當初 Out of Scope 留下的缺口)
---

# 標籤管理補完(改名/刪除/合併) — Spec

## Problem Statement

`spec_categories_tags.md` 當初把「標籤改名/刪除/合併」明確列為 Out of Scope,
`Tags.gs` 目前只有 `listTags()`,標籤的建立只能透過 `Articles.gs` 的
`findOrCreateTag_`(存文章時自動建立,不是使用者主動操作的入口)。用久了標籤
會越積越亂——打錯字的標籤(例如「前端」跟「前瑞」)永遠留著,同義的標籤
(例如「JS」跟「JavaScript」)也沒有辦法合併成一個,`listTags()`/標籤自動建議
的結果會越來越雜。

## Solution

新增 `renameTag`、`deleteTag`、`mergeTags` 三個寫入類函式,以及對應的
`TagManagerView.html` 管理畫面,UI 互動模式直接沿用既有的
`CategoryManagerView.html`/`buildCategoryNode`(view row / edit row 切換)寫法,
不重新設計一套新的互動邏輯。

## User Stories

1. As a knowledge-base user, I want to rename a tag, so I can fix a typo without
   losing the tag's associations with existing articles.
2. As a knowledge-base user, I want to delete a tag that I no longer need, so my tag
   list stays useful over time.
3. As a knowledge-base user, I want to see how many articles currently use a tag
   before I delete it, so I don't accidentally remove a tag that's actually still in
   active use.
4. As a knowledge-base user, I want to merge tag A into tag B, so articles tagged with
   either end up tagged with just B, and A disappears — useful for consolidating
   near-duplicate tags (e.g. "JS" and "JavaScript").
5. As a knowledge-base user, I want a merge to not fail or create duplicate rows when
   an article already has both A and B, so the merge always succeeds cleanly
   regardless of overlap between the two tags' article sets.
6. As a knowledge-base user, I want the tag manager to look and behave like the
   existing category manager (list, rename inline, delete with a confirmation), so the
   interface feels consistent instead of introducing a new pattern to learn.
7. As a developer, I want renaming a tag to not trigger any embedding regeneration
   (unlike changing an article's title/content), so this stays a cheap, Gemini-free
   operation — consistent with how `syncArticleTags_` already doesn't affect
   `updateArticle`'s embedding-regeneration check.

## Implementation Decisions

**`Tags.gs` 新增三個函式**(`listTags` 維持不變):

**`renameTag(tagId, newName)`**
- `supabaseUpdate('tags', 'id=eq.' + tagId, { name: newName })`,回傳更新後的列。
- 不查/不驗證是否已存在同名標籤——`tags.name` 若有 unique constraint(需要在
  `schema.sql` 確認;若目前沒有,這次不额外加,交由呼叫端接住 Supabase 回傳的
  唯一鍵衝突錯誤,行為與 `createCategory` 對重複名稱的態度一致:不主動預先查重,
  讓資料庫的約束(若有)自然擋下)。

**`deleteTag(tagId)`**
- 直接 `supabaseDelete('tags', 'id=eq.' + tagId)`——`article_tags` 表對
  `tag_id` 的外鍵(`schema.sql`)沿用既有的 `on delete` 設定自動清掉關聯列
  (比照 `deleteCategory` 依賴 FK cascade 的既有模式,不在 GAS 端手動清
  `article_tags`)。
- 回傳 `{ deleted: true, id: tagId }`,格式對齊 `deleteCategory`/`deleteArticle`。

**`countTagUsage(tagId)`**(新增,支援 User Story 3 的前端刪除前確認)
- `supabaseSelect('article_tags', 'tag_id=eq.' + tagId + '&select=article_id')`,
  回傳 `{ count: rows.length }`。
- 這是讀取類函式,不經過 `Auth.gs`(跟 `listTags` 同一類),前端在彈出刪除確認
  之前呼叫。

**`mergeTags(sourceTagId, targetTagId)`**
1. `sourceTagId === targetTagId` 時直接 throw「來源與目標標籤不能相同」,不做
   任何查詢。
2. 查出 `sourceTagId` 目前關聯的所有 `article_id`
   (`supabaseSelect('article_tags', 'tag_id=eq.' + sourceTagId)`)。
3. 查出 `targetTagId` 目前關聯的所有 `article_id`
   (`supabaseSelect('article_tags', 'tag_id=eq.' + targetTagId)`),組成一個
   `Set`/查找表。
4. 對來源的每個 `article_id`:若已經在目標的關聯集合裡(該文章同時有 A、B),
   略過;否則用 `supabaseUpdate('article_tags', 'article_id=eq.' + articleId +
   '&tag_id=eq.' + sourceTagId, { tag_id: targetTagId })` 把這筆關聯的
   `tag_id` 改成目標標籤——用 `UPDATE` 而不是「先刪再插」,一次 API 呼叫處理
   一篇文章,不需要额外的 insert/delete 配對。
5. 已經在步驟 4 略過的重複項(文章同時有 A、B 的情況),額外呼叫
   `supabaseDelete('article_tags', 'article_id=eq.' + articleId + '&tag_id=eq.'
   + sourceTagId)` 清掉多餘的來源關聯列,避免合併後這篇文章的 A 關聯變成孤兒
   (不會再被任何地方引用,但列還留著)。
6. 全部處理完後 `supabaseDelete('tags', 'id=eq.' + sourceTagId)` 刪除來源標籤。
7. 回傳目標標籤的最新列(`supabaseSelect('tags', 'id=eq.' + targetTagId)` 取
   第一筆)。

不依賴 PostgREST 的 upsert/`Prefer: resolution=ignore-duplicates` 語意——這個
專案的 `supabaseInsert`/`supabaseUpdate` 目前完全沒用過這個機制,行為沒有把握;
上面在應用層先查詢、依 `Set` 過濾的寫法雖然多幾次 API 呼叫,但邏輯清楚、跟
現有 `Search.gs`/`RelatedArticles.gs` 的「查詢→應用層處理→寫入」風格一致,也
好寫測試(假的 `httpFetch_` 依序回傳查詢結果、逐一斷言後續呼叫)。

**`Auth.gs` 白名單**新增三筆:`renameTag`、`deleteTag`、`mergeTags`
(`countTagUsage` 是讀取類,不進白名單)。

**前端**:新增 `TagManagerView.html`,結構比照 `CategoryManagerView.html`(一個
`#tag-manager-list` 容器,不需要「新增頂層」那種輸入框,因為標籤沒有樹狀結構、
也沒有獨立的「新增標籤」入口——標籤只透過文章編輯頁的 `findOrCreateTag_`
建立)。每個標籤列複製 `buildCategoryNode` 的 view row / edit row 切換模式:
- View row:標籤名稱、「改名」按鈕(展開跟 `renderEditRow` 同構的輸入框 +
  儲存/取消)、「合併至…」按鈕(展開一個標籤下拉選單,選擇目標標籤後呼叫
  `runProtected('mergeTags', [這個標籤.id, 選的目標.id], ...)`)、「刪除」按鈕。
- 「刪除」按鈕點擊後先呼叫 `countTagUsage(tagId)`,用回傳的數量組出
  `window.confirm('這個標籤目前用在 ' + count + ' 篇文章,確定要刪除嗎?')`
  再送出 `runProtected('deleteTag', ...)`——沒有用到(`count === 0`)時直接
  用比較輕的文字「確定要刪除這個標籤嗎?」,不用刻意強調數字 0。
- 需要一個進入這個畫面的入口按鈕,比照 `#btn-category-manager` 的既有模式,
  放在同一排導覽按鈕旁邊。

## Testing Decisions

延續既有模式:透過假的 `httpFetch_` 驗證行為,`test/Categories.test.js`(改名/
刪除的既有測試)、`test/Search.test.js`/未來的 `RelatedArticles.test.js`(多次
依序查詢的假 `httpFetch_` 用法)都是 prior art。

**要測的模組**:`Tags.gs`(新增四個函式)、`Auth.gs`(白名單新增三筆)。

**關鍵測試情境**
1. `renameTag`/`deleteTag` 送出正確的 PATCH/DELETE 請求,回傳格式對齊既有
   `updateCategory`/`deleteCategory`。
2. `countTagUsage` 組出正確的 query string,回傳 `{ count: N }`。
3. `mergeTags(a, a)` 直接 throw,不發出任何網路呼叫。
4. `mergeTags`:文章只在來源標籤(不在目標)時,對應的 `article_tags` 列被
   UPDATE 成目標標籤的 `tag_id`,不是先刪再插。
5. `mergeTags`:文章同時有來源與目標標籤時,該文章的來源關聯列被直接刪除
   (不是 UPDATE),避免違反 `(article_id, tag_id)` unique constraint。
6. `mergeTags` 最後刪除來源標籤本身,且回傳的是目標標籤的最新資料。
7. `Auth.gs`:三個新函式都能透過 `callProtected` 正確轉呼叫,密碼錯誤時統一
   丟出「密碼錯誤」、不執行任何一個。

**前端**沒有自動化測試(既有慣例),`node --check` 驗證語法,明確告知使用者
需要手動驗收,重點驗收「合併有重疊標籤的兩篇不同文章」這個情境(User
Story 5)。

## Out of Scope

- 標籤的樹狀/階層結構——標籤維持扁平,這次不比照分類做父子關係。
- 合併兩個以上標籤的「多選合併」——一次只能合併一組(來源 + 目標)。
- 標籤改名/合併時通知(例如顯示「已經有 N 篇文章受影響」的合併前預覽)——這次
  只在刪除前顯示影響文章數(User Story 3),合併前不做額外預覽。
- 標籤本身的排序/顏色/分類等中繼資料——維持現有 `tags` 表的欄位範圍。

## Further Notes

- `mergeTags` 步驟 4、5 拆成「UPDATE 大多數、DELETE 少數重疊」而不是「全部
  DELETE 再重新 INSERT」,是為了避免在還沒確認每筆處理都成功前就已經刪光原始
  關聯——雖然這個專案的寫入操作目前都沒有交易(transaction)機制,萬一中途失敗,
  UPDATE-based 的作法留下的中間狀態比較容易人工排查(還看得出哪些列已經轉移、
  哪些還沒),比「先整批刪除再整批插入」失敗時原始關聯就整個消失的風險小。
