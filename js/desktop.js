/* kSQL Dashboard — ダッシュボード描画
 * レコード一覧画面に、設定した分割レイアウトでペインを配置し、
 * 各ペインの SQL を kSQL エンジン(B66・read-only)で実行して表/グラフ表示する。
 */
(function (PLUGIN_ID) {
  "use strict";

  // 本プラグインが想定する kSQL エンジンのバージョン（UMD レジストリのキー）
  var KSQL_VERSION = "3.19.0";
  var DEFAULT_MAX_RECORDS = 500;

  function loadConfig() {
    var saved = kintone.plugin.app.getConfig(PLUGIN_ID);
    if (!saved || !saved.config) { return null; }
    try { return JSON.parse(saved.config); } catch (e) { return null; }
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
      cols.forEach(function (c) { tr.appendChild(el("td", null, row[c.name] != null ? row[c.name] : "")); });
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
      return { label: String(r[labelCol] != null ? r[labelCol] : ""), value: Number(r[valueCol]) || 0 };
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
      rowEl.appendChild(el("span", "ksqld-bar-value", String(d.value)));
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

  function renderDashboard(container, config) {
    container.innerHTML = "";
    var split = String(config.split || "1");
    var panes = (config.panes || []).slice(0, parseInt(split, 10) || 1);

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

  kintone.events.on("app.record.index.show", function (event) {
    var config = loadConfig();
    if (!config || !Array.isArray(config.panes) || config.panes.length === 0) {
      return event; // 未設定なら何もしない
    }
    // 既存のダッシュボードを除去してから描画（一覧の再表示に対応）
    var existing = document.getElementById("ksqld-dashboard");
    if (existing) { existing.parentNode.removeChild(existing); }

    var container = el("div", "ksqld-dashboard");
    container.id = "ksqld-dashboard";
    renderDashboard(container, config);

    var space = kintone.app.getHeaderSpaceElement();
    if (space) { space.appendChild(container); }
    return event;
  });
})(kintone.$PLUGIN_ID);
