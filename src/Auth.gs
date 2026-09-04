/**
 * 共用密碼守門員。寫入類操作(建立/編輯/刪除文章、附件、分類)一律經過
 * callProtected(password, functionName, args)——前端所有寫入類的
 * google.script.run 呼叫都改成呼叫這個函式,不再直接呼叫下面的白名單函式本身。
 * RagChat.gs 的 askKnowledgeBase 是讀取類操作,不在白名單裡、不經過
 * callProtected,但仍需要驗證密碼,共用同一份 isValidWritePassword_ 判斷式。
 * 讀取類函式(listArticles、getArticle、listAttachments、
 * getSignedAttachmentUrl、getTextAttachmentContent、listCategories、listTags、
 * countTagUsage、searchArticles、getRelatedArticles)完全不經過這裡,任何人都
 * 能直接呼叫,對應「未登入則僅能閱讀」。
 */
function getWritePassword_() {
  var value = PropertiesService.getScriptProperties().getProperty('WRITE_PASSWORD');
  value = value ? value.trim() : value;
  if (!value) {
    throw new Error('缺少 Script Property: WRITE_PASSWORD(尚未設定寫入密碼,無法使用任何寫入功能)');
  }
  return value;
}

/**
 * 白名單:只有這 20 個寫入類函式能透過 callProtected 呼叫,刻意不用
 * this[functionName]/globalThis[functionName] 這種動態呼叫任意全域函式的寫法——
 * 白名單以外一律視為不支援的操作,即使是本專案裡的其他函式(例如讀取類的
 * listArticles)也不行,呼叫端一定要走各自對應的公開函式。
 */
function dispatchProtectedCall_(functionName, args) {
  switch (functionName) {
    case 'createArticle':
      return createArticle_.apply(null, args);
    case 'updateArticle':
      return updateArticle_.apply(null, args);
    case 'deleteArticle':
      return deleteArticle_.apply(null, args);
    case 'setArticleStatus':
      return setArticleStatus_.apply(null, args);
    case 'uploadAttachmentFile':
      return uploadAttachmentFile_.apply(null, args);
    case 'addAttachmentUrl':
      return addAttachmentUrl_.apply(null, args);
    case 'deleteAttachment':
      return deleteAttachment_.apply(null, args);
    case 'createFolder':
      return createFolder_.apply(null, args);
    case 'renameFolder':
      return renameFolder_.apply(null, args);
    case 'deleteFolder':
      return deleteFolder_.apply(null, args);
    case 'createCategory':
      return createCategory_.apply(null, args);
    case 'updateCategory':
      return updateCategory_.apply(null, args);
    case 'moveCategory':
      return moveCategory_.apply(null, args);
    case 'deleteCategory':
      return deleteCategory_.apply(null, args);
    case 'renameTag':
      return renameTag_.apply(null, args);
    case 'deleteTag':
      return deleteTag_.apply(null, args);
    case 'mergeTags':
      return mergeTags_.apply(null, args);
    case 'batchDeleteArticles':
      return batchDeleteArticles_.apply(null, args);
    case 'batchSetArticlesCategory':
      return batchSetArticlesCategory_.apply(null, args);
    case 'batchAddTagsToArticles':
      return batchAddTagsToArticles_.apply(null, args);
    default:
      throw new Error('不支援的操作: ' + functionName);
  }
}

/**
 * 密碼是否正確——只回傳 boolean,不拋出「密碼錯誤」(拋錯是呼叫端的責任,
 * 不是這個判斷式本身)。若 WRITE_PASSWORD 這個 Script Property 本身沒設定,
 * getWritePassword_() 會丟出對應的設定錯誤,這裡不吞掉,原樣往外傳——那是
 * 環境設定問題,跟「密碼答錯」是兩回事。
 *
 * callProtected(寫入白名單)跟 RagChat.gs 的 askKnowledgeBase(讀取類但仍需
 * 密碼)共用這個判斷式,避免兩處密碼比對邏輯各自維護、以後改規則(例如要不要
 * trim、大小寫)容易不同步。
 */
function isValidWritePassword_(password) {
  return password === getWritePassword_();
}

function callProtected(password, functionName, args) {
  if (!isValidWritePassword_(password)) {
    throw new Error('密碼錯誤');
  }
  return dispatchProtectedCall_(functionName, args || []);
}

if (typeof module !== 'undefined') {
  module.exports = {
    callProtected: callProtected,
    getWritePassword_: getWritePassword_,
    isValidWritePassword_: isValidWritePassword_
  };
}
