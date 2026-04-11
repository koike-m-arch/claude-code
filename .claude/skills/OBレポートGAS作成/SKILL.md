---
name: OBレポートGAS作成
description: 新規クライアント用のOutbrainレポートGASコードとPythonスクリプトを生成・保存するスキル。必要情報を入力するだけで完全なGASファイルとPythonスクリプトを作成できる。「OBのGAS作って」「Outbrainレポートのスクリプト作成」「新規クライアントのOB設定」「数値集計GAS作って」などで積極的に使うこと。
---

# OBレポートGAS作成スキル

## 目的

クライアントごとのOutbrainレポートGASコードとPythonスクリプトを生成・保存する。
ブリリオ / ホワイト / ととのえる と同じ構造を持つ完全なファイルを出力する。

成果物：
1. **GASファイル** (`[名前]_outbrain_report.gs`) ― シートへの全データ書き込み
2. **Pythonスクリプト** (`update_lp_conversions_[名前].py`) ― GAS認証失敗時のバックアップ、またはI・K・M・O列等のコンバージョン値だけを再書き込みするスクリプト

---

## Step 1: 必要情報の収集【スキル起動直後に必ず全項目を一括確認する】

スキルが起動したら、作業を始める前に**以下のフォームをそのままチャットに出力して**、ユーザーに一括入力を求めること。個別に質問してはいけない。

---

**出力するフォーム（コードブロックで表示）：**

```
📋 OBレポートGAS作成 — 必要情報入力フォーム

【基本情報】
① クライアント名（例: ととのえる）
   →

② ファイル保存先パス（例: yamachu/totonoeru）
   company/clients/ 配下のパスを記入
   →

③ 書き込み先シート名（例: ととのえる（OB））
   スプレッドシートのタブ名をそのまま記入
   →

【Outbrain アカウント情報】
④ マーケターID
   管理画面URL → https://my.outbrain.com/amplify/site/marketers/【ここ】/reports/...
   →

【スプレッドシート情報（MCP直接デプロイを使う場合）】
⑤ スプレッドシートURL（任意）
   https://docs.google.com/spreadsheets/d/【スプレッドシートID】/edit
   →

⑥ Apps ScriptプロジェクトID（任意・MCP直接書き込みに使用）
   Apps Script エディタのURL → script.google.com/home/projects/【ここ】/edit
   →

【カスタムコンバージョン（管理画面の表示名を記入）】
⑦ コンバージョン①：管理画面表示名 / シートラベル / 種別
   種別: LP型 / 中間型 / CV型（CV型は必ず最後の1つ）
   例）"1 Day 01 LP walking Conversions (Click)" / LP遷移数(W) / LP型
   →

⑧ コンバージョン②（あれば）：管理画面表示名 / シートラベル / 種別
   →

⑨ コンバージョン③（あれば）：管理画面表示名 / シートラベル / 種別
   →

⑩ コンバージョン④（あれば）：管理画面表示名 / シートラベル / 種別
   →
```

---

フォームを受け取ったら、空欄の項目があっても②・③・④・コンバージョン最低1件があれば作業を開始してよい。
⑤⑥はMCP直接デプロイを行う場合のみ必要。入力がなければローカル保存のみとする。

以下がすべて揃っていない場合のみ追加で確認する（フォームで対応できなかった場合のフォールバック）。

| 項目 | 説明 | 例 |
|------|------|----|
| クライアント名 | コード内コメント・UI表示用 | `ととのえる` |
| 保存先パス | `company/clients/` 配下 | `yamachu/totonoeru` |
| シート名 | 書き込み先タブ名 | `ととのえる（OB）` |
| マーケターID | 管理画面URLの `/marketers/XXXXX/` 部分 | `007d79ad320ca3facfae0f6c585b8a46f1` |
| コンバージョン一覧 | 管理画面の表示名とシート上のラベル（後述） | 下記参照 |

**コンバージョン情報の形式：**
```
管理画面表示名                               → シートラベル（種別）
"1 Day 01 LP walking Conversions (Click)"  → LP遷移数(W)  ← LP型
"1 Day 01 LP basic Conversions (Click)"    → LP遷移数(B)  ← LP型
"Add to cart NEW(4/7~) Conversions (Click)"→ カート追加   ← 中間型
"thanks 01 day Conversions (Click)"        → CV数         ← CV型（必ず最後）
```

コンバージョンの種別：
- **LP型**：LP遷移数系（率 = 値/Click）
- **中間型**：カート追加など（率 = 値/Click）
- **CV型**：必ず最後の1つ。CVR + LPCVR（LP型が1つ以上ある場合）+ CPA も自動付与

---

## Step 2: APIコンバージョン名の導出

管理画面表示名から末尾の ` Conversions (Click)` を除去したものがAPI名。

| 管理画面表示名 | API名（コードに使う値） |
|---|---|
| `"01LP Conversions (Click)"` | `"01LP"` |
| `"thanks 1day Conversions (Click)"` | `"thanks 1day"` |
| `"1 Day 01 LP walking Conversions (Click)"` | `"1 Day 01 LP walking"` |

⚠ **API名は管理画面表示名とスペースが異なる場合がある（実績あり）**

管理画面表示名から単純に ` Conversions (Click)` を除いただけでは合わないケースがある：

| 管理画面表示名（推測） | 実際のAPI名 |
|---|---|
| `"1 Day 01 LP walking"` | `"1Day 01 LP walking"` ← スペースなし |
| `"1 Day 01 LP basic"` | `"1Day 01LP basic"` ← スペース位置が違う |
| `"thanks 01 day"` | `"thanks 01day"` ← スペースなし |
| `"Add to cart NEW(4/7~)"` | `"Add to cart　NEW(4/7~)"` ← 全角スペース(U+3000) |

→ 初回は推測で設定し、**「📋 コンバージョン名を確認」メニューで実際のAPI名を必ず確認**して定数を修正すること。

---

## Step 3: 列構成の決定

コンバージョン数に応じて列が変わる。ルール：

### CPN別（B列スタート）

```
B=CPN名 | C=①配信金額 | D=②CPC | E=③CPM | F=④Imp | G=⑤Click | H=⑥CTR
[LP型・中間型] → 各2列（値 + 率）
[CV型（最後）] → CV数 | CVR | LPCVR（LP型があれば） | CPA
```

**例：コンバージョン3種（LP・中間・CV）の場合（ホワイト実装済み）**
```
I=LP遷移数 | J=LP遷移率 | K=LPCVR | L=確認画面 | M=確認画面率 | N=CV数 | O=CVR | P=CPA
（計 B〜P = 15列）
```
※ ホワイトはLPCVRをLP率の直後（K列）に配置。中間型の後ではなくLP率直後に入れる点に注意。

**例：コンバージョン4種（LP-W・LP-B・カート・CV）の場合（ととのえる）**
```
I=LP-W | J=LP-W率 | K=LP-B | L=LP-B率 | M=カート | N=カート率 | O=CV数 | P=CVR | Q=LPCVR(W+B) | R=CPA
（計 B〜R = 17列）
```

### LPCVRの計算式

- LP型が1つ → `CV / LP`
- LP型が複数（W・Bなど）→ `CV / (LP-W + LP-B + ...)` ← **全LP型の合計を分母にする**

### CR別（B列スタート）

CPN別の先頭に `C=CR画像` と `D=CRタイトル` が追加。配信金額がE列スタートになる。

---

## Step 4: コードの生成

コンバージョン数に応じてテンプレートを選ぶ：
- `company/clients/yamachu/totonoeru/totonoeru_outbrain_report.gs`（4コンバージョン構成・LP×2+中間+CV）
- `company/clients/armard/white/white_outbrain_report.gs`（3コンバージョン構成・LP+中間+CV・完成済み）

以下の部分を置き換えてGASコードを生成する：

### 置換箇所一覧

| 箇所 | 変更内容 |
|------|----------|
| ファイル冒頭コメント | クライアント名・シート名 |
| `SHEET_NAME` | 指定シート名 |
| `MARKETER_ID` | 抽出したマーケターID（**定数として固定。Script Propertiesに依存しない**） |
| コンバージョン定数（`LP_WALK_DEFAULT` 等） | 各コンバージョンのAPI名・変数名・コメント |
| `getCampaignReport` の集計ループ | コンバージョンの変数名に合わせて調整 |
| `getCreativeReport` の集計ループ | 同上 |
| `writeToSheet` のヘッダー・値配列・数値フォーマット行 | 列構成に合わせて調整 |
| `setCpnFormulas` | 列番号・変数名を調整 |
| `setCrFormulas` | 列番号・変数名を調整 |
| `listConversionEvents` の期待値表示 | 各コンバージョン名に変更 |
| `showSetupGuide` のHTML | クライアント名・マーケターID・コンバージョン名 |
| `onOpen` のメニュー名 | `🔧 [クライアント名]Outbrainレポート` |

### 実装上の必須ポイント

**① マーケターIDは定数として固定する（最重要）**
```javascript
var MARKETER_ID_[CLIENT] = '[抽出したID]'; // [クライアント名]固定（Script Propertiesに依存しない）
```
理由：同一スプレッドシートに複数のGASが同居する場合、`PropertiesService` の `OB_MARKETER_ID` は共有されるため他クライアントのIDが混入する。

**② グローバル変数・関数名はすべてクライアント固有サフィックスをつける（最重要）**

GAS V8 では同一プロジェクト内の全 `.gs` ファイルがグローバル名前空間を共有する。
複数クライアントのGASを同居させると `var` の重複宣言で後勝ちが起き、正しくない値で動作する。

```javascript
// NG: 汎用名はコンフリクトする
var SHEET_NAME = '数値集計②';
var LP_CONV_DEFAULT = '01LP';

// OK: クライアント名サフィックスをつける
var SHEET_NAME_WHITE = '数値集計②';
var LP_CONV_DEFAULT_WHITE = '01LP';
var MARKETER_ID_WHITE = '0033e4d3d312b31c84630c2166acec7b27';
```

関数名も同様：`runOutbrainReportWhite`, `writeToSheetWhite`, `onOpen` は1ファイルのみに定義。
`onOpen()` はプロジェクト内で重複させない（ブリリオ+ホワイト同居時はブリリオ側に統合）。

**② `runOutbrainReportApi` 関数を必ず含める**
MCPスキルから外部呼び出しするためのエントリポイント（UIなし版）。

**③ `buildCampaignMap` はページネーション対応を維持する**
50件超のキャンペーンがあるクライアントに対応するため `offset` ループは必須。

**④ 429フォールバックを維持する**
ログイン時の429レート制限に対し、期限切れキャッシュトークンをフォールバックとして使う処理は削除しない。

**⑤ convMatch関数は全角スペースを正規化する**
コンバージョン名に全角スペース（U+3000）が含まれる場合があるため、比較前に半角へ変換する：

```javascript
function convMatchXxx(apiName, targetName) {
  if (!apiName || !targetName) return false;
  var normalize = function(s) { return s.replace(/\u3000/g, ' ').toLowerCase().trim(); };
  var a = normalize(apiName);
  var t = normalize(targetName);
  return a === t || a.indexOf(t) === 0 || t.indexOf(a) === 0;
}
```

---

## Step 5: GASファイル保存

生成したコードを以下のパスに保存する：
```
company/clients/[保存先パス]/[クライアント名]_outbrain_report.gs
```

例: `company/clients/yamachu/totonoeru/totonoeru_outbrain_report.gs`

ディレクトリが存在しない場合はユーザーに確認してから作成する。

---

## Step 5.5: [オプション] GAS直接デプロイ（MCP使用）

ローカル保存に加えて、Apps ScriptプロジェクトへMCP経由で直接書き込むことができる。

### 必要な情報

| 項目 | 取得方法 |
|---|---|
| スクリプトプロジェクトID | Apps Scriptエディタを開き、URLの `script.google.com/home/projects/【ここ】/edit` をコピー |

### 手順

1. `mcp__google-workspace__get_script_content` で既存のスクリプト内容を取得・確認
2. 生成したGASコードを `mcp__google-workspace__update_script_content` で書き込む
3. 書き込み後、ユーザーにApps Scriptエディタで保存・実行してもらう

> **注意**: `update_script_content` はファイル全体を上書きするため、既存の別GASファイルが同じプロジェクトにある場合は取得してから全ファイルをまとめて送信する。

---

## Step 6: Pythonスクリプト作成

最新テンプレート: `update_lp_conversions_totonoeru.py`（ルートディレクトリ）

以下を置き換えてスクリプトを生成し、**ルートディレクトリ**に保存する：

| 変数 | 変更内容 |
|------|----------|
| `SS_ID` | スプレッドシートID（URLの `/d/XXXXX/` 部分） |
| `SHEET_NAME` | 書き込み先シート名 |
| `MARKETER_ID` | ととのえるGASと同じID（定数固定） |
| `OB_TOKEN` | 共通トークン（変更不要・miraikirei共通） |
| コンバージョン定数 | 各API名と変数名 |
| 書き込み列 | I/K/M/O 等を列構成に合わせて変更 |
| 更新ログ (`//div`) | `len(data_updates) // [コンバージョン数]` |

**保存パス:**
```
update_lp_conversions_[クライアント名].py
```

例: `update_lp_conversions_totonoeru.py`

**書き込み列とコンバージョン対応（ととのえる例）:**

| 列 | コンバージョン |
|----|---------------|
| I列 | LP遷移数(W) |
| K列 | LP遷移数(B) |
| M列 | カート追加 |
| O列 | CV数 |

GAS の `writeToSheet` の列構成と一致させること。

---

## Step 7: 完了メッセージ

```
✅ OBレポートGAS・Pythonスクリプト生成完了

GAS:    company/clients/[パス]/[名前]_outbrain_report.gs
Python: update_lp_conversions_[名前].py

## Apps Script セットアップ手順

1. スプレッドシート → 拡張機能 → Apps Script
2. 新しいファイルを作成して生成コードを貼り付け
3. Script Properties に以下を追加：
   | プロパティ名 | 値 |
   |---|---|
   | OB_USERNAME | miraikirei |
   | OB_PASSWORD | [パスワード] |
   | OB_TOKEN_CACHE | [キャッシュトークン] |
   | OB_TOKEN_CACHE_TS | 9999999999999 |
   ※ OB_MARKETER_ID は不要（コードに直接埋め込み済み）

4. [シート名] の C2 に開始日、C3 に終了日を入力
5. メニュー「▶ レポート取得実行」を実行

## Pythonスクリプト実行方法（GAS代替・コンバージョン値のみ更新）
  python update_lp_conversions_[名前].py
  # または期間指定:
  python update_lp_conversions_[名前].py 2026-04-01 2026-04-07

## コンバージョン名の確認
初回実行後、「📋 コンバージョン名を確認」メニューで
APIの実際の名前を検証し、ズレがあれば定数を修正してください。

## 想定コンバージョン（API名）
[コンバージョン一覧をここに列挙]
```

---

## 参考：既存クライアント情報

| クライアント | Marketer ID | シート名 | GASファイル |
|---|---|---|---|
| チェルラーブリリオ | `0033e4d3d312b31c84630c2166acec7b27` | 数値集計 | `company/projects/brillio_outbrain_report.gs` |
| チェルラーホワイト | `0033e4d3d312b31c84630c2166acec7b27` | 数値集計② | `company/clients/armard/white/white_outbrain_report.gs` |
| 山忠ととのえる | `007d79ad320ca3facfae0f6c585b8a46f1` | ととのえる（OB） | `company/clients/yamachu/totonoeru/totonoeru_outbrain_report.gs` |

### ホワイトのコンバージョン構成（完成済み参照）

| API名 | 管理画面表示名 | 種別 | 列（CPN別） |
|---|---|---|---|
| `01LP` | `01LP Conversions (Click)` | LP型 | I=LP遷移数, J=LP遷移率, K=LPCVR |
| `02 confirm 1day` | `02 confirm 1day Conversions (Click)` | 中間型 | L=確認画面, M=確認画面率 |
| `thanks 1day` | `thanks 1day Conversions (Click)` | CV型 | N=CV数, O=CVR, P=CPA |

ブリリオ+ホワイト同居のため：`onOpen()` はブリリオ側に統合、ホワイト側は `onOpen()` なし（またはホワイト単独スプレッドシートで使う場合のみ `onOpen()` を含める）。
