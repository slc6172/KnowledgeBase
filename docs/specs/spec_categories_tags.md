---
title: 分類與標籤查詢後端補完
status: ready-for-agent
date: 2026-08-15
project: GAS + Supabase 個人知識庫
depends_on: schema.sql、spec_gas_backend.md(已完成,本 spec 是它当初 Out of Scope 留下的缺口)
---

# 分類與標籤查詢後端補完 — Spec

## Problem Statement

`spec_gas_backend.md` 當初明確把「分類管理 CRUD」與「標籤管理 CRUD(find-or-create
以外的操作)」列為 Out of Scope。現在要拆 GAS 前端頁面,其中「分類管理」畫面跟
「文章編輯頁的標籤自動建議」都需要目前後端沒有的函式:列出所有分類、建立/改名/
刪除分類、列出所有標籤。這是前端把畫面畫出來之前一定要先補上的缺口。

## Solution

新增 `Categories.gs`(`listCategories`、`createCategory`、`updateCategory`、
`deleteCategory`)與 `Tags.gs`(`listTags`)。分類的 2 層限制(DESIGN.md 決策 #4)
在 `createCategory` 裡用程式檢查,不是 DB constraint。

## User Stories

1. As a knowledge-base user, I want `listCategories()` to return all categories
   ordered by name, so the article editor and category management view can render a
   picker/tree.
2. As a knowledge-base user, I want `createCategory(name, parentId)` to create a new
   category, so I can organize articles into (up to 2-level) groups.
3. As a knowledge-base user, I want creating a category whose `parentId` itself already
   has a parent to fail with a clear error, so the 2-level limit is enforced instead of
   silently allowing a 3rd level.
4. As a knowledge-base user, I want creating a top-level category (`parentId` omitted)
   to just work, no special-casing needed on the caller's side.
5. As a knowledge-base user, I want `updateCategory(categoryId, name)` to rename a
   category, so I can fix a typo or reword it later.
6. As a knowledge-base user, I want `deleteCategory(categoryId)` to remove a category,
   so I can clean up ones I no longer need.
7. As a knowledge-base user, I want articles that referenced a deleted category to
   simply lose that reference (become uncategorized) rather than being deleted
   themselves, and child categories of a deleted parent to become top-level rather than
   being deleted — both already guaranteed by `schema.sql`'s `on delete set null`
   foreign keys, so `deleteCategory` doesn't need to do any extra cleanup work itself.
8. As a knowledge-base user, I want `listTags()` to return all tags ordered by name, so
   the article editor's tag autocomplete has something to match against.

## Implementation Decisions

- `Categories.gs`: `listCategories`、`createCategory`、`updateCategory`、
  `deleteCategory`,私有的 `findCategoryOrThrow_`(跟 `Attachments.gs` 的
  `findAttachmentOrThrow_`同樣的模式:查無時丟出「找不到分類: {id}」)。
- `createCategory` 的 2 層檢查:若 `parentId` 有值,先用 `findCategoryOrThrow_`
  查出該分類;若那筆分類自己的 `parent_id` 不是 null(代表它自己已經是子分類),
  就 throw「分類最多只能有 2 層」,不呼叫 insert。
- `updateCategory` 只改 `name`,不支援重新指定 `parentId`(換父分類是更複雜的操作,
  目前的畫面需求沒有用到,不在這次範圍內)。
- `Tags.gs`:`listTags()`,單純的 `supabaseSelect('tags', 'select=*&order=name.asc')`,
  不需要額外邏輯。
- 這兩個檔案都跟既有的 `Articles.gs`/`Attachments.gs` 一樣建立在
  `SupabaseClient.gs` 之上,沒有新的接縫。

## Testing Decisions

延續既有模式:透過假的 `httpFetch_` 驗證行為。

**關鍵測試情境**
1. `listCategories`/`listTags` 組出正確的 query string(`select=*&order=name.asc`)。
2. `createCategory` 沒帶 `parentId` 時直接 insert 成功。
3. `createCategory` 帶的 `parentId` 指向一個本身就是子分類(`parent_id` 不是
   null)的分類時,throw 且不呼叫 insert。
4. `createCategory` 帶的 `parentId` 指向一個頂層分類(`parent_id` 是 null)時,
   正常 insert 成功。
5. `updateCategory`/`deleteCategory` 送出正確的 PATCH/DELETE 請求。
6. `findCategoryOrThrow_` 查無時丟出清楚錯誤(用在 `createCategory` 的父分類檢查、
   之後也可能被其他函式重用)。

## Out of Scope

- 分類重新指定父分類(換層級)。
- 標籤改名/刪除/合併——`listTags` 只是查詢,既有的 `findOrCreateTag_`(存檔時
  自動建立)維持不變。
- 前端的分類樹狀 UI 呈現——這是 GAS 前端 spec 的工作。
