/* kSQL Dashboard — 設定画面ロジック
 * 画面分割数(1-4)と、ペインごとの SQL・表示方法(表/グラフ)を設定し、
 * kintone.plugin.app.setConfig で保存する。
 */
(function (PLUGIN_ID) {
  "use strict";

  var MAX_PANES = 4;
  // desktop.js と同じく UMD レジストリから明示バージョンで取得する
  var KSQL_VERSION = "3.19.0";
  // SHOW/DESCRIBE 検証時の取得上限（メタデータなので小さくてよい）
  var VALIDATE_MAX_RECORDS = 100;

  var $split = document.getElementById("ksqld-split");
  var $panes = document.getElementById("ksqld-panes");
  var $save = document.getElementById("ksqld-save");
  var $cancel = document.getElementById("ksqld-cancel");
  var $message = document.getElementById("ksqld-message");
  var $template = document.getElementById("ksqld-pane-template");
  var $deploy = document.getElementById("ksqld-deploy");

  // 既存設定の読込
  var saved = kintone.plugin.app.getConfig(PLUGIN_ID);
  var config = { split: "1", panes: [] };
  if (saved && saved.config) {
    try { config = JSON.parse(saved.config); } catch (e) { /* 破損時は初期値 */ }
  }
  if (!Array.isArray(config.panes)) { config.panes = []; }
  if (["1", "2", "3", "4"].indexOf(String(config.split)) === -1) { config.split = "1"; }

  // kSQL エンジンの取得（config 画面にも UMD を読み込み済み・未読込なら null）
  function getEngine() {
    if (window.ksql && typeof window.ksql.get === "function") {
      return window.ksql.get(KSQL_VERSION) || null;
    }
    return null;
  }

  // 検証結果の表示（ステータス行＋EXPLAIN/警告の詳細）
  function setValidateResult($status, $plan, text, kind, detail) {
    $status.textContent = text;
    $status.className = "ksqld-validate-result" + (kind ? " " + kind : "");
    if (detail) {
      $plan.textContent = detail;
      $plan.hidden = false;
    } else {
      $plan.textContent = "";
      $plan.hidden = true;
    }
  }

  // 先頭コメント／空白を除いた最初のキーワードを取り出す
  function leadingKeyword(sql) {
    var s = String(sql);
    var prev;
    do {
      prev = s;
      s = s.replace(/^\s+/, "").replace(/^--[^\n]*\n?/, "").replace(/^\/\*[\s\S]*?\*\//, "");
    } while (s !== prev);
    var m = /^([A-Za-z]+)/.exec(s);
    return m ? m[1].toUpperCase() : "";
  }

  // SHOW APPS / DESCRIBE は runQuery では実行できるが explainQuery の対象外（B66 仕様）。
  // これらは explain せず、軽量な runQuery で検証する。
  function isExplainable(sql) {
    var kw = leadingKeyword(sql);
    return kw !== "SHOW" && kw !== "DESCRIBE" && kw !== "DESC";
  }

  // 保存前の SQL 検証（explainQuery で実行前チェック・データ取得はしない）
  function validateSql(card) {
    var $status = card.querySelector(".ksqld-validate-result");
    var $plan = card.querySelector(".ksqld-validate-plan");
    var $button = card.querySelector(".ksqld-validate");
    var sql = card.querySelector(".ksqld-pane-sql").value.trim();

    if (!sql) { setValidateResult($status, $plan, "SQL が未入力です。", "error"); return; }
    var engine = getEngine();
    if (!engine) {
      setValidateResult($status, $plan, "kSQL エンジン未読込のため検証できません。", "note");
      return;
    }

    $button.disabled = true;
    setValidateResult($status, $plan, "検証中…", "note");
    var client = engine.createReadonlyKintoneClient();

    // SELECT/WITH/UNION は explain（データ取得なし）、SHOW/DESCRIBE は軽量 runQuery で検証
    var run = isExplainable(sql)
      ? engine.explainQuery(sql, { client: client }).then(function (plan) {
          return {
            ok: "OK: 実行可能な SQL です。",
            detail: plan && plan.text ? plan.text
              : (plan && plan.lines ? plan.lines.join("\n") : ""),
            warnings: plan && plan.warnings
          };
        })
      : engine.runQuery(sql, { client: client, maxRecords: VALIDATE_MAX_RECORDS }).then(function (result) {
          var cols = (result && result.columns || []).map(function (c) { return c.name; });
          return {
            ok: "OK: 実行可能な SQL です（" + (result ? result.rowCount : 0) + " 件）。",
            detail: cols.length ? "列: " + cols.join(", ") : "",
            warnings: result && result.warnings
          };
        });

    run
      .then(function (r) {
        var detail = r.detail || "";
        if (r.warnings && r.warnings.length) {
          detail += (detail ? "\n\n" : "") + "警告:\n- " + r.warnings.join("\n- ");
        }
        setValidateResult($status, $plan, r.ok, "ok", detail);
      })
      .catch(function (err) {
        var code = (err && err.code) ? "[" + err.code + "] " : "";
        var msg = (err && err.message) ? err.message : "検証エラー";
        setValidateResult($status, $plan, code + msg, "error");
      })
      .then(function () { $button.disabled = false; });
  }

  // 1枚のペイン設定フォームを生成
  function buildPaneCard(index, pane) {
    var node = $template.content.cloneNode(true);
    var card = node.querySelector(".ksqld-pane-card");
    card.querySelector(".ksqld-pane-index").textContent = String(index + 1);
    card.querySelector(".ksqld-pane-title").value = pane.title || "";
    card.querySelector(".ksqld-pane-sql").value = pane.sql || "";
    card.querySelector(".ksqld-pane-type").value = pane.display === "chart" ? "chart" : "table";
    card.querySelector(".ksqld-pane-label-col").value = pane.labelColumn || "";
    card.querySelector(".ksqld-pane-value-col").value = pane.valueColumn || "";

    var $type = card.querySelector(".ksqld-pane-type");
    var $chartCols = card.querySelector(".ksqld-chart-cols");
    function toggleChartCols() { $chartCols.hidden = $type.value !== "chart"; }
    $type.addEventListener("change", toggleChartCols);
    toggleChartCols();

    card.querySelector(".ksqld-validate").addEventListener("click", function () {
      validateSql(card);
    });

    return card;
  }

  // 分割数に応じてペインフォームを描画（入力中の値は保持）
  function renderPanes() {
    var count = parseInt($split.value, 10) || 1;
    var current = collectPanes(); // 画面上の入力を退避
    $panes.innerHTML = "";
    for (var i = 0; i < count && i < MAX_PANES; i++) {
      var pane = current[i] || config.panes[i] || {};
      $panes.appendChild(buildPaneCard(i, pane));
    }
  }

  // 画面上のペイン入力を配列で収集
  function collectPanes() {
    var cards = $panes.querySelectorAll(".ksqld-pane-card");
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      out.push({
        title: c.querySelector(".ksqld-pane-title").value.trim(),
        sql: c.querySelector(".ksqld-pane-sql").value.trim(),
        display: c.querySelector(".ksqld-pane-type").value === "chart" ? "chart" : "table",
        labelColumn: c.querySelector(".ksqld-pane-label-col").value.trim(),
        valueColumn: c.querySelector(".ksqld-pane-value-col").value.trim()
      });
    }
    return out;
  }

  function showMessage(text, kind) {
    $message.textContent = text;
    $message.className = "ksqld-message" + (kind ? " " + kind : "");
  }

  // --- 運用環境への反映（アプリのデプロイ）--------------------------------
  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // 設定画面のアプリ ID を取得（getId が null の場合は URL から拾う）
  function getAppId() {
    var id = (kintone.app && typeof kintone.app.getId === "function") ? kintone.app.getId() : null;
    if (id) { return id; }
    var m = location.pathname.match(/\/k\/admin\/app\/(\d+)\b/) ||
            location.search.match(/[?&]app=(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // ゲストスペース対応の kintone.api 呼び出し（Promise を返す）
  function kintoneApi(path, method, params) {
    return kintone.api(kintone.api.url(path, true), method, params);
  }

  // preview 設定を運用環境へデプロイし、完了状態まで待つ
  function deployApp(appId) {
    return kintoneApi("/k/v1/preview/app/deploy.json", "POST", { apps: [{ app: appId }] })
      .then(function () { return pollDeploy(appId, 0); });
  }

  function pollDeploy(appId, tries) {
    return kintoneApi("/k/v1/preview/app/deploy.json", "GET", { apps: [appId] })
      .then(function (resp) {
        var st = resp && resp.apps && resp.apps[0] ? resp.apps[0].status : null;
        if (st === "PROCESSING" && tries < 60) {
          return delay(1500).then(function () { return pollDeploy(appId, tries + 1); });
        }
        return st; // SUCCESS / FAIL / CANCEL / PROCESSING(タイムアウト)
      });
  }

  function apiErrorMessage(e) {
    if (!e) { return "反映エラー"; }
    if (e.message) { return e.message; }
    if (e.error) { return e.error; }
    return String(e);
  }

  function validate(split, panes) {
    for (var i = 0; i < panes.length; i++) {
      var p = panes[i];
      if (!p.sql) { return "ペイン " + (i + 1) + " の SQL が未入力です。"; }
      if (p.display === "chart" && (!p.labelColumn || !p.valueColumn)) {
        return "ペイン " + (i + 1) + " のグラフはラベル列・値列の指定が必要です。";
      }
    }
    return null;
  }

  // イベント
  $split.value = config.split;
  $deploy.checked = config.deployOnSave === true; // 前回の選択を復元
  renderPanes();
  $split.addEventListener("change", renderPanes);

  $save.addEventListener("click", function () {
    var split = $split.value;
    var panes = collectPanes();
    var err = validate(split, panes);
    if (err) { showMessage(err, "error"); return; }

    var doDeploy = $deploy.checked;
    $save.disabled = true;

    kintone.plugin.app.setConfig(
      { config: JSON.stringify({ split: split, panes: panes, deployOnSave: doDeploy }) },
      function () {
        // setConfig のコールバックが呼ばれた時点で preview へ保存済み
        if (!doDeploy) {
          showMessage("保存しました。（運用環境へ反映するにはアプリを更新してください）", "ok");
          $save.disabled = false;
          return;
        }
        var appId = getAppId();
        if (!appId) {
          showMessage("保存しましたが、アプリ ID を取得できず運用反映を実行できませんでした。", "error");
          $save.disabled = false;
          return;
        }
        showMessage("保存しました。運用環境へ反映中…", "note");
        deployApp(appId)
          .then(function (status) {
            if (status === "SUCCESS") {
              showMessage("保存し、運用環境へ反映しました。", "ok");
            } else if (status === "FAIL") {
              showMessage("保存しましたが、運用環境への反映に失敗しました（kintone 側でエラー）。", "error");
            } else if (status === "CANCEL") {
              showMessage("保存しましたが、運用環境への反映がキャンセルされました。", "error");
            } else {
              // PROCESSING のままタイムアウト
              showMessage("保存しました。運用環境へ反映を開始しました（反映完了まで少し時間がかかります）。", "ok");
            }
          })
          .catch(function (e) {
            showMessage("保存しましたが、運用反映でエラー: " + apiErrorMessage(e), "error");
          })
          .then(function () { $save.disabled = false; });
      }
    );
  });

  $cancel.addEventListener("click", function () {
    history.back();
  });
})(kintone.$PLUGIN_ID);
