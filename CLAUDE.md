# kSQL Dashboard

kintone プラグイン（サンプル）。レコード一覧画面に、kSQL(read-only SQL方言)で取得したデータを **1〜4 分割ダッシュボード**として表・グラフ表示する。

## 最初に読むこと

**[docs/handoff.md](docs/handoff.md) を必ず最初に読む。** プロジェクトの現状・ファイル構成・B66（kSQL エンジン・ライブラリ）API 契約・次の作業候補・規約が自己完結でまとまっている。

## 要点（詳細は handoff.md）

- データ取得は B66（kSQL read-only ライブラリ）の `window.ksql.get("3.19.0").runQuery(sql, {client})` に配線済み。
- **B66 は未リリース**のため `js/ksql-engine.umd.js` は**プレースホルダ**（サンプルデータ返却）。リリース後に実物へ差し替える。
- 値は**すべて文字列**・**read-only 専用**（DML は `READ_ONLY_VIOLATION`）。
- CSP のため外部 CDN 不可（グラフは自前 SVG）。
- 独立 git リポジトリ。`*.zip`/`*.ppk`/`node_modules` は `.gitignore` 済み。

## パッケージ化
kintone 標準 CLI（`cli-kintone`）を使う。成果物は `dist/` 配下（`.gitignore` 済み）。
```sh
npm run package        # scripts/package.js: keygen(初回) → plugin pack
# 生 CLI: npx cli-kintone plugin pack -i manifest.json -o dist/ksql-dashboard.zip --private-key dist/ksql-dashboard.ppk
# 鍵を作り直す（plugin ID を変える）: npm run package -- --new
```
`--private-key` を常に同じ鍵で指定するため plugin ID は固定される。`dist/ksql-dashboard.ppk` は再アップデートに必要なので保管する。
