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
  - 設定した分割レイアウトでペインを配置（1=単一 / 2=横2 / 3=上2下1 / 4=2×2）
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

### エンジンの同梱

`@rex0220/kintone-sql-tools` の **UMD ビルド v3.19.0** を `src/js/ksql-engine.umd.js` として同梱済み。
`src/manifest.json` は `js/ksql-engine.umd.js` → `js/desktop.js`（config も同順）で読み込む（パスは manifest からの相対）。

更新する場合は親リポジトリの `dist-engine/ksql-engine.umd.js` を再コピーし、**版を上げたときは
`src/js/desktop.js` と `src/js/config.js` の `KSQL_VERSION` も更新**する。

> **注意**: UMD は必ず `window.ksql.get("<version>")` で**バージョンを明示**して取得する（複数プラグインの別バージョン共存対策）。`get()` が `undefined` を返す場合、ダッシュボードは「kSQL エンジン未読込」と表示する。

## ディレクトリ

プラグイン本体は `src/` 配下、ビルド関連はルート。

```
ksql-dashboard/
├── src/                    プラグイン本体（pack 対象）
│   ├── manifest.json       プラグイン定義
│   ├── html/config.html    設定画面
│   ├── js/config.js        設定画面ロジック
│   ├── js/desktop.js       ダッシュボード描画
│   ├── js/ksql-engine.umd.js  kSQL エンジン UMD v3.19.0（同梱）
│   ├── css/config.css
│   ├── css/desktop.css
│   └── image/icon.png      (48x48 プレースホルダ・要差し替え)
├── scripts/package.js      zip 作成／アップロード（cli-kintone）
├── package.json            npm run package / upload
├── keys/                   署名の秘密鍵 .ppk（gitignore・要保管）
└── dist/                   生成物 zip（コミット対象）
```

## パッケージ化

kintone 標準 CLI（`cli-kintone`）で zip 化する。成果物は `dist/` 配下に出力する（`dist/` は `.gitignore` 済み）。

```sh
npm run package
```

`scripts/package.js` が以下を実行する:

1. 秘密鍵 `keys/ksql-dashboard.ppk` が無ければ `cli-kintone plugin keygen` で生成
2. `cli-kintone plugin pack` で `dist/ksql-dashboard-v<version>.zip` を作成（version は `src/manifest.json` から。`--private-key` を常に同じ鍵で指定するため **plugin ID は固定**）

同等の生 CLI コマンド（`<version>` は manifest の値。例: `1.0.0`）:

```sh
npx cli-kintone plugin keygen --output keys/ksql-dashboard.ppk
npx cli-kintone plugin pack \
  --input src/manifest.json \
  --output dist/ksql-dashboard-v1.0.0.zip \
  --private-key keys/ksql-dashboard.ppk
```

- 鍵を作り直す（plugin ID を変える）場合は `npm run package -- --new`。
- **`keys/*.ppk` は再アップデートに必要**。安全に保管すること（`.gitignore` 済みでコミットされない）。ビルド zip（`dist/`）はコミット対象。

## アップロード

`cli-kintone plugin upload` で kintone へ反映する。用途に応じて3つ:

```sh
cp .env.example .env    # 初回のみ。認証情報を記入（.env はコミットされない）

npm run package         # ① ビルドのみ（dist/ksql-dashboard-v<version>.zip を作成）
npm run package:upload  # ② ビルド＋アップロード
npm run upload          # ③ アップロードのみ（既存 zip を再ビルドせず反映）
```

`.env` に以下を設定する:

```
KINTONE_BASE_URL=https://example.cybozu.com
KINTONE_USERNAME=your-login-name
KINTONE_PASSWORD=your-password
```

- `package:upload` = `package` ＋ `plugin upload`。`upload` は**アップロードのみ**（`dist/ksql-dashboard-v<version>.zip` が無ければ中断）。
- 認証情報は環境変数（`.env` かシェル）で渡す。未設定なら実行前に中断する。
- アップロードは**システムのプラグイン更新**まで。各アプリでの反映は、プラグイン有効化＋「アプリを更新」（設定画面の「運用環境に反映」でも可）。

## 設定データ構造（getConfig / setConfig）

共通ダッシュボード（`__default__`＝すべての一覧）と一覧別（キー＝`viewId`）を持つ。一覧別は `enabled`（表示可否）と `source`（`common`＝共通を表示／`individual`＝この一覧専用）で表示を決める。表示時は `app.record.index.show` の `event.viewId` で選択する。

```json
{
  "deployOnSave": false,
  "dashboards": {
    "__default__": {
      "enabled": true,
      "split": "1",
      "panes": [ { "title": "全体", "sql": "SELECT ...", "display": "table" } ]
    },
    "5000123": {
      "enabled": true,
      "source": "individual",
      "split": "2",
      "panes": [
        { "title": "月次売上", "sql": "SELECT ...", "display": "table" },
        { "title": "担当別件数", "sql": "SELECT 担当, COUNT(*) AS 件数 FROM APP100 GROUP BY 担当",
          "display": "chart", "labelColumn": "担当", "valueColumn": "件数" }
      ]
    }
  }
}
```

- 一覧別エントリなし → **共通を継承**（共通が有効なら表示）。`source:"common"` も共通を表示。`enabled:false` はその一覧で非表示。
- 旧形式 `{ split, panes }` は `dashboards.__default__`（共通）へ自動移行する。

## 制約・注意（サンプル）

- グラフは依存を持たない**インライン SVG 棒グラフ**（外部ライブラリ不要・CSP 安全）。本格的な可視化は用途に応じて差し替え。
- kSQL の値はすべて**文字列**で返る（B66 Phase1 仕様）。数値グラフは値列を `Number()` で解釈する。
- 検索打ち切り（10万件）等はエンジン側で `SEARCH_ABORTED` の hard error になる（部分表示しない）。
