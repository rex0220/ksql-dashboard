#!/usr/bin/env node
/* kSQL Dashboard — プラグイン zip 作成／アップロードスクリプト（kintone 標準 cli-kintone を使用）
 *
 * 成果物 zip は dist/ 配下、秘密鍵は keys/ 配下（コミット禁止）。
 *   - 秘密鍵 keys/ksql-dashboard.ppk が無ければ `cli-kintone plugin keygen` で生成
 *   - `cli-kintone plugin pack` で dist/ksql-dashboard-v<version>.zip を作成（version は manifest から）
 *   - --upload / --upload-only 指定時は `cli-kintone plugin upload` で kintone に反映
 * --private-key を常に同じ鍵で指定するため plugin ID は固定される。
 *
 * 使い方:
 *   node scripts/package.js               # zip を作成（ビルドのみ）
 *   node scripts/package.js --upload      # ビルド＋アップロード
 *   node scripts/package.js --upload-only # アップロードのみ（既存 zip を再ビルドしない）
 *   node scripts/package.js --new         # 鍵を作り直してから zip を作成（plugin ID が変わる）
 *   npm run package                       # ビルドのみ
 *   npm run package:upload                # ビルド＋アップロード
 *   npm run upload                        # アップロードのみ
 *
 * アップロードの認証（.env またはシェルの環境変数で指定・.env はコミットしない）:
 *   KINTONE_BASE_URL   例: https://example.cybozu.com
 *   KINTONE_USERNAME   ログインユーザー名
 *   KINTONE_PASSWORD   パスワード
 *   （任意）KINTONE_BASIC_AUTH_USERNAME / KINTONE_BASIC_AUTH_PASSWORD
 *
 * 前提: cli-kintone は npx 経由で実行する（未インストールなら自動取得）。
 */
"use strict";

var path = require("path");
var fs = require("fs");
var spawnSync = require("child_process").spawnSync;

var ROOT = path.resolve(__dirname, "..");
var DIST = path.join(ROOT, "dist");
var KEYS = path.join(ROOT, "keys");                      // 秘密鍵の保管先（コミット禁止）
var MANIFEST = path.join(ROOT, "src", "manifest.json"); // プラグイン本体は src/ 配下
var PPK = path.join(KEYS, "ksql-dashboard.ppk");
var ENV_FILE = path.join(ROOT, ".env");

// zip 名に manifest の version を付与（例: ksql-dashboard-v1.0.0.zip）
function readVersion() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")).version; } catch (e) { return null; }
}
var VERSION = readVersion();
var OUT = path.join(DIST, "ksql-dashboard" + (VERSION != null ? "-v" + VERSION : "") + ".zip");
var OUT_NAME = path.basename(OUT);

var forceNew = process.argv.indexOf("--new") !== -1;
var uploadOnly = process.argv.indexOf("--upload-only") !== -1;   // アップロードのみ
var doUpload = uploadOnly || process.argv.indexOf("--upload") !== -1;
var doPack = !uploadOnly;                                         // upload-only 以外はビルドする

function q(p) { return '"' + p + '"'; }

// .env（KEY=VALUE 形式）を読み、未設定の環境変数だけを補う。存在しなくてもよい。
function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) { return; }
  var lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  lines.forEach(function (line) {
    var s = line.trim();
    if (!s || s.charAt(0) === "#") { return; }
    var eq = s.indexOf("=");
    if (eq === -1) { return; }
    var key = s.slice(0, eq).trim();
    var val = s.slice(eq + 1).trim();
    // 値を囲む引用符があれば外す
    if ((val.charAt(0) === '"' && val.slice(-1) === '"') ||
        (val.charAt(0) === "'" && val.slice(-1) === "'")) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) { process.env[key] = val; }
  });
}

// cli-kintone を npx 経由で実行（Windows では .cmd を shell 経由で起動する必要があるため shell:true）
// 認証情報は引数ではなく環境変数で渡す（クオート事故・履歴残りを避ける）。
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

// --- パッケージ化（upload-only 以外）------------------------------------
if (doPack) {
  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(KEYS, { recursive: true });

  // --new のときは既存の鍵を削除して作り直す
  if (forceNew && fs.existsSync(PPK)) {
    fs.unlinkSync(PPK);
    console.log("[package] --new: 既存の鍵を削除しました（plugin ID が変わります）。");
  }

  // 秘密鍵が無ければ生成
  if (!fs.existsSync(PPK)) {
    console.log("[package] 秘密鍵を生成します: keys/ksql-dashboard.ppk");
    cliKintone("plugin keygen --output " + q(PPK));
  } else {
    console.log("[package] 既存の鍵を使用します: keys/ksql-dashboard.ppk");
  }

  // zip を作成
  cliKintone("plugin pack --input " + q(MANIFEST) + " --output " + q(OUT) + " --private-key " + q(PPK));
  console.log("[package] 完了: dist/" + OUT_NAME + "（鍵: keys/ksql-dashboard.ppk は安全に保管してください）");
}

// --- アップロード（--upload / --upload-only）-----------------------------
if (doUpload) {
  if (!fs.existsSync(OUT)) {
    console.error("[package] アップロードに失敗: dist/" + OUT_NAME + " がありません。" +
      "\n        先に `npm run package` でパッケージ化してください。");
    process.exit(1);
  }
  loadEnv();
  if (!process.env.KINTONE_BASE_URL) {
    console.error("[package] アップロードに失敗: KINTONE_BASE_URL が未設定です。" +
      "\n        .env（.env.example を参照）またはシェルの環境変数で" +
      " KINTONE_BASE_URL / KINTONE_USERNAME / KINTONE_PASSWORD を設定してください。");
    process.exit(1);
  }
  console.log("[package] kintone へアップロードします: " + process.env.KINTONE_BASE_URL);
  // -y で確認を省略（自動化）。base-url/username/password は環境変数から解決される。
  cliKintone("plugin upload --input " + q(OUT) + " --yes");
  console.log("[package] アップロード完了。各アプリでプラグインを有効化し「アプリを更新」してください" +
    "（設定画面の『運用環境に反映』でも可）。");
}
