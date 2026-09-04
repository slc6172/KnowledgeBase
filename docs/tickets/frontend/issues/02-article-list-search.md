# 02 — 文章列表 + 搜尋

**What to build:** 文章列表視圖串上 `listArticles`/`searchArticles`,搜尋列常駐在
列表最上方,搜尋結果直接取代列表內容。每張卡片顯示標題、分類、標籤、內容摘要、
更新時間、草稿/發布徽記。

**Blocked by:** 01 — Web App 骨架 + 視覺設計系統

**Status:** done

**驗收方式:** 部署後手動操作、對照下列具體行為。

- [x] 開啟 Web App、進入文章列表視圖時,自動呼叫 `listArticles`(預設只列
      `status=published`)並渲染結果,不需要使用者先做任何操作。
- [x] 每張卡片顯示:標題、分類名稱(沒有分類時顯示「未分類」而不是空白或
      `null`)、標籤清單、`content_md` 前 100 字左右的摘要(超過長度加刪節號)、
      `updated_at`(格式化成好讀的日期,不是原始 ISO 字串)、對應的
      `.seal--published`/`.seal--draft` 徽記。
- [x] 頁面最上方有一個常駐搜尋輸入框;輸入文字並送出(Enter 或按鈕)後呼叫
      `searchArticles`,結果**取代**目前列表內容(不是另開新視圖、也不是疊加
      在列表下方)。
- [x] 清空搜尋框並重新送出(或有一個「清除搜尋」動作)會回到呼叫
      `listArticles` 的預設列表。
- [x] 搜尋或列表查詢中發生錯誤(`google.script.run` 的 failure handler 觸發)時,
      畫面上有清楚可見的錯誤訊息,不是只在瀏覽器 console 印出來。
- [x] `listArticles`/`searchArticles` 回傳空陣列時,畫面顯示明確的「沒有符合的
      文章」空狀態,不是空白一片。
- [x] 點擊任一張卡片會呼叫 `showView('article-detail')` 並把該文章的 id 傳給
      詳情視圖(這張票只需要做到「切換視圖 + 傳 id」,詳情視圖本身的實際渲染
      是下一張票的範圍;暫時可以先讓詳情視圖顯示「文章 id: {id}」這種最簡單的
      佔位內容來驗證傳遞有生效)。
- [x] 觸發查詢/搜尋的按鈕在請求進行中會 disable,回應後恢復。
