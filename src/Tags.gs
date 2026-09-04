/**
 * 標籤的查詢(存檔時的 find-or-create 邏輯在 Articles.gs 的 findOrCreateTag_)。
 */
function listTags() {
  return supabaseSelect_('tags', 'select=*&order=name.asc');
}

function renameTag_(tagId, newName) {
  var updated = supabaseUpdate_('tags', eqFilter_('id', tagId), { name: newName });
  return updated[0];
}

function deleteTag_(tagId) {
  // article_tags 的關聯列交由 schema.sql 既有的 FK cascade 自動清掉,不在
  // GAS 端手動清除(比照 deleteCategory 對 categories/articles FK 的態度)。
  supabaseDelete_('tags', eqFilter_('id', tagId));
  return { deleted: true, id: tagId };
}

// 讀取類函式,不進 Auth.gs 白名單——前端在彈出刪除確認之前呼叫,顯示影響
// 文章數。
function countTagUsage(tagId) {
  var rows = supabaseSelect_('article_tags', eqFilter_('tag_id', tagId) + '&select=article_id');
  return { count: rows.length };
}

function mergeTags_(sourceTagId, targetTagId) {
  if (sourceTagId === targetTagId) {
    throw new Error('來源與目標標籤不能相同');
  }

  var sourceRows = supabaseSelect_('article_tags', eqFilter_('tag_id', sourceTagId));
  var targetRows = supabaseSelect_('article_tags', eqFilter_('tag_id', targetTagId));
  var targetArticleIds = {};
  targetRows.forEach(function (row) {
    targetArticleIds[row.article_id] = true;
  });

  sourceRows.forEach(function (row) {
    var filter = eqFilter_('article_id', row.article_id) + '&' + eqFilter_('tag_id', sourceTagId);
    if (targetArticleIds[row.article_id]) {
      // 這篇文章同時有來源與目標標籤:直接刪掉指向來源的那筆關聯,不能
      // UPDATE(會撞到 (article_id, tag_id) unique constraint)。
      supabaseDelete_('article_tags', filter);
    } else {
      supabaseUpdate_('article_tags', filter, { tag_id: targetTagId });
    }
  });

  supabaseDelete_('tags', eqFilter_('id', sourceTagId));

  var updatedTarget = supabaseSelect_('tags', eqFilter_('id', targetTagId));
  return updatedTarget[0];
}

if (typeof module !== 'undefined') {
  module.exports = {
    listTags: listTags,
    renameTag_: renameTag_,
    deleteTag_: deleteTag_,
    countTagUsage: countTagUsage,
    mergeTags_: mergeTags_
  };
}
