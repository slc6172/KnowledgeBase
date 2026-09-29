/**
 * 分類的查詢、建立(含 2 層限制)、改名、刪除。
 */
function listCategories() {
  return withSafeErrors_('listCategories', function () {
    checkPublicReadRateLimit_();
    return supabaseSelect_('categories', 'select=*&order=name.asc');
  });
}

function findCategoryOrThrow_(categoryId) {
  var rows = supabaseSelect_('categories', eqFilter_('id', categoryId));
  if (!rows || rows.length === 0) {
    throw new Error('找不到分類: ' + categoryId);
  }
  return rows[0];
}

function createCategory_(name, parentId) {
  // 跟 articles.title 同一類「空字串滿足 NOT NULL」的洞(細節見 README 已知
  // 問題修復紀錄)——前端表單已經擋過一次,這裡是後端自己也要正確,不依賴
  // 前端有沒有做防護。
  if (!name || String(name).trim() === '') {
    throw new Error('分類名稱不能是空白');
  }
  if (parentId) {
    var parent = findCategoryOrThrow_(parentId);
    if (parent.parent_id) {
      throw new Error('分類最多只能有 2 層,不能在子分類底下再建立子分類');
    }
  }
  var inserted = supabaseInsert_('categories', [{ name: name, parent_id: parentId || null }]);
  return inserted[0];
}

function updateCategory_(categoryId, name) {
  if (!name || String(name).trim() === '') {
    throw new Error('分類名稱不能是空白');
  }
  findCategoryOrThrow_(categoryId);
  var updated = supabaseUpdate_('categories', eqFilter_('id', categoryId), { name: name });
  return updated[0];
}

function deleteCategory_(categoryId) {
  // 子分類與參照此分類的文章都靠 schema.sql 的 on delete set null FK 自動清掉,
  // 這裡只需要刪 categories 那筆。
  supabaseDelete_('categories', eqFilter_('id', categoryId));
  return { deleted: true, id: categoryId };
}

function moveCategory_(categoryId, newParentId) {
  if (!newParentId) {
    // 逐行語意校對才第一次發現的落差(2026-09):這個分支原本沒有先驗證
    // categoryId 存在,跟下面「移到某個父分類底下」那個分支不對稱——那個
    // 分支一開始就呼叫了 findCategoryOrThrow_(categoryId)。categoryId 不
    // 存在時,supabaseUpdate_ 對 PostgREST 送出的 PATCH 會 match 到 0 筆,
    // 回傳空陣列,updated[0] 就是 undefined,不是清楚的錯誤訊息——跟
    // mergeTags_ 原本那個「目標不存在時靜默回傳 undefined」是同一類問題
    // (見 README 已知問題修復紀錄第 50 條)。這裡不是要跟 deleteCategory_/
    // deleteTag_ 刻意不驗證存在性的設計唱反調(那兩個刪除操作,刪不存在的
    // 東西是無害的空操作);這裡是要「回傳更新後的分類」,目標不存在時就該
    // 是清楚的錯誤,不是回傳 undefined。
    findCategoryOrThrow_(categoryId);
    var updated = supabaseUpdate_('categories', eqFilter_('id', categoryId), { parent_id: null });
    return updated[0];
  }

  if (categoryId === newParentId) {
    throw new Error('不能把分類移動到自己底下');
  }

  findCategoryOrThrow_(categoryId);
  var newParent = findCategoryOrThrow_(newParentId);
  if (newParent.parent_id) {
    throw new Error('分類最多只能有 2 層,不能移動到子分類底下');
  }

  var children = supabaseSelect_('categories', eqFilter_('parent_id', categoryId));
  if (children && children.length > 0) {
    throw new Error('這個分類底下還有子分類,無法移動到別的分類底下');
  }

  var moved = supabaseUpdate_('categories', eqFilter_('id', categoryId), { parent_id: newParentId });
  return moved[0];
}

if (typeof module !== 'undefined') {
  module.exports = {
    listCategories: listCategories,
    createCategory_: createCategory_,
    updateCategory_: updateCategory_,
    deleteCategory_: deleteCategory_,
    moveCategory_: moveCategory_,
    findCategoryOrThrow_: findCategoryOrThrow_
  };
}
