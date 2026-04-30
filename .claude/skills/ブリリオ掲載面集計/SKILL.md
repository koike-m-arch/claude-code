---
name: ブリリオ掲載面集計
description: ブリリオのOutbrain掲載面集計GASを実行するスキル。「/ブリリオ掲載面集計」「掲載面集計実行して」「掲載面のデータ取って」「掲載面見たい」「4/1〜4/29の掲載面」などで積極的に使うこと。
---

# ブリリオ掲載面集計スキル

## 目的

指定した期間でブリリオのOutbrain掲載面集計GASを実行し、「掲載面」タブに上位20件を書き込む。
**全CPN合算のみ対応**（APIの仕様上CPN別フィルタ不可）。

## 設定値（固定）

| 項目 | 値 |
|------|-----|
| スプレッドシートID | `1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8` |
| GASスクリプトID | `1IvxXM-qnjfoFAnO8vsF_XbVP3wOcK-V9NUYi2XcsAEfKzze87Ygt8oa5` |
| GASファイル名 | `コード`（実行関数：`runSectionReport`） |
| 対象シート | `掲載面` |
| 開始日セル | C2 |
| 終了日セル | C3 |
| CPN選択セル | C4（全CPN合算のみ。CPN別はAPI非対応） |
| LP遷移コンバージョン名 | `01 LP 01d`（スクリプトプロパティ `LP_CONV_NAME` で変更可） |
| CVコンバージョン名 | `03 all thanks 01d`（スクリプトプロパティ `CV_CONV_NAME` で変更可） |

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
| I | LP遷移数 | conversionMetrics["01 LP 01d"] |
| J | LP遷移率 | 数式（I/G） |
| K | LPCVR | 数式（L/I） |
| L | CV数 | conversionMetrics["03 all thanks 01d"]、未マッチ時はm.conversionsをフォールバック |
| M | CVR | 数式（L/G） |
| N | CPA | 数式（C/L） |

## APIの制約（重要）

| エンドポイント | 結果 | 備考 |
|---|---|---|
| `/reports/marketers/{id}/sections` | ✅ 200 | **メイン使用**。エンドポイント順1番目 |
| `/reports/marketers/{id}/publishers` | ✅ 200 | フォールバック。2番目 |
| `/reports/marketers/{id}/publishers/periodic` | △ | 3番目（環境によって500になる場合あり） |
| CPN別エンドポイント各種 | ❌ 500 | 使用不可 |

**CPN別フィルタは不可能**。C4でCPN選択しても全CPN合算データを表示し、その旨をアラートで通知する。

---

## 実行手順

### Step 1: 日程のパース

ユーザーの入力から以下を取得：

| 入力例 | 変換後 |
|--------|--------|
| `4/1〜4/29` | from=2026-04-01, to=2026-04-29 |
| `4月1日〜29日` | from=2026-04-01, to=2026-04-29 |

- 年が省略された場合は 2026年 を補完

### Step 2: シートの日付セルを更新

`mcp__google-workspace__modify_sheet_values` を呼び出す。

```
spreadsheet_id : 1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8
range_name     : 掲載面!C2:C3
values         : [["2026/MM/DD"], ["2026/MM/DD"]]
value_input_option : USER_ENTERED
```

### Step 3: GAS実行

`mcp__google-workspace__run_script_function` を呼び出す。

```
script_id         : 1IvxXM-qnjfoFAnO8vsF_XbVP3wOcK-V9NUYi2XcsAEfKzze87Ygt8oa5
function_name     : runSectionReport
dev_mode          : true
user_google_email : koike-m@mirai-kirei.jp
```

> **注意**: Apps Script API経由の実行は404になる場合がある（GCPプロジェクト設定依存）。
> その場合はスプレッドシートのメニュー「📊 掲載面集計」→「▶ 掲載面集計実行」から手動実行する。

### Step 4: 結果表示

```
掲載面集計完了（ブリリオ）
期間: YYYY/MM/DD 〜 YYYY/MM/DD
対象: 全CPN合算
GAS実行: ✅ 成功（または ❌ エラー内容）
```

---

## GASプロジェクト情報

| 項目 | 内容 |
|------|------|
| ローカルファイル | `company/projects/brillio_section_report.gs` |
| GASエディタURL | `https://script.google.com/u/0/home/projects/1IvxXM-qnjfoFAnO8vsF_XbVP3wOcK-V9NUYi2XcsAEfKzze87Ygt8oa5/edit` |
| プロジェクト種別 | スタンドアロン（数値集計GASとは完全に独立した別プロジェクト） |
| スクリプトプロパティ | OB_USERNAME / OB_PASSWORD / OB_MARKETER_ID / LP_CONV_NAME / CV_CONV_NAME |
