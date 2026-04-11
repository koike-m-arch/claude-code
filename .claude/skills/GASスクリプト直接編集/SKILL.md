---
name: GASスクリプト直接編集
description: Google Apps ScriptプロジェクトをMCP経由で直接読み込み・編集・書き込みするスキル。ローカルの.gsファイルをスプレッドシートに直接デプロイしたり、既存のGASコードを修正したりできる。「GASをシートに直接書き込んで」「スクリプトを直接デプロイして」「Apps ScriptをMCPで更新して」「GASを直接修正して」などで積極的に使うこと。
---

# GASスクリプト直接編集スキル

## 目的

Google Apps ScriptプロジェクトをMCP（`mcp__google-workspace`）経由で直接操作する。
ユーザーがスクリプトエディタに手動で貼り付ける作業を自動化する。

対応パターン：
- **ローカルデプロイ**: ローカルの `.gs` ファイルを指定スクリプトプロジェクトに書き込む
- **直接修正**: 既存のスクリプトをMCPで取得→修正→書き戻す
- **新規作成**: 新しいスクリプトプロジェクトを作成してコードを書き込む

---

## Step 1: 必要情報の確認

以下をユーザーに確認する（不足していれば聞く）。

| 項目 | 説明 | 取得方法 |
|------|------|---------|
| **スクリプトプロジェクトID** | Apps ScriptプロジェクトのID | Apps Scriptエディタを開き、URLの `script.google.com/home/projects/【ここ】/edit` をコピー |
| **操作内容** | ローカルデプロイ / 直接修正 / 新規作成 | ユーザーに確認 |
| **ローカルファイルパス** | ローカルデプロイの場合のみ | 例: `company/clients/yamachu/totonoeru/totonoeru_outbrain_report.gs` |
| **修正内容** | 直接修正の場合 | ユーザーに確認 |

> スクリプトIDの見つけ方：スプレッドシートを開く → 「拡張機能」→「Apps Script」→ エディタが開いたらURL中の `projects/XXXXX/edit` の `XXXXX` の部分

---

## Step 2: 既存コードの取得（ローカルデプロイ・直接修正の場合）

`mcp__google-workspace__get_script_content` でスクリプトの現在の内容を取得する。

- **ローカルデプロイの場合**: 既存ファイル一覧を確認し、追加・上書き対象を把握する
- **直接修正の場合**: 取得したコードを読んで修正箇所を特定する

> ⚠ Apps Scriptプロジェクトには複数の `.gs` ファイルが存在する場合がある。`update_script_content` はプロジェクト内の全ファイルを一括で上書きするため、**取得したファイル一覧をすべて含めて**送信しないと既存ファイルが消える。

---

## Step 3: コードの準備

### ローカルデプロイの場合

1. ローカルの `.gs` ファイルを Read ツールで読み込む
2. 既存プロジェクトのファイル構成と照合して送信データを組み立てる

送信するファイルリストの例：
```json
[
  { "name": "コード", "type": "SERVER_JS", "source": "/* 既存ファイルの内容 */" },
  { "name": "totonoeru_outbrain_report", "type": "SERVER_JS", "source": "/* ローカルから読んだ内容 */" }
]
```

### 直接修正の場合

取得したコードを修正し、全ファイルをまとめた送信データを組み立てる。

---

## Step 4: スクリプトへの書き込み

`mcp__google-workspace__update_script_content` で書き込む。

パラメータ：
- `scriptId`: Step 1 で確認したプロジェクトID
- `files`: 全ファイルのリスト（name・type・source）

---

## Step 5: 動作確認（オプション）

書き込み後に関数を実行して確認する場合：

```
mcp__google-workspace__run_script_function
  scriptId: [プロジェクトID]
  functionName: [実行したい関数名]
```

> ⚠ GAS のトリガーや UI 系関数（`onOpen`、`showModalDialog` など）はMCPから直接実行できない。`runOutbrainReportApiXxx` などのAPI実行専用関数が対象。

---

## Step 6: 完了報告

```
✅ GASスクリプト書き込み完了

スクリプトプロジェクトID: [ID]
書き込んだファイル:
  - [ファイル名1].gs
  - [ファイル名2].gs

次のステップ:
1. Apps Scriptエディタ（script.google.com）でプロジェクトを開く
2. 保存されていることを確認（Ctrl+S）
3. メニューから「▶ レポート取得実行」を実行
```

---

## 既知クライアントのスクリプトID

初回実行後、スクリプトIDをここに追記しておくこと。

| クライアント | スプレッドシート | スクリプトID |
|---|---|---|
| （初回実行後に追記） | | |

---

## 注意事項

- `update_script_content` はプロジェクト内の**全ファイルを上書き**する。既存ファイルを消さないよう `get_script_content` で事前取得が必須。
- スクリプトのオーナーが `koike-m@mirai-kirei.jp` であるプロジェクトのみ操作可能。
- Apps Script の実行ログは `mcp__google-workspace__get_script_metrics` や `list_script_processes` で確認できる。
