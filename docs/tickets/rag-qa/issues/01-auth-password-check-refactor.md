# 01 — Auth.gs:抽出共用的密碼驗證函式

**What to build:** 從 `callProtected` 裡把密碼比對邏輯抽成獨立函式
`isValidWritePassword_(password)`,讓後面的 RAG 問答功能可以共用同一份密碼
驗證邏輯,不用複製一份比對邏輯到別處。這是一個小的前置重構,`callProtected`
對外行為必須完全不變。

**Blocked by:** None

**Status:** ready-for-agent

- [ ] 新增 `isValidWritePassword_(password)`,回傳 boolean
      (`password === getWritePassword_()`),不拋出任何錯誤——拋錯是呼叫端的
      責任,不是這個判斷式本身。
- [ ] `callProtected` 改成呼叫 `isValidWritePassword_`,驗證失敗時維持丟出
      既有的「密碼錯誤」,對外行為(白名單裡的函式怎麼被呼叫、成功/失敗的
      回傳/拋錯格式)完全不變。
- [ ] `test/Auth.test.js` 既有的所有測試維持全數通過,不需要修改任何既有
      斷言。
- [ ] 新增針對 `isValidWritePassword_` 本身的測試:密碼正確回傳 `true`、密碼
      錯誤回傳 `false`,兩種情況都不拋出錯誤。
- [ ] `Auth.gs` 檔案開頭的註解更新,反映這個檔案現在同時服務「寫入白名單」
      (`callProtected`)跟之後會新增的讀取類密碼驗證需求,不再只描述「10 個
      寫入函式的守門員」。
