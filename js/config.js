/* kSQL Dashboard — 設定画面ロジック
 * 画面分割数(1-4)と、ペインごとの SQL・表示方法(表/グラフ)を設定し、
 * kintone.plugin.app.setConfig で保存する。
 */
(function (PLUGIN_ID) {
  "use strict";

  var MAX_PANES = 4;

  var $split = document.getElementById("ksqld-split");
  var $panes = document.getElementById("ksqld-panes");
  var $save = document.getElementById("ksqld-save");
  var $cancel = document.getElementById("ksqld-cancel");
  var $message = document.getElementById("ksqld-message");
  var $template = document.getElementById("ksqld-pane-template");

  // 既存設定の読込
  var saved = kintone.plugin.app.getConfig(PLUGIN_ID);
  var config = { split: "1", panes: [] };
  if (saved && saved.config) {
    try { config = JSON.parse(saved.config); } catch (e) { /* 破損時は初期値 */ }
  }
  if (!Array.isArray(config.panes)) { config.panes = []; }
  if (["1", "2", "3", "4"].indexOf(String(config.split)) === -1) { config.split = "1"; }

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
  renderPanes();
  $split.addEventListener("change", renderPanes);

  $save.addEventListener("click", function () {
    var split = $split.value;
    var panes = collectPanes();
    var err = validate(split, panes);
    if (err) { showMessage(err, "error"); return; }

    kintone.plugin.app.setConfig(
      { config: JSON.stringify({ split: split, panes: panes }) },
      function () {
        // 成功時は設定一覧へ戻る（setConfig のコールバックが呼ばれれば保存済み）
        showMessage("保存しました。", "ok");
      }
    );
  });

  $cancel.addEventListener("click", function () {
    history.back();
  });
})(kintone.$PLUGIN_ID);
