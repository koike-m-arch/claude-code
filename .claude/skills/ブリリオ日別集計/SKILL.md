# ブリリオ・ホワイト 日別集計スキル

指定した期間の日別Outbrainデータをスプレッドシートの日別タブに書き込む。ブリリオ・ホワイト両方対応。

## 対象アカウント

- **ブリリオ** → 「日別（ブリリオ）」タブ
- **ホワイト** → 「日別（ホワイト）」タブ

## GAS情報

| 項目 | ブリリオ | ホワイト |
|---|---|---|
| スクリプトID | `1Gx7tEXhlVQxFsTO9fi4rYyymDaiMRmr2DF0BGUFUVzyGeBS3CbQY_7sP` | `13Iqm9jorlzjGMLDUrL1GgKbKxq-SVAslLzLm52CULfw2Zd9J98It7GMq` |
| GASファイル | `日別集計_ブリリオ` | `日別集計_ホワイト` |
| ローカルGAS | `company/projects/brillio_daily_report.gs` | `company/projects/white_daily_report.gs` |
| マーケターID | `00af75b8e5565b04764d17c4f90cb25caf` | `0033e4d3d312b31c84630c2166acec7b27` |
| スプレッドシート | 両方とも `1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8` |

## 実行方法

1. スプレッドシートのメニュー「📅 日別集計（ブリリオ）」または「📅 日別集計（ホワイト）」から実行
2. 対象タブの C2=開始日、C3=終了日 を入力
3. C4 でCPN選択（全体 or 個別）
4. 「▶ 日別集計実行」をクリック

## 出力列構成

| 列 | 内容 |
|---|---|
| B | 日付（YYYY/MM/DD） |
| C | 配信金額（API値 ÷0.8×1.1） |
| D | CPC（計算） |
| E | CPM（計算） |
| F | Imp |
| G | Click |
| H | CTR（計算） |
| I | LP遷移数 |
| J | LP遷移率（計算） |
| K | LPCVR（計算） |
| L | 確認画面遷移数 |
| M | 確認画面遷移率（計算） |
| N | CV数 |
| O | CVR（計算） |
| P | CPA（計算） |
| 最終行 | 合計行（青背景） |

## スクリプトプロパティ（各GASプロジェクトに設定）

| キー | 値 |
|---|---|
| OB_USERNAME | Outbrainログインメール |
| OB_PASSWORD | Outbrainパスワード |
| OB_MARKETER_ID | 各アカウントのマーケターID |

## 429エラー（レート制限）が出た場合

トークンキャッシュはUserProperties共有済み。
15分待ってから再実行してください。
