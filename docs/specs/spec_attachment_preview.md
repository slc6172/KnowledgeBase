---
title: 附件線上預覽(簽名 URL + 純文字內容)
status: ready-for-agent
date: 2026-08-15
project: GAS + Supabase 個人知識庫
depends_on: schema.sql, DESIGN.md(3.1 節)、spec_gas_backend.md、spec_attachment_upload.md(已完成)
---

# 附件線上預覽:簽名 URL + 純文字內容 — Spec

## Problem Statement

DESIGN.md 3.1 節已經設計好各附件類型的預覽機制,但目前 GAS 端完全沒有支援預覽的
函式。本 spec 把 `pdf`/`office_doc`(簽名 URL)與 `code`/`md_file`(純文字內容)
這兩種預覽所需的後端能力補齊。`photo`(縮圖)、`odf_doc`/`zip`/`url`(無線上預覽)
不需要新的後端函式,不在本 spec 範圍。

本次額外查證了 Supabase Storage 官方 OpenAPI 參考
(`https://supabase.com/docs/reference/self-hosting-storage/introduction`),確認
簽名 URL 端點的確切格式:

- `POST {SUPABASE_URL}/storage/v1/object/sign/{bucket}/{path}`,body
  `{ "expiresIn": <seconds> }`,回應 `{ "signedURL": "/object/sign/{bucket}/{path}?token=..." }`
  ——**這是相對路徑**,要自己補上 `{SUPABASE_URL}/storage/v1` 前綴才是可用的完整
  URL。這是本次查證中最容易漏掉的細節。

## Solution

延伸既有的 `StorageClient.gs` 與 `Attachments.gs`,新增:

1. **StorageClient.gs**:`storageSignedUrl_(bucket, path, expiresInSeconds)`(呼叫
   簽名端點,組回完整可用的 URL)、`storageDownload_(bucket, path)`(GET 物件原始
   內容,以文字回傳)。跟既有的 `storageUpload_`/`storageDelete_` 一樣走
   `httpFetch_` 接縫。
2. **Attachments.gs**:`getSignedAttachmentUrl(attachmentId, expiresInSeconds)`、
   `getTextAttachmentContent(attachmentId)`,以及把既有 `deleteAttachment` 裡「查
   附件、查無則丟錯」的邏輯抽成私有的 `findAttachmentOrThrow_`,三個函式共用。

**兩個相對於 DESIGN.md 3.1 節的延伸決策**(細節見 Implementation Decisions):
- `getSignedAttachmentUrl` 不限定只給 `pdf`/`office_doc` 用——只要附件有
  `file_path`(任何檔案型附件,包含 `photo`)都能拿到簽名 URL,型別限制交給前端
  決定怎麼用這個 URL(iframe、Google Docs Viewer、`<img>`)。這樣同時補上了
  DESIGN.md 沒明講的「photo 縮圖到底怎麼拿到圖片位元組」這個缺口。
- `getCodeAttachmentContent` 概念上跟 `md_file` 的「純文字渲染」需求相同(都是
  「把檔案內容當純文字讀出來」),所以合併成一個 `getTextAttachmentContent`,
  同時支援 `code`(前端做語法高亮)與 `md_file`(前端做 Markdown 渲染)兩種型別,
  同樣套用 1MB 大小上限。

## User Stories

**Storage REST 延伸**
1. As a developer, I want `storageSignedUrl_(bucket, path, expiresInSeconds)` to POST
   to `{SUPABASE_URL}/storage/v1/object/sign/{bucket}/{path}` with `{expiresIn:
   expiresInSeconds}` and return the **full, directly usable** URL (base URL +
   `/storage/v1` + the relative `signedURL` from the response), so callers never have
   to remember to prepend anything themselves.
2. As a developer, I want `storageSignedUrl_` to throw a descriptive error (status +
   body) on a non-2xx response, consistent with the rest of `StorageClient.gs`.
3. As a developer, I want `storageDownload_(bucket, path)` to GET the object and
   return its content as text, so text-based files (code, Markdown) can be read
   server-side without a separate signed-URL round trip.
4. As a developer, I want `storageDownload_` to throw a descriptive error on a
   non-2xx response, same pattern as the other Storage functions.

**簽名 URL 預覽(pdf / office_doc / photo / 任何檔案型附件)**
5. As a knowledge-base user, I want `getSignedAttachmentUrl(attachmentId,
   expiresInSeconds)` to look up the attachment, generate a signed URL for its
   underlying file, and return it, so the front-end can embed it in an `<iframe>` (PDF),
   wrap it with Google Docs Viewer (Office docs), or use it as an `<img src>` (photos).
6. As a knowledge-base user, I want `expiresInSeconds` to default to 300 (5 minutes)
   when I don't specify one, matching DESIGN.md's recommendation.
7. As a knowledge-base user, I want a clear error when I ask for a signed URL on a
   `url`-type attachment (which has no underlying file), rather than a confusing
   failure deep in the Storage call.
8. As a knowledge-base user, I want a clear "not found" error when the attachment ID
   doesn't exist.

**純文字預覽(code / md_file)**
9. As a knowledge-base user, I want `getTextAttachmentContent(attachmentId)` to return
   the raw text content of a `code` or `md_file` attachment, so the front-end can
   render it (syntax-highlighted or as Markdown) without a separate download step.
10. As a knowledge-base user, I want a clear error when I call this on an attachment
    whose type isn't `code` or `md_file` (e.g. a `zip`), so misuse fails predictably
    instead of returning garbage.
11. As a knowledge-base user, I want a clear error instead of the actual content when
    the file is larger than 1MB, so I'm told to download it instead of the request
    hanging or the response ballooning.
12. As a knowledge-base user, I want a clear "not found" error when the attachment ID
    doesn't exist, same as the other lookup-based functions.

**內部一致性**
13. As a developer, I want a single private `findAttachmentOrThrow_(attachmentId)`
    used by `deleteAttachment`, `getSignedAttachmentUrl`, and
    `getTextAttachmentContent`, so the "look up an attachment or fail clearly" behavior
    lives in exactly one place instead of being copy-pasted three times.
14. As a developer, I want the existing `deleteAttachment` tests to keep passing after
    this refactor, so I know the extraction didn't change its behavior.

## Implementation Decisions

**檔案結構**(延伸既有檔案,不新增檔案)
- `StorageClient.gs` 新增 `storageSignedUrl_`、`storageDownload_`。
- `Attachments.gs` 新增 `getSignedAttachmentUrl`、`getTextAttachmentContent`,私有
  `findAttachmentOrThrow_`(從 `deleteAttachment` 抽出來共用)。

**簽名 URL**
- 端點:`POST {SUPABASE_URL}/storage/v1/object/sign/{bucket}/{path}`,body
  `{"expiresIn": <int>}`。
- 回應的 `signedURL` 欄位是相對路徑(如
  `/object/sign/attachments/a1/xxx.pdf?token=...`),`storageSignedUrl_` 要組成
  `{SUPABASE_URL}/storage/v1{signedURL}` 才是可以直接拿去用的完整 URL——這是這次
  查證官方文件抓出來的關鍵細節,不是猜測。
- `getSignedAttachmentUrl` 不依附件 `type` 做限制,只檢查是否有 `file_path`(即是
  否為檔案型附件);`type='url'` 的附件(`file_path` 為 null)一律丟出清楚錯誤。
- `expiresInSeconds` 未帶時預設 `300`。

**純文字內容**
- 端點:`GET {SUPABASE_URL}/storage/v1/object/{bucket}/{path}`(跟 `storageUpload_`/
  `storageDelete_` 同樣的 base path,只是換成 GET),直接回傳 body 文字。
- `getTextAttachmentContent` 只接受 `type` 為 `code` 或 `md_file` 的附件,其他型別
  丟出清楚錯誤(「此附件不支援純文字預覽」)。
- 大小上限:`attachment.file_size > 1 * 1024 * 1024`(1MB,沿用 DESIGN.md 3.1 節的
  建議值)時丟出清楚錯誤(「檔案過大,無法線上預覽,請下載」),不嘗試下載內容。

**共用的附件查詢**
- `findAttachmentOrThrow_(attachmentId)`:`supabaseSelect('attachments', 'id=eq.' +
  attachmentId)`,查無時丟出「找不到附件: {id}」(跟現有 `deleteAttachment` 的錯誤
  訊息文字一致,對外行為不變)。`deleteAttachment` 改用這個函式,现有測試不需修改
  斷言內容,只是內部實作换成呼叫共用函式。

## Testing Decisions

延續既有模式:透過假的 `httpFetch_` 驗證行為。

**要測的模組**:`StorageClient.gs`(`storageSignedUrl_`、`storageDownload_` 的請求
組裝、URL 組合、錯誤處理)、`Attachments.gs`(`getSignedAttachmentUrl`、
`getTextAttachmentContent` 的查詢/驗證/委派邏輯,以及 `findAttachmentOrThrow_`
抽出後 `deleteAttachment` 仍維持原行為)。

**關鍵測試情境**
1. `storageSignedUrl_` 送出正確的 POST(body 含 `expiresIn`),並把回應裡的相對
   `signedURL` 組成完整 URL 回傳;非 2xx 時 throw。
2. `storageDownload_` 送出正確的 GET,回傳 `getContentText()` 的內容;非 2xx 時
   throw。
3. `getSignedAttachmentUrl`:查到有 `file_path` 的附件時呼叫 `storageSignedUrl_`
   並回傳結果;查到 `file_path` 為 null(`type='url'`)時丟出清楚錯誤且不呼叫
   `storageSignedUrl_`;查無附件時丟出「找不到附件」且不做任何 Storage 呼叫;
   `expiresInSeconds` 省略時實際送出的 `expiresIn` 是 300。
4. `getTextAttachmentContent`:對 `type='code'` 或 `type='md_file'` 且
   `file_size` 在上限內的附件回傳 `storageDownload_` 的結果;對其他型別丟出清楚
   錯誤且不呼叫 `storageDownload_`;對 `file_size` 超過 1MB 的附件丟出清楚錯誤且
   不呼叫 `storageDownload_`;查無附件時丟出「找不到附件」。
5. 既有的 `deleteAttachment` 測試(not-found / 檔案型 / url 型)重跑仍然全部通過,
   確認抽出 `findAttachmentOrThrow_` 沒有改變外部行為。

## Out of Scope

- 前端的實際渲染(`<iframe>`、Google Docs Viewer 嵌入、highlight.js 語法高亮、
  Markdown 渲染套件選型)——這些是 GAS 前端頁面的工作,不在後端 spec 範圍。
- `odf_doc`/`zip` 的線上預覽——DESIGN.md 已經決定不做,維持下載連結。
- 圖片轉檔/縮圖生成(Supabase Storage 的 image transformation 功能)——目前
  `getSignedAttachmentUrl` 回傳的是原圖簽名 URL,前端直接當縮圖顯示(用 CSS
  控制顯示大小即可),沒有真的產生縮小版的檔案。
- 簽名 URL 的快取——每次呼叫都重新產生一個新的簽名 URL,沒有做任何快取或重用
  既有 token 的邏輯,對個人知識庫的呼叫量來說不需要。

## Further Notes

- 簽名 URL 端點回傳「相對路徑」而不是完整 URL,是這次查證前沒有把握的細節,
  官方 OpenAPI 參考頁面明確顯示範例回應是
  `"signedURL": "/object/sign/avatars/folder/cat.png?token=..."`,證實了這一點。
  `storageSignedUrl_` 的實作跟測試都要以此為準。
- 同一次查證也順便確認了 `GET /object/{bucketName}/{*}`(取物件)、
  `GET /object/authenticated/{bucketName}/{*}`(帶 Authorization header 取物件)
  兩種取物件方式都存在;本 spec 選用前者(跟既有的 `storageUpload_`/
  `storageDelete_` 用同一組 base path,風格一致),因為我們一律用 service_role
  key,兩種端點對我們來說沒有實質差異。
