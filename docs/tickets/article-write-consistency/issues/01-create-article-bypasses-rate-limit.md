# 01 — 建立文章不再受公開讀取節流牽連

**What to build:** `createArticle_` 在共用的匿名讀取節流額度被用滿時,仍然能完整成功——文章確實
被建立、回傳的是完整、帶 join 的文章資料,而不是在資料庫已經寫入之後才拋出「目前使用量過大」。
新增一個不節流的內部文章讀取,只給寫入路徑用,公開的 `getArticle` 對外行為(節流、回傳形狀)完全
不變,內部改委派給這個新的內部讀取。命名方式比照 `Articles.gs` 裡其他內部函式的既有慣例(底線
字首)。這個內部讀取之後會被 Ticket 03(編輯文章)、Ticket 04(發布/取消發布文章)重複使用。

**Blocked by:** None — can start immediately

**Status:** done

- [x] 把共用節流計數器灌到上限後呼叫 `createArticle_`,仍完整成功,不拋出「使用量過大」
- [x] 外部直接呼叫 `getArticle` 時,節流行為(含既有的「灌到上限後第 N+1 次呼叫會拋錯」測試)完全不變
- [x] 新增的內部讀取以底線字首命名,`test/PrivateFunctionExposure.test.js` 的靜態掃描繼續通過,不需要為此另外修改該掃描
- [x] 完整測試套件(`npm test`)全數通過
