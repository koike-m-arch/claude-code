# clients/ — クライアント情報

各クライアントのフォルダを作成して情報を管理します。

## フォルダ構成例

```
clients/
├── README.md           # このファイル
├── client-a/           # クライアントAのフォルダ
│   ├── profile.md      # 基本情報（業種・担当者・連絡先）
│   ├── goals.md        # KPI・目標
│   └── confidential/   # 機密情報（.gitignore対象）
└── client-b/
    └── ...
```

## profile.md テンプレート

```markdown
# クライアント名

## 基本情報
- 業種:
- 担当者:
- 連絡先:
- 契約開始日:

## サービス内容
-

## KPI・目標
- 月間CV目標:
- 目標CPA:
- 目標ROAS:
```
