import json, requests, sys, io
from collections import defaultdict
from _credentials import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

base = 'C:/Users/koike-m/AppData/Local/Temp'

# Googleトークン取得
r = requests.post('https://oauth2.googleapis.com/token', data={
    'client_id': GOOGLE_CLIENT_ID,
    'client_secret': GOOGLE_CLIENT_SECRET,
    'refresh_token': GOOGLE_REFRESH_TOKEN,
    'grant_type': 'refresh_token'
})
gtoken = r.json()['access_token']

DEST_SS = '1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8'
SHEET_NAME = '260401-02'
headers_g = {'Authorization': f'Bearer {gtoken}', 'Content-Type': 'application/json'}

# Outbrainデータ読み込み
with open(f'{base}/ob_processed.json', encoding='utf-8') as f:
    ob = json.load(f)

def fmt_yen(v): return f'¥{v:,.0f}' if v else '¥0'
def fmt_pct(v): return f'{v:.2f}%'
def fmt_num(v): return f'{int(v):,}' if v else '0'
def calc(sp, cl, im, cv):
    cpc = sp/cl if cl else 0
    cpm = sp/im*1000 if im else 0
    ctr = cl/im*100 if im else 0
    cvr = cv/cl*100 if cl else 0
    cpa = sp/cv if cv else 0
    return cpc, cpm, ctr, cvr, cpa

overall = ob['overall']
sp_o = overall.get('spend', 0)
cl_o = overall.get('clicks', 0)
im_o = overall.get('impressions', 0)
cv_o = overall.get('conversions', 0)
cpc_o, cpm_o, ctr_o, cvr_o, cpa_o = calc(sp_o, cl_o, im_o, cv_o)
sp_o_fee = sp_o / 0.8 * 1.1

sep = '-' * 130
rows = []

# タイトル
rows.append(['▼260401-02_数値集計'])
rows.append(['', 'Outbrain'])
rows.append([''])

# 月別進捗
rows.append(['', '◼︎月別進捗'])
rows.append(['', '', '', '', '', '', '', '', '', '管理画面計測', '', '', '貴社計測'])
rows.append(['', '月', '', '', '配信金額', 'CPC', 'Imp', 'Click', 'CTR', 'CV', 'CVR', 'CPA', 'CV', 'CVR', 'CPA', '管理費込みCPA'])
rows.append(['', '合計', '', '', '¥535,236', '¥29.3', '17,847,186', '18,295', '0.10%', '44', '0.24%', '¥12,164', '51', '0.28%', '¥10,495', '¥15,397'])
rows.append(['', '2026年4月', '', '', '¥535,236', '¥29.3', '17,847,186', '18,295', '0.10%', '44', '0.24%', '¥12,164', '51', '0.28%', '¥10,495', '¥15,397', '※記事管理費込み'])
rows.append([''])

# 週別進捗
rows.append(['', '◼︎週別進捗'])
rows.append(['', '', '', '', '', '', '', '', '', '　管理画面計測', '', '', '貴社計測'])
rows.append(['', '週', '', '', '配信金額', 'CPC', 'Imp', 'Click', 'CTR', 'CV', 'CVR', 'CPA', 'CV', 'CVR', 'CPA', '管理費込みCPA'])
rows.append(['', '合計', '', '', '¥562,790', '¥29.1', '18,595,199', '19,348', '0.10%', '52', '0.27%', '¥10,823', '41', '0.21%', '¥13,727', '¥15,130'])
rows.append(['', '3/27', '〜', '4/2', '¥562,790', '¥29.1', '18,595,199', '19,348', '0.10%', '52', '0.27%', '¥10,823', '41', '0.21%', '¥13,727', '¥15,130'])
rows.append([''])

rows.append(['', sep])

# CPN進捗
rows.append(['', '①OB「CPN」数値進捗'])
rows.append([''])
rows.append(['', '期間：4/1〜4/2', '', '', '', '', '', '', '', '　管理画面計測'])
rows.append(['', 'キャンペーン名', '', '配信費(管理費込)', 'CPM', 'CPC', 'IMP', 'CL', 'CTR', 'CV(1Day)', 'CVR', 'CPA'])

for cpn in ob['cpns']:
    sp = cpn.get('spend', 0)
    cl = cpn.get('clicks', 0)
    im = cpn.get('impressions', 0)
    cv = cpn.get('conversions', 0)
    cpc, cpm, ctr, cvr, cpa = calc(sp, cl, im, cv)
    sp_fee = sp / 0.8 * 1.1
    cpa_fee = sp_fee / cv if cv else 0
    name = cpn.get('name', '').strip()
    rows.append(['', name, '', fmt_yen(sp_fee), f'¥{cpm:.2f}', f'¥{cpc:.2f}', fmt_num(im), fmt_num(cl), fmt_pct(ctr), f'{int(cv)}', fmt_pct(cvr), fmt_yen(cpa_fee)])

rows.append(['', '', '合計', fmt_yen(sp_o_fee), f'¥{cpm_o:.2f}', f'¥{cpc_o:.2f}', fmt_num(im_o), fmt_num(cl_o), fmt_pct(ctr_o), f'{int(cv_o)}', fmt_pct(cvr_o), fmt_yen(sp_o_fee/cv_o if cv_o else 0)])
rows.append([''])
rows.append(['', sep])

# CR進捗
rows.append(['', '②OB「CR」数値進捗'])
rows.append([''])

cr_by_cpn = defaultdict(list)
for cr in ob['crs']:
    cr_by_cpn[cr.get('campaignId', '')].append(cr)

for cpn in ob['cpns']:
    cid = cpn['id']
    crs = cr_by_cpn.get(cid, [])
    if not crs:
        continue
    cpn_name = cpn.get('name', '').strip()
    rows.append(['', cpn_name])
    rows.append(['', '期間：4/1〜4/2'])
    rows.append(['', '通し', '画像URL', 'タイトル', '', '', '', '', '配信費(管理費込)', 'CPM', 'CPC', 'IMP', 'CL', 'CTR', 'CV(1Day)', 'CVR', 'CPA'])
    for i, cr in enumerate(crs, 1):
        sp = cr.get('spend', 0)
        cl = cr.get('clicks', 0)
        im = cr.get('impressions', 0)
        cv = cr.get('conversions', 0)
        cpc, cpm, ctr, cvr, cpa = calc(sp, cl, im, cv)
        sp_fee = sp / 0.8 * 1.1
        cpa_fee = sp_fee / cv if cv else 0
        title = cr.get('title', '')
        img_url = cr.get('imageUrl', '')
        rows.append(['', str(i), img_url, title, '', '', '', '', fmt_yen(sp_fee), f'¥{cpm:.2f}', f'¥{cpc:.2f}', fmt_num(im), fmt_num(cl), fmt_pct(ctr), f'{int(cv)}', fmt_pct(cvr), fmt_yen(cpa_fee)])
    rows.append([''])

rows.append(['', sep])

# 掲載面
rows.append(['', '③掲載面'])
rows.append([''])
rows.append(['', '期間：4/1〜4/2'])
rows.append(['', '掲載面', '', '配信費(管理費込)', 'CPM', 'CPC', 'IMP', 'CL', 'CTR', 'CV(1Day)', 'CVR', 'CPA'])

pub_sorted = sorted(ob['pubs'], key=lambda x: -x.get('spend', 0))
for pub in pub_sorted[:15]:
    sp = pub.get('spend', 0)
    cl = pub.get('clicks', 0)
    im = pub.get('impressions', 0)
    cv = pub.get('conversions', 0)
    cpc, cpm, ctr, cvr, cpa = calc(sp, cl, im, cv)
    sp_fee = sp / 0.8 * 1.1
    cpa_fee = sp_fee / cv if cv else 0
    name = pub.get('name', '').strip()
    rows.append(['', name, '', fmt_yen(sp_fee), f'¥{cpm:.2f}', f'¥{cpc:.2f}', fmt_num(im), fmt_num(cl), fmt_pct(ctr), f'{int(cv)}', fmt_pct(cvr), fmt_yen(cpa_fee)])

# 書き込み
body = {
    'valueInputOption': 'USER_ENTERED',
    'data': [{'range': f"'{SHEET_NAME}'!A1", 'majorDimension': 'ROWS', 'values': rows}]
}
resp = requests.post(
    f'https://sheets.googleapis.com/v4/spreadsheets/{DEST_SS}/values:batchUpdate',
    headers=headers_g,
    json=body
)
rdata = resp.json()
if 'totalUpdatedCells' in rdata:
    print(f'書き込み完了: {rdata["totalUpdatedCells"]}セル / {len(rows)}行')
else:
    print('エラー:', json.dumps(rdata, ensure_ascii=False)[:500])
