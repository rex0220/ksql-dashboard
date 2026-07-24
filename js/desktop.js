/* kSQL Dashboard — ダッシュボード描画
 * レコード一覧画面に、設定した分割レイアウトでペインを配置し、
 * 各ペインの SQL を kSQL エンジン(B66・read-only)で実行して表/グラフ表示する。
 */
(function (PLUGIN_ID) {
  "use strict";

  // スクリプト自体が読み込まれたことの確認用（ハンドラ発火前に必ず出る）。
  // ここが出ない＝desktop.js が未ロード（再アップロード漏れ／モバイル／未適用など）。
  console.log("kSQL Dashboard: desktop.js loaded; window.ksql=", !!window.ksql);

  // 本プラグインが想定する kSQL エンジンのバージョン（UMD レジストリのキー）
  var KSQL_VERSION = "3.19.0";
  var DEFAULT_MAX_RECORDS = 500;

  var DEFAULT_KEY = "__default__"; // 既定ダッシュボードのキー

  function loadConfig() {
    var saved = kintone.plugin.app.getConfig(PLUGIN_ID);
    if (!saved || !saved.config) { return null; }
    try { return JSON.parse(saved.config); } catch (e) { return null; }
  }

  function normalizeSplit(s) {
    return ["1", "2", "3", "4"].indexOf(String(s)) !== -1 ? String(s) : "1";
  }

  // 設定を正規化（旧形式 { split, panes } は既定ダッシュボードへ移行）
  function normalizeConfig(raw) {
    var cfg = { dashboards: {} };
    if (!raw || typeof raw !== "object") { return cfg; }
    if (raw.dashboards && typeof raw.dashboards === "object") {
      Object.keys(raw.dashboards).forEach(function (k) {
        var d = raw.dashboards[k] || {};
        var panes = Array.isArray(d.panes) ? d.panes : [];
        if (k === DEFAULT_KEY) {
          cfg.dashboards[k] = { enabled: d.enabled !== false, split: normalizeSplit(d.split), panes: panes };
        } else {
          var source = d.source === "individual" ? "individual"
            : d.source === "common" ? "common"
            : (panes.length ? "individual" : "common"); // 旧データ互換
          cfg.dashboards[k] = {
            enabled: d.enabled !== false, source: source,
            split: normalizeSplit(d.split), panes: panes
          };
        }
      });
    } else if (Array.isArray(raw.panes)) {
      cfg.dashboards[DEFAULT_KEY] = { enabled: true, split: normalizeSplit(raw.split), panes: raw.panes };
    }
    return cfg;
  }

  // 共通ダッシュボードが表示可能か（有効かつペインあり）
  function commonUsable(config) {
    var c = (config.dashboards || {})[DEFAULT_KEY];
    return !!c && c.enabled !== false && (c.panes || []).length > 0;
  }

  // 表示中ビューに対応するダッシュボードを選ぶ。
  //  - 一覧別設定あり: 無効→非表示 / source=individual→専用（ペインがあれば） / source=common→共通
  //  - 一覧別設定なし: 共通を継承（共通が有効なら）
  function pickDashboard(config, event) {
    var dashboards = config.dashboards || {};
    var common = dashboards[DEFAULT_KEY];
    var vid = event && event.viewId != null ? String(event.viewId) : null;
    var entry = vid ? dashboards[vid] : null;

    if (entry) {
      if (entry.enabled === false) { return null; }        // この一覧では非表示
      if (entry.source === "individual") {
        return (entry.panes || []).length ? entry : null;  // 個別
      }
      // source === "common"
      return commonUsable(config) ? common : null;
    }
    // 一覧別設定なし → 共通を継承
    return commonUsable(config) ? common : null;
  }

  // kSQL エンジンの取得（未読込なら null）
  function getEngine() {
    if (window.ksql && typeof window.ksql.get === "function") {
      return window.ksql.get(KSQL_VERSION) || null;
    }
    return null;
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) { n.className = className; }
    if (text != null) { n.textContent = text; }
    return n;
  }

  // 値はすべて文字列。整数/小数のみの文字列を「数値」とみなす。
  function isNumericString(s) {
    return typeof s === "string" && /^[+-]?\d+(\.\d+)?$/.test(s.trim());
  }

  // 3桁区切りを付与（Number 化せず文字列操作＝桁あふれ・大きな ID でも精度を保つ）
  function formatNumber(s) {
    var m = /^([+-]?)(\d+)(\.\d+)?$/.exec(String(s).trim());
    if (!m) { return String(s); }
    var intPart = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return m[1] + intPart + (m[3] || "");
  }

  // 表描画
  function renderTable(body, result) {
    var cols = result.columns || [];
    var rows = result.rows || [];
    if (rows.length === 0) { body.appendChild(el("div", "ksqld-note", "0 件")); return; }

    var table = el("table", "ksqld-table");
    var thead = el("thead");
    var trh = el("tr");
    cols.forEach(function (c) { trh.appendChild(el("th", null, c.name)); });
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = el("tbody");
    rows.forEach(function (row) {
      var tr = el("tr");
      cols.forEach(function (c) {
        var raw = row[c.name] != null ? row[c.name] : "";
        if (isNumericString(raw)) {
          tr.appendChild(el("td", "ksqld-num", formatNumber(raw)));
        } else {
          tr.appendChild(el("td", null, raw));
        }
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
  }

  // グラフ描画（依存なしの横棒・値はすべて文字列で返るため Number 解釈）
  function renderChart(body, result, pane) {
    var rows = result.rows || [];
    var labelCol = pane.labelColumn;
    var valueCol = pane.valueColumn;
    if (rows.length === 0) { body.appendChild(el("div", "ksqld-note", "0 件")); return; }

    var data = rows.map(function (r) {
      var rawVal = r[valueCol] != null ? String(r[valueCol]) : "";
      return {
        label: String(r[labelCol] != null ? r[labelCol] : ""),
        value: Number(rawVal) || 0,
        display: isNumericString(rawVal) ? formatNumber(rawVal) : rawVal
      };
    });
    var max = data.reduce(function (m, d) { return Math.max(m, d.value); }, 0) || 1;

    data.forEach(function (d) {
      var rowEl = el("div", "ksqld-bar-row");
      rowEl.appendChild(el("span", "ksqld-bar-label", d.label));
      var track = el("div", "ksqld-bar-track");
      var fill = el("div", "ksqld-bar-fill");
      fill.style.width = Math.round((d.value / max) * 100) + "%";
      track.appendChild(fill);
      rowEl.appendChild(track);
      rowEl.appendChild(el("span", "ksqld-bar-value", d.display));
      body.appendChild(rowEl);
    });
  }

  // 1ペインの実行と描画
  function renderPane(tileBody, pane, engine, client) {
    if (!engine) {
      tileBody.appendChild(el("div", "ksqld-note",
        "kSQL エンジン未読込です。js/ksql-engine.umd.js を配置してください。"));
      return;
    }
    engine.runQuery(pane.sql, { client: client, maxRecords: DEFAULT_MAX_RECORDS })
      .then(function (result) {
        tileBody.innerHTML = "";
        if (pane.display === "chart") { renderChart(tileBody, result, pane); }
        else { renderTable(tileBody, result); }
      })
      .catch(function (err) {
        tileBody.innerHTML = "";
        var code = (err && err.code) ? "[" + err.code + "] " : "";
        tileBody.appendChild(el("div", "ksqld-error", code + (err && err.message ? err.message : "実行エラー")));
      });
  }

  function renderDashboard(container, dash) {
    container.innerHTML = "";
    var split = normalizeSplit(dash.split);
    var panes = (dash.panes || []).slice(0, parseInt(split, 10) || 1);

    var grid = el("div", "ksqld-grid");
    grid.setAttribute("data-split", split);

    var engine = getEngine();
    var client = engine ? engine.createReadonlyKintoneClient() : null;

    panes.forEach(function (pane, i) {
      var tile = el("div", "ksqld-tile");
      tile.appendChild(el("div", "ksqld-tile-title", pane.title || ("ペイン " + (i + 1))));
      var body = el("div", "ksqld-tile-body");
      body.appendChild(el("div", "ksqld-note", "読み込み中…"));
      tile.appendChild(body);
      grid.appendChild(tile);
      renderPane(body, pane, engine, client);
    });

    container.appendChild(grid);
  }

  // 一覧のヘッダースペース要素を取得（PC/モバイルの両 API に対応）
  function getSpaceElement() {
    if (kintone.app && typeof kintone.app.getHeaderSpaceElement === "function") {
      var pc = kintone.app.getHeaderSpaceElement();
      if (pc) { return pc; }
    }
    if (kintone.mobile && kintone.mobile.app &&
        typeof kintone.mobile.app.getHeaderSpaceElement === "function") {
      return kintone.mobile.app.getHeaderSpaceElement();
    }
    return null;
  }

  function onIndexShow(event) {
    var config = normalizeConfig(loadConfig());
    var dash = pickDashboard(config, event);

    // 既存のダッシュボードは常に除去（対象ビュー切替でも消えるように）
    var existing = document.getElementById("ksqld-dashboard");
    if (existing && existing.parentNode) { existing.parentNode.removeChild(existing); }

    if (!dash) {
      console.log("kSQL Dashboard: このビュー(viewId=" + (event && event.viewId) +
        ")向けのダッシュボード設定がありません。");
      return event; // このビュー用も既定も無ければ何もしない
    }
    var space = getSpaceElement();
    if (!space) {
      console.log("kSQL Dashboard: ヘッダースペース要素が取得できません（このビューでは描画不可）。");
      return event;
    }

    var container = el("div", "ksqld-dashboard");
    container.id = "ksqld-dashboard";
    renderDashboard(container, dash);
    space.appendChild(container);
    return event;
  }

  // PC・モバイル両方の一覧表示イベントに登録
  kintone.events.on(["app.record.index.show", "mobile.app.record.index.show"], onIndexShow);
})(kintone.$PLUGIN_ID);
