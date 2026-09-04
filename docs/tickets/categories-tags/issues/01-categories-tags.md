# 01 — 分類/標籤查詢函式(Categories.gs + Tags.gs)

**What to build:** 補上 `spec_gas_backend.md` 當初列為 Out of Scope 的分類 CRUD
與標籤列表查詢——GAS 前端的分類管理畫面、文章編輯頁的分類下拉/標籤自動建議都要
靠這些函式。

**Blocked by:** None — can start immediately(沿用既有的 `httpFetch_` 接縫,以及
已完成的 `SupabaseClient.gs`)

**Status:** done

- [x] `listCategories()` 回傳所有分類,依 `name` 排序
      (`select=*&order=name.asc`)。
- [x] `listTags()` 回傳所有標籤,依 `name` 排序(`select=*&order=name.asc`)。
- [x] `createCategory(name, parentId)` 在 `parentId` 未提供時直接建立頂層分類。
- [x] `createCategory(name, parentId)` 在 `parentId` 有值時,先查出該分類;若那筆
      分類自己的 `parent_id` 不是 null(代表要在子分類底下再建子分類,會超過 2
      層),throw 清楚錯誤且不呼叫 insert。
- [x] `createCategory(name, parentId)` 在 `parentId` 指向一個頂層分類(`parent_id`
      為 null)時,正常建立成功。
- [x] `updateCategory(categoryId, name)` 送出正確的 PATCH,只改 `name`。
- [x] `deleteCategory(categoryId)` 送出正確的 DELETE。
- [x] 私有 `findCategoryOrThrow_(categoryId)` 查無時丟出「找不到分類: {id}」,給
      `createCategory` 的父分類檢查使用。
- [x] 用假的 `httpFetch_` 寫測試涵蓋以上每一條行為。
