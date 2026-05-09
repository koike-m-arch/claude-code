/**
 * ===============================================
 * Outbrain 日別集計スクリプト（ホワイト）
 * 対象スプレッドシート：ブリリオ配信戦略
 * 書き込み先シート：日別（ホワイト）
 * ===============================================
 *
 * 【使い方】
 * 1. GASプロジェクト 13Iqm9jorlzjGMLDUrL1GgKbKxq-SVAslLzLm52CULfw2Zd9J98It7GMq
 *    に「日別集計_ホワイト」ファイルとして配置済み
 * 2. スクリプトプロパティに以下を設定：
 *    OB_USERNAME         : Outbrainのログインメールアドレス
 *    OB_PASSWORD         : Outbrainのパスワード
 *    OB_MARKETER_ID      : 0033e4d3d312b31c84630c2166acec7b27
 *    WHITE_LP_CONV_NAME  : LP遷移コンバージョン名（任意）
 *    WHITE_CONFIRM_CONV_NAME : 確認画面遷移コンバージョン名（任意）
 *    WHITE_CV_CONV_NAME  : CVコンバージョン名（任意）
 * 3. 「日別（ホワイト）」シートで C2=開始日、C3=終了日 を入力
 * 4. C4 でCPN選択（全体 or 個別）してメニューから実行
 *
 * 【トークンキャッシュ】
 * UserProperties（OB_TOKEN_CACHE / OB_TOKEN_CACHE_TS）を使用。
 * ブリリオと同一ユーザーであれば同じキャッシュを共有するため
 * 429レート制限を回避できる。
 */

var WHITE_BASE_URL   = 'https://api.outbrain.com/amplify/v0.1';
var WHITE_SS_ID      = '1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8';
var WHITE_SHEET_NAME = '日別（ホワイト）';

var WHITE_LP_CONV_DEFAULT      = '01 LP 01d';
var WHITE_CONFIRM_CONV_DEFAULT = '02 confirm 01d';
var WHITE_CV_CONV_DEFAULT      = '03 all thanks 01d';

var WHITE_MARKETER_DEFAULT = '0033e4d3d312b31c84630c2166acec7b27';

// UserProperties でブリリオと共有（429対策）
var WHITE_TOKEN_KEY    = 'OB_TOKEN_CACHE';
var WHITE_TOKEN_TS_KEY = 'OB_TOKEN_CACHE_TS';
var WHITE_TOKEN_TTL    = 4 * 60 * 60 * 1000;

// ================================================
// カスタムメニュー
// ================================================
function onOpenWhite() {
  SpreadsheetApp.getUi()
    .createMenu('📅 日別集計（ホワイト）')
    .addItem('▶ 日別集計実行', 'runWhiteDailyReport')
    .addSeparator()
    .addItem('⚙ シート初期化', 'initWhiteDailySheet')
    .addItem('🔍 APIデバッグ', 'debugWhiteDailyApi')
    .addToUi();
}

function tryWhiteAlert(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('RESULT: ' + msg); }
}

// ================================================
// 配信金額変換（API値 → 管理画面表示値）
// ================================================
function convertWhiteSpend(spend) {
  return Math.round(spend / 0.8 * 1.1);
}

// ================================================
// 日付フォーマット
// ================================================
function formatWhiteDate(val) {
  if (!val) return null;
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return null;
  var y  = d.getFullYear();
  var m  = ('0' + (d.getMonth() + 1)).slice(-2);
  var dy = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + dy;
}

function formatWhiteDateJP(str) {
  if (!str) return '';
  var parts = str.split('-');
  if (parts.length !== 3) return str;
  return parts[0] + '/' + parts[1] + '/' + parts[2];
}

// ================================================
// Outbrain 認証（UserPropertiesトークンキャッシュ付き）
// ================================================
function getWhiteToken(username, password) {
  var userProps   = PropertiesService.getUserProperties();
  var cachedToken = userProps.getProperty(WHITE_TOKEN_KEY);
  var cachedTs    = parseInt(userProps.getProperty(WHITE_TOKEN_TS_KEY) || '0', 10);
  if (cachedToken && (Date.now() - cachedTs) < WHITE_TOKEN_TTL) {
    Logger.log('ホワイト: UserPropertiesトークンキャッシュ使用');
    return cachedToken;
  }
  try {
    var creds = Utilities.base64Encode(username + ':' + password);
    var resp  = UrlFetchApp.fetch(WHITE_BASE_URL + '/login', {
      method: 'get',
      headers: { 'Authorization': 'Basic ' + creds },
      muteHttpExceptions: true
    });
    Logger.log('White Login status: ' + resp.getResponseCode());
    if (resp.getResponseCode() === 429 && cachedToken) {
      Logger.log('429 - 期限切れキャッシュを使用');
      return cachedToken;
    }
    if (resp.getResponseCode() === 200) {
      var headers = resp.getHeaders();
      var token   = headers['OB-TOKEN-V1'] || headers['ob-token-v1'];
      if (!token) {
        try { var json = JSON.parse(resp.getContentText()); token = json.OB_TOKEN_V1 || json['OB-TOKEN-V1']; } catch(e) {}
      }
      if (token) {
        userProps.setProperty(WHITE_TOKEN_KEY,    token);
        userProps.setProperty(WHITE_TOKEN_TS_KEY, String(Date.now()));
        return token;
      }
    }
    Logger.log('ホワイト認証失敗: ' + resp.getContentText().substring(0, 200));
    return null;
  } catch(e) {
    Logger.log('ホワイト認証例外: ' + e.toString());
    return null;
  }
}

// ================================================
// キャンペーン名マップ作成
// ================================================
function buildWhiteCampaignMap(token, marketerId, from, to) {
  var map = {};
  try {
    var resp = UrlFetchApp.fetch(
      WHITE_BASE_URL + '/reports/marketers/' + marketerId + '/campaigns?from=' + from + '&to=' + to + '&limit=200',
      { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return map;
    var data = JSON.parse(resp.getContentText());
    (data.results || []).forEach(function(r) {
      var meta = r.metadata || {};
      if (meta.id && meta.name) map[meta.id] = meta.name;
    });
    Logger.log('buildWhiteCampaignMap: ' + Object.keys(map).length + '件');
  } catch(e) {
    Logger.log('buildWhiteCampaignMap 例外: ' + e.toString());
  }
  return map;
}

// ================================================
// 期間内に配信のあったCPN一覧を取得（ドロップダウン用）
// ================================================
function getWhiteActiveCpns(token, marketerId, from, to, campaignMap) {
  var results = [];
  try {
    var resp = UrlFetchApp.fetch(
      WHITE_BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic?from=' + from + '&to=' + to + '&includeConversionDetails=false',
      { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return results;
    var data = JSON.parse(resp.getContentText());
    (data.campaignResults || []).forEach(function(camp) {
      var spend = 0;
      (camp.results || []).forEach(function(r) { spend += ((r.metrics || {}).spend || 0); });
      if (spend >= 1) {
        var name = campaignMap[camp.campaignId] || camp.campaignId;
        results.push({ campaignId: camp.campaignId, campaignName: name });
      }
    });
  } catch(e) {
    Logger.log('getWhiteActiveCpns 例外: ' + e.toString());
  }
  return results;
}

// ================================================
// 日別データ取得
// breakdown=daily で campaigns/periodic を叩き、
// 日付キーで全CPN合算 or 指定CPNのみフィルタリング
// ================================================
function getWhiteDailyData(token, marketerId, targetCpnId, from, to, lpConv, confirmConv, cvConv) {
  var dailyMap = {};

  var url    = WHITE_BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic';
  var params = '?from=' + from + '&to=' + to + '&breakdown=daily&includeConversionDetails=true';

  try {
    var resp = UrlFetchApp.fetch(url + params, {
      headers: { 'OB-TOKEN-V1': token },
      muteHttpExceptions: true
    });
    Logger.log('White DailyAPI status: ' + resp.getResponseCode());
    if (resp.getResponseCode() !== 200) {
      Logger.log('White DailyAPI error: ' + resp.getContentText().substring(0, 300));
      return [];
    }

    var data = JSON.parse(resp.getContentText());
    Logger.log('White campaignResults件数: ' + (data.campaignResults || []).length);

    (data.campaignResults || []).forEach(function(camp) {
      var cid = camp.campaignId;
      if (targetCpnId && cid !== targetCpnId) return;

      (camp.results || []).forEach(function(r) {
        var meta    = r.metadata || {};
        var dateStr = meta.fromDate || meta.date || meta.toDate || '';
        if (!dateStr) return;

        var m        = r.metrics || {};
        var lp = 0, confirm = 0, cv = 0;
        (m.conversionMetrics || []).forEach(function(cm) {
          var name = (cm.name || '').trim();
          var val  = cm.conversions || 0;
          if (name === lpConv)      lp      += val;
          if (name === confirmConv) confirm  += val;
          if (name === cvConv)      cv       += val;
        });
        if (cv === 0) cv = m.conversions || 0;

        if (!dailyMap[dateStr]) {
          dailyMap[dateStr] = { spend: 0, impressions: 0, clicks: 0, lpCount: 0, confirmCount: 0, cvCount: 0 };
        }
        dailyMap[dateStr].spend        += (m.spend       || 0);
        dailyMap[dateStr].impressions  += (m.impressions || 0);
        dailyMap[dateStr].clicks       += (m.clicks      || 0);
        dailyMap[dateStr].lpCount      += lp;
        dailyMap[dateStr].confirmCount += confirm;
        dailyMap[dateStr].cvCount      += cv;
      });
    });
  } catch(e) {
    Logger.log('getWhiteDailyData 例外: ' + e.toString());
  }

  var arr = Object.keys(dailyMap).map(function(date) {
    var item = dailyMap[date];
    return {
      date:         date,
      spend:        item.spend,
      impressions:  item.impressions,
      clicks:       item.clicks,
      lpCount:      item.lpCount,
      confirmCount: item.confirmCount,
      cvCount:      item.cvCount
    };
  });
  arr.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return arr;
}

// ================================================
// ドロップダウン更新
// ================================================
function updateWhiteCpnDropdown(sheet, cpnList) {
  var options = ['全体'];
  cpnList.forEach(function(c) { options.push(c.campaignName); });
  sheet.getRange('C4').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(options, true).build()
  );
}

// ================================================
// シートへの書き込み
// 列: B=日付 C=配信金額 D=CPC E=CPM F=Imp G=Click H=CTR
//     I=LP遷移数 J=LP遷移率 K=LPCVR L=確認画面 M=確認画面率
//     N=CV数 O=CVR P=CPA
// ================================================
function writeWhiteDailySheet(sheet, dailyData, startDate, endDate, selectedCpn) {
  var lastRow = sheet.getLastRow();
  if (lastRow >= 6) {
    sheet.getRange(6, 1, lastRow - 5, 20).clearContent();
    sheet.getRange(6, 1, lastRow - 5, 20).clearFormat();
  }

  var currentRow = 6;
  var label      = (selectedCpn === '全体') ? '全体' : selectedCpn;

  // タイトル行（ホワイトは青系）
  sheet.getRange(currentRow, 2, 1, 15)
       .setValues([['■ 日別集計（' + label + '）　' + startDate + ' 〜 ' + endDate,
                    '', '', '', '', '', '', '', '', '', '', '', '', '', '']])
       .setFontWeight('bold').setFontSize(12)
       .setBackground('#4472C4').setFontColor('#FFFFFF')
       .setVerticalAlignment('middle');
  currentRow++;

  // ヘッダー行
  var headers = [
    '日付', '配信金額', 'CPC', 'CPM', 'Imp', 'Click', 'CTR',
    'LP遷移数', 'LP遷移率', 'LPCVR',
    '確認画面', '確認画面率',
    'CV数', 'CVR', 'CPA'
  ];
  sheet.getRange(currentRow, 2, 1, headers.length).setValues([headers]);
  sheet.getRange(currentRow, 2, 1, headers.length)
       .setFontWeight('bold').setBackground('#DCE6F1').setHorizontalAlignment('center')
       .setFontSize(12).setVerticalAlignment('middle');
  currentRow++;

  var dataStartRow = currentRow;

  if (dailyData.length === 0) {
    sheet.getRange(currentRow, 2).setValue('(該当期間に日別データなし)');
    return;
  }

  // データ行
  var values = dailyData.map(function(d) {
    return [
      formatWhiteDateJP(d.date),   // B: 日付
      convertWhiteSpend(d.spend),  // C: 配信金額
      '',                          // D: CPC（計算）
      '',                          // E: CPM（計算）
      d.impressions,               // F: Imp
      d.clicks,                    // G: Click
      '',                          // H: CTR（計算）
      d.lpCount,                   // I: LP遷移数
      '',                          // J: LP遷移率（計算）
      '',                          // K: LPCVR（計算）
      d.confirmCount,              // L: 確認画面
      '',                          // M: 確認画面率（計算）
      d.cvCount,                   // N: CV数
      '',                          // O: CVR（計算）
      ''                           // P: CPA（計算）
    ];
  });
  sheet.getRange(dataStartRow, 2, values.length, 15).setValues(values);
  sheet.getRange(dataStartRow, 2, dailyData.length, 15).setFontSize(12).setVerticalAlignment('middle');

  // 数値フォーマット
  sheet.getRange(dataStartRow, 3,  dailyData.length, 1).setNumberFormat('¥#,##0');  // 配信金額
  sheet.getRange(dataStartRow, 6,  dailyData.length, 1).setNumberFormat('#,##0');   // Imp
  sheet.getRange(dataStartRow, 7,  dailyData.length, 1).setNumberFormat('#,##0');   // Click
  sheet.getRange(dataStartRow, 9,  dailyData.length, 1).setNumberFormat('#,##0');   // LP遷移数
  sheet.getRange(dataStartRow, 12, dailyData.length, 1).setNumberFormat('#,##0');   // 確認画面
  sheet.getRange(dataStartRow, 14, dailyData.length, 1).setNumberFormat('#,##0');   // CV数

  // 数値列を右揃え
  sheet.getRange(dataStartRow, 3, dailyData.length, 14).setHorizontalAlignment('right');

  // 計算式
  for (var i = 0; i < dailyData.length; i++) {
    setWhiteDailyFormulas(sheet, dataStartRow + i);
  }

  // 合計行
  var totalRow = dataStartRow + dailyData.length;
  sheet.getRange(totalRow, 2).setValue('合計');
  sheet.getRange(totalRow, 2).setFontWeight('bold').setFontSize(12).setVerticalAlignment('middle');
  sheet.getRange(totalRow, 3).setFormula('=SUM(C' + dataStartRow + ':C' + (totalRow - 1) + ')');  // 配信金額
  sheet.getRange(totalRow, 6).setFormula('=SUM(F' + dataStartRow + ':F' + (totalRow - 1) + ')');  // Imp
  sheet.getRange(totalRow, 7).setFormula('=SUM(G' + dataStartRow + ':G' + (totalRow - 1) + ')');  // Click
  sheet.getRange(totalRow, 9).setFormula('=SUM(I' + dataStartRow + ':I' + (totalRow - 1) + ')');  // LP遷移数
  sheet.getRange(totalRow, 12).setFormula('=SUM(L' + dataStartRow + ':L' + (totalRow - 1) + ')'); // 確認画面
  sheet.getRange(totalRow, 14).setFormula('=SUM(N' + dataStartRow + ':N' + (totalRow - 1) + ')'); // CV数
  sheet.getRange(totalRow, 2, 1, 15)
       .setFontWeight('bold').setBackground('#DCE6F1').setFontSize(12);
  setWhiteDailyFormulas(sheet, totalRow);

  // 数値フォーマット（合計行）
  sheet.getRange(totalRow, 3,  1, 1).setNumberFormat('¥#,##0');
  sheet.getRange(totalRow, 6,  1, 1).setNumberFormat('#,##0');
  sheet.getRange(totalRow, 7,  1, 1).setNumberFormat('#,##0');
  sheet.getRange(totalRow, 9,  1, 1).setNumberFormat('#,##0');
  sheet.getRange(totalRow, 12, 1, 1).setNumberFormat('#,##0');
  sheet.getRange(totalRow, 14, 1, 1).setNumberFormat('#,##0');
  sheet.getRange(totalRow, 3, 1, 14).setHorizontalAlignment('right');

  // 列幅設定
  sheet.setColumnWidth(2,  100); // 日付
  sheet.setColumnWidth(3,  110); // 配信金額
  sheet.setColumnWidth(4,  80);  // CPC
  sheet.setColumnWidth(5,  80);  // CPM
  sheet.setColumnWidth(6,  100); // Imp
  sheet.setColumnWidth(7,  80);  // Click
  sheet.setColumnWidth(8,  75);  // CTR
  sheet.setColumnWidth(9,  80);  // LP遷移数
  sheet.setColumnWidth(10, 80);  // LP遷移率
  sheet.setColumnWidth(11, 80);  // LPCVR
  sheet.setColumnWidth(12, 80);  // 確認画面
  sheet.setColumnWidth(13, 85);  // 確認画面率
  sheet.setColumnWidth(14, 70);  // CV数
  sheet.setColumnWidth(15, 75);  // CVR
  sheet.setColumnWidth(16, 90);  // CPA

  Logger.log('ホワイト日別シート書き込み完了。日数: ' + dailyData.length);
}

// ================================================
// 計算式設定
// 列: B=2(日付) C=3(配信金額) D=4(CPC) E=5(CPM) F=6(Imp) G=7(Click)
//     H=8(CTR) I=9(LP遷移数) J=10(LP遷移率) K=11(LPCVR)
//     L=12(確認画面) M=13(確認画面率) N=14(CV数) O=15(CVR) P=16(CPA)
// ================================================
function setWhiteDailyFormulas(sheet, row) {
  var spend   = 'C' + row;
  var imp     = 'F' + row;
  var click   = 'G' + row;
  var lp      = 'I' + row;
  var confirm = 'L' + row;
  var cv      = 'N' + row;

  sheet.getRange(row, 4).setFormula(
    '=IFERROR(ROUND(' + spend + '/' + click + ',1),"")');            // CPC
  sheet.getRange(row, 5).setFormula(
    '=IFERROR(ROUND(' + spend + '/' + imp + '*1000,1),"")');         // CPM
  sheet.getRange(row, 8).setFormula(
    '=IFERROR(TEXT(' + click + '/' + imp + ',"0.00%"),"")');         // CTR
  sheet.getRange(row, 10).setFormula(
    '=IF(' + lp + '=0,"‐",IFERROR(TEXT(' + lp + '/' + click + ',"0.00%"),"‐"))');           // LP遷移率
  sheet.getRange(row, 11).setFormula(
    '=IF(' + lp + '=0,"‐",IF(' + cv + '=0,"‐",IFERROR(TEXT(' + cv + '/' + lp + ',"0.00%"),"‐")))'); // LPCVR
  sheet.getRange(row, 13).setFormula(
    '=IF(' + confirm + '=0,"‐",IFERROR(TEXT(' + confirm + '/' + click + ',"0.00%"),"‐"))');  // 確認画面率
  sheet.getRange(row, 15).setFormula(
    '=IF(' + cv + '=0,"‐",IFERROR(TEXT(' + cv + '/' + click + ',"0.00%"),"‐"))');            // CVR
  sheet.getRange(row, 16).setFormula(
    '=IF(' + cv + '=0,"‐",IFERROR(ROUND(' + spend + '/' + cv + ',0),"‐"))');                // CPA
}

// ================================================
// シート初期化
// ================================================
function initWhiteDailySheet() {
  var ss    = SpreadsheetApp.openById(WHITE_SS_ID);
  var sheet = ss.getSheetByName(WHITE_SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(WHITE_SHEET_NAME); }

  sheet.getRange('B2').setValue('開始日').setFontWeight('bold').setFontSize(12);
  sheet.getRange('B3').setValue('終了日').setFontWeight('bold').setFontSize(12);
  sheet.getRange('B4').setValue('CPN選択').setFontWeight('bold').setFontSize(12);
  sheet.getRange('C4').setValue('全体');
  sheet.getRange('C4').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['全体'], true).build()
  );
  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 220);

  tryWhiteAlert('「日別（ホワイト）」シートを初期化しました。\nC2に開始日、C3に終了日を入力してから実行してください。');
}

// ================================================
// メイン実行
// ================================================
function runWhiteDailyReport() {
  var ss    = SpreadsheetApp.openById(WHITE_SS_ID);
  var sheet = ss.getSheetByName(WHITE_SHEET_NAME);
  if (!sheet) {
    tryWhiteAlert('「日別（ホワイト）」シートが見つかりません。\n「⚙ シート初期化」を先に実行してください。');
    return;
  }

  var startVal = sheet.getRange('C2').getValue();
  var endVal   = sheet.getRange('C3').getValue();
  var cpnSel   = sheet.getRange('C4').getValue() || '全体';

  if (!startVal || !endVal) {
    tryWhiteAlert('開始日（C2）と終了日（C3）を入力してください。\n例: 2026/05/01');
    return;
  }

  var startDate = formatWhiteDate(startVal);
  var endDate   = formatWhiteDate(endVal);
  if (!startDate || !endDate) {
    tryWhiteAlert('日付の形式が正しくありません。\n例: 2026/05/01');
    return;
  }

  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = props.getProperty('OB_MARKETER_ID') || WHITE_MARKETER_DEFAULT;
  var lpConv     = props.getProperty('WHITE_LP_CONV_NAME')      || WHITE_LP_CONV_DEFAULT;
  var confirmConv= props.getProperty('WHITE_CONFIRM_CONV_NAME') || WHITE_CONFIRM_CONV_DEFAULT;
  var cvConv     = props.getProperty('WHITE_CV_CONV_NAME')      || WHITE_CV_CONV_DEFAULT;

  if (!username || !password) {
    tryWhiteAlert('OB_USERNAME / OB_PASSWORD が未設定です。\nApps Script > プロジェクトの設定 > スクリプトプロパティ に設定してください。');
    return;
  }

  var token = getWhiteToken(username, password);
  if (!token) { tryWhiteAlert('Outbrain認証失敗。メールアドレス・パスワードを確認してください。'); return; }

  // CPN一覧取得（ドロップダウン更新用）
  var campaignMap = buildWhiteCampaignMap(token, marketerId, startDate, endDate);
  var cpnList     = getWhiteActiveCpns(token, marketerId, startDate, endDate, campaignMap);
  if (cpnList.length === 0) {
    tryWhiteAlert('指定期間に配信データがありませんでした。');
    return;
  }

  updateWhiteCpnDropdown(sheet, cpnList);

  // 選択CPN を campaignId に変換
  var targetCpnId = null;
  if (cpnSel !== '全体') {
    for (var j = 0; j < cpnList.length; j++) {
      if (cpnList[j].campaignName === cpnSel) { targetCpnId = cpnList[j].campaignId; break; }
    }
    if (!targetCpnId) {
      tryWhiteAlert('選択されたCPN「' + cpnSel + '」が期間中の配信データに見つかりません。\n「全体」に切り替えて再実行してください。');
      return;
    }
  }

  Logger.log('ホワイト日別集計開始: ' + startDate + ' 〜 ' + endDate + ' / CPN=' + cpnSel);
  var dailyData = getWhiteDailyData(token, marketerId, targetCpnId, startDate, endDate, lpConv, confirmConv, cvConv);
  Logger.log('取得日数: ' + dailyData.length);

  writeWhiteDailySheet(sheet, dailyData, startDate, endDate, cpnSel);
  SpreadsheetApp.flush();

  tryWhiteAlert(
    'ホワイト日別集計完了！\n' +
    '対象: ' + cpnSel + '\n' +
    '日数: ' + dailyData.length + '日分\n\n' +
    '⚠ LP遷移数が0の場合、スクリプトプロパティ WHITE_LP_CONV_NAME を確認してください（現在: ' + lpConv + '）'
  );
}

// ================================================
// APIデバッグ（レスポンス構造確認用）
// ================================================
function debugWhiteDailyApi() {
  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = props.getProperty('OB_MARKETER_ID') || WHITE_MARKETER_DEFAULT;

  var token = getWhiteToken(username, password);
  if (!token) { Logger.log('ホワイト認証失敗'); tryWhiteAlert('認証失敗'); return; }

  var ss    = SpreadsheetApp.openById(WHITE_SS_ID);
  var sheet = ss.getSheetByName(WHITE_SHEET_NAME);
  var from, to;
  if (sheet) {
    from = formatWhiteDate(sheet.getRange('C2').getValue());
    to   = formatWhiteDate(sheet.getRange('C3').getValue());
  }
  if (!from || !to) {
    var today = new Date();
    from = formatWhiteDate(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000));
    to   = formatWhiteDate(today);
  }

  var url = WHITE_BASE_URL + '/reports/marketers/' + marketerId +
            '/campaigns/periodic?from=' + from + '&to=' + to +
            '&breakdown=daily&includeConversionDetails=true&limit=3';

  try {
    var resp = UrlFetchApp.fetch(url, {
      headers: { 'OB-TOKEN-V1': token },
      muteHttpExceptions: true
    });
    Logger.log('=== ホワイト日別APIデバッグ ===');
    Logger.log('URL: ' + url);
    Logger.log('status: ' + resp.getResponseCode());
    Logger.log('response: ' + resp.getContentText().substring(0, 1500));
  } catch(e) {
    Logger.log('ホワイトデバッグ例外: ' + e.toString());
  }

  tryWhiteAlert('デバッグ完了。Apps Script > ログ を確認してください。\n期間: ' + from + ' 〜 ' + to);
}
