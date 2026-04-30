/**
 * ===============================================
 * Outbrain 掲載面集計スクリプト（独立プロジェクト）
 * 対象スプレッドシート：山忠様案件_数値集計
 * 書き込み先シート：掲載面
 * ===============================================
 *
 * 【初期設定】
 * Apps Script エディタで「プロジェクトの設定」→「スクリプトプロパティ」に以下を追加：
 *   OB_USERNAME : Outbrainのログインメールアドレス（miraikirei）
 *   OB_PASSWORD : Outbrainのパスワード
 *   ※ OB_MARKETER_ID はコードに埋め込み済み（変更不要）
 *
 * 【コンバージョン名（固定設定済み・変更不要）】
 *   LP遷移数(W) → "1Day 01 LP walking"
 *   LP遷移数(B) → "1Day 01LP basic"
 *   カート追加  → "Add to cart　NEW(4/7~)"
 *   CV数        → "thanks 01day"
 */

var BASE_URL           = 'https://api.outbrain.com/amplify/v0.1';
var SPREADSHEET_ID     = '1wu3A_qGBWUOkafOHHHfG_xVe7oBIi4l5j-qwxU0sDhc';
var SECTION_SHEET_NAME = '掲載面';
var MARKETER_ID        = '007d79ad320ca3facfae0f6c585b8a46f1';

var LP_W_CONV  = '1Day 01 LP walking';
var LP_B_CONV  = '1Day 01LP basic';
var CART_CONV  = 'Add to cart　NEW(4/7~)'; // 全角スペースあり
var CV_CONV    = 'thanks 01day';

var TOKEN_CACHE_KEY    = 'OB_SECTION_T_TOKEN_CACHE';
var TOKEN_CACHE_TS_KEY = 'OB_SECTION_T_TOKEN_CACHE_TS';
var TOKEN_TTL_MS       = 4 * 60 * 60 * 1000;

// ================================================
// カスタムメニュー
// ================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 掲載面集計')
    .addItem('▶ 掲載面集計実行', 'runSectionReport')
    .addSeparator()
    .addItem('🔍 掲載面APIデバッグ', 'debugSectionApi')
    .addItem('🔍 CPN名デバッグ', 'debugCampaignNames')
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

// ================================================
// 配信金額変換（API値 → 管理画面表示値）
// ================================================
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

// ================================================
// 認証トークン取得（キャッシュ付き）
// ================================================
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

// ================================================
// キャンペーンマップ取得（reports/campaigns を使用）
// reports/campaigns の metadata.id は campaigns/periodic の campaignId と一致する
// ================================================
function buildCampaignMap(token, from, to) {
  var map = {};
  try {
    var response = UrlFetchApp.fetch(
      BASE_URL + '/reports/marketers/' + MARKETER_ID + '/campaigns?from=' + from + '&to=' + to + '&limit=200',
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

// ================================================
// 期間内に配信があったCPNのIDリスト取得
// ================================================
function getActiveCampaignIds(token, from, to, campaignMap) {
  var results = [];
  try {
    var url    = BASE_URL + '/reports/marketers/' + MARKETER_ID + '/campaigns/periodic';
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
// ================================================
function getSectionData(token, targetCpnId, from, to) {
  var sectionMap = {};

  var baseCD = '?from=' + from + '&to=' + to + '&includeConversionDetails=true&limit=500';
  // CPN指定時: periodicエンドポイント（パターンB）を優先しJS側でcampaignIdフィルタ
  //   → sections/periodic → publishers/periodic の順（500が返ることがある）
  //   → フォールバック: sections/publishers に campaignId URLパラメータ（サーバー側フィルタ）
  // 全体表示時: sections（パターンA）を優先
  var tryUrls = targetCpnId
    ? [
        BASE_URL + '/reports/marketers/' + MARKETER_ID + '/sections/periodic'   + baseCD,
        BASE_URL + '/reports/marketers/' + MARKETER_ID + '/publishers/periodic' + baseCD,
        BASE_URL + '/reports/marketers/' + MARKETER_ID + '/sections'   + baseCD + '&campaignId=' + targetCpnId,
        BASE_URL + '/reports/marketers/' + MARKETER_ID + '/publishers' + baseCD + '&campaignId=' + targetCpnId
      ]
    : [
        BASE_URL + '/reports/marketers/' + MARKETER_ID + '/sections'            + baseCD,
        BASE_URL + '/reports/marketers/' + MARKETER_ID + '/publishers'          + baseCD,
        BASE_URL + '/reports/marketers/' + MARKETER_ID + '/publishers/periodic' + baseCD
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

      // パターンB: campaignResults[].results[] 構造（publishers/periodic）
      var campaignResults = data.campaignResults || [];
      if (campaignResults.length > 0) {
        Logger.log('SectionAPI パターンB campaignResults件数=' + campaignResults.length);
        campaignResults.forEach(function(camp) {
          if (targetCpnId && camp.campaignId !== targetCpnId) return;
          (camp.results || []).forEach(function(r) {
            var meta        = r.metadata || {};
            var sectionName = meta.sectionName || meta.section || meta.publisherName || meta.publisher ||
                              meta.name || (meta.id ? String(meta.id) : '不明');
            var m    = r.metrics || {};
            var lpW  = 0, lpB = 0, cart = 0, cv = 0;
            (m.conversionMetrics || []).forEach(function(cm) {
              var name = (cm.name || '').trim();
              var val  = cm.conversions || 0;
              if (name === LP_W_CONV)  lpW  += val;
              if (name === LP_B_CONV)  lpB  += val;
              if (name === CART_CONV)  cart += val;
              if (name === CV_CONV)    cv   += val;
            });
            if (cv === 0) cv = m.conversions || 0;

            if (!sectionMap[sectionName]) {
              sectionMap[sectionName] = { spend: 0, impressions: 0, clicks: 0, lpW: 0, lpB: 0, cart: 0, cv: 0 };
            }
            sectionMap[sectionName].spend       += (m.spend       || 0);
            sectionMap[sectionName].impressions += (m.impressions || 0);
            sectionMap[sectionName].clicks      += (m.clicks      || 0);
            sectionMap[sectionName].lpW         += lpW;
            sectionMap[sectionName].lpB         += lpB;
            sectionMap[sectionName].cart        += cart;
            sectionMap[sectionName].cv          += cv;
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
          var m     = item.metrics || {};
          var lpW   = 0, lpB = 0, cart = 0, cv = 0;
          (m.conversionMetrics || []).forEach(function(cm) {
            var name = (cm.name || '').trim();
            var val  = cm.conversions || 0;
            if (name === LP_W_CONV)  lpW  += val;
            if (name === LP_B_CONV)  lpB  += val;
            if (name === CART_CONV)  cart += val;
            if (name === CV_CONV)    cv   += val;
          });
          if (cv === 0) cv = m.conversions || 0;

          if (!sectionMap[sectionName]) {
            sectionMap[sectionName] = { spend: 0, impressions: 0, clicks: 0, lpW: 0, lpB: 0, cart: 0, cv: 0 };
          }
          sectionMap[sectionName].spend       += (m.spend       || 0);
          sectionMap[sectionName].impressions += (m.impressions || 0);
          sectionMap[sectionName].clicks      += (m.clicks      || 0);
          sectionMap[sectionName].lpW         += lpW;
          sectionMap[sectionName].lpB         += lpB;
          sectionMap[sectionName].cart        += cart;
          sectionMap[sectionName].cv          += cv;
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
    var d = sectionMap[name];
    return { sectionName: name, spend: d.spend, impressions: d.impressions,
             clicks: d.clicks, lpW: d.lpW, lpB: d.lpB, cart: d.cart, cv: d.cv };
  });
  arr.sort(function(a, b) { return b.spend - a.spend; });
  return arr.slice(0, 20);
}

// ================================================
// 掲載面集計シートへ書き込み
// 列: B=掲載面名 C=配信金額 D=CPC E=CPM F=Imp G=Click H=CTR
//     I=LP遷移数(W) J=LP遷移率(W) K=LP遷移数(B) L=LP遷移率(B)
//     M=カート追加 N=カート率 O=CV数 P=CVR Q=CPA
// ================================================
function writeSectionSheet(sheet, sectionData, startDate, endDate, selectedCpn) {
  var lastRow = sheet.getLastRow();
  if (lastRow >= 6) {
    sheet.getRange(6, 1, lastRow - 5, 20).clearContent();
    sheet.getRange(6, 1, lastRow - 5, 20).clearFormat();
  }

  var currentRow = 6;
  var label      = (selectedCpn === '全体') ? '全体' : selectedCpn;

  // タイトル行
  sheet.getRange(currentRow, 2, 1, 16)
       .setValues([['■ 掲載面集計（' + label + '）　' + startDate + ' 〜 ' + endDate,
                    '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']])
       .setFontWeight('bold').setFontSize(12)
       .setBackground('#7030A0').setFontColor('#FFFFFF')
       .setVerticalAlignment('middle');
  currentRow++;

  // ヘッダー行
  var headers = ['掲載面名', '配信金額', 'CPC', 'CPM', 'Imp', 'Click', 'CTR',
                 'LP遷移数(W)', 'LP遷移率(W)', 'LP遷移数(B)', 'LP遷移率(B)',
                 'カート追加', 'カート率', 'CV数', 'CVR', 'CPA'];
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
        d.lpW,
        '', // LP遷移率(W)
        d.lpB,
        '', // LP遷移率(B)
        d.cart,
        '', // カート率
        d.cv,
        '', // CVR
        ''  // CPA
      ];
    });
    sheet.getRange(dataStartRow, 2, values.length, 16).setValues(values);
    sheet.getRange(dataStartRow, 2, sectionData.length, 16)
         .setFontSize(12).setVerticalAlignment('middle');

    // 数値フォーマット
    sheet.getRange(dataStartRow, 3,  sectionData.length, 1).setNumberFormat('¥#,##0'); // 配信金額
    sheet.getRange(dataStartRow, 6,  sectionData.length, 1).setNumberFormat('#,##0');  // Imp
    sheet.getRange(dataStartRow, 7,  sectionData.length, 1).setNumberFormat('#,##0');  // Click
    sheet.getRange(dataStartRow, 9,  sectionData.length, 1).setNumberFormat('#,##0');  // LP遷移数(W)
    sheet.getRange(dataStartRow, 11, sectionData.length, 1).setNumberFormat('#,##0');  // LP遷移数(B)
    sheet.getRange(dataStartRow, 13, sectionData.length, 1).setNumberFormat('#,##0');  // カート追加
    sheet.getRange(dataStartRow, 15, sectionData.length, 1).setNumberFormat('#,##0');  // CV数
    sheet.getRange(dataStartRow, 3,  sectionData.length, 16).setHorizontalAlignment('right');

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
    sheet.setColumnWidth(9,  85);  // LP遷移数(W)
    sheet.setColumnWidth(10, 80);  // LP遷移率(W)
    sheet.setColumnWidth(11, 85);  // LP遷移数(B)
    sheet.setColumnWidth(12, 80);  // LP遷移率(B)
    sheet.setColumnWidth(13, 80);  // カート追加
    sheet.setColumnWidth(14, 75);  // カート率
    sheet.setColumnWidth(15, 70);  // CV数
    sheet.setColumnWidth(16, 75);  // CVR
    sheet.setColumnWidth(17, 90);  // CPA
  } else {
    sheet.getRange(currentRow, 2).setValue('(該当期間に掲載面データなし)');
  }

  Logger.log('掲載面シート書き込み完了。掲載面数: ' + sectionData.length);
}

// ================================================
// 数式セット
// 列番号: B=2 C=3 D=4 E=5 F=6 G=7 H=8
//         I=9 J=10 K=11 L=12 M=13 N=14 O=15 P=16 Q=17
// ================================================
function setSectionFormulas(sheet, row) {
  var spend = 'C' + row;
  var imp   = 'F' + row;
  var click = 'G' + row;
  var lpW   = 'I' + row;
  var lpB   = 'K' + row;
  var cart  = 'M' + row;
  var cv    = 'O' + row;

  sheet.getRange(row, 4).setFormula('=IFERROR(ROUND(' + spend + '/' + click + ',1),"")');           // CPC
  sheet.getRange(row, 5).setFormula('=IFERROR(ROUND(' + spend + '/' + imp + '*1000,1),"")');         // CPM
  sheet.getRange(row, 8).setFormula('=IFERROR(TEXT(' + click + '/' + imp + ',"0.00%"),"")');         // CTR
  sheet.getRange(row, 10).setFormula('=IFERROR(TEXT(' + lpW + '/' + click + ',"0.00%"),"")');        // LP遷移率(W)
  sheet.getRange(row, 12).setFormula('=IFERROR(TEXT(' + lpB + '/' + click + ',"0.00%"),"")');        // LP遷移率(B)
  sheet.getRange(row, 14).setFormula('=IFERROR(TEXT(' + cart + '/' + click + ',"0.00%"),"")');       // カート率
  sheet.getRange(row, 16).setFormula('=IFERROR(TEXT(' + cv + '/' + click + ',"0.00%"),"")');         // CVR
  sheet.getRange(row, 17).setFormula('=IF(' + cv + '=0,"‐",IFERROR(ROUND(' + spend + '/' + cv + ',0),"‐"))'); // CPA
}

// ================================================
// CPN ドロップダウン更新
// ================================================
function updateCpnDropdown(sheet, cpnList) {
  var options = ['全体'];
  cpnList.forEach(function(c) { options.push(c.campaignName); });
  sheet.getRange('C4').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(options, true).build()
  );
}

// ================================================
// シート初期化
// ================================================
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

// ================================================
// メイン実行
// ================================================
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

  var props    = PropertiesService.getScriptProperties();
  var username = props.getProperty('OB_USERNAME');
  var password = props.getProperty('OB_PASSWORD');

  if (!username || !password) {
    tryAlert('OB_USERNAME / OB_PASSWORD が未設定です。\nApps Script > プロジェクトの設定 > スクリプトプロパティ に設定してください。');
    return;
  }

  var token = getOutbrainToken(username, password);
  if (!token) { tryAlert('Outbrain認証失敗。'); return; }

  var campaignMap = buildCampaignMap(token, startDate, endDate);
  var cpnList     = getActiveCampaignIds(token, startDate, endDate, campaignMap);
  if (cpnList.length === 0) { tryAlert('指定期間に配信データがありませんでした。'); return; }

  updateCpnDropdown(sheet, cpnList);

  var targetCpnId = null;
  if (cpnSel !== '全体') {
    // cpnList から名前でIDを逆引き（campaignMapより確実）
    for (var j = 0; j < cpnList.length; j++) {
      if (cpnList[j].campaignName === cpnSel) { targetCpnId = cpnList[j].campaignId; break; }
    }
    if (!targetCpnId) {
      tryAlert('選択されたCPN「' + cpnSel + '」が期間中の配信データに見つかりません。\n「全体」に切り替えて再実行してください。');
      return;
    }
  }

  var sectionData = getSectionData(token, targetCpnId, startDate, endDate);
  Logger.log('取得掲載面数: ' + sectionData.length);

  writeSectionSheet(sheet, sectionData, startDate, endDate, cpnSel);
  SpreadsheetApp.flush();

  tryAlert(
    '掲載面集計完了！\n' +
    '対象: ' + cpnSel + '\n' +
    '掲載面数: ' + sectionData.length + '件（上位20件）'
  );
}

// ================================================
// デバッグ
// ================================================
function debugSectionApi() {
  var props    = PropertiesService.getScriptProperties();
  var username = props.getProperty('OB_USERNAME');
  var password = props.getProperty('OB_PASSWORD');

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
    { label: 'sections（periodicなし）',
      url: BASE_URL + '/reports/marketers/' + MARKETER_ID + '/sections?from=' + from + '&to=' + to + '&includeConversionDetails=true&limit=3' },
    { label: 'publishers',
      url: BASE_URL + '/reports/marketers/' + MARKETER_ID + '/publishers?from=' + from + '&to=' + to + '&includeConversionDetails=true&limit=3' }
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

// ================================================
// CPN名デバッグ（管理APIとreporting APIのID対照）
// ================================================
function debugCampaignNames() {
  var props    = PropertiesService.getScriptProperties();
  var username = props.getProperty('OB_USERNAME');
  var password = props.getProperty('OB_PASSWORD');
  var token    = getOutbrainToken(username, password);
  if (!token) { Logger.log('認証失敗'); return; }

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SECTION_SHEET_NAME);
  var from  = formatDateForAPI(sheet ? sheet.getRange('C2').getValue() : null);
  var to    = formatDateForAPI(sheet ? sheet.getRange('C3').getValue() : null);
  if (!from || !to) {
    var today = new Date(); from = formatDateForAPI(new Date(today - 7*864e5)); to = formatDateForAPI(today);
  }

  // (A) reports/campaigns（periodicなし）でIDと名前が取れるか確認
  Logger.log('=== (A) reports/campaigns（periodicなし）===');
  var rCampResp = UrlFetchApp.fetch(
    BASE_URL + '/reports/marketers/' + MARKETER_ID + '/campaigns?from=' + from + '&to=' + to + '&limit=5',
    { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true }
  );
  Logger.log('status: ' + rCampResp.getResponseCode());
  Logger.log('response: ' + rCampResp.getContentText().substring(0, 1000));

  // (B) sections API 最初の1件のmetadata全体を確認
  Logger.log('=== (B) sections API 最初の1件のmetadata ===');
  var secResp = UrlFetchApp.fetch(
    BASE_URL + '/reports/marketers/' + MARKETER_ID + '/sections?from=' + from + '&to=' + to + '&includeConversionDetails=false&limit=3',
    { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true }
  );
  Logger.log('status: ' + secResp.getResponseCode());
  var secData = JSON.parse(secResp.getContentText());
  (secData.results || []).slice(0, 2).forEach(function(r) {
    Logger.log('section metadata: ' + JSON.stringify(r.metadata || {}));
  });

  // (C) 管理API: id と internalId を確認
  Logger.log('=== (C) 管理API /campaigns id確認 ===');
  var mgmtResp = UrlFetchApp.fetch(
    BASE_URL + '/marketers/' + MARKETER_ID + '/campaigns?limit=5',
    { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true }
  );
  var mgmtData = JSON.parse(mgmtResp.getContentText());
  (mgmtData.campaigns || []).slice(0, 3).forEach(function(c) {
    Logger.log('管理id=' + c.id + ' internalId=' + c.internalId + ' name=' + c.name);
  });

  Logger.log('=== CPN名デバッグ完了 ===');
}
