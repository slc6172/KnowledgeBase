// CI workflow 的供應鏈縱深防禦(靜態設定檢查,讀原始檔文字來斷言):
//   1. 頂層宣告最小權限 GITHUB_TOKEN(只讀),不依賴 repo 的預設值。
//   2. 所有第三方 action 都鎖定在完整 commit SHA,而不是可被移動的 tag(v4、v7 這類)。
//
// 為什麼:tag 可以被重新指向另一個 commit;若上游 action 被入侵,只鎖 tag 的 workflow
// 會在下一次執行時自動吃到惡意版本。鎖 SHA + 最小權限,可以把爆炸半徑限制在「只讀原始碼」。

const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'test.yml');

function readWorkflowText() {
  return fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n/g, '\n');
}

// 取出頂層 `permissions:` 區塊(包含縮排的子行);沒有宣告則回傳 null。
function readTopLevelPermissions(text) {
  var lines = text.split('\n');
  var start = -1;
  for (var i = 0; i < lines.length; i++) {
    if (/^permissions:/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return null;
  }
  var block = [lines[start]];
  for (var j = start + 1; j < lines.length; j++) {
    if (/^\s+\S/.test(lines[j]) || lines[j].trim() === '') {
      block.push(lines[j]);
    } else {
      break;
    }
  }
  return block.join('\n');
}

describe('CI workflow 的 GITHUB_TOKEN 權限是最小權限', function () {
  test('頂層有宣告 permissions,且 contents 只有 read', function () {
    var permissions = readTopLevelPermissions(readWorkflowText());

    expect(permissions).not.toBeNull();
    expect(permissions).toMatch(/^\s+contents:\s*read\s*$/m);
  });

  test('整份 workflow 沒有任何 write / write-all 權限', function () {
    var text = readWorkflowText();

    expect(text).not.toMatch(/:\s*write\b/);
    expect(text).not.toMatch(/write-all/);
  });
});

describe('CI workflow 的第三方 action 都鎖定在完整 commit SHA', function () {
  function readActionReferences(text) {
    var refs = [];
    var re = /^\s*-?\s*uses:\s*(\S+)/gm;
    var match;
    while ((match = re.exec(text)) !== null) {
      refs.push(match[1]);
    }
    return refs;
  }

  test('workflow 至少使用了一個 action(避免下面的斷言因為沒資料而空轉)', function () {
    expect(readActionReferences(readWorkflowText()).length).toBeGreaterThan(0);
  });

  test('每個 uses: 都是 owner/repo@<40 位十六進位 SHA>,沒有 v4、main 這類可被移動的參照', function () {
    var unpinned = readActionReferences(readWorkflowText()).filter(function (ref) {
      return !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(ref);
    });

    expect(unpinned).toEqual([]);
  });
});

// mycr F-10 剩餘部分:同一分支/PR 上,新推送要取消還在跑的舊 CI 執行,
// 不要浪費資源跑一個馬上就會被蓋過去的結果。
describe('CI workflow 會取消被新推送取代的舊執行', function () {
  test('宣告了 concurrency,group 依 workflow+ref 區分,cancel-in-progress 開啟', function () {
    var text = readWorkflowText();

    expect(text).toMatch(/^concurrency:/m);
    expect(text).toMatch(/cancel-in-progress:\s*true/);
  });
});

// 上傳 GitHub 前置檔案(README 第 88 條):action 已經鎖成 commit SHA,需要
// 有機制提醒更新,不然時間久了會過期;marked/dompurify 是測試用的版本,必須
// 跟 Index.html 鎖定的 CDN 版本一起手動同步(見 test/BrowserLibraryVersionSync.test.js),
// 不能讓自動更新只改其中一邊。
describe('Dependabot 設定', function () {
  var DEPENDABOT_PATH = path.join(__dirname, '..', '.github', 'dependabot.yml');

  function readDependabotText() {
    return fs.readFileSync(DEPENDABOT_PATH, 'utf8').replace(/\r\n/g, '\n');
  }

  test('.github/dependabot.yml 存在,且會更新 github-actions(SHA 固定的 action 需要有人提醒更新)', function () {
    expect(fs.existsSync(DEPENDABOT_PATH)).toBe(true);
    expect(readDependabotText()).toMatch(/package-ecosystem:\s*["']?github-actions["']?/);
  });

  test('npm 更新排除 marked 與 dompurify(這兩個要跟 Index.html 的 CDN 版本一起手動同步)', function () {
    var text = readDependabotText();

    expect(text).toMatch(/package-ecosystem:\s*["']?npm["']?/);
    expect(text).toMatch(/dependency-name:\s*["']?marked["']?/);
    expect(text).toMatch(/dependency-name:\s*["']?dompurify["']?/);
  });
});

describe('CI workflow 會執行 kb-proxy 的 Deno 測試,且不破壞既有加固', function () {
  test('安裝 Deno 用的是 denoland/setup-deno,且釘在完整 commit SHA 與精確的 Deno 版本', function () {
    var text = readWorkflowText();

    expect(text).toMatch(/uses:\s*denoland\/setup-deno@[0-9a-f]{40}\b/);
    // 精確版本(不用 v2.x 這類會浮動的範圍):跟 Jest 依賴鎖精確版本是同一個理由。
    expect(text).toMatch(/deno-version:\s*['"]?\d+\.\d+\.\d+['"]?/);
  });

  test('有 deno test 步驟,指向代理函式目錄', function () {
    expect(readWorkflowText()).toMatch(/run:\s*deno test\s+supabase\/functions\/kb-proxy\/?\s*$/m);
  });

  test('Deno 步驟不使用任何遠端匯入旗標(不放寬網路或權限)', function () {
    var text = readWorkflowText();

    expect(text).not.toMatch(/--allow-net|--allow-all|-A\b|--allow-import|--unstable/);
  });

  test('Node / Jest 流程維持不變', function () {
    var text = readWorkflowText();

    expect(text).toMatch(/run:\s*npm ci/);
    expect(text).toMatch(/run:\s*npm test/);
  });
});

// mycr F-17:CI 衛生。沒有逾時的 job 在卡住時會一路跑到平台預設的 6 小時;
// 沒有快取的 npm ci 每次都重新下載全部相依。
describe('CI workflow 有逾時上限與 npm 快取', function () {
  test('job 宣告 timeout-minutes,且在合理範圍內(1–30 分鐘)', function () {
    var match = readWorkflowText().match(/^\s+timeout-minutes:\s*(\d+)\s*$/m);

    expect(match).not.toBeNull();
    expect(Number(match[1])).toBeGreaterThanOrEqual(1);
    expect(Number(match[1])).toBeLessThanOrEqual(30);
  });

  test('actions/setup-node 啟用 npm 快取,且仍然鎖在 commit SHA', function () {
    var text = readWorkflowText();
    var setupNode = text.slice(text.indexOf('actions/setup-node@'));

    expect(setupNode).toMatch(/^\s+cache:\s*['"]?npm['"]?\s*$/m);
    expect(text).toMatch(/uses:\s*actions\/setup-node@[0-9a-f]{40}\b/);
  });
});

// spec_chunked_embeddings 票 01:SQL 整合測試在 CI 真的跑(對 pgvector 服務容器),而不是在 CI 全部被跳過。
describe('CI workflow 有 pgvector 服務容器,並把 TEST_DATABASE_URL 交給 npm test', function () {
  test('宣告 postgres 服務容器,使用 pgvector 官方映像的 pg16 版本,並有健康檢查', function () {
    var text = readWorkflowText();

    expect(text).toMatch(/^\s+services:\s*$/m);
    expect(text).toMatch(/^\s+image:\s*pgvector\/pgvector:pg16\s*$/m);
    expect(text).toMatch(/--health-cmd\s+"pg_isready/);
  });

  test('測試步驟帶有 TEST_DATABASE_URL,指向服務容器', function () {
    var text = readWorkflowText();
    var npmTest = text.slice(text.indexOf('- run: npm test'));

    expect(npmTest).toMatch(/TEST_DATABASE_URL:\s*postgres:\/\/\w+:\w+@localhost:5432\/\w+/);
  });

  test('容器的帳密只是用完即丟的測試值,workflow 裡沒有引用任何 secrets', function () {
    expect(readWorkflowText()).not.toMatch(/\$\{\{\s*secrets\./);
  });
});
