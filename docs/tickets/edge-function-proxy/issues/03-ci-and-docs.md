# 03 — CI 執行 Deno 測試、文件與遷移步驟

**What to build:** CI 自動執行代理的 Deno 測試,新增的 action 以 commit SHA 固定並納入
既有 CI 加固測試;README / DESIGN / CLAUDE.md 反映新架構,並寫入既有部署的完整遷移步驟。

**Blocked by:** 01 — 代理核心、02 — GAS 端切換

**Status:** done

**接縫:** 靜態文字掃描(CI 加固測試風格)。

**手動驗證:** 依 README 遷移步驟在真實環境依序操作。

- [x] CI 新增 Deno 安裝與 `deno test` 步驟,action 以完整 commit SHA 固定,
      CI 只使用 Deno 內建與 `node:*` 模組(無遠端匯入)
- [x] CI 加固測試擴充後涵蓋新步驟(SHA 固定、權限仍為最小),既有 Node/Jest 流程不變
- [x] README:架構圖與說明改為經 Edge Function;快速開始改為新流程;原「務必使用
      Legacy service_role」警告改寫為遷移說明;新增修復/變更紀錄一條與版本號調整
- [x] README 含遷移步驟 7 步,順序為先部署函式、驗證後才推送 GAS、最後才刪舊屬性
- [x] DESIGN 決策表新增一列、架構圖同步更新
- [x] CLAUDE.md 與測試假設定中關於 service_role 直連的敘述改成新架構;
      「進行中」段落移除本 spec;文件不寫測試總數

> **實作註記:** `denoland/setup-deno` 的 SHA(v2.0.5)是以 `git ls-remote` 取得(GitHub API 在沙箱被限流);
> Deno 版本精確固定為 2.9.6。README 遷移步驟以文件靜態測試守住順序。版本號 1.4.1 → 1.5.0(部署設定有變動)。
