/**
 * 分類的查詢、建立(含 2 層限制)、改名、刪除。
 */
function listCategories() {
  return supabaseSelect_('categories', 'select=*&order=name.asc');
}

function findCategoryOrThrow_(categoryId) {
  var rows = supabaseSelect_('categories', eqFilter_('id', categoryId));
  if (!rows || rows.length === 0) {
    throw new Error('找不到分類: ' + categoryId);
  }
  return rows[0];
}

function createCategory_(name, parentId) {
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
