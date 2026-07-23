/* ksql-engine.umd.js — プレースホルダ（B66 リリース前の暫定版）
 *
 * ここは本物ではありません。B66（kSQL エンジン read-only ライブラリ）の
 * UMD ビルド dist-engine/ksql-engine.umd.js に差し替えてください。
 *
 * 本プレースホルダは B66 公開 API の「形」だけを再現し、
 * runQuery は固定のサンプルデータを返します（設定/レイアウト/表・グラフ描画の確認用）。
 *   - window.ksql = { versions, get }（複数バージョン共存レジストリ・§4.5）
 *   - engine.version / engine.createReadonlyKintoneClient() / engine.runQuery() / engine.explainQuery()
 */
(function (global) {
  "use strict";

  var VERSION = "3.19.0";

  // ---- B66 §4.5 UMD version registry（上書きしない・重複は warn）----
  var registry = global.ksql;
  if (registry && (typeof registry.get !== "function" || typeof registry.versions !== "object")) {
    // 既存 window.ksql が registry 契約を満たさない場合は上書きせず中断
    console.error("[ksql placeholder] 既存の window.ksql が registry 契約を満たしません。初期化を中断します。");
    return;
  }
  if (!registry) {
    registry = { versions: {}, get: function (v) { return this.versions[v] || undefined; } };
    global.ksql = registry;
  }

  // ---- プレースホルダのサンプルデータ ----
  function sampleResult() {
    var columns = [
      { name: "区分", valueType: "string" },
      { name: "件数", valueType: "string" },
      { name: "金額", valueType: "string" }
    ];
    var rows = [
      { "区分": "受注", "件数": "12", "金額": "3400000" },
      { "区分": "商談", "件数": "8", "金額": "1800000" },
      { "区分": "引合", "件数": "15", "金額": "900000" },
      { "区分": "失注", "件数": "4", "金額": "0" }
    ];
    return {
      type: "query",
      columns: columns,
      rows: rows,
      rowCount: rows.length,
      warnings: ["placeholder engine: サンプルデータを返しています（B66 未配置）"],
      metrics: { recordGetCalls: 0, fetchedRows: rows.length, elapsedMs: 0, cursorRecordsScanned: 0 }
    };
  }

  function makeEngine() {
    return {
      version: VERSION,
      createReadonlyKintoneClient: function () {
        // 本物は kintone.api ベースの read-only クライアントを返す
        return { __placeholder: true };
      },
      runQuery: function (sql, options) {
        console.warn("[ksql placeholder] runQuery はサンプルデータを返します。B66 の UMD に差し替えてください。SQL:", sql);
        return Promise.resolve(sampleResult());
      },
      explainQuery: function (sql, options) {
        return Promise.resolve({
          type: "explain",
          lines: ["placeholder EXPLAIN", "SQL: " + sql],
          text: "placeholder EXPLAIN\nSQL: " + sql,
          metrics: { recordGetCalls: 0, fetchedRows: 0, elapsedMs: 0, cursorRecordsScanned: 0 }
        });
      }
    };
  }

  // 別バージョンが既に居ても上書きしない／同版重複は warn
  if (registry.versions[VERSION]) {
    console.warn("[ksql placeholder] version " + VERSION + " は既に登録済みです。先着を維持します。");
  } else {
    registry.versions[VERSION] = Object.freeze(makeEngine());
  }
})(typeof window !== "undefined" ? window : this);
