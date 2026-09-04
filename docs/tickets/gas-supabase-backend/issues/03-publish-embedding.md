# 03 — 發布流程與 Embedding 產生/更新

**What to build:** 使用者把草稿切換成 `published` 時自動拿到一個
`gemini-embedding-001` 向量並寫回資料庫;之後編輯已發布文章的標題/內容會自動重新
產生 embedding,只改分類或標籤則不會呼叫 Gemini;Gemini 呼叫失敗會直接讓呼叫端知道,
不會讓文章悄悄地「已發布但沒有向量」。

**Blocked by:** 02 — 草稿文章 CRUD + 標籤同步

**Status:** done

- [x] `setArticleStatus(id, status)` 只接受 `'draft'` 或 `'published'`,不合法的值
      在發出任何網路請求之前就 throw。
- [x] `setArticleStatus(id, 'published')` 更新該文章的 `status`,並且恰好呼叫一次
      `generateEmbedding_`,把回傳的向量透過 PATCH 寫回 `articles.embedding`。
- [x] `generateEmbedding_(text)` 呼叫
      `POST .../models/gemini-embedding-001:embedContent`,帶
      `x-goog-api-key` 標頭,payload 包含
      `{ model, content.parts[0].text, outputDimensionality: 768 }`
      (2026-08-18 修正:原本寫成巢狀的 `embedContentConfig.outputDimensionality`,
      照官方文件是建議寫法,但實際呼叫會噴錯,改回最外層的
      `outputDimensionality` 才真的能動),回傳 `body.embedding.values`。
- [x] Gemini 回應非 2xx 時,`generateEmbedding_` 會 throw,不會吞掉錯誤讓流程繼續。
- [x] `updateArticle(id, data)` 在目標文章目前 `status === 'published'`、且
      `data` 帶了 `title` 或 `content_md` 時,會觸發
      `regenerateArticleEmbedding_`,用更新後的內容重新產生向量。
- [x] 同一種情境下,如果 `data` 只帶 `category_id` 或 `tag_names`(沒有
      `title`/`content_md`),則不會呼叫 embedding 端點。
- [x] `regenerateArticleEmbedding_(article)` 送給 Gemini 的文字組成是
      `title + '\n\n' + content_md`。
- [x] 用假的 Supabase 回應 + 假的 Gemini 回應寫測試涵蓋:發布觸發恰好一次 embedding
      呼叫;不合法的 status 在打任何網路請求前就 throw;已發布文章改標題/內容會
      觸發重新產生;已發布文章只改分類不會觸發;模擬 Gemini 回傳非 2xx 時整個流程
      會 throw。
