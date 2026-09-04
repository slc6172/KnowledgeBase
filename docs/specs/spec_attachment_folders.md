---
title: 附件資料夾分類管理
status: ready-for-agent
date: 2026-09-01
project: GAS + Supabase 個人/團隊知識庫
depends_on: 無(獨立於這批其他 4 份 spec)
---

# 附件資料夾分類管理 — Spec

## Problem Statement

`attachments` 目前只有「型態」(`code`/`photo`/`zip`/`md_file`/`office_doc`/`pdf`/`odf_doc`/`url`)
這一種自動判斷的分類軸,沒有使用者自訂的分組方式。一篇文章附件數量一多(例如同時有設計稿、
API 文件、測試資料各好幾個),`ArticleDetailView.html` 的附件面板就是一長串平鋪列表,型態徽章
只能告訴你「這是什麼檔案」,沒辦法回答「這個檔案是做什麼用的」,瀏覽起來不方便。

## Solution

新增一張跟文章一對多、跟附件一對多的 `attachment_folders` 表——資料夾是使用者自訂的分組,
跟型態分類正交、疊加使用。附件面板依資料夾分組成可收合區塊顯示,建立資料夾的方式比照標籤
既有的「打字 + 自動建議 + 直接新增」互動(上傳附件時順手選/建),不另開一個獨立的管理頁面;
改名/刪除資料夾則直接在附件面板裡,資料夾標題旁一個小選單處理——因為資料夾範圍就是單一篇
文章底下,不像標籤是全站共用,沒有另開管理頁的必要。

## User Stories

1. As a knowledge-base user, I want to group an article's attachments into folders I name
   myself, so I can browse a large attachment list by purpose instead of one flat list.
2. As a knowledge-base user, I want to pick or create a folder while uploading an attachment,
   so I don't need a separate step or screen just to organize as I go.
3. As a knowledge-base user, I want folder names to autocomplete from folders I've already
   created on this article, so I don't accidentally create near-duplicate folders by
   retyping a slightly different name.
4. As a knowledge-base user, I want an attachment to be left in a general "未分類" area if I
   don't pick a folder, so folder organization stays optional and never blocks uploading.
5. As a knowledge-base user, I want to rename a folder, so I can fix a typo or clarify its
   purpose without having to recreate it and re-move every attachment inside it.
6. As a knowledge-base user, I want to delete a folder without losing the attachments inside
   it, so a mis-created or no-longer-useful grouping doesn't cost me any files — the
   attachments just fall back to 未分類.
7. As a knowledge-base user, I want the attachment panel to show folders as collapsible
   sections alongside the existing type badges, so I still see what kind of file each
   attachment is, just now also grouped by purpose.
8. As a developer, I want folder names to be unique per article (not globally), so the same
   folder name (e.g. "設計稿") can exist independently on different articles without
   colliding.

## Implementation Decisions

**Schema(`docs/schema.sql`,新增段落,既有部署只能貼增量,不能整份重跑)**

```sql
create table attachment_folders (
  id         uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (article_id, name)
);

create index on attachment_folders (article_id);

alter table attachments
  add column folder_id uuid references attachment_folders(id) on delete set null;
```

`on delete set null`(而不是 `cascade`)直接對應 User Story 6——刪除資料夾時,DB 層自動把裡面
附件的 `folder_id` 清成 `null`,附件本身不受影響,GAS 端不需要另外手動清關聯。

**`Attachments.gs` 新增四個函式**(比照 `Tags.gs`/`Categories.gs` 的命名風格):

- **`listFolders(articleId)`**:`supabaseSelect('attachment_folders', 'article_id=eq.' + articleId + '&order=name.asc')`。讀取類,不進白名單。
- **`createFolder(articleId, name)`**:`supabaseInsert('attachment_folders', [{ article_id: articleId, name: name }])`,回傳新建的列。不預先查重——`unique(article_id, name)` 約束會自然擋下重複名稱,讓 Supabase 回傳的唯一鍵衝突錯誤往外傳,跟 `spec_tag_management.md` 裡 `renameTag` 對唯一鍵的態度一致(不主動預查,交給資料庫約束)。
- **`renameFolder(folderId, newName)`**:`supabaseUpdate('attachment_folders', 'id=eq.' + folderId, { name: newName })`,回傳更新後的列。
- **`deleteFolder(folderId)`**:`supabaseDelete('attachment_folders', 'id=eq.' + folderId)`,回傳 `{ deleted: true, id: folderId }`——不用手動處理裡面的附件,依賴上面 schema 的 `on delete set null`。

**既有函式的修改**:

- **`uploadAttachmentFile(articleId, fileName, base64Data, mimeType, folderId)`**:新增第五個可選參數(尾端新增,向下相容),插入 `attachments` 的 row 多帶 `folder_id: folderId || null`。
- **`addAttachmentUrl(articleId, url, label, folderId)`**:同樣新增第四個可選參數,插入時多帶 `folder_id: folderId || null`。
- **`listAttachments(articleId)`**:`select` 從隱含的 `*` 改成明確帶 embed:`'select=*,attachment_folders(id,name)&article_id=eq.' + articleId + '&order=created_at.asc'`,前端才能一次拿到每個附件所屬的資料夾名稱,不用額外查詢。

**`Auth.gs` 白名單**新增三筆:`createFolder`、`renameFolder`、`deleteFolder`(`listFolders` 是讀取類,不進白名單)——白名單從現有 17 筆變成 20 筆。

**前端(`JavaScript.html` / `ArticleDetailView.html` / `ArticleEditorView.html`)**:

- 上傳附件的表單(在 `ArticleDetailView.html` 或 `ArticleEditorView.html` 裡,實際位置沿用現有上傳表單所在處)新增一個資料夾輸入欄位,互動模式**直接複製既有 `editor-tag-input` 的「打字 + 自動建議 + Enter 新增」邏輯**——差別只在建議清單來源是 `listFolders(articleId)`(只列這篇文章底下的資料夾)而不是全站標籤,而且是單選(一個附件只能有一個資料夾)不是多選 chips。
- 附件面板(`mountAttachmentPanel`)渲染時,先用 `attachment_folders(id,name)` 的 embed 資料把附件分組(沒有 `folder_id` 的歸到「未分類」,永遠排最後或最前面,建議放最後——已分類的內容通常是使用者比較想優先看到的),每組是一個可收合區塊(`<details>`/`<summary>` 或既有慣用的展開元件,沿用專案裡類似摺疊 UI 的既有寫法),區塊標題列附一個小選單(「改名」「刪除資料夾」),互動模式比照 `TagManagerView` 的 view row 小動作按鈕。
- 「未分類」這個分組**不是**一個真正的資料夾(沒有對應的 `attachment_folders` 列),不能對它按「改名」或「刪除」,前端渲染時要排除它的操作選單。

## Testing Decisions

延續既有模式,測試擴充 `test/Attachments.test.js`,透過假的 `httpFetch_` 驗證行為,`test/Tags.test.js`
的 `renameTag`/`deleteTag` 測試型態是最直接的 prior art。

**要測的模組**:`Attachments.gs`(新增四個函式 + `uploadAttachmentFile`/`addAttachmentUrl`/`listAttachments` 的參數修改)、`Auth.gs`(白名單新增三筆)。

**關鍵測試情境**

1. `listFolders`/`createFolder`/`renameFolder`/`deleteFolder` 分別送出正確的 GET/POST/PATCH/DELETE 請求(URL、method、payload),回傳值格式對齊既有 `listTags`/`renameTag`/`deleteTag` 的測試斷言風格。
2. `uploadAttachmentFile`/`addAttachmentUrl` 在有帶 `folderId` 時,插入的 row 帶正確的 `folder_id`;沒帶時 `folder_id` 是 `null`,且**既有呼叫方式(不帶第五/第四個參數)仍要跟現有測試一樣通過**——驗證向下相容,不因為這次改動讓舊測試斷掉。
3. `listAttachments` 送出的 query string 含 `select=*,attachment_folders(id,name)`。
4. `Auth.gs`:三個新函式都能透過 `callProtected` 正確轉呼叫;白名單以外的函式名稱(例如故意傳 `listFolders`,因為它是讀取類、不該在白名單裡)呼叫 `callProtected` 時要丟出「不支援的操作」。

**前端**沒有自動化測試(既有慣例),`node --check` 驗證語法,手動驗收清單至少涵蓋:上傳附件時
用資料夾輸入框新增一個資料夾、把附件分進去、改名一個資料夾、刪除一個資料夾後確認裡面的附件
還在且變回未分類。

## Out of Scope

- 資料夾巢狀階層(像分類的父子關係)——這次維持扁平,一篇文章底下的資料夾就是一份平面清單。
- 一個附件同時屬於多個資料夾——維持嚴格一對一(`folder_id` 是單一外鍵,不是關聯表)。
- 跨文章共用/獨立於文章之外的附件庫——`attachments.article_id not null` 這個既有前提這次不動,資料夾一樣是綁在單一篇文章底下的分組,不是把附件變成獨立資源。
- 資料夾排序、顏色、圖示等中繼資料——目前只有 `name`,顯示順序固定用名稱字母排序(`order=name.asc`)。
- 既有附件的分類遷移——`folder_id` 允許 `null`,不寫遷移腳本,舊附件維持未分類狀態即可。

## Further Notes

「未分類」不是資料庫裡的一筆真實資料(沒有對應的 `attachment_folders` 列,只是前端把
`folder_id === null` 的附件歸在一起顯示的一個虛擬分組),這個設計選擇的好處是不用在資料庫裡
預先塞一筆「系統保留」的資料夾、也不用擔心使用者把它改名或誤刪——它只是渲染邏輯的一個分支,
不佔任何真實的 `attachment_folders` 列。
