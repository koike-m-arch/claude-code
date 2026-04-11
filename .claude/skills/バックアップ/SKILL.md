---
name: バックアップ
description: .claudeフォルダとcompanyフォルダの変更をGitHubにコミット＆プッシュするスキル。「/バックアップ」「バックアップして」「GitHubに保存して」「コミットして」などのキーワードで積極的にこのスキルを使うこと。
---

# バックアップスキル

## 目的

`.claude/` フォルダ（スキル・設定・エージェント）と `company/` フォルダ（クライアント情報・業務資料）の変更を GitHub にコミット＆プッシュしてバックアップする。

プロジェクトルートは `c:/Users/koike-m/Desktop/Claude Code` 。

## 実行手順

以下の順番で Bash ツールを使って処理すること。

### Step 1: 変更確認

```bash
cd "c:/Users/koike-m/Desktop/Claude Code" && git status --short -- .claude/ company/
```

変更がない場合は「バックアップ対象の変更はありません」と表示して終了する。

### Step 2: ステージング

```bash
cd "c:/Users/koike-m/Desktop/Claude Code" && git add .claude/ company/
```

### Step 3: コミット

コミットメッセージは以下の形式で作成する。
- 1行目: `バックアップ: YYYY-MM-DD HH:MM`（現在日時）
- 2行目以降: 変更の概要（変更ファイル数・主な変更内容）

```bash
cd "c:/Users/koike-m/Desktop/Claude Code" && git commit -m "バックアップ: $(date '+%Y-%m-%d %H:%M')

[変更概要をここに記載]"
```

### Step 4: プッシュ

```bash
cd "c:/Users/koike-m/Desktop/Claude Code" && git push origin main
```

### Step 5: 結果の表示

以下のフォーマットで結果を報告する。

```
✅ バックアップ完了

コミット: [コミットハッシュ短縮形]
日時: YYYY-MM-DD HH:MM
変更ファイル: X件
  - .claude/... （変更内容）
  - company/... （変更内容）

GitHub: https://github.com/koike-m-arch/claude-code
```

## 注意事項

- `_credentials.py` や `.mcp.json` など機密ファイルは `.gitignore` で除外済みのため、誤ってステージングされることはない
- ステージングは `.claude/` と `company/` のみに限定し、ルート直下の Python スクリプト等はバックアップ対象外とする
- プッシュに失敗した場合はエラー内容を表示し、原因を説明する
