---
title: 附件上傳(Storage 上傳 + 附件生命週期)
status: ready-for-agent
date: 2026-08-15
project: GAS + Supabase 個人知識庫
depends_on: schema.sql, DESIGN.md, spec_gas_backend.md(Config/SupabaseClient/httpFetch_ 已完成)
---

# 附件上傳:Storage 上傳 + 附件生命週期 — Spec

## Problem Statement

知識庫的文章需要能掛上檔案型附件(程式碼、圖片、Zip、Markdown 筆記、Office 文件、
PDF、ODF 文件)或純連結型附件(URL)。目前 `attachments` 資料表已經在 `schema.sql`
定義好,但 GAS 端還沒有任何程式碼可以:(1) 把使用者上傳的檔案實際送進 Supabase
Storage 並在 `attachments` 表建立對應記錄,(2) 依文章列出附件,(3) 刪除附件時
連同 Storage 裡的實體檔案一併清掉,避免留下孤兒檔案。

本地 Supabase 文件語料庫收錄的是 JS SDK(`supabase-js`)參考,沒有 GAS 需要的
Storage 原始 HTTP 介面細節,因此另外查證了 Supabase 官方 Storage REST API
(`https://supabase.com/docs/reference/self-hosting-storage/*`),確認上傳/刪除的
端點格式如下,作為本 spec 的依據:

- 上傳:`POST {SUPABASE_URL}/storage/v1/object/{bucket}/{path}`,body 為檔案原始
  bytes,`Content-Type` 帶檔案的 MIME type。
- 刪除:`DELETE {SUPABASE_URL}/storage/v1/object/{bucket}/{path}`。

## Solution

新增兩個檔案:

1. **StorageClient.gs** — Supabase Storage REST API 的薄包裝
   (`storageUpload_`、`storageDelete_`),跟 `SupabaseClient.gs` 平行,但打的是
   `/storage/v1/` 而不是 `/rest/v1/`。**沿用 ticket 01 已經定案的 `httpFetch_`
   接縫**——Ticket 01 的 AC 明講它是專案裡唯一呼叫 `UrlFetchApp` 的地方,Storage
   的呼叫不例外。
2. **Attachments.gs** — 附件的建立(檔案 / URL 兩種路徑)、列出、刪除,以及依副
   檔名自動判斷附件 `type` 的私有函式。

檔案型附件的上傳流程:GAS 前端把檔案讀成 base64 字串,透過 `google.script.run`
送到 `uploadAttachmentFile`,由伺服器端解碼、算出 Storage 路徑、呼叫
`storageUpload_` 把 bytes 送進 Supabase Storage,成功後在 `attachments` 表插入一筆
記錄。URL 型附件不經過 Storage,直接插入一筆 `type='url'` 的記錄。

## User Stories

**Storage REST 呼叫層**
1. As a developer, I want `storageUpload_(bucket, path, bytes, mimeType)` to POST the
   raw bytes to `{SUPABASE_URL}/storage/v1/object/{bucket}/{path}` with the right
   auth headers and Content-Type, so that files land in the correct Storage location.
2. As a developer, I want `storageUpload_` to throw a descriptive error (status code +
   response body) when Supabase Storage responds with 4xx/5xx, so failures are
   diagnosable rather than silently producing an orphaned DB row.
3. As a developer, I want `storageDelete_(bucket, path)` to issue a DELETE to the same
   endpoint shape, so an attachment's underlying file can be removed independently of
   its DB row.
4. As a developer, I want both functions to go through the existing `httpFetch_` seam
   (no direct `UrlFetchApp` calls), so they stay testable the same way the rest of the
   project is and the project keeps its "one network seam" property.

**自動判斷附件類型**
5. As a knowledge-base user, I want the attachment's `type` to be inferred automatically
   from the file's extension when I upload a file, so I never have to manually pick a
   category.
6. As a knowledge-base user, I want common extensions mapped correctly: images
   (png/jpg/jpeg/gif/webp/svg) → `photo`, `zip` → `zip`, `md` → `md_file`, Office
   formats (doc/docx/xls/xlsx/ppt/pptx) → `office_doc`, `pdf` → `pdf`, ODF formats
   (odt/ods/odp) → `odf_doc`.
7. As a knowledge-base user, I want any extension not in that known list (e.g. `.py`,
   `.sql`, `.json`, or anything else) to default to `code` rather than being rejected,
   so I can still attach less-common file types without the upload failing outright.

**建立附件(檔案)**
8. As a knowledge-base user, I want `uploadAttachmentFile(articleId, fileName,
   base64Data, mimeType)` to decode the base64 payload, upload it to the `attachments`
   bucket at a path scoped under the article's id with a unique prefix, and create the
   matching `attachments` row (`type`, `file_path`, `file_name`, `file_size`), so my
   file becomes a retrievable attachment on that article.
9. As a knowledge-base user, I want the stored `file_size` to reflect the actual
   decoded byte length, so size information shown later is accurate.
10. As a knowledge-base user, I want two uploads with the same original file name on
    the same article to not collide in Storage, so a second upload never silently
    overwrites the first.

**建立附件(URL)**
11. As a knowledge-base user, I want `addAttachmentUrl(articleId, url, label)` to
    create an `attachments` row with `type='url'`, storing the URL and an optional
    display label, without touching Storage at all.
12. As a knowledge-base user, I want the label to default to the URL itself when I
    don't provide one, so the row always has something reasonable to display.

**列出與刪除附件**
13. As a knowledge-base user, I want `listAttachments(articleId)` to return all
    attachments for that article ordered by creation time, so I see them in the order
    I added them.
14. As a knowledge-base user, I want `deleteAttachment(attachmentId)` to remove the
    underlying Storage object first (when the attachment has one) and then remove the
    `attachments` row, so deleting an attachment never leaves an orphaned file behind.
15. As a knowledge-base user, I want deleting a `url`-type attachment (which has no
    Storage object) to skip the Storage call entirely and just remove the DB row.
16. As a knowledge-base user, I want a clear "not found" error when I try to delete an
    attachment ID that doesn't exist, rather than a confusing crash.

**可測試性**
17. As a developer, I want every function in this spec tested against a mocked
    `httpFetch_`, so the whole flow (detect type → upload bytes → insert row / delete
    object → delete row) is verified without a live Supabase project.
18. As a developer, I want `Utilities.base64Decode` and `Utilities.getUuid` (Apps
    Script platform globals used for decoding files and generating unique path
    segments) faked in tests the same way `PropertiesService` already is, so tests stay
    deterministic and don't depend on the real Apps Script runtime.

## Implementation Decisions

**檔案結構**
- `StorageClient.gs` — `storageUpload_(bucket, path, bytes, mimeType)`、
  `storageDelete_(bucket, path)`。
- `Attachments.gs` — `uploadAttachmentFile`、`addAttachmentUrl`、`listAttachments`、
  `deleteAttachment`,私有的 `detectAttachmentType_`。

**Storage REST 慣例**
- Base URL:`{SUPABASE_URL}/storage/v1/object/{bucket}/{path}`。
- 認證:跟 PostgREST 一樣用 service_role key(`apikey` + `Authorization: Bearer`)。
- 上傳:`method: 'post'`,`Content-Type` 用呼叫端傳入的 `mimeType`(找不到就預設
  `application/octet-stream`),body 是解碼後的原始 bytes。
- 刪除:`method: 'delete'`,不需要 body。
- 4xx/5xx 一律 throw,訊息包含狀態碼與回應內容(跟 `supabaseRequest` 的錯誤處理
  風格一致)。

**路徑與檔名**
- Storage 路徑組成:`{articleId}/{uuid}_{encodeURIComponent(fileName)}`
  (`Utilities.getUuid()` 產生 uuid,確保同檔名不會互相覆蓋,對應 DESIGN.md 決策 #9
  的路徑慣例,並加上 URL 編碼避免檔名含空白或中文字元造成路徑問題)。
- `file_size` 取解碼後 `bytes.length`(byte 數,不是 base64 字串長度)。

**附件型別自動判斷**(`detectAttachmentType_`)
- 副檔名(不分大小寫)對照表:
  - `png/jpg/jpeg/gif/webp/svg` → `photo`
  - `zip` → `zip`
  - `md` → `md_file`
  - `doc/docx/xls/xlsx/ppt/pptx` → `office_doc`
  - `pdf` → `pdf`
  - `odt/ods/odp` → `odf_doc`
- 其餘一律預設 `code`(不拋錯)。理由:`schema.sql` 對 `code` 的註解本來就是開放式的
  「.py / .js / .sql ...」,窮舉所有程式碼副檔名不切實際;對個人知識庫來說,寧可
  寬鬆歸類成 `code`(仍可下載/預覽為純文字),也不要讓上傳直接失敗。如果之後想改成
  嚴格模式(未知副檔名直接拒絕),只需要改這個函式,不影響其他部分。

**URL 型附件**
- `addAttachmentUrl` 插入的 row:`type: 'url'`, `url: url`,
  `file_name: label || url`,`file_path` 維持 `null`(符合 `schema.sql` 的
  `attachment_source_check` constraint)。

**刪除順序**
- `deleteAttachment` 先查出該筆附件(查無則丟出「找不到附件」錯誤),若
  `file_path` 不是 null 就先呼叫 `storageDelete_` 清掉 Storage 物件,成功後才刪
  `attachments` 那筆 DB 記錄。刻意先刪 Storage 再刪 DB:如果 Storage 刪除失敗就
  提早 throw,不會留下「DB 已經找不到、但 Storage 裡還有孤兒檔案」這種更難排查的
  狀態(寧可留著一筆指向已不存在檔案的 DB 記錄,之後可以再重試刪除)。

## Testing Decisions

延續 ticket 01 建立的模式:測試透過假的 `httpFetch_` 驗證行為,不直接呼叫真正的
`UrlFetchApp`/Supabase。這個 spec 額外需要假的 `Utilities.base64Decode` 和
`Utilities.getUuid`(Apps Script 平台全域函式),測試時比照 `PropertiesService`
的做法整個換成假實作,讓路徑/位元組長度可預期、好斷言。

**要測的模組**:`StorageClient.gs`(請求組裝、錯誤處理)、`Attachments.gs`
(型別判斷、上傳流程組裝、URL 附件建立、列表查詢、刪除順序)。

**關鍵測試情境**
1. `storageUpload_` 對正確的 URL 送出 POST,帶對的 headers 跟 body,4xx/5xx 時
   throw 且訊息包含狀態碼與內容。
2. `storageDelete_` 對正確的 URL 送出 DELETE,4xx/5xx 時同樣 throw。
3. `detectAttachmentType_` 對每一類已知副檔名回傳正確 type(大小寫不敏感),未知
   副檔名回傳 `code`。
4. `uploadAttachmentFile` 依序:解碼 base64 → 組出 `{articleId}/{uuid}_...` 路徑 →
   呼叫 `storageUpload_` → 插入 `attachments` 記錄(欄位含正確的 `type`、
   `file_path`、`file_name`、`file_size`)。
5. `addAttachmentUrl` 插入的記錄型別正確、`file_path` 為 null;沒給 `label` 時
   `file_name` 退回用 `url`。
6. `listAttachments` 組出的 query 正確帶 `article_id` 篩選與時間排序。
7. `deleteAttachment`:有 `file_path` 的附件會先呼叫 `storageDelete_` 再刪 DB 記錄;
   `type='url'` 的附件(`file_path` 為 null)完全不呼叫 `storageDelete_`;查無該
   附件 ID 時丟出清楚錯誤且不做任何刪除呼叫。

## Out of Scope

- 附件線上預覽(`getSignedAttachmentUrl`、`getCodeAttachmentContent`,DESIGN.md
  3.1 節已經設計過機制,但屬於另一個功能面向)——另立 spec。
- GAS 前端的檔案選取/拖拉上傳 UI——另立 spec。
- 附件的編輯(換檔案、改標籤)——目前設計只有建立與刪除,沒有「更新」;要換檔案
  的話就是刪除舊附件、上傳新附件。
- 批次刪除/批次上傳。
- 附件檔案大小上限檢查——目前規模(以文字檔為主)不需要,之後真的需要可以在
  `uploadAttachmentFile` 開頭加一個檢查,不影響其他部分設計。

## Further Notes

- Storage 端點格式是本次查證官方 `self-hosting-storage` OpenAPI 參考頁面確認的,
  跟本地語料庫收錄的 `supabase-js` SDK 參考文件是兩個不同的介面層——之後如果還需要
  查 Storage 的其他端點(如批次刪除 `DELETE /object/{bucketName}` 帶
  `{prefixes: [...]}`,或搜尋 `POST /object/list/{bucketName}`),本地語料庫查不到,
  需要另外上網查證。
- `storageUpload_`/`storageDelete_` 跟 `SupabaseClient.gs` 的 `supabaseRequest` 故意
  不合併成同一個函式——兩者的 base path(`/storage/v1/` vs `/rest/v1/`)、認證方式
  雖然目前相同但語意不同,分開比較不會日後糾纏不清;共用的只有底層的 `httpFetch_`
  接縫。
