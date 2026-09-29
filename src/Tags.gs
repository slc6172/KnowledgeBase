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

// mergeTags_ 對來源標籤底下每一篇文章都會發出對應數量的 Supabase 請求,理由
// 跟 Articles.gs 的 BATCH_OPERATION_MAX_ITEMS_ 一樣——一次處理太多篇文章有
// 機會撞到 Apps Script 6 分鐘執行上限,中途被砍掉只留下部分合併的狀態
// (2026-09 這輪 /mycr 複查才第一次被問出來,三個批次操作函式當時已經有這層
// 保護,mergeTags_ 沒有跟著套用)。刻意用獨立的常數,不直接共用
// BATCH_OPERATION_MAX_ITEMS_:兩者語意不同(這裡限制的是「來源標籤目前掛在
// 幾篇文章上」,不是呼叫端直接傳入的陣列長度),用同一個變數容易在以後各自
// 調整時互相牽連。
var TAG_MERGE_MAX_ARTICLES_ = 200;

function mergeTags_(sourceTagId, targetTagId) {
  if (sourceTagId === targetTagId) {
    throw new Error('來源與目標標籤不能相同');
  }
  // 兩個 ID 都先確認存在——跟 deleteTag_ 刻意不驗證存在性是不同情境:
  // deleteTag_ 刪掉不存在的東西是無害的空操作,但這裡最後要回傳「合併後的
  // 目標標籤」,如果目標標籤根本不存在,原本會在跑完整個迴圈之後才發現
  // 「其實什麼都沒有」、回傳 undefined,不是清楚的錯誤訊息。
  findTagOrThrow_(sourceTagId);
  findTagOrThrow_(targetTagId);

  var sourceRows = supabaseSelect_('article_tags', eqFilter_('tag_id', sourceTagId));
  if (sourceRows.length > TAG_MERGE_MAX_ARTICLES_) {
    throw new Error(
      '來源標籤目前掛在超過 ' + TAG_MERGE_MAX_ARTICLES_ + ' 篇文章上,無法一次合併,請聯絡開發者調整上限'
    );
  }

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
    mergeTags_: mergeTags_,
    findTagOrThrow_: findTagOrThrow_,
    TAG_MERGE_MAX_ARTICLES_: TAG_MERGE_MAX_ARTICLES_
  };
}
