# 04 — AI 問答回答套用更嚴格設定(額外擋圖片)

**What to build:** 新增 `MD_SANITIZE_CONFIG_AI_`(內容跟 `MD_SANITIZE_CONFIG_` 完全一樣,
`FORBID_TAGS` 再多加 `img`/`picture`/`source`)。AI 問答回答(`renderAiAnswerTurn` 裡
`answerEl.innerHTML = ...` 那一行)改叫 `renderMarkdownSafe_(result.answer,
MD_SANITIZE_CONFIG_AI_)`。

**Blocked by:** 01(重用它引入的 `renderMarkdownSafe_`)

**Status:** done

- [x] `MD_SANITIZE_CONFIG_AI_` 已加進 `JavaScript.html`
- [x] AI 問答回答改叫 `renderMarkdownSafe_(result.answer, MD_SANITIZE_CONFIG_AI_)`
- [x] 驗證同一個遠端 `<img>` payload,用 AI 設定跑過之後圖片被擋下(標準設定不會擋的部分,
      這是這張票要新增的行為)
- [x] 驗證 AI 設定同時也擋得住標準設定已經擋的那幾個向量(`<form>`/`<style>`/`style` 屬性)
- [x] 完整測試套件(`npm test`)全數通過
