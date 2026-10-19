# 03 — 切段純函式與重建工具骨架(含試跑)

**Type:** AFK

**Blocked by:** None — can start immediately(試跑呼叫的 `articles_needing_reindex` 由 05 提供,本票以 `httpFetch_` 假回應驗證合約)

**Status:** done

**對應 User Story:** 2、12、13、14(見 `docs/specs/spec_chunked_embeddings.md`)

**What to build:** (1) 切段純函式(`src/`,私有函式):每段最多約 1,500 字,優先段落邊界,其次換行、句末標點、硬切(不切斷代理對),不重疊;1,500 字內為單段;內容空白為單段(空文字);超過 40 段可被偵測;送去嵌入的文字 =「標題 + 空行 + 段落」。(2) 一次性重建工具的骨架(`tools/Reindex.gs`,不在 `src/`):入口函式不加底線;`reindexDryRun`;受 Script Property `REINDEX_ENABLED` 控管(**試跑也要檢查**,沒開就拒絕);只寫日誌(文章數、段數、預估請求數、超過 40 段的文章),不呼叫 Gemini、不寫入、不回傳內容。

**接縫:** GAS `httpFetch_`(以 `loadGas` 載入 `tools/` 檔案)。

- [x] 切段:段落邊界優先;過長段落退到換行、句末標點、硬切;不重疊;每段 ≤ 1,500;表情符號/代理對不被切斷;串回去等於原文(去除切點的空白除外)
- [x] 1,500 字內為單段;空內容為單段;40 段通過、41 段被偵測為超限
- [x] 嵌入文字含標題、儲存文字不含標題
- [x] `reindexDryRun`:Property 未設或不是 `true` → 拒絕且不發出任何請求;開啟後只做讀取請求,不呼叫 Gemini、不呼叫任何寫入
- [x] 日誌含文章數、段數、預估請求數、超限文章清單;不含文章內容
- [x] 入口函式不回傳資料(回傳 `undefined`)
- [x] `tools/` 不在 `src/` 內;`PrivateFunctionExposure` 掃描不受影響;clasp `rootDir` 為 `./src` 以測試守住

> **實作註記:** (1) 切段由粗到細三層(段落 → 換行 → 句子)加硬切;相鄰小單位打包,過長單位的細切結果各自成段、不再和鄰居打包。句末的半形句點只在後面接空白或結尾時才算,避免把 `3.14`、`e.g.` 當成句子結束。切點兩側空白會被修掉,其餘內容不遺漏、不重複(以忽略空白的串接比對驗證)。
> (2) 新增 `EMBEDDING_MODEL_NAME_` / `EMBEDDING_DIMENSIONS_` / `EMBEDDING_MODEL_ID_`(`Embeddings.gs`),`generateEmbedding_` 改用它們,並有測試守住「維度 = schema 的 `vector(768)`」。
> (3) 試跑呼叫的 `articles_needing_reindex(current_model)` 由票 05 提供;本票以 `httpFetch_` 假回應驗證合約(請求路徑、方法、參數名稱)。**那個 RPC 在票 05 完成前還不存在於資料庫。**
> (4) 試跑的「預估 Gemini 請求數」目前是一篇一次;票 04 實測若發現單次上限小於 40,會改為依批次大小估算。
> (5) 破壞驗證:切段五種、工具骨架五種,全部變紅。
