"""
数値集計②タブに Outbrain の名前付きコンバージョンを書き込むスクリプト
チェルラーホワイト用

  I列（⑦LP遷移数）← 01LP Conversions (Click)
  N列（⑫CV数）    ← thanks 1day Conversions (Click)

使い方:
  python update_white_conversions.py
  → シートの開始日・終了日（C2/C3）を自動読み取りして更新

  python update_white_conversions.py 2026-04-01 2026-04-07
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
SHEET_NAME  = '数値集計②'
MARKETER_ID = '0033e4d3d312b31c84630c2166acec7b27'
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
LP_CONV_NAME = '01LP Conversions (Click)'       # → I列（⑦LP遷移数）
CV_CONV_NAME = 'thanks 1day Conversions (Click)' # → N列（⑫CV数）
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


def match_conv_name(api_name, target_name):
    """コンバージョン名の照合（完全一致 → 大文字小文字無視の部分一致）"""
    a = (api_name or '').strip()
    t = (target_name or '').strip()
    if a == t:
        return True
    return t.lower() in a.lower() or a.lower() in t.lower()


def extract_cpn_number(name):
    """【066】... 形式があれば番号を返す（ない場合は None）"""
    m = re.search(r'【(\d+)】', name)
    return m.group(1) if m else None


def get_ob_conversion_data(date_from, date_to):
    """
    Outbrain APIから名前付きコンバージョンをキャンペーン名別に返す

    Returns:
        dict: {
            'キャンペーン名': {'lp': 502, 'cv': 36, 'cpn_num': '066' or None},
            ...
        }
    """
    # キャンペーンID → 名前マッピング
    c_resp = requests.get(
        f'https://api.outbrain.com/amplify/v0.1/marketers/{MARKETER_ID}/campaigns',
        headers={'OB-TOKEN-V1': OB_TOKEN},
        params={'limit': 200},
    )
    c_data = c_resp.json()
    if c_resp.status_code != 200:
        print(f'キャンペーン一覧取得失敗 (HTTP {c_resp.status_code}): {c_data}')
        return {}

    id_to_name = {c['id']: c.get('name', c['id']) for c in c_data.get('campaigns', [])}
    print(f'キャンペーン一覧取得: {len(id_to_name)}件')

    # CPN別レポート（includeConversionDetails=true）
    r = requests.get(
        f'https://api.outbrain.com/amplify/v0.1/reports/marketers/{MARKETER_ID}/campaigns/periodic',
        headers={'OB-TOKEN-V1': OB_TOKEN},
        params={'from': date_from, 'to': date_to, 'includeConversionDetails': 'true'},
    )
    if r.status_code != 200:
        print(f'レポート取得失敗 (HTTP {r.status_code}): {r.text[:300]}')
        return {}

    d = r.json()
    camp_list = d.get('campaignResults', d.get('results', []))
    print(f'レポート取得: {len(camp_list)}キャンペーン')

    result = {}
    for c in camp_list:
        cid  = c.get('campaignId', '')
        name = id_to_name.get(cid, cid)

        lp_total = 0
        cv_total = 0

        # periodic形式（c.results）とフラット形式の両方に対応
        rows = c.get('results') or [c]
        for row in rows:
            for cm in (row.get('metrics', {}).get('conversionMetrics') or []):
                conv_name = (cm.get('name') or '').strip()
                val       = cm.get('conversions', 0)
                if match_conv_name(conv_name, LP_CONV_NAME):
                    lp_total += val
                if match_conv_name(conv_name, CV_CONV_NAME):
                    cv_total += val

        result[name] = {
            'lp':      int(lp_total),
            'cv':      int(cv_total),
            'cpn_num': extract_cpn_number(name),  # 【XXX】形式なら番号を保持
        }
        print(f'  {name}: LP={lp_total}, CV={cv_total}')

    return result


def find_match(cell_b, conv_map):
    """
    シートのB列セル値に対応するコンバージョンデータを返す。
    1. 完全一致
    2. 【XXX】番号一致（ブリリオ互換）
    3. 部分一致
    """
    cell_b = cell_b.strip()
    if not cell_b:
        return None

    # 1. 完全一致
    if cell_b in conv_map:
        return conv_map[cell_b]

    # 2. 【XXX】番号一致
    sheet_num = extract_cpn_number(cell_b)
    if sheet_num:
        for name, data in conv_map.items():
            if data.get('cpn_num') == sheet_num:
                return data

    # 3. 部分一致（前方一致優先）
    for name, data in conv_map.items():
        if name in cell_b or cell_b in name:
            return data

    return None


def main():
    token = get_google_token()

    # 期間を引数またはシートから取得
    if len(sys.argv) >= 3:
        date_from, date_to = sys.argv[1], sys.argv[2]
        print(f'期間（引数指定）: {date_from} ～ {date_to}')
    else:
        dates    = read_sheet(token, f"'{SHEET_NAME}'!C2:C3")
        raw_from = dates[0][0] if dates else ''
        raw_to   = dates[1][0] if len(dates) > 1 else ''
        date_from = raw_from.replace('/', '-')
        date_to   = raw_to.replace('/', '-')
        print(f'期間（シート読み取り）: {date_from} ～ {date_to}')

    if not date_from or not date_to:
        print('エラー: 日付が取得できませんでした。C2/C3 に日付を入力してください。')
        return

    # Outbrain APIからデータ取得
    print('\nOutbrain APIからデータ取得中...')
    conv_map = get_ob_conversion_data(date_from, date_to)
    if not conv_map:
        print('データが取得できませんでした。OB_TOKEN / MARKETER_ID を確認してください。')
        return

    # シートのB列を読み取り（最大200行）
    rows = read_sheet(token, f"'{SHEET_NAME}'!B1:B200")

    data_updates = []
    print('\nシートとのマッチング:')
    for i, row in enumerate(rows):
        sheet_row = i + 1
        if not row:
            continue
        cell_b = row[0].strip()
        if not cell_b:
            continue

        data = find_match(cell_b, conv_map)
        if data is None:
            continue

        lp = data['lp']
        cv = data['cv']
        print(f'  行{sheet_row}: {cell_b[:40]} → LP遷移数={lp}  CV数={cv}')

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
        print('更新対象なし。シートのB列にキャンペーン名が書き込まれているか確認してください。')
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
