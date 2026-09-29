# 03 — 列表/搜尋組防過期(共用同一個請求序號)

**What to build:** 新增一個共用的模組層級變數 `var articleResultsRequestSeq_ = 0;`。
`loadArticleList`/`performSearch` 呼叫當下各自執行 `var seq = ++articleResultsRequestSeq_;`,
把 `seq` 存進區域變數(閉包捕捉)。兩者的成功回呼與失敗回呼開頭都先檢查
`seq !== articleResultsRequestSeq_`,不等就直接 `return`(連 `setSearchBusy(false)` 這類
收尾動作都跳過)。**這兩個函式必須共用同一個序號變數**,不能各自獨立——不然瀏覽模式的舊回應
還是可能蓋掉搜尋模式的新回應,反之亦然。

**Blocked by:** None — can start immediately

**Status:** done

- [x] `loadArticleList`/`performSearch` 共用同一個 `articleResultsRequestSeq_` 變數
- [x] 模擬同一種呼叫連續兩次(例如 `loadArticleList()` 接著 `loadArticleList()`,先呼叫的
      比較晚回應),驗證最終畫面顯示的是後呼叫的結果
- [x] 模擬跨函式交錯呼叫(`loadArticleList()` 接著 `performSearch(...)`,或反過來),且故意
      讓比較早的呼叫比較晚回應,驗證最終畫面顯示的是**最後一次呼叫**的結果,不管是哪一個函式
      ——這個測試要能證明兩者真的共用同一個序號,不是各自獨立判斷
- [x] 正常情況(沒有競態,回應依序抵達)行為不變
- [x] 完整測試套件(`npm test`)全數通過
