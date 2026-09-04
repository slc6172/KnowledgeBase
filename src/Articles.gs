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

function getArticle(articleId) {
  var rows = supabaseSelect_(
    'articles',
    eqFilter_('id', articleId) + '&select=*,categories(id,name),article_tags(tags(id,name))'
  );
  if (!rows || rows.length === 0) {
    throw new Error('找不到文章: ' + articleId);
  }
  return normalizeArticleRow_(rows[0]);
}

function createArticle_(data) {
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
  return getArticle(article.id);
}

function listArticles(opts) {
  opts = opts || {};

  if (opts.tagIds && opts.tagIds.length > 0) {
    var matchedIds = filterArticleIdsByTags_(opts.tagIds);
    if (matchedIds.length === 0) return []; // 短路,不用再查一次 articles 表
  }

  var q =
    'select=id,title,status,category_id,created_at,updated_at,' +
    'categories(id,name),article_tags(tags(id,name))';
  q += '&order=updated_at.desc';
  if (opts.status) q += '&' + eqFilter_('status', opts.status);
  if (opts.categoryId) q += '&' + eqFilter_('category_id', opts.categoryId);
  if (opts.tagIds && opts.tagIds.length > 0) q += '&' + inFilter_('id', matchedIds);
  q += '&limit=' + (opts.limit || 50);
  if (opts.offset) q += '&offset=' + opts.offset;

  var rows = supabaseSelect_('articles', q);
  return rows.map(normalizeArticleRow_);
}

/**
 * tag-filter/02:回傳「同時擁有全部 tagIds」的文章 id 陣列(AND 語意),對齊
 * hybrid_search_articles RPC 裡 `having count(distinct tag_id) =
 * array_length(tag_ids, 1)` 的邏輯。用「先查詢、應用層過濾、再查主表」的既有
 * 模式(比照 mergeTags),不新增 SQL 函式。
 */
function filterArticleIdsByTags_(tagIds) {
  var rows = supabaseSelect_(
    'article_tags',
    inFilter_('tag_id', tagIds) + '&select=article_id,tag_id'
  );

  var tagsByArticle = {};
  rows.forEach(function (row) {
    if (!tagsByArticle[row.article_id]) tagsByArticle[row.article_id] = {};
    tagsByArticle[row.article_id][row.tag_id] = true;
  });

  return Object.keys(tagsByArticle).filter(function (articleId) {
    return Object.keys(tagsByArticle[articleId]).length === tagIds.length;
  });
}

function updateArticle_(articleId, data) {
  var patch = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.content_md !== undefined) patch.content_md = data.content_md;
  if (data.category_id !== undefined) patch.category_id = data.category_id;

  if (Object.keys(patch).length > 0) {
    supabaseUpdate_('articles', eqFilter_('id', articleId), patch);
  }
  if (data.tag_names !== undefined) {
    syncArticleTags_(articleId, data.tag_names);
  }
  var article = getArticle(articleId);
  if (
    article.status === 'published' &&
    (data.title !== undefined || data.content_md !== undefined)
  ) {
    regenerateArticleEmbedding_(article);
  }
  return article;
}

function deleteArticle_(articleId) {
  // 先清掉所有附件在 Storage 裡的實體檔案——attachments 資料表那幾筆記錄靠
  // schema.sql 的 FK cascade 自動清掉,但 Storage 裡的檔案不會跟著自動刪除,
  // 不先清會變成永遠佔空間的孤兒檔案。
  var attachments = listAttachments(articleId);
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
}

function setArticleStatus_(articleId, status) {
  if (status !== 'draft' && status !== 'published') {
    throw new Error('status 必須是 draft 或 published');
  }
  supabaseUpdate_('articles', eqFilter_('id', articleId), { status: status });
  var article = getArticle(articleId);
  if (status === 'published') {
    regenerateArticleEmbedding_(article);
  }
  return article;
}

function batchDeleteArticles_(articleIds) {
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
  var succeeded = [];
  var failed = [];
  articleIds.forEach(function (id) {
    try {
      // 不透過 updateArticle——那個函式的 embedding 重新產生判斷式只看
      // title/content_md,直接更新 category_id 更單純,也不用傳一堆不相關的
      // undefined 欄位。
      supabaseUpdate_('articles', eqFilter_('id', id), { category_id: categoryId });
      succeeded.push(id);
    } catch (e) {
      failed.push({ id: id, message: e.message });
    }
  });
  return { succeeded: succeeded, failed: failed };
}

function batchAddTagsToArticles_(articleIds, tagNames) {
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
    filterArticleIdsByTags_: filterArticleIdsByTags_,
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
