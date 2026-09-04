# 04 — 文章詳情 + 附件上傳/列表/刪除

**What to build:** 文章詳情視圖——渲染文章內容(marked.js)、狀態徽記、編輯
入口、附件清單(`listAttachments`)、上傳檔案(`uploadAttachmentFile`)/新增
URL(`addAttachmentUrl`)、刪除附件(`deleteAttachment`)。這張票的附件一律用
「檔名/連結 + 下載連結」通用呈現,四種型別的實際線上預覽(iframe/Google Docs
Viewer/語法高亮/Markdown 渲染)是下一張票的範圍。

**Blocked by:** 01 — Web App 骨架 + 視覺設計系統、02 — 文章列表 + 搜尋(需要從
列表卡片點擊進入,並把上一張票留的「id 傳遞、佔位內容」補成真正的詳情渲染)

**Status:** done

**驗收方式:** 部署後手動操作、對照下列具體行為。

- [x] 從文章列表點卡片進入詳情視圖時,呼叫 `getArticle(id)`,渲染標題、狀態
      徽記(`.seal--published`/`.seal--draft`)、分類、標籤、更新時間。
- [x] 文章內容用 `marked.parse(content_md)` 渲染成 HTML 顯示,不是顯示原始
      Markdown 語法符號。
- [x] 詳情頁有「編輯」按鈕,點擊後呼叫 `showView('article-editor')` 並帶入該
      文章 id(串上前一張票已經做好的編輯畫面預填邏輯)。
- [x] 進入詳情視圖時呼叫 `listAttachments(articleId)`,列出所有附件,每筆顯示
      型別、檔名(或 URL 型附件的 label/url)、刪除按鈕。
- [x] 附件清單為空時顯示明確的「還沒有附件」提示。
- [x] 有一個「上傳檔案」控制項:選檔案後,前端把檔案讀成 base64(用
      `FileReader.readAsDataURL` 去掉 `data:...;base64,` 前綴)、呼叫
      `uploadAttachmentFile(articleId, fileName, base64Data, mimeType)`;上傳中
      按鈕 disable、顯示「上傳中...」文字(不是真的進度條,對應 F4 決策);
      成功後附件清單即時更新(重新呼叫 `listAttachments` 或直接把回傳的新記錄
      加進畫面上的清單,不用整頁重新整理)。
- [x] 有一個「加入連結」控制項:輸入 URL 與可選的顯示文字,呼叫
      `addAttachmentUrl(articleId, url, label)`,成功後附件清單即時更新。
- [x] 點擊附件的刪除按鈕會呼叫 `deleteAttachment(attachmentId)`,成功後該筆
      附件立刻從畫面上的清單移除。
- [x] 上傳/新增連結/刪除任一動作失敗時,畫面上有清楚可見的錯誤訊息。
- [x] 這張票的每筆附件一律顯示「檔名(或 URL)+ 下載連結」,不需要也不應該
      呼叫 `getSignedAttachmentUrl`/`getTextAttachmentContent`(那是下一張票的
      範圍)。
