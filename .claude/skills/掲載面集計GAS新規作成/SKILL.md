---
name: 掲載面集計GAS新規作成
description: 新規商材向けにOutbrain掲載面集計GAS（コンテナバインド）をセットアップするスキル。「新しい商材で掲載面集計を作りたい」「〇〇の掲載面集計を新規セットアップして」などで使うこと。
---

# 掲載面集計GAS 新規セットアップスキル

## 目的

新規商材用のOutbrain掲載面集計GAS（コンテナバインド）を、`white_section_report.gs` をテンプレートとして一から作成する。

---

## Step 1: 情報収集

以下をユーザーに確認する（すべて必須）。

| 項目 | 説明 | 例 |
|------|------|-----|
| 商材名（短縮） | ファイル名・変数名に使う英数字 | `totonoeru`, `reliveshirt` |
| スプレッドシートID | 書き込み先のスプレッドシートID | `1Bk8JBek8d...` |
| タブ名 | 書き込み先のシート名 | `掲載面③` |
| マーケターID | Outbrain管理画面から取得 | `00af75b8e5...` |
| タイトル色（省略可） | ヘッダー行の背景色HEX（省略時: `#4472C4`） | `#7030A0`（紫） |

> **マーケターIDの確認方法**: Outbrain管理画面にログイン → 右上のアカウントメニュー → 「アカウント情報」またはURLの `marketers/XXXXXX` の部分

---

## Step 2: GASプロジェクトの準備

コンテナバインドGASは **MCPで直接作成できる**（ユーザーに手順案内不要）。

### MCPで作成する方法（推奨）

`mcp__google-workspace__create_script_project` を呼び出す。

```
title     : {商材名}_掲載面集計
parent_id : {スプレッドシートID}   ← ここにスプレッドシートIDを渡すとコンテナバインドになる
```

作成後に返ってくる `Script ID` を控えて Step 3 へ進む。

> ✅ `parent_id` にスプレッドシートIDを渡すことで、手動での「拡張機能 > Apps Script」操作が不要になる。
> スプレッドシートを開き直すと自動でメニューが表示される（installTrigger 不要）。

### すでにGASプロジェクトが存在する場合

既存スクリプトIDを確認してから Step 3 へ進む。

---

## Step 3: ローカルGSファイルの作成

`company/projects/white_section_report.gs` をベースに新規商材用ファイルを作成する。

### 差し替え箇所（9箇所）

| 変数・文字列 | 元の値（ホワイト） | 新規商材の値 |
|---|---|---|
| `SPREADSHEET_ID` | `'1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8'` | ユーザー指定ID |
| `SECTION_SHEET_NAME` | `'掲載面②'` | ユーザー指定タブ名 |
| `LP_CONV_DEFAULT` | `'01LP'` | `'TBD'`（Step 6で実測後に更新） |
| `CV_CONV_DEFAULT` | `'thanks 1day'` | `'TBD'`（Step 6で実測後に更新） |
| `TOKEN_CACHE_KEY` | `'OB_WHITE_SECTION_TOKEN_CACHE'` | `'OB_{商材名大文字}_SECTION_TOKEN_CACHE'` |
| `TOKEN_CACHE_TS_KEY` | `'OB_WHITE_SECTION_TOKEN_CACHE_TS'` | `'OB_{商材名大文字}_SECTION_TOKEN_CACHE_TS'` |
| `marketerId` デフォルト値（全3箇所） | `'0033e4d3d312b31c84630c2166acec7b27'` | ユーザー指定マーケターID |
| タイトル色 `#4472C4` | 青 | ユーザー指定色（省略時そのまま） |
| メニュー名 `📊 掲載面②` | ホワイト用 | `📊 {タブ名}` |
| ログ・アラートの `ホワイト` 表記（3箇所） | `ホワイト` | 商材名 |
| `■ 掲載面集計（ホワイト・全CPN合算）` | ホワイト | 商材名 |
| コメントヘッダー（先頭部分） | ホワイト版の説明 | 新商材の説明 |

### ローカルファイルの保存先

```
company/projects/{商材名}_section_report.gs
```

---

## Step 4: GASへデプロイ

### 4-1: 既存スクリプト内容を取得

`mcp__google-workspace__get_script_content` でスクリプトIDの現在のファイル構成を確認する。

```
script_id: [Step 2で確認したスクリプトID]
```

取得したファイル一覧（`appsscript.json` を含む全ファイル）を控える。

### 4-2: スクリプトを更新

`mcp__google-workspace__update_script_content` でデプロイする。

```json
{
  "scriptId": "[スクリプトID]",
  "files": [
    {
      "name": "appsscript",
      "type": "JSON",
      "source": "{取得したmanifestの内容}"
    },
    {
      "name": "コード",
      "type": "SERVER_JS",
      "source": "{Step 3で作成したGASコード}"
    }
  ]
}
```

> ⚠ **必ず `appsscript.json` を含めること**。含めないと 400 エラーになる。

---

## Step 5: スクリプトプロパティの設定案内

デプロイ後、ユーザーに以下を案内する：

```
GASエディタ（https://script.google.com/d/[スクリプトID]/edit）を開く
↓
左サイドバー「⚙ プロジェクトの設定」
↓
「スクリプトプロパティ」セクション
↓
以下の2つを追加:

  OB_USERNAME  : Outbrainログインメール（koike-m@mirai-kirei.jp など）
  OB_PASSWORD  : Outbrainパスワード
  OB_MARKETER_ID : [マーケターID]（省略するとコード内のデフォルト値を使用）
```

---

## Step 6: コンバージョン名の実測

スクリプトプロパティ設定後、ユーザーに以下を依頼する：

```
1. スプレッドシートを開いて [タブ名] シートのC2・C3に日付を入力
   （例: C2=2026/04/01, C3=2026/04/29）
2. シート上部に出る「📊 [タブ名]」メニュー → 「🔍 コンバージョン名一覧」を実行
3. Apps Scriptのログ（表示→ログ）に出力された内容を教えてください
```

### ログの読み方

```
=== [商材名] コンバージョン名一覧 ===
  "01 LP 01d" : 150     ← これが LP遷移コンバージョン名
  "thanks 1day" : 42    ← これが CV コンバージョン名
```

コンバージョン数が多い順に2つを特定する：
- **LP遷移**: 「LP」「lp」「遷移」などが名前に含まれるもの、または最多
- **CV**: 「thanks」「cv」「cv1」「cvr」などが含まれるもの

---

## Step 7: デフォルト値の更新

Step 6 で実測したコンバージョン名を GAS に反映する。

ローカルファイルを更新して再デプロイ（Step 4と同手順）。

```javascript
// 更新箇所
var LP_CONV_DEFAULT = '実測したLP遷移コンバージョン名';
var CV_CONV_DEFAULT = '実測したCVコンバージョン名';
```

---

## Step 8: 動作確認

ユーザーに確認を依頼する：

```
「📊 [タブ名]」メニュー → 「▶ 掲載面集計実行」を実行して
・掲載面名が一覧表示されているか
・LP遷移数・CV数に0以外の値が入っているか
を確認してください
```

---

## Step 9: 完了報告

```
✅ 掲載面集計GAS セットアップ完了（[商材名]）

スクリプトID    : [ID]
ローカルファイル : company/projects/[商材名]_section_report.gs
書き込み先タブ  : [タブ名]
LP遷移CV名     : [確定した名前]
CV名           : [確定した名前]

次回から「[商材名]の掲載面集計して」と言えば実行できます。
（専用スキルが必要な場合は別途作成します）
```

---

## 既存商材との差異まとめ

| 項目 | ブリリオ | ホワイト | 新規商材 |
|---|---|---|---|
| GAS種別 | スタンドアロン | コンテナバインド | コンテナバインド |
| LP遷移CV名 | `01 LP 01d` | `01LP` | 実測して確認 |
| CV名 | `03 all thanks 01d` | `thanks 1day` | 実測して確認 |
| タイトル色 | 紫 `#7030A0` | 青 `#4472C4` | 任意 |

---

## 注意事項

- コンバージョン名は **必ず実測**すること（クライアントごとに異なる）
- `update_script_content` には **必ず `appsscript.json` を含める**（ないと400エラー）
- エンドポイント試行順序は `/sections` → `/publishers` → `publishers/periodic` の順（変更しないこと）
- CV フォールバックは `if (cv === 0) cv = m.conversions || 0;` で無条件に行う（条件付けると拾えないケースが出る）
- **CPN名取得には管理APIではなく `/reports/marketers/{id}/campaigns?from=&to=` を使う**（管理APIのIDとreporting APIのIDは別物。`results[].metadata.id` → `results[].metadata.name` でマップを作ること）
