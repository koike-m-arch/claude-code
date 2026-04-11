---
name: ブリリオOBレポート
description: 指定した日程でブリリオのOutbrainレポートGASを実行するスキル。「/ブリリオOBレポート」「ブリリオのOBレポート取得して」「Outbrainレポート実行して」「4/1〜4/7でレポート取って」などで積極的に使うこと。
---

# ブリリオOBレポート実行スキル

## 目的

指定した日程で「数値集計」シートのC2/C3を更新し、GAS `runOutbrainReport` を実行して各シートにOutbrainデータを書き込む。

## 設定値（固定）

| 項目 | 値 |
|------|-----|
| スプレッドシートID | `1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8` |
| GASスクリプトID | `1ry2DLsDHSOyfIGzBCkBJM_BbEvGJhhRHVX3a1mtWuCwmO_v6FC7A2J8F` |
| 対象シート | `数値集計` |
| 開始日セル | C2 |
| 終了日セル | C3 |

<!-- スクリプトID設定済み: 2026-04-10確認 -->

---

## 実行手順

### Step 1: 日程のパース

ユーザーの入力から開始日・終了日を取得する。以下の形式に対応：

| 入力例 | 変換後 |
|--------|--------|
| `4/1〜4/7` | from=2026-04-01, to=2026-04-07 |
| `4月1日〜7日` | from=2026-04-01, to=2026-04-07 |
| `2026-04-01 2026-04-07` | そのまま |
| `4/1 4/7` | from=2026-04-01, to=2026-04-07 |

- 年が省略された場合は **2026年** を補完する
- 終了日が省略された場合はスキル起動前に確認する

### Step 2: シートの日程セルを更新

`mcp__google-workspace__modify_sheet_values` を呼び出す。

- `spreadsheet_id`: `1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8`
- `range_name`: `数値集計!C2:C3`
- `values`: `[["2026/MM/DD"], ["2026/MM/DD"]]`（YYYY/MM/DD形式）
- `value_input_option`: `USER_ENTERED`

### Step 3: GAS実行

スクリプトIDが `1ry2DLsDHSOyfIGzBCkBJM_BbEvGJhhRHVX3a1mtWuCwmO_v6FC7A2J8F` のまま（未設定）の場合:
→ ユーザーに「ブリリオ配信戦略のApps ScriptのスクリプトIDを教えてください」と確認し、受け取ったらStep 3の前にこのファイルを更新してから実行する。

スクリプトIDが設定済みの場合:
`mcp__google-workspace__run_script_function` を呼び出す。

- `script_id`: `1ry2DLsDHSOyfIGzBCkBJM_BbEvGJhhRHVX3a1mtWuCwmO_v6FC7A2J8F`
- `function_name`: `runOutbrainReportApi`
- `dev_mode`: `true`
- `user_google_email`: `koike-m@mirai-kirei.jp`

### Step 4: 結果表示

実行結果を以下の形式で表示する：

```
ブリリオOBレポート実行完了
期間: YYYY/MM/DD 〜 YYYY/MM/DD
GAS実行: ✅ 成功（または ❌ エラー内容）
```

エラーの場合は `run_script_function` の返り値をそのまま表示する。
