---
name: SNレポートGAS作成
description: 新規商材・クライアント用のSmartNewsレポートGASコードを生成・保存・デプロイするスキル。ととのえる（SN）と同じ構造を持つ完全なファイルを出力する。「SNのGAS作って」「スマートニュースのレポートスクリプト作成」「新規商材のSN設定」「SNの数値集計GAS作って」などで積極的に使うこと。
---

# SNレポートGAS作成スキル

## 目的

商材・クライアントごとのSmartNews Marketing API v3 レポートGASを生成・保存・デプロイする。
ととのえる（SN）と同じ構造を持つ完全なGASファイルを出力する。

成果物：
- **GASファイル** (`[名前]_smartnews_report.gs`) ― シートへの全データ書き込み

---

## Step 1: 必要情報の収集【スキル起動直後に必ず全項目を一括確認する】

スキルが起動したら、作業を始める前に**以下のフォームをそのままチャットに出力して**、ユーザーに一括入力を求めること。個別に質問してはいけない。

---

**出力するフォーム（コードブロックで表示）：**

```
📋 SNレポートGAS作成 — 必要情報入力フォーム

【基本情報】
① 商材・クライアント名（例: ととのえる）
   →

② ファイル保存先パス（例: yamachu/totonoeru）
   company/clients/ 配下のパスを記入
   →

③ 書き込み先シート名（例: ととのえる（SN））
   スプレッドシートのタブ名をそのまま記入
   →

④ コード内で使う識別子（例: Totonoeru）
   関数名・変数名のサフィックスになる。英数字・PascalCase推奨
   →

【SmartNews アカウント情報】
⑤ SmartNews アカウントID（数字のみ）
   管理画面URL → https://ads.smartnews.com/accounts/【ここ】/campaigns
   →

【スプレッドシート情報（MCP直接デプロイを使う場合）】
⑥ Apps ScriptプロジェクトID（任意）
   Apps Script エディタのURL → script.google.com/home/projects/【ここ】/edit
   →
```

---

フォームを受け取ったら、①〜⑤が揃っていれば作業を開始してよい。
⑥はMCP直接デプロイを行う場合のみ必要。入力がなければローカル保存のみとする。

---

## Step 2: コードの生成

テンプレート: `company/clients/yamachu/totonoeru/totonoeru_smartnews_report.gs`

Read ツールで上記ファイルを読み込んでから、以下の置換を行ってGASコードを生成する。

### 置換箇所一覧

| 箇所 | 変更内容 |
|------|----------|
| ファイル冒頭コメント | 商材名・シート名・アカウントID |
| `SN_BASE_URL_TOTONOERU` | `SN_BASE_URL_[識別子]` に rename |
| `SN_ACCOUNT_ID_TOTONOERU` | `SN_ACCOUNT_ID_[識別子]` に rename（値は⑤のID） |
| `SHEET_NAME_SN_TOTONOERU` | `SHEET_NAME_SN_[識別子]` に rename（値は③のシート名） |
| すべての関数名 | `Totonoeru` → `[識別子]` に rename（例: `getSnAccessToken[識別子]`） |
| `onOpen` のメニュー名 | `🔧 SNReport` → そのまま（複数シートに同居する場合はメニュー名を変える） |
| `onOpen` の `▶ Run` のコールバック | `runSnReport[識別子]` に変更 |
| `runSnReportTotonoeru` 内のアラート文言 | 商材名を変更 |
| シートタイトルセル（B1のsetValue） | `'[商材名] Smartnews 数値集計'` に変更 |
| テスト関数内のハードコードIDやコメント | アカウントIDを⑤に変更 |

### 実装上の必須ポイント

**① グローバル変数・関数名にはすべてクライアント固有サフィックスをつける（最重要）**

GAS V8 では同一プロジェクト内の全 `.gs` ファイルがグローバル名前空間を共有する。
`var` の重複宣言は後勝ちになり、正しくない値で動作する。

```javascript
// NG: 汎用名はコンフリクトする
var SN_ACCOUNT_ID = '12345678';
function runSnReport() { ... }

// OK: 識別子サフィックスをつける
var SN_ACCOUNT_ID_NEWPRODUCT = '12345678';
function runSnReportNewProduct() { ... }
```

**② `onOpen` は1プロジェクトに1つだけ**

同一スプレッドシートに複数の `.gs` ファイルが同居する場合、`onOpen()` が重複すると片方しか動かない。
既存ファイルに `onOpen` がある場合は、そちらにメニュー項目を追記してもらうよう指示する。

**③ スクリプトプロパティは `SN_CLIENT_ID` / `SN_CLIENT_SECRET` を共用**

SmartNews の OAuth2 認証情報はアカウントをまたいでも同じキーを使ってよい。
既にプロパティが設定済みであれば追加不要。

**④ 7日チャンク分割・2秒 sleep は必ず維持する**

SmartNews Marketing API は長期間クエリでレート制限が発生しやすい。

**⑤ `setFormulas` で CR 画像を書き込む（`setValues` では評価されない）**

```javascript
// NG: setValues は =IMAGE() をテキストとして保存する
range.setValues([[' =IMAGE("url",1)']]);

// OK: setFormulas を使う
range.setFormulas([['=IMAGE("url",1)']]);
```

---

## Step 3: GASファイル保存

生成したコードを以下のパスに保存する：
```
company/clients/[保存先パス]/[商材名]_smartnews_report.gs
```

例: `company/clients/yamachu/totonoeru_sports/totonoeru_sports_smartnews_report.gs`

ディレクトリが存在しない場合はユーザーに確認してから作成する。

---

## Step 4: [オプション] GAS直接デプロイ（MCP使用）

⑥ Apps ScriptプロジェクトIDが提供された場合に実施する。

`/GASスクリプト直接編集` スキルの手順に従う：

1. `mcp__google-workspace__get_script_content` で既存のスクリプト内容を取得
2. 既存ファイル一覧を確認（appsscript JSON含め全ファイルを把握）
3. 生成したGASコードを新ファイルとして追加し、全ファイルをまとめて `mcp__google-workspace__update_script_content` で書き込む

> ⚠ `update_script_content` は全ファイルを上書きする。取得した既存ファイルをすべて含めないと消える。`appsscript` JSON（manifest）を必ず含めること。

---

## Step 5: 完了メッセージ

```
✅ SNレポートGAS生成完了

GAS: company/clients/[パス]/[名前]_smartnews_report.gs

## Apps Script セットアップ手順

1. スプレッドシート → 拡張機能 → Apps Script
2. 新しいファイルを作成して生成コードを貼り付け（または MCP でデプロイ済み）
3. Script Properties に以下を追加（未設定の場合のみ）：
   | プロパティ名       | 値 |
   |---|---|
   | SN_CLIENT_ID      | SmartNews Marketing API の Client ID |
   | SN_CLIENT_SECRET  | SmartNews Marketing API の Client Secret |

4. 「[シート名]」の C2 に開始日、C3 に終了日を入力
5. メニュー「🔧 SNReport」→「▶ Run」を実行
```

---

## 参考: SmartNews Marketing API v3 仕様（2026-04 検証済み）

### 認証

- フロー: `client_credentials`
- トークンエンドポイント: `https://ads.smartnews.com/api/oauth/v1/access_tokens`
- payload: `grant_type=client_credentials&client_id=...&client_secret=...`

### 確定フィールド名（metrics_ プレフィックス必須）

```
metrics_budget_spent  → 配信金額
metrics_click         → クリック数
metrics_ctr           → CTR（小数。例: 0.0023）
metrics_cpm           → CPM
metrics_cpc           → CPC
metrics_cvr_purchase      → CV率（購入）
metrics_cvr_view_content  → LP遷移率(W)（コンテンツ閲覧）
metrics_cvr_add_to_cart   → カート率
metrics_cvr_search        → LP遷移率(B)（検索/基本LP）
```

### 算出値

| 指標 | 計算式 |
|------|--------|
| IMP | `Math.round(click / ctr)` ← APIから直接取れないので計算 |
| LP遷移数(W) | `Math.round(click × cvr_view_content)` |
| LP遷移数(B) | `Math.round(click × cvr_search)` |
| カート追加 | `Math.round(click × cvr_add_to_cart)` |
| CV | `Math.round(click × cvr_purchase)` |

### エンドポイント

| 用途 | URL |
|------|-----|
| キャンペーン一覧 | `GET /api/ma/v3/ad_accounts/{id}/campaigns` |
| 広告一覧（CR情報） | `GET /api/ma/v3/ad_accounts/{id}/ads` |
| キャンペーン別insights | `GET /api/ma/v3/ad_accounts/{id}/insights/campaigns?since=...&until=...&fields=...` |
| 広告別insights | `GET /api/ma/v3/ad_accounts/{id}/insights/ads?since=...&until=...&fields=...` |

日付形式: `YYYY-MM-DDT00:00:00Z` / `YYYY-MM-DDT23:59:59Z`

### `/insights/ads` レスポンス構造

- `row.parent.parent.id` = キャンペーンID
- `row.parent.parent.name` = キャンペーン名

### `/ads` レスポンス構造（CR情報）

- `a.ad_id` = 広告ID（**`a.id` ではなく `a.ad_id`**）
- `a.creative.image_creative_info.media_files[0].images.full.url` = CR画像URL
- `a.creative.image_creative_info.headline` = 見出し

---

## 参考: シート構成

### CPN別集計（B列スタート）

```
B=CPN名 | C=①配信金額 | D=②CPC | E=③CPM | F=④Imp | G=⑤Click | H=⑥CTR
I=⑦LP遷移数(W) | J=⑧LP遷移率(W) | K=⑨LP遷移数(B) | L=⑩LP遷移率(B)
M=⑪カート追加 | N=⑫カート率 | O=⑬CV数 | P=⑭CVR | Q=⑮LPCVR(W+B) | R=⑯CPA
（計 B〜R = 17列）
```

### CR別集計（B列スタート）

```
B=CPN名 | C=CR画像（setFormulas） | D=見出し | E=①配信金額 〜 T=⑯CPA
（計 B〜T = 19列）
```

- 画像行高: 80px / 画像: 中央揃え / 見出し: 左揃え・折り返しあり / 数値: 右揃え

### ビジュアル定数

```javascript
var NAV       = '#1c4587';  // タイトル・セクションヘッダー背景
var HDR_BG    = '#dce8ff';  // 列ヘッダー背景
var HDR_BORDER = '#7baaf7'; // 列ヘッダー罫線
var DATA_BORDER = '#bdd1fb'; // データ行罫線
```

---

## 参考: 既存商材情報

| 商材 | アカウントID | シート名 | GASファイル | スクリプトID |
|------|-------------|----------|-------------|-------------|
| ととのえる（SN） | `97065339` | `ととのえる（SN）` | `company/clients/yamachu/totonoeru/totonoeru_smartnews_report.gs` | `1qxaL_EoxKgBMZFp-cMxjqC1yipBP_EVnzbL4T6pjf1XfZHhmL1jUyajq` |
