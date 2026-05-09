/**
 * ===============================================
 * Outbrain 掲載面集計スクリプト（独立プロジェクト）
 * 対象スプレッドシート：ブリリオ配信戦略
 * 書き込み先シート：掲載面
 * ===============================================
 *
 * 【初期設定】
 * Apps Script エディタで「プロジェクトの設定」→「スクリプトプロパティ」に以下を追加：
 *   OB_USERNAME    : Outbrainのログインメールアドレス
 *   OB_PASSWORD    : Outbrainのパスワード
 *   OB_MARKETER_ID : 00af75b8e5565b04764d17c4f90cb25caf  ← ブリリオのID（固定）
 *   LP_CONV_NAME   : LP遷移コンバージョン名（省略時: 01 LP 01d）
 *   CV_CONV_NAME   : CVコンバージョン名（省略時: 03 all thanks 01d）
 */

var BASE_URL           = 'https://api.outbrain.com/amplify/v0.1';
var SPREADSHEET_ID     = '1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8';
var SECTION_SHEET_NAME = '掲載面';

var LP_CONV_DEFAULT      = '01 LP 01d';
var CONFIRM_CONV_DEFAULT = '02 confirm 01d';
var CV_CONV_DEFAULT      = '03 all thanks 01d';

var TOKEN_CACHE_KEY    = 'OB_SECTION_TOKEN_CACHE';
var TOKEN_CACHE_TS_KEY = 'OB_SECTION_TOKEN_CACHE_TS';
var TOKEN_TTL_MS       = 4 * 60 * 60 * 1000;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 掲載面集計')
    .addItem('▶ 掲載面集計実行', 'runSectionReport')
    .addSeparator()
    .addItem('🔍 掲載面APIデバッグ', 'debugSectionApi')
    .addItem('⚙ シート初期化', 'initSectionSheet')
    .addToUi();
}

function tryAlert(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('RESULT: ' + msg); }
}

function installTrigger() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onOpen') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onOpen').forSpreadsheet(ss).onOpen().create();
  Logger.log('トリガー登録完了');
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

// reports/campaigns を使う（metadata.id が periodic の campaignId と一致するため）
function buildCampaignMap(token, marketerId, from, to) {
  var map = {};
  try {
    var response = UrlFetchApp.fetch(
      BASE_URL + '/reports/marketers/' + marketerId + '/campaigns?from=' + from + '&to=' + to + '&limit=200',
      { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true }
    );
    if (response.getResponseCode() !== 200) return map;
    var data = JSON.parse(response.getContentText());
    (data.results || []).forEach(function(r) {
      var meta = r.metadata || {};
      if (meta.id && meta.name) map[meta.id] = meta.name;
    });
    Logger.log('buildCampaignMap: ' + Object.keys(map).length + '件取得');
  } catch(e) {
    Logger.log('buildCampaignMap 例外: ' + e.toString());
  }
  return map;
}

function getActiveCampaignIds(token, marketerId, from, to, campaignMap) {
  var results = [];
  try {
    var url    = BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic';
    var params = '?from=' + from + '&to=' + to + '&includeConversionDetails=false';
    var resp   = UrlFetchApp.fetch(url + params, {
      headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return results;
    var data = JSON.parse(resp.getContentText());
    (data.campaignResults || []).forEach(function(camp) {
      var spend = 0;
      (camp.results || []).forEach(function(r) { spend += ((r.metrics || {}).spend || 0); });
      if (spend >= 1) {
        var name = campaignMap[camp.campaignId] || camp.campaignId;
        Logger.log('CPN: id=' + camp.campaignId + ' name=' + name);
        results.push({ campaignId: camp.campaignId, campaignName: name });
      }
    });
  } catch(e) {
    Logger.log('getActiveCampaignIds 例外: ' + e.toString());
  }
  return results;
}

// ================================================
// 掲載面データ取得（上位20件）
// CPN指定時: periodic優先（JS側でcampaignIdフィルタ）→ URLパラメータフォールバック
// 全体表示時: sections → publishers → publishers/periodic
// ================================================
function getSectionData(token, marketerId, targetCpnId, from, to, lpConv, cvConv) {
  var sectionMap = {};

  var baseCD = '?from=' + from + '&to=' + to + '&includeConversionDetails=true&limit=500';
  var tryUrls = targetCpnId
    ? [
        BASE_URL + '/reports/marketers/' + marketerId + '/sections/periodic'   + baseCD,
        BASE_URL + '/reports/marketers/' + marketerId + '/publishers/periodic' + baseCD,
        BASE_URL + '/reports/marketers/' + marketerId + '/sections'   + baseCD + '&campaignId=' + targetCpnId,
        BASE_URL + '/reports/marketers/' + marketerId + '/publishers' + baseCD + '&campaignId=' + targetCpnId
      ]
    : [
        BASE_URL + '/reports/marketers/' + marketerId + '/sections'            + baseCD,
        BASE_URL + '/reports/marketers/' + marketerId + '/publishers'          + baseCD,
        BASE_URL + '/reports/marketers/' + marketerId + '/publishers/periodic' + baseCD
      ];

  var succeeded = false;

  for (var i = 0; i < tryUrls.length; i++) {
    try {
      Logger.log('SectionAPI[' + i + '] ' + tryUrls[i].substring(0, 120));
      var resp = UrlFetchApp.fetch(tryUrls[i], {
        headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      Logger.log('SectionAPI[' + i + '] status=' + code);
      if (code !== 200) {
        Logger.log('SectionAPI[' + i + '] error: ' + resp.getContentText().substring(0, 300));
        continue;
      }

      var data = JSON.parse(resp.getContentText());

      // パターンB: campaignResults[].results[] 構造（periodic）
      var campaignResults = data.campaignResults || [];
      if (campaignResults.length > 0) {
        Logger.log('SectionAPI パターンB campaignResults件数=' + campaignResults.length);
        campaignResults.forEach(function(camp) {
          if (targetCpnId && camp.campaignId !== targetCpnId) return;
          (camp.results || []).forEach(function(r) {
            var meta        = r.metadata || {};
            var sectionName = meta.sectionName || meta.section || meta.publisherName || meta.publisher ||
                              meta.name || (meta.id ? String(meta.id) : '不明');
            var m  = r.metrics || {};
            var lp = 0, cv = 0;
            (m.conversionMetrics || []).forEach(function(cm) {
              var name = (cm.name || '').trim();
              var val  = cm.conversions || 0;
              if (lpConv && name === lpConv) lp += val;
              if (name === cvConv) cv += val;
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
        });
        succeeded = true;
        break;
      }

      // パターンA: results[] 構造（sections / publishers）
      var flatResults = data.results || data.publisherResults || [];
      if (flatResults.length > 0) {
        Logger.log('SectionAPI パターンA 件数=' + flatResults.length);
        flatResults.forEach(function(item) {
          var meta        = item.metadata || {};
          var sectionName = meta.sectionName || meta.section || meta.publisherName || meta.publisher ||
                            meta.name || (meta.id ? String(meta.id) : '不明');
          var m  = item.metrics || {};
          var lp = 0, cv = 0;
          (m.conversionMetrics || []).forEach(function(cm) {
            var name = (cm.name || '').trim();
            var val  = cm.conversions || 0;
            if (lpConv && name === lpConv) lp += val;
            if (name === cvConv) cv += val;
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
        succeeded = true;
        break;
      }

      Logger.log('SectionAPI[' + i + '] データが空（次のURLを試みます）');
    } catch(e) {
      Logger.log('SectionAPI[' + i + '] 例外: ' + e.toString());
    }
  }

  if (!succeeded) Logger.log('全URLで掲載面データ取得失敗');

  var arr = Object.keys(sectionMap).map(function(name) {
    var item = sectionMap[name];
    return {
      sectionName: name,
      spend:       item.spend,
      impressions: item.impressions,
      clicks:      item.clicks,
      lpCount:     item.lpCount,
      cvCount:     item.cvCount
    };
  });
  arr.sort(function(a, b) { return b.spend - a.spend; });
  return arr.slice(0, 20);
}

// ================================================
// 掲載面集計シートへ書き込み
// 列: B=掲載面名 C=配信金額 D=CPC E=CPM F=Imp G=Click H=CTR
//     I=LP遷移数 J=LP遷移率 K=LPCVR L=CV数 M=CVR N=CPA
// ================================================
function writeSectionSheet(sheet, sectionData, startDate, endDate, selectedCpn) {
  var lastRow = sheet.getLastRow();
  if (lastRow >= 6) {
    sheet.getRange(6, 1, lastRow - 5, 20).clearContent();
    sheet.getRange(6, 1, lastRow - 5, 20).clearFormat();
  }

  var currentRow = 6;
  var label      = (selectedCpn === '全体') ? '全体' : selectedCpn;

  sheet.getRange(currentRow, 2, 1, 13)
       .setValues([['■ 掲載面集計（' + label + '）　' + startDate + ' 〜 ' + endDate,
                    '', '', '', '', '', '', '', '', '', '', '', '']])
       .setFontWeight('bold').setFontSize(12)
       .setBackground('#7030A0').setFontColor('#FFFFFF')
       .setVerticalAlignment('middle');
  currentRow++;

  var headers = ['掲載面名', '配信金額', 'CPC', 'CPM', 'Imp', 'Click', 'CTR',
                 'LP遷移数', 'LP遷移率', 'LPCVR', 'CV数', 'CVR', 'CPA'];
  sheet.getRange(currentRow, 2, 1, headers.length).setValues([headers]);
  sheet.getRange(currentRow, 2, 1, headers.length)
       .setFontWeight('bold').setBackground('#EAD1DC').setHorizontalAlignment('center')
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
    sheet.getRange(dataStartRow, 2, sectionData.length, 13)
         .setFontSize(12).setVerticalAlignment('middle');

    // 数値フォーマット
    sheet.getRange(dataStartRow, 3,  sectionData.length, 1).setNumberFormat('¥#,##0'); // 配信金額
    sheet.getRange(dataStartRow, 6,  sectionData.length, 1).setNumberFormat('#,##0');  // Imp
    sheet.getRange(dataStartRow, 7,  sectionData.length, 1).setNumberFormat('#,##0');  // Click
    sheet.getRange(dataStartRow, 9,  sectionData.length, 1).setNumberFormat('#,##0');  // LP遷移数
    sheet.getRange(dataStartRow, 12, sectionData.length, 1).setNumberFormat('#,##0');  // CV数
    sheet.getRange(dataStartRow, 3,  sectionData.length, 13).setHorizontalAlignment('right');

    for (var i = 0; i < sectionData.length; i++) {
      setSectionFormulas(sheet, dataStartRow + i);
    }

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

  Logger.log('掲載面シート書き込み完了。掲載面数: ' + sectionData.length);
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
  sheet.getRange(row, 10).setFormula('=IF(' + lp + '=0,"‐",IFERROR(TEXT(' + lp + '/' + click + ',"0.00%"),"‐"))');                         // LP遷移率
  sheet.getRange(row, 11).setFormula('=IF(' + lp + '=0,"‐",IF(' + cv + '=0,"‐",IFERROR(TEXT(' + cv + '/' + lp + ',"0.00%"),"‐")))');    // LPCVR
  sheet.getRange(row, 13).setFormula('=IF(' + cv + '=0,"‐",IFERROR(TEXT(' + cv + '/' + click + ',"0.00%"),"‐"))');                        // CVR
  sheet.getRange(row, 14).setFormula('=IF(' + cv + '=0,"‐",IFERROR(ROUND(' + spend + '/' + cv + ',0),"‐"))');                             // CPA
}

function updateCpnDropdown(sheet, cpnList) {
  var options = ['全体'];
  cpnList.forEach(function(c) { options.push(c.campaignName); });
  sheet.getRange('C4').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(options, true).build()
  );
}

function initSectionSheet() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SECTION_SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(SECTION_SHEET_NAME); }

  sheet.getRange('B2').setValue('開始日').setFontWeight('bold').setFontSize(12);
  sheet.getRange('B3').setValue('終了日').setFontWeight('bold').setFontSize(12);
  sheet.getRange('B4').setValue('CPN選択').setFontWeight('bold').setFontSize(12);
  sheet.getRange('C4').setValue('全体');
  sheet.getRange('C4').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['全体'], true).build()
  );
  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 220);
  tryAlert('「掲載面」シートを初期化しました。');
}

function runSectionReport() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SECTION_SHEET_NAME);
  if (!sheet) {
    tryAlert('「掲載面」シートが見つかりません。\nメニューの「⚙ シート初期化」を先に実行してください。');
    return;
  }

  var startVal = sheet.getRange('C2').getValue();
  var endVal   = sheet.getRange('C3').getValue();
  var cpnSel   = sheet.getRange('C4').getValue() || '全体';

  if (!startVal || !endVal) { tryAlert('開始日（C2）と終了日（C3）を入力してください。'); return; }

  var startDate = formatDateForAPI(startVal);
  var endDate   = formatDateForAPI(endVal);
  if (!startDate || !endDate) { tryAlert('日付の形式が正しくありません。\n例: 2026/04/01'); return; }

  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = props.getProperty('OB_MARKETER_ID') || '00af75b8e5565b04764d17c4f90cb25caf';
  var lpConv     = props.getProperty('LP_CONV_NAME')   || LP_CONV_DEFAULT;
  var cvConv     = props.getProperty('CV_CONV_NAME')   || CV_CONV_DEFAULT;

  if (!username || !password) {
    tryAlert('OB_USERNAME / OB_PASSWORD が未設定です。\nApps Script > プロジェクトの設定 > スクリプトプロパティ に設定してください。');
    return;
  }

  var token = getOutbrainToken(username, password);
  if (!token) { tryAlert('Outbrain認証失敗。'); return; }

  var campaignMap = buildCampaignMap(token, marketerId, startDate, endDate);
  var cpnList     = getActiveCampaignIds(token, marketerId, startDate, endDate, campaignMap);
  if (cpnList.length === 0) { tryAlert('指定期間に配信データがありませんでした。'); return; }

  updateCpnDropdown(sheet, cpnList);

  var targetCpnId = null;
  if (cpnSel !== '全体') {
    for (var j = 0; j < cpnList.length; j++) {
      if (cpnList[j].campaignName === cpnSel) { targetCpnId = cpnList[j].campaignId; break; }
    }
    if (!targetCpnId) {
      tryAlert('選択されたCPN「' + cpnSel + '」が期間中の配信データに見つかりません。\n「全体」に切り替えて再実行してください。');
      return;
    }
  }

  var sectionData = getSectionData(token, marketerId, targetCpnId, startDate, endDate, lpConv, cvConv);
  Logger.log('取得掲載面数: ' + sectionData.length);

  writeSectionSheet(sheet, sectionData, startDate, endDate, cpnSel);
  SpreadsheetApp.flush();

  tryAlert(
    '掲載面集計完了！\n' +
    '対象: ' + cpnSel + '\n' +
    '掲載面数: ' + sectionData.length + '件（上位20件）\n\n' +
    '⚠ LP遷移数が0の場合、スクリプトプロパティ LP_CONV_NAME を確認してください（現在: ' + lpConv + '）'
  );
}

function debugSectionApi() {
  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = props.getProperty('OB_MARKETER_ID') || '00af75b8e5565b04764d17c4f90cb25caf';

  var token = getOutbrainToken(username, password);
  if (!token) { Logger.log('認証失敗'); return; }

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
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
    { label: 'sections（periodicなし）',
      url: BASE_URL + '/reports/marketers/' + marketerId + '/sections?from=' + from + '&to=' + to + '&limit=3' }
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
  Logger.log('=== デバッグ完了 ===');
}
