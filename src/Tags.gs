/**
 * 標籤的查詢(存檔時的 find-or-create 邏輯在 Articles.gs 的 findOrCreateTag_)。
 */
function listTags() {
  return withSafeErrors_('listTags', function () {
    checkPublicReadRateLimit_();
    return supabaseSelect_('tags', 'select=*&order=name.asc');
  });
}

function renameTag_(tagId, newName) {
  if (!newName || String(newName).trim() === '') {
    throw new Error('標籤名稱不能是空白');
  }
  findTagOrThrow_(tagId);
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
  return withSafeErrors_('countTagUsage', function () {
    checkPublicReadRateLimit_();
    var rows = supabaseSelect_('article_tags', eqFilter_('tag_id', tagId) + '&select=article_id');
    return { count: rows.length };
  });
}

function findTagOrThrow_(tagId) {
  var rows = supabaseSelect_('tags', eqFilter_('id', tagId));
  if (!rows || rows.length === 0) {
    throw new Error('找不到標籤: ' + tagId);
  }
  return rows[0];
}

function mergeTags_(sourceTagId, targetTagId) {
  if (sourceTagId === targetTagId) {
    throw new Error('來源與目標標籤不能相同');
  }
  // 兩個 ID 都先確認存在,讓使用者看到清楚的「找不到標籤」而不是通用的資料服務錯誤
  // (資料庫端的 merge_tags 也會檢查並拒絕,這裡是為了好的錯誤訊息,不是唯一的防線;
  // 兩次檢查之間標籤被別人刪除的極小機率情況,由資料庫端的檢查擋下)。
  findTagOrThrow_(sourceTagId);
  findTagOrThrow_(targetTagId);

  // 實際的搬移(同時擁有兩者的文章只刪除指向來源的關聯、其餘改指向目標、最後刪除來源標籤)
  // 全部在資料庫的 merge_tags 函式裡以單一交易完成:任何一步失敗整筆回滾,不會留下
  // 「一半搬完」的狀態。原本由這裡逐篇文章發請求,所以才需要「最多合併幾篇」的上限
  // (避免撞 6 分鐘執行時限);改成單一 SQL 交易後,這個上限已經沒有意義,一併移除。
  var result = supabaseRpc_('merge_tags', {
    source_tag_id: sourceTagId,
    target_tag_id: targetTagId
  });
  // 回傳型別是單一 tags 列:PostgREST 回傳物件;保險起見也接受單元素陣列。
  return Array.isArray(result) ? result[0] : result;
}

if (typeof module !== 'undefined') {
  module.exports = {
    listTags: listTags,
    renameTag_: renameTag_,
    deleteTag_: deleteTag_,
    countTagUsage: countTagUsage,
    mergeTags_: mergeTags_,
    findTagOrThrow_: findTagOrThrow_
  };
}
