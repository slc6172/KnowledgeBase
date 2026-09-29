# Spec:前端非同步回應加上防過期檢查,避免舊回應蓋掉使用者目前真正想看的內容

**Triage label**:`ready-for-agent`

**來源**:`mycr-20260921-060513.md`(全新複掃報告)Finding F-06,經 `/grilling` 對談逐項定案
(2026-09-22)。

## Problem Statement

`google.script.run` 的每次呼叫是獨立執行,回應不保證依序抵達。`JavaScript.html` 裡有幾個地方
會把非同步回應直接寫進「每次呼叫都共用、在回呼裡才活著查找」的元素或變數,回呼本身沒有檢查這個
回應是否還對應使用者目前真正想看的東西:

- `openArticleDetail(id)` 把 `currentDetailArticleId` 設成 id,但 `loadArticleDetail` 的
  成功回呼直接把回應渲染進 `#detail-content` 等元素,沒有檢查回應的文章 id 是否還等於目前的
  `currentDetailArticleId`。快速切換文章時(點文章 A(慢)→ 回首頁 → 點文章 B(快)),B 可能
  先畫、A 才晚到覆蓋畫面,但 `btn-delete-article` 刪的是 `currentDetailArticleId`(仍然正確
  指向 B)——結果是**眼前看的是 A,被硬刪除的是 B**,含全部附件,不可復原。
- `loadRelatedArticles`(跟 `openArticleDetail` 同一個觸發點觸發,寫進同一批共用元素)有一樣的
  問題。
- `openArticleEditor(id)` 把 `editingArticleId = article.id` 放在回呼裡才設定(不是呼叫當下
  同步設定)。如果使用者在回應抵達前點了「新增文章」(`resetEditorForm()` 把 `editingArticleId`
  設回 `null`),晚到的回應會把舊文章的內容填回表單,還把 `editingArticleId` 又改回舊文章的
  id——使用者以為在寫新文章,實際存檔卻是覆蓋了舊文章。
- `loadArticleList()`(瀏覽模式)、`performSearch(queryText)`(搜尋模式)都寫進同一個共用的
  文章卡片清單區域(`renderArticleCards`),篩選條件或搜尋字變動很快時,舊的回應可能比新的晚到,
  把畫面蓋回舊的、不再對應目前篩選條件的結果。

調查這個 finding 時,把這個專案裡全部 25 個 `google.script.run` 呼叫點都檢查過一輪:除了上面
5 個,其餘(`loadAiAnswer`、附件預覽 `loadSignedPreview`/`loadTextPreview`、
`mountAttachmentPanel` 極其內部的附件清單/資料夾快取、`loadCategoryTree`/
`loadTagManagerList`/幾個「載入全部分類/標籤」的函式)都是「每次呼叫重新建立自己專屬的 DOM
元素、靠閉包捕捉」或「載入沒有特定目標的全域清單」,結構上天生安全,不受這個問題影響,確認過
不需要修改。

調查 `openArticleEditor` 時,另外發現一個相關但不同的問題:開啟編輯器到資料真的載入完成之間,
儲存/發布按鈕目前完全沒有被停用——使用者如果在資料載入完成前就點儲存,現在的程式碼會因為
`editingArticleId` 還沒被回呼設定而誤判成「沒有 `editingArticleId`」,建立出一篇不該有的空白
重複文章。

## Solution

`openArticleDetail`/`openArticleDetailFromShareLink`/`loadArticleDetail`/`loadRelatedArticles`
這組,直接重用既有的 `currentDetailArticleId` 當防過期依據——它本來就在呼叫當下同步設定,回呼
裡加一行「回應的文章 id 是否還等於 `currentDetailArticleId`」的檢查,不符合就靜默跳過,不渲染。

`openArticleEditor` 把 `editingArticleId = articleId` 從回呼裡移到呼叫當下同步設定(比照
`currentDetailArticleId` 的既有模式),回呼裡加一行「`editingArticleId` 是否還等於這次呼叫
當時的 articleId」的檢查。同時在 `openArticleEditor` 開始載入時就呼叫既有的
`setEditorBusy(true)`,載入完成(不論成功或失敗)才 `setEditorBusy(false)`——徹底補上「資料
載入完成前儲存按鈕沒鎖住」這個順便發現的缺口。

`loadArticleList`/`performSearch` 這組沒有現成的「目前目標」變數可以重用(使用者的篩選/搜尋
意圖不是一個穩定的 id,是可能重複的複合值),改用遞增的請求序號:呼叫當下遞增一個共用的序號、
把當時的值存進區域變數,回呼裡比對「這個序號是否還是最新的」。**這兩個函式寫進的是同一個共用
畫面區域(都呼叫 `renderArticleCards`),必須共用同一個序號變數**,不能各自獨立——不然瀏覽模式
的舊回應還是可能蓋掉搜尋模式的新回應,反之亦然。

## User Stories

1. 身為擁有者,我希望快速切換文章時(點開一篇又立刻點開另一篇),最後畫面上顯示的內容,一定
   跟「刪除文章」按鈕實際會刪除的文章一致,不會出現「畫面顯示 A、刪的卻是 B」這種不一致。
2. 身為擁有者,我希望同一個理由(舊回應晚到覆蓋新回應)不會發生在「你可能也想看」這個相關文章
   區塊——它應該永遠對應畫面上目前顯示的那篇文章,不是某次比較慢的載入結果。
3. 身為擁有者,我希望在編輯器裡快速從「編輯文章 A」切到「新增文章」時,表單最終顯示的一定是
   空白的新文章表單,不會被 A 的舊資料悄悄填回來,存檔也不會意外覆蓋 A。
4. 身為擁有者,我希望在編輯器資料還沒載入完成之前,儲存/發布按鈕是鎖住的,不會因為手滑點擊
   而建立出一篇不該存在的空白重複文章。
5. 身為擁有者,我希望快速切換篩選條件或連續輸入搜尋字時,畫面上最終顯示的文章清單,一定對應
   我最後一次的篩選/搜尋條件,不會被中途某次比較慢的回應蓋回舊的結果。
6. 身為擁有者,我希望瀏覽模式跟搜尋模式之間快速切換時(例如正在瀏覽,突然開始打字搜尋),也
   不會出現舊的瀏覽結果蓋掉新的搜尋結果、或反過來的情況——這兩個模式寫的是同一塊畫面,防過期
   檢查必須把兩邊算在一起,不能各自獨立判斷。
7. 身為擁有者,我希望這次修正不會影響其他已經確認沒有這個問題的地方(AI 問答、附件預覽、
   附件面板、分類/標籤管理清單)的行為——它們結構上本來就安全,不應該被畫蛇添足地加上不必要的
   檢查。
8. 身為維護者,我希望被判定為過期而捨棄的回應,是靜默跳過、不做任何畫面更新,不需要额外的
   「這個回應已過期」提示——使用者很快就會看到真正最新的回應正確顯示,不需要中間狀態的訊息。

## Implementation Decisions

- **文章詳情組(`openArticleDetail`/`openArticleDetailFromShareLink`/`loadArticleDetail`/
  `loadRelatedArticles`)**:重用既有的 `currentDetailArticleId`(已經在 `openArticleDetail`/
  `openArticleDetailFromShareLink` 呼叫當下同步設定,不需要新增變數)。`loadArticleDetail`
  的成功回呼、`openArticleDetailFromShareLink` 內嵌的成功回呼、`loadRelatedArticles` 的成功
  回呼,各自在套用畫面更新之前,先檢查傳入/回應對應的 `articleId` 是否仍等於
  `currentDetailArticleId`,不等就直接 `return`,不渲染。
- **編輯器(`openArticleEditor`)**:`editingArticleId = articleId` 從成功回呼移到函式最開頭
  (`google.script.run` 呼叫之前)同步設定。成功回呼套用表單填值之前,檢查
  `editingArticleId === articleId`(這裡的 `articleId` 是呼叫 `openArticleEditor` 當下傳入
  的參數,透過閉包捕捉,不是回應資料裡的 `article.id`——避免"依賴伺服器回應內容來判斷自己是否
  過期"這種較繞的寫法),不等就直接 `return`。同時在函式最開頭呼叫 `setEditorBusy(true)`,
  成功與失敗回呼都呼叫 `setEditorBusy(false)`(失敗回呼原本只有 `showError`,現在補上
  `setEditorBusy(false)`)。
- **列表/搜尋組(`loadArticleList`/`performSearch`)**:新增一個共用的模組層級變數
  `var articleResultsRequestSeq_ = 0;`。`loadArticleList`/`performSearch` 呼叫當下各自執行
  `var seq = ++articleResultsRequestSeq_;`,把 `seq` 存進區域變數(閉包捕捉)。兩者的成功
  回呼與失敗回呼開頭都先檢查 `seq !== articleResultsRequestSeq_`,不等就直接 `return`(連
  `setSearchBusy(false)` 這類收尾動作都跳過——只有最新一次請求的結果才能決定最終的忙碌狀態,
  跳過收尾動作是刻意的,不是遺漏)。
- **不動的部分**:`loadAiAnswer`/`renderAiAnswerTurn`(每次呼叫重新建立 `turnEl`,閉包捕捉,
  結構上已經安全)、附件預覽 `loadSignedPreview`/`loadTextPreview`/`toggleAttachmentPreview`
  (每個附件有自己專屬的 `previewBox`,閉包捕捉)、`mountAttachmentPanel` 與其內部的
  `refresh`/`loadFolderCache`(每次掛載重建 `containerEl.innerHTML`,舊呼叫的閉包參照的是
  已經被換掉、不在畫面上的舊元素)、`loadCategoryTree`/`loadTagManagerList`/
  `loadListTagFilterCache`/`loadCategoryFilterOptions`/`loadBatchCategoryOptions`/
  `loadBatchTagCache`/`loadCategoryOptions`/`loadTagCache`(載入沒有特定目標的全域清單,
  沒有「顯示錯目標」的風險)——這些都不加任何防過期檢查,維持現狀。

## Testing Decisions

- 這是前端(`JavaScript.html`)程式碼,沿用這個專案既有的前端測試慣例:直接從原始碼文字裡抓出
  相關函式的原始碼比對/執行(比照 `test/EasyMdePreviewSanitization.test.js`、這次 F-02 新增
  的 `test/MarkdownSanitizationBehavior.test.js` 已經在用的 `extractFunctionBody`/vm 沙箱
  技巧),不需要额外引入完整的瀏覽器自動化測試框架。
- 新增測試:模擬 `openArticleDetail(A)` 接著 `openArticleDetail(B)`(B 比 A 快抵達回應),
  驗證最終 `#detail-content`/`#detail-title` 等元素顯示的是 B 的內容,不是 A 的——直接驗證
  使用者實際會看到的結果,不是只檢查程式碼裡有沒有某個 if 判斷式。
- 新增測試:同樣的「A 慢、B 快」情境,驗證 `loadRelatedArticles` 的結果也對應 B,不是 A。
- 新增測試:模擬 `openArticleEditor(A)` 期間使用者點了「新增文章」(呼叫
  `resetEditorForm()`),接著 A 的回應才抵達,驗證 `editingArticleId` 維持 `null`、表單欄位
  維持空白(不是被 A 的資料填回來)。
- 新增測試:模擬 `openArticleEditor(A)` 接著立刻 `openArticleEditor(B)`(B 比 A 快抵達),
  驗證最終表單顯示、`editingArticleId` 都對應 B,不是 A。
- 新增測試:驗證 `openArticleEditor` 呼叫當下(同步,不用等任何回應)儲存/發布按鈕就已經是
  disabled,回應抵達後才解除。
- 新增測試:模擬 `loadArticleList()` 接著 `performSearch(...)`(順序調換的回應),驗證最終
  畫面顯示的文章卡片對應**最後一次呼叫**,不管是哪一個函式、也不管回應抵達的先後順序——這個
  測試要能證明兩者真的共用同一個序號變數,不是各自獨立判斷(用兩者交錯呼叫、且故意讓比較早的
  呼叫比較晚回應的情境來驗證)。
- 既有測試(這五個函式目前沒有測試涵蓋到非同步時序,其他前端測試檔案裡跟這五個函式無關的部分)
  預期維持全數通過、不需要修改。

## Out of Scope

- 已經逐一查證過安全、不受這個問題影響的其餘 20 個 `google.script.run` 呼叫點——不加任何
  防過期檢查,維持現狀。
- 對捨棄的過期回應加上任何使用者可見的提示訊息——grilling 對談時確認靜默捨棄就好,使用者很快
  會看到真正最新的回應正確顯示。
- 同一輪 mycr 報告裡其他 finding(F-02、F-04、F-05、F-09、F-10 剩餘部分、F-11)是各自獨立
  的問題,不在這份 spec 的範圍內。

## Further Notes

- 決策脈絡:mycr 報告原本只點名 `openArticleDetail`/`openArticleEditor` 兩處,grilling 對談
  時把這個專案裡全部 25 個 `google.script.run` 呼叫點都重新查過一輪,確認還有 3 處
  (`loadRelatedArticles`、`loadArticleList`、`performSearch`)是同一類問題,使用者同意一併
  修正。同一次調查也發現「編輯器載入完成前儲存按鈕沒鎖住」這個相鄰但不同的問題,使用者同意
  一併補上。
- `loadArticleList`/`performSearch` 共用同一個請求序號變數這件事,是設計上必須做對、但不影響
  已核准決定的技術細節(不是新的使用者決策點)——兩者寫進同一塊畫面,各自獨立的序號沒辦法擋住
  「瀏覽模式的舊回應蓋掉搜尋模式的新回應」這種跨函式的競態。
- 修正完成後,依專案慣例在 `README.md`「已知問題修復紀錄」新增對應編號條目。
