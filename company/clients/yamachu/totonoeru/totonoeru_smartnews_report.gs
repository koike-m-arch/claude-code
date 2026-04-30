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
 * スクリプトプロパティに以下を設定：
 *   SN_CLIENT_ID     : SmartNews Marketing API の Client ID
 *   SN_CLIENT_SECRET : SmartNews Marketing API の Client Secret
 *
 * 【使い方】
 * 1. シート「ととのえる（SN）」の C2 に開始日、C3 に終了日を入力
 * 2. メニュー「🔧 SNReport」→「▶ Run」を実行
 *
 * 【確定フィールド（2026-04検証済み）】
 * metrics_budget_spent, metrics_click, metrics_ctr, metrics_cpm, metrics_cpc,
 * metrics_cvr_purchase, metrics_cvr_view_content, metrics_cvr_add_to_cart, metrics_cvr_search
 *
 * 【算出値】
 * - IMP      : Math.round(click / ctr)
 * - LP遷移W  : Math.round(click * cvr_view_content)
 * - LP遷移B  : Math.round(click * cvr_search)
 * - カート   : Math.round(click * cvr_add_to_cart)
 * - CV       : Math.round(click * cvr_purchase)
 *
 * 【ADレスポンス】
 * /insights/ads の各行に parent.parent.name = キャンペーン名 が含まれる
 * ===============================================
 */

var SN_BASE_URL_TOTONOERU = 'https://ads.smartnews.com/api/ma/v3';
var SN_ACCOUNT_ID_TOTONOERU = '97065339';
var SHEET_NAME_SN_TOTONOERU = 'ととのえる（SN）';

function getSnAccessTokenTotonoeru() {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('SN_CLIENT_ID');
  var clientSecret = props.getProperty('SN_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('SN_CLIENT_ID or SN_CLIENT_SECRET not set');
  var r = UrlFetchApp.fetch('https://ads.smartnews.com/api/oauth/v1/access_tokens', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: 'grant_type=client_credentials&client_id=' + encodeURIComponent(clientId) + '&client_secret=' + encodeURIComponent(clientSecret),
    muteHttpExceptions: true
  });
  if (r.getResponseCode() === 200) {
    var j = JSON.parse(r.getContentText());
    var tok = j.access_token || j.token || j.accessToken;
    if (tok) return tok;
  }
  throw new Error('SmartNews token failed');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🔧 SNReport')
    .addItem('▶ Run', 'runSnReportTotonoeru')
    .addSeparator()
    .addItem('🧪 Test final fields', 'testFinalFields')
    .addItem('🔍 Campaign IDs', 'getCampaignIds')
    .addItem('🖼 Ads response check', 'testAdsResponse')
    .addToUi();
}

function runSnReportTotonoeru() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_SN_TOTONOERU);
  if (!sheet) { ui.alert('「ととのえる（SN）」シートが見つかりません。'); return; }
  var startDate = formatDateForSnTotonoeru(sheet.getRange('C2').getValue());
  var endDate = formatDateForSnTotonoeru(sheet.getRange('C3').getValue());
  if (!startDate || !endDate) { ui.alert('C2/C3に日付を入力してください。'); return; }
  var apiKey;
  try { apiKey = getSnAccessTokenTotonoeru(); } catch(e) { ui.alert('認証エラー: ' + e.message); return; }
  var cpnData = getSnCampaignReportTotonoeru(apiKey, startDate, endDate);
  var crData = getSnAdReportTotonoeru(apiKey, startDate, endDate);
  writeToSheetSnTotonoeru(sheet, cpnData, crData, startDate, endDate);
  SpreadsheetApp.flush();
  ui.alert('完了！');
}

function formatDateForSnTotonoeru(val) {
  if (!val) return null;
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function snApiFetchTotonoeru(apiKey, url) {
  try {
    var res = UrlFetchApp.fetch(url, { method: 'get', headers: { 'Authorization': 'Bearer ' + apiKey }, muteHttpExceptions: true });
    if (res.getResponseCode() === 200) return JSON.parse(res.getContentText());
    Logger.log('Error[' + res.getResponseCode() + ']: ' + res.getContentText().slice(0, 400));
  } catch(e) { Logger.log('SN API ex: ' + e.toString()); }
  return null;
}

function fetchSnInsightsByChunkTotonoeru(apiKey, since, until, level) {
  var map = {}, start = new Date(since), end = new Date(until);
  while (start <= end) {
    var chunkEnd = new Date(start); chunkEnd.setDate(chunkEnd.getDate() + 6);
    if (chunkEnd > end) chunkEnd = new Date(end);
    var s = formatDateForSnTotonoeru(start), e = formatDateForSnTotonoeru(chunkEnd);
    var layer = level === 'AD' ? 'ads' : 'campaigns';
    var fields = 'metrics_budget_spent,metrics_click,metrics_ctr,metrics_cpm,metrics_cpc,metrics_cvr_purchase,metrics_cvr_view_content,metrics_cvr_add_to_cart,metrics_cvr_search';
    var url = SN_BASE_URL_TOTONOERU + '/ad_accounts/' + SN_ACCOUNT_ID_TOTONOERU
      + '/insights/' + layer + '?since=' + s + 'T00:00:00Z&until=' + e + 'T23:59:59Z&fields=' + fields;
    var data = snApiFetchTotonoeru(apiKey, url);
    if (data && data.data) {
      data.data.forEach(function(row) {
        var m = row.metrics || {};
        var spend = parseFloat(m.budget_spent) || 0;
        var click = parseFloat(m.click) || 0;
        var ctr = parseFloat(m.ctr) || 0;
        var imp = ctr > 0 ? Math.round(click / ctr) : 0;
        var lpWalk = Math.round(click * (parseFloat(m.cvr_view_content) || 0));
        var lpBasic = Math.round(click * (parseFloat(m.cvr_search) || 0));
        var cart = Math.round(click * (parseFloat(m.cvr_add_to_cart) || 0));
        var cv = Math.round(click * (parseFloat(m.cvr_purchase) || 0));
        var campaignId, key;
        if (level === 'AD') {
          campaignId = (row.parent && row.parent.parent) ? row.parent.parent.id : row.id;
          key = String(campaignId) + '_' + String(row.id);
        } else {
          campaignId = row.id;
          key = String(row.id);
        }
        if (!map[key]) map[key] = { id: row.id, campaignId: campaignId, campaignName: '', spend: 0, impressions: 0, clicks: 0, lpWalk: 0, lpBasic: 0, cart: 0, cv: 0 };
        if (level === 'AD' && row.parent && row.parent.parent && row.parent.parent.name) {
          map[key].campaignName = row.parent.parent.name;
        }
        map[key].spend += spend;
        map[key].impressions += imp;
        map[key].clicks += click;
        map[key].lpWalk += lpWalk;
        map[key].lpBasic += lpBasic;
        map[key].cart += cart;
        map[key].cv += cv;
      });
    }
    start.setDate(start.getDate() + 7);
    Utilities.sleep(2000);
  }
  return Object.keys(map).map(function(k) { return map[k]; });
}

function getSnCampaignReportTotonoeru(apiKey, since, until) {
  var nameMap = {};
  var cl = snApiFetchTotonoeru(apiKey, SN_BASE_URL_TOTONOERU + '/ad_accounts/' + SN_ACCOUNT_ID_TOTONOERU + '/campaigns');
  if (cl && cl.data) cl.data.forEach(function(c) { nameMap[c.id || c.campaign_id] = (c.name || c.campaign_name || c.id); });
  var rows = fetchSnInsightsByChunkTotonoeru(apiKey, since, until, 'CAMPAIGN'), results = [];
  rows.forEach(function(d) {
    if (d.spend === 0 && d.impressions === 0 && d.clicks === 0) return;
    var s = d.spend, imp = d.impressions, cl = d.clicks;
    results.push({
      campaignId: d.id,
      campaignName: nameMap[d.id] || ('CPN-' + d.id),
      spend: Math.round(s),
      cpc: cl > 0 ? Math.round(s / cl) : 0,
      cpm: imp > 0 ? Math.round(s / imp * 1000) : 0,
      impressions: Math.round(imp),
      clicks: Math.round(cl),
      lpWalk: Math.round(d.lpWalk),
      lpBasic: Math.round(d.lpBasic),
      cart: Math.round(d.cart),
      cv: Math.round(d.cv)
    });
  });
  results.sort(function(a, b) { return b.spend - a.spend; });
  return results;
}

function getSnAdReportTotonoeru(apiKey, since, until) {
  var adMap = {};
  var al = snApiFetchTotonoeru(apiKey, SN_BASE_URL_TOTONOERU + '/ad_accounts/' + SN_ACCOUNT_ID_TOTONOERU + '/ads');
  if (al && al.data) al.data.forEach(function(a) {
    var imgUrl = '', headline = '';
    try {
      imgUrl = a.creative.image_creative_info.media_files[0].images.full.url || '';
    } catch(e) {}
    try {
      headline = a.creative.image_creative_info.headline || '';
    } catch(e) {}
    adMap[a.ad_id] = { name: a.name || String(a.ad_id), thumbnailUrl: imgUrl, headline: headline };
  });
  var rows = fetchSnInsightsByChunkTotonoeru(apiKey, since, until, 'AD'), results = [];
  rows.forEach(function(d) {
    if (d.spend === 0 && d.impressions === 0 && d.clicks === 0) return;
    var s = d.spend, imp = d.impressions, cl = d.clicks;
    var ad = adMap[d.id] || {};
    results.push({
      campaignId: d.campaignId,
      campaignName: d.campaignName || ('CPN-' + d.campaignId),
      adId: d.id,
      adName: ad.name || ('AD-' + d.id),
      thumbnailUrl: ad.thumbnailUrl || '',
      adHeadline: ad.headline || '',
      spend: Math.round(s),
      cpc: cl > 0 ? Math.round(s / cl) : 0,
      cpm: imp > 0 ? Math.round(s / imp * 1000) : 0,
      impressions: Math.round(imp),
      clicks: Math.round(cl),
      lpWalk: Math.round(d.lpWalk),
      lpBasic: Math.round(d.lpBasic),
      cart: Math.round(d.cart),
      cv: Math.round(d.cv)
    });
  });
  results.sort(function(a, b) { return b.spend - a.spend; });
  return results;
}

function writeToSheetSnTotonoeru(sheet, cpnData, crData, startDate, endDate) {
  sheet.clearContents(); sheet.clearFormats();
  var p = startDate + ' 〜 ' + endDate;
  var NAV = '#1c4587', HDR_BG = '#dce8ff', HDR_BORDER = '#7baaf7', ROW_ALT = '#f0f4ff', DATA_BORDER = '#bdd1fb';

  // タイトル
  sheet.setRowHeight(1, 34);
  sheet.getRange('B1').setValue('ととのえる Smartnews 数値集計')
    .setFontSize(13).setFontWeight('bold').setFontColor('#ffffff')
    .setBackground(NAV).setVerticalAlignment('middle');

  // 日付
  sheet.getRange('B2').setValue('開始日').setFontWeight('bold').setBackground(HDR_BG).setHorizontalAlignment('center');
  sheet.getRange('C2').setValue(startDate.replace(/-/g, '/')).setBackground('#f8f9fa').setHorizontalAlignment('center');
  sheet.getRange('B3').setValue('終了日').setFontWeight('bold').setBackground(HDR_BG).setHorizontalAlignment('center');
  sheet.getRange('C3').setValue(endDate.replace(/-/g, '/')).setBackground('#f8f9fa').setHorizontalAlignment('center');

  // CPN別集計
  sheet.getRange('B6').setValue('■ CPN別集計　（' + p + '）')
    .setFontWeight('bold').setFontSize(11).setBackground(NAV).setFontColor('#ffffff');
  var cpnHdrs = ['CPN名','①配信金額','②CPC','③CPM','④Imp','⑤Click','⑥CTR','⑦LP遷移数(W)','⑧LP遷移率(W)','⑨LP遷移数(B)','⑩LP遷移率(B)','⑪カート追加','⑫カート率','⑬CV数','⑭CVR','⑮LPCVR(W+B)','⑯CPA'];
  sheet.getRange(7, 2, 1, cpnHdrs.length).setValues([cpnHdrs])
    .setBackground(HDR_BG).setFontWeight('bold').setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true, HDR_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  if (cpnData.length > 0) {
    var cv = cpnData.map(function(d) {
      var ctr = d.impressions > 0 ? d.clicks / d.impressions : 0;
      var wR = d.clicks > 0 ? d.lpWalk / d.clicks : 0;
      var bR = d.clicks > 0 ? d.lpBasic / d.clicks : 0;
      var cR = d.clicks > 0 ? d.cart / d.clicks : 0;
      var cvr = d.clicks > 0 ? d.cv / d.clicks : 0;
      var lpTotal = d.lpWalk + d.lpBasic;
      var lp = lpTotal > 0 ? d.cv / lpTotal : '';
      var cpa = d.cv > 0 ? Math.round(d.spend / d.cv) : '';
      return [d.campaignName, d.spend, d.cpc, d.cpm, d.impressions, d.clicks, ctr, d.lpWalk, wR, d.lpBasic, bR, d.cart, cR, d.cv, cvr, lp, cpa];
    });
    var cpnRange = sheet.getRange(8, 2, cv.length, 17);
    cpnRange.setValues(cv);
    cpnRange.setBorder(null, true, true, true, true, true, DATA_BORDER, SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(8, 2, cv.length, 1).setHorizontalAlignment('left');
    sheet.getRange(8, 3, cv.length, 16).setHorizontalAlignment('right');
    setCpnFormatsSnTotonoeru(sheet, 8, cv.length);
  }

  // CR別集計
  var crSec = 8 + Math.max(cpnData.length, 1) + 2;
  sheet.getRange('B' + crSec).setValue('■ CR別集計　（' + p + '）')
    .setFontWeight('bold').setFontSize(11).setBackground(NAV).setFontColor('#ffffff');
  var crHdrs = ['CPN名','CR画像','見出し','①配信金額','②CPC','③CPM','④Imp','⑤Click','⑥CTR','⑦LP遷移数(W)','⑧LP遷移率(W)','⑨LP遷移数(B)','⑩LP遷移率(B)','⑪カート追加','⑫カート率','⑬CV数','⑭CVR','⑮LPCVR(W+B)','⑯CPA'];
  sheet.getRange(crSec + 1, 2, 1, crHdrs.length).setValues([crHdrs])
    .setBackground(HDR_BG).setFontWeight('bold').setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true, HDR_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  if (crData.length > 0) {
    var crv = crData.map(function(d) {
      var ctr = d.impressions > 0 ? d.clicks / d.impressions : 0;
      var wR = d.clicks > 0 ? d.lpWalk / d.clicks : 0;
      var bR = d.clicks > 0 ? d.lpBasic / d.clicks : 0;
      var cR = d.clicks > 0 ? d.cart / d.clicks : 0;
      var cvr = d.clicks > 0 ? d.cv / d.clicks : 0;
      var lpTotal = d.lpWalk + d.lpBasic;
      var lp = lpTotal > 0 ? d.cv / lpTotal : '';
      var cpa = d.cv > 0 ? Math.round(d.spend / d.cv) : '';
      return [d.campaignName, '', d.adHeadline || '', d.spend, d.cpc, d.cpm, d.impressions, d.clicks, ctr, d.lpWalk, wR, d.lpBasic, bR, d.cart, cR, d.cv, cvr, lp, cpa];
    });
    var crRange = sheet.getRange(crSec + 2, 2, crv.length, 19);
    crRange.setValues(crv);
    sheet.getRange(crSec + 2, 3, crData.length, 1).setFormulas(crData.map(function(d) {
      return [d.thumbnailUrl ? '=IMAGE("' + d.thumbnailUrl + '",1)' : ''];
    }));
    crRange.setBorder(null, true, true, true, true, true, DATA_BORDER, SpreadsheetApp.BorderStyle.SOLID);
    for (var k = 0; k < crv.length; k++) { sheet.setRowHeight(crSec + 2 + k, 80); }
    sheet.getRange(crSec + 2, 2, crv.length, 1).setHorizontalAlignment('left');
    sheet.getRange(crSec + 2, 3, crv.length, 1).setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.getRange(crSec + 2, 4, crv.length, 1).setHorizontalAlignment('left').setVerticalAlignment('middle').setWrap(true);
    sheet.getRange(crSec + 2, 5, crv.length, 15).setHorizontalAlignment('right');
    setCrFormatsSnTotonoeru(sheet, crSec + 2, crv.length);
  }

  // 列幅
  sheet.setColumnWidth(2, 240);  // CPN名
  sheet.setColumnWidth(3, 120);  // CR画像
  sheet.setColumnWidth(4, 200);  // 見出し
  for (var c = 5; c <= 20; c++) { sheet.setColumnWidth(c, 82); }
}

function setCpnFormatsSnTotonoeru(sheet, r, n) {
  if (!n) return;
  [[3,'¥#,##0'],[4,'0.0'],[5,'0.0'],[6,'#,##0'],[7,'#,##0'],[8,'0.00%'],[9,'#,##0'],[10,'0.00%'],[11,'#,##0'],[12,'0.00%'],[13,'#,##0'],[14,'0.00%'],[15,'#,##0'],[16,'0.00%'],[17,'0.00%'],[18,'¥#,##0']].forEach(function(p) {
    sheet.getRange(r, p[0], n, 1).setNumberFormat(p[1]);
  });
}

function setCrFormatsSnTotonoeru(sheet, r, n) {
  if (!n) return;
  // B=CPN名 C=CR画像 D=見出し E〜T=数値列
  [[5,'¥#,##0'],[6,'0.0'],[7,'0.0'],[8,'#,##0'],[9,'#,##0'],[10,'0.00%'],[11,'#,##0'],[12,'0.00%'],[13,'#,##0'],[14,'0.00%'],[15,'#,##0'],[16,'0.00%'],[17,'#,##0'],[18,'0.00%'],[19,'0.00%'],[20,'¥#,##0']].forEach(function(p) {
    sheet.getRange(r, p[0], n, 1).setNumberFormat(p[1]);
  });
}

// ── テスト用関数 ──────────────────────────────────────────

function testFinalFields() {
  var apiKey = getSnAccessTokenTotonoeru();
  var h = { 'Authorization': 'Bearer ' + apiKey };
  var d = '?since=2026-04-01T00:00:00Z&until=2026-04-28T23:59:59Z';
  var allFields = 'metrics_budget_spent,metrics_click,metrics_ctr,metrics_cpm,metrics_cpc,metrics_cvr_purchase,metrics_cvr_view_content,metrics_cvr_add_to_cart';

  Logger.log('=== [S] search(LP遷移B)候補 ===');
  ['metrics_cvr_search', 'metrics_cpa_search', 'metrics_cvr_lp', 'metrics_cvr_lp_click'].forEach(function(f, i) {
    try {
      var r = UrlFetchApp.fetch('https://ads.smartnews.com/api/ma/v3/ad_accounts/97065339/insights/campaigns' + d + '&fields=' + f, { method: 'get', headers: h, muteHttpExceptions: true });
      Logger.log('[S-' + i + '] ' + f + ' -> HTTP ' + r.getResponseCode() + ' | ' + r.getContentText().slice(0, 200));
    } catch(e) { Logger.log('[S-' + i + '] ex:' + e); }
    Utilities.sleep(300);
  });

  Logger.log('=== [FC] 全フィールドセット campaigns ===');
  try {
    var r = UrlFetchApp.fetch('https://ads.smartnews.com/api/ma/v3/ad_accounts/97065339/insights/campaigns' + d + '&fields=' + allFields, { method: 'get', headers: h, muteHttpExceptions: true });
    Logger.log('[FC] HTTP ' + r.getResponseCode() + ' | ' + r.getContentText().slice(0, 800));
  } catch(e) { Logger.log('[FC] ex:' + e); }

  Logger.log('=== [FA] 全フィールドセット ads ===');
  try {
    var r = UrlFetchApp.fetch('https://ads.smartnews.com/api/ma/v3/ad_accounts/97065339/insights/ads' + d + '&fields=' + allFields, { method: 'get', headers: h, muteHttpExceptions: true });
    Logger.log('[FA] HTTP ' + r.getResponseCode() + ' | ' + r.getContentText().slice(0, 800));
  } catch(e) { Logger.log('[FA] ex:' + e); }

  Logger.log('=== done ===');
}

function getCampaignIds() {
  var apiKey = getSnAccessTokenTotonoeru();
  var res = UrlFetchApp.fetch('https://ads.smartnews.com/api/ma/v3/ad_accounts/97065339/campaigns', { method: 'get', headers: { 'Authorization': 'Bearer ' + apiKey }, muteHttpExceptions: true });
  Logger.log('HTTP ' + res.getResponseCode() + ' | ' + res.getContentText().slice(0, 800));
}

function testAdsResponse() {
  // /ads エンドポイントの実際のフィールド名を確認（CR画像URLのキー名を特定するため）
  var apiKey = getSnAccessTokenTotonoeru();
  var res = UrlFetchApp.fetch(SN_BASE_URL_TOTONOERU + '/ad_accounts/' + SN_ACCOUNT_ID_TOTONOERU + '/ads', {
    method: 'get', headers: { 'Authorization': 'Bearer ' + apiKey }, muteHttpExceptions: true
  });
  Logger.log('HTTP ' + res.getResponseCode());
  if (res.getResponseCode() === 200) {
    var data = JSON.parse(res.getContentText());
    if (data.data && data.data.length > 0) {
      Logger.log('1件目のキー一覧: ' + Object.keys(data.data[0]).join(', '));
      Logger.log('1件目の全フィールド: ' + JSON.stringify(data.data[0]).slice(0, 1000));
    }
  } else {
    Logger.log(res.getContentText().slice(0, 400));
  }
}
