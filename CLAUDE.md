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
```sh
# 成果物は dist/ 配下（dist/*.zip・dist/*.ppk は .gitignore 済み）
npx @kintone/plugin-packer . --out dist/ksql-dashboard.zip
# 2回目以降は plugin ID 固定のため: --ppk dist/<plugin-id>.ppk を付ける
```
