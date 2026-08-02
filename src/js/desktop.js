/* kSQL Dashboard — ダッシュボード描画
 * レコード一覧画面に、設定した分割レイアウトでペインを配置し、
 * 各ペインの SQL を kSQL エンジン(B66・read-only)で実行して表/グラフ表示する。
 */
(function (PLUGIN_ID) {
  "use strict";

  // 本プラグインが想定する kSQL エンジンのバージョン（UMD レジストリのキー）
  var KSQL_VERSION = "3.38.0";

  var DEFAULT_KEY = "__default__"; // 既定ダッシュボードのキー
  var refreshTimer = null;         // 自動更新タイマー（重複防止のため単一保持）

  function loadConfig() {
    var saved = kintone.plugin.app.getConfig(PLUGIN_ID);
    if (!saved || !saved.config) { return null; }
    try { return JSON.parse(saved.config); } catch (e) { return null; }
  }

  function normalizeSplit(s) {
    return ["1", "2", "3", "3b", "4"].indexOf(String(s)) !== -1 ? String(s) : "1";
  }

  // 設定を正規化（旧形式 { split, panes } は既定ダッシュボードへ移行）
  function normalizeConfig(raw) {
    var cfg = { dashboards: {}, knownViews: null };
    if (!raw || typeof raw !== "object") { return cfg; }
    if (Array.isArray(raw.knownViews)) { cfg.knownViews = raw.knownViews.map(String); }
    if (raw.dashboards && typeof raw.dashboards === "object") {
      Object.keys(raw.dashboards).forEach(function (k) {
        var d = raw.dashboards[k] || {};
        var panes = Array.isArray(d.panes) ? d.panes : [];
        var refreshSec = normalizeRefresh(d.refreshSec);
        if (k === DEFAULT_KEY) {
          cfg.dashboards[k] = { enabled: d.enabled !== false, split: normalizeSplit(d.split), panes: panes, refreshSec: refreshSec };
        } else {
          var source = d.source === "individual" ? "individual"
            : d.source === "common" ? "common"
            : (panes.length ? "individual" : "common"); // 旧データ互換
          cfg.dashboards[k] = {
            enabled: d.enabled !== false, source: source,
            split: normalizeSplit(d.split), panes: panes, refreshSec: refreshSec
          };
        }
      });
    } else if (Array.isArray(raw.panes)) {
      cfg.dashboards[DEFAULT_KEY] = { enabled: true, split: normalizeSplit(raw.split), panes: raw.panes, refreshSec: 0 };
    }
    return cfg;
  }

  // 自動更新間隔（秒）を正規化。0/未指定/不正=無効。最短10分・10分単位に切り上げて秒で返す。
  function normalizeRefresh(sec) {
    var n = parseInt(sec, 10);
    if (!isFinite(n) || n <= 0) { return 0; }
    var min = Math.ceil(n / 60);
    if (min < 10) { min = 10; }
    min = Math.ceil(min / 10) * 10;
    return min * 60;
  }

  // 共通ダッシュボードが表示可能か（有効かつペインあり）
  function commonUsable(config) {
    var c = (config.dashboards || {})[DEFAULT_KEY];
    return !!c && c.enabled !== false && (c.panes || []).length > 0;
  }

  // その一覧が「設定保存時点で存在した既知の一覧」か。
  // knownViews が無い(旧設定)場合は情報なしとして true（従来どおり全一覧に共通を継承）。
  function isKnownView(config, vid) {
    var known = config.knownViews;
    if (!known || !known.length) { return true; }
    return known.indexOf(vid) !== -1;
  }

  // 表示中ビューに対応するダッシュボードを選ぶ。
  //  - 一覧別設定あり: 無効→非表示 / source=individual→専用（ペインがあれば） / source=common→共通
  //  - 一覧別設定なし: 既知の一覧なら共通を継承。設定後に追加された一覧は非表示。
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
    // 一覧別設定なし → 設定後に追加された一覧は非表示。既知の一覧のみ共通を継承。
    if (vid && !isKnownView(config, vid)) { return null; }
    return commonUsable(config) ? common : null;
  }

  // kSQL エンジンの取得（未読込なら null）
  function getEngine() {
    if (window.ksql && typeof window.ksql.get === "function") {
      return window.ksql.get(KSQL_VERSION) || null;
    }
    return null;
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
    // 前回の自動更新タイマーを必ず解除（SPA 遷移・ビュー切替での重複防止）
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }

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

    var container = ksqldRender.el("div", "ksqld-dashboard");
    container.id = "ksqld-dashboard";
    ksqldRender.renderDashboard(container, dash, getEngine());
    space.appendChild(container);

    // 自動更新（一定間隔で再取得）。ダッシュボードが DOM から外れたら停止。
    if (dash.refreshSec > 0) {
      refreshTimer = setInterval(function () {
        if (!document.body.contains(container)) {
          clearInterval(refreshTimer); refreshTimer = null; return;
        }
        ksqldRender.renderDashboard(container, dash, getEngine());
      }, dash.refreshSec * 1000);
    }
    return event;
  }

  // PC・モバイル両方の一覧表示イベントに登録
  kintone.events.on(["app.record.index.show", "mobile.app.record.index.show"], onIndexShow);
})(kintone.$PLUGIN_ID);
