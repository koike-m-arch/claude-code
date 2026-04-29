---
name: ブリリオ掲載面集計
description: ブリリオのOutbrain掲載面集計GASを実行するスキル。「/ブリリオ掲載面集計」「掲載面集計実行して」「掲載面のデータ取って」「掲載面見たい」「4/1〜4/29の掲載面」などで積極的に使うこと。
---

# ブリリオ掲載面集計スキル

## 目的

指定した期間・CPN条件でブリリオのOutbrain掲載面集計GASを実行し、「掲載面」タブに上位20件を書き込む。

## 設定値（固定）

| 項目 | 値 |
|------|-----|
| スプレッドシートID | `1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8` |
| GASスクリプトID | `15NH_7fjmdkTEmG44zmSvO1E7Hop4mjZwhoCvyy1mjpEl6SLvztrOje0a` |
| 対象シート | `掲載面` |
| 開始日セル | C2 |
| 終了日セル | C3 |
| CPN選択セル | C4（「全体」または配信CPN名） |

<!-- スクリプトID確認後にここを更新すること -->

## 2つのモード

| モード | C4の値 | 表示内容 |
|--------|--------|----------|
| 全体モード | `全体` | 全CPN合算の上位20掲載面 |
| CPN別モード | CPN名を選択 | 選択CPNのみの上位20掲載面 |

明示がなければ「全体」で実行する。

---

## 実行手順

### Step 1: 日程・モードのパース

ユーザーの入力から以下を取得：

| 入力例 | 変換後 |
|--------|--------|
| `4/1〜4/29` | from=2026-04-01, to=2026-04-29 |
| `4月1日〜29日` | from=2026-04-01, to=2026-04-29 |

- 年が省略された場合は 2026年 を補完
- CPN指定がなければ「全体」

### Step 2: シートの日付セルを更新

`mcp__google-workspace__modify_sheet_values` を呼び出す。

```
spreadsheet_id : 1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8
range_name     : 掲載面!C2:C3
values         : [["2026/MM/DD"], ["2026/MM/DD"]]
value_input_option : USER_ENTERED
```

CPN選択も更新（デフォルト「全体」）：
```
range_name : 掲載面!C4
values     : [["全体"]]  ← またはCPN名
```

### Step 3: GAS実行

`mcp__google-workspace__run_script_function` を呼び出す。

```
script_id       : 15NH_7fjmdkTEmG44zmSvO1E7Hop4mjZwhoCvyy1mjpEl6SLvztrOje0a
function_name   : runSectionReport
dev_mode        : true
user_google_email : koike-m@mirai-kirei.jp
```

**スクリプトIDが未設定の場合：**
→ 「掲載面集計GASプロジェクトのApps ScriptスクリプトIDを教えてください（Apps Script エディタURL中の `projects/XXXXX/edit` の部分）」と確認し、受け取ったらこのSKILL.mdを更新してから実行する。

### Step 4: 結果表示

```
掲載面集計完了
期間: YYYY/MM/DD 〜 YYYY/MM/DD
対象: 全体（またはCPN名）
GAS実行: ✅ 成功（または ❌ エラー内容）
```

---

## GASファイル情報

| 項目 | 内容 |
|------|------|
| ローカルファイル | `company/projects/brillio_section_report.gs` |
| プロジェクト | 数値集計GASとは**完全に独立した別プロジェクト** |
| アクセス方法 | `SpreadsheetApp.openById()` でスプレッドシートIDを直接指定 |
| 書き込み先 | ブリリオ配信戦略スプレッドシートの「掲載面」タブ（gid=1483827248） |

---

## Outbrain API 掲載面取得の注意点

CPN単位のエンドポイント `/campaigns/{id}/publishers/periodic` は **500エラーで使用不可**。

代わりに以下の優先順で試みる（コード実装済み）：

1. `/reports/marketers/{id}/publishers/periodic`（マーケター全体・全CPN合算）
2. `/reports/marketers/{id}/campaigns/periodic?breakdown=section`
3. `/reports/marketers/{id}/campaigns/periodic?breakdown=publisher`

取得後にキャンペーンIDでフィルタリングしてCPN別集計を実現する。
