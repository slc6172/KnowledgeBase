# 01 — 文章詳情組防過期

**What to build:** `loadArticleDetail` 的成功回呼、`openArticleDetailFromShareLink` 內嵌的
成功回呼、`loadRelatedArticles` 的成功回呼,各自在套用畫面更新之前,檢查對應的 `articleId` 是否
仍等於 `currentDetailArticleId`(已經在 `openArticleDetail`/`openArticleDetailFromShareLink`
呼叫當下同步設定,不需要新增變數),不等就直接 `return`,不渲染。

**Blocked by:** None — can start immediately

**Status:** done

- [x] 模擬 `openArticleDetail(A)` 接著 `openArticleDetail(B)`(B 比 A 快抵達回應),驗證最終
      `#detail-content`/`#detail-title` 等元素顯示的是 B 的內容,不是 A 的
- [x] 同樣的「A 慢、B 快」情境,驗證 `loadRelatedArticles` 的結果也對應 B,不是 A
- [x] `openArticleDetailFromShareLink` 的內嵌成功回呼也套用同樣的檢查
- [x] 正常情況(沒有競態,回應依序抵達)行為不變
- [x] 完整測試套件(`npm test`)全數通過
