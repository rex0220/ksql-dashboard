/* kSQL Dashboard — 描画共有モジュール
 * ダッシュボード（分割グリッド・表・グラフ）の描画を desktop.js と config.js の
 * プレビューで共有する。window.ksqldRender.renderDashboard(container, dash, engine) を公開。
 *   dash = { split, panes:[{ title, sql, display, chartType, labelColumn, valueColumn }] }
 */
(function (global) {
  "use strict";

  var DEFAULT_MAX_RECORDS = 500;

  function normalizeSplit(s) {
    return ["1", "2", "3", "3b", "4"].indexOf(String(s)) !== -1 ? String(s) : "1";
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

  // グラフ描画（依存なしの自前 SVG 風・値はすべて文字列で返るため Number 解釈）
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

    if (pane.chartType === "column") { renderColumnChart(body, data, max); }
    else { renderBarChart(body, data, max); }
  }

  // 横棒グラフ
  function renderBarChart(body, data, max) {
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

  // 縦棒グラフ
  function renderColumnChart(body, data, max) {
    var chart = el("div", "ksqld-col-chart");
    data.forEach(function (d) {
      var col = el("div", "ksqld-col");
      var plot = el("div", "ksqld-col-plot");
      plot.appendChild(el("span", "ksqld-col-value", d.display));
      var bar = el("div", "ksqld-col-bar");
      bar.style.height = Math.round((d.value / max) * 100) + "%";
      bar.title = d.label + ": " + d.display;
      plot.appendChild(bar);
      col.appendChild(plot);
      col.appendChild(el("span", "ksqld-col-label", d.label));
      chart.appendChild(col);
    });
    body.appendChild(chart);
  }

  // 1ペインの実行と描画
  function renderPane(tileBody, pane, engine, client) {
    if (!engine) {
      tileBody.appendChild(el("div", "ksqld-note",
        "kSQL エンジン未読込です。js/ksql-engine.umd.js を配置してください。"));
      return;
    }
    var maxRecords = (typeof pane.maxRecords === "number" && pane.maxRecords > 0) ? pane.maxRecords : DEFAULT_MAX_RECORDS;
    engine.runQuery(pane.sql, { client: client, maxRecords: maxRecords })
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

  // ダッシュボード全体を container へ描画。engine は呼び出し側から渡す（未読込なら null）。
  function renderDashboard(container, dash, engine) {
    container.innerHTML = "";
    var split = normalizeSplit(dash.split);
    var panes = (dash.panes || []).slice(0, parseInt(split, 10) || 1);

    var grid = el("div", "ksqld-grid");
    grid.setAttribute("data-split", split);

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

  global.ksqldRender = { renderDashboard: renderDashboard, el: el };
})(typeof window !== "undefined" ? window : this);
