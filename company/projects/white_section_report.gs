/**
 * Outbrain 掲載面集計 — ホワイト版（コンテナーバウンド）
 * 書き込み先: 「掲載面②」タブ
 * マーケターID: 0033e4d3d312b31c84630c2166acec7b27
 * GASスクリプトID: 1LNpXzcE-f3Do5_qhAky1V732Qhzj_xWg4wgH-0sM9ZxTP5aZHBAdORKv
 *
 * 【スクリプトプロパティ設定】
 *   OB_USERNAME  : Outbrainログインメール
 *   OB_PASSWORD  : Outbrainパスワード
 *   LP_CONV_NAME : LP遷移コンバージョン名（省略時: 01 LP 01d）
 *   CV_CONV_NAME : CVコンバージョン名（省略時: 03 all thanks 01d）
 */

var BASE_URL           = 'https://api.outbrain.com/amplify/v0.1';
var SPREADSHEET_ID     = '1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8';
var SECTION_SHEET_NAME = '掲載面②';

var LP_CONV_DEFAULT = '01LP';
var CV_CONV_DEFAULT = 'thanks 1day';

var TOKEN_CACHE_KEY    = 'OB_WHITE_SECTION_TOKEN_CACHE';
var TOKEN_CACHE_TS_KEY = 'OB_WHITE_SECTION_TOKEN_CACHE_TS';
var TOKEN_TTL_MS       = 4 * 60 * 60 * 1000;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 掲載面②')
    .addItem('▶ 掲載面集計実行', 'runSectionReport')
    .addSeparator()
    .addItem('🔍 APIデバッグ', 'debugSectionApi')
    .addItem('🔍 コンバージョン名一覧', 'listConversionNames')
    .addItem('⚙ シート初期化', 'initSectionSheet')
    .addItem('🔧 タブ名修正（掲載面③→②）', 'renameSheet')
    .addToUi();
}

function convertSpend(spend) {
  return Math.round(spend / 0.8 * 1.1);
}

function formatDateForAPI(val) {
  if (!val) return null;
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return null;
  var y  = d.getFullYear();
  var m  = ('0' + (d.getMonth() + 1)).slice(-2);
  var dy = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + dy;
}

function getOutbrainToken(username, password) {
  var props       = PropertiesService.getScriptProperties();
  var cachedToken = props.getProperty(TOKEN_CACHE_KEY);
  var cachedTs    = parseInt(props.getProperty(TOKEN_CACHE_TS_KEY) || '0', 10);
  if (cachedToken && (Date.now() - cachedTs) < TOKEN_TTL_MS) {
    Logger.log('トークンキャッシュ使用');
    return cachedToken;
  }
  try {
    var creds    = Utilities.base64Encode(username + ':' + password);
    var response = UrlFetchApp.fetch(BASE_URL + '/login', {
      method: 'get',
      headers: { 'Authorization': 'Basic ' + creds },
      muteHttpExceptions: true
    });
    Logger.log('Login status: ' + response.getResponseCode());
    if (response.getResponseCode() === 429) {
      if (cachedToken) return cachedToken;
      return null;
    }
    if (response.getResponseCode() === 200) {
      var headers = response.getHeaders();
      var token   = headers['OB-TOKEN-V1'] || headers['ob-token-v1'];
      if (!token) {
        try { var json = JSON.parse(response.getContentText()); token = json.OB_TOKEN_V1 || json['OB-TOKEN-V1']; } catch(e) {}
      }
      if (token) {
        props.setProperty(TOKEN_CACHE_KEY, token);
        props.setProperty(TOKEN_CACHE_TS_KEY, String(Date.now()));
        return token;
      }
    }
    Logger.log('認証失敗: ' + response.getContentText().substring(0, 200));
    return null;
  } catch(e) {
    Logger.log('認証例外: ' + e.toString());
    return null;
  }
}

function buildCampaignMap(token, marketerId) {
  var map = {};
  try {
    var response = UrlFetchApp.fetch(
      BASE_URL + '/marketers/' + marketerId + '/campaigns?limit=50',
      { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true }
    );
    if (response.getResponseCode() !== 200) return map;
    var data = JSON.parse(response.getContentText());
    (data.campaigns || []).forEach(function(c) { map[c.id] = c.name || c.id; });
  } catch(e) {
    Logger.log('buildCampaignMap 例外: ' + e.toString());
  }
  return map;
}

function getActiveCampaignIds(token, marketerId, from, to, campaignMap) {
  var results = [];
  try {
    var url  = BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic';
    var resp = UrlFetchApp.fetch(url + '?from=' + from + '&to=' + to + '&includeConversionDetails=false', {
      headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return results;
    var data = JSON.parse(resp.getContentText());
    (data.campaignResults || []).forEach(function(camp) {
      var spend = 0;
      (camp.results || []).forEach(function(r) { spend += ((r.metrics || {}).spend || 0); });
      if (spend >= 1) results.push({
        campaignId:   camp.campaignId,
        campaignName: campaignMap[camp.campaignId] || camp.campaignId
      });
    });
  } catch(e) {
    Logger.log('getActiveCampaignIds 例外: ' + e.toString());
  }
  return results;
}

// ================================================
// 掲載面データ取得（上位20件・全CPN合算）
// ※ includeConversionDetails=true で LP遷移数・CV数をconversionMetricsから取得
// ================================================
function getSectionData(token, marketerId, from, to, lpConv, cvConv) {
  var baseParams = '?from=' + from + '&to=' + to + '&includeConversionDetails=true&limit=500';
  var tryUrls = [
    BASE_URL + '/reports/marketers/' + marketerId + '/sections'            + baseParams,
    BASE_URL + '/reports/marketers/' + marketerId + '/publishers'          + baseParams,
    BASE_URL + '/reports/marketers/' + marketerId + '/publishers/periodic' + baseParams
  ];

  for (var i = 0; i < tryUrls.length; i++) {
    try {
      Logger.log('SectionAPI[' + i + '] ' + tryUrls[i].substring(0, 120));
      var resp = UrlFetchApp.fetch(tryUrls[i], {
        headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      Logger.log('SectionAPI[' + i + '] status=' + code);
      if (code !== 200) { Logger.log('error: ' + resp.getContentText().substring(0, 200)); continue; }

      var data    = JSON.parse(resp.getContentText());
      var results = data.results || data.publisherResults || [];
      Logger.log('SectionAPI[' + i + '] 件数=' + results.length);
      if (results.length === 0) continue;

      var sectionMap = {};
      results.forEach(function(item) {
        var meta        = item.metadata || {};
        var sectionName = meta.name || meta.sectionName || meta.publisherName || meta.publisher || '不明';
        var m           = item.metrics || {};
        var lp = 0, cv = 0;
        (m.conversionMetrics || []).forEach(function(cm) {
          var name = (cm.name || '').trim();
          var val  = cm.conversions || 0;
          if (lpConv && name === lpConv) lp += val;
          if (cvConv && name === cvConv) cv += val;
        });
        if (cv === 0) cv = m.conversions || 0;

        if (!sectionMap[sectionName]) {
          sectionMap[sectionName] = { spend: 0, impressions: 0, clicks: 0, lpCount: 0, cvCount: 0 };
        }
        sectionMap[sectionName].spend       += (m.spend       || 0);
        sectionMap[sectionName].impressions += (m.impressions || 0);
        sectionMap[sectionName].clicks      += (m.clicks      || 0);
        sectionMap[sectionName].lpCount     += lp;
        sectionMap[sectionName].cvCount     += cv;
      });

      var arr = Object.keys(sectionMap).map(function(name) {
        var d = sectionMap[name];
        return { sectionName: name, spend: d.spend, impressions: d.impressions,
                 clicks: d.clicks, lpCount: d.lpCount, cvCount: d.cvCount };
      });
      arr.sort(function(a, b) { return b.spend - a.spend; });
      return arr.slice(0, 20);

    } catch(e) {
      Logger.log('SectionAPI[' + i + '] 例外: ' + e.toString());
    }
  }

  Logger.log('全URLで取得失敗');
  return [];
}

// ================================================
// 掲載面集計シートへ書き込み
// 列: B=掲載面名 C=配信金額 D=CPC E=CPM F=Imp G=Click H=CTR
//     I=LP遷移数 J=LP遷移率 K=LPCVR L=CV数 M=CVR N=CPA
// ================================================
function writeSectionSheet(sheet, sectionData, startDate, endDate) {
  var lastRow = sheet.getLastRow();
  if (lastRow >= 6) {
    sheet.getRange(6, 1, lastRow - 5, 20).clearContent();
    sheet.getRange(6, 1, lastRow - 5, 20).clearFormat();
  }

  var currentRow = 6;

  sheet.getRange(currentRow, 2, 1, 13)
       .setValues([['■ 掲載面集計（ホワイト・全CPN合算）　' + startDate + ' 〜 ' + endDate,
                    '', '', '', '', '', '', '', '', '', '', '', '']])
       .setFontWeight('bold').setFontSize(12)
       .setBackground('#4472C4').setFontColor('#FFFFFF')
       .setVerticalAlignment('middle');
  currentRow++;

  var headers = ['掲載面名', '配信金額', 'CPC', 'CPM', 'Imp', 'Click', 'CTR',
                 'LP遷移数', 'LP遷移率', 'LPCVR', 'CV数', 'CVR', 'CPA'];
  sheet.getRange(currentRow, 2, 1, headers.length).setValues([headers]);
  sheet.getRange(currentRow, 2, 1, headers.length)
       .setFontWeight('bold').setBackground('#D9E1F2').setHorizontalAlignment('center')
       .setFontSize(12).setVerticalAlignment('middle');
  currentRow++;

  var dataStartRow = currentRow;
  if (sectionData.length > 0) {
    var values = sectionData.map(function(d) {
      return [
        d.sectionName,
        convertSpend(d.spend),
        '', // CPC
        '', // CPM
        d.impressions,
        d.clicks,
        '', // CTR
        d.lpCount,
        '', // LP遷移率
        '', // LPCVR
        d.cvCount,
        '', // CVR
        ''  // CPA
      ];
    });
    sheet.getRange(dataStartRow, 2, values.length, 13).setValues(values);
    sheet.getRange(dataStartRow, 2, sectionData.length, 13).setFontSize(12).setVerticalAlignment('middle');

    // 数値フォーマット
    sheet.getRange(dataStartRow, 3,  sectionData.length, 1).setNumberFormat('¥#,##0'); // 配信金額
    sheet.getRange(dataStartRow, 6,  sectionData.length, 1).setNumberFormat('#,##0');  // Imp
    sheet.getRange(dataStartRow, 7,  sectionData.length, 1).setNumberFormat('#,##0');  // Click
    sheet.getRange(dataStartRow, 9,  sectionData.length, 1).setNumberFormat('#,##0');  // LP遷移数
    sheet.getRange(dataStartRow, 12, sectionData.length, 1).setNumberFormat('#,##0');  // CV数
    sheet.getRange(dataStartRow, 3,  sectionData.length, 13).setHorizontalAlignment('right');

    for (var i = 0; i < sectionData.length; i++) { setSectionFormulas(sheet, dataStartRow + i); }

    // 列幅
    sheet.setColumnWidth(2,  300); // 掲載面名
    sheet.setColumnWidth(3,  110); // 配信金額
    sheet.setColumnWidth(4,  80);  // CPC
    sheet.setColumnWidth(5,  80);  // CPM
    sheet.setColumnWidth(6,  100); // Imp
    sheet.setColumnWidth(7,  80);  // Click
    sheet.setColumnWidth(8,  75);  // CTR
    sheet.setColumnWidth(9,  80);  // LP遷移数
    sheet.setColumnWidth(10, 75);  // LP遷移率
    sheet.setColumnWidth(11, 75);  // LPCVR
    sheet.setColumnWidth(12, 70);  // CV数
    sheet.setColumnWidth(13, 75);  // CVR
    sheet.setColumnWidth(14, 90);  // CPA
  } else {
    sheet.getRange(currentRow, 2).setValue('(該当期間に掲載面データなし)');
  }

  Logger.log('掲載面シート書き込み完了。件数: ' + sectionData.length);
}

// 列: B=2(掲載面名) C=3(配信金額) D=4(CPC) E=5(CPM) F=6(Imp) G=7(Click) H=8(CTR)
//     I=9(LP遷移数) J=10(LP遷移率) K=11(LPCVR) L=12(CV数) M=13(CVR) N=14(CPA)
function setSectionFormulas(sheet, row) {
  var spend = 'C' + row;
  var imp   = 'F' + row;
  var click = 'G' + row;
  var lp    = 'I' + row;
  var cv    = 'L' + row;

  sheet.getRange(row, 4).setFormula('=IFERROR(ROUND(' + spend + '/' + click + ',1),"")');          // CPC
  sheet.getRange(row, 5).setFormula('=IFERROR(ROUND(' + spend + '/' + imp + '*1000,1),"")');        // CPM
  sheet.getRange(row, 8).setFormula('=IFERROR(TEXT(' + click + '/' + imp + ',"0.00%"),"")');        // CTR
  sheet.getRange(row, 10).setFormula('=IFERROR(TEXT(' + lp + '/' + click + ',"0.00%"),"")');        // LP遷移率
  sheet.getRange(row, 11).setFormula('=IFERROR(TEXT(' + cv + '/' + lp + ',"0.00%"),"")');           // LPCVR
  sheet.getRange(row, 13).setFormula('=IFERROR(TEXT(' + cv + '/' + click + ',"0.00%"),"")');        // CVR
  sheet.getRange(row, 14).setFormula('=IF(' + cv + '=0,"‐",IFERROR(ROUND(' + spend + '/' + cv + ',0),"‐"))'); // CPA
}

function updateCpnDropdown(sheet, cpnList) {
  var options = ['全体'];
  cpnList.forEach(function(c) { options.push(c.campaignName); });
  sheet.getRange('C4').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(options, true).build()
  );
}

// タブ名「掲載面③」→「掲載面②」にリネームするワンタイム関数
function renameSheet() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName('掲載面③');
  if (!src) { SpreadsheetApp.getUi().alert('「掲載面③」シートが見つかりませんでした。'); return; }
  var old = ss.getSheetByName('掲載面②');
  if (old) ss.deleteSheet(old);
  src.setName('掲載面②');
  SpreadsheetApp.getUi().alert('「掲載面③」→「掲載面②」に変更しました。');
}

function initSectionSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SECTION_SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(SECTION_SHEET_NAME); }

  sheet.getRange('B2').setValue('開始日').setFontWeight('bold').setFontSize(12);
  sheet.getRange('B3').setValue('終了日').setFontWeight('bold').setFontSize(12);
  sheet.getRange('B4').setValue('CPN選択').setFontWeight('bold').setFontSize(12);
  sheet.getRange('C4').setValue('全体');
  sheet.getRange('C4').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['全体'], true).build()
  );
  sheet.setColumnWidth(2, 100); sheet.setColumnWidth(3, 220);
  SpreadsheetApp.getUi().alert('「掲載面②」シートを初期化しました。');
}

function runSectionReport() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SECTION_SHEET_NAME);

  if (!sheet) {
    SpreadsheetApp.getUi().alert('「掲載面②」シートが見つかりません。\n「⚙ シート初期化」を先に実行してください。');
    return;
  }

  var ui       = SpreadsheetApp.getUi();
  var startVal = sheet.getRange('C2').getValue();
  var endVal   = sheet.getRange('C3').getValue();
  if (!startVal || !endVal) { ui.alert('開始日（C2）と終了日（C3）を入力してください。'); return; }

  var startDate = formatDateForAPI(startVal);
  var endDate   = formatDateForAPI(endVal);
  if (!startDate || !endDate) { ui.alert('日付の形式が正しくありません。\n例: 2026/04/01'); return; }

  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = props.getProperty('OB_MARKETER_ID') || '0033e4d3d312b31c84630c2166acec7b27';
  var lpConv     = props.getProperty('LP_CONV_NAME')   || LP_CONV_DEFAULT;
  var cvConv     = props.getProperty('CV_CONV_NAME')   || CV_CONV_DEFAULT;

  if (!username || !password) {
    ui.alert('OB_USERNAME / OB_PASSWORD が未設定です。\nApps Script > プロジェクトの設定 > スクリプトプロパティ に設定してください。');
    return;
  }

  var token = getOutbrainToken(username, password);
  if (!token) { ui.alert('Outbrain認証失敗。'); return; }

  var campaignMap = buildCampaignMap(token, marketerId);
  var cpnList     = getActiveCampaignIds(token, marketerId, startDate, endDate, campaignMap);
  if (cpnList.length > 0) updateCpnDropdown(sheet, cpnList);

  Logger.log('掲載面集計開始(ホワイト): ' + startDate + ' 〜 ' + endDate);
  var sectionData = getSectionData(token, marketerId, startDate, endDate, lpConv, cvConv);
  Logger.log('取得掲載面数: ' + sectionData.length);

  writeSectionSheet(sheet, sectionData, startDate, endDate);
  SpreadsheetApp.flush();

  ui.alert(
    '掲載面集計完了！（ホワイト）\n' +
    '掲載面数: ' + sectionData.length + '件（上位20件・全CPN合算）\n\n' +
    '⚠ LP遷移数が0の場合、スクリプトプロパティ LP_CONV_NAME を確認してください（現在: ' + lpConv + '）'
  );
}

function debugSectionApi() {
  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = props.getProperty('OB_MARKETER_ID') || '0033e4d3d312b31c84630c2166acec7b27';

  var token = getOutbrainToken(username, password);
  if (!token) { Logger.log('認証失敗'); return; }

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SECTION_SHEET_NAME);
  var from, to;
  if (sheet) {
    from = formatDateForAPI(sheet.getRange('C2').getValue());
    to   = formatDateForAPI(sheet.getRange('C3').getValue());
  }
  if (!from || !to) {
    var today = new Date();
    from = formatDateForAPI(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000));
    to   = formatDateForAPI(today);
  }

  var tests = [
    { label: 'publishers/periodic + includeConversionDetails',
      url: BASE_URL + '/reports/marketers/' + marketerId + '/publishers/periodic?from=' + from + '&to=' + to + '&includeConversionDetails=true&limit=3' },
    { label: 'sections + includeConversionDetails',
      url: BASE_URL + '/reports/marketers/' + marketerId + '/sections?from=' + from + '&to=' + to + '&includeConversionDetails=true&limit=3' },
    { label: 'publishers + includeConversionDetails',
      url: BASE_URL + '/reports/marketers/' + marketerId + '/publishers?from=' + from + '&to=' + to + '&includeConversionDetails=true&limit=3' }
  ];

  tests.forEach(function(t) {
    try {
      var resp = UrlFetchApp.fetch(t.url, { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true });
      Logger.log('=== ' + t.label + ' ===');
      Logger.log('status: ' + resp.getResponseCode());
      Logger.log('response: ' + resp.getContentText().substring(0, 800));
    } catch(e) {
      Logger.log('=== ' + t.label + ' 例外: ' + e.toString());
    }
    Utilities.sleep(300);
  });
  Logger.log('=== 完了 ===');
}

function listConversionNames() {
  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = props.getProperty('OB_MARKETER_ID') || '0033e4d3d312b31c84630c2166acec7b27';
  var token = getOutbrainToken(username, password);
  if (!token) { Logger.log('認証失敗'); return; }

  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SECTION_SHEET_NAME);
  var from = sheet ? formatDateForAPI(sheet.getRange('C2').getValue()) : null;
  var to   = sheet ? formatDateForAPI(sheet.getRange('C3').getValue()) : null;
  if (!from || !to) {
    var today = new Date();
    from = formatDateForAPI(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000));
    to   = formatDateForAPI(today);
  }

  var url  = BASE_URL + '/reports/marketers/' + marketerId + '/sections?from=' + from + '&to=' + to + '&includeConversionDetails=true&limit=5';
  var resp = UrlFetchApp.fetch(url, { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true });
  Logger.log('status=' + resp.getResponseCode());
  var data    = JSON.parse(resp.getContentText());
  var results = data.results || [];

  var names = {};
  results.forEach(function(item) {
    (item.metrics.conversionMetrics || []).forEach(function(cm) {
      names[cm.name] = (names[cm.name] || 0) + (cm.conversions || 0);
    });
  });

  Logger.log('=== ホワイト コンバージョン名一覧 ===');
  Object.keys(names).forEach(function(n) { Logger.log('  "' + n + '" : ' + names[n]); });
  if (Object.keys(names).length === 0) Logger.log('  (conversionMetrics が空です)');
}
