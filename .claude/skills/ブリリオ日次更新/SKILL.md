#!/usr/bin/env python3
"""
ブリリオ配信戦略シート 日次データ更新スクリプト
毎日15:00に自動実行

更新内容:
  - 日予算管理タブ 4行目: 今日の合計配信金額（管理画面の数値そのまま）
  - CPA管理タブ 3行目: 今日の全体平均CPA（管理画面）
  - CPA管理タブ 5行目以降: 各CPN別CPA（管理画面）
"""

import sys
import io
import re
import os
import requests
from datetime import date, datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..')))

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ====== 設定 ======
OUTBRAIN_TOKEN = (
    "MTc3NTIyMjU5Njg4NjoxNTcxMDVkMjc0ZWI4NjY0Nzc1MzgzNjJlYjY4NjYyMGI4ZmYwM2FhZTI4MD"
    "hmZTdiOWNkNWVlZTgxZTVmMjdhOnsiY2FsbGVyQXBwbGljYXRpb24iOiJBbWVsaWEiLCJpcEFkZHJl"
    "c3MiOiIvMTAuMjQyLjIxNC4xMzk6NTY4NTAiLCJieXBhc3NBcGlBdXRoIjoiZmFsc2UiLCJ1c2Vy"
    "TmFtZSI6Im1pcmFpa2lyZWkiLCJ1c2VySWQiOiIxMDQzMTQ5OSIsImRhdGFTb3VyY2VUeXBlIjoiTVlf"
    "T0JfQ09NIn06ZjFhNDkyMjkxMWRiODk3ZDJlZWE2ZDBjN2Y3OThiZjBlMzJmOGM0YmZhOWM3YWE1MWI3"
    "ODI4YmVlYTg1YWNlN2U3ZWM3Y2YzNWE3ZmY1OGVlYmI0ZGUwZjEwNDhhMzE5MTIzYTI2YTBkM2FkOTE2"
    "M2ZlOWY4NmZmYzJmYTg4OWU="
)
MARKETER_ID = "00af75b8e5565b04764d17c4f90cb25caf"
SPREADSHEET_ID = "1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8"

from _credentials import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

OUTBRAIN_BASE = "https://api.outbrain.com/amplify/v0.1/"
SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"


# ====== Google認証 ======
def get_google_token():
    r = requests.post("https://oauth2.googleapis.com/token", data={
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "refresh_token": GOOGLE_REFRESH_TOKEN,
        "grant_type": "refresh_token"
    })
    r.raise_for_status()
    return r.json()["access_token"]


# ====== Outbrain APIヘルパー ======
def ob_get(path, params=None):
    headers = {"OB-TOKEN-V1": OUTBRAIN_TOKEN}
    r = requests.get(OUTBRAIN_BASE + path, headers=headers, params=params)
    r.raise_for_status()
    return r.json()


# ====== Google Sheets APIヘルパー ======
def sheets_read(gtoken, sheet_name, range_a1):
    url = f"{SHEETS_BASE}/{SPREADSHEET_ID}/values/{requests.utils.quote(sheet_name)}!{range_a1}"
    r = requests.get(url, headers={"Authorization": f"Bearer {gtoken}"})
    r.raise_for_status()
    return r.json().get("values", [])


def sheets_write_single(gtoken, sheet_name, cell, value):
    """1セルに値を書き込む"""
    encoded = requests.utils.quote(sheet_name)
    url = f"{SHEETS_BASE}/{SPREADSHEET_ID}/values/{encoded}!{cell}"
    body = {
        "range": f"{sheet_name}!{cell}",
        "majorDimension": "ROWS",
        "values": [[value]]
    }
    r = requests.put(
        url,
        headers={"Authorization": f"Bearer {gtoken}", "Content-Type": "application/json"},
        json=body,
        params={"valueInputOption": "USER_ENTERED"}
    )
    r.raise_for_status()
    return r.json()


def col_letter(n):
    """1-indexed列番号をアルファベットに変換 (1=A, 26=Z, 27=AA...)"""
    result = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result
    return result


def fmt_yen(v):
    """数値を円表記に変換（例: 90426 → ¥90,426）"""
    return f"¥{int(round(v)):,}"


def get_mgmt_cpa(metrics):
    """管理画面と一致するCPAを取得（'03 all thanks 01d' コンバージョン指標）"""
    for cm in metrics.get("conversionMetrics", []):
        if cm["name"] == "03 all thanks 01d":
            return float(cm.get("cpa", 0))
    return 0


def main():
    if len(sys.argv) > 1:
        today = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
    else:
        today = date.today()
    date_str = today.strftime("%Y-%m-%d")
    today_display = today.strftime("%Y/%m/%d")
    print(f"{'='*50}")
    print(f"ブリリオ日次更新 開始: {today_display}")
    print(f"{'='*50}")

    # ====== Google認証 ======
    print("\n[1] Google認証...")
    gtoken = get_google_token()
    print("    OK")

    # ====== 今日の列を特定（日予算管理の1行目から） ======
    print("\n[2] 今日の列を特定中...")
    row1_values = sheets_read(gtoken, "日予算管理", "F1:AJ1")
    if not row1_values or not row1_values[0]:
        print("ERROR: 日予算管理の1行目が読めませんでした")
        sys.exit(1)

    dates_row = row1_values[0]
    today_col_offset = None
    for i, cell in enumerate(dates_row):
        cell_str = str(cell).strip()
        # "2026/04/06" または "2026/4/6" 形式に対応
        for fmt in ("%Y/%m/%d", "%Y/%-m/%-d"):
            try:
                cell_date = datetime.strptime(cell_str, fmt).date()
                if cell_date == today:
                    today_col_offset = i
                break
            except ValueError:
                continue
        if today_col_offset is not None:
            break

    if today_col_offset is None:
        print(f"ERROR: 今日の日付({today_display})に対応する列が見つかりませんでした")
        sys.exit(1)

    # F列=6番目（1-indexed）なので、今日の列番号 = 6 + offset
    today_col_num = 6 + today_col_offset
    today_col = col_letter(today_col_num)
    print(f"    今日の列: {today_col} ({today_display})")

    # ====== Outbrain APIからデータ取得 ======
    print("\n[3] Outbrain APIからデータ取得中...")

    # 3-1. CPN別データ（includeConversionDetails=trueで取得）
    print("    CPN別データ（コンバージョン詳細付き）...")
    cpn_id_to_metrics = {}
    cpn_data = ob_get(
        f"reports/marketers/{MARKETER_ID}/campaigns/periodic",
        params={"from": date_str, "to": date_str, "breakdown": "daily", "includeConversionDetails": "true"}
    )
    if cpn_data.get("campaignResults"):
        for cpn in cpn_data["campaignResults"]:
            cid = cpn["campaignId"]
            if cpn.get("results"):
                cpn_id_to_metrics[cid] = cpn["results"][0]["metrics"]
    print(f"    取得CPN数: {len(cpn_id_to_metrics)}")

    # 3-2. マーケター全体（spend・CPA取得）
    print("    マーケター全体データ...")
    total_spend = 0
    total_cpa = 0
    marketer_data = ob_get(
        f"reports/marketers/{MARKETER_ID}/periodic",
        params={"from": date_str, "to": date_str, "breakdown": "daily", "includeConversionDetails": "true"}
    )
    if marketer_data.get("results"):
        m = marketer_data["results"][0]["metrics"]
        total_spend = float(m.get("spend", 0))
        total_cpa = get_mgmt_cpa(m)
    print(f"    合計配信金額: {fmt_yen(total_spend) if total_spend > 0 else '¥0'}")
    print(f"    全体平均CPA: {fmt_yen(total_cpa) if total_cpa > 0 else '¥0（CVなし）'}")

    # 3-3. キャンペーン一覧（ID→名前マッピング）
    print("    キャンペーン一覧...")
    id_to_name = {}
    campaigns = ob_get(f"marketers/{MARKETER_ID}/campaigns", params={"limit": 50})
    if campaigns.get("campaigns"):
        for c in campaigns["campaigns"]:
            id_to_name[c["id"]] = c["name"]

    # 【NNN】番号 → CPA, spend のマッピング
    cpn_number_to_metrics = {}
    for cid, metrics in cpn_id_to_metrics.items():
        name = id_to_name.get(cid, "")
        m_match = re.search(r'【(\d+)】', name)
        if m_match:
            num = m_match.group(1)
            cpn_number_to_metrics[num] = metrics

    # ====== 日予算管理タブ 4行目 更新（合計配信金額） ======
    print(f"\n[4] 日予算管理タブ 4行目 ({today_col}4) を更新...")
    if total_spend > 0:
        spend_value = fmt_yen(total_spend)
        sheets_write_single(gtoken, "日予算管理", f"{today_col}4", spend_value)
        print(f"    書き込み完了: {spend_value}")
    else:
        print("    配信金額0円のためスキップ")

    # ====== CPA管理タブ 3行目 更新（全体平均CPA） ======
    print(f"\n[5] CPA管理タブ 3行目 ({today_col}3) を更新...")
    if total_cpa > 0:
        cpa_total_value = fmt_yen(total_cpa)
        sheets_write_single(gtoken, "CPA管理", f"{today_col}3", cpa_total_value)
        print(f"    書き込み完了: {cpa_total_value}")
    else:
        print("    CPA0（CVなし）のためスキップ")

    # ====== CPA管理タブ CPN別行 更新 ======
    print(f"\n[6] CPA管理タブ CPN別CPA ({today_col}列) を更新...")
    # A5:A25 でCPN名を読み取る（A列にCPN名が入っている）
    b_col = sheets_read(gtoken, "CPA管理", "A5:A25")
    updated = 0
    skipped = 0
    for i, row_data in enumerate(b_col):
        if not row_data:
            continue
        cpn_name = row_data[0]
        m_match = re.search(r'【(\d+)】', cpn_name)
        if not m_match:
            continue

        num = m_match.group(1)
        row_num = 5 + i  # A5始まり

        if num in cpn_number_to_metrics:
            metrics = cpn_number_to_metrics[num]
            cpa = get_mgmt_cpa(metrics)
            if cpa > 0:
                cpa_str = fmt_yen(cpa)
            else:
                # CVなし → "-"
                cpa_str = "-"
            sheets_write_single(gtoken, "CPA管理", f"{today_col}{row_num}", cpa_str)
            print(f"    行{row_num} 【{num}】: {cpa_str}")
            updated += 1
        else:
            # 配信なし → 空欄のままスキップ
            skipped += 1

    print(f"    更新: {updated}件 / スキップ(配信なし): {skipped}件")

    print(f"\n{'='*50}")
    print(f"完了！ {today_display} のデータをスプレッドシートに反映しました。")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
