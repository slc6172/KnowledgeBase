# Spec:Markdown 消毒設定收緊,不再放行表單/樣式/(AI 回答)遠端圖片

**Triage label**:`ready-for-agent`

**來源**:`mycr-20260921-060513.md`(全新複掃報告)Finding F-02,經 `/grilling` 對談逐項定案(2026-09-22)。

## Problem Statement

`JavaScript.html` 裡四個把 Markdown 轉成 HTML 的地方(文章內文、md 附件預覽、AI 問答回答、EasyMDE
編輯器的 preview)都是用 `DOMPurify.sanitize(marked.parse(x))`,沒有帶任何設定。預設設定擋得住會
執行程式碼的向量(`<script>`、`onerror`、`javascript:` 連結),但放行了三種會改變頁面外觀或行為的
HTML:`<form>` 加 `<input type="password">`(可以偽裝成本專案自己的「需要密碼」對話框,誘騙擁有者
或團隊成員把寫入密碼輸入到假的表單裡)、`<style>` 或 `style` 屬性(可以整頁改版面、疊一層假的覆蓋
畫面)、遠端 `<img>`(開啟就會連到第三方,對 AI 問答回答來說更是現成的資料外洩管道——`RagChat.gs`
自己的註解已經承認,文章內容「不一定可信」這件事目前只做到 prompt 層級的提醒,不是真正的沙箱隔離)。

## Solution

保留現有的黑名單式做法(`FORBID_TAGS`/`FORBID_ATTR`),但補上這三種目前放行的向量。分兩組設定:
文章內文、md 附件預覽、編輯器 preview 這三個地方渲染的是同一批「已經存進資料庫的文章內容」,威脅
模型一樣,共用一組標準設定(擋 `<form>`/`<style>`/`style` 屬性,保留圖片——這是使用者自己筆記
可能會用到的正常功能);AI 問答回答額外多擋圖片,因為讀過 `RagChat.gs` 的 prompt 之後確認,AI 被
要求「只根據參考文章內容回答」,純文字摘要,沒有任何理由需要包含圖片,擋掉它沒有功能成本,卻能關掉
一個現成的外洩管道。四個呼叫點合併成一個共用函式,不再各自重複同一行程式碼。新增真的會執行
DOMPurify/marked(版本鎖定跟 `Index.html` 現在載入的 CDN 版本一致)的測試,直接驗證這組設定的
實際行為,不只是檢查原始碼文字裡有沒有出現看起來對的設定。

## User Stories

1. 身為正在寫文章、可能會分享給別人看的擁有者,我希望不管是我自己貼進去的內容,還是從其他地方
   複製貼上、我沒辦法完全確定來源的內容,都不可能在頁面上畫出一個假的密碼輸入框,騙我或團隊成員
   把寫入密碼打進一個不是這個 app 本身介面的地方。
2. 身為擁有者,我希望正常的 Markdown 格式——標題、清單、程式碼區塊、表格、連結、粗體/斜體,以及
   我自己刻意放進筆記裡的圖片——在文章內文、md 附件預覽、編輯器的 preview 這三個地方,渲染結果
   跟現在完全一樣,這次修正不應該讓這三個地方少掉任何現有功能。
3. 身為正在問 AI 問題的擁有者,我希望 AI 的回答絕對不會去載入任何遠端圖片——因為這段回答是根據
   文章內容組出來的,而文章的原始來源我不一定完全信任,遠端圖片是這種不信任的內容能夠對外送出
   資訊的一個具體管道,這個風險是我自己放在文章裡的圖片不會有的。
4. 身為擁有者,我希望這次修正把稽核找到的這四種具體漏洞(假密碼表單、整頁 CSS 改版、用來畫覆蓋
   畫面的 `style` 屬性、AI 回答裡的遠端圖片)都堵起來,不用擔心稽核範圍之外還有其他沒被發現的
   HTML 功能仍然開著。
5. 身為維護者,我希望消毒的邏輯只存在一個地方,這樣以後要加第五個渲染點,或是要修正規則本身的
   錯誤,只需要改一個函式,不需要手動同步四個各自獨立的呼叫點。
6. 身為維護者,我希望有測試是真的把攻擊 payload 丟進真正的消毒函式庫、檢查吐出來的結果,而不是
   只檢查原始碼文字裡有沒有出現看起來對的字串陣列——這次修正真正在意的是函式庫實際的行為,單純
   讀文字沒辦法分辨「設定是對的」跟「設定寫錯字但剛好沒被抓到」。
7. 身為維護者,我希望這些真的會執行的行為測試,用的版本要跟正式環境實際載入的版本(`Index.html`
   鎖定的那幾個)完全一致,不要因為測試用了 npm 上剛好最新、但正式環境沒在用的版本,測出跟訪客
   實際遇到的行為不一樣的結果。
8. 身為維護者,我希望既有的靜態文字掃描測試(確認 `DOMPurify` 有被載入、確認沒有地方把
   `marked.parse` 的結果直接指定給 `innerHTML`)修正後還在,即使它原本「恰好出現 4 次
   `DOMPurify.sanitize(marked.parse(`」這條斷言在四個呼叫點合併成一個函式之後不再有意義——我希望
   有一個替代的斷言,一樣能抓到「以後有人不小心繞過共用函式、直接呼叫函式庫」這種情況。
9. 身為擁有者,我希望這次修正不會動到要載入哪個版本的函式庫,或 `Index.html` 現有的
   `CDN_PIN_VERSIONS_` 開關——這次修正只處理 `marked.parse()` 產生的結果之後要怎麼處理,不動
   要載入哪些 `<script>`。
10. 身為維護者,我希望光看四個渲染點各自的消毒呼叫,就能一眼看出這個地方用的是標準設定還是 AI
    設定、為什麼——這樣以後有人要加第五個渲染點,不用自己猜該套用哪一組。

## Implementation Decisions

- **兩組設定物件**:`MD_SANITIZE_CONFIG_`(`FORBID_TAGS`:`style`/`form`/`input`/`button`/
  `textarea`/`select`/`option`/`optgroup`/`label`/`fieldset`/`legend`;`FORBID_ATTR`:`style`/
  `action`/`formaction`/`method`/`srcset`)、`MD_SANITIZE_CONFIG_AI_`(內容跟上面完全一樣,
  `FORBID_TAGS` 再多加 `img`/`picture`/`source`)。這組黑名單是 mycr 報告當時已經實際驗證過的
  設定(擋得住已知的四種向量、正常 Markdown 不受影響),這次直接採用,不重新設計。
- **一個共用函式**:`JavaScript.html` 新增 `renderMarkdownSafe_(md, cfg)`,內容是
  `DOMPurify.sanitize(marked.parse(md || ''), cfg || MD_SANITIZE_CONFIG_)`——沒帶 `cfg` 時
  預設用標準設定,不需要 AI 設定的三個呼叫點可以省略第二個參數。
- **四個呼叫點改叫共用函式**:文章內文、md 附件預覽、EasyMDE 的 `previewRender` 這三處改成
  `renderMarkdownSafe_(x)`;AI 問答回答那處改成 `renderMarkdownSafe_(result.answer,
  MD_SANITIZE_CONFIG_AI_)`。
- **不動 `Index.html` 載入哪些函式庫**:`CDN_PIN_VERSIONS_` 開關、SRI hash、要載入哪個版本,
  這次完全不碰——這次修正只處理 `marked.parse()` 的輸出結果之後怎麼消毒,不是要不要載入。
- **新增只給測試用的 devDependency**:`dompurify@3.4.14`、`marked@18.0.12`(對齊
  `Index.html` 目前鎖定的版本)、`jsdom`(取最新穩定版即可,這個套件本身不用跟正式環境對齊,
  只是提供一個可以跑 DOM API 的環境)。正式環境的行為不變,仍然是透過 CDN 載入;這幾個套件只在
  測試時執行,不會被打包進交付的 Apps Script 專案。
- **新測試直接從 `JavaScript.html` 的原始碼文字裡抓出 `renderMarkdownSafe_` 的原始碼**(用
  `test/EasyMdePreviewSanitization.test.js` 已經在用的 `extractFunctionBody` 同一套技巧),
  在 jsdom 的全域環境裡執行這段抓出來的原始碼(這個環境裡 `marked`/`DOMPurify` 是真正的、
  npm 安裝的函式庫)——這樣測試驗證的是正式程式碼本身的原始碼文字,不是另外手動謄寫一份「照理說
  應該一樣」的複製版本,不會因為忘記同步而悄悄跟正式程式碼脫節。
- **既有 `test/MarkdownSanitization.test.js` 第三個斷言改寫**:原本斷言「原始碼裡恰好出現 4 次
  `DOMPurify.sanitize(marked.parse(` 這個字串」,改成斷言「四個已知的呼叫點都有呼叫
  `renderMarkdownSafe_(...)`」——這四個呼叫點合併成一個函式之後,原本數字串出現次數的斷言不再
  有意義,新的斷言驗證的是同一件事(四個地方都有走消毒路徑),只是換成合併後仍然成立的寫法。
  這個檔案其餘兩個斷言(`DOMPurify` 有被載入、沒有地方把 `marked.parse` 結果直接指定給
  `innerHTML`)維持不動,合併之後仍然正確、有意義。
- **既有 `test/EasyMdePreviewSanitization.test.js` 的斷言跟著更新**:原本斷言
  `initEasyMDE` 的 `previewRender` 覆寫裡,`DOMPurify.sanitize(` 包住 `marked.parse(`(順序
  正確、是同一個呼叫巢狀在一起),改成斷言 `previewRender` 呼叫的是 `renderMarkdownSafe_(...)`,
  維持同一個保障(這個渲染點不會退回 EasyMDE 自己未消毒的預設行為)。

## Testing Decisions

- **新增 `test/MarkdownSanitizationBehavior.test.js`(jsdom + 真正的、版本鎖定的
  dompurify/marked)**:準備一組已知會被 DOMPurify 預設設定放行的 payload(mycr 報告當時實測
  過的那幾個:會收集密碼的 `<form>`、整頁 `<style>` 區塊、用來畫覆蓋畫面的 `style` 屬性、遠端
  `<img>`),驗證 `renderMarkdownSafe_` 用標準設定跑過之後,這幾個全部被擋下;同時驗證一段正常
  Markdown(標題、清單、程式碼區塊、表格、連結、粗體)跑過之後,結構完全保留、沒有被誤傷。另外
  驗證同一個遠端 `<img>` payload 用 AI 設定跑過之後,圖片也一併被擋下(標準設定不會擋的部分)。
- **`test/MarkdownSanitization.test.js` 維持存在**,當作比較輕量的結構性檢查——不需要 jsdom、
  跑起來快,雖然沒辦法證明消毒設定實際擋不擋得住東西,但可以抓到「有人加了第五個渲染點、完全
  繞過共用函式」這種行為測試不會直接涵蓋到的情況(除非剛好也對那個新渲染點寫了行為測試)。
- **`test/EasyMdePreviewSanitization.test.js` 維持存在**,繼續當作 EasyMDE `previewRender`
  這個特定渲染點的專屬結構性檢查——這一處背後的風險(不需要密碼就能觸發)是原本 mycr High
  severity finding 的重點,即使合併成共用函式之後,保留一個專門對著它的測試還是有意義。
- 四個正式渲染點(文章內文、md 附件預覽、AI 回答、EasyMDE preview)都至少在上面某一份測試檔裡
  被指名驗證過一次,確保之後不管哪一個被移除或設定錯誤,都還是會被某個既有測試抓到。

## Out of Scope

- 從黑名單(`FORBID_TAGS`/`FORBID_ATTR`)換成白名單(`ALLOWED_TAGS`)——grilling 對談時
  討論過,黑名單是這次 mycr finding 當時實際驗證過的做法,白名單是更大幅的設計改動,留給以後
  另外稽核、另外決定。
- 這次 F-02 finding 沒有點名到的其他 HTML/屬性向量(例如 `target="_blank"` 沒有搭配
  `rel="noopener noreferrer"` 的 tabnabbing 風險)——不在這次範圍內,需要的話應該是另一個
  獨立的、經過稽核的 finding。
- `Index.html` 的 `CDN_PIN_VERSIONS_` 開關、SRI hash、要載入哪個版本——跟這次修正的內容
  無關,不動。
- F-11(重複程式碼,包含 `docs/preview/Preview.html` 完全沒有消毒這件事)——這次修正把四個
  渲染點合併成一個函式,順帶縮小了 F-11 提到的重複範圍,但 `Preview.html` 本身跟 F-11 其他
  項目這次不動,F-11 本身不在這輪批准的範圍內。

## Further Notes

- 決策脈絡:AI 回答額外擋圖片的理由,是重新讀過 `RagChat.gs` 的 prompt 之後確認的具體事實
  (不是預設立場而已)——prompt 明確要求「只根據參考文章的內容回答」,純文字問答摘要,沒有任何
  地方預期或需要模型回傳圖片。
- 這次是這個專案第一次替 `JavaScript.html`(前端)寫會真的執行 DOMPurify/marked 的測試,之前
  全部都是純文字掃描;新增的 devDependency 只在測試時用,不影響正式環境實際載入的函式庫版本或
  `CDN_PIN_VERSIONS_` 的行為。
- 修正完成後,依專案慣例在 `README.md`「已知問題修復紀錄」新增對應編號條目。
- 同一輪 mycr 報告(`mycr-20260921-060513.md`)裡其他 finding(F-04、F-05、F-06、F-09、
  F-10 剩餘部分、F-11)是各自獨立的問題,不在這份 spec 的範圍內。
