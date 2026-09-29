// CI 使用的 Node 版本 ↔ package.json 的 engines ↔ 開發工具鏈(Babel/Jest)實際需要的 Node 版本,
// 三者必須彼此一致。
//
// 這是「靜態設定一致性」測試(比照這個專案前端測試的做法:讀原始檔文字來斷言)。
// 它守住的是一個實際發生過的問題:CI 指定 Node 18,但 @babel/core 8 要求 Node ^22.18.0 || >=24.11.0,
// 結果 CI 在第一次執行就會整片紅燈(ERR_REQUIRE_ESM),而且看起來像「測試壞了」而不是「CI 設定錯了」。
//
// 期望值一律來自 package-lock.json 裡各套件自己宣告的 engines.node——那是相依套件作者的宣告,
// 不是本測試自己推算出來的,所以以後升級 Babel/Jest 造成需求變動時,這裡會直接反映出來。

const fs = require('fs');
const path = require('path');
const semver = require('semver');

const ROOT = path.join(__dirname, '..');
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'test.yml');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

// 取出 workflow 裡所有 node-version 的設定值(可能有多個 job/step)。
function readWorkflowNodeVersionSpecs() {
  var text = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  var specs = [];
  var re = /^\s*node-version:\s*['"]?([^'"#\r\n]+?)['"]?\s*(?:#.*)?$/gm;
  var match;
  while ((match = re.exec(text)) !== null) {
    specs.push(match[1].trim());
  }
  return specs;
}

// 開發工具鏈 = package.json 的 devDependencies 直接列出的套件;
// 各自要求的 Node 版本範圍,取自 lockfile 裡那個套件的 engines.node。
function readToolchainEngineRanges() {
  var pkg = readJson('package.json');
  var lock = readJson('package-lock.json');
  var ranges = {};
  Object.keys(pkg.devDependencies || {}).forEach(function (name) {
    var entry = lock.packages['node_modules/' + name];
    if (entry && entry.engines && entry.engines.node) {
      ranges[name] = entry.engines.node;
    }
  });
  return ranges;
}

describe('CI 的 Node 版本設定與開發工具鏈需求一致', function () {
  test('lockfile 裡 @babel/core 有宣告 engines.node(避免下面的斷言因為沒資料而空轉)', function () {
    var ranges = readToolchainEngineRanges();
    expect(Object.keys(ranges)).toContain('@babel/core');
  });

  test('workflow 有明確設定 node-version', function () {
    expect(readWorkflowNodeVersionSpecs().length).toBeGreaterThan(0);
  });

  test('CI 使用的 Node 版本範圍,完全落在每個工具鏈套件宣告的 engines 內', function () {
    var specs = readWorkflowNodeVersionSpecs();
    var toolchain = readToolchainEngineRanges();
    var violations = [];

    specs.forEach(function (spec) {
      var ciRange = semver.validRange(spec);
      if (ciRange === null) {
        violations.push('node-version "' + spec + '" 不是明確的 semver 範圍(請寫成如 ^22.18.0,不要用 latest/lts/*)');
        return;
      }
      Object.keys(toolchain).forEach(function (name) {
        if (!semver.subset(ciRange, toolchain[name])) {
          violations.push('node-version "' + spec + '" 可能解析出 ' + name + ' 不支援的版本(' + name + ' 需要 ' + toolchain[name] + ')');
        }
      });
    });

    expect(violations).toEqual([]);
  });

  test('package.json 的 engines.node 沒有宣稱支援工具鏈實際跑不動的版本', function () {
    var declared = readJson('package.json').engines && readJson('package.json').engines.node;
    var toolchain = readToolchainEngineRanges();
    var violations = [];

    expect(declared).toBeDefined();
    expect(semver.validRange(declared)).not.toBeNull();

    Object.keys(toolchain).forEach(function (name) {
      if (!semver.subset(declared, toolchain[name])) {
        violations.push('engines.node "' + declared + '" 包含 ' + name + ' 不支援的版本(' + name + ' 需要 ' + toolchain[name] + ')');
      }
    });

    expect(violations).toEqual([]);
  });
});
