# 01 — 命中段落往上傳遞,公開搜尋剝除

**What to build:** 內部檢索呼叫者(AI 問答)能拿到每篇文章「最接近查詢的那一段」;公開的 `searchArticles` 回應維持原樣,不多帶命中段落(每篇最多多 1,500 字,前端不需要)。

**Blocked by:** None — can start immediately

**Status:** done

**接縫(spec〈Testing Decisions〉接縫 1):** GAS 端 `httpFetch_`。

- [x] 內部呼叫者拿到的每篇文章含 `matchedChunk`:語意命中為 `{ index, content, distance }`,只被關鍵字命中為 `null`
- [x] 公開 `searchArticles` 回傳的文章不含 `matchedChunk`
- [x] 文章順序、`degraded` 旗標、補資料請求與現況完全相同
- [x] 既有 Search 測試維持通過
