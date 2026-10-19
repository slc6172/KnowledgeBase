# 04 — 公開讀取函式的輸入驗證

**What to build:** 匿名訪客可呼叫的 `listArticles` 對參數做統一的型別與範圍檢查。(F-13)`limit` 夾到
1–100(未提供或無效時維持現行預設 50),`offset` 必須是非負整數(否則忽略),`tagIds` 必須是陣列
(否則視為沒有標籤篩選)。不合法的輸入得到一致、安全的行為,而不是把原始 `TypeError` 訊息丟給匿名者。
擁有者與一般使用者的正常操作(分頁、篩選)行為不變。

**Blocked by:** None — can start immediately

**Status:** done

**接縫:** GAS 端 `httpFetch_`(檢查送往 PostgREST / RPC 的請求);前端實際使用的 limit 先以靜態搜尋確認不超過上限。

- [x] `limit` 為 0、負數、小數、非數字字串、極大值(例如 100000)→ 分別落回預設或夾到上限,送出的請求 `limit` 一律在 1–100
- [x] `offset` 為負數、小數、非數字 → 不帶 `offset`;正整數照舊帶入
- [x] `tagIds` 為字串、物件、數字 → 視為沒有標籤篩選(不呼叫 `articles_by_tags`,不丟 `TypeError`)
- [x] `tagIds` 為合法陣列 → 行為與現況相同(去重、AND 語意、RPC 呼叫)
- [x] 前端目前使用的頁面大小(`ARTICLE_PAGE_SIZE` 之類的常數)不超過上限,否則分頁會被截斷(以靜態掃描守住)
- [x] 既有 Articles 測試不需修改斷言即通過

> **實作註記:** (1) 規則:`limit` 無法轉成有限數字或小於 1 → 預設 50,小數捨去,超過 100 夾到 100;`offset` 只接受正整數,
> 超過 100000 夾住(避免 `1e+21` 這種字串送給 PostgREST);`tagIds` 非陣列 → 視為沒有篩選。(2) F-13 的描述也點名
> `Search.gs`,所以 `searchArticles` 的 `tagIds` 同樣經 `normalizeTagIds_`(同一個輔助函式,為了讓測試環境看得到而匯出)。
> `matchCount` 等其餘 RPC 參數**沒有改**:資料庫函式端本來就有上限。(3) 前端頁面大小(20)與 tag 篩選用過的 100 都在範圍內,
> 並新增靜態比對守住「頁面大小 ≤ 上限」。
