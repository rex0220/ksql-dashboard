# kSQL Dashboard（サンプルプラグイン）

kintone アプリのレコード一覧画面に、**kSQL で取得したデータを 1〜4 分割のダッシュボード**として表示するサンプルプラグイン。各ペインに SQL 文と表示方法（表 / グラフ）を指定できる。

データ取得は **kSQL エンジン・ライブラリ（B66・read-only）** の公開 API を利用する想定。

## 機能

- **プラグイン設定画面**
  - 画面分割数を **1 / 2 / 3 / 4** から選択
  - 分割数に応じて表示される**ペイン一覧**（＝選択したカスタマイズ一覧）に、ペインごとの設定
    - タイトル
    - **SQL 文**（kSQL の `SELECT` / `WITH` / `UNION` …）
    - **表示方法**（表 / 棒グラフ）
    - グラフ時のラベル列・値列
- **ダッシュボード表示**（レコード一覧画面）
  - 設定した分割レイアウトでペインを配置（1=単一 / 2=横2 / 3=横3 / 4=2×2）
  - ペインごとに SQL を実行し、表またはグラフで描画

## kSQL エンジン・ライブラリ（B66）との連携

本プラグインは、read-only の kSQL 実行を次の公開 API で行う（B66 Phase1・仕様準拠）。

```js
// UMD をプラグインに同梱し、バージョンを明示して取得
var engine = window.ksql.get("3.19.0");
var client = engine.createReadonlyKintoneClient();
var result = await engine.runQuery(sql, { client: client, maxRecords: 500 });
// result.columns: [{ name, valueType:"string" }]
// result.rows:    [{ 列名: "値(すべて文字列)" }]
```

### 導入手順（B66 リリース後）

1. `@rex0220/kintone-sql-tools`（v3.19.0 以降）の **UMD ビルド `dist-engine/ksql-engine.umd.js`** を、この plugin の `js/ksql-engine.umd.js` として配置する。
2. `manifest.json` の `desktop.js` は既に `js/ksql-engine.umd.js` → `js/desktop.js` の順で読み込む。
3. パッケージ化してアップロード。

> **注意**: UMD は必ず `window.ksql.get("<version>")` で**バージョンを明示**して取得する（複数プラグインの別バージョン共存対策）。`js/ksql-engine.umd.js` が未配置の場合、ダッシュボードは「kSQL エンジン未読込」のプレースホルダを表示する（設定・レイアウトの確認は可能）。

## ディレクトリ

```
ksql-dashboard/
├── manifest.json          プラグイン定義
├── html/config.html       設定画面
├── js/config.js           設定画面ロジック
├── js/desktop.js          ダッシュボード描画
├── js/ksql-engine.umd.js  (B66 リリース後に配置)
├── css/config.css
├── css/desktop.css
└── image/icon.png         (48x48 プレースホルダ・要差し替え)
```

## パッケージ化

kintone プラグインパッカーで zip 化する。

```sh
# 成果物は dist/ 配下に出力する（dist/*.zip・dist/*.ppk は .gitignore 済み）
npx @kintone/plugin-packer . --out dist/ksql-dashboard.zip
# 初回は dist/<plugin-id>.ppk（秘密鍵）が生成される。
# 2 回目以降は同じ plugin ID を維持するため既存の .ppk を指定する:
#   npx @kintone/plugin-packer . --out dist/ksql-dashboard.zip --ppk dist/<plugin-id>.ppk
```

## 設定データ構造（getConfig / setConfig）

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

## 制約・注意（サンプル）

- グラフは依存を持たない**インライン SVG 棒グラフ**（外部ライブラリ不要・CSP 安全）。本格的な可視化は用途に応じて差し替え。
- kSQL の値はすべて**文字列**で返る（B66 Phase1 仕様）。数値グラフは値列を `Number()` で解釈する。
- 検索打ち切り（10万件）等はエンジン側で `SEARCH_ABORTED` の hard error になる（部分表示しない）。
