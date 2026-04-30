---
name: ととのえる掲載面集計
description: 山忠案件（ととのえる）のOutbrain掲載面集計GASを実行するスキル。「ととのえるの掲載面」「山忠の掲載面集計して」「ととのえるの掲載面取って」「4/1〜4/29のととのえる掲載面」などで積極的に使うこと。
---

# ととのえる掲載面集計スキル

## 目的

指定した期間でととのえる（山忠案件）のOutbrain掲載面集計GASを実行し、「掲載面」タブに上位20件を書き込む。
**全CPN合算のみ対応**（APIの仕様上CPN別フィルタ不可）。

## 設定値（固定）

| 項目 | 値 |
|------|-----|
| スプレッドシートID | `1wu3A_qGBWUOkafOHHHfG_xVe7oBIi4l5j-qwxU0sDhc` |
| GASスクリプトID | `1Yx7MmWC4Ndgxz2YDCgd-BiDS3L6KG3UfnK-HGwcOWmWQ3ytH-kSisxfO` |
| GASファイル名 | `コード`（実行関数：`runSectionReport`） |
| マーケターID | `007d79ad320ca3facfae0f6c585b8a46f1` |
| 対象シート | `掲載面` |
| 開始日セル | C2 |
| 終了日セル | C3 |
| プロジェクト種別 | コンテナバインド（山忠案件_数値集計シートに直接紐づき） |

## コンバージョン名（固定・変更不要）

| 項目 | コンバージョン名 |
|------|------|
| LP遷移数(W) | `1Day 01 LP walking` |
| LP遷移数(B) | `1Day 01LP basic` |
| カート追加 | `Add to cart　NEW(4/7~)`（全角スペースあり） |
| CV数 | `thanks 01day` |

## 出力列構成（16列）

| 列 | 項目 | 備考 |
|---|------|------|
| B | 掲載面名 | |
| C | 配信金額 | API値 / 0.8 * 1.1（管理画面換算） |
| D | CPC | 数式（C/G） |
| E | CPM | 数式（C/F*1000） |
| F | Imp | |
| G | Click | |
| H | CTR | 数式（G/F） |
| I | LP遷移数(W) | `1Day 01 LP walking` |
| J | LP遷移率(W) | 数式（I/G） |
| K | LP遷移数(B) | `1Day 01LP basic` |
| L | LP遷移率(B) | 数式（K/G） |
| M | カート追加 | `Add to cart　NEW(4/7~)` |
| N | カート率 | 数式（M/G） |
| O | CV数 | `thanks 01day`、未マッチ時はm.conversionsをフォールバック |
| P | CVR | 数式（O/G） |
| Q | CPA | 数式（C/O） |

---

## 実行手順

### Step 1: 日程のパース

ユーザーの入力から以下を取得（年省略時は現在年を補完）：

| 入力例 | 変換後 |
|--------|--------|
| `4/1〜4/29` | from=2026-04-01, to=2026-04-29 |
| `4月1日〜29日` | from=2026-04-01, to=2026-04-29 |

### Step 2: シートの日付セルを更新

`mcp__google-workspace__modify_sheet_values` を呼び出す。

```
spreadsheet_id     : 1wu3A_qGBWUOkafOHHHfG_xVe7oBIi4l5j-qwxU0sDhc
range_name         : 掲載面!C2:C3
values             : [["2026/MM/DD"], ["2026/MM/DD"]]
value_input_option : USER_ENTERED
```

### Step 3: GAS実行

`mcp__google-workspace__run_script_function` を呼び出す。

```
script_id         : 1Yx7MmWC4Ndgxz2YDCgd-BiDS3L6KG3UfnK-HGwcOWmWQ3ytH-kSisxfO
function_name     : runSectionReport
dev_mode          : true
user_google_email : koike-m@mirai-kirei.jp
```

> **注意**: Apps Script API経由の実行は404になる場合がある（GCPプロジェクト設定依存）。
> その場合はスプレッドシートのメニュー「📊 掲載面集計」→「▶ 掲載面集計実行」から手動実行する。

### Step 4: 結果表示

```
掲載面集計完了（ととのえる）
期間: YYYY/MM/DD 〜 YYYY/MM/DD
対象: 全CPN合算
GAS実行: ✅ 成功（または ❌ エラー内容）
```

---

## GASプロジェクト情報

| 項目 | 内容 |
|------|------|
| ローカルファイル | `company/clients/yamachu/totonoeru/totonoeru_section_report.gs` |
| GASエディタURL | `https://script.google.com/d/1Yx7MmWC4Ndgxz2YDCgd-BiDS3L6KG3UfnK-HGwcOWmWQ3ytH-kSisxfO/edit` |
| プロジェクト種別 | コンテナバインド（シートを開くと自動でメニュー表示） |
| スクリプトプロパティ | OB_USERNAME / OB_PASSWORD（マーケターID・CV名はコードに埋め込み済み） |

## CPN名取得の仕組み（重要）

Outbrain の管理API（`/marketers/{id}/campaigns`）と reporting API（`/reports/.../campaigns/periodic`）では **キャンペーンIDが別物**。

| API | エンドポイント | IDフィールド | 名前フィールド |
|---|---|---|---|
| 管理API | `/marketers/{id}/campaigns` | `id`（管理用HEX） | `name` |
| reporting API | `/reports/marketers/{id}/campaigns` | `results[].metadata.id`（reporting用HEX） | `results[].metadata.name` |
| periodic | `/reports/marketers/{id}/campaigns/periodic` | `campaignResults[].campaignId` | なし（metadata={}） |

`campaigns/periodic` の `campaignId` は **`reports/campaigns` の `metadata.id`** と一致する。
そのため `buildCampaignMap` は `/reports/marketers/{id}/campaigns?from=&to=` を使い、`metadata.id → metadata.name` でマップを作る。

## 他商材との比較

| 項目 | ブリリオ | ホワイト | ととのえる（山忠） |
|---|---|---|---|
| マーケターID | `00af75b8e5...` | `0033e4d3...` | `007d79ad...` |
| 書き込み先タブ | `掲載面` | `掲載面②` | `掲載面` |
| GAS種別 | スタンドアロン | コンテナバインド | コンテナバインド |
| CV列数 | 2（LP遷移・CV） | 2（LP遷移・CV） | **4**（LP_W・LP_B・カート・CV） |
| タイトル色 | 紫（#7030A0） | 青（#4472C4） | 紫（#7030A0） |
