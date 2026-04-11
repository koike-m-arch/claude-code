"""
数値集計②タブに Outbrain ホワイトの名前付きコンバージョンを書き込むスクリプト

  I列（⑦LP遷移数）← 01LP
  N列（⑫CV数）    ← thanks 1day

使い方:
  python update_lp_conversions_white.py
  → シートの開始日・終了日（C2/C3）を自動読み取りして更新

  python update_lp_conversions_white.py 2026-04-03 2026-04-09
  → 期間を手動指定して更新
"""

import re
import sys
import io
import json
import base64
import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ─── 設定 ────────────────────────────────────────────────
SS_ID       = '1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8'
SHEET_NAME  = '数値集計②'
MARKETER_ID = '0033e4d3d312b31c84630c2166acec7b27'

from _credentials import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, OB_USERNAME, OB_PASSWORD

# キャッシュトークン（ログインレート制限時のフォールバック）
_OB_TOKEN_CACHE = (
    'MTc3NTIyMjU5Njg4NjoxNTcxMDVkMjc0ZWI4NjY0Nzc1MzgzNjJlYjY4NjYyMGI4ZmYwM2FhZTI4MDhmZTdi'
    'OWNkNWVlZTgxZTVmMjdhOnsiY2FsbGVyQXBwbGljYXRpb24iOiJBbWVsaWEiLCJpcEFkZHJlc3MiOiIvMTAu'
    'MjQyLjIxNC4xMzk6NTY4NTAiLCJieXBhc3NBcGlBdXRoIjoiZmFsc2UiLCJ1c2VyTmFtZSI6Im1pcmFpa2ly'
    'ZWkiLCJ1c2VySWQiOiIxMDQzMTQ5OSIsImRhdGFTb3VyY2VUeXBlIjoiTVlfT0JfQ09NIn06ZjFhNDkyMjkx'
    'MWRiODk3ZDJlZWE2ZDBjN2Y3OThiZjBlMzJmOGM0YmZhOWM3YWE1MWI3ODI4YmVlYTg1YWNlN2U3ZWM3Y2Yz'
    'NWE3ZmY1OGVlYmI0ZGUwZjEwNDhhMzE5MTIzYTI2YTBkM2FkOTE2M2ZlOWY4NmZmYzJmYTg4OWU='
)


# Outbrain コンバージョン名（API実測値）
# 管理画面表示名 vs APIの実際の名前:
#   "01LP Conversions (Click)"         → API: '01LP'
#   "02 confirm 1day Conversions (Click)" → API: '02 confirm 1day'
#   "thanks 1day Conversions (Click)"  → API: 'thanks 1day'
LP_CONV_NAME = '01LP'           # → I列（⑦LP遷移数）
CV_CONV_NAME = 'thanks 1day'    # → N列（⑫CV数）
# ──────────────────────────────────────────────────────────

OB_BASE = 'https://api.outbrain.com/amplify/v0.1'


def get_ob_token():
    # キャッシュトークンが有効か確認（ログインレート制限の回避）
    test = requests.get(
        f'{OB_BASE}/marketers/{MARKETER_ID}/campaigns',
        headers={'OB-TOKEN-V1': _OB_TOKEN_CACHE},
        params={'limit': 1}
    )
    if test.status_code == 200:
        print('    キャッシュトークン使用')
        return _OB_TOKEN_CACHE

    # 期限切れの場合はログイン
    creds = base64.b64encode(f'{OB_USERNAME}:{OB_PASSWORD}'.encode()).decode()
    r = requests.get(f'{OB_BASE}/login', headers={'Authorization': f'Basic {creds}'})
    if r.status_code == 429:
        raise RuntimeError('Outbrainログインがレート制限中。しばらく待ってから再実行してください。')
    r.raise_for_status()
    token = r.headers.get('OB-TOKEN-V1') or r.headers.get('ob-token-v1')
    if not token:
        try:
            token = r.json().get('OB-TOKEN-V1') or r.json().get('OB_TOKEN_V1')
        except Exception:
            pass
    if not token:
        raise RuntimeError(f'Outbrain認証失敗: {r.text[:500]}')
    return token


def get_google_token():
    r = requests.post('https://oauth2.googleapis.com/token', data={
        'client_id': GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'refresh_token': GOOGLE_REFRESH_TOKEN,
        'grant_type': 'refresh_token',
    })
    return r.json()['access_token']


def read_sheet(gtoken, range_name):
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{SS_ID}/values/{range_name}'
    r = requests.get(url, headers={'Authorization': f'Bearer {gtoken}'})
    r.raise_for_status()
    return r.json().get('values', [])


def get_ob_conversion_data(ob_token, date_from, date_to):
    """
    Outbrain APIから名前付きコンバージョンをキャンペーン名別に返す

    Returns:
        dict: { 'キャンペーン名': {'lp': 502, 'cv': 36}, ... }
    """
    # キャンペーンID→名前マッピング（ページネーション対応）
    id_to_name = {}
    offset = 0
    while True:
        c_resp = requests.get(
            f'{OB_BASE}/marketers/{MARKETER_ID}/campaigns',
            headers={'OB-TOKEN-V1': ob_token},
            params={'limit': 50, 'offset': offset},
        )
        c_resp.raise_for_status()
        campaigns = c_resp.json().get('campaigns', [])
        for c in campaigns:
            id_to_name[c['id']] = c['name']
        print(f'  キャンペーン取得: offset={offset} 件数={len(campaigns)} 累計={len(id_to_name)}')
        if len(campaigns) < 50:
            break
        offset += 50

    # CPN別レポート
    r = requests.get(
        f'{OB_BASE}/reports/marketers/{MARKETER_ID}/campaigns/periodic',
        headers={'OB-TOKEN-V1': ob_token},
        params={'from': date_from, 'to': date_to, 'includeConversionDetails': 'true'},
    )
    r.raise_for_status()
    d = r.json()

    result = {}
    for c in d.get('campaignResults', []):
        cid  = c['campaignId']
        name = id_to_name.get(cid, cid)

        lp_total = 0
        cv_total = 0
        for row in c.get('results', []):
            for cm in (row.get('metrics', {}).get('conversionMetrics') or []):
                conv_name = (cm.get('name') or '').strip()
                val = cm.get('conversions', 0)
                if conv_name == LP_CONV_NAME:
                    lp_total += val
                if conv_name == CV_CONV_NAME:
                    cv_total += val

        result[name] = {'lp': int(lp_total), 'cv': int(cv_total)}

    return result


def main():
    if SS_ID == 'WHITE_SPREADSHEET_ID_HERE':
        print('ERROR: SS_ID を設定してください（ホワイト配信戦略スプレッドシートのID）')
        sys.exit(1)

    print('=== ホワイトOutbrain LP遷移数・CV数 更新 ===')

    print('\n[1] Outbrain認証...')
    ob_token = get_ob_token()
    print('    OK')

    print('\n[2] Google認証...')
    gtoken = get_google_token()
    print('    OK')

    # 期間を引数またはシートから取得
    if len(sys.argv) >= 3:
        date_from, date_to = sys.argv[1], sys.argv[2]
        print(f'\n[3] 期間（引数）: {date_from} ～ {date_to}')
    else:
        dates    = read_sheet(gtoken, f"'{SHEET_NAME}'!C2:C3")
        raw_from = dates[0][0] if dates else ''
        raw_to   = dates[1][0] if len(dates) > 1 else ''
        date_from = raw_from.replace('/', '-')
        date_to   = raw_to.replace('/', '-')
        print(f'\n[3] 期間（シート）: {date_from} ～ {date_to}')

    print('\n[4] Outbrain APIからデータ取得中...')
    conv_map = get_ob_conversion_data(ob_token, date_from, date_to)
    print(f'    取得キャンペーン数: {len(conv_map)}')

    # シートのB列（キャンペーン名）を読み取り
    print('\n[5] シートのB列読み取り...')
    rows = read_sheet(gtoken, f"'{SHEET_NAME}'!B1:B200")

    data_updates = []
    for i, row in enumerate(rows):
        sheet_row = i + 1
        if not row:
            continue
        cell_b = row[0].strip()
        if not cell_b:
            continue

        # 完全一致でキャンペーンを探す
        data = conv_map.get(cell_b)

        # 完全一致しない場合は部分一致を試みる
        if data is None:
            for api_name, vals in conv_map.items():
                if cell_b in api_name or api_name in cell_b:
                    data = vals
                    break

        if data is None:
            continue

        lp = data['lp']
        cv = data['cv']
        print(f'  行{sheet_row}: {cell_b[:50]} → LP={lp}  CV={cv}')

        data_updates.append({
            'range': f"'{SHEET_NAME}'!I{sheet_row}",
            'majorDimension': 'ROWS',
            'values': [[lp]],
        })
        data_updates.append({
            'range': f"'{SHEET_NAME}'!N{sheet_row}",
            'majorDimension': 'ROWS',
            'values': [[cv]],
        })

    if not data_updates:
        print('更新対象なし。')
        print('\n[Debug] APIから取得したキャンペーン名:')
        for name in list(conv_map.keys())[:10]:
            print(f'  {repr(name)}')
        return

    print(f'\n[6] I列・N列を更新中（{len(data_updates) // 2}キャンペーン）...')
    body = {'valueInputOption': 'USER_ENTERED', 'data': data_updates}
    r = requests.post(
        f'https://sheets.googleapis.com/v4/spreadsheets/{SS_ID}/values:batchUpdate',
        headers={'Authorization': f'Bearer {gtoken}', 'Content-Type': 'application/json'},
        json=body,
    )
    resp = r.json()
    if 'totalUpdatedCells' in resp:
        print(f'    完了: {resp["totalUpdatedCells"]}セル更新しました')
    else:
        print('    エラー:', json.dumps(resp, ensure_ascii=False)[:500])


if __name__ == '__main__':
    main()
