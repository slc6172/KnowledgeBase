# 01 — `askKnowledgeBase` 的 `sources` 新增 `categoryName`

**What to build:** AI 問答回傳的每個來源除了 `id`、`title`,再多帶所屬分類名稱;分類資料取自檢索
時已一併查回的關聯,不增加任何請求;未分類的文章為 `null`。這張票交付後前端行為不變(尚未使用
新欄位),後端形狀已就位。

**Blocked by:** None — can start immediately

**Status:** done

**接縫(spec〈Testing Decisions〉接縫 1):** GAS 端 `httpFetch_`。

- [x] 有分類的文章 → 對應來源含該分類名稱;未分類(無分類關聯)→ `categoryName` 為 `null`
- [x] 多篇文章 → 來源順序與檢索順序一致,數量與檢索結果相同
- [x] 查無相關文章 → `sources` 仍為空陣列,行為與現況相同
- [x] 送往 Gemini 的提示詞、檢索請求、Gemini 呼叫與現況完全相同(不多一個請求)
- [x] 既有的其他 RagChat 測試維持通過;除 `sources` 形狀的斷言外不需任何修改

> **實作註記:** 分類名稱為空字串時也正規化為 `null`(spec 只說「未分類為 null」;空字串在資料上可能存在,
> 若原樣回傳前端會渲染出空白標籤,屬最保守且不改變 spec 行為的處理)。既有 `sources` 形狀斷言依 spec 更新。
