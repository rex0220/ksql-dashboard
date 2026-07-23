#!/usr/bin/env node
/* kSQL Dashboard — プラグイン zip 作成スクリプト（kintone 標準 cli-kintone を使用）
 *
 * 成果物を dist/ 配下に出力する。
 *   - 秘密鍵 dist/ksql-dashboard.ppk が無ければ `cli-kintone plugin keygen` で生成
 *   - `cli-kintone plugin pack` で dist/ksql-dashboard.zip を作成
 * --private-key を常に同じ鍵で指定するため plugin ID は固定される。
 *
 * 使い方:
 *   node scripts/package.js          # 鍵が無ければ生成し、zip を作成
 *   node scripts/package.js --new    # 既存の鍵を作り直してから zip を作成（plugin ID が変わる）
 *   npm run package                  # 上記と同じ（package.json 経由）
 *
 * 前提: cli-kintone は npx 経由で実行する（未インストールなら自動取得）。
 */
"use strict";

var path = require("path");
var fs = require("fs");
var spawnSync = require("child_process").spawnSync;

var ROOT = path.resolve(__dirname, "..");
var DIST = path.join(ROOT, "dist");
var MANIFEST = path.join(ROOT, "manifest.json");
var OUT = path.join(DIST, "ksql-dashboard.zip");
var PPK = path.join(DIST, "ksql-dashboard.ppk");
var forceNew = process.argv.indexOf("--new") !== -1;

function q(p) { return '"' + p + '"'; }

// cli-kintone を npx 経由で実行（Windows では .cmd を shell 経由で起動する必要があるため shell:true）
function cliKintone(subcmd) {
  var res = spawnSync("npx --yes cli-kintone " + subcmd, {
    cwd: ROOT, stdio: "inherit", shell: true
  });
  if (res.error) {
    console.error("[package] cli-kintone の起動に失敗しました: " + res.error.message);
    process.exit(1);
  }
  if (res.status !== 0) { process.exit(res.status || 1); }
}

// dist/ を用意
fs.mkdirSync(DIST, { recursive: true });

// --new のときは既存の鍵を削除して作り直す
if (forceNew && fs.existsSync(PPK)) {
  fs.unlinkSync(PPK);
  console.log("[package] --new: 既存の鍵を削除しました（plugin ID が変わります）。");
}

// 秘密鍵が無ければ生成
if (!fs.existsSync(PPK)) {
  console.log("[package] 秘密鍵を生成します: dist/ksql-dashboard.ppk");
  cliKintone("plugin keygen --output " + q(PPK));
} else {
  console.log("[package] 既存の鍵を使用します: dist/ksql-dashboard.ppk");
}

// zip を作成
cliKintone("plugin pack --input " + q(MANIFEST) + " --output " + q(OUT) + " --private-key " + q(PPK));

console.log("[package] 完了: dist/ksql-dashboard.zip（鍵: dist/ksql-dashboard.ppk は安全に保管してください）");
