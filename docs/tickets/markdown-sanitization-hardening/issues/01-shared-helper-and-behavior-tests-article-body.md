# 01 — 建立共用消毒函式與行為測試機制,套用到文章內文

**What to build:** 新增 `renderMarkdownSafe_(md, cfg)`(`DOMPurify.sanitize(marked.parse(md ||
''), cfg || MD_SANITIZE_CONFIG_)`)與 `MD_SANITIZE_CONFIG_`(`FORBID_TAGS`:`style`/`form`/
`input`/`button`/`textarea`/`select`/`option`/`optgroup`/`label`/`fieldset`/`legend`;
`FORBID_ATTR`:`style`/`action`/`formaction`/`method`/`srcset`)。文章內文(`detail-content`)
改叫 `renderMarkdownSafe_(article.content_md)`。同時建立這個專案第一次真的會執行 DOMPurify/
marked 的測試機制:新增 `dompurify@3.4.14`、`marked@18.0.12`(對齊 `Index.html` 目前鎖定的
CDN 版本)、`jsdom` 為 devDependency,新增 `test/MarkdownSanitizationBehavior.test.js`,用
`test/EasyMdePreviewSanitization.test.js` 已經在用的 `extractFunctionBody` 技巧從
`JavaScript.html` 原始碼裡抓出 `renderMarkdownSafe_` 的原始碼、在 jsdom 全域環境裡執行,驗證
標準設定擋得住收集密碼的 `<form>`、整頁 `<style>` 區塊、畫覆蓋畫面用的 `style` 屬性,同時驗證
一段正常 Markdown(標題/清單/程式碼區塊/表格/連結/粗體)結構完全保留。

**Blocked by:** None — can start immediately

**Status:** done

- [x] `renderMarkdownSafe_` 與 `MD_SANITIZE_CONFIG_` 已加進 `JavaScript.html`
- [x] 文章內文(`detail-content`)改叫 `renderMarkdownSafe_`,不再直接呼叫
      `DOMPurify.sanitize(marked.parse(...))`
- [x] `package.json` 新增 `dompurify@3.4.14`、`marked@18.0.12`、`jsdom@24` 為 devDependency,
      正式環境仍然透過 `Index.html` 的 CDN `<script>` 載入,不受影響
      (2026-09-22 實作時發現:`jsdom` 30 的依賴鏈裡有多層純 ESM 套件,Jest 預設的
      CommonJS 轉譯會一路撞上去,改用較早、對 CommonJS 相容的 `jsdom@24` 版本避開;
      另外 `marked@18.0.12` 這個 npm 套件本身現在也是純 ESM,`require("marked")` 在
      Jest 底下行不通——改成不透過 npm 套件的 `require()`,直接讀取
      `node_modules/marked/lib/marked.umd.js`、`node_modules/dompurify/dist/purify.min.js`
      這兩個實體檔案的原始碼,在 `vm` 沙箱裡執行,讓它們的 UMD wrapper 照瀏覽器的行為
      自己掛到沙箱全域物件上——這正是 `Index.html` 用 `<script>` 標籤載入、CDN 實際會
      送給訪客的同一份檔案,比原本設想的 `require()` 更貼近正式環境實際載入的方式)
- [x] `test/MarkdownSanitizationBehavior.test.js` 直接從 `JavaScript.html` 的原始碼文字裡
      抓出 `renderMarkdownSafe_` 的原始碼並在 jsdom 環境執行,不是另外手動謄寫一份重新實作
- [x] 驗證標準設定會擋下:收集密碼的 `<form>`、整頁 `<style>` 區塊、用來畫覆蓋畫面的 `style`
      屬性
- [x] 驗證正常 Markdown(標題、清單、程式碼區塊、表格、連結、粗體)跑過標準設定後結構完全保留
- [x] 完整測試套件(`npm test`)全數通過
