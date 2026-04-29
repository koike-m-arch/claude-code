# ブリリオ・ホワイト 日次更新スキル

指定した日付（または今日）のOutbrainデータをGoogleスプレッドシートに反映する。

## 対象アカウント
- **ブリリオ**（チェルラーブリリオ）→ 日予算（ブリリオ）・CPA（ブリリオ）タブ
- **ホワイト**（チェルラーホワイト）→ 日予算（ホワイト）・CPA（ホワイト）タブ

## 実行方法

「CPA反映」「日次更新」が来たら、プロジェクトルートで以下を両方実行する：

```bash
cd "c:/Users/koike-m/Desktop/Claude Code"
python brillio_daily_update.py [YYYY-MM-DD]
python white_daily_update.py [YYYY-MM-DD]
```

日付を省略すると本日のデータを取得。

## 重要
- CPA反映と言ったら必ずブリリオとホワイト両方を更新する
- ホワイトのCPAはAPI値に換算係数（/ 0.8 * 1.1）を適用する
