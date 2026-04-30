---
name: ホワイト掲載面集計
description: ホワイトのOutbrain掲載面集計GASを実行するスキル。「ホワイトの掲載面」「掲載面②集計して」「ホワイトの掲載面取って」「4/1〜4/29のホワイト掲載面」などで積極的に使うこと。
---

# ホワイト掲載面集計スキル

## 目的

指定した期間でチェルラーホワイトのOutbrain掲載面集計GASを実行し、「掲載面②」タブに上位20件を書き込む。
**全CPN合算のみ対応**（APIの仕様上CPN別フィルタ不可）。

## 設定値（固定）

| 項目 | 値 |
|------|-----|
| スプレッドシートID | `1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8`（ブリリオと同じ） |
| GASスクリプトID | `1LNpXzcE-f3Do5_qhAky1V732Qhzj_xWg4wgH-0sM9ZxTP5aZHBAdORKv`（コンテナバインド・確定） |
| GASファイル名 | `コード`（実行関数：`runSectionReport`） |
| マーケターID | `0033e4d3d312b31c84630c2166acec7b27`（ホワイト固有） |
| 対象シート | `掲載面②` |
| 開始日セル | C2 |
| 終了日セル | C3 |
| LP遷移コンバージョン名 | `01LP`（ブリリオの `01 LP 01d` とは異なる） |
| CVコンバージョン名 | `thanks 1day`（white_daily_update.py と同じ） |

## 出力列構成（13列）

| 列 | 項目 | 備考 |
|---|------|------|
| B | 掲載面名 | |
| C | 配信金額 | API値 / 0.8 * 1.1（管理画面換算） |
| D | CPC | 数式（C/G） |
| E | CPM | 数式（C/F*1000） |
| F | Imp | |
| G | Click | |
| H | CTR | 数式（G/F） |
| I | LP遷移数 | conversionMetrics["01LP"] |
| J | LP遷移率 | 数式（I/G） |
| K | LPCVR | 数式（L/I） |
| L | CV数 | conversionMetrics["thanks 1day"]、未マッチ時はm.conversionsをフォールバック |
| M | CVR | 数式（L/G） |
| N | CPA | 数式（C/L） |

## ブリリオとの違い

| 項目 | ブリリオ | ホワイト |
|---|---|---|
| マーケターID | `00af75b8e5565b04764d17c4f90cb25caf` | `0033e4d3d312b31c84630c2166acec7b27` |
| 書き込み先タブ | `掲載面` | `掲載面②` |
| タイトル色 | 紫（#7030A0） | 青（#4472C4） |
| GASスクリプトID | `1IvxXM-...`（スタンドアロン） | `1LNpXzcE-...`（コンテナバインド） |
| LP遷移コンバージョン名 | `01 LP 01d` | `01LP` |
| CVコンバージョン名 | `03 all thanks 01d` | `thanks 1day` |
| トークンキャッシュキー | `OB_SECTION_TOKEN_CACHE` | `OB_WHITE_SECTION_TOKEN_CACHE` |

---

## 実行手順

### Step 1: 日程のパース

ユーザーの入力から以下を取得（年省略時は2026年補完）：

| 入力例 | 変換後 |
|--------|--------|
| `4/1〜4/29` | from=2026-04-01, to=2026-04-29 |

### Step 2: シートの日付セルを更新

`mcp__google-workspace__modify_sheet_values` を呼び出す。

```
spreadsheet_id     : 1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8
range_name         : 掲載面②!C2:C3
values             : [["2026/MM/DD"], ["2026/MM/DD"]]
value_input_option : USER_ENTERED
```

### Step 3: GAS実行

`mcp__google-workspace__run_script_function` を呼び出す。

```
script_id         : 1LNpXzcE-f3Do5_qhAky1V732Qhzj_xWg4wgH-0sM9ZxTP5aZHBAdORKv
function_name     : runSectionReport
dev_mode          : true
user_google_email : koike-m@mirai-kirei.jp
```

> **注意**: Apps Script API経由の実行は404になる場合がある（GCPプロジェクト設定依存）。
> その場合はスプレッドシートのメニュー「📊 掲載面②」→「▶ 掲載面集計実行」から手動実行する。

### Step 4: 結果表示

```
掲載面集計完了（ホワイト）
期間: YYYY/MM/DD 〜 YYYY/MM/DD
GAS実行: ✅ 成功（または ❌ エラー内容）
```

---

## GASプロジェクト情報

| 項目 | 内容 |
|------|------|
| ローカルファイル | `company/projects/white_section_report.gs` |
| GASエディタURL | `https://script.google.com/d/1LNpXzcE-f3Do5_qhAky1V732Qhzj_xWg4wgH-0sM9ZxTP5aZHBAdORKv/edit` |
| プロジェクト種別 | コンテナバインド（シートを開くと自動でメニュー表示） |
| スクリプトプロパティ | OB_USERNAME / OB_PASSWORD（LP_CONV_NAME・CV_CONV_NAMEはコードにデフォルト値設定済み） |

## スプレッドシートメニュー

| メニュー項目 | 関数 | 用途 |
|---|---|---|
| ▶ 掲載面集計実行 | `runSectionReport` | 集計実行 |
| 🔍 APIデバッグ | `debugSectionApi` | エンドポイント疎通確認 |
| 🔍 コンバージョン名一覧 | `listConversionNames` | コンバージョン名を実測で一覧表示 |
| ⚙ シート初期化 | `initSectionSheet` | シート作成 |
| 🔧 タブ名修正（掲載面③→②） | `renameSheet` | ワンタイム関数 |
