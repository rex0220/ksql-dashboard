# Changelog

kSQL Dashboard（kintone プラグイン）の変更履歴。同梱する kSQL エンジン（`@rex0220/kintone-sql-tools`）のバージョンも併記する。

## v1.4.0（2026-08-02）

### 修正（列の英字小文字表示問題）

- **表の見出しが、SQL に書いた別名の表記どおりに表示されるようにした。** SELECT 別名の英字は engine の parse 時に小文字へ正規化されるため（例: `AS Count` → 結果列名 `count`）、従来は表の見出しが小文字で表示されていた。v3.38.0 で追加された `QueryColumn.displayName`（書かれた別名の表記）を見出しに優先使用する（`displayName` が無い列は従来どおり `name`）。
- **グラフのラベル列・値列の指定を、大文字小文字を無視して解決するようにした。** 行キーは小文字化されるため、利用者が書いたとおりの表記（英大文字混じり）で指定しても、`name` / `displayName` に対して完全一致 → 大小無視の順で実キーへ対応付ける。日本語列名は従来どおり。
- 設定画面の「検証」の列一覧も `displayName` 優先で表示する。
- 結果行のキー・`columns[].name`・照合（重複検査・`ORDER BY` / `HAVING`・`UNION` の列合わせ）は engine 側で不変のため、既存の設定・SQL の挙動は変わらない（表示のみの修正）。

### 変更

- **同梱 kSQL エンジンを v3.36.0 → v3.38.0 に更新**（`src/js/ksql-engine.umd.js` を親リポジトリ `dist-engine/ksql-engine.umd.js` から再コピー）。
- エンジンの UMD レジストリキーに合わせ、`src/js/desktop.js` / `src/js/config.js` の `KSQL_VERSION` を `"3.38.0"` に更新（`window.ksql.get("3.38.0")`）。
- ドキュメント（README.md / CLAUDE.md）のバージョン表記を v3.38.0 に更新。

破壊的変更なし・純加法の更新。

### 同梱エンジンの主な変更（v3.37.0 → v3.38.0）

- **v3.38.0（B110）**: engine ライブラリの `QueryColumn` に `displayName?`（SQL に書かれた別名の表記・バッククォートは剥がした中身）を純加法で追加（本修正が使用）。結果行キー・`columns[].name` は小文字のまま不変。
- **v3.37.0（B107/B108）**: 論理アプリ名 `LAPP_<NAME>` の日本語対応。文として書いた `EXPLAIN` の内部 ID 露出を修正。

同梱エンジンの詳細は親リポジトリの [CHANGELOG](https://github.com/rex0220/kintone-sql-tools/blob/main/CHANGELOG.md) を参照。

## v1.3.0（2026-07-31）

### 変更

- **同梱 kSQL エンジンを v3.35.0 → v3.36.0 に更新**（`src/js/ksql-engine.umd.js` を親リポジトリ `dist-engine/ksql-engine.umd.js` から再コピー）。
- エンジンの UMD レジストリキーに合わせ、`src/js/desktop.js` / `src/js/config.js` の `KSQL_VERSION` を `"3.36.0"` に更新（`window.ksql.get("3.36.0")`）。
- ドキュメント（README.md / CLAUDE.md）のバージョン表記を v3.36.0 に更新。

破壊的変更なし・純加法の更新。プラグインの SQL 方言・設定データ構造・UI に変更はない。

### 同梱エンジンの主な変更（v3.36.0）

- **v3.36.0（B105）**: `UNION` / `UNION ALL` の各枝の `SELECT COUNT(*)` が、単体と同じく `totalCount` の単発 GET になった（リテラル列との併用も対象）。従来は枝内だと FULL_SCAN に落ち、既定 `maxRecords` を超えるアプリでエラー停止していた件数一覧の定型が動くようになる。失われる正しい結果はない（純加法）。

同梱エンジンの詳細は親リポジトリの [CHANGELOG](https://github.com/rex0220/kintone-sql-tools/blob/main/CHANGELOG.md) を参照。

## v1.2.0（2026-07-30）

### 追加（バッチ処理・複数 SQL 対応）

- **各ペインで複数の SQL（バッチ）を実行できるようになった。** 実行はエンジンの `runBatch()` に一本化した（`runBatch` は単文・複数文の両方に対応）。`;` 区切りで `CREATE TEMP TABLE` / `SET` / `DECLARE` などを組み合わせて、一時テーブルの構築 → 集計 → 表示までを 1 ペインで完結できる。
  ```sql
  CREATE TEMP TABLE #g AS SELECT 担当, SUM(売上) AS 売上 FROM APP100 GROUP BY 担当;
  SET @total = (SELECT SUM(売上) FROM #g);
  SELECT 担当, 売上, ROUND(売上 * 100 / @total, 1) AS 構成比 FROM #g ORDER BY 売上 DESC
  ```
- **表示は「最後に行を返す文」（＝最終 SELECT）の結果**。行を返す文が無いバッチは「結果を返す文がありません」と表示する。結果セットが複数あるときは最後の結果を表示する旨を添える。
- バッチは fail-closed（1 文でも失敗すると全体がエラー）。失敗時はエラーに**何文目・文型**を併記する。
- 設定画面の「検証」は複数文にも対応（`explainQuery` のバッチ対応・データ取得なし）。SQL 欄にバッチ対応のヒントを追記。

### 変更

- **同梱 kSQL エンジンを v3.25.0 → v3.35.0 に更新**（`src/js/ksql-engine.umd.js` を親リポジトリ `dist-engine/ksql-engine.umd.js` から再コピー）。
- エンジンの UMD レジストリキーに合わせ、`src/js/desktop.js` / `src/js/config.js` の `KSQL_VERSION` を `"3.35.0"` に更新（`window.ksql.get("3.35.0")`）。
- ドキュメント（README.md / CLAUDE.md）のバージョン表記を v3.35.0 に更新。

> **⚠ エンジン更新に伴う破壊的変更に注意（ダッシュボード SQL への影響）**
> v3.26.0〜v3.35.0 には、従来 silent に 0 件・部分結果になっていた形を**取得前エラーにする**変更が含まれます。既存ダッシュボードの SQL がエンジン更新後にエラーになる場合があります。
> - 外部結合で保持されない側が検索打ち切りに達した場合の fail-closed 化（v3.27.0 / v3.34.0）。
> - 実体化ソース（一時テーブル・CTE）の存在しない列参照を fail-closed 化（v3.30.0）。
>
> （v3.25.0 の `TODAY()` / `NOW()` / `LOGINUSER()`・型不一致演算子の破壊的変更は v1.1.0 で導入済み。v1.0.0 から直接更新する場合は下の v1.1.0 の注意も参照してください。）
> 各ペインの SQL を見直してください（設定画面の「検証」で事前確認できます）。

### 同梱エンジンの主な変更（v3.26.0 → v3.35.0）

- **v3.29.0（B68）**: read-only engine ライブラリに **`runBatch(sql, options)` を追加**。`CREATE` / `DROP TEMP TABLE`・`SET` / `DECLARE`・`ASSERT`・`EXPLAIN` を含む複文を実行できる（本プラグインのバッチ対応の基盤）。
- **v3.31.0（B89/B90）**: `explainQuery` が複文（バッチ）を受理・受理集合を `runBatch` と統一。SELECT 算術式でバッチ変数（`@total` など）を直接使えるように。バッチ静的検証エラーに `statementIndex` / `statementType` を付与。
- **v3.27.0 / v3.30.0 / v3.34.0**: 【破壊的変更】外部結合の検索打ち切り、実体化ソースの不存在列参照、保持されない側の打ち切りをそれぞれ fail-closed 化。
- **v3.32.0（B95/B94）**: 取得上限の打ち切りを `metrics` へ構造化。`SELECT COUNT(*)` を `totalCount` で単発取得。

同梱エンジンの詳細は親リポジトリの [CHANGELOG](https://github.com/rex0220/kintone-sql-tools/blob/main/CHANGELOG.md) を参照。

## v1.1.0（2026-07-27）

### 変更

- **同梱 kSQL エンジンを v3.21.0 → v3.25.0 に更新**（`src/js/ksql-engine.umd.js` を親リポジトリ `dist-engine/ksql-engine.umd.js` から再コピー）。
- エンジンの UMD レジストリキーに合わせ、`src/js/desktop.js` / `src/js/config.js` の `KSQL_VERSION` を `"3.21.0"` → `"3.25.0"` に更新（`window.ksql.get("3.25.0")`）。
- ドキュメント（README.md / CLAUDE.md）のバージョン表記を v3.25.0 に更新。

プラグイン自体の SQL 方言・設定データ構造・UI に変更はない。ただし下記 v3.25.0 の破壊的変更により、**既存ダッシュボードの SQL がエンジン更新後にエラーになる場合がある**（該当クエリは要修正）。

> **⚠ v3.25.0 の破壊的変更に注意（ダッシュボード SQL への影響）**
> `WHERE` 句で `TODAY()` / `NOW()` / `LOGINUSER()` を使う一部の形と、ユーザー系・複数選択系フィールドへ `=` / `!=` を書く形が、取得前にエラー（`WHERE_KINTONE_FUNCTION_REQUIRES_EXACT_PUSHDOWN` / `WHERE_OPERATOR_INVALID_FOR_FIELD_TYPE`）になります。従来 silent に 0 件・client 評価へ落ちていた形が対象です。
> 例: `WHERE 作成者 = 'taro'` → `WHERE 作成者 in ('taro')`、`WHERE 日付 = NOW()` → 固定日時リテラルまたは押し下げ可能な形へ。
> 各ペインの SQL を見直してください。

### 同梱エンジンの主な変更（v3.22.0 → v3.25.0）

- **v3.25.0**: 【破壊的変更（minor）】`WHERE` の `TODAY()` / `NOW()` / `LOGINUSER()` を kintone クエリへ安全に押し下げられる形のみ許可し、それ以外は取得前に fail-closed。ユーザー系・複数選択系フィールドへの型不一致演算子（`=` / `!=` など）も silent 0 rows ではなくエラーに。一方で `WHERE 作成者 in (LOGINUSER())` など新たに使える形も追加、相対日付を CTE・一時テーブルでも使えるよう拡張（B75）。
- **v3.24.0**: `WHERE` 全体が押し下げ可能なら、`GROUP BY` / `SELECT DISTINCT` / 集計関数 / ウィンドウ関数 / 通常の `ORDER BY` を含む集計クエリでも相対日付関数（`THIS_MONTH()` など）を使えるようになった（純加法・既存クエリの結果は不変）。
- **v3.23.0**: 【バグ修正】`GROUP BY` に SELECT のエイリアスを指定すると、エラーにならないまま全行が1グループへ潰れて誤集計していた不具合を修正。修正後は式そのものを指定した場合と同じ正しい集計結果になる（⚠ 該当クエリの結果が変わる）。
- **v3.22.0**: engine ライブラリ `runQuery()` の `QueryColumn` に列メタ（`fieldType?` / `sortKind?` / `sourceApp?`）を後方互換で追加。既存 consumer は無影響。

同梱エンジンの詳細は親リポジトリの [CHANGELOG](https://github.com/rex0220/kintone-sql-tools/blob/main/CHANGELOG.md) を参照。

## v1.0.0

- 初回リリース。kSQL(read-only) で取得したデータを 1〜4 分割ダッシュボードとして表・グラフ表示する kintone プラグイン。
- 同梱 kSQL エンジン: v3.21.0。
