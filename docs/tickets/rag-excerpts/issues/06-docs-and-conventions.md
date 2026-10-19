# 06 — 文件與慣例更新

**What to build:** 把決策與慣例寫回文件:AI 問答改節錄、查詢向量快取與額度規則、「內部開關絕不能從公開函式的 `opts` 讀取」。

**Blocked by:** 02、03、04、05

**Status:** done

**接縫(spec 接縫 4):** 靜態文字掃描。

- [x] `docs/DESIGN.md`:AI 問答決策列(全文 → 節錄)、新決策(查詢向量快取與額度規則)、架構說明
- [x] `README.md`:「已知問題修復紀錄」新增條目(mycr F-14、F-08)、Gemini 額度段落補「一次搜尋只算一次嵌入」
- [x] `CLAUDE.md`:新增「內部開關絕不能從公開函式的 `opts` 讀取」慣例
- [x] `spec_ai_sources_panel.md` 的 Further Notes 補一句指向本 spec
- [x] `spec_rag_excerpts.md` front matter `status` 由 `needs-review` 改為 `ready-for-agent`(專案的 spec 沒有 done 狀態,慣例是 `ready-for-agent`)
- [x] 文件不寫測試總數
