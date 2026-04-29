---
name: CPAシミュレーター
description: CPAシミュレーターをブラウザで開くスキル。「/CPAシミュレーター」「CPAシミュレーター開いて」「CPA計算して」「CPAのシミュ開いて」「シートから更新して」「最新データで開いて」などのキーワードで積極的にこのスキルを使うこと。
---

# CPAシミュレータースキル

## ファイルパス

```
c:\Users\koike-m\Desktop\Claude Code\company\tools\cpa_simulator.html
c:\Users\koike-m\Desktop\Claude Code\company\tools\cpa_loader.html  ← スキルが毎回生成する一時ファイル
```

## 起動モード

### A. 単純に開くだけ（「開いて」「見たい」）

```bash
start "" "c:\Users\koike-m\Desktop\Claude Code\company\tools\cpa_simulator.html"
```

### B. シートから最新データを読み込んで開く（「シートから更新」「最新データで」）

以下の手順を順番に実行する。

---

## Step 1: ブリリオ・ホワイトのシートを同時に読む

`mcp__google-workspace__read_sheet_values` を2つ同時に呼び出す。

**ブリリオ:**
- spreadsheet_id: `1tHR-TuYIukF14f_Vljyh932yaL-_4xwp6MNkBZSwhTY`
- range_name: `【合算】月別!A1:P30`
- user_google_email: `koike-m@mirai-kirei.jp`

**ホワイト:**
- spreadsheet_id: `1rBF083ZYHPy0iXL4h-sa2lad85_Y2JcOr_NUqIt-Pp8`
- range_name: `【合算】月別!A1:N30`
- user_google_email: `koike-m@mirai-kirei.jp`

---

## Step 2: 当月行からデータを抽出する

今日の日付から当月（例: 2026年4月）を判定し、A列が一致する行を探す。

### ブリリオの列（0始まりインデックス）

| 列 | index | 内容 |
|----|-------|------|
| A | 0 | 月 |
| D | 3 | 配信金額 → `b_spend` |
| N | 13 | 貴社計測CPA |
| O | 14 | 管理費込みCPA → `b_cpa`（O列が空/ハイフンならN列を使う）|

### ホワイトの列（0始まりインデックス）

| 列 | index | 内容 |
|----|-------|------|
| A | 0 | 月 |
| D | 3 | 配信金額 → `w_spend` |
| N | 13 | 貴社計測CPA → `w_cpa` |

数値化: `¥16,263,648` → `¥` と `,` と末尾スペースを除去 → `16263648`

---

## Step 3: 残り日数を計算する

スキル実行時の現在日時（JST）をもとに、当月末までの残り日数を小数で求める。

```
当月末 = 当月の最終日 の 23:59:59 JST
残り日数 = (当月末 - 現在日時) ÷ 86400秒  →  小数第1位で四捨五入
```

例: 4/29 18:30 に実行 → 当月末 4/30 23:59:59 まで 29.5時間 → 29.5÷24 = **1.2日**
例: 4/28 09:00 に実行 → 当月末まで 62.9時間 → **2.6日**

OB配信は時差があるため、日またぎの端数も重要。小数のまま使う。

---

## Step 4: cpa_loader.html を Write ツールで生成する

以下のテンプレートに実際の数値を埋め込み、`cpa_loader.html` として書き込む。

```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<script>
localStorage.setItem('brillio_cpa_spend', '{b_spend}');
localStorage.setItem('brillio_cpa_cpaCurrent', '{b_cpa}');
localStorage.setItem('brillio_cpa_remainDays', '{remain_days}');
localStorage.setItem('brillio_sheet_updated', '{timestamp}');
localStorage.setItem('white_cpa_spend', '{w_spend}');
localStorage.setItem('white_cpa_cpaCurrent', '{w_cpa}');
localStorage.setItem('white_cpa_remainDays', '{remain_days}');
localStorage.setItem('white_sheet_updated', '{timestamp}');
localStorage.setItem('cpa_brand', 'brillio');
location.href = 'cpa_simulator.html';
</script>
</html>
```

- `{b_spend}` `{b_cpa}` `{w_spend}` `{w_cpa}` に実際の数値（数字のみ）を入れる
- `{remain_days}` は Step3 で計算した小数値（例: `1.2`）
- `{timestamp}` は `M/D HH:MM` 形式（例: `4/29 18:30`）
- 保存先: `c:\Users\koike-m\Desktop\Claude Code\company\tools\cpa_loader.html`

---

## Step 5: ローダーを開く

```bash
start "" "c:\Users\koike-m\Desktop\Claude Code\company\tools\cpa_loader.html"
```

ブラウザがローダーを開き → localStorage に書き込み → 自動的に cpa_simulator.html へリダイレクトされる。

---

## Step 6: 結果を報告

```
📊 CPAシミュレーターを最新データで開きました。

【ブリリオ】
  消化金額: ¥XX,XXX,XXX
  管理費込みCPA（現状）: ¥XX,XXX

【ホワイト】
  消化金額: ¥X,XXX,XXX
  貴社計測CPA（現状）: ¥XX,XXX

目標CPA・残り日数・CPC/CVR・日予算は手動設定値を保持しています。
シミュレーター上部に「📋 シート連携: M/D」と表示されます。
```

---

## 注意事項

- 消化金額・CPAが `¥0` / `-` の場合はそのブランドのパラメーターをスキップする
- 当月データが見つからない場合はモードAで単純起動し、その旨を伝える
