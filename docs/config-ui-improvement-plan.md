# 設定画面 UI 改善 実装計画

対象: プラグイン設定画面（`src/html/config.html` / `src/css/config.css` / `src/js/config.js`）

設定画面レビューで挙がった改善点のうち、以下の 5 項目を実装する。

| # | 項目 | 規模 | 主な変更ファイル |
|---|------|------|------------------|
| 3 | 未保存変更のガード | 中 | config.js, config.html, config.css |
| 4 | kintone 標準デザイン（プラグインスタイルシート）への準拠 | 大 | config.html, config.css, manifest.json |
| 5 | 絵文字アイコン（👁・⚙）の SVG 化 | 小 | config.html, config.css |
| 6 | ヒント文字のコントラスト改善 | 極小 | config.css |
| 7 | タブラベルとペインタイトルの重複解消 | 小 | config.html, config.js, config.css |

推奨実装順: **6 → 5 → 7 → 3 → 4**（小さく確実なものから。4 は見た目が全面的に変わるため最後に単独でコミット）。

---

## 3. 未保存変更のガード

### 目的

編集内容がある状態でキャンセル・画面遷移した際に、無警告で変更が破棄されるのを防ぐ。あわせて「未保存の変更がある」ことを画面上で常時示す。

### 現状

- キャンセルは `history.back()` を即実行（config.js 末尾の `$cancel` リスナー）。
- 既存の `touched`（ビュー別の編集済みフラグ）は「保存済みエントリも初期化時に true にする」仕様のため、**dirty（保存後に変更があったか）としては使えない**。別フラグが必要。

### 実装内容

**config.js**

1. モジュール先頭に `var dirty = false;` と `function markDirty() { dirty = true; updateDirtyUI(); }` を追加。
2. `markDirty()` を呼ぶ箇所（既存の `markTouched` 呼び出しと同じ箇所＋α）:
   - `$split` change / `$refresh` input・change / `$enabled` change / `$source` change
   - `$panes` の input・change（イベント委譲）
   - `$deploy` change（`deployOnSave` も保存対象のため。現状リスナー無し → 追加）
   - ツール操作: `paneOp()`・`copyViewTo()` の成功時、`applyImported()`（インポート成功時）
   - ※ `switchView()`（ビュー切替）は編集ではないので dirty にしない
3. dirty の解除: `$save` の `setConfig` コールバック先頭（preview 保存が完了した時点）で `dirty = false; updateDirtyUI();`。**運用反映（deploy）の成否とは無関係に解除する**（設定自体は保存済みのため）。
4. キャンセルガード:
   ```js
   $cancel.addEventListener("click", function () {
     if (dirty && !window.confirm("編集中の変更が保存されていません。破棄して戻りますか？")) { return; }
     history.back();
   });
   ```
5. 離脱ガード:
   ```js
   window.addEventListener("beforeunload", function (e) {
     if (dirty) { e.preventDefault(); e.returnValue = ""; }
   });
   ```
6. インジケータ更新関数:
   ```js
   function updateDirtyUI() {
     $dirtyBadge.hidden = !dirty;
     $save.classList.toggle("ksqld-btn-attention", dirty);
   }
   ```

**config.html**

- 保存ボタンの隣（`ksqld-toolbar-actions` 内、`#ksqld-message` の手前）に `<span id="ksqld-dirty-badge" class="ksqld-dirty-badge" hidden>未保存の変更があります</span>` を追加。

**config.css**

- `.ksqld-dirty-badge`（小さめ・注意色 `#8a6d3b` / 背景 `#fcf6e9`、既存の `ksqld-btn-caution` と同系色）と、`.ksqld-btn-attention`（保存ボタンにリング or 濃色強調）を追加。

### 注意点

- 保存結果メッセージ（`#ksqld-message`）は従来どおり。dirty 表示はバッジ側に分離し、メッセージ領域を奪い合わない。
- `beforeunload` はブラウザ標準ダイアログのみ（文言はカスタマイズ不可）。kintone 管理画面内の遷移（キャンセル＝`history.back()`）は confirm 側で拾う。

### 検証

1. 何も編集せず「キャンセル」→ 確認なしで戻る。バッジ非表示。
2. SQL を 1 文字変更 → バッジ表示。「キャンセル」→ confirm が出る。「いいえ」で画面に留まる。
3. 保存成功 → バッジが消える。その後キャンセル → 確認なしで戻る。
4. dirty 状態でブラウザのタブを閉じる/リロード → 離脱確認が出る。
5. ツールでペイン複写・入れ替え・インポートを実行 → バッジ表示。
6. ビュー切替のみ → バッジが付かないこと。

---

## 4. kintone 標準デザイン（プラグインスタイルシート）への準拠

### 目的

サイボウズ公式の「プラグイン専用スタイルシート」（`51-modern-default.css`）を同梱し、フォーム部品・ボタンを kintone 標準の見た目に揃える。他プラグインと並んだときの違和感をなくす。

### 方針（スコープを限定）

全面書き換えはせず、**部品（ボタン・入力・セレクト・テキストエリア・ラベル・説明文）だけ標準クラスへ移行**する。レイアウト（sticky ツールバー・タブ・2 カラム・モーダル）は既存の `ksqld-*` を維持する。理由:

- 51-modern-default.css は `kintoneplugin-*` クラスに限定して効くため、部分適用しても既存スタイルと干渉しない。
- タブ UI・sticky ツールバーは標準スタイルシートに対応部品がなく、自前実装の継続が必要。

### 実装内容

1. **スタイルシートの入手・同梱**
   - サイボウズ公式リポジトリ（cybozu.dev「プラグイン開発で利用できるスタイルシート」→ GitHub `kintone/plugin-stylesheet` 系で配布）から `51-modern-default.css` を取得し、`src/css/51-modern-default.css` として同梱する（CSP のため CDN 参照は不可・必ず同梱）。
   - `src/manifest.json` の `config.css` に **`config.css` より前**に追加:
     ```json
     "css": ["css/51-modern-default.css", "css/config.css", "css/desktop.css"]
     ```
     ※ 読み込み順を前にして、こちらの `config.css` で上書き調整できるようにする。

2. **クラス移行マッピング**（config.html・テンプレート内）

   | 現行 | 移行後 |
   |------|--------|
   | `.ksqld-btn.ksqld-btn-primary`（保存） | `kintoneplugin-button-dialog-ok` |
   | `.ksqld-btn`（キャンセル・閉じる） | `kintoneplugin-button-dialog-cancel` |
   | その他のボタン（検証・ツール類） | `kintoneplugin-button-normal`（小型が必要なら現行 `ksqld-btn-sub` を併用で調整） |
   | `.ksqld-input`（text/number） | `kintoneplugin-input-text` |
   | `.ksqld-select` | `kintoneplugin-select` ＋ 外側を `<div class="kintoneplugin-select-outer">` で包む |
   | `.ksqld-textarea`（SQL） | `kintoneplugin-textarea`（monospace は config.css 側で維持） |
   | `.ksqld-label` | `kintoneplugin-label`（必須マークは使わない） |
   | `.ksqld-hint` | `kintoneplugin-desc`（→ 項目 6 のコントラスト調整はこのクラスに対して行う） |

   - `ksqld-btn-caution`（複写・入れ替えの注意色）は標準に該当部品がないため現行維持。
   - JS は全部品を **id で参照**しているため、クラス変更・セレクトのラッパー div 追加によるロジック影響はない。ただしテンプレート内は `card.querySelector(".ksqld-pane-title")` 等 **クラス参照**なので、`ksqld-*` クラスは**削除せず併記**する（例: `class="kintoneplugin-input-text ksqld-input ksqld-pane-title"`）。

3. **config.css の調整**
   - 移行した部品向けの自前定義（`.ksqld-btn` の色・`.ksqld-select/.ksqld-input/.ksqld-textarea` の枠線など）を削除または上書き最小限に整理。
   - 幅指定（`.ksqld-refresh-input: 120px` 等）・monospace・min-height はサイズ調整として残す。
   - アクセントカラー `#3498db`（タブ active・ペイン番号・subtitle 左ボーダー）は標準スタイルの配色と並べて確認し、浮くようなら標準側の色（読み込んだ CSS から採取）に合わせる。

### 注意点

- 標準スタイルシートは部品の高さ・余白が現行よりやや大きい。sticky ツールバーの行の折返し、ペイン 2 カラムの `min-width` を実機で再確認する。
- ライセンス表記: 同梱する CSS のヘッダーコメント（著作権表記）は削除しない。
- `51-modern-default.css` は desktop 側には読み込まない（`config` の css のみ）。

### 検証

1. 設定画面の全部品（保存/キャンセル/検証/ツール各ボタン、select、input、textarea）が標準ルックで表示される。
2. タブ切替・分割数変更・検証・プレビュー・ツールダイアログの動作が全て従来どおり（クラス併記により JS 参照が壊れていないこと）。
3. ウィンドウ幅を狭めて 2 カラム→縦積みの折返しが破綻しないこと。
4. 他の標準的なプラグイン設定画面と並べて見た目のトーンが揃っていること。

---

## 5. 絵文字アイコン（👁・⚙）の SVG 化

### 目的

`👁 プレビュー`・`⚙ ツール` の絵文字は OS/ブラウザで描画が異なり（Windows ではカラー絵文字）、ボタンのトーンと合わない。単色 inline SVG に置き換える（CSP 制約下でも inline SVG は使用可能）。

### 実装内容

**config.html**（`#ksqld-preview-open` / `#ksqld-tools-open`）

- 絵文字文字を削除し、ボタン内に inline SVG ＋ テキストを配置:
  ```html
  <button id="ksqld-preview-open" class="ksqld-btn ksqld-icon-btn" type="button" title="編集中のダッシュボードをプレビュー">
    <svg class="ksqld-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M8 3C4.5 3 1.7 5.4.5 8c1.2 2.6 4 5 7.5 5s6.3-2.4 7.5-5C14.3 5.4 11.5 3 8 3zm0 8.2A3.2 3.2 0 1 1 8 4.8a3.2 3.2 0 0 1 0 6.4zM8 6.2A1.8 1.8 0 1 0 8 9.8 1.8 1.8 0 0 0 8 6.2z"/>
    </svg>プレビュー
  </button>
  ```
  ツールボタンも同様に歯車パスの SVG に置換（`aria-label` は現行維持）。パスは実装時に 16×16 の目視確認で微調整してよい。

**config.css**

```css
.ksqld-icon { width: 14px; height: 14px; vertical-align: -2px; margin-right: 4px; }
```

- `fill="currentColor"` によりボタンの文字色に追従（項目 4 で標準ボタン化しても色が合う）。

### 検証

1. Windows / Mac の主要ブラウザでアイコンが単色で描画され、テキストとベースラインが揃う。
2. ボタンの幅・高さが絵文字時代と大きく変わらない。
3. スクリーンリーダー向け: SVG は `aria-hidden="true"`、ボタン自体のラベル（テキスト or `aria-label`）で読み上げられること。

---

## 6. ヒント文字のコントラスト改善

### 目的

`.ksqld-hint` の `#888`（白背景比 約 3.5:1）は WCAG AA（小文字 4.5:1）未満。制約情報（「最短10分・10分単位」等）がヒントにしか無いため、確実に読める濃さにする。

### 実装内容

**config.css** — 色のみ変更（レイアウト変更なし）:

| セレクタ | 現行 | 変更後 |
|----------|------|--------|
| `.ksqld-hint` | `#888` | `#666`（約 5.7:1） |
| `.ksqld-validate-result.note` | `#888` | `#666` |

- 項目 4 実施後にヒントを `kintoneplugin-desc` へ移行した場合は、`kintoneplugin-desc` の色を config.css 側で `#666` 以上に上書きして担保する（標準スタイルの既定色が薄い場合に備える）。

### 検証

- コントラストチェッカーで `#666` on `#fff` ≥ 4.5:1 を確認。目視でヒント・検証結果の note が読みやすくなっていること。

---

## 7. タブラベルとペインタイトルの重複解消

### 目的

タブ「1 顧客別 APP88」の直下のカードに、丸数字バッジ①＋同じタイトル入力が再度表示され、同一情報が 2 回並ぶ。カード側は「タイトルの編集欄」であることが分かる形に整理する。

### 現状の構造

- テンプレート `.ksqld-pane-head` = 丸数字 `.ksqld-pane-index` ＋ タイトル入力 `.ksqld-pane-title`（placeholder のみ・ラベル無し）。
- `buildPaneCard()` が `.ksqld-pane-index` に番号をセット。タブ側は `paneTabText()` が「番号＋タイトル」を生成。

### 実装内容

**config.html（テンプレート）**

- 丸数字バッジを削除し、タイトル入力に明示ラベルを付ける:
  ```html
  <div class="ksqld-pane-head">
    <label class="ksqld-label" for="">ペイン名（タブに表示されます）</label>
    <input type="text" class="ksqld-input ksqld-pane-title" placeholder="例: 顧客別 集計" />
  </div>
  ```
  ※ template 内で id を使えない（複数生成時に重複する）ため、`<label>` で input を包む形にするか、ラベル→input の順で縦に並べる。SQL ラベルと同じ見た目（`.ksqld-label`）で統一。

**config.js**

- `buildPaneCard()` の `card.querySelector(".ksqld-pane-index").textContent = ...` 行を削除。
- タブ側 `paneTabText()` は現行維持（「番号＋タイトル」はタブが唯一の表示箇所になる）。

**config.css**

- `.ksqld-pane-index` の定義を削除。`.ksqld-pane-head` は縦方向（ラベル＋入力）に変更:
  ```css
  .ksqld-pane-head { margin-bottom: 6px; }
  ```

### 注意点

- ツールダイアログの複写・入れ替え（`refreshOpPanes()`）は「ペイン 1」等の番号表記を使っており、番号の概念自体はタブに残るため影響なし。
- プレビュー・desktop 側の描画（ksql-render.js）はタイトル文字列のみ使用しており影響なし。

### 検証

1. カードに丸数字が無く、「ペイン名」ラベル付き入力になっている。
2. ペイン名入力の変更が従来どおりタブへ即時反映される（`refreshTabLabels` の動作）。
3. 2〜4 分割・タブ切替・複写/入れ替えが従来どおり動作する。

---

## 共通の検証・リリース手順

1. 各項目の実装ごとに `npm run package:upload` でアップロードし、設定画面をリロードして確認（設定画面の JS/CSS/HTML はプラグイン再アップロードで反映される。一覧画面側の確認が必要な場合は「アプリを更新」も行う）。
2. 全項目完了後、`src/manifest.json` の `version` を上げて `npm run package`（dist の zip はコミット対象）。
3. スクリーンショットを撮り直し、README / Qiita 記事の画像更新が必要か確認する（特に項目 4 は見た目が大きく変わる）。

## コミット方針

- 6・5・7 は 1 コミットにまとめてよい（`fix(config): 視認性・重複表示の改善`）。
- 3 は単独コミット（`feat(config): 未保存変更のガードとインジケータ`）。
- 4 は単独コミット（`feat(config): kintone プラグイン標準スタイルシートに準拠`）。CSS 同梱ファイルの追加を含むため差分が大きい。
