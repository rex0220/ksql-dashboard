# Changelog

kSQL Dashboard（kintone プラグイン）の変更履歴。同梱する kSQL エンジン（`@rex0220/kintone-sql-tools`）のバージョンも併記する。

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
