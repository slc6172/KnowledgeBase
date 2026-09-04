# 01 — 共用標籤選取元件 + 套用到文章編輯頁

**What to build:** `JavaScript.html` 新增共用函式 `buildTagPicker(container,
options)`,同時支援 `options.mode: 'edit'`(自由輸入 + 自動建議 + 建立新標籤,
外加展開瀏覽既有標籤清單可勾選)跟 `options.mode: 'filter'`(只能展開瀏覽/
勾選既有標籤,不渲染文字輸入框、不能建立新標籤)。這張票只把 `edit` 模式接進
文章編輯頁的 `editor-tag-input`,取代原本手刻的輸入邏輯;`filter` 模式這張票
就要做出來(供之後 `tag-filter` 系列票直接使用),但不用在這張票裡實際掛到
任何畫面上。

**Blocked by:** 無,可立即開始

**Status:** ready-for-agent

- [ ] `buildTagPicker(container, options)` 接受 `options.mode`(預設
      `'edit'`)、`options.selectedTagIds`(初始已選取的標籤 id 陣列)、
      `options.onChange(selectedTagIds)`。
- [ ] `mode: 'edit'` 時渲染文字輸入框(打字時用 `listTags()` 取回的資料做
      自動建議、按 Enter 或選建議項目可以把新標籤名稱加進選取清單——名稱不在
      既有標籤裡時視為要建立新標籤,沿用現有 `editor-tag-input` 原本「輸入
      的字串就是要建立的標籤名稱」這個既有語意,不用另外呼叫任何建立標籤的
      函式,建立時機維持在文章存檔時由 `findOrCreateTag_` 處理,這點跟現有
      行為完全不變)。
- [ ] `mode: 'edit'` 時,輸入框旁邊有一個展開/收合按鈕,點擊後顯示
      `listTags()` 依名稱排序的 checkbox 清單,勾選/取消勾選會更新選取清單、
      跟文字輸入共用同一份內部選取狀態(不是兩套各自獨立的資料)。
- [ ] `mode: 'filter'` 時完全不渲染文字輸入框,只有展開按鈕 + checkbox 清單,
      勾選/取消勾選直接觸發 `onChange`。
- [ ] 清單裡已經在 `selectedTagIds`/目前選取狀態裡的標籤,要有視覺上的區分
      (打勾/反白皆可),讓使用者瀏覽時看得出哪些已經選了。
- [ ] 選取狀態變化時(不論是打字新增、點清單勾選、或移除已選的 chip)都要呼叫
      `options.onChange(selectedTagIds)`。
- [ ] 文章編輯頁的 `editor-tag-input` 改成呼叫
      `buildTagPicker(container, { mode: 'edit', selectedTagIds: ...,
      onChange: ... })`,`onChange` 接回原本存檔時組 `tag_names` 陣列送給
      `createArticle`/`updateArticle` 的既有邏輯,存檔行為不變。
- [ ] `node --check` 驗證 `JavaScript.html` 語法通過。
- [ ] 手動驗收:文章編輯頁展開清單點選一個既有標籤、確認 chips 正確顯示;
      打字建立一個全新標籤、確認也正確加入 chips;存檔後兩種方式加的標籤都
      正確寫入(用 `listArticles`/文章詳情頁確認)。
