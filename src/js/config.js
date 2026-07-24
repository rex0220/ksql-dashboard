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
  var DEFAULT_VIEW_ID = "20";      // kintone 既定の「(すべて)」ビューの固定 viewId
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
  // 複写・入れ替えツール（歯車ダイアログ）
  var $toolsOpen = document.getElementById("ksqld-tools-open");
  var $toolsClose = document.getElementById("ksqld-tools-close");
  var $modal = document.getElementById("ksqld-tools-modal");
  var $opSrc = document.getElementById("ksqld-op-src");
  var $opDst = document.getElementById("ksqld-op-dst");
  var $opCopy = document.getElementById("ksqld-op-copy");
  var $opSwap = document.getElementById("ksqld-op-swap");
  var $opCurView = document.getElementById("ksqld-op-curview");
  var $toolsMsg = document.getElementById("ksqld-tools-msg");
  var $copyTarget = document.getElementById("ksqld-copy-target");
  var $copyViewBtn = document.getElementById("ksqld-copy-view");
  var $download = document.getElementById("ksqld-download");
  var $uploadBtn = document.getElementById("ksqld-upload");
  var $importFile = document.getElementById("ksqld-import-file");
  // プレビュー
  var $previewOpen = document.getElementById("ksqld-preview-open");
  var $previewClose = document.getElementById("ksqld-preview-close");
  var $previewReload = document.getElementById("ksqld-preview-reload");
  var $previewModal = document.getElementById("ksqld-preview-modal");
  var $preview = document.getElementById("ksqld-preview");

  var appName = "";       // ダウンロードのメタ情報用（取得失敗時は空）
  var lastViewList = [];  // 直近取得のビュー一覧（インポート後の再描画用）

  // --- 設定の読込と正規化（旧形式 { split, panes } からの移行を含む）---------
  function normalizeSplit(s) {
    return ["1", "2", "3", "3b", "4"].indexOf(String(s)) !== -1 ? String(s) : "1";
  }

  function normalizeConfig(raw) {
    var cfg = { deployOnSave: false, dashboards: {}, knownViews: [] };
    if (!raw || typeof raw !== "object") { return cfg; }
    cfg.deployOnSave = raw.deployOnSave === true;
    // 設定保存時点で存在した一覧(ビュー)ID。共通の継承範囲を「その時点の一覧」に限る。
    if (Array.isArray(raw.knownViews)) { cfg.knownViews = raw.knownViews.map(String); }
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

  // カードの入力値を1ペイン分の設定として読み出す
  function readCard(card) {
    return {
      title: card.querySelector(".ksqld-pane-title").value.trim(),
      sql: card.querySelector(".ksqld-pane-sql").value.trim(),
      display: card.querySelector(".ksqld-pane-type").value === "chart" ? "chart" : "table",
      chartType: card.querySelector(".ksqld-pane-chart-type").value === "column" ? "column" : "bar",
      labelColumn: card.querySelector(".ksqld-pane-label-col").value.trim(),
      valueColumn: card.querySelector(".ksqld-pane-value-col").value.trim()
    };
  }

  // 1ペイン分の設定をカードへ反映（複写・入れ替えでも使用）
  function applyPaneToCard(card, pane) {
    pane = pane || {};
    card.querySelector(".ksqld-pane-title").value = pane.title || "";
    card.querySelector(".ksqld-pane-sql").value = pane.sql || "";
    card.querySelector(".ksqld-pane-type").value = pane.display === "chart" ? "chart" : "table";
    card.querySelector(".ksqld-pane-chart-type").value = pane.chartType === "column" ? "column" : "bar";
    card.querySelector(".ksqld-pane-label-col").value = pane.labelColumn || "";
    card.querySelector(".ksqld-pane-value-col").value = pane.valueColumn || "";
    card.querySelector(".ksqld-chart-cols").hidden =
      card.querySelector(".ksqld-pane-type").value !== "chart";
  }

  function getCards() { return $panes.querySelectorAll(".ksqld-pane-card"); }

  // 1枚のペイン設定フォームを生成
  function buildPaneCard(index, pane) {
    var node = $template.content.cloneNode(true);
    var card = node.querySelector(".ksqld-pane-card");
    card.querySelector(".ksqld-pane-index").textContent = String(index + 1);
    applyPaneToCard(card, pane);

    var $type = card.querySelector(".ksqld-pane-type");
    var $chartCols = card.querySelector(".ksqld-chart-cols");
    $type.addEventListener("change", function () { $chartCols.hidden = $type.value !== "chart"; });

    card.querySelector(".ksqld-validate").addEventListener("click", function () {
      validateSql(card);
    });

    return card;
  }

  // 現在編集中ビューの全ペイン（分割で非表示になった分も保持する裏配列）
  var editorPanes = [];

  // 指定枚数のペインフォームを描画
  function buildCards(panes, count) {
    $panes.innerHTML = "";
    for (var i = 0; i < count && i < MAX_PANES; i++) {
      $panes.appendChild(buildPaneCard(i, panes[i] || {}));
    }
  }

  // 画面上の見えているカードの入力を裏配列へ反映（非表示ペインの内容は温存）
  function syncVisibleToBacking() {
    var visible = collectPanes();
    for (var i = 0; i < visible.length; i++) { editorPanes[i] = visible[i]; }
  }

  // 分割数変更時：画面上の入力を裏配列へ退避してから、新しい枚数で再描画
  function onSplitChange() {
    syncVisibleToBacking();
    buildCards(editorPanes, parseInt($split.value, 10) || 1);
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
    editorPanes = (dash.panes || []).slice(); // 全ペインを裏配列に保持
    buildCards(editorPanes, parseInt($split.value, 10) || 1);
    updateModeUI();
  }

  // 画面上のペイン入力を配列で収集
  function collectPanes() {
    var cards = getCards();
    var out = [];
    for (var i = 0; i < cards.length; i++) { out.push(readCard(cards[i])); }
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
        // kintone 既定の「(すべて)」ビュー(viewId=20)は views.json に含まれないため補完する。
        // 通常の一覧選択では末尾に表示されるため、大きな index で最後に並べる。
        if (!list.some(function (v) { return v.id === DEFAULT_VIEW_ID; })) {
          list.push({ id: DEFAULT_VIEW_ID, name: "(すべて)", type: "LIST", index: Number.MAX_SAFE_INTEGER });
        }
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
    refreshCopyTarget();
  }

  function keyLabel(key) {
    if (key === DEFAULT_KEY) { return "すべての一覧（既定）"; }
    return viewsById[key] ? viewsById[key].name : ("ビュー " + key);
  }

  // 一覧複写の「複写先」候補を、対象ビュー選択（現在の選択を除く）から作る
  function refreshCopyTarget() {
    $copyTarget.innerHTML = "";
    for (var i = 0; i < $view.options.length; i++) {
      var o = $view.options[i];
      if (o.value === currentKey) { continue; }
      $copyTarget.appendChild(new Option(o.text, o.value));
    }
    var none = $copyTarget.options.length === 0;
    $copyTarget.disabled = none;
    $copyViewBtn.disabled = none;
  }

  // 今編集中の一覧の設定を、対象の一覧へ複写する
  function copyViewTo(targetKey) {
    if (!targetKey || targetKey === currentKey) {
      toolsMessage("複写先を選んでください（今の一覧とは別の一覧）。", "error");
      return;
    }
    stashEditor(); // 現在の内容を確定
    var src = dashboards[currentKey] || { split: "1", panes: [] };
    var panes = JSON.parse(JSON.stringify(src.panes || [])); // 文字列のみなので安全に複製
    if (targetKey === DEFAULT_KEY) {
      dashboards[targetKey] = { enabled: src.enabled !== false, split: normalizeSplit(src.split), panes: panes };
    } else {
      // 複写先はその一覧専用（個別）として表示させる
      dashboards[targetKey] = {
        enabled: src.enabled !== false, source: "individual",
        split: normalizeSplit(src.split), panes: panes
      };
    }
    touched[targetKey] = true;
    toolsMessage("「" + keyLabel(currentKey) + "」の設定を「" + keyLabel(targetKey) + "」へ複写しました。", "ok");
  }

  // --- 設定のダウンロード／アップロード -----------------------------------
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function nowString() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }
  function nowStamp() {
    var d = new Date();
    return "" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      "-" + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }

  // アプリ名を取得（ダウンロードのメタ情報用・失敗しても無視）
  function fetchAppName(appId) {
    return kintoneApi("/k/v1/app.json", "GET", { id: appId })
      .then(function (r) { appName = (r && r.name) || ""; })
      .catch(function () { /* 取得不可でも続行 */ });
  }

  // 現在の設定を JSON ファイルとしてダウンロード
  function downloadConfig() {
    stashEditor();            // 画面の編集内容を反映
    pruneUntouchedEmpty();    // 保存時と同じ状態に整理
    var knownViews = Object.keys(viewsById);
    if (!knownViews.length) { knownViews = config.knownViews || []; }
    var appId = getAppId();
    var payload = {
      date: nowString(),
      pluginName: "kSQL Dashboard",
      pluginId: PLUGIN_ID,
      appId: appId,
      appName: appName,
      config: { dashboards: dashboards, deployOnSave: $deploy.checked, knownViews: knownViews }
    };
    var filename = "ksql-dashboard-app" + (appId || "x") + "-" + nowStamp() + ".json";
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toolsMessage("設定をダウンロードしました: " + filename, "ok");
  }

  // アップロードした JSON で現在の設定を置き換える（保存はしない）
  function applyImported(raw) {
    // メタ情報でラップされていれば config を取り出す。素の設定でも受け付ける。
    var body = raw && raw.config && typeof raw.config === "object" ? raw.config : raw;
    var norm = normalizeConfig(body);
    if (!norm.dashboards || !Object.keys(norm.dashboards).length) {
      throw new Error("ダッシュボード設定が見つかりません。");
    }
    dashboards = norm.dashboards;
    ensureDash(DEFAULT_KEY);
    config.knownViews = norm.knownViews;
    config.deployOnSave = norm.deployOnSave;
    $deploy.checked = norm.deployOnSave === true;
    // 読み込んだエントリは意図的な設定として保持（touched 扱い）
    touched = {};
    Object.keys(dashboards).forEach(function (k) { touched[k] = true; });
    currentKey = DEFAULT_KEY;
    populateViews(lastViewList); // 不明ビューも選択肢に出す
    $view.value = currentKey;
    loadEditor(ensureDash(currentKey));
    refreshCopyTarget();
  }

  function onImportFile() {
    var f = $importFile.files && $importFile.files[0];
    $importFile.value = ""; // 同じファイルを再選択できるように
    if (!f) { return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        applyImported(JSON.parse(reader.result));
        toolsMessage("設定を読み込みました。内容を確認して「保存」してください。", "ok");
      } catch (e) {
        toolsMessage("読み込みに失敗しました: " + (e && e.message ? e.message : e), "error");
      }
    };
    reader.onerror = function () { toolsMessage("ファイルの読み込みに失敗しました。", "error"); };
    reader.readAsText(f);
  }

  // --- プレビュー ----------------------------------------------------------
  // 編集中のダッシュボード（分割＋表示中ペイン）を実データで描画する
  function renderPreview() {
    var dash = { split: normalizeSplit($split.value), panes: collectPanes() };
    if (!dash.panes.length) {
      $preview.innerHTML = "";
      $preview.appendChild(el("div", "ksqld-note", "表示するペインがありません。"));
      return;
    }
    ksqldRender.renderDashboard($preview, dash, getEngine());
  }

  // el が必要（ksqldRender 経由で使う）
  function el(tag, className, text) { return ksqldRender.el(tag, className, text); }

  function openPreview() {
    $previewModal.hidden = false;
    renderPreview();
  }
  function closePreview() { $previewModal.hidden = true; }

  // --- 複写・入れ替えツール（歯車ダイアログ）------------------------------
  function toolsMessage(text, kind) {
    $toolsMsg.textContent = text;
    $toolsMsg.className = "ksqld-message" + (kind ? " " + kind : "");
  }

  // ダイアログ内のペイン選択肢を、現在表示中のペインで更新
  function refreshOpPanes() {
    var count = getCards().length;
    $opSrc.innerHTML = "";
    $opDst.innerHTML = "";
    for (var i = 0; i < count; i++) {
      $opSrc.appendChild(new Option("ペイン " + (i + 1), String(i)));
      $opDst.appendChild(new Option("ペイン " + (i + 1), String(i)));
    }
    if (count >= 2) { $opDst.selectedIndex = 1; } // 既定で別ペインを対象に
    var few = count < 2;
    $opSrc.disabled = $opDst.disabled = $opCopy.disabled = $opSwap.disabled = few;
  }

  function openTools() {
    refreshOpPanes();
    refreshCopyTarget();
    $opCurView.textContent = keyLabel(currentKey);
    toolsMessage("", "");
    $modal.hidden = false;
  }

  function closeTools() { $modal.hidden = true; }

  // ダイアログからのペイン複写／入れ替え
  function paneOp(mode) {
    var cards = getCards();
    var s = parseInt($opSrc.value, 10);
    var d = parseInt($opDst.value, 10);
    if (isNaN(s) || isNaN(d) || !cards[s] || !cards[d]) { return; }
    if (s === d) { toolsMessage("元ペインと対象ペインが同じです。", "error"); return; }
    if (mode === "swap") {
      var a = readCard(cards[s]), b = readCard(cards[d]);
      applyPaneToCard(cards[s], b);
      applyPaneToCard(cards[d], a);
      toolsMessage("ペイン " + (s + 1) + " と ペイン " + (d + 1) + " を入れ替えました。", "ok");
    } else {
      applyPaneToCard(cards[d], readCard(cards[s]));
      toolsMessage("ペイン " + (s + 1) + " を ペイン " + (d + 1) + " へ複写しました。", "ok");
    }
    syncVisibleToBacking();
    markTouched();
  }

  // --- ダッシュボード（ビュー別）状態管理 ---------------------------------
  // 新規の一覧別エントリは既定 OFF（「この一覧で表示する」を明示的に ON にする運用）。
  // 未編集なら保存時に整理される（共通が有効なら共通を継承）。共通(既定)は有効で作る。
  function ensureDash(key) {
    if (!dashboards[key]) {
      dashboards[key] = key === DEFAULT_KEY
        ? { enabled: true, split: "1", panes: [] }
        : { enabled: false, source: "common", split: "1", panes: [] };
    }
    return dashboards[key];
  }

  // 現在のエディタ内容を state へ退避（非表示ペインの内容も裏配列から保持）
  function stashEditor() {
    syncVisibleToBacking();
    var panes = editorPanes.slice();
    if (currentKey === DEFAULT_KEY) {
      dashboards[currentKey] = {
        enabled: $enabled.checked,
        split: normalizeSplit($split.value),
        panes: panes
      };
    } else {
      dashboards[currentKey] = {
        enabled: $enabled.checked,
        source: $source.value === "individual" ? "individual" : "common",
        split: normalizeSplit($split.value),
        panes: panes
      };
    }
  }

  // 冗長なエントリだけを削除する。
  //  - OFF（enabled:false）は「この一覧は非表示」という明確な意味を持つため常に残す
  //    （共通にも継承させない）。
  //  - ON かつ空かつ未編集のエントリは「共通を表示」と同じ（＝設定なしと等価）なので削除し、
  //    共通の継承に任せる。既定(共通)は常に残す。
  function pruneUntouchedEmpty() {
    Object.keys(dashboards).forEach(function (k) {
      if (k === DEFAULT_KEY) { return; }
      var d = dashboards[k];
      var empty = !(d.panes && d.panes.length);
      if (empty && !touched[k] && d.enabled !== false) { delete dashboards[k]; }
    });
  }

  function markTouched() { touched[currentKey] = true; }

  // 対象ビューを切り替え（編集中の内容は退避してから読み込む）
  function switchView(newKey) {
    stashEditor();
    currentKey = newKey;
    loadEditor(ensureDash(currentKey));
    refreshCopyTarget();
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

  // 複写・入れ替えツール（歯車ダイアログ）
  $toolsOpen.addEventListener("click", openTools);
  $toolsClose.addEventListener("click", closeTools);
  $modal.addEventListener("click", function (e) { if (e.target === $modal) { closeTools(); } }); // 背景クリックで閉じる
  $opCopy.addEventListener("click", function () { paneOp("copy"); });
  $opSwap.addEventListener("click", function () { paneOp("swap"); });
  $copyViewBtn.addEventListener("click", function () { copyViewTo($copyTarget.value); });
  // 設定のダウンロード／アップロード
  $download.addEventListener("click", downloadConfig);
  $uploadBtn.addEventListener("click", function () { $importFile.click(); });
  $importFile.addEventListener("change", onImportFile);
  // プレビュー
  $previewOpen.addEventListener("click", openPreview);
  $previewClose.addEventListener("click", closePreview);
  $previewReload.addEventListener("click", renderPreview);
  $previewModal.addEventListener("click", function (e) { if (e.target === $previewModal) { closePreview(); } });
  refreshCopyTarget();

  // ビュー一覧・アプリ名を取得（失敗しても既定で続行）
  var appIdForViews = getAppId();
  if (appIdForViews) {
    fetchViews(appIdForViews).then(function (list) {
      lastViewList = list;
      populateViews(list);
    }).catch(function (e) {
      console.log("kSQL Dashboard 設定: ビュー一覧の取得に失敗しました:", apiErrorMessage(e));
    });
    fetchAppName(appIdForViews);
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

    // 現在の一覧一覧を「既知ビュー」として記録（共通の継承範囲）。
    // ビュー取得に失敗している場合は前回の記録を維持する。
    var knownViews = Object.keys(viewsById);
    if (!knownViews.length) { knownViews = config.knownViews || []; }

    kintone.plugin.app.setConfig(
      { config: JSON.stringify({ dashboards: dashboards, deployOnSave: doDeploy, knownViews: knownViews }) },
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
