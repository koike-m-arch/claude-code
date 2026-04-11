"""
数値集計タブに Outbrain の名前付きコンバージョンを書き込むスクリプト

  I列（⑦LP遷移数）← 01 LP 01d Conversions(Click)
  N列（⑫CV数）    ← 03 all thanks 01d Conversions(Click)

使い方:
  python update_lp_conversions.py
  → シートの開始日・終了日（C2/C3）を自動読み取りして更新

  python update_lp_conversions.py 2026-04-01 2026-04-07
  → 期間を手動指定して更新
"""

import re
import sys
import io
import json
import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ─── 設定 ────────────────────────────────────────────────
SS_ID       = '1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8'
SHEET_NAME  = '数値集計'
MARKETER_ID = '00af75b8e5565b04764d17c4f90cb25caf'
OB_TOKEN    = (
    'MTc3NTIyMjU5Njg4NjoxNTcxMDVkMjc0ZWI4NjY0Nzc1MzgzNjJlYjY4NjYyMGI4ZmYwM2FhZTI4MDhmZTdi'
    'OWNkNWVlZTgxZTVmMjdhOnsiY2FsbGVyQXBwbGljYXRpb24iOiJBbWVsaWEiLCJpcEFkZHJlc3MiOiIvMTAu'
    'MjQyLjIxNC4xMzk6NTY4NTAiLCJieXBhc3NBcGlBdXRoIjoiZmFsc2UiLCJ1c2VyTmFtZSI6Im1pcmFpa2ly'
    'ZWkiLCJ1c2VySWQiOiIxMDQzMTQ5OSIsImRhdGFTb3VyY2VUeXBlIjoiTVlfT0JfQ09NIn06ZjFhNDkyMjkx'
    'MWRiODk3ZDJlZWE2ZDBjN2Y3OThiZjBlMzJmOGM0YmZhOWM3YWE1MWI3ODI4YmVlYTg1YWNlN2U3ZWM3Y2Yz'
    'NWE3ZmY1OGVlYmI0ZGUwZjEwNDhhMzE5MTIzYTI2YTBkM2FkOTE2M2ZlOWY4NmZmYzJmYTg4OWU='
)
from _credentials import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

# Outbrain コンバージョン名（管理画面の表示名と一致）
LP_CONV_NAME   = '01 LP 01d'           # → I列（⑦LP遷移数）
CV_CONV_NAME   = '03 all thanks 01d'   # → N列（⑫CV数）
# ──────────────────────────────────────────────────────────


def get_google_token():
    r = requests.post('https://oauth2.googleapis.com/token', data={
        'client_id': GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'refresh_token': GOOGLE_REFRESH_TOKEN,
        'grant_type': 'refresh_token',
    })
    return r.json()['access_token']


def read_sheet(token, range_name):
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{SS_ID}/values/{range_name}'
    r = requests.get(url, headers={'Authorization': f'Bearer {token}'})
    return r.json().get('values', [])


def extract_cpn_number(name):
    """【066】... から '066' を取り出す"""
    m = re.search(r'【(\d+)】', name)
    return m.group(1) if m else None


def get_ob_conversion_data(date_from, date_to):
    """
    Outbrain APIから名前付きコンバージョンをキャンペーン番号別に返す

    Returns:
        dict: { '066': {'lp': 502, 'cv': 36}, '067': {...}, ... }
    """
    # キャンペーンID→名前マッピング
    c_resp = requests.get(
        f'https://api.outbrain.com/amplify/v0.1/marketers/{MARKETER_ID}/campaigns',
        headers={'OB-TOKEN-V1': OB_TOKEN},
        params={'limit': 50},
    )
    id_to_name = {c['id']: c['name'] for c in c_resp.json().get('campaigns', [])}

    # CPN別レポート（includeConversionDetails=true）
    r = requests.get(
        f'https://api.outbrain.com/amplify/v0.1/reports/marketers/{MARKETER_ID}/campaigns/periodic',
        headers={'OB-TOKEN-V1': OB_TOKEN},
        params={'from': date_from, 'to': date_to, 'includeConversionDetails': 'true'},
    )
    d = r.json()

    result = {}
    for c in d.get('campaignResults', []):
        cid     = c['campaignId']
        name    = id_to_name.get(cid, '')
        cpn_num = extract_cpn_number(name)
        if not cpn_num:
            continue

        lp_total = 0
        cv_total = 0
        for row in c['results']:
            for cm in (row['metrics'].get('conversionMetrics') or []):
                conv_name = (cm.get('name') or '').strip()
                val       = cm.get('conversions', 0)
                if conv_name == LP_CONV_NAME:
                    lp_total += val
                if conv_name == CV_CONV_NAME:
                    cv_total += val

        result[cpn_num] = {'lp': int(lp_total), 'cv': int(cv_total)}

    return result


def main():
    token = get_google_token()

    # 期間を引数またはシートから取得
    if len(sys.argv) >= 3:
        date_from, date_to = sys.argv[1], sys.argv[2]
        print(f'期間（引数指定）: {date_from} ～ {date_to}')
    else:
        dates     = read_sheet(token, f"'{SHEET_NAME}'!C2:C3")
        raw_from  = dates[0][0] if dates else ''
        raw_to    = dates[1][0] if len(dates) > 1 else ''
        date_from = raw_from.replace('/', '-')
        date_to   = raw_to.replace('/', '-')
        print(f'期間（シート読み取り）: {date_from} ～ {date_to}')

    # Outbrain APIからデータ取得
    print('Outbrain APIからデータ取得中...')
    conv_map = get_ob_conversion_data(date_from, date_to)
    print(f'取得キャンペーン数: {len(conv_map)}')

    # シートのB列（キャンペーン名）を読み取り
    rows = read_sheet(token, f"'{SHEET_NAME}'!B1:B200")

    data_updates = []
    for i, row in enumerate(rows):
        sheet_row = i + 1
        if not row:
            continue
        cell_b  = row[0].strip()
        cpn_num = extract_cpn_number(cell_b)
        if not cpn_num:
            continue

        data = conv_map.get(cpn_num)
        if data is None:
            print(f'  行{sheet_row}: 【{cpn_num}】 → APIデータなし（スキップ）')
            continue

        lp = data['lp']
        cv = data['cv']
        print(f'  行{sheet_row}: 【{cpn_num}】 LP遷移数={lp}  CV数={cv}')

        # I列（⑦LP遷移数）
        data_updates.append({
            'range': f"'{SHEET_NAME}'!I{sheet_row}",
            'majorDimension': 'ROWS',
            'values': [[lp]],
        })
        # N列（⑫CV数）
        data_updates.append({
            'range': f"'{SHEET_NAME}'!N{sheet_row}",
            'majorDimension': 'ROWS',
            'values': [[cv]],
        })

    if not data_updates:
        print('更新対象なし。')
        return

    print(f'\nI列・N列を更新中（{len(data_updates) // 2}キャンペーン）...')
    body = {'valueInputOption': 'USER_ENTERED', 'data': data_updates}
    r = requests.post(
        f'https://sheets.googleapis.com/v4/spreadsheets/{SS_ID}/values:batchUpdate',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        json=body,
    )
    resp = r.json()
    if 'totalUpdatedCells' in resp:
        print(f'完了: {resp["totalUpdatedCells"]}セル更新しました')
    else:
        print('エラー:', json.dumps(resp, ensure_ascii=False)[:500])


if __name__ == '__main__':
    main()
