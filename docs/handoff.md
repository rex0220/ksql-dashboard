# kSQL Dashboard — Claude Code 引き継ぎ指示

このドキュメントは、`C:\Users\rex02\Projects\ksql-dashboard` フォルダを開いた **VSCode + Claude Code** で開発を継続するための引き継ぎ資料です。まずこれを読んでから作業してください。

---

## 0. まず把握すること

- 本プロジェクトは **kintone プラグイン（サンプル）**。レコード一覧画面に、kSQL(SQL方言)で取得したデータを **1〜4 分割ダッシュボード**として表・グラフ表示する。
- データ取得は **kSQL エンジン read-only ライブラリ（別プロジェクト「B66」）** の公開 API を使う。**実物ビルド v3.19.0 を `js/ksql-engine.umd.js` に同梱済み**（`@rex0220/kintone-sql-tools` の `dist-engine/ksql-engine.umd.js` をコピー）。
- 現状は雛形＋SQL 検証機能がコミット済み。設定画面・レイアウト・表/グラフ描画・SQL 検証が実エンジンで動作する。

## 1. ディレクトリ構成と各ファイルの役割

```
ksql-dashboard/
├── manifest.json          プラグイン定義（desktop / config の js・css・icon）
├── README.md              利用者向け説明・パッケージ手順
├── html/config.html       設定画面 UI（分割選択＋ペイン一覧＋<template>）
├── js/config.js           設定ロジック（getConfig/setConfig・ペイン動的生成・検証）
├── js/desktop.js          ダッシュボード描画（config読込→grid→runQuery→表/グラフ）
├── js/ksql-engine.umd.js  B66 実物ビルド v3.19.0（親リポジトリ dist-engine からコピー）
├── css/config.css
├── css/desktop.css
├── image/icon.png         48x48 プレースホルダ（要差し替え）
└── docs/handoff.md        本書
```

## 2. 機能仕様（実装済み）

- **設定画面**（`config.html` / `config.js`）
  - 画面分割数を **1 / 2 / 3 / 4** から選択。分割数に応じて「ペイン一覧」を動的生成。
  - ペインごとに: タイトル・**SQL 文**・**表示方法（表 / 棒グラフ）**・（グラフ時）ラベル列/値列。
  - 保存は `kintone.plugin.app.setConfig({ config: JSON.stringify(...) })`。
- **ダッシュボード描画**（`desktop.js`）
  - `app.record.index.show` で `kintone.app.getHeaderSpaceElement()` に描画。
  - 分割 grid（1=単一 / 2=横2 / 3=横3 / 4=2×2）。ペイン毎に SQL を実行し表/グラフ表示。
  - グラフは**依存なしのインライン SVG 風・横棒**（外部ライブラリ不要＝CSP 安全）。

### 設定データ構造
```json
{
  "split": "2",
  "panes": [
    { "title": "月次売上", "sql": "SELECT ...", "display": "table" },
    { "title": "担当別件数", "sql": "SELECT 担当, COUNT(*) AS 件数 FROM APP100 GROUP BY 担当",
      "display": "chart", "labelColumn": "担当", "valueColumn": "件数" }
  ]
}
```

## 3. B66（kSQL エンジン・ライブラリ）API 契約【重要・自己完結】

`desktop.js` はこの契約に配線済み。実物・プレースホルダとも同じ形。

### 取得（UMD・バージョン共存対応）
```js
// window.ksql は { versions, get } のレジストリ。必ず get(version) で明示取得する
var engine = window.ksql.get("3.19.0");   // 未登録なら undefined
var client = engine.createReadonlyKintoneClient();
```

### 実行
```js
// SELECT / WITH / UNION / SHOW APPS / DESCRIBE のみ（read-only）。DML は拒否される
var result = await engine.runQuery(sql, {
  client: client,
  maxRecords: 500,          // 任意・正の整数
  // fetchParallel, cursorMaxActive(1-5), onLimitReached("error"|"truncate") も任意
});
// 表示用 EXPLAIN
var plan = await engine.explainQuery(sql, { client: client }); // { lines, text, metrics }
```

> **注意**: `runQuery` が受ける単文は `SELECT`/`WITH`/`UNION [ALL]`/`SHOW APPS`/`DESCRIBE` だが、
> **`explainQuery` の対象は `SELECT`/`WITH`/`UNION [ALL]` のみ**。`SHOW`/`DESCRIBE` を explain すると
> 実行可能な SQL でもエラーになる。設定画面の検証は先頭キーワードで両者を振り分けている（`js/config.js`）。

### 結果型
```ts
QueryResult = {
  type: "query",
  columns: { name: string, valueType: "string" }[],   // SQL 出力列（順序保持）
  rows:    Record<string, string>[],                   // ★値はすべて文字列
  rowCount: number,
  warnings: string[],
  metrics: { recordGetCalls, fetchedRows, elapsedMs, cursorRecordsScanned }
}
ExplainResult = { type: "explain", lines: string[], text: string, metrics }
```

### エラー（`KsqlEngineError`・`err.code` で分岐）
`PARSE_ERROR` / `READ_ONLY_VIOLATION`（DML 等）/ `SEARCH_ABORTED`（10万件打ち切り＝**部分表示せず hard error**）/ `FETCH_LIMIT_EXCEEDED` / `CLIENT_ERROR` / `EXECUTION_ERROR`。

### 重要な性質
- **値はすべて文字列**。数値グラフは値列を `Number()` で解釈する（実装済み）。
- **read-only 専用**。INSERT/UPDATE/DELETE/UPSERT/APPLY/IMPORT 等は `READ_ONLY_VIOLATION`。
- **複数プラグインが別バージョンの kSQL を積んでも競合しない**設計（`window.ksql.versions[version]`・上書きしない）。だから `get("3.19.0")` のように**必ずバージョンを明示**する。

## 4. UMD の更新手順（B66 を新版に上げるとき）
1. `@rex0220/kintone-sql-tools` の **`dist-engine/ksql-engine.umd.js`** を取得（build 済みのもの）。
2. 本リポジトリの `js/ksql-engine.umd.js` を上書き。
   ```sh
   cp ../kintone-sql-tools/dist-engine/ksql-engine.umd.js js/ksql-engine.umd.js
   ```
3. **版を上げた場合は `KSQL_VERSION` を両方更新する**（`js/desktop.js` と `js/config.js`）。UMD は
   `window.ksql.versions[<版>]` に登録するため、定数がずれると `get()` が `undefined` になり
   「kSQL エンジン未読込」表示になる。
4. `manifest.json` の読み込み順は `js/ksql-engine.umd.js` → `js/desktop.js`（config も同様）。変更不要。
5. `npm run package` して実 kintone で確認。

> 現在同梱しているのは **v3.19.0**。仕様は親リポジトリ `docs/ksql_engine_library.md` が正。

## 5. 開発の進め方

- **動作確認**: 実エンジン同梱済みのため、実 kintone 上で実アプリに対して SQL を実行して確認する。
  例: `SELECT 担当, COUNT(*) AS 件数 FROM APP100 GROUP BY 担当` を設定し、グラフなら `labelColumn=担当`, `valueColumn=件数`。
  設定画面の「検証」ボタンで保存前に構文チェックできる（`SELECT`/`WITH`/`UNION` は `explainQuery`、`SHOW`/`DESCRIBE` は軽量 `runQuery`）。
- **パッケージ化**（kintone 標準 `cli-kintone` を使用。成果物は `dist/` 配下）:
  ```sh
  npm run package        # scripts/package.js: 鍵が無ければ keygen → plugin pack で dist/ksql-dashboard.zip
  ```
  生 CLI で行う場合:
  ```sh
  npx cli-kintone plugin keygen --output dist/ksql-dashboard.ppk   # 初回のみ
  npx cli-kintone plugin pack -i manifest.json -o dist/ksql-dashboard.zip --private-key dist/ksql-dashboard.ppk
  ```
  `--private-key` を常に同じ鍵で指定するため **plugin ID は固定**される（旧 `@kintone/plugin-packer` は鍵未指定だと毎回 ID が変わったが、`cli-kintone` は `--private-key` 必須）。`dist/`（`*.zip`/`*.ppk`）は `.gitignore` 済み（コミットしない）。**`.ppk` は再アップデートに必要なので安全に保管**。鍵を作り直す場合は `npm run package -- --new`。
- **git**: このフォルダは独立 git リポジトリ。変更はここでコミットする（親 kintone-sql-tools とは別）。

## 6. 次の作業候補（TODO・優先度順の目安）

1. **アイコン差し替え** — `image/icon.png` を実用的な 48×48（or より大きい）PNG に。
2. **SQL プレビュー検証** — 設定画面の各ペインに「検証」ボタン→ `engine.explainQuery(sql, {client})` or `runQuery` で実行前チェック（`window.ksql` があれば）。エラーは `err.code`/`err.message` を表示。
3. **グラフ種類の追加** — 現状は横棒のみ。円・折れ線・数値カード等。依存を増やさない方針（CSP）なら SVG 自前描画。
4. **レイアウトの柔軟化** — 3分割の縦横、4分割の比率、ペインごとの高さ指定など。
5. **エラー/空状態の UX** — `SEARCH_ABORTED`（大量データ）・0件・未設定時の表示改善。
6. **自動更新** — 一定間隔で `runQuery` を再実行するリフレッシュ（任意）。
7. **設定の入出力** — 設定の JSON エクスポート/インポート。

## 7. 規約・注意

- **CSP**: kintone プラグインは外部 CDN スクリプトを読めない。ライブラリ追加は避け、必要なら同梱＋自前実装（現状グラフは自前 SVG）。
- **値は文字列**: B66 の仕様。数値・日付は表示側で解釈する。
- **kintone プラグイン規約**: `kintone.$PLUGIN_ID` で PLUGIN_ID を受ける（config.js/desktop.js は IIFE で受領済み）。設定は `kintone.plugin.app.getConfig/setConfig`。
- **manifest 参照ファイルは実在必須**: 参照先が無いと pack が失敗する（`js/ksql-engine.umd.js` は常に配置しておく）。
- **コミット単位**: 機能ごとに小さく。`*.zip`/`*.ppk`/`node_modules` は `.gitignore` 済み。

## 8. 作業開始時のチェックリスト

- [ ] `git log --oneline` で現状コミットを確認。
- [ ] `manifest.json` の参照ファイルが全て存在するか（`node -e` や find で確認）。
- [ ] 変更後 `npm run package`（cli-kintone plugin pack）が成功するか。
- [ ] `desktop.js` が B66 API 契約（§3）から外れていないか（実物差し替え時に壊れないため）。
