"""
数値集計③タブに Outbrain ととのえるの名前付きコンバージョンを書き込むスクリプト

  I列（⑦LP遷移数(W)） ← 1 Day 01 LP walking
  K列（⑨LP遷移数(B)） ← 1 Day 01 LP basic
  M列（⑪カート追加）  ← Add to cart NEW(4/7~)
  O列（⑬CV数）        ← thanks 01 day

取得方式（2段階フォールバック）:
  1次: includeConversionDetails=true（1回のAPIコールで全キャンペーン）
  2次: 管理画面コンバージョンゴールIDを使い、ゴールごとにAPIクエリ（ブリリオ方式）

使い方:
  python update_lp_conversions_totonoeru.py
  → シートの開始日・終了日（C2/C3）を自動読み取りして更新

  python update_lp_conversions_totonoeru.py 2026-04-01 2026-04-07
  → 期間を手動指定して更新
"""

import sys
import io
import json
import time
import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ─── 設定 ────────────────────────────────────────────────
SS_ID       = '1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8'
SHEET_NAME  = '数値集計③'
MARKETER_ID = '007d79ad320ca3facfae0f6c585b8a46f1'  # ととのえる固定

# miraikirei アカウント共通トークン（ブリリオ・ホワイトと同じアカウント）
OB_TOKEN = (
    'MTc3NTIyMjU5Njg4NjoxNTcxMDVkMjc0ZWI4NjY0Nzc1MzgzNjJlYjY4NjYyMGI4ZmYwM2FhZTI4MDhmZTdi'
    'OWNkNWVlZTgxZTVmMjdhOnsiY2FsbGVyQXBwbGljYXRpb24iOiJBbWVsaWEiLCJpcEFkZHJlc3MiOiIvMTAu'
    'MjQyLjIxNC4xMzk6NTY4NTAiLCJieXBhc3NBcGlBdXRoIjoiZmFsc2UiLCJ1c2VyTmFtZSI6Im1pcmFpa2ly'
    'ZWkiLCJ1c2VySWQiOiIxMDQzMTQ5OSIsImRhdGFTb3VyY2VUeXBlIjoiTVlfT0JfQ09NIn06ZjFhNDkyMjkx'
    'MWRiODk3ZDJlZWE2ZDBjN2Y3OThiZjBlMzJmOGM0YmZhOWM3YWE1MWI3ODI4YmVlYTg1YWNlN2U3ZWM3Y2Yz'
    'NWE3ZmY1OGVlYmI0ZGUwZjEwNDhhMzE5MTIzYTI2YTBkM2FkOTE2M2ZlOWY4NmZmYzJmYTg4OWU='
)

from _credentials import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

# Outbrain コンバージョン名（管理画面の表示名そのまま）
LP_WALK_NAME  = '1Day 01 LP walking'        # → I列（⑦LP遷移数(W)）
LP_BASIC_NAME = '1Day 01LP basic'           # → K列（⑨LP遷移数(B)）
CART_NAME     = 'Add to cart\u3000NEW(4/7~)'  # → M列（⑪カート追加・全角スペース）
CV_NAME       = 'thanks 01day'              # → O列（⑬CV数）
# ──────────────────────────────────────────────────────────

OB_BASE = 'https://api.outbrain.com/amplify/v0.1'
OB_HEADERS = {'OB-TOKEN-V1': OB_TOKEN}


def conv_match(api_name, target_name):
    """
    コンバージョン名の柔軟マッチ（GASのconvMatchTotonomeru相当）。
    APIが "Conversions (Click)" サフィックスあり/なし両方に対応。
    """
    # 全角スペース(U+3000)を半角に正規化してから比較
    a = (api_name or '').replace('\u3000', ' ').lower().strip()
    t = (target_name or '').replace('\u3000', ' ').lower().strip()
    return a == t or a.startswith(t) or t.startswith(a)


# ─── Google認証 ──────────────────────────────────────────
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


# ─── Outbrain: キャンペーン一覧 ──────────────────────────
def build_campaign_id_to_name():
    id_to_name = {}
    offset = 0
    while True:
        resp = requests.get(
            f'{OB_BASE}/marketers/{MARKETER_ID}/campaigns',
            headers=OB_HEADERS,
            params={'limit': 50, 'offset': offset},
        )
        resp.raise_for_status()
        campaigns = resp.json().get('campaigns', [])
        for c in campaigns:
            id_to_name[c['id']] = c['name']
        print(f'  キャンペーン取得: offset={offset} 件数={len(campaigns)} 累計={len(id_to_name)}')
        if len(campaigns) < 50:
            break
        offset += 50
    return id_to_name


# ─── Outbrain: 管理画面コンバージョンゴールID取得 ──────────
def get_conversion_goal_ids():
    """
    管理画面で設定されているコンバージョンゴールのIDを取得する（ブリリオ方式）。
    LP_WALK / LP_BASIC / CART / CV の各名前と部分一致検索。
    """
    goals = []
    for url in [
        f'{OB_BASE}/marketers/{MARKETER_ID}/conversionGoals?limit=50',
        f'{OB_BASE}/marketers/{MARKETER_ID}/conversionGoals',
    ]:
        resp = requests.get(url, headers=OB_HEADERS)
        print(f'  conversionGoals status: {resp.status_code} ({url})')
        if resp.status_code == 200:
            data = resp.json()
            goals = data.get('conversionGoals', data.get('goals', []))
            if goals:
                break

    if not goals:
        print('  ⚠ コンバージョンゴール一覧を取得できませんでした')
        return {}

    print(f'  管理画面コンバージョンゴール（{len(goals)}件）:')
    for g in goals:
        print(f'    id={g.get("id")}  name={repr(g.get("name"))}')

    target_map = {
        'lp_walk':  LP_WALK_NAME,
        'lp_basic': LP_BASIC_NAME,
        'cart':     CART_NAME,
        'cv':       CV_NAME,
    }

    ids = {}
    for key, target in target_map.items():
        target_lower = target.lower()
        for g in goals:
            g_name = (g.get('name') or '').lower()
            if g_name == target_lower or target_lower in g_name or g_name in target_lower:
                ids[key] = g.get('id')
                print(f'  ✓ {key} → id={ids[key]}  ({g.get("name")})')
                break
        if key not in ids:
            print(f'  ✗ {key} → IDが見つかりませんでした（名前: {repr(target)}）')

    return ids


# ─── Outbrain: 1次取得（includeConversionDetails方式） ───
def fetch_by_conversion_details(date_from, date_to, id_to_name):
    """
    includeConversionDetails=true でキャンペーン別コンバージョンを取得。
    conversionMetrics または conversions_per_goal フィールドを参照。
    """
    resp = requests.get(
        f'{OB_BASE}/reports/marketers/{MARKETER_ID}/campaigns/periodic',
        headers=OB_HEADERS,
        params={'from': date_from, 'to': date_to, 'includeConversionDetails': 'true'},
    )
    resp.raise_for_status()
    data = resp.json()

    result = {}
    for camp in data.get('campaignResults', []):
        cid  = camp['campaignId']
        name = id_to_name.get(cid, cid)
        lp_walk = lp_basic = cart = cv = 0
        for row in camp.get('results', []):
            m = row.get('metrics', {})
            # conversionMetrics または conversions_per_goal（APIバージョンによる差異）
            conv_list = m.get('conversionMetrics') or m.get('conversions_per_goal') or []
            for cm in conv_list:
                conv_name = (cm.get('name') or '').strip()
                val = cm.get('conversions', 0)
                if conv_match(conv_name, LP_WALK_NAME):  lp_walk  += val
                if conv_match(conv_name, LP_BASIC_NAME): lp_basic += val
                if conv_match(conv_name, CART_NAME):     cart     += val
                if conv_match(conv_name, CV_NAME):       cv       += val

        result[name] = {
            'lp_walk':  int(lp_walk),
            'lp_basic': int(lp_basic),
            'cart':     int(cart),
            'cv':       int(cv),
            '_cid':     cid,
        }

    return result


# ─── Outbrain: 2次取得（conversionGoalId方式・ブリリオ方式） ─
def fetch_by_goal_ids(date_from, date_to, id_to_name, goal_ids):
    """
    管理画面のコンバージョンゴールIDを使いキャンペーン別コンバージョンを取得。
    各ゴールごとに1回APIを叩く（計4回）。
    """
    # campaign_id → name の逆引きマップを初期化
    result = {name: {'lp_walk': 0, 'lp_basic': 0, 'cart': 0, 'cv': 0} for name in id_to_name.values()}

    fields = [
        ('lp_walk',  goal_ids.get('lp_walk')),
        ('lp_basic', goal_ids.get('lp_basic')),
        ('cart',     goal_ids.get('cart')),
        ('cv',       goal_ids.get('cv')),
    ]

    for field, gid in fields:
        if not gid:
            print(f'  [{field}] ゴールIDなし → スキップ')
            continue

        time.sleep(0.1)  # レート制限対策
        resp = requests.get(
            f'{OB_BASE}/reports/marketers/{MARKETER_ID}/campaigns/periodic',
            headers=OB_HEADERS,
            params={'from': date_from, 'to': date_to, 'conversionGoalId': gid},
        )
        if resp.status_code != 200:
            print(f'  [{field}] API error {resp.status_code}')
            continue

        data = resp.json()
        total_across_campaigns = 0
        for camp in data.get('campaignResults', []):
            cid  = camp['campaignId']
            name = id_to_name.get(cid, cid)
            camp_total = sum(
                (row.get('metrics', {}).get('conversions') or
                 row.get('metrics', {}).get('totalConversions') or 0)
                for row in camp.get('results', [])
            )
            if name not in result:
                result[name] = {'lp_walk': 0, 'lp_basic': 0, 'cart': 0, 'cv': 0}
            result[name][field] += int(camp_total)
            total_across_campaigns += int(camp_total)

        print(f'  [{field}] goalId={gid} 合計={total_across_campaigns}')

    return result


# ─── メイン ──────────────────────────────────────────────
def main():
    print('=== ととのえるOutbrain LP遷移数・CV数 更新 ===')

    print('\n[1] Google認証...')
    gtoken = get_google_token()
    print('    OK')

    # 期間を引数またはシートから取得
    if len(sys.argv) >= 3:
        date_from, date_to = sys.argv[1], sys.argv[2]
        print(f'\n[2] 期間（引数）: {date_from} ～ {date_to}')
    else:
        dates    = read_sheet(gtoken, f"'{SHEET_NAME}'!C2:C3")
        raw_from = dates[0][0] if dates else ''
        raw_to   = dates[1][0] if len(dates) > 1 else ''
        date_from = raw_from.replace('/', '-')
        date_to   = raw_to.replace('/', '-')
        print(f'\n[2] 期間（シート）: {date_from} ～ {date_to}')

    print('\n[3] キャンペーン一覧取得...')
    id_to_name = build_campaign_id_to_name()
    print(f'    計{len(id_to_name)}件')

    # ── 1次取得：includeConversionDetails ──
    print('\n[4] 1次取得（includeConversionDetails）...')
    conv_map = fetch_by_conversion_details(date_from, date_to, id_to_name)
    print(f'    キャンペーン数: {len(conv_map)}')

    # 1次結果の合計確認
    total_lp   = sum(v['lp_walk'] + v['lp_basic'] for v in conv_map.values())
    total_cart = sum(v['cart'] for v in conv_map.values())
    print(f'    LP合計={total_lp}  カート合計={total_cart}')

    # ── 2次取得：conversionGoalId（1次で0の場合） ──
    if total_lp == 0 or total_cart == 0:
        print('\n[5] LP/カートが0 → 管理画面コンバージョンゴールID方式にフォールバック...')
        goal_ids = get_conversion_goal_ids()

        if goal_ids:
            goal_result = fetch_by_goal_ids(date_from, date_to, id_to_name, goal_ids)

            # 各キャンペーンでゴールID方式の値をマージ（0なら上書き）
            for name, vals in goal_result.items():
                if name not in conv_map:
                    conv_map[name] = {'lp_walk': 0, 'lp_basic': 0, 'cart': 0, 'cv': 0}
                for field in ('lp_walk', 'lp_basic', 'cart', 'cv'):
                    if conv_map[name].get(field, 0) == 0 and vals.get(field, 0) > 0:
                        conv_map[name][field] = vals[field]

            total_lp_after   = sum(v['lp_walk'] + v['lp_basic'] for v in conv_map.values())
            total_cart_after = sum(v['cart'] for v in conv_map.values())
            print(f'    マージ後: LP合計={total_lp_after}  カート合計={total_cart_after}')
    else:
        print('\n[5] 1次取得でLP/カートあり → フォールバック不要')

    # ── シートB列読み取り & 書き込みデータ構築 ──
    print('\n[6] シートのB列読み取り...')
    rows = read_sheet(gtoken, f"'{SHEET_NAME}'!B1:B200")

    data_updates = []
    for i, row in enumerate(rows):
        sheet_row = i + 1
        if not row:
            continue
        cell_b = row[0].strip()
        if not cell_b:
            continue

        # 完全一致
        data = conv_map.get(cell_b)

        # 部分一致
        if data is None:
            for api_name, vals in conv_map.items():
                if cell_b in api_name or api_name in cell_b:
                    data = vals
                    break

        if data is None:
            continue

        lp_walk  = data['lp_walk']
        lp_basic = data['lp_basic']
        cart     = data['cart']
        cv       = data['cv']
        print(f'  行{sheet_row}: {cell_b[:50]} → LP(W)={lp_walk}  LP(B)={lp_basic}  カート={cart}  CV={cv}')

        # I列: ⑦LP遷移数(W)
        data_updates.append({
            'range': f"'{SHEET_NAME}'!I{sheet_row}",
            'majorDimension': 'ROWS',
            'values': [[lp_walk]],
        })
        # K列: ⑨LP遷移数(B)
        data_updates.append({
            'range': f"'{SHEET_NAME}'!K{sheet_row}",
            'majorDimension': 'ROWS',
            'values': [[lp_basic]],
        })
        # M列: ⑪カート追加
        data_updates.append({
            'range': f"'{SHEET_NAME}'!M{sheet_row}",
            'majorDimension': 'ROWS',
            'values': [[cart]],
        })
        # O列: ⑬CV数
        data_updates.append({
            'range': f"'{SHEET_NAME}'!O{sheet_row}",
            'majorDimension': 'ROWS',
            'values': [[cv]],
        })

    if not data_updates:
        print('更新対象なし。')
        print('\n[Debug] APIから取得したキャンペーン名（最大10件）:')
        for name in list(conv_map.keys())[:10]:
            print(f'  {repr(name)}')
        return

    print(f'\n[7] I・K・M・O列を更新中（{len(data_updates) // 4}キャンペーン）...')
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
