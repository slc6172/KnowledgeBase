# 04 — 發布文章不再有部分提交

**What to build:** `setArticleStatus_('published')` 在兩種情況下都不會再留下「狀態已經改成
已發布、但從來沒有真正被 embedding 過」的狀態:(1) 共用的匿名讀取節流額度被用滿,(2) Gemini 呼叫
本身失敗。具體做法比照 Ticket 03 同樣的重排模式:先用內部讀取取得目前的標題/內文,在碰資料庫之前
先呼叫 Gemini 算出新 embedding,成功之後才用單一次更新把 `status: 'published'` 跟新 embedding
一起寫進去。取消發布(狀態改成草稿)不涉及 embedding,呼叫順序完全不變(重用 Ticket 01 引入的內部
文章讀取來繞過節流即可,不需要重新排序)。

**Blocked by:** 01(重用它引入的內部文章讀取)

**Status:** done

- [x] 把共用節流計數器灌到上限後呼叫 `setArticleStatus_`(不論發布或取消發布),仍完整成功
- [x] 發布文章時,模擬 Gemini 呼叫失敗,驗證 articles 資料表完全沒有任何一次 PATCH 發生,狀態
      維持原樣(不是先寫死 `published` 才失敗)
- [x] 發布文章、且 Gemini 成功時,驗證最終只對 articles 資料表發出**一次** PATCH,payload 同時
      包含 `status: 'published'` 跟新的 embedding
- [x] 取消發布(改回草稿)的呼叫順序與次數(既有測試斷言的那些)完全不變
- [x] 既有測試「a non-2xx Gemini response makes setArticleStatus_('published') throw」跟
      「publishing updates status, fetches the article, and triggers embedding exactly once」
      改寫成斷言新的呼叫順序跟合併後的 payload,不是原封不動保留或另外新增一份重複的測試
- [x] 完整測試套件(`npm test`)全數通過
