# 02 — 純瀏覽(不打字)也能用標籤篩選

**What to build:** `Articles.gs` 的 `listArticles(opts)` 新增 `opts.tagIds`
支援(AND 語意,應用層過濾,不新增 RPC/SQL 函式),純瀏覽列表(目前只有
`list-category-filter` 分類下拉的那個篩選列)新增標籤篩選 UI,跟分類篩選同時
生效(AND)。

**Blocked by:** tag-picker/01 — 共用標籤選取元件 + 套用到文章編輯頁(需要
`filter` 模式已經存在)

**Status:** ready-for-agent

- [ ] `Articles.gs` 新增私有輔助函式 `filterArticleIdsByTags_(tagIds)`:
      `supabaseSelect('article_tags', 'tag_id=in.(' + tagIds.join(',') +
      ')&select=article_id,tag_id')` 取出候選關聯列,應用層依 `article_id`
      分組計算每篇文章符合的 distinct `tag_id` 數量,回傳「符合數量 ===
      `tagIds.length`」的 `article_id` 陣列(AND 語意,對齊
      `hybrid_search_articles` RPC 的 `having count(distinct tag_id) =
      array_length(tag_ids, 1)`)。
- [ ] `listArticles(opts)`:`opts.tagIds` 非空時,先呼叫
      `filterArticleIdsByTags_`;結果為空陣列時**直接回傳 `[]`**、不送出
      第二次對 `articles` 表的查詢;結果非空時把 `id=in.(...)` 疊加進既有
      查詢字串(在 `status`/`categoryId` 過濾之後、`limit`/`offset` 之前),
      三個篩選條件疊加為 AND。
- [ ] `opts.tagIds` 為空陣列或未提供時,`listArticles` 行為跟這次改動之前
      完全一樣,既有測試不能因此斷掉。
- [ ] 純瀏覽篩選列新增 `buildTagPicker(container, { mode: 'filter', onChange:
      ... })`,選取變化時重新呼叫 `listArticles`,把選取的標籤 id 陣列帶進
      `opts.tagIds`,與既有的 `opts.categoryId`/`opts.status` 一起傳。
- [ ] 用假的 `httpFetch_` 寫測試(擴充 `test/Articles.test.js`):
      1. 帶 `tagIds` 時先送出 `article_tags` 查詢、再送出帶 `id=in.(...)`
         的 `articles` 查詢,兩次呼叫順序跟參數都要驗證。
      2. 只符合部分標籤(不是全部)的文章不出現在最終 `id=in.(...)` 清單裡
         (AND 語意)。
      3. 沒有文章同時符合全部選取標籤時回傳 `[]`,且**不**送出第二次查詢
         (斷言 `fetchSpy` 呼叫次數)。
      4. `tagIds` 跟 `categoryId`/`status` 同時提供時,最終查詢字串三個條件
         都要出現。
- [ ] 手動驗收:純瀏覽勾選 2 個標籤只看到同時有這兩個標籤的文章;標籤篩選
      跟分類篩選同時使用時兩個條件一起套用。
