import requests, sys, io, json
from _credentials import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Googleトークン取得
r = requests.post('https://oauth2.googleapis.com/token', data={
    'client_id': GOOGLE_CLIENT_ID,
    'client_secret': GOOGLE_CLIENT_SECRET,
    'refresh_token': GOOGLE_REFRESH_TOKEN,
    'grant_type': 'refresh_token'
})
gtoken = r.json()['access_token']
hg = {'Authorization': f'Bearer {gtoken}', 'Content-Type': 'application/json'}

DEST_SS = '1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8'
SHEET_ID = 105621084

# ============================================================
# 行レイアウト（build_report_v2.pyと対応）
# ============================================================
# 1:  タイトル ▼260401-02
# 2:  Outbrain
# 3:  ◼︎月別進捗（セクションヘッダー）
# 4:  サブヘッダー（管理画面計測/貴社計測）
# 5:  列ヘッダー
# 6-30: 月別データ（25行: 合計+24ヶ月）
# 31: 空
# 32: ◼︎週別進捗
# 33: サブヘッダー
# 34: 列ヘッダー
# 35-54: 週別データ（20行: 合計+19週）
# 55: 空
# 56: 〈全体サマリー〉
# 57-65: 空 (9行)
# 66: 空（セパレータ）
# 67: 〈CPN構成〉
# 68: 列ヘッダー
# 69-77: CPN構成データ（9行）
# 78: 空
# 79: 空（セパレータ）
# 80: ①OB「CPN」数値進捗
# 81: 空
# 82: 期間ラベル
# 83: 列ヘッダー
# 84-92: CPNデータ（9行）
# 93: CPN合計
# 94: 空
# 95: 空（セパレータ）
# 96: ②OB「CR」数値進捗
# 97: 空
# --- CR sections（7 CPNs with CRs） ---
# 98-103:  【067】1CR → header(3) + 1data + 合計 + 空
# 104-111: 【073】3CR → header(3) + 3data + 合計 + 空
# 112-117: 【066】1CR → header(3) + 1data + 合計 + 空
# 118-123: 【068】1CR → header(3) + 1data + 合計 + 空
# 124-130: 【074】2CR → header(3) + 2data + 合計 + 空
# 131-136: 【069】1CR → header(3) + 1data + 合計 + 空
# 137-142: 【071】1CR → header(3) + 1data + 合計 + 空
# 143: 空（セパレータ）
# 144: 〈コメント〉掲載面
# 145-148: 空 (4行)
# 149: 空（セパレータ）
# 150: ④記事検証進捗
# 151: 期間
# 152: 空
# 153: 列ヘッダー
# 154-155: 空
# 156: 空（セパレータ）
# 157: ⑤今後の動き
# 158-162: 空

def rgb(r_val, g_val, b_val):
    return {'red': r_val/255, 'green': g_val/255, 'blue': b_val/255}

# カラーパレット
C_TITLE_BG   = rgb(30, 30, 30)     # ほぼ黒（タイトル背景）
C_TITLE_FG   = rgb(255, 255, 255)  # 白文字
C_SECTION_BG = rgb(50, 50, 50)     # 濃いグレー（セクションヘッダー）
C_SECTION_FG = rgb(255, 255, 255)  # 白文字
C_SUBHDR_BG  = rgb(80, 80, 80)     # 中グレー（サブヘッダー）
C_SUBHDR_FG  = rgb(255, 255, 255)  # 白文字
C_COLHDR_BG  = rgb(150, 150, 150)  # 薄グレー（列ヘッダー）
C_COLHDR_FG  = rgb(255, 255, 255)  # 白文字
C_TOTAL_BG   = rgb(220, 220, 220)  # 非常に薄いグレー（合計行）
C_CPN_BG     = rgb(70, 90, 110)    # CPN名行（青みがかったグレー）
C_CPN_FG     = rgb(255, 255, 255)
C_CRHDR_BG   = rgb(120, 140, 160)  # CR列ヘッダー
C_CRHDR_FG   = rgb(255, 255, 255)
C_PERIOD_BG  = rgb(200, 210, 220)  # 期間ラベル行
C_WHITE      = rgb(255, 255, 255)

def cell_range(start_row, end_row, start_col=0, end_col=21):
    """0-indexed, endRowIndex/endColumnIndex は exclusive"""
    return {
        'sheetId': SHEET_ID,
        'startRowIndex': start_row - 1,
        'endRowIndex': end_row,
        'startColumnIndex': start_col,
        'endColumnIndex': end_col
    }

def make_format_req(start_row, end_row, bg=None, fg=None, bold=False,
                    font_size=10, halign=None, start_col=0, end_col=21):
    fmt = {}
    if bg:
        fmt['backgroundColor'] = bg
    if fg:
        fmt['textFormat'] = {'foregroundColor': fg, 'bold': bold, 'fontSize': font_size}
    else:
        fmt['textFormat'] = {'bold': bold, 'fontSize': font_size}
    if halign:
        fmt['horizontalAlignment'] = halign

    fields = []
    if bg: fields.append('userEnteredFormat.backgroundColor')
    fields.append('userEnteredFormat.textFormat.bold')
    fields.append('userEnteredFormat.textFormat.fontSize')
    if fg: fields.append('userEnteredFormat.textFormat.foregroundColor')
    if halign: fields.append('userEnteredFormat.horizontalAlignment')

    return {
        'repeatCell': {
            'range': cell_range(start_row, end_row, start_col, end_col),
            'cell': {'userEnteredFormat': fmt},
            'fields': ','.join(fields)
        }
    }

def make_row_height_req(start_row, end_row, pixel_size):
    return {
        'updateDimensionProperties': {
            'range': {
                'sheetId': SHEET_ID,
                'dimension': 'ROWS',
                'startIndex': start_row - 1,
                'endIndex': end_row
            },
            'properties': {'pixelSize': pixel_size},
            'fields': 'pixelSize'
        }
    }

def make_col_width_req(col_idx, pixel_size):
    return {
        'updateDimensionProperties': {
            'range': {
                'sheetId': SHEET_ID,
                'dimension': 'COLUMNS',
                'startIndex': col_idx,
                'endIndex': col_idx + 1
            },
            'properties': {'pixelSize': pixel_size},
            'fields': 'pixelSize'
        }
    }

def make_freeze_req(row_count=0, col_count=0):
    return {
        'updateSheetProperties': {
            'properties': {
                'sheetId': SHEET_ID,
                'gridProperties': {'frozenRowCount': row_count, 'frozenColumnCount': col_count}
            },
            'fields': 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'
        }
    }

requests_list = []

# ============================================================
# 行の高さ設定
# ============================================================
# デフォルト全行を21pxに
requests_list.append(make_row_height_req(1, 162, 21))

# CR画像行を90pxに（画像表示用）
# 【067】: row 101
# 【073】: rows 107, 108, 109
# 【066】: row 115
# 【068】: row 121
# 【074】: rows 127, 128
# 【069】: row 134
# 【071】: row 140
cr_image_rows = [101, 107, 108, 109, 115, 121, 127, 128, 134, 140]
for row in cr_image_rows:
    requests_list.append(make_row_height_req(row, row, 90))

# セクションヘッダー行を30pxに
section_header_rows = [1, 3, 32, 56, 67, 80, 96, 144, 150, 157]
for row in section_header_rows:
    requests_list.append(make_row_height_req(row, row, 30))

# ============================================================
# 列幅設定
# ============================================================
# A列（画像URL）: 200px
requests_list.append(make_col_width_req(0, 200))
# B列（ラベル/番号）: 60px
requests_list.append(make_col_width_req(1, 60))
# C列（画像）: 120px
requests_list.append(make_col_width_req(2, 120))
# D列（タイトル/CPN名）: 350px
requests_list.append(make_col_width_req(3, 350))
# E-U列: 100px
for col in range(4, 21):
    requests_list.append(make_col_width_req(col, 100))

# ============================================================
# 全体のベースフォーマット（白背景、通常フォント）
# ============================================================
requests_list.append(make_format_req(1, 162, bg=C_WHITE, font_size=10))

# ============================================================
# タイトル行（Row 1）: 大きく太字、黒背景白文字
# ============================================================
requests_list.append(make_format_req(1, 1, bg=C_TITLE_BG, fg=C_TITLE_FG, bold=True, font_size=12))

# Row 2（Outbrain）: 濃いグレー背景
requests_list.append(make_format_req(2, 2, bg=C_SECTION_BG, fg=C_SECTION_FG, bold=True, font_size=10))

# ============================================================
# 月別進捗セクション（Row 3-5）
# ============================================================
# Row 3: ◼︎月別進捗
requests_list.append(make_format_req(3, 3, bg=C_SECTION_BG, fg=C_SECTION_FG, bold=True, font_size=10))
# Row 4: サブヘッダー
requests_list.append(make_format_req(4, 4, bg=C_SUBHDR_BG, fg=C_SUBHDR_FG, bold=True, font_size=9))
# Row 5: 列ヘッダー
requests_list.append(make_format_req(5, 5, bg=C_COLHDR_BG, fg=C_COLHDR_FG, bold=True, font_size=9))
# Row 6（合計行）: 太字
requests_list.append(make_format_req(6, 6, bg=C_TOTAL_BG, bold=True, font_size=10))

# ============================================================
# 週別進捗セクション（Row 32-34）
# ============================================================
requests_list.append(make_format_req(32, 32, bg=C_SECTION_BG, fg=C_SECTION_FG, bold=True, font_size=10))
requests_list.append(make_format_req(33, 33, bg=C_SUBHDR_BG, fg=C_SUBHDR_FG, bold=True, font_size=9))
requests_list.append(make_format_req(34, 34, bg=C_COLHDR_BG, fg=C_COLHDR_FG, bold=True, font_size=9))
# Row 35（合計行）
requests_list.append(make_format_req(35, 35, bg=C_TOTAL_BG, bold=True, font_size=10))

# ============================================================
# 全体サマリー（Row 56）
# ============================================================
requests_list.append(make_format_req(56, 56, bg=C_SECTION_BG, fg=C_SECTION_FG, bold=True, font_size=10))

# ============================================================
# CPN構成（Row 67-68）
# ============================================================
requests_list.append(make_format_req(67, 67, bg=C_SECTION_BG, fg=C_SECTION_FG, bold=True, font_size=10))
requests_list.append(make_format_req(68, 68, bg=C_COLHDR_BG, fg=C_COLHDR_FG, bold=True, font_size=9))

# ============================================================
# ①CPN数値進捗（Row 80, 82-83, 93）
# ============================================================
requests_list.append(make_format_req(80, 80, bg=C_SECTION_BG, fg=C_SECTION_FG, bold=True, font_size=10))
requests_list.append(make_format_req(82, 82, bg=C_PERIOD_BG, bold=False, font_size=9))
requests_list.append(make_format_req(83, 83, bg=C_COLHDR_BG, fg=C_COLHDR_FG, bold=True, font_size=9))
requests_list.append(make_format_req(93, 93, bg=C_TOTAL_BG, bold=True, font_size=10))

# ============================================================
# ②CR数値進捗（Row 96）
# ============================================================
requests_list.append(make_format_req(96, 96, bg=C_SECTION_BG, fg=C_SECTION_FG, bold=True, font_size=10))

# CR各グループのフォーマット
cr_groups = [
    # (CPN名行, 期間行, HDR行, データ開始行, データ終了行, 合計行)
    (98,  99,  100, 101, 101, 102),  # 【067】1CR
    (104, 105, 106, 107, 109, 110),  # 【073】3CR
    (112, 113, 114, 115, 115, 116),  # 【066】1CR
    (118, 119, 120, 121, 121, 122),  # 【068】1CR
    (124, 125, 126, 127, 128, 129),  # 【074】2CR
    (131, 132, 133, 134, 134, 135),  # 【069】1CR
    (137, 138, 139, 140, 140, 141),  # 【071】1CR
]

for cpn_row, period_row, hdr_row, data_start, data_end, total_row in cr_groups:
    # CPN名行
    requests_list.append(make_format_req(cpn_row, cpn_row, bg=C_CPN_BG, fg=C_CPN_FG, bold=True, font_size=10))
    # 期間行
    requests_list.append(make_format_req(period_row, period_row, bg=C_PERIOD_BG, font_size=9))
    # CR列ヘッダー
    requests_list.append(make_format_req(hdr_row, hdr_row, bg=C_CRHDR_BG, fg=C_CRHDR_FG, bold=True, font_size=9))
    # 合計行
    requests_list.append(make_format_req(total_row, total_row, bg=C_TOTAL_BG, bold=True, font_size=10))

# ============================================================
# 掲載面コメント・記事検証・今後の動き
# ============================================================
requests_list.append(make_format_req(144, 144, bg=C_SECTION_BG, fg=C_SECTION_FG, bold=True, font_size=10))
requests_list.append(make_format_req(150, 150, bg=C_SECTION_BG, fg=C_SECTION_FG, bold=True, font_size=10))
requests_list.append(make_format_req(153, 153, bg=C_COLHDR_BG, fg=C_COLHDR_FG, bold=True, font_size=9))
requests_list.append(make_format_req(157, 157, bg=C_SECTION_BG, fg=C_SECTION_FG, bold=True, font_size=10))

# ============================================================
# フリーズ（Row 1をフリーズ）
# ============================================================
requests_list.append(make_freeze_req(row_count=1))

# ============================================================
# batchUpdate実行
# ============================================================
print(f'フォーマット適用リクエスト数: {len(requests_list)}')

resp = requests.post(
    f'https://sheets.googleapis.com/v4/spreadsheets/{DEST_SS}:batchUpdate',
    headers=hg,
    json={'requests': requests_list}
)
rdata = resp.json()
if 'replies' in rdata:
    print(f'フォーマット完了: {len(rdata["replies"])}件')
else:
    print('エラー:', json.dumps(rdata, ensure_ascii=False)[:300])
