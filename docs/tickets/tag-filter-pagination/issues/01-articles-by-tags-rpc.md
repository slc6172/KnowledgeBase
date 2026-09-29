# 01 — 新增 articles_by_tags RPC,listArticles 標籤篩選改用它

**What to build:** `docs/schema.sql` 新增 `articles_by_tags(tag_ids uuid[], status_filter
text default null, category_id_filter uuid default null, lim int default 50, off int
default 0) returns setof articles`——沿用 `hybrid_search_articles` 裡已有的 `tag_filtered`
CTE 邏輯判斷「同時擁有全部指定標籤」,疊加 `status_filter`/`category_id_filter`(皆為 null 時
不套用),依 `updated_at desc` 排序,套用 `limit`/`offset`,分頁完全在 SQL 端完成。
`listArticles` 只有 `opts.tagIds` 非空時才改呼叫這個 RPC(標籤 id 先經過 `uniqueValues_`
去重,比照 `searchArticles` 對 `hybrid_search_articles` 的既有做法):第一段呼叫拿到這一頁
(已篩選/排序/分頁)的裸 `articles.*` 列,第二段用既有的 `inFilter_('id', pageIds)` 對這一頁
的 id 補查 join 資料,依第一段回傳的順序重新排列(比照 `searchArticles` 現在的寫法)。沒有標籤
篩選的分支維持現在直接組 REST 查詢字串的寫法完全不動。

**Blocked by:** None — can start immediately

**Status:** done

- [x] 標籤篩選(單一或多個標籤,可疊加 status/categoryId)時,`listArticles` 改呼叫
      `rpc/articles_by_tags`,payload 含去重後的 `tag_ids`、`status_filter`/
      `category_id_filter`/`lim`/`off`
- [x] RPC 回傳的裸列之後,`listArticles` 用 `inFilter_` 對「RPC 回傳的那些 id」補查一次 join
      資料,並依 RPC 回傳的順序重新排列(測試要用「RPC 順序」跟「補查回來的順序」刻意不同的
      案例驗證,不能只是剛好順序一樣測不出來)
- [x] 符合條件的文章數遠超過先前約 42–43 篇的網址長度門檻時(例如 100 個符合的文章 id),
      `listArticles` 仍完整成功——這是這次修正真正要解的問題,直接的迴歸測試
- [x] 標籤 id 有重複值時,送進 RPC 的 `tag_ids` payload 裡不應該有重複值
- [x] 沒有標籤篩選時,既有測試(`describe("listArticles", ...)` 裡不涉及標籤篩選的案例)
      維持全數通過、斷言內容不需要修改
- [x] 完整測試套件(`npm test`)全數通過

(2026-09-22 實作補充:動手前先用真正的 PostgreSQL 16 實例驗證了 `articles_by_tags`
這段 SQL 的語法與行為——AND 語意、`status_filter`/`category_id_filter`、分頁、單一
標籤、查無結果都各自建過測試資料驗證過一次,全部符合預期,才開始改 GAS 端。)
