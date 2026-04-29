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
 *   SN_CLIENT_ID     : SmartNews Ads の client_id
 *   SN_CLIENT_SECRET : SmartNews Ads の client_secret
 *
 * 【コンバージョン設定（埋め込み済み）】
 *   ⑦LP遷移数（W） → viewContent  （詳細ページ数）
 *   ⑨LP遷移数（B） → search       （検索数）
 *   ⑪カート追加   → addToCart     （カート追加数）
 *   ⑬CV数         → purchase      （商品購入数）
 */

// ================================================
// ★ まずこれを実行 → OAuth2 client_credentials でトークン取得テスト
// ================================================
function testSnApi() {
  var props        = PropertiesService.getScriptProperties();
  var clientId     = props.getProperty('SN_CLIENT_ID');
  var clientSecret = props.getProperty('SN_CLIENT_SECRET');

  if (!clientId)     { Logger.log('❌ SN_CLIENT_ID が未設定です'); return; }
  if (!clientSecret) { Logger.log('❌ SN_CLIENT_SECRET が未設定です'); return; }

  Logger.log('SN_CLIENT_ID: ' + clientId.slice(0, 8) + '...');

  // 正式トークンエンドポイント（SmartNews Marketing API v1）
  var tokenEndpoints = [
    'https://ads.smartnews.com/api/oauth/v1/access_tokens',
    'https://ads.smartnews.com/auth/token',
    'https://ads.smartnews.com/api/v1.0/oauth/token'
  ];

  var accessToken     = null;
  var successEndpoint = null;

  // パターン1: form POST（標準OAuth2）
  Logger.log('--- [パターン1] form POST ---');
  tokenEndpoints.forEach(function(ep) {
    if (accessToken) return;
    try {
      var res = UrlFetchApp.fetch(ep, {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: 'grant_type=client_credentials'
               + '&client_id='     + encodeURIComponent(clientId)
               + '&client_secret=' + encodeURIComponent(clientSecret),
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      Logger.log('[form] ' + ep + ' → HTTP ' + code + ' | ' + res.getContentText().slice(0, 300));
      if (code === 200) {
        var j = JSON.parse(res.getContentText());
        accessToken     = j.access_token || j.token || j.accessToken;
        successEndpoint = 'form: ' + ep;
      }
    } catch(e) { Logger.log('[form] ' + ep + ' → 例外: ' + e); }
  });

  // パターン2: Basic Auth ヘッダー + form POST
  if (!accessToken) {
    Logger.log('--- [パターン2] Basic Auth + form POST ---');
    var basic = Utilities.base64Encode(clientId + ':' + clientSecret);
    tokenEndpoints.forEach(function(ep) {
      if (accessToken) return;
      try {
        var res = UrlFetchApp.fetch(ep, {
          method: 'post',
          contentType: 'application/x-www-form-urlencoded',
          headers: { 'Authorization': 'Basic ' + basic },
          payload: 'grant_type=client_credentials',
          muteHttpExceptions: true
        });
        var code = res.getResponseCode();
        Logger.log('[basic] ' + ep + ' → HTTP ' + code + ' | ' + res.getContentText().slice(0, 300));
        if (code === 200) {
          var j = JSON.parse(res.getContentText());
          accessToken     = j.access_token || j.token || j.accessToken;
          successEndpoint = 'basic: ' + ep;
        }
      } catch(e) { Logger.log('[basic] ' + ep + ' → 例外: ' + e); }
    });
  }

  // パターン3: JSON POST
  if (!accessToken) {
    Logger.log('--- [パターン3] JSON POST ---');
    tokenEndpoints.forEach(function(ep) {
      if (accessToken) return;
      try {
        var res = UrlFetchApp.fetch(ep, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
          muteHttpExceptions: true
        });
        var code = res.getResponseCode();
        Logger.log('[json] ' + ep + ' → HTTP ' + code + ' | ' + res.getContentText().slice(0, 300));
        if (code === 200) {
          var j = JSON.parse(res.getContentText());
          accessToken     = j.access_token || j.token || j.accessToken;
          successEndpoint = 'json: ' + ep;
        }
      } catch(e) { Logger.log('[json] ' + ep + ' → 例外: ' + e); }
    });
  }

  if (!accessToken) {
    Logger.log('❌ トークン取得失敗 — 全エンドポイントで 4xx');
    Logger.log('=== テスト完了 ===');
    return;
  }

  Logger.log('✅ トークン取得成功！ endpoint=' + successEndpoint);
  Logger.log('token preview: ' + accessToken.slice(0, 16) + '...');

  // 取得したトークンでAPIテスト
  Logger.log('--- APIテスト ---');
  [
    { label: '[v3 + Bearer + 97065339]',
      url: 'https://ads.smartnews.com/api/ma/v3/ad_accounts/97065339/campaigns',
      h: { 'Authorization': 'Bearer ' + accessToken } },
    { label: '[v3 + X-Auth-Api + 97065339]',
      url: 'https://ads.smartnews.com/api/ma/v3/ad_accounts/97065339/campaigns',
      h: { 'X-Auth-Api': accessToken } },
    { label: '[v1.0 + Bearer + 97065339]',
      url: 'https://ads.smartnews.com/api/v1.0/accounts/97065339/campaigns',
      h: { 'Authorization': 'Bearer ' + accessToken } }
  ].forEach(function(t) {
    try {
      var res = UrlFetchApp.fetch(t.url, { method: 'get', headers: t.h, muteHttpExceptions: true });
      Logger.log(t.label + ' → HTTP ' + res.getResponseCode() + ' | ' + res.getContentText().slice(0, 200));
    } catch(e) { Logger.log(t.label + ' → 例外: ' + e); }
  });

  Logger.log('=== テスト完了 ===');
}

// ================================================
// ★ パラメータ形式の総当たりテスト
// ================================================
function debugInsightsParams() {
  var apiKey;
  try { apiKey = getSnAccessTokenTotonoeru(); }
  catch(e) { Logger.log('トークン取得失敗: ' + e.message); return; }

  var base = 'https://ads.smartnews.com/api/ma/v3/ad_accounts/97065339/insights/campaigns';
  var f    = '&fields=campaignId,spend';

  var patterns = [
    // 日付形式の違い
    base + '?since=2026-04-01&until=2026-04-07' + f,
    base + '?since=2026-04-01T00:00:00%2B09:00&until=2026-04-07T23:59:59%2B09:00' + f,
    base + '?since=2026-04-01T00:00:00&until=2026-04-07T23:59:59' + f,
    // パラメータ名の違い
    base + '?start_date=2026-04-01&end_date=2026-04-07' + f,
    base + '?from=2026-04-01&to=2026-04-07' + f,
    base + '?date_from=2026-04-01&date_to=2026-04-07' + f,
    // granularity追加
    base + '?since=2026-04-01T00:00:00Z&until=2026-04-07T23:59:59Z&granularity=TOTAL' + f,
    base + '?since=2026-04-01&until=2026-04-07&granularity=TOTAL' + f,
    // fieldなし（何が必須か確認）
    base + '?since=2026-04-01T00:00:00Z&until=2026-04-07T23:59:59Z',
    base + '?since=2026-04-01&until=2026-04-07',
  ];

  patterns.forEach(function(url, i) {
    try {
      var res  = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'Authorization': 'Bearer ' + apiKey },
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      var body = res.getContentText().slice(0, 200);
      Logger.log('[' + i + '] HTTP ' + code + ' | ' + body);
      Logger.log('    URL: ' + url.slice(60));
    } catch(e) { Logger.log('[' + i + '] 例外: ' + e); }
    Utilities.sleep(500);
  });

  Logger.log('=== debugInsightsParams 完了 ===');
}

// ================================================
// 定数
// ================================================
var SN_BASE_URL_TOTONOERU    = 'https://ads.smartnews.com/api/ma/v3';
var SN_BASE_URL_V1_TOTONOERU = 'https://ads.smartnews.com/api/v1.0';
var SN_ACCOUNT_ID_TOTONOERU  = '97065339';
var SN_PARTNER_ID_TOTONOERU  = '12805940';
var SHEET_NAME_SN_TOTONOERU  = 'ととのえる（SN）';

var SN_LP_WALK_FIELD_TOTONOERU  = 'viewContent';
var SN_LP_BASIC_FIELD_TOTONOERU = 'search';
var SN_CART_FIELD_TOTONOERU     = 'addToCart';
var SN_CV_FIELD_TOTONOERU       = 'purchase';

// ================================================
// OAuth2 アクセストークン取得（キャッシュ付き）
// ================================================
function getSnAccessTokenTotonoeru() {
  var props        = PropertiesService.getScriptProperties();
  var clientId     = props.getProperty('SN_CLIENT_ID');
  var clientSecret = props.getProperty('SN_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('SN_CLIENT_ID または SN_CLIENT_SECRET が未設定です');
  }

  // トークン取得（form POST）
  var tokenEndpoints = [
    'https://ads.smartnews.com/api/oauth/v1/access_tokens',
    'https://ads.smartnews.com/auth/token',
    'https://ads.smartnews.com/api/v1.0/oauth/token'
  ];

  var accessToken = null;

  // まずform POST
  for (var i = 0; i < tokenEndpoints.length && !accessToken; i++) {
    try {
      var res = UrlFetchApp.fetch(tokenEndpoints[i], {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: 'grant_type=client_credentials'
               + '&client_id='     + encodeURIComponent(clientId)
               + '&client_secret=' + encodeURIComponent(clientSecret),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() === 200) {
        var j   = JSON.parse(res.getContentText());
        accessToken = j.access_token || j.token || j.accessToken;
      }
    } catch(e) {}
  }

  // Basic Authでリトライ
  if (!accessToken) {
    var basic = Utilities.base64Encode(clientId + ':' + clientSecret);
    for (var k = 0; k < tokenEndpoints.length && !accessToken; k++) {
      try {
        var res2 = UrlFetchApp.fetch(tokenEndpoints[k], {
          method: 'post',
          contentType: 'application/x-www-form-urlencoded',
          headers: { 'Authorization': 'Basic ' + basic },
          payload: 'grant_type=client_credentials',
          muteHttpExceptions: true
        });
        if (res2.getResponseCode() === 200) {
          var j2  = JSON.parse(res2.getContentText());
          accessToken = j2.access_token || j2.token || j2.accessToken;
        }
      } catch(e) {}
    }
  }

  if (!accessToken) {
    throw new Error('SmartNews OAuth2トークン取得失敗。SN_CLIENT_ID / SN_CLIENT_SECRET を確認してください。');
  }

  return accessToken;
}

// ================================================
// カスタムメニュー
// ================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔧 ととのえるSNレポート')
    .addItem('▶ レポート取得実行', 'runSnReportTotonoeru')
    .addSeparator()
    .addItem('🔍 APIデバッグ実行', 'debugSnApiTotonoeru')
    .addItem('📋 フィールド名確認', 'listSnFieldsTotonoeru')
    .addItem('⚙ 設定ガイド',       'showSnSetupGuideTotonoeru')
    .addToUi();
}

// ================================================
// メイン実行（メニューから）
// ================================================
function runSnReportTotonoeru() {
  var ui    = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SN_TOTONOERU);
  if (!sheet) { ui.alert('「ととのえる（SN）」シートが見つかりません。'); return; }

  var startDate = formatDateForSnTotonoeru(sheet.getRange('C2').getValue());
  var endDate   = formatDateForSnTotonoeru(sheet.getRange('C3').getValue());
  if (!startDate || !endDate) { ui.alert('C2/C3に日付を入力してください。\n例: 2026/04/01'); return; }

  var apiKey;
  try { apiKey = getSnAccessTokenTotonoeru(); }
  catch(e) { ui.alert('認証エラー：\n' + e.message); return; }

  var cpnData = getSnCampaignReportTotonoeru(apiKey, startDate, endDate);
  var crData  = getSnAdReportTotonoeru(apiKey, startDate, endDate);
  writeToSheetSnTotonoeru(sheet, cpnData, crData, startDate, endDate);
  SpreadsheetApp.flush();
  ui.alert('完了！\nキャンペーン: ' + cpnData.length + '件\nクリエイティブ: ' + crData.length + '件');
}

// ================================================
// API実行用エントリポイント（外部呼び出し用）
// ================================================
function runSnReportApiTotonoeru(startDate, endDate) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SN_TOTONOERU);
  if (!sheet) return { success: false, error: 'シートが見つかりません' };

  if (!startDate || !endDate) {
    startDate = formatDateForSnTotonoeru(sheet.getRange('C2').getValue());
    endDate   = formatDateForSnTotonoeru(sheet.getRange('C3').getValue());
  }
  if (!startDate || !endDate) return { success: false, error: 'C2/C3に日付が設定されていません' };

  var apiKey;
  try { apiKey = getSnAccessTokenTotonoeru(); }
  catch(e) { return { success: false, error: e.message }; }

  var cpnData = getSnCampaignReportTotonoeru(apiKey, startDate, endDate);
  var crData  = getSnAdReportTotonoeru(apiKey, startDate, endDate);
  writeToSheetSnTotonoeru(sheet, cpnData, crData, startDate, endDate);
  SpreadsheetApp.flush();
  return { success: true, campaignCount: cpnData.length, crCount: crData.length };
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
// Smartnews API 共通フェッチ（Bearer優先・指数バックオフリトライ付き）
// ================================================
function snApiFetchTotonoeru(apiKey, url) {
  var maxRetries = 3;
  var waitMs     = 1000;

  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      var res  = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'Authorization': 'Bearer ' + apiKey },
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      Logger.log('SN API [' + url.slice(-80) + '] → ' + code
                 + (attempt > 0 ? ' (retry ' + attempt + ')' : ''));

      if (code === 200) {
        return JSON.parse(res.getContentText());
      }

      var body = res.getContentText();
      Logger.log('Error: ' + body.slice(0, 400));

      // retriable:false または 4xx は即終了、retriable:true の 5xx のみリトライ
      var retriable = true;
      try {
        var errJson = JSON.parse(body);
        if (errJson.error && errJson.error.retriable === false) retriable = false;
      } catch(pe) {}

      if (!retriable || code < 500 || attempt >= maxRetries) {
        return null;
      }
      Logger.log('リトライ待機: ' + waitMs + 'ms...');
      Utilities.sleep(waitMs);
      waitMs *= 2;
      continue;

    } catch(e) {
      Logger.log('SN API 例外: ' + e.toString());
      if (attempt < maxRetries) {
        Logger.log('リトライ待機: ' + waitMs + 'ms...');
        Utilities.sleep(waitMs);
        waitMs *= 2;
      }
    }
  }
  return null;
}

// ================================================
// 期間分割インサイト取得（帯域幅上限対策：7日ずつ分割）
// ================================================
function fetchSnInsightsByChunkTotonoeru(apiKey, since, until, level) {
  var map   = {};
  var start = new Date(since);
  var end   = new Date(until);

  while (start <= end) {
    var chunkEnd = new Date(start);
    chunkEnd.setDate(chunkEnd.getDate() + 6);
    if (chunkEnd > end) chunkEnd = new Date(end);

    var s     = formatDateForSnTotonoeru(start);
    var e     = formatDateForSnTotonoeru(chunkEnd);
    var layer = level === 'AD' ? 'ads' : 'campaigns';
    var baseFields = 'campaignId,campaignName,spend,impressions,clicks';
    var adFields   = baseFields + ',adId,adName,thumbnailUrl';
    var fields = level === 'AD' ? adFields : baseFields;
    var url   = SN_BASE_URL_TOTONOERU + '/ad_accounts/' + SN_ACCOUNT_ID_TOTONOERU
              + '/insights/' + layer
              + '?since=' + s + 'T00:00:00Z&until=' + e + 'T23:59:59Z'
              + '&fields=' + fields;
    var data = snApiFetchTotonoeru(apiKey, url);

    if (data && data.data) {
      data.data.forEach(function(row) {
        var key = level === 'AD'
          ? (row.campaignId + '_' + row.adId)
          : row.campaignId;
        if (!map[key]) {
          map[key] = {
            campaignId:   row.campaignId   || '',
            campaignName: row.campaignName || row.campaignId || '',
            adId:         row.adId         || '',
            adName:       row.adName       || row.title      || row.adId || '',
            thumbnailUrl: row.thumbnailUrl || row.imageUrl   || '',
            spend: 0, impressions: 0, clicks: 0,
            lpWalk: 0, lpBasic: 0, cart: 0, cv: 0
          };
        }
        map[key].spend       += row.spend       || 0;
        map[key].impressions += row.impressions || 0;
        map[key].clicks      += row.clicks      || 0;
        map[key].lpWalk      += row[SN_LP_WALK_FIELD_TOTONOERU]  || 0;
        map[key].lpBasic     += row[SN_LP_BASIC_FIELD_TOTONOERU] || 0;
        map[key].cart        += row[SN_CART_FIELD_TOTONOERU]     || 0;
        map[key].cv          += row[SN_CV_FIELD_TOTONOERU]       || 0;
      });
    }

    start.setDate(start.getDate() + 7);
    Utilities.sleep(3000);
  }

  return Object.keys(map).map(function(k) { return map[k]; });
}

// ================================================
// キャンペーン別インサイト
// ================================================
function getSnCampaignReportTotonoeru(apiKey, since, until) {
  var rows = fetchSnInsightsByChunkTotonoeru(apiKey, since, until, 'CAMPAIGN');
  var results = [];
  rows.forEach(function(d) {
    var spend = d.spend, imp = d.impressions, clicks = d.clicks;
    if (spend === 0 && imp === 0 && clicks === 0) return;
    results.push({
      campaignId:   d.campaignId,
      campaignName: d.campaignName,
      spend:        Math.round(spend),
      cpc:          clicks > 0 ? Math.round(spend / clicks)     : 0,
      cpm:          imp    > 0 ? Math.round(spend / imp * 1000) : 0,
      impressions:  Math.round(imp),
      clicks:       Math.round(clicks),
      lpWalk:       Math.round(d.lpWalk),
      lpBasic:      Math.round(d.lpBasic),
      cart:         Math.round(d.cart),
      cv:           Math.round(d.cv)
    });
  });
  results.sort(function(a, b) { return b.spend - a.spend; });
  return results;
}

// ================================================
// 広告別インサイト
// ================================================
function getSnAdReportTotonoeru(apiKey, since, until) {
  var rows = fetchSnInsightsByChunkTotonoeru(apiKey, since, until, 'AD');
  var results = [];
  rows.forEach(function(d) {
    var spend = d.spend, imp = d.impressions, clicks = d.clicks;
    if (spend === 0 && imp === 0 && clicks === 0) return;
    results.push({
      campaignId:   d.campaignId,
      campaignName: d.campaignName,
      adId:         d.adId,
      adName:       d.adName,
      thumbnailUrl: d.thumbnailUrl,
      spend:        Math.round(spend),
      cpc:          clicks > 0 ? Math.round(spend / clicks)     : 0,
      cpm:          imp    > 0 ? Math.round(spend / imp * 1000) : 0,
      impressions:  Math.round(imp),
      clicks:       Math.round(clicks),
      lpWalk:       Math.round(d.lpWalk),
      lpBasic:      Math.round(d.lpBasic),
      cart:         Math.round(d.cart),
      cv:           Math.round(d.cv)
    });
  });
  results.sort(function(a, b) { return b.spend - a.spend; });
  return results;
}

// ================================================
// シートへの書き込み
// ================================================
function writeToSheetSnTotonoeru(sheet, cpnData, crData, startDate, endDate) {
  sheet.clearContents();
  sheet.clearFormats();
  var p = startDate + ' 〜 ' + endDate;

  sheet.getRange('B1').setValue('ととのえる Smartnews 数値集計');
  sheet.getRange('B2').setValue('開始日'); sheet.getRange('C2').setValue(startDate.replace(/-/g, '/'));
  sheet.getRange('B3').setValue('終了日'); sheet.getRange('C3').setValue(endDate.replace(/-/g, '/'));
  sheet.getRange('B4').setValue('※ 拡張機能メニュー「SNレポート ▶ レポート取得実行」で任意期間の更新が可能');

  sheet.getRange('B6').setValue('■ CPN別集計　（' + p + '）');
  var cpnHdrs = ['CPN名','①配信金額','②CPC','③CPM','④Imp','⑤Click','⑥CTR',
    '⑦LP遷移数(W)','⑧LP遷移率(W)','⑨LP遷移数(B)','⑩LP遷移率(B)',
    '⑪カート追加','⑫カート率','⑬CV数','⑭CVR','⑮LPCVR(W+B)','⑯CPA'];
  sheet.getRange(7, 2, 1, cpnHdrs.length).setValues([cpnHdrs]);
  if (cpnData.length > 0) {
    var cv = cpnData.map(function(d) {
      var ctr = d.impressions > 0 ? d.clicks / d.impressions : 0;
      var wR  = d.clicks > 0 ? d.lpWalk  / d.clicks : 0;
      var bR  = d.clicks > 0 ? d.lpBasic / d.clicks : 0;
      var cR  = d.clicks > 0 ? d.cart    / d.clicks : 0;
      var cvr = d.clicks > 0 ? d.cv      / d.clicks : 0;
      var lp  = (d.lpWalk + d.lpBasic) > 0 ? d.cv / (d.lpWalk + d.lpBasic) : '';
      var cpa = d.cv > 0 ? Math.round(d.spend / d.cv) : '';
      return [d.campaignName, d.spend, d.cpc, d.cpm, d.impressions, d.clicks,
              ctr, d.lpWalk, wR, d.lpBasic, bR, d.cart, cR, d.cv, cvr, lp, cpa];
    });
    sheet.getRange(8, 2, cv.length, 17).setValues(cv);
    setCpnFormatsSnTotonoeru(sheet, 8, cv.length);
  }

  var crSec = 8 + Math.max(cpnData.length, 1) + 2;
  sheet.getRange('B' + crSec).setValue('■ CR別集計　（' + p + '）');
  var crHdrs = ['CPN名','CR画像','CRタイトル','①配信金額','②CPC','③CPM','④Imp','⑤Click','⑥CTR',
    '⑦LP遷移数(W)','⑧LP遷移率(W)','⑨LP遷移数(B)','⑩LP遷移率(B)',
    '⑪カート追加','⑫カート率','⑬CV数','⑭CVR','⑮LPCVR(W+B)','⑯CPA'];
  sheet.getRange(crSec + 1, 2, 1, crHdrs.length).setValues([crHdrs]);
  if (crData.length > 0) {
    var crv = crData.map(function(d) {
      var ctr = d.impressions > 0 ? d.clicks / d.impressions : 0;
      var wR  = d.clicks > 0 ? d.lpWalk  / d.clicks : 0;
      var bR  = d.clicks > 0 ? d.lpBasic / d.clicks : 0;
      var cR  = d.clicks > 0 ? d.cart    / d.clicks : 0;
      var cvr = d.clicks > 0 ? d.cv      / d.clicks : 0;
      var lp  = (d.lpWalk + d.lpBasic) > 0 ? d.cv / (d.lpWalk + d.lpBasic) : '';
      var cpa = d.cv > 0 ? Math.round(d.spend / d.cv) : '';
      var img = d.thumbnailUrl ? '=IMAGE("' + d.thumbnailUrl + '",1)' : '';
      return [d.campaignName, img, d.adName,
              d.spend, d.cpc, d.cpm, d.impressions, d.clicks, ctr,
              d.lpWalk, wR, d.lpBasic, bR, d.cart, cR, d.cv, cvr, lp, cpa];
    });
    sheet.getRange(crSec + 2, 2, crv.length, 19).setValues(crv);
    setCrFormatsSnTotonoeru(sheet, crSec + 2, crv.length);
  }
}

// ================================================
// 数値フォーマット（CPN別）
// ================================================
function setCpnFormatsSnTotonoeru(sheet, r, n) {
  if (!n) return;
  sheet.getRange(r,  3, n, 1).setNumberFormat('¥#,##0');
  sheet.getRange(r,  4, n, 1).setNumberFormat('0.0');
  sheet.getRange(r,  5, n, 1).setNumberFormat('0.0');
  sheet.getRange(r,  6, n, 1).setNumberFormat('#,##0');
  sheet.getRange(r,  7, n, 1).setNumberFormat('#,##0');
  sheet.getRange(r,  8, n, 1).setNumberFormat('0.00%');
  sheet.getRange(r,  9, n, 1).setNumberFormat('#,##0');
  sheet.getRange(r, 10, n, 1).setNumberFormat('0.00%');
  sheet.getRange(r, 11, n, 1).setNumberFormat('#,##0');
  sheet.getRange(r, 12, n, 1).setNumberFormat('0.00%');
  sheet.getRange(r, 13, n, 1).setNumberFormat('#,##0');
  sheet.getRange(r, 14, n, 1).setNumberFormat('0.00%');
  sheet.getRange(r, 15, n, 1).setNumberFormat('#,##0');
  sheet.getRange(r, 16, n, 1).setNumberFormat('0.00%');
  sheet.getRange(r, 17, n, 1).setNumberFormat('0.00%');
  sheet.getRange(r, 18, n, 1).setNumberFormat('¥#,##0');
}

// ================================================
// 数値フォーマット（CR別）
// ================================================
function setCrFormatsSnTotonoeru(sheet, r, n) {
  if (!n) return;
  sheet.getRange(r,  5, n, 1).setNumberFormat('¥#,##0');
  sheet.getRange(r,  6, n, 1).setNumberFormat('0.0');
  sheet.getRange(r,  7, n, 1).setNumberFormat('0.0');
  sheet.getRange(r,  8, n, 1).setNumberFormat('#,##0');
  sheet.getRange(r,  9, n, 1).setNumberFormat('#,##0');
  sheet.getRange(r, 10, n, 1).setNumberFormat('0.00%');
  sheet.getRange(r, 11, n, 1).setNumberFormat('#,##0');
  sheet.getRange(r, 12, n, 1).setNumberFormat('0.00%');
  sheet.getRange(r, 13, n, 1).setNumberFormat('#,##0');
  sheet.getRange(r, 14, n, 1).setNumberFormat('0.00%');
  sheet.getRange(r, 15, n, 1).setNumberFormat('#,##0');
  sheet.getRange(r, 16, n, 1).setNumberFormat('0.00%');
  sheet.getRange(r, 17, n, 1).setNumberFormat('#,##0');
  sheet.getRange(r, 18, n, 1).setNumberFormat('0.00%');
  sheet.getRange(r, 19, n, 1).setNumberFormat('0.00%');
  sheet.getRange(r, 20, n, 1).setNumberFormat('¥#,##0');
}

// ================================================
// デバッグ（メニューから・UI使用）
// ================================================
function debugSnApiTotonoeru() {
  testSnApi();
  SpreadsheetApp.getUi().alert('ログを確認してください（Apps Script > ログ）');
}

// ================================================
// フィールド名確認
// ================================================
function listSnFieldsTotonoeru() {
  var ui = SpreadsheetApp.getUi();
  var apiKey;
  try { apiKey = getSnAccessTokenTotonoeru(); }
  catch(e) { ui.alert('認証エラー：\n' + e.message); return; }

  var data = snApiFetchTotonoeru(apiKey,
    SN_BASE_URL_TOTONOERU + '/ad_accounts/' + SN_ACCOUNT_ID_TOTONOERU
    + '/insights/campaigns?since=2026-04-01T00:00:00Z&until=2026-04-07T23:59:59Z'
    + '&fields=campaignId,campaignName,spend,impressions,clicks');

  if (!data || !data.data || !data.data.length) { ui.alert('データなし。ログ確認。'); return; }
  var s = data.data[0], msg = '【フィールド一覧】\n\n';
  Object.keys(s).forEach(function(k) { msg += '  ' + k + ': ' + s[k] + '\n'; });
  ui.alert(msg);
}

// ================================================
// 設定ガイド
// ================================================
function showSnSetupGuideTotonoeru() {
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(
      '<style>body{font-family:sans-serif;font-size:13px;padding:16px}h2{color:#1a73e8}'
      + 'code{background:#f1f3f4;padding:2px 6px;border-radius:3px}'
      + 'table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px}th{background:#f1f3f4}</style>'
      + '<h2>🔧 Smartnews レポート設定ガイド</h2>'
      + '<h3>① Script Properties に設定</h3>'
      + '<table><tr><th>キー</th><th>値</th></tr>'
      + '<tr><td><code>SN_CLIENT_ID</code></td><td>SmartNews Ads の client_id</td></tr>'
      + '<tr><td><code>SN_CLIENT_SECRET</code></td><td>SmartNews Ads の client_secret</td></tr></table>'
      + '<h3>② シート設定</h3>'
      + '<p><b>C2</b>=開始日 <b>C3</b>=終了日（例: 2026/04/01）</p>'
      + '<h3>③ コンバージョン設定</h3>'
      + '<table><tr><th>列</th><th>内容</th><th>APIフィールド</th></tr>'
      + '<tr><td>I</td><td>LP遷移数(W) 詳細ページ</td><td><code>viewContent</code></td></tr>'
      + '<tr><td>K</td><td>LP遷移数(B) 検索</td><td><code>search</code></td></tr>'
      + '<tr><td>M</td><td>カート追加</td><td><code>addToCart</code></td></tr>'
      + '<tr><td>O</td><td>CV数 商品購入</td><td><code>purchase</code></td></tr></table>'
    ).setWidth(500).setHeight(420), '⚙ 設定ガイド');
}
