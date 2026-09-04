# 01 — 建立資料夾 + 上傳時分類

**What to build:** 新增 `attachment_folders` 表,`Attachments.gs` 新增資料夾
CRUD 中「建立/瀏覽」的部分,上傳附件(檔案或 URL)時可以用打字+自動建議選擇
既有資料夾或建立新資料夾,附件會帶上 `folder_id`。這張票**不**要求漂亮的分組
顯示——附件面板至少要能看出每個附件屬於哪個資料夾(例如一個文字標籤),完整
的可收合分組顯示留給下一張票。

**Blocked by:** 無,可立即開始

**Status:** ready-for-agent

- [ ] `docs/schema.sql` 新增段落(既有部署只能貼增量,不整份重跑):
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
- [ ] `Attachments.gs` 新增 `listFolders(articleId)`:
      `supabaseSelect('attachment_folders', 'article_id=eq.' + articleId +
      '&order=name.asc')`。讀取類,不進 `Auth.gs` 白名單。
- [ ] `Attachments.gs` 新增 `createFolder(articleId, name)`:
      `supabaseInsert('attachment_folders', [{ article_id: articleId, name:
      name }])`,回傳新建列。不預先查重,交由 `unique(article_id, name)`
      約束擋下重複名稱(呼叫端接住 Supabase 回傳的錯誤)。
- [ ] `uploadAttachmentFile(articleId, fileName, base64Data, mimeType,
      folderId)`:新增第五個可選參數(尾端新增,向下相容),插入的 row 多帶
      `folder_id: folderId || null`。
- [ ] `addAttachmentUrl(articleId, url, label, folderId)`:新增第四個可選
      參數,插入時多帶 `folder_id: folderId || null`。
- [ ] `listAttachments(articleId)`:`select` 改成明確帶
      `select=*,attachment_folders(id,name)`,回傳資料含每個附件所屬的
      資料夾名稱。
- [ ] `Auth.gs` 白名單新增 `createFolder`(`listFolders` 是讀取類,不進
      白名單)。
- [ ] 上傳附件的表單新增資料夾輸入欄位,互動模式複製既有
      `editor-tag-input`(這批票之前)的「打字 + 自動建議 + Enter 新增」
      邏輯——差別是建議清單來源是 `listFolders(articleId)`(只列這篇文章
      底下的資料夾),且是單選(一個附件只能有一個資料夾)不是多選 chips。
- [ ] 用假的 `httpFetch_` 寫測試(擴充 `test/Attachments.test.js`):
      1. `listFolders`/`createFolder` 送出正確的 GET/POST 請求跟回傳值。
      2. `uploadAttachmentFile`/`addAttachmentUrl` 帶 `folderId` 時插入的
         row 含正確 `folder_id`;不帶時 `folder_id` 為 `null`,且**既有
         呼叫方式(不帶新參數)仍要跟現有測試一樣通過**。
      3. `listAttachments` 送出的 query string 含
         `select=*,attachment_folders(id,name)`。
      4. `Auth.gs`:`createFolder` 能透過 `callProtected` 正確轉呼叫;
         `listFolders` 呼叫 `callProtected` 時丟出「不支援的操作」。
- [ ] 手動驗收:上傳附件時用資料夾輸入框新增一個資料夾、把附件分進去,附件
      面板上看得出這個附件屬於哪個資料夾。
