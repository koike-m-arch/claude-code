---
name: ととのえるSNレポート
description: ととのえる（SN）シートのSmartNewsレポートGASを実行するスキル。「/ととのえるSNレポート」「スマートニュースのレポート取って」「SNレポート実行して」「ととのえるのSN集計」などで積極的に使うこと。
---

# ととのえる SmartNews レポートスキル

## 目的

指定した期間でSmartNews Marketing API v3を叩き、「ととのえる（SN）」シートにCPN別・CR別の数値集計を書き込む。

---

## 設定値（固定）

| 項目 | 値 |
|------|-----|
| アカウントID | `97065339` |
| GASスクリプトID | `1qxaL_EoxKgBMZFp-cMxjqC1yipBP_EVnzbL4T6pjf1XfZHhmL1jUyajq` |
| GAS関数名 | `runSnReportTotonoeru` |
| 対象シート | `ととのえる（SN）` |
| 開始日セル | C2 |
| 終了日セル | C3 |
| ローカルGASファイル | `company/clients/yamachu/totonoeru/totonoeru_smartnews_report.gs` |

---

## 実行手順

### Step 1: 日程のパース

ユーザーの入力から以下を取得：

| 入力例 | 変換後 |
|--------|--------|
| `4/1〜4/29` | from=2026-04-01, to=2026-04-29 |
| `4月1日〜29日` | from=2026-04-01, to=2026-04-29 |

- 年が省略された場合は現在年を補完

### Step 2: シートの日付セルを更新

`mcp__google-workspace__modify_sheet_values` を呼び出す。

```
spreadsheet_id     : （スプレッドシートIDはMCPでシートを検索して取得、またはユーザーに確認）
range_name         : ととのえる（SN）!C2:C3
values             : [["YYYY/MM/DD"], ["YYYY/MM/DD"]]
value_input_option : USER_ENTERED
user_google_email  : koike-m@mirai-kirei.jp
```

### Step 3: GAS実行

`mcp__google-workspace__run_script_function` を呼び出す。

```
script_id         : 1qxaL_EoxKgBMZFp-cMxjqC1yipBP_EVnzbL4T6pjf1XfZHhmL1jUyajq
function_name     : runSnReportTotonoeru
dev_mode          : true
user_google_email : koike-m@mirai-kirei.jp
```

### Step 4: 結果表示

```
✅ ととのえる SNレポート完了
期間: YYYY/MM/DD 〜 YYYY/MM/DD
CPN別集計 + CR別集計（画像・見出し含む）を「ととのえる（SN）」シートに書き込みました
```

---

## SmartNews Marketing API v3 仕様（2026-04 検証済み）

### 認証

- フロー: `client_credentials`
- トークンエンドポイント: `https://ads.smartnews.com/api/oauth/v1/access_tokens`
- スクリプトプロパティ: `SN_CLIENT_ID`, `SN_CLIENT_SECRET`

### エンドポイント

| 用途 | URL |
|------|-----|
| キャンペーン一覧 | `GET /api/ma/v3/ad_accounts/{id}/campaigns` |
| 広告一覧（CR情報取得） | `GET /api/ma/v3/ad_accounts/{id}/ads` |
| キャンペーン別insights | `GET /api/ma/v3/ad_accounts/{id}/insights/campaigns` |
| 広告別insights | `GET /api/ma/v3/ad_accounts/{id}/insights/ads` |

### 確定フィールド名（metrics_ プレフィックス必須）

```
metrics_budget_spent, metrics_click, metrics_ctr, metrics_cpm, metrics_cpc,
metrics_cvr_purchase, metrics_cvr_view_content, metrics_cvr_add_to_cart, metrics_cvr_search
```

### 日付形式

`?since=YYYY-MM-DDT00:00:00Z&until=YYYY-MM-DDT23:59:59Z`

### 算出値

| 指標 | 計算式 |
|------|--------|
| IMP | `Math.round(click / ctr)` |
| LP遷移数(W) | `Math.round(click × cvr_view_content)` |
| LP遷移数(B) | `Math.round(click × cvr_search)` |
| カート追加 | `Math.round(click × cvr_add_to_cart)` |
| CV | `Math.round(click × cvr_purchase)` |

### `/insights/ads` レスポンス構造

- `row.parent.parent.id` = キャンペーンID
- `row.parent.parent.name` = キャンペーン名
- `row.id` = 広告ID（※`ad_id`フィールドではなく集計キーとして使用）

### `/ads` レスポンス構造（CR情報）

- `a.ad_id` = 広告ID（**`a.id` ではなく `a.ad_id`**）
- `a.creative.image_creative_info.media_files[0].images.full.url` = CR画像URL
- `a.creative.image_creative_info.headline` = 見出し

---

## シート構成

### CPN別集計（行6〜）

| 列 | 内容 |
|----|------|
| B | CPN名 |
| C〜R | ①配信金額〜⑯CPA |

### CR別集計（CPN別集計の2行下から）

| 列 | 内容 |
|----|------|
| B | CPN名 |
| C | CR画像（`=IMAGE(url,1)` で setFormulas） |
| D | 見出し |
| E〜T | ①配信金額〜⑯CPA |

- 画像行高: 80px、画像は中央揃え
- 見出し: 左揃え・折り返しあり
- 数値: 右揃え

---

## GASスクリプト更新手順

ローカルの `.gs` ファイルを変更した場合、`/GASスクリプト直接編集` スキルを使ってデプロイする。

```
プロジェクトID: 1qxaL_EoxKgBMZFp-cMxjqC1yipBP_EVnzbL4T6pjf1XfZHhmL1jUyajq
ローカルファイル: company/clients/yamachu/totonoeru/totonoeru_smartnews_report.gs
```

> ⚠ `update_script_content` は全ファイルを上書き。`get_script_content` で既存ファイル一覧を取得してから送信すること。`appsscript` JSONファイルも必ず含めること。

---

## テスト関数（GASメニュー）

| メニュー項目 | 関数名 | 用途 |
|-------------|--------|------|
| 🧪 Test final fields | `testFinalFields` | フィールド名の有効性確認 |
| 🔍 Campaign IDs | `getCampaignIds` | キャンペーンID一覧確認 |
| 🖼 Ads response check | `testAdsResponse` | `/ads` レスポンス構造確認 |

---

## 既知の注意点

- `setValues` で `=IMAGE()` を書き込んでも式として評価されない → **CR画像列は `setFormulas` で別途書き込む**
- 7日以上の期間はチャンク分割（7日単位）でAPI実行、各チャンク間 2秒 sleep
- `metrics_cvr_search` = LP遷移B（search CV率）として使用
