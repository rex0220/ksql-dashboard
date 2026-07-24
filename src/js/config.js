/* kSQL Dashboard — 設定画面ロジック
 * 一覧（ビュー）ごとにダッシュボード（画面分割数＋ペインの SQL・表示方法）を設定し、
 * kintone.plugin.app.setConfig で保存する。
 *
 * 設定データ構造:
 *   {
 *     deployOnSave: boolean,
 *     dashboards: {
 *       "__default__": { split, panes },   // 個別設定の無い一覧に適用
 *       "<viewId>":    { split, panes }     // その一覧専用
 *     }
 *   }
 */
(function (PLUGIN_ID) {
  "use strict";

  var MAX_PANES = 4;
  var DEFAULT_KEY = "__default__"; // 既定ダッシュボードのキー
  // desktop.js と同じく UMD レジストリから明示バージョンで取得する
  var KSQL_VERSION = "3.19.0";
  // SHOW/DESCRIBE 検証時の取得上限（メタデータなので小さくてよい）
  var VALIDATE_MAX_RECORDS = 100;

  var $view = document.getElementById("ksqld-view");
  var $enabled = document.getElementById("ksqld-enabled");
  var $enabledText = document.getElementById("ksqld-enabled-text");
  var $sourceRow = document.getElementById("ksqld-source-row");
  var $source = document.getElementById("ksqld-source");
  var $commonNote = document.getElementById("ksqld-common-note");
  var $editor = document.getElementById("ksqld-editor");
  var $split = document.getElementById("ksqld-split");
  var $panes = document.getElementById("ksqld-panes");
  var $save = document.getElementById("ksqld-save");
  var $cancel = document.getElementById("ksqld-cancel");
  var $message = document.getElementById("ksqld-message");
  var $template = document.getElementById("ksqld-pane-template");
  var $deploy = document.getElementById("ksqld-deploy");

  // --- 設定の読込と正規化（旧形式 { split, panes } からの移行を含む）---------
  function normalizeSplit(s) {
    return ["1", "2", "3", "4"].indexOf(String(s)) !== -1 ? String(s) : "1";
  }

  function normalizeConfig(raw) {
    var cfg = { deployOnSave: false, dashboards: {} };
    if (!raw || typeof raw !== "object") { return cfg; }
    cfg.deployOnSave = raw.deployOnSave === true;
    if (raw.dashboards && typeof raw.dashboards === "object") {
      Object.keys(raw.dashboards).forEach(function (k) {
        cfg.dashboards[k] = normalizeDash(k, raw.dashboards[k]);
      });
    } else if (Array.isArray(raw.panes)) {
      // 旧形式（単一ダッシュボード）→ 共通へ移行
      cfg.dashboards[DEFAULT_KEY] = { enabled: true, split: normalizeSplit(raw.split), panes: raw.panes };
    }
    return cfg;
  }

  // 1ダッシュボードの正規化。共通(__default__)は {enabled,split,panes}、
  // 一覧別は {enabled, source:"common"|"individual", split, panes}。
  function normalizeDash(key, d) {
    d = d || {};
    var panes = Array.isArray(d.panes) ? d.panes : [];
    if (key === DEFAULT_KEY) {
      return { enabled: d.enabled !== false, split: normalizeSplit(d.split), panes: panes };
    }
    // source 未指定の旧データは、ペインがあれば個別・無ければ共通とみなす
    var source = d.source === "individual" ? "individual"
      : d.source === "common" ? "common"
      : (panes.length ? "individual" : "common");
    return { enabled: d.enabled !== false, source: source, split: normalizeSplit(d.split), panes: panes };
  }

  function readSavedConfig() {
    var saved = kintone.plugin.app.getConfig(PLUGIN_ID);
    if (saved && saved.config) {
      try { return JSON.parse(saved.config); } catch (e) { /* 破損時は初期値 */ }
    }
    return null;
  }

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
    card.querySelector(".ksqld-pane-chart-type").value = pane.chartType === "column" ? "column" : "bar";
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

  // 指定枚数のペインフォームを描画
  function buildCards(panes, count) {
    $panes.innerHTML = "";
    for (var i = 0; i < count && i < MAX_PANES; i++) {
      $panes.appendChild(buildPaneCard(i, panes[i] || {}));
    }
  }

  // 分割数変更時：画面上の入力を保持して枚数だけ増減
  function onSplitChange() {
    buildCards(collectPanes(), parseInt($split.value, 10) || 1);
  }

  // 対象ビュー種別（共通/一覧別）と有効/共通・個別に応じて UI を切り替え
  function updateModeUI() {
    var isDefault = currentKey === DEFAULT_KEY;
    $enabledText.textContent = isDefault
      ? "共通ダッシュボードを有効にする（すべての一覧に表示）"
      : "この一覧でダッシュボードを表示する";
    $sourceRow.hidden = isDefault; // 共通(既定)は「共通/個別」選択を出さない

    var showEditor, showCommonNote;
    if (isDefault) {
      showEditor = true; showCommonNote = false;           // 共通は常に内容を編集
    } else if (!$enabled.checked) {
      showEditor = false; showCommonNote = false;           // 非表示
    } else if ($source.value === "individual") {
      showEditor = true; showCommonNote = false;            // 個別を編集
    } else {
      showEditor = false; showCommonNote = true;            // 共通を表示（編集は共通側）
    }
    $editor.hidden = !showEditor;
    $commonNote.hidden = !showCommonNote;
  }

  // 指定ダッシュボードをエディタへ読み込む（画面の入力は破棄して置換）
  function loadEditor(dash) {
    $enabled.checked = dash.enabled !== false;
    $source.value = dash.source === "individual" ? "individual" : "common";
    $split.value = normalizeSplit(dash.split);
    buildCards(dash.panes || [], parseInt($split.value, 10) || 1);
    updateModeUI();
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
        chartType: c.querySelector(".ksqld-pane-chart-type").value === "column" ? "column" : "bar",
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

  // --- ビュー一覧（設定対象の選択肢）--------------------------------------
  // preview のビュー一覧を取得（一覧系＝LIST／CUSTOM。未デプロイのビューも拾える）
  function fetchViews(appId) {
    return kintoneApi("/k/v1/preview/app/views.json", "GET", { app: appId })
      .then(function (resp) {
        var views = resp && resp.views ? resp.views : {};
        var list = [];
        Object.keys(views).forEach(function (name) {
          var v = views[name];
          if (v && (v.type === "LIST" || v.type === "CUSTOM")) {
            list.push({ id: String(v.id), name: v.name || name, type: v.type,
              index: typeof v.index === "string" ? parseInt(v.index, 10) : (v.index || 0) });
          }
        });
        list.sort(function (a, b) { return a.index - b.index; });
        return list;
      });
  }

  // ビュー選択セレクトを再構築（既定＋一覧系ビュー＋設定はあるが一覧に無いキー）
  function populateViews(list) {
    var prev = currentKey;
    viewsById = {};
    $view.innerHTML = "";
    $view.appendChild(new Option("すべての一覧（既定）", DEFAULT_KEY));
    list.forEach(function (v) {
      viewsById[v.id] = v;
      var label = v.type === "CUSTOM" ? v.name + "（カスタマイズ）" : v.name;
      $view.appendChild(new Option(label, v.id));
    });
    Object.keys(dashboards).forEach(function (k) {
      if (k !== DEFAULT_KEY && !viewsById[k]) {
        $view.appendChild(new Option("(不明なビュー " + k + ")", k));
      }
    });
    $view.value = prev; // 選択を維持
  }

  function keyLabel(key) {
    if (key === DEFAULT_KEY) { return "すべての一覧（既定）"; }
    return viewsById[key] ? viewsById[key].name : ("ビュー " + key);
  }

  // --- ダッシュボード（ビュー別）状態管理 ---------------------------------
  // 新規の一覧別エントリは「有効・共通」（＝共通を継承）。未編集なら保存時に整理される。
  function ensureDash(key) {
    if (!dashboards[key]) {
      dashboards[key] = key === DEFAULT_KEY
        ? { enabled: true, split: "1", panes: [] }
        : { enabled: true, source: "common", split: "1", panes: [] };
    }
    return dashboards[key];
  }

  // 現在のエディタ内容を state へ退避
  function stashEditor() {
    if (currentKey === DEFAULT_KEY) {
      dashboards[currentKey] = {
        enabled: $enabled.checked,
        split: normalizeSplit($split.value),
        panes: collectPanes()
      };
    } else {
      dashboards[currentKey] = {
        enabled: $enabled.checked,
        source: $source.value === "individual" ? "individual" : "common",
        split: normalizeSplit($split.value),
        panes: collectPanes()
      };
    }
  }

  // ビューを選んだだけ（未編集）の空エントリを削除し、既定へフォールバックさせる。
  // 一方、ユーザーが操作した（touched）エントリは、たとえ空・無効でも意図（＝この一覧では
  // 表示しない）として残す。既定は常に残す。
  function pruneUntouchedEmpty() {
    Object.keys(dashboards).forEach(function (k) {
      if (k === DEFAULT_KEY) { return; }
      var d = dashboards[k];
      var empty = !(d.panes && d.panes.length);
      if (empty && !touched[k]) { delete dashboards[k]; }
    });
  }

  function markTouched() { touched[currentKey] = true; }

  // 対象ビューを切り替え（編集中の内容は退避してから読み込む）
  function switchView(newKey) {
    stashEditor();
    currentKey = newKey;
    loadEditor(ensureDash(currentKey));
    showMessage("", "");
  }

  function validate(split, panes) {
    var active = (panes || []).slice(0, parseInt(normalizeSplit(split), 10) || 1);
    for (var i = 0; i < active.length; i++) {
      var p = active[i];
      if (!p.sql) { return "ペイン " + (i + 1) + " の SQL が未入力です。"; }
      if (p.display === "chart" && (!p.labelColumn || !p.valueColumn)) {
        return "ペイン " + (i + 1) + " のグラフはラベル列・値列の指定が必要です。";
      }
    }
    return null;
  }

  // 実際に表示されるダッシュボードだけ検証する（共通=有効時 / 一覧別=有効かつ個別時）。
  // 最初のエラーを { key, err } で返す（無ければ null）。
  function validateAll() {
    var keys = Object.keys(dashboards);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var d = dashboards[k];
      if (d.enabled === false) { continue; }
      if (k !== DEFAULT_KEY && d.source !== "individual") { continue; } // 共通表示は共通側で検証
      var err = validate(d.split, d.panes);
      if (err) { return { key: k, err: err }; }
    }
    return null;
  }

  // --- 初期化 -------------------------------------------------------------
  var config = normalizeConfig(readSavedConfig());
  var dashboards = config.dashboards;
  var currentKey = DEFAULT_KEY;
  var viewsById = {};
  // 保存済みのエントリは意図的なものとして touched 扱い（空・無効でも残す）
  var touched = {};
  Object.keys(dashboards).forEach(function (k) { touched[k] = true; });
  ensureDash(DEFAULT_KEY);

  $deploy.checked = config.deployOnSave === true; // 前回の選択を復元
  populateViews([]);                               // まず既定のみ（取得後に差し替え）
  loadEditor(ensureDash(currentKey));
  $split.addEventListener("change", function () { markTouched(); onSplitChange(); });
  $enabled.addEventListener("change", function () { markTouched(); updateModeUI(); });
  $source.addEventListener("change", function () { markTouched(); updateModeUI(); });
  // ペインの入力・選択変更で touched（動的生成のカードはイベント委譲で拾う）
  $panes.addEventListener("input", markTouched);
  $panes.addEventListener("change", markTouched);
  $view.addEventListener("change", function () { switchView($view.value); });

  // ビュー一覧を取得してセレクトへ反映（失敗しても既定で続行）
  var appIdForViews = getAppId();
  if (appIdForViews) {
    fetchViews(appIdForViews).then(populateViews).catch(function (e) {
      console.log("kSQL Dashboard 設定: ビュー一覧の取得に失敗しました:", apiErrorMessage(e));
    });
  }

  $save.addEventListener("click", function () {
    stashEditor();             // 現在の編集内容を確定
    pruneUntouchedEmpty();     // 選んだだけの空エントリを削除

    var bad = validateAll();
    if (bad) {
      if (bad.key !== currentKey) { $view.value = bad.key; switchView(bad.key); }
      showMessage("「" + keyLabel(bad.key) + "」: " + bad.err, "error");
      return;
    }

    var doDeploy = $deploy.checked;
    $save.disabled = true;

    kintone.plugin.app.setConfig(
      { config: JSON.stringify({ dashboards: dashboards, deployOnSave: doDeploy }) },
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
