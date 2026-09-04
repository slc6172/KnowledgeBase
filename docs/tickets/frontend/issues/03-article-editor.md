# 03 — 文章編輯(建立 / 編輯)

**What to build:** 文章編輯視圖,EasyMDE 驅動的 Markdown 編輯器、分類下拉
(`listCategories`)、標籤自動建議輸入(`listTags`)、存草稿/發布兩個動作,
分別對應 `createArticle`/`updateArticle`/`setArticleStatus`。

**Blocked by:** 01 — Web App 骨架 + 視覺設計系統、categories-tags/01 —
分類/標籤查詢函式

**Status:** done

**驗收方式:** 部署後手動操作、對照下列具體行為。

- [x] 頂部導覽列的「新增文章」按鈕會呼叫 `showView('article-editor')`,進入空白
      的編輯表單(標題空白、內容空白、分類未選、標籤空)。
- [x] 編輯表單的內容欄位是 EasyMDE 編輯器(從 CDN 載入),不是原生
      `<textarea>`,有基本工具列(粗體/連結/清單等)。
- [x] 分類欄位是下拉選單,選項來自 `listCategories()`,子分類要能看出跟哪個
      頂層分類是同一組(例如用縮排或分組顯示,不是攤平成一個沒有層級關係的
      清單)。
- [x] 標籤欄位輸入文字時,依 `listTags()` 的結果做自動建議(fuzzy 比對即可,
      不用要求完全相符),可以選既有標籤、也可以直接打新名稱當新標籤。
- [x] 「存草稿」動作:新文章呼叫 `createArticle`(帶 title/content_md/
      category_id/tag_names);既有文章呼叫 `updateArticle`。存檔後停留在編輯
      畫面(不自動跳轉),並有清楚的「已儲存」提示。
- [x] 「發布」動作:新文章先呼叫 `createArticle` 建立草稿,再呼叫
      `setArticleStatus(id, 'published')`;已經是草稿的既有文章直接呼叫
      `setArticleStatus(id, 'published')`。
- [x] 標題或內容為空時,存草稿/發布動作在呼叫任何 `google.script.run` 之前就
      擋下並顯示提示,不送出無效請求。
- [x] 從文章列表(或詳情頁,视下一張票的實際串接)點擊「編輯」進入本畫面時,
      呼叫 `getArticle(id)` 把標題、內容、分類、標籤全部帶入表單(不是空白
      表單)。
- [x] 存草稿/發布按鈕在請求進行中會 disable,並顯示進行中的文字提示,回應後
      恢復(不會出現使用者連續點兩次導致重複建立文章的情況)。
- [x] 存檔/發布失敗時(`google.script.run` 的 failure handler 觸發),畫面上有
      清楚可見的錯誤訊息,表單內容不會被清空或遺失。
