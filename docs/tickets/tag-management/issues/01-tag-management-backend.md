# 01 — 標籤管理補完:renameTag / deleteTag / countTagUsage / mergeTags

**What to build:** `Tags.gs` 新增標籤的改名、刪除、使用數查詢、合併四個函式。
合併時要正確處理「某篇文章同時擁有來源與目標標籤」的重疊情況,不違反
`article_tags` 的 `(article_id, tag_id)` unique constraint。

**Blocked by:** None — 依賴已完成的 `categories-tags/01`(`listTags`)、
`gas-supabase-backend/02`(`findOrCreateTag_`)。

**Status:** ready-for-agent

- [ ] `renameTag(tagId, newName)` 送出正確的更新請求,回傳更新後的列。
- [ ] `deleteTag(tagId)` 送出刪除請求,回傳 `{ deleted: true, id: tagId }`
      (格式對齊 `deleteCategory`);`article_tags` 的關聯列清理交由既有的
      FK cascade 處理,不在 GAS 端手動清除。
- [ ] `countTagUsage(tagId)` 回傳 `{ count: N }`,N 是目前使用這個標籤的文章
      數;這是讀取類函式,不進 `Auth.gs` 白名單。
- [ ] `mergeTags(sourceTagId, targetTagId)`:兩者相同時直接 throw,不發出任何
      網路呼叫。
- [ ] `mergeTags`:文章只有來源標籤(沒有目標標籤)時,把該筆
      `article_tags` 的 `tag_id` 從來源改成目標(UPDATE,不是先刪再插)。
- [ ] `mergeTags`:文章同時擁有來源與目標標籤時,直接刪除該篇文章指向來源
      標籤的關聯列(不是 UPDATE,避免違反 unique constraint)。
- [ ] `mergeTags` 處理完所有受影響文章後,刪除來源標籤本身,回傳目標標籤的
      最新資料。
- [ ] `Auth.gs` 白名單新增 `renameTag`、`deleteTag`、`mergeTags` 三筆(不含
      `countTagUsage`);密碼錯誤時三個都不會被實際執行。
- [ ] 用假的 `httpFetch_` 寫測試涵蓋以上情境,重點是合併時「只在來源」跟
      「來源+目標都有」這兩種文章各自的正確處理路徑要分別驗證到。
