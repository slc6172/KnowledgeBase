---
title: 圖片附件預覽載入體驗(輕量範圍,非真縮圖)
status: ready-for-agent
date: 2026-08-29
project: GAS + Supabase 個人/團隊知識庫
depends_on: spec_attachment_upload.md(已完成)、spec_attachment_preview.md(已完成)、DESIGN.md(決策 #7、#9)
---

# 圖片附件預覽載入體驗(輕量範圍,非真縮圖) — Spec

## Problem Statement

`photo` 型附件目前上傳時原封不動存進 Storage(`uploadAttachmentFile` 沒有任何
resize 步驟),預覽時(`loadSignedPreview`)直接把簽名 URL 塞進 `<img>`,靠 CSS
(`.attachment-preview__image`)把畫面縮小顯示——瀏覽器實際下載跟解碼的還是
原始解析度的完整檔案,手機相機拍的照片動輒幾 MB、幾千 x 幾千像素,點「預覽」
之後要等一段時間才會出現,而且**目前這段等待時間畫面上完全沒有任何提示**:
`loadSignedPreview` 拿到簽名 URL 之後就立刻清空「載入中…」的提示文字並把
`<img>` 塞進 DOM,但圖片本身還在下載,使用者看到的是一個空白的預覽框,不知道
是在載入還是壞掉了。

真正產生一份縮小過的實體檔案(減少下載的位元組數)需要影像縮放能力——
Apps Script 沒有內建的影像縮放 API,Supabase 目前是 Free Plan(`DESIGN.md`
決策 #7),Storage 的 Image Transformation 是付費功能,兩條「伺服器端縮圖」的
路都不現成。前端瀏覽器上傳前用 canvas 縮小是可行的替代方案,但會動到既有的
上傳流程(`uploadAttachmentFile`/`readFileAsBase64`),範圍明顯更大。

## Solution

這次先不產生任何縮小版的實體檔案,原圖上傳/儲存完全不變。只處理「使用者點
預覽後,圖片還在下載時,畫面應該維持看得懂的載入狀態,而不是一片空白」,以及
補上 `loading="lazy"`/`decoding="async"`/顯式 `max-height` 這幾個對瀏覽器友善、
零成本的屬性。真正的縮圖(減少下載量)留待之後有實際需求(例如使用者持續反映
即使加了 loading 狀態,等待時間本身還是太久)時,另立 spec 做前端 canvas
resize-before-upload。

## User Stories

1. As a knowledge-base user, I want the preview area to keep showing a loading
   indicator while a large photo is still downloading (after I click 預覽), instead of
   going blank the instant the `<img>` element is inserted, so I know it's working and
   not broken.
2. As a knowledge-base user, I want to see a clear error state if the image fails to
   load (bad signed URL, network failure, etc.), instead of a silently blank box, so I
   know something went wrong rather than assuming it's still loading forever.
3. As a knowledge-base user, I want a very tall or very wide photo to not blow out the
   page layout while — or before — it finishes loading, so scrolling and the rest of
   the detail/editor page stay usable.
4. As a developer, I want this change scoped to the existing preview rendering code
   path only, with no changes to the upload flow or Storage contents, so this stays a
   small, low-risk frontend-only change.

## Implementation Decisions

**範圍確認(刻意收斂,呼應 Problem Statement)**:這次不做真正的縮圖檔案。原圖
上傳(`uploadAttachmentFile`)、`file_path`/`file_size` 的語意、
`getSignedAttachmentUrl` 一律連到原圖——全部維持不變,不動 `Attachments.gs`。

**修改 `loadSignedPreview`(`JavaScript.html`)裡 `att.type === 'photo'` 的
分支**:
- 目前的寫法是拿到簽名 URL 後立刻 `previewBox.innerHTML = ''` 清空「載入中…」
  文字,再把 `<img>` 塞進去——改成:先建立 `<img>` 元素並掛好
  `load`/`error` 事件監聽器,**再**清空 `previewBox` 並同時放入(a) 一個
  「圖片載入中…」的提示元素、(b) 這個 `<img>` 元素本身(用 CSS 讓
  `<img>` 在載入完成前不可見或先隱藏,例如額外一個 class,圖片
  `load` 事件觸發後移除「載入中」提示、讓 `<img>` 顯示出來)。
- `<img>` 的 `error` 事件觸發時,把提示文字換成明確的錯誤訊息(例如「圖片載入
  失敗」),不要讓畫面永遠停在「載入中」。
- 新增 `img.loading = 'lazy'`、`img.decoding = 'async'` 這兩個屬性——雖然這個
  `<img>` 本來就是使用者點擊「預覽」之後才動態插入 DOM(已經是某種形式的延遲
  載入),這兩個屬性仍然零成本、對瀏覽器解碼/排程是正確的提示,不會有副作用,
  也讓程式碼在語意上明確表達「這是一張可能很大的圖片,請瀏覽器自行斟酌處理
  時機」。

**CSS(`Stylesheet.html`)**:`.attachment-preview__image` 補上
`max-height`(搭配既有應該已經有的 `max-width: 100%`),避免解析度極高、長寬比
極端的照片在預覽框裡把整個頁面撐得過高;新增一個對應「載入中」提示的樣式
(可以跟其他既有的 `empty-state`/loading 提示共用 class,不用另外設計一套)。

## Testing Decisions

前端(`.html`/內嵌 `<script>`)沿用既有慣例,沒有自動化測試,`node --check`
驗證語法,明確告知使用者需要手動驗收。

**手動驗收情境建議**:
1. 找一張較大的照片附件(手機拍的原尺寸照片,理想上 > 2MB),點「預覽」,確認
   在圖片實際顯示出來之前,畫面持續顯示「載入中」而不是空白。
2. 用瀏覽器開發者工具模擬離線/阻擋圖片請求,確認觸發 `error` 事件時畫面顯示
   清楚的錯誤文字,不是卡在「載入中」不動。
3. 找一張長寬比極端(例如很長的截圖)的照片,確認預覽框有 `max-height` 限制,
   不會把整個詳情/編輯頁面往下推得過遠。
4. 確認收合再重新展開預覽時(`toggleAttachmentPreview` 既有的
   `data-loaded` 記憶機制),不會重複觸發下載或重新顯示「載入中」——這個既有
   行為不應該被這次改動破壞。

## Out of Scope

- 產生任何縮小版的實體圖片檔案(不論存在 Storage 還是暫存)——本 spec 明確
  不做,見 Problem Statement 的技術限制說明。真正需要減少下載位元組數,建議
  另立 spec 做前端 canvas resize-before-upload(上傳前把圖片縮小到一個固定的
  最大邊長再上傳,原圖捨棄或另外保留,需要另外設計取捨)。
- 上傳流程(`uploadAttachmentFile`/`readFileAsBase64`)的任何修改。
- 文章列表/詳情頁的「縮圖網格」呈現(目前的附件面板是清單 + 點擊展開預覽,
  不是縮圖網格,這次不改變這個既有互動模式)。
- 其他附件型別(`pdf`/`office_doc`)的預覽載入體驗——這次只處理 `photo`。

## Further Notes

- 這個 spec 的範圍比最初「圖片縮圖」的構想小很多,是重新檢視現有
  `loadSignedPreview` 程式碼後校正過的結論:圖片本來就只在使用者點擊「預覽」
  後才被請求(已經是延遲載入),所以單純加 `loading="lazy"` 並不會實際解決
  「大圖拖慢載入」的核心抱怨;真正影響使用者感受的落差是「下載/解碼期間畫面
  空白、看起來像壞掉」,這是這次實際要修的東西。如果之後真的需要減少下載的
  位元組數(而不只是改善等待期間的觀感),需要另立 spec 做前端 canvas 縮圖。

- **手動驗收時的修正**:實作階段原本還是照 Implementation Decisions 加了
  `loading="lazy"`(認為「零成本、無副作用」),但手動驗收發現這個屬性讓圖片
  卡死在「載入中」,永遠不會顯示。原因:`loading="lazy"` 靠 IntersectionObserver
  判斷元素是否進入畫面,但這個判斷只對已經接在 DOM 上的元素有效——這次的
  `<img>` 故意留在 DOM 外面直到 `load` 事件才插入(整個設計的核心就是「先顯示
  載入中,圖片真的載完才換上去」),等於瀏覽器永遠沒有機會判斷「有沒有進入
  畫面」,`load`/`error` 都不會觸發。已經移除 `loading="lazy"`,只留
  `decoding="async"`(這個屬性只影響解碼時機,不像 `loading` 一樣依賴 DOM
  連接狀態判斷是否要發出請求,沒有同樣的風險)。這印證了上面那段本來就已經
  說的「`loading="lazy"` 對這個流程沒有實質幫助」——事後看不只是沒幫助,還是
  真的會壞。
