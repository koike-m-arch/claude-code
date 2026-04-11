# Agents フォルダ

このフォルダにはカスタムサブエージェント定義を格納します。

## ファイル命名規則

- `seo-analyst.md` — SEO分析エージェント
- `ad-reporter.md` — 広告レポートエージェント
- `copywriter.md` — コピーライティングエージェント

## エージェントファイルの書き方

```markdown
---
name: エージェント名
description: エージェントの説明と起動条件
tools: Read, Write, WebSearch  # 使用可能なツール
---

# エージェントの役割と指示

システムプロンプトをここに記載
```
