/**
 * ===============================================
 * Smartnews Ads 数値集計スクリプト
 * スプレッドシート：山忠様案件_数値集計
 * シート：ととのえる（SN）
 * アカウント：株式会社山忠(ケアソク ととのえる)_みらいきれい
 * アカウントID：97065339
 * ===============================================
 *
 * 【初期設定】
 * Apps Script > プロジェクトの設定 > スクリプトプロパティ に以下を追加：
 *   SN_API_KEY  : Smartnews Ads の access_token
 *   ※ アカウントIDはコードに直接埋め込み済み（Script Properties不要）
 *
 * 【コンバージョン設定（埋め込み済み）】
 *   ⑦LP遷移数（W） → viewContent  （詳細ページ数）
 *   ⑨LP遷移数（B） → search       （検索数）
 *   ⑪カート追加   → addToCart     （カート追加数）
 *   ⑬CV数         → purchase      （商品購入数）
 *
 * 【onOpen について】
 * 同一GASプロジェクト内にOBレポートGASが存在する場合は
 * このファイルの onOpen() を削除し、OB側の onOpen() に
 * SNメニュー（addMenu行）を追記してください。
 */

// ================================================
// 定数
// ================================================
// ⚠ v3 API を優先。v1.0 は 2026/6/30 廃止予定
var SN_BASE_URL_TOTONOERU      = 'https://ads.smartnews.com/api/ma/v3';
var SN_BASE_URL_V1_TOTONOERU   = 'https://ads.smartnews.com/api/v1.0';
// アカウントIDは管理画面の値 97065339 と partner_name 12805940 を両方保持
// → debugSnApiTotonoeru() で正しい方を特定すること
var SN_ACCOUNT_ID_TOTONOERU = '97065339';  // 管理画面のアカウントID
var SN_PARTNER_ID_TOTONOERU = '12805940';  // partner_name（こちらがAPIのIDになる場合あり）

var SHEET_NAME_SN_TOTONOERU = 'ととのえる（SN）';

// コンバージョン フィールド名（Smartnews API のフィールド名）
// ⚠ 初回実行後「📋 フィールド名確認」メニューで実測値を検証すること
var SN_LP_WALK_FIELD_TOTONOERU  = 'viewContent'; // 詳細ページ数
var SN_LP_BASIC_FIELD_TOTONOERU = 'search';      // 検索数
var SN_CART_FIELD_TOTONOERU     = 'addToCart';   // カート追加数
var SN_CV_FIELD_TOTONOERU       = 'purchase';    // 商品購入数

// ================================================
// カスタムメニュー
// ※ OBと同一プロジェクトの場合は下記 onOpen() を削除し
//   OB側の onOpen() に .addMenu() で統合すること
// ================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔧 ととのえるSNレポート')
    .addItem('▶ レポート取得実行', 'runSnReportTotonoeru')
    .addSeparator()
    .addItem('🔍 APIデバッグ実行', 'debugSnApiTotonoeru')
    .addItem('📋 フィールド名確認', 'listSnFieldsTotonoeru')
    .addItem('⚙ 設定ガイド', 'showSnSetupGuideTotonoeru')
    .addToUi();
}

// ================================================
// API実行用エントリポイント（外部呼び出し用・UI不使用）
// ================================================
function runSnReportApiTotonoeru(startDate, endDate) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_SN_TOTONOERU);

  if (!sheet) { return { success: false, error: 'ととのえる（SN）シートが見つかりません' }; }

  if (!startDate || !endDate) {
    startDate = formatDateForSnTotonoeru(sheet.getRange('C2').getValue());
    endDate   = formatDateForSnTotonoeru(sheet.getRange('C3').getValue());
  }
  if (!startDate || !endDate) { return { success: false, error: 'C2/C3に日付が設定されていません' }; }

  var apiKey = PropertiesService.getScriptProperties().getProperty('SN_API_KEY');
  if (!apiKey) { return { success: false, error: 'SN_API_KEY が未設定です' }; }

  var cpnData = getSnCampaignReportTotonoeru(apiKey, startDate, endDate);
  var crData  = getSnAdReportTotonoeru(apiKey, startDate, endDate);

  writeToSheetSnTotonoeru(sheet, cpnData, crData, startDate, endDate);
  SpreadsheetApp.flush();

  return { success: true, startDate: startDate, endDate: endDate,
           campaignCount: cpnData.length, crCount: crData.length };
}

// ================================================
// メイン実行（メニューから呼び出し）
// ================================================
function runSnReportTotonoeru() {
  var ui    = SpreadsheetApp.getUi();
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_SN_TOTONOERU);

  if (!sheet) {
    ui.alert('「ととのえる（SN）」シートが見つかりません。');
    return;
  }

  var startVal = sheet.getRange('C2').getValue();
  var endVal   = sheet.getRange('C3').getValue();

  if (!startVal || !endVal) {
    ui.alert('開始日（C2）と終了日（C3）を入力してください。\n例: 2026/04/01');
    return;
  }

  var startDate = formatDateForSnTotonoeru(startVal);
  var endDate   = formatDateForSnTotonoeru(endVal);

  if (!startDate || !endDate) {
    ui.alert('日付の形式が正しくありません。\n例: 2026/04/01');
    return;
  }

  var apiKey = PropertiesService.getScriptProperties().getProperty('SN_API_KEY');
  if (!apiKey) {
    ui.alert(
      '設定が必要です。\n\n' +
      'Apps Script > プロジェクトの設定 > スクリプトプロパティ に以下を設定：\n' +
      '  SN_API_KEY  : Smartnews Ads access_token'
    );
    return;
  }

  Logger.log('SN レポート開始: ' + startDate + ' 〜 ' + endDate);

  var cpnData = getSnCampaignReportTotonoeru(apiKey, startDate, endDate);
  Logger.log('有効CPN数: ' + cpnData.length);

  var crData = getSnAdReportTotonoeru(apiKey, startDate, endDate);
  Logger.log('有効CR数: ' + crData.length);

  writeToSheetSnTotonoeru(sheet, cpnData, crData, startDate, endDate);
  SpreadsheetApp.flush();

  ui.alert(
    'レポート取得完了！\n' +
    'キャンペーン: ' + cpnData.length + '件\n' +
    'クリエイティブ: ' + crData.length + '件'
  );
}

// ================================================
// 日付フォーマット（→ YYYY-MM-DD）
// ================================================
function formatDateForSnTotonoeru(val) {
  if (!val) return null;
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear() + '-'
       + ('0' + (d.getMonth() + 1)).slice(-2) + '-'
       + ('0' + d.getDate()).slice(-2);
}

// ================================================
// Smartnews API 共通フェッチ
// ================================================
function snApiFetchTotonoeru(apiKey, url) {
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'X-Auth-Api': apiKey },
      muteHttpExceptions: true
    });
    Logger.log('SN API [' + url.slice(-80) + '] → ' + res.getResponseCode());
    if (res.getResponseCode() !== 200) {
      Logger.log('Error: ' + res.getContentText().slice(0, 400));
      return null;
    }
    return JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log('SN API 例外: ' + e.toString());
    return null;
  }
}

// ================================================
// キャンペーン別インサイト（CAMPAIGN レベル）
// ================================================
function getSnCampaignReportTotonoeru(apiKey, since, until) {
  var url = SN_BASE_URL_TOTONOERU + '/accounts/' + SN_ACCOUNT_ID_TOTONOERU
          + '/insights?since=' + since + '&until=' + until + '&level=CAMPAIGN';

  var data = snApiFetchTotonoeru(apiKey, url);
  if (!data) return [];

  var results = [];
  (data.data || []).forEach(function (row) {
    var spend  = row.spend       || 0;
    var imp    = row.impressions || 0;
    var clicks = row.clicks      || 0;
    if (spend === 0 && imp === 0 && clicks === 0) return;

    var cpc     = clicks > 0 ? Math.round(spend / clicks)     : 0;
    var cpm     = imp    > 0 ? Math.round(spend / imp * 1000) : 0;
    var lpWalk  = row[SN_LP_WALK_FIELD_TOTONOERU]  || 0;
    var lpBasic = row[SN_LP_BASIC_FIELD_TOTONOERU] || 0;
    var cart    = row[SN_CART_FIELD_TOTONOERU]     || 0;
    var cv      = row[SN_CV_FIELD_TOTONOERU]       || 0;

    Logger.log('CPN: ' + (row.campaignName || row.campaignId)
      + '  spend=' + Math.round(spend)
      + '  W=' + Math.round(lpWalk) + ' B=' + Math.round(lpBasic)
      + '  cart=' + Math.round(cart) + ' cv=' + Math.round(cv));

    results.push({
      campaignId:   row.campaignId   || '',
      campaignName: row.campaignName || row.campaignId || '',
      spend:        Math.round(spend),
      cpc:          cpc,
      cpm:          cpm,
      impressions:  Math.round(imp),
      clicks:       Math.round(clicks),
      lpWalk:       Math.round(lpWalk),
      lpBasic:      Math.round(lpBasic),
      cart:         Math.round(cart),
      cv:           Math.round(cv)
    });
  });

  results.sort(function (a, b) { return b.spend - a.spend; });
  return results;
}

// ================================================
// 広告別インサイト（AD レベル）
// ================================================
function getSnAdReportTotonoeru(apiKey, since, until) {
  var url = SN_BASE_URL_TOTONOERU + '/accounts/' + SN_ACCOUNT_ID_TOTONOERU
          + '/insights?since=' + since + '&until=' + until + '&level=AD';

  var data = snApiFetchTotonoeru(apiKey, url);
  if (!data) return [];

  var results = [];
  (data.data || []).forEach(function (row) {
    var spend  = row.spend       || 0;
    var imp    = row.impressions || 0;
    var clicks = row.clicks      || 0;
    if (spend === 0 && imp === 0 && clicks === 0) return;

    var cpc     = clicks > 0 ? Math.round(spend / clicks)     : 0;
    var cpm     = imp    > 0 ? Math.round(spend / imp * 1000) : 0;
    var lpWalk  = row[SN_LP_WALK_FIELD_TOTONOERU]  || 0;
    var lpBasic = row[SN_LP_BASIC_FIELD_TOTONOERU] || 0;
    var cart    = row[SN_CART_FIELD_TOTONOERU]     || 0;
    var cv      = row[SN_CV_FIELD_TOTONOERU]       || 0;

    results.push({
      campaignId:   row.campaignId   || '',
      campaignName: row.campaignName || row.campaignId || '',
      adId:         row.adId         || '',
      adName:       row.adName       || row.title      || row.adId || '',
      thumbnailUrl: row.thumbnailUrl || row.imageUrl   || '',
      spend:        Math.round(spend),
      cpc:          cpc,
      cpm:          cpm,
      impressions:  Math.round(imp),
      clicks:       Math.round(clicks),
      lpWalk:       Math.round(lpWalk),
      lpBasic:      Math.round(lpBasic),
      cart:         Math.round(cart),
      cv:           Math.round(cv)
    });
  });

  results.sort(function (a, b) { return b.spend - a.spend; });
  return results;
}

// ================================================
// シートへの書き込み
// ================================================
function writeToSheetSnTotonoeru(sheet, cpnData, crData, startDate, endDate) {
  sheet.clearContents();
  sheet.clearFormats();

  var periodStr = startDate + ' 〜 ' + endDate;

  // ── ヘッダー ──
  sheet.getRange('B1').setValue('ととのえる Smartnews 数値集計');
  sheet.getRange('B2').setValue('開始日');
  sheet.getRange('C2').setValue(startDate.replace(/-/g, '/'));
  sheet.getRange('B3').setValue('終了日');
  sheet.getRange('C3').setValue(endDate.replace(/-/g, '/'));
  sheet.getRange('B4').setValue('※ 拡張機能メニュー「SNレポート ▶ レポート取得実行」で任意期間の更新が可能');

  // ── CPN別集計 ──
  var cpnSecRow  = 6;
  var cpnHdrRow  = cpnSecRow + 1;
  var cpnDataRow = cpnHdrRow + 1;

  sheet.getRange('B' + cpnSecRow).setValue('■ CPN別集計\u3000（' + periodStr + '）');

  var cpnHdrs = [
    'CPN名','①配信金額','②CPC','③CPM','④Imp','⑤Click','⑥CTR',
    '⑦LP遷移数(W)','⑧LP遷移率(W)','⑨LP遷移数(B)','⑩LP遷移率(B)',
    '⑪カート追加','⑫カート率','⑬CV数','⑭CVR','⑮LPCVR(W+B)','⑯CPA'
  ];
  sheet.getRange(cpnHdrRow, 2, 1, cpnHdrs.length).setValues([cpnHdrs]);

  if (cpnData.length > 0) {
    var cpnVals = cpnData.map(function (d) {
      var ctr   = d.impressions > 0 ? d.clicks  / d.impressions               : 0;
      var wRate = d.clicks      > 0 ? d.lpWalk  / d.clicks                    : 0;
      var bRate = d.clicks      > 0 ? d.lpBasic / d.clicks                    : 0;
      var cartR = d.clicks      > 0 ? d.cart    / d.clicks                    : 0;
      var cvr   = d.clicks      > 0 ? d.cv      / d.clicks                    : 0;
      var lpcvr = (d.lpWalk + d.lpBasic) > 0 ? d.cv / (d.lpWalk + d.lpBasic) : '';
      var cpa   = d.cv > 0 ? Math.round(d.spend / d.cv) : '';
      return [d.campaignName, d.spend, d.cpc, d.cpm, d.impressions, d.clicks,
              ctr, d.lpWalk, wRate, d.lpBasic, bRate, d.cart, cartR,
              d.cv, cvr, lpcvr, cpa];
    });
    sheet.getRange(cpnDataRow, 2, cpnVals.length, 17).setValues(cpnVals);
    setCpnFormatsSnTotonoeru(sheet, cpnDataRow, cpnVals.length);
  }

  // ── CR別集計 ──
  var crSecRow  = cpnDataRow + Math.max(cpnData.length, 1) + 2;
  var crHdrRow  = crSecRow + 1;
  var crDataRow = crHdrRow + 1;

  sheet.getRange('B' + crSecRow).setValue('■ CR別集計\u3000（' + periodStr + '）');

  var crHdrs = [
    'CPN名','CR画像','CRタイトル','①配信金額','②CPC','③CPM','④Imp','⑤Click','⑥CTR',
    '⑦LP遷移数(W)','⑧LP遷移率(W)','⑨LP遷移数(B)','⑩LP遷移率(B)',
    '⑪カート追加','⑫カート率','⑬CV数','⑭CVR','⑮LPCVR(W+B)','⑯CPA'
  ];
  sheet.getRange(crHdrRow, 2, 1, crHdrs.length).setValues([crHdrs]);

  if (crData.length > 0) {
    var crVals = crData.map(function (d) {
      var ctr   = d.impressions > 0 ? d.clicks  / d.impressions               : 0;
      var wRate = d.clicks      > 0 ? d.lpWalk  / d.clicks                    : 0;
      var bRate = d.clicks      > 0 ? d.lpBasic / d.clicks                    : 0;
      var cartR = d.clicks      > 0 ? d.cart    / d.clicks                    : 0;
      var cvr   = d.clicks      > 0 ? d.cv      / d.clicks                    : 0;
      var lpcvr = (d.lpWalk + d.lpBasic) > 0 ? d.cv / (d.lpWalk + d.lpBasic) : '';
      var cpa   = d.cv > 0 ? Math.round(d.spend / d.cv) : '';
      var img   = d.thumbnailUrl ? '=IMAGE("' + d.thumbnailUrl + '",1)' : '';
      return [d.campaignName, img, d.adName,
              d.spend, d.cpc, d.cpm, d.impressions, d.clicks, ctr,
              d.lpWalk, wRate, d.lpBasic, bRate, d.cart, cartR,
              d.cv, cvr, lpcvr, cpa];
    });
    sheet.getRange(crDataRow, 2, crVals.length, 19).setValues(crVals);
    setCrFormatsSnTotonoeru(sheet, crDataRow, crVals.length);
  }
}

// ================================================
// 数値フォーマット（CPN別）
// B=2(CPN名) C=3(spend) D=4(cpc) E=5(cpm) F=6(imp) G=7(click) H=8(ctr)
// I=9(lpW) J=10(wRate) K=11(lpB) L=12(bRate) M=13(cart) N=14(cartR)
// O=15(cv) P=16(cvr) Q=17(lpcvr) R=18(cpa)
// ================================================
function setCpnFormatsSnTotonoeru(sheet, startRow, count) {
  if (count === 0) return;
  sheet.getRange(startRow,  3, count, 1).setNumberFormat('¥#,##0');  // 配信金額
  sheet.getRange(startRow,  4, count, 1).setNumberFormat('0.0');      // CPC
  sheet.getRange(startRow,  5, count, 1).setNumberFormat('0.0');      // CPM
  sheet.getRange(startRow,  6, count, 1).setNumberFormat('#,##0');    // Imp
  sheet.getRange(startRow,  7, count, 1).setNumberFormat('#,##0');    // Click
  sheet.getRange(startRow,  8, count, 1).setNumberFormat('0.00%');    // CTR
  sheet.getRange(startRow,  9, count, 1).setNumberFormat('#,##0');    // LP遷移数(W)
  sheet.getRange(startRow, 10, count, 1).setNumberFormat('0.00%');    // LP遷移率(W)
  sheet.getRange(startRow, 11, count, 1).setNumberFormat('#,##0');    // LP遷移数(B)
  sheet.getRange(startRow, 12, count, 1).setNumberFormat('0.00%');    // LP遷移率(B)
  sheet.getRange(startRow, 13, count, 1).setNumberFormat('#,##0');    // カート追加
  sheet.getRange(startRow, 14, count, 1).setNumberFormat('0.00%');    // カート率
  sheet.getRange(startRow, 15, count, 1).setNumberFormat('#,##0');    // CV数
  sheet.getRange(startRow, 16, count, 1).setNumberFormat('0.00%');    // CVR
  sheet.getRange(startRow, 17, count, 1).setNumberFormat('0.00%');    // LPCVR
  sheet.getRange(startRow, 18, count, 1).setNumberFormat('¥#,##0');  // CPA
}

// ================================================
// 数値フォーマット（CR別）
// B=2(CPN) C=3(img) D=4(title) E=5(spend) F=6(cpc) G=7(cpm)
// H=8(imp) I=9(click) J=10(ctr)
// K=11(lpW) L=12(wRate) M=13(lpB) N=14(bRate) O=15(cart) P=16(cartR)
// Q=17(cv) R=18(cvr) S=19(lpcvr) T=20(cpa)
// ================================================
function setCrFormatsSnTotonoeru(sheet, startRow, count) {
  if (count === 0) return;
  sheet.getRange(startRow,  5, count, 1).setNumberFormat('¥#,##0');  // 配信金額
  sheet.getRange(startRow,  6, count, 1).setNumberFormat('0.0');      // CPC
  sheet.getRange(startRow,  7, count, 1).setNumberFormat('0.0');      // CPM
  sheet.getRange(startRow,  8, count, 1).setNumberFormat('#,##0');    // Imp
  sheet.getRange(startRow,  9, count, 1).setNumberFormat('#,##0');    // Click
  sheet.getRange(startRow, 10, count, 1).setNumberFormat('0.00%');    // CTR
  sheet.getRange(startRow, 11, count, 1).setNumberFormat('#,##0');    // LP遷移数(W)
  sheet.getRange(startRow, 12, count, 1).setNumberFormat('0.00%');    // LP遷移率(W)
  sheet.getRange(startRow, 13, count, 1).setNumberFormat('#,##0');    // LP遷移数(B)
  sheet.getRange(startRow, 14, count, 1).setNumberFormat('0.00%');    // LP遷移率(B)
  sheet.getRange(startRow, 15, count, 1).setNumberFormat('#,##0');    // カート追加
  sheet.getRange(startRow, 16, count, 1).setNumberFormat('0.00%');    // カート率
  sheet.getRange(startRow, 17, count, 1).setNumberFormat('#,##0');    // CV数
  sheet.getRange(startRow, 18, count, 1).setNumberFormat('0.00%');    // CVR
  sheet.getRange(startRow, 19, count, 1).setNumberFormat('0.00%');    // LPCVR
  sheet.getRange(startRow, 20, count, 1).setNumberFormat('¥#,##0');  // CPA
}

// ================================================
// デバッグ：認証・エンドポイントの総当たり確認
// 401 が出たときにまず実行する
// ================================================
function debugSnApiTotonoeru() {
  var ui     = SpreadsheetApp.getUi();
  var apiKey = PropertiesService.getScriptProperties().getProperty('SN_API_KEY');
  if (!apiKey) { ui.alert('SN_API_KEY が未設定です。'); return; }

  // 試すパターン：
  //   account ID × 2（97065339 / 12805940）
  //   API base    × 2（v1.0 / v3）
  //   auth header × 2（X-Auth-Api / Authorization: Bearer）
  var accountIds = [SN_ACCOUNT_ID_TOTONOERU, SN_PARTNER_ID_TOTONOERU];
  var bases      = [
    { label: 'v1.0', url: SN_BASE_URL_V1_TOTONOERU },
    { label: 'v3',   url: SN_BASE_URL_TOTONOERU }
  ];
  var headers    = [
    { label: 'X-Auth-Api',        h: { 'X-Auth-Api': apiKey } },
    { label: 'Bearer',            h: { 'Authorization': 'Bearer ' + apiKey } }
  ];

  // v3 は accounts エンドポイントが /ad_accounts
  var paths = {
    'v1.0': { accounts: '/accounts', campaigns: '/campaigns', insights: '/insights' },
    'v3':   { accounts: '/ad_accounts', campaigns: '/campaigns', insights: '/insights' }
  };

  Logger.log('=== SN API 認証デバッグ開始 ===');

  var found = null;
  bases.forEach(function (base) {
    headers.forEach(function (hdr) {
      accountIds.forEach(function (acctId) {
        var url = base.url + paths[base.label].accounts + '/' + acctId
                + paths[base.label].campaigns;
        try {
          var res = UrlFetchApp.fetch(url, {
            method: 'get',
            headers: hdr.h,
            muteHttpExceptions: true
          });
          var code = res.getResponseCode();
          var body = res.getContentText().slice(0, 300);
          Logger.log('[' + base.label + '] [' + hdr.label + '] acct=' + acctId
                    + ' → HTTP ' + code + ' ' + body);
          if (code === 200 && !found) {
            found = { base: base.label, hdr: hdr.label, acct: acctId, url: url };
          }
        } catch (e) {
          Logger.log('例外: ' + e.toString());
        }
      });
    });
  });

  if (found) {
    Logger.log('✅ 成功した組み合わせ: base=' + found.base
      + '  auth=' + found.hdr + '  acctId=' + found.acct);
    ui.alert('✅ 認証成功！\n\n'
      + 'API base : ' + found.base + '\n'
      + '認証方式 : ' + found.hdr + '\n'
      + 'アカウントID : ' + found.acct + '\n\n'
      + 'ログに詳細を出力しました。\n'
      + 'この組み合わせでコードの定数を更新してください。');
  } else {
    ui.alert('❌ 全パターンで 401/403。\n\n'
      + '可能性：\n'
      + '1) このトークンは Conversion API 用で\n'
      + '   Marketing API（レポート取得）には使えない\n'
      + '2) 管理画面 > Developer Apps > API Key から\n'
      + '   Marketing API 用のキーを別途発行する必要あり\n\n'
      + 'ログで全レスポンスを確認してください。');
  }
}

// ================================================
// 認証成功後：コードに正しい定数を反映するための確認関数
// debugSnApiTotonoeru() で成功した base/acct を確認後に実行
// ================================================
function debugSnInsightsTotonoeru() {
  var ui     = SpreadsheetApp.getUi();
  var apiKey = PropertiesService.getScriptProperties().getProperty('SN_API_KEY');
  if (!apiKey) { ui.alert('SN_API_KEY が未設定です。'); return; }

  // ↓ デバッグで判明した正しい組み合わせを手動で指定
  var acctId  = SN_ACCOUNT_ID_TOTONOERU; // または SN_PARTNER_ID_TOTONOERU
  var baseUrl = SN_BASE_URL_TOTONOERU;   // または SN_BASE_URL_V1_TOTONOERU
  var hdr     = { 'X-Auth-Api': apiKey }; // または { 'Authorization': 'Bearer ' + apiKey }

  var url = baseUrl + '/ad_accounts/' + acctId
          + '/insights?since=2026-04-01&until=2026-04-07&level=CAMPAIGN';
  var res = UrlFetchApp.fetch(url, { method: 'get', headers: hdr, muteHttpExceptions: true });
  Logger.log('インサイト → HTTP ' + res.getResponseCode());
  Logger.log(res.getContentText().slice(0, 5000));
  ui.alert('ログを確認してください。');
}

// ================================================
// フィールド名確認（コンバージョン設定の検証）
// ================================================
function listSnFieldsTotonoeru() {
  var ui    = SpreadsheetApp.getUi();
  var apiKey = PropertiesService.getScriptProperties().getProperty('SN_API_KEY');
  if (!apiKey) { ui.alert('SN_API_KEY が未設定です。'); return; }

  var data = snApiFetchTotonoeru(apiKey,
    SN_BASE_URL_TOTONOERU + '/accounts/' + SN_ACCOUNT_ID_TOTONOERU
    + '/insights?since=2026-04-01&until=2026-04-07&level=CAMPAIGN');

  if (!data || !data.data || data.data.length === 0) {
    Logger.log('レスポンス: ' + JSON.stringify(data));
    ui.alert('データが取得できませんでした。ログを確認してください。');
    return;
  }

  var sample = data.data[0];
  var keys   = Object.keys(sample);
  Logger.log('=== 利用可能フィールド ===');
  keys.forEach(function (k) { Logger.log(k + ': ' + JSON.stringify(sample[k])); });

  var msg = '【取得データのフィールド一覧（1件目）】\n\n';
  keys.forEach(function (k) { msg += '  ' + k + ': ' + sample[k] + '\n'; });
  msg += '\n━━ 現在のコンバージョン設定 ━━\n';
  msg += '  ⑦LP遷移数(W)  → ' + SN_LP_WALK_FIELD_TOTONOERU  + '\n';
  msg += '  ⑨LP遷移数(B)  → ' + SN_LP_BASIC_FIELD_TOTONOERU + '\n';
  msg += '  ⑪カート追加   → ' + SN_CART_FIELD_TOTONOERU     + '\n';
  msg += '  ⑬CV数         → ' + SN_CV_FIELD_TOTONOERU       + '\n';
  msg += '\nフィールド名がずれている場合はコード冒頭の定数を修正してください。';
  ui.alert(msg);
}

// ================================================
// 設定ガイド
// ================================================
function showSnSetupGuideTotonoeru() {
  var html = HtmlService.createHtmlOutput(
    '<style>body{font-family:sans-serif;font-size:13px;padding:16px;line-height:1.6}'
    + 'h2{color:#1a73e8}code{background:#f1f3f4;padding:2px 6px;border-radius:3px}'
    + 'table{border-collapse:collapse;width:100%;margin:8px 0}'
    + 'td,th{border:1px solid #ddd;padding:6px 10px}th{background:#f1f3f4}</style>'
    + '<h2>🔧 ととのえる Smartnews レポート 設定ガイド</h2>'
    + '<h3>① Script Properties に設定</h3>'
    + '<table><tr><th>プロパティ名</th><th>値</th></tr>'
    + '<tr><td><code>SN_API_KEY</code></td><td>Smartnews Ads の access_token</td></tr>'
    + '</table>'
    + '<h3>② シート設定</h3>'
    + '<p>「ととのえる（SN）」シートの <strong>C2</strong> に開始日、<strong>C3</strong> に終了日を入力（例: 2026/04/01）</p>'
    + '<h3>③ 埋め込み済み情報</h3>'
    + '<table><tr><th>項目</th><th>値</th></tr>'
    + '<tr><td>アカウントID</td><td><code>' + SN_ACCOUNT_ID_TOTONOERU + '</code></td></tr>'
    + '<tr><td>パートナーID</td><td><code>' + SN_PARTNER_ID_TOTONOERU + '</code></td></tr>'
    + '</table>'
    + '<h3>④ コンバージョン設定（埋め込み済み）</h3>'
    + '<table><tr><th>列</th><th>ラベル</th><th>APIフィールド名</th></tr>'
    + '<tr><td>I列</td><td>⑦LP遷移数(W) 詳細ページ数</td><td><code>' + SN_LP_WALK_FIELD_TOTONOERU  + '</code></td></tr>'
    + '<tr><td>K列</td><td>⑨LP遷移数(B) 検索数</td><td><code>'      + SN_LP_BASIC_FIELD_TOTONOERU + '</code></td></tr>'
    + '<tr><td>M列</td><td>⑪カート追加</td><td><code>'               + SN_CART_FIELD_TOTONOERU     + '</code></td></tr>'
    + '<tr><td>O列</td><td>⑬CV数 商品購入数</td><td><code>'          + SN_CV_FIELD_TOTONOERU       + '</code></td></tr>'
    + '</table>'
    + '<p>⚠ 初回実行後「📋 フィールド名確認」メニューで実際のフィールド名を検証し、ずれていればコード冒頭の定数を修正してください。</p>'
  ).setWidth(620).setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, '⚙ Smartnews レポート設定ガイド');
}
