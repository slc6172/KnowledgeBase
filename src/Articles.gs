/**
 * 文章的建立、編輯、查詢、刪除,以及標籤同步邏輯。
 * 全部建立在 SupabaseClient.gs 之上,不直接碰 httpFetch_/UrlFetchApp。
 */
function findOrCreateTag_(name) {
  var existing = supabaseSelect_('tags', eqFilter_('name', name));
  if (existing.length > 0) {
    return existing[0];
  }
  var inserted = supabaseInsert_('tags', [{ name: name }]);
  return inserted[0];
}

function syncArticleTags_(articleId, tagNames) {
  var tagIds = tagNames.map(function (name) {
    return findOrCreateTag_(name).id;
  });
  supabaseDelete_('article_tags', eqFilter_('article_id', articleId));
  if (tagIds.length > 0) {
    var rows = tagIds.map(function (tagId) {
      return { article_id: articleId, tag_id: tagId };
    });
    supabaseInsert_('article_tags', rows);
  }
}

function normalizeArticleRow_(row) {
  row.tags = (row.article_tags || []).map(function (at) {
    return at.tags;
  });
  delete row.article_tags;
  return row;
}

/**
 * 跟公開的 getArticle 讀同一筆資料(同一個 select,含 categories/article_tags join),
 * 但不套用 checkPublicReadRateLimit_——只給寫入路徑內部呼叫用。公開的 getArticle
 * 對外行為(節流、回傳形狀)不變,只是內部改委派給這個函式(mycr F-01 修正:寫入路徑
 * 內部讀取原本會被匿名訪客用掉的節流額度牽連,見 docs/specs/spec_article_write_consistency.md)。
 */
function getArticleRowInternal_(articleId) {
  var rows = supabaseSelect_(
    'articles',
    eqFilter_('id', articleId) + '&select=*,categories(id,name),article_tags(tags(id,name))'
  );
  if (!rows || rows.length === 0) {
    throw new Error('找不到文章: ' + articleId);
  }
  return normalizeArticleRow_(rows[0]);
}

function getArticle(articleId) {
  return withSafeErrors_('getArticle', function () {
    // 這裡刻意不區分「訪客直接呼叫」還是「createArticle_/updateArticle_ 寫入後
    // 內部呼叫回來確認結果」兩種情境,都算進同一個每小時額度——2000 次/小時的
    // 額度對正常編輯操作來說很寬鬆,不會真的卡到擁有者自己,拆成兩條路徑分開
    // 計算沒有對應的實際好處,反而增加複雜度。
    checkPublicReadRateLimit_();
    return getArticleRowInternal_(articleId);
  });
}

function createArticle_(data) {
  // title 是 NOT NULL 欄位,但「空字串」一樣滿足 NOT NULL,DB 端接不住這個
  // 情況,需要應用層自己擋(細節見 README 已知問題修復紀錄)。
  if (!data.title || String(data.title).trim() === '') {
    throw new Error('文章標題不能是空白');
  }
  var row = {
    title: data.title,
    content_md: data.content_md,
    category_id: data.category_id || null,
    status: 'draft'
  };
  var inserted = supabaseInsert_('articles', [row]);
  var article = inserted[0];
  if (data.tag_names && data.tag_names.length > 0) {
    syncArticleTags_(article.id, data.tag_names);
  }
  return getArticleRowInternal_(article.id);
}

function listArticles(opts) {
  return withSafeErrors_('listArticles', function () {
    checkPublicReadRateLimit_();
    opts = opts || {};

    // limit/offset 語意上不是過濾條件，不能套用 eqFilter_，但一樣是呼叫端可控值，
    // 字串相加組進 URL 有一樣的注入風險（細節見 README 已知問題修復紀錄）。強制
    // 轉成 Number：轉換失敗（非數字字串、undefined）會得到 NaN，NaN 是 falsy，
    // 落回預設值/跳過，順便處理了「傳入非數字」這個原本沒管的邊界情況。
    var limit = Number(opts.limit) || 50;
    var offset = Number(opts.offset);

    if (opts.tagIds && opts.tagIds.length > 0) {
      return listArticlesByTags_(opts, limit, offset);
    }

    var q =
      'select=id,title,status,category_id,created_at,updated_at,' +
      'categories(id,name),article_tags(tags(id,name))';
    q += '&order=updated_at.desc';
    if (opts.status) q += '&' + eqFilter_('status', opts.status);
    if (opts.categoryId) q += '&' + eqFilter_('category_id', opts.categoryId);
    q += '&limit=' + limit;
    if (offset) q += '&offset=' + offset;

    var rows = supabaseSelect_('articles', q);
    return rows.map(normalizeArticleRow_);
  });
}

/**
 * tag-filter/03(mycr F-04 修正,見 docs/specs/spec_tag_filter_pagination.md）：
 * 篩選跟分頁都交給 docs/schema.sql 的 articles_by_tags RPC 在 SQL 端完成——
 * 原本的寫法是先撈出「同時擁有全部標籤」的全部文章 id（沒有上限），再把這些
 * id 全部塞進網址，符合條件的文章一多就會超過 UrlFetchApp 的網址長度上限。
 * 改成兩段式（比照 Search.gs 的 searchArticles 對 hybrid_search_articles
 * 的既有做法）：第一段呼叫 RPC 拿到「這一頁」（已經篩選/排序/分頁過）的裸
 * articles.* 列，第二段用 inFilter_ 對這一頁的 id 額外查一次 join 資料——
 * 第二段的 id 數量上限就是這次請求的 limit（頁面大小，通常遠低於網址長度
 * 會出問題的門檻），不會再跟著「總共符合條件的文章數」一起變大。
 */
function listArticlesByTags_(opts, limit, offset) {
  var rpcArgs = { tag_ids: uniqueValues_(opts.tagIds), lim: limit };
  if (opts.status) rpcArgs.status_filter = opts.status;
  if (opts.categoryId) rpcArgs.category_id_filter = opts.categoryId;
  if (offset) rpcArgs.off = offset;

  var pageRows = supabaseRpc_('articles_by_tags', rpcArgs);
  if (!pageRows || pageRows.length === 0) return [];

  var pageIds = pageRows.map(function (row) { return row.id; });
  var enrichedRows = supabaseSelect_(
    'articles',
    inFilter_('id', pageIds) +
      '&select=id,title,status,category_id,created_at,updated_at,' +
      'categories(id,name),article_tags(tags(id,name))'
  );
  var byId = {};
  enrichedRows.forEach(function (row) { byId[row.id] = row; });
  // 依 RPC 回傳的順序（已經是 updated_at desc）重新排列，不是補查回來的順序
  // ——PostgREST 的 in.() 過濾不保證回傳順序會跟傳入的 id 順序一樣。
  return pageIds
    .map(function (id) { return byId[id]; })
    .filter(function (row) { return row !== undefined; })
    .map(normalizeArticleRow_);
}

function uniqueValues_(values) {
  var seen = {};
  var result = [];
  values.forEach(function (v) {
    if (!seen[v]) {
      seen[v] = true;
      result.push(v);
    }
  });
  return result;
}

function updateArticle_(articleId, data) {
  var patch = {};
  if (data.title !== undefined) {
    // 同一顆「title 不能空白」的擋法(見 createArticle_ 上方的註解)——這裡是
    // 「使用者主動把標題清空」的情況,跟「呼叫端根本沒帶 title」(data.title
    // === undefined,不動這個欄位)要分開處理。
    if (!data.title || String(data.title).trim() === '') {
      throw new Error('文章標題不能是空白');
    }
    patch.title = data.title;
  }
  if (data.content_md !== undefined) patch.content_md = data.content_md;
  if (data.category_id !== undefined) patch.category_id = data.category_id;

  if (data.title !== undefined || data.content_md !== undefined) {
    // 這次編輯有碰到標題或內文,一定要先知道文章目前是不是已發布,才能決定要不要
    // 重新產生 embedding,而且必須在任何寫入發生之前就先知道——不然又會回到
    // 「先寫入、Gemini 才失敗」的舊問題(mycr F-01 修正,見
    // docs/specs/spec_article_write_consistency.md)。這次讀取不管文章結果是不是
    // 已發布都要花,是修正這個問題無法避免的代價;這個讀取同時也是存在性檢查
    // (文章不存在會在這裡就拋出「找不到文章」,而不是等寫入之後才發現)。
    var current = getArticleRowInternal_(articleId);
    if (current.status === 'published') {
      var mergedTitle = data.title !== undefined ? data.title : current.title;
      var mergedContentMd = data.content_md !== undefined ? data.content_md : current.content_md;
      // 在碰資料庫之前就先呼叫 Gemini——Gemini 失敗時直接往外拋,這裡完全不會
      // 執行到下面的 supabaseUpdate_,不會留下「內容已經改了但 embedding 沒更新」
      // 的部分提交狀態。
      patch.embedding = generateEmbedding_(mergedTitle + '\n\n' + mergedContentMd);
    }
    supabaseUpdate_('articles', eqFilter_('id', articleId), patch);
  } else if (Object.keys(patch).length > 0) {
    supabaseUpdate_('articles', eqFilter_('id', articleId), patch);
  }

  if (data.tag_names !== undefined) {
    syncArticleTags_(articleId, data.tag_names);
  }
  return getArticleRowInternal_(articleId);
}

function deleteArticle_(articleId) {
  return withSafeErrors_('deleteArticle_', function () {
    // 先清掉所有附件在 Storage 裡的實體檔案——attachments 資料表那幾筆記錄靠
    // schema.sql 的 FK cascade 自動清掉,但 Storage 裡的檔案不會跟著自動刪除,
    // 不先清會變成永遠佔空間的孤兒檔案。
    var attachments = listAttachmentRowsInternal_(articleId);
    attachments.forEach(function (att) {
      if (att.file_path) {
        try {
          storageDelete_('attachments', att.file_path);
        } catch (e) {
          // 單一附件的 Storage 刪除失敗不中斷整個刪除流程——寧可留下一個孤兒
          // 檔案,也不要卡住使用者刪文章這個動作。
        }
      }
    });
    supabaseDelete_('articles', eqFilter_('id', articleId));
    return { deleted: true, id: articleId };
  });
}

function setArticleStatus_(articleId, status) {
  if (status !== 'draft' && status !== 'published') {
    throw new Error('status 必須是 draft 或 published');
  }
  if (status === 'published') {
    // 發布一定會觸發重新產生 embedding,必須在任何寫入發生之前就先讀取目前的
    // 標題/內文、算好 Gemini 的結果——不然又會回到「狀態已經寫成已發布、
    // Gemini 才失敗」的舊問題(mycr F-01 修正,見
    // docs/specs/spec_article_write_consistency.md)。這個內部讀取同時也是
    // 存在性檢查。
    var current = getArticleRowInternal_(articleId);
    var embedding = generateEmbedding_(current.title + '\n\n' + current.content_md);
    supabaseUpdate_('articles', eqFilter_('id', articleId), { status: status, embedding: embedding });
  } else {
    // 取消發布不涉及 embedding,維持「先寫入、再讀回」的原順序——沒有部分
    // 提交的風險,不需要重新排序。
    supabaseUpdate_('articles', eqFilter_('id', articleId), { status: status });
  }
  return getArticleRowInternal_(articleId);
}

// 批次操作(刪除/搬分類/加標籤)的單次上限。這三個函式對每個 id 都會發出
// 對應數量的 Supabase/Storage 請求,一次傳太大的陣列有機會撞到 Apps Script
// 6 分鐘執行上限,中途被砍掉只留下部分完成的狀態——設一個上限,超過就直接
// 拒絕,不要讓呼叫端無限放大單次批次(細節見 README 已知問題修復紀錄)。
var BATCH_OPERATION_MAX_ITEMS_ = 200;

function batchDeleteArticles_(articleIds) {
  if (articleIds.length > BATCH_OPERATION_MAX_ITEMS_) {
    throw new Error('單次批次最多 ' + BATCH_OPERATION_MAX_ITEMS_ + ' 篇文章,請分批操作');
  }
  var succeeded = [];
  var failed = [];
  articleIds.forEach(function (id) {
    try {
      deleteArticle_(id);
      succeeded.push(id);
    } catch (e) {
      failed.push({ id: id, message: e.message });
    }
  });
  return { succeeded: succeeded, failed: failed };
}

function batchSetArticlesCategory_(articleIds, categoryId) {
  if (articleIds.length > BATCH_OPERATION_MAX_ITEMS_) {
    throw new Error('單次批次最多 ' + BATCH_OPERATION_MAX_ITEMS_ + ' 篇文章,請分批操作');
  }
  var succeeded = [];
  var failed = [];
  articleIds.forEach(function (id) {
    try {
      // 不透過 updateArticle——那個函式的 embedding 重新產生判斷式只看
      // title/content_md,直接更新 category_id 更單純,也不用傳一堆不相關的
      // undefined 欄位。
      var updated = supabaseUpdate_('articles', eqFilter_('id', id), { category_id: categoryId });
      if (!updated || updated.length === 0) {
        // PostgREST 對 PATCH 到不存在的 id 不會回錯誤,只會回空陣列——不檢查
        // 這個的話,不存在的 id 會被誤報成「成功」,即使實際上什麼都沒被更新
        // (跟 updateCategory_/renameTag_/renameFolder_ 是同一類「靜默 no-op」
        // 問題,這裡是批次操作的對應版本)。
        throw new Error('找不到文章: ' + id);
      }
      succeeded.push(id);
    } catch (e) {
      failed.push({ id: id, message: e.message });
    }
  });
  return { succeeded: succeeded, failed: failed };
}

function batchAddTagsToArticles_(articleIds, tagNames) {
  if (articleIds.length > BATCH_OPERATION_MAX_ITEMS_) {
    throw new Error('單次批次最多 ' + BATCH_OPERATION_MAX_ITEMS_ + ' 篇文章,請分批操作');
  }
  if (tagNames.length > BATCH_OPERATION_MAX_ITEMS_) {
    throw new Error('單次批次最多 ' + BATCH_OPERATION_MAX_ITEMS_ + ' 個標籤,請分批操作');
  }
  var tagIds = tagNames.map(function (name) {
    return findOrCreateTag_(name).id;
  });

  var succeeded = [];
  var failed = [];
  articleIds.forEach(function (articleId) {
    try {
      var existingRows = supabaseSelect_('article_tags', eqFilter_('article_id', articleId));
      var existingTagIds = {};
      existingRows.forEach(function (row) {
        existingTagIds[row.tag_id] = true;
      });

      var missingRows = tagIds
        .filter(function (tagId) {
          return !existingTagIds[tagId];
        })
        .map(function (tagId) {
          return { article_id: articleId, tag_id: tagId };
        });

      if (missingRows.length > 0) {
        supabaseInsert_('article_tags', missingRows);
      }
      succeeded.push(articleId);
    } catch (e) {
      failed.push({ id: articleId, message: e.message });
    }
  });
  return { succeeded: succeeded, failed: failed };
}

if (typeof module !== 'undefined') {
  module.exports = {
    findOrCreateTag_: findOrCreateTag_,
    syncArticleTags_: syncArticleTags_,
    normalizeArticleRow_: normalizeArticleRow_,
    uniqueValues_: uniqueValues_,
    getArticle: getArticle,
    createArticle_: createArticle_,
    listArticles: listArticles,
    updateArticle_: updateArticle_,
    deleteArticle_: deleteArticle_,
    setArticleStatus_: setArticleStatus_,
    batchDeleteArticles_: batchDeleteArticles_,
    batchSetArticlesCategory_: batchSetArticlesCategory_,
    batchAddTagsToArticles_: batchAddTagsToArticles_
  };
}
