---
name: CPA計算
description: チャット内でCPAを計算するスキル。「/CPA計算」「CPA計算して」「残り日数で目標CPA収められる？」「補填いくら？」「日予算いくらにすれば？」などのキーワードで積極的にこのスキルを使うこと。
---

# CPA計算スキル

チャット内でCPAのシミュレーション計算を行い、結果をテキストで返す。ブラウザを開かずに即座に試算できる。

---

## 必要な入力値

以下をユーザーから聞くか、シートから取得する（未入力の場合は確認する）。

| 変数 | 内容 | 例 |
|------|------|----|
| `spend` | 現在の消化金額 | 16,613,156 |
| `cpa_current` | 現在のCPA | 14,512 |
| `cpa_target` | 目標CPA | 13,000 |
| `remain_days` | 残り日数（小数可） | 1.5 |
| `daily_budget` | 残り期間の日予算 | 1,000,000 |
| `cpc` | クリック単価（CPC） | 80 |
| `cvr` | CVR（%） | 2.5 |

> `daily_budget` と `cpc/cvr` の両方が揃った場合は `cpc/cvr` から残りCVを計算する。
> `daily_budget` のみの場合は `cpa_current` で残りCV推定。

---

## 計算式

```
cv_now      = spend / cpa_current                    # 現在の獲得CV数
rem_budget  = daily_budget × remain_days             # 残り消化予算
rem_cpa     = cpc / (cvr / 100)                      # 残り期間の見込みCPA（CPC・CVR使用時）
rem_cv      = rem_budget / rem_cpa                   # 残り期間の獲得CV
total_spend = spend + rem_budget                     # 最終消化予算
total_cv    = cv_now + rem_cv                        # 最終CV数
final_cpa   = total_spend / total_cv                 # 最終着地CPA

req_rem_cpa = (cpa_target × total_spend - spend) / rem_budget
            # 目標CPAに収めるために残り期間で必要なCPA

over_cpa    = max(0, final_cpa - cpa_target)         # 上振れCPA
hosoku      = over_cpa × total_cv                   # 補填試算額（上振れCPA×最終CV）
```

---

## 出力フォーマット

以下の形式でチャット内に結果を表示する。

```
📊 CPA試算結果

【入力値】
  消化金額    : ¥XX,XXX,XXX
  現状CPA     : ¥XX,XXX
  目標CPA     : ¥XX,XXX
  残り日数    : X日 + XX時間
  日予算      : ¥X,XXX,XXX
  CPC / CVR   : ¥XX / X.XX%

【試算結果】
  残り消化予算        : ¥X,XXX,XXX
  現在CV              : XX.X件
  残り期間CV          : XX.X件
  最終消化予算        : ¥XX,XXX,XXX
  最終獲得CV          : XXX.X件
  最終着地CPA         : ¥XX,XXX  ← 目標比 +X,XXX（+X.X%）/ -X,XXX（-X.X%）

【目標達成に必要な残りCPA】
  残り期間の必要CPA   : ¥XX,XXX（現状比 ±X,XXX）

【補填試算】
  上振れCPA           : ¥X,XXX
  補填額              : ¥XXX,XXX（¥X,XXX × XXX.X件）
  ※ 目標CPA内に収まる場合は「補填なし」と表示
```

---

## ブランド別の参考値（シートから取得可）

シートから最新データを使う場合は `mcp__google-workspace__read_sheet_values` で取得する。

**ブリリオ:**
- spreadsheet_id: `1tHR-TuYIukF14f_Vljyh932yaL-_4xwp6MNkBZSwhTY`
- range_name: `【合算】月別!A1:P30`
- D列(idx3)=消化金額, O列(idx14)=管理費込みCPA（空ならN列）

**ホワイト:**
- spreadsheet_id: `1rBF083ZYHPy0iXL4h-sa2lad85_Y2JcOr_NUqIt-Pp8`
- range_name: `【合算】月別!A1:N30`
- D列(idx3)=消化金額, N列(idx13)=貴社計測CPA

---

## 注意事項

- `cvr` は % 表記で受け取り、計算時は `/100` して使う（例: 2.5% → 0.025）
- 残り日数が小数の場合（例: 1.5日 = 1日12時間）もそのまま計算に使う
- 入力値が足りない場合は何が必要かを聞いてから計算する
- ブラウザで視覚的にシミュレーションしたい場合は `/CPAシミュレーター` を案内する
