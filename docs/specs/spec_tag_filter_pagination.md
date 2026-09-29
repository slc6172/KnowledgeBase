# Spec:標籤篩選文章列表改用資料庫端分頁的 RPC,不再把全部符合的文章 id 塞進網址

**Triage label**:`ready-for-agent`

**來源**:`mycr-20260921-060513.md`(全新複掃報告)Finding F-04,經 `/grilling` 對談逐項定案
(2026-09-22)。

## Problem Statement

`listArticles` 在有標籤篩選時,會先呼叫 `filterArticleIdsByTags_` 找出「同時擁有全部指定標籤」
的**全部**文章 id(沒有分頁、沒有上限),再把這些 id 全部序列化進 `id=in.(…)` 這個查詢字串,拼進
GET 請求的網址,最後才套用 `limit`/`offset`。Google Apps Script 的 `UrlFetchApp` 有網址長度
2 KB 的上限,用這個專案自己的編碼方式計算,大約 42–43 篇符合條件的文章就會讓網址超過這個上限,
瀏覽列表的標籤篩選會直接失敗,而且錯誤不是這個專案自己標記過的安全訊息,會把 Apps Script 平台的
原始例外訊息直接顯示出來。知識庫的文章數只會越用越多,這是遲早會撞到、而且是使用者最常用功能之一
的壞法。

## Solution

新增一個資料庫端的 RPC(`articles_by_tags`),把「符合標籤條件」跟「分頁」都搬到 SQL 端做,呼叫
端只需要傳標籤 id、篩選條件、分頁參數,不需要再把一長串文章 id 塞進網址。只有真的有標籤篩選時才
走這個新 RPC,沒有標籤篩選的預設瀏覽維持現在的 REST 查詢字串寫法不動——網址過長的風險只存在標籤
篩選這條分支,不需要為了程式碼路徑一致去動一個現在運作良好、沒有任何問題的路徑。這個 RPC 照搬
`searchArticles`(呼叫 `hybrid_search_articles`)已經在用的兩段式做法:RPC 只負責篩選/排序/
分頁,回傳單純的 `articles.*`;GAS 再用既有的 `inFilter_` 對「這一頁」的 id 額外查一次分類/標籤
的 join 資料。這個模式在這裡是安全的,因為分頁邏輯搬進 RPC 之後,補查那次的 id 數量會被限制在
「一頁的大小」(現在預設 50),不會再跟「總共符合條件的文章數」成正比。

## User Stories

1. 身為擁有者,我希望不管知識庫累積了多少篇文章、某個標籤底下有多少篇符合,用標籤篩選文章列表
   這個功能都能正常運作,不會因為符合的文章數超過某個沒有文件記載的門檻就突然壞掉。
2. 身為擁有者,我希望這次修正之後,標籤篩選失敗時如果真的發生(例如資料庫暫時連不上),看到的
   是這個專案自己一貫的安全錯誤訊息,不是 Apps Script 平台的原始例外內容。
3. 身為擁有者,我希望沒有使用標籤篩選的預設文章列表瀏覽,行為、效能、程式碼路徑都跟現在完全
   一樣,這次修正不應該讓這個現在運作良好的路徑多繞路或變慢。
4. 身為擁有者,我希望標籤篩選出來的文章清單,排序方式(依最後更新時間新到舊)跟現在完全一樣,
   這次修正只是把符合條件的判斷跟分頁搬到資料庫端,不是要改變使用者看到的排序邏輯。
5. 身為擁有者,我希望標籤篩選能跟現有的狀態(草稿/已發布)、分類篩選一起使用,就像現在一樣可以
   三個條件疊加,這次修正不能少掉任何現有的篩選組合。
6. 身為維護者,我希望新的 RPC 沿用這個專案裡已經驗證過可行的既有模式(`searchArticles` 那套
   「RPC 篩選分頁、GAS 端額外補查 join 資料」的兩段式做法),不要為了這個修正另外發明一套新的、
   沒有先例的 SQL 寫法(例如在 SQL 裡手刻 `json_build_object` 去拼出巢狀 join 的形狀)。
7. 身為維護者,我希望標籤 id 清單在送進新 RPC 之前,也套用跟 `searchArticles` 現在一樣的去重
   處理(`uniqueValues_`)——這個專案已經記錄過「標籤 id 有重複值會讓比對門檻算錯、導致真正符合
   的文章被誤判排除」這個問題,新的路徑不應該重蹈覆轍。
8. 身為維護者,我希望這次修正確認過之後,`filterArticleIdsByTags_` 如果真的變成沒有任何正式
   程式碼在呼叫的死函式,連同它自己專屬的測試都要一併刪除,不要留著沒用的程式碼在專案裡——這是
   這次使用者明確要求的做法(不再沿用「留著、在修復紀錄裡提一句」的舊模式)。
9. 身為維護者,我希望新 RPC 的參數命名、預設值風格、註解方式,跟 `schema.sql` 裡既有的
   `hybrid_search_articles`/`related_articles` 保持一致,這樣以後回頭看這份 schema 時,不會
   覺得這個新函式是憑空冒出來的、風格不一樣的東西。

## Implementation Decisions

- **新增 SQL 函式 `articles_by_tags`**(`docs/schema.sql`,語法/風格比照既有的
  `hybrid_search_articles`/`related_articles`——`create or replace function`、
  `language sql`、預設值寫在參數列):
  ```
  articles_by_tags(
    tag_ids     uuid[],
    status_filter    text default null,
    category_id_filter uuid default null,
    lim         int default 50,
    off         int default 0
  ) returns setof articles
  ```
  內部沿用 `hybrid_search_articles` 裡已經有的 `tag_filtered` CTE 邏輯(`having
  count(distinct tag_id) = array_length(tag_ids, 1)` 判斷「同時擁有全部指定標籤」),外層
  再疊加 `status_filter`/`category_id_filter`(皆為 null 時不套用該條件,語意對齊
  `listArticles` 現在「沒帶這個篩選條件就不篩」的行為),依 `updated_at desc` 排序,套用
  `limit`/`offset`。分頁邏輯完全在 SQL 端完成,GAS 端不需要再自己做 slice。
- **只有 `opts.tagIds` 非空時,`listArticles` 才走這個新 RPC**;沒有標籤篩選的分支維持現在
  直接組 REST 查詢字串的寫法完全不動。
- **標籤 id 去重**:送進 `articles_by_tags` 之前,`opts.tagIds` 先經過 `uniqueValues_`
  處理,比照 `searchArticles` 現在對 `hybrid_search_articles` 的 `tag_ids` 參數的做法。
- **兩段式取資料**:第一段呼叫 `supabaseRpc_('articles_by_tags', {...})` 拿到這一頁(已經
  篩選、排序、分頁過)的裸 `articles.*` 列;第二段用既有的 `inFilter_('id', pageIds)` 對這一頁
  的 id(數量上限就是這次請求的 `limit`,不會超過使用者設定的頁面大小)額外查一次
  `select=...,categories(id,name),article_tags(tags(id,name))`,補上 join 資料,再依第一段
  RPC 回傳的順序重新排列(比照 `searchArticles` 現在「用 `orderedIds` 重新排列 `enrichedRows`」
  的既有寫法)。
- **`filterArticleIdsByTags_` 確認變成死函式後直接刪除**:新的 RPC 上線、`listArticles` 的
  標籤篩選分支改叫新 RPC 之後,`filterArticleIdsByTags_` 沒有任何正式程式碼呼叫它——刪除函式
  本體、`module.exports` 裡的項目、`test/Articles.test.js` 裡它專屬的測試區塊
  (`describe("filterArticleIdsByTags_", ...)`)。動手刪之前先用 `grep` 確認真的沒有任何
  其他呼叫點,不是憑印象判斷。
- **`uniqueValues_` 維持不動**:這個輔助函式除了 `filterArticleIdsByTags_` 之外,
  `searchArticles`(對 `hybrid_search_articles` 的 `tag_ids`)、這次新的路徑(對
  `articles_by_tags` 的 `tag_ids`)都還會用到,不是死函式,不受這次清理影響。

## Testing Decisions

- 沿用這個專案既有的測試縫:mock `httpFetch_`,斷言實際發出的請求順序/方法/payload,以及
  `listArticles` 最終的回傳值。
- 新增測試:標籤篩選(單一或多個標籤,可疊加 status/categoryId)時,`listArticles` 改呼叫
  `articles_by_tags` RPC(`rpc/articles_by_tags` 路徑、正確的 payload,含去重後的 `tag_ids`、
  `status_filter`/`category_id_filter`/`lim`/`off`),而不是舊的
  `filterArticleIdsByTags_` → `inFilter_('id', matchedIds)` 寫法。
- 新增測試:RPC 回傳的裸列(無 join)之後,`listArticles` 會再用 `inFilter_` 對「RPC 回傳的
  那些 id」補查一次 join 資料,並依 RPC 回傳的順序重新排列——這個測試特地假設 RPC 回傳的順序
  跟「補查」回來的順序不同,驗證重新排列的邏輯真的有在運作(不是意外剛好順序一樣而測不出來)。
- 新增測試(這次修正真正要解的問題,直接的迴歸測試):標籤篩選在符合條件的文章數遠超過先前
  約 42–43 篇的網址長度門檻時(例如準備 100 個符合的文章 id 的假 RPC 回傳),`listArticles`
  仍然完整成功——因為 RPC 是用 POST body 傳參數,不是塞進網址,不會再受網址長度限制。
- 沒有標籤篩選(`opts.tagIds` 為空或未提供)時,既有測試(`describe("listArticles", ...)`
  裡不涉及標籤篩選的案例)維持全數通過、斷言內容不需要修改——這個分支完全沒被這次修正碰到。
- `filterArticleIdsByTags_` 專屬的測試區塊隨函式一起刪除,不是留著讓它們測一個沒人呼叫的
  死函式。
- 標籤 id 去重的測試(比照 `filterArticleIdsByTags_` 原本那個「重複標籤 id 不會讓比對門檻
  算錯」的測試案例)在新路徑上重新驗證一次——送進 `articles_by_tags` 的 `tag_ids` payload
  裡不應該有重複值,即使呼叫端傳進來的 `opts.tagIds` 本身有重複。

## Out of Scope

- 沒有標籤篩選的預設瀏覽路徑——grilling 對談時決定維持現狀不動,網址過長的風險不存在於這條
  分支。
- 把 `hybrid_search_articles` 也一起改成支援「沒有搜尋文字、純瀏覽」的用法,統一成一個 RPC——
  grilling 對談時考慮過這個替代方案,但這代表要改動一個現有、已經上線在用的搜尋 RPC 增加新
  行為,風險比新增一個獨立、單一用途的 RPC 更高,決定不做。
- 在 SQL 端直接組出跟 PostgREST 巢狀 join 一樣形狀的回傳值(`json_build_object`/
  `jsonb_agg`)——grilling 對談時決定照搬 `searchArticles` 已經驗證過的兩段式做法,不引入
  這個專案裡沒有先例的新寫法。
- 同一輪 mycr 報告裡其他 finding(F-02、F-05、F-06、F-09、F-10 剩餘部分、F-11)是各自獨立
  的問題,不在這份 spec 的範圍內。

## Further Notes

- 決策脈絡:`searchArticles` 現在對 `hybrid_search_articles` 回傳結果做的「用 `inFilter_`
  補查 join 資料」這個模式,其實跟這次要修的 bug 是同一種形狀(把一批 id 塞進網址查詢),現在
  之所以安全,純粹是因為 `hybrid_search_articles` 內部把 `match_count` 上限鎖在 30 筆
  (`least(match_count, 30)`)。這次新的 `articles_by_tags` 一樣要確保分頁邏輯真的在 SQL 端
  執行、回傳筆數真的被 `limit` 限制住,不能只是「看起來有分頁參數」但沒有真的生效——驗證時要
  確認 RPC 回傳的列數不會超過請求的 `limit`。
- 修正完成後,依專案慣例在 `README.md`「已知問題修復紀錄」新增對應編號條目,並記錄
  `filterArticleIdsByTags_` 被刪除這件事(這次使用者明確要求死函式直接刪除,不再沿用留著
  提醒的舊做法,值得在修復紀錄裡講清楚這個做法上的轉變)。
