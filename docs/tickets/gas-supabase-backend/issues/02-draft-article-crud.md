# 02 — 草稿文章 CRUD + 標籤同步

**What to build:** 使用者能建立一篇草稿文章(含分類、標籤)、依 ID 取回、依條件篩選
列出、編輯任一欄位、刪除文章——完整的草稿生命週期,標籤在存檔時自動同步(既有的
重用、沒有的新建)。這個階段完全不涉及 Gemini/embedding。

**Blocked by:** 01 — SupabaseClient 基礎層

**Status:** done

- [x] `createArticle(data)` 以 `status = 'draft'` 建立文章,回傳含 category 與 tags
      的完整資料(透過 `getArticle`)。
- [x] `createArticle` 會同步 `tag_names`:名稱已存在的標籤直接重用,不存在的自動
      建立。
- [x] `getArticle(id)` 回傳文章並 join 出 category 與 tags;查無該 ID 時丟出清楚的
      「找不到文章」錯誤,而不是回傳空值或整個崩潰。
- [x] `listArticles(opts)` 支援 `status`、`category_id` 篩選,`limit`/`offset`
      分頁,依 `updated_at` 新到舊排序,回傳結果不含 `embedding` 欄位。
- [x] `updateArticle(id, data)` 只更新 `data` 裡實際帶到的欄位
      (`title`/`content_md`/`category_id`);帶了 `tag_names` 時整批替換該文章的
      標籤關聯(先清空既有 `article_tags`,再依新名單重建)。
- [x] `syncArticleTags_` 遇到已存在的標籤名稱(完全相符比對)會重用既有 `tag_id`,
      不會建出重複標籤。
- [x] `deleteArticle(id)` 刪除該文章;文章底下的 `article_tags` 關聯隨之消失
      (依賴 `schema.sql` 已定義的 FK cascade,這裡的測試只需確認呼叫對 `articles`
      表發出 DELETE,cascade 本身是資料庫層的保證,不在此重測)。
- [x] 本票所有函式在任何情況下都不會呼叫 Gemini embedding 端點。
- [x] 用假的 `httpFetch_` 寫測試涵蓋:建立文章(混合新標籤與既有標籤);對不存在的
      ID 呼叫 `getArticle` 會 throw;`listArticles` 組出的 query string 正確反映
      篩選/分頁/排序參數;`updateArticle` 正確整批替換標籤;`deleteArticle` 送出
      正確的刪除請求。
