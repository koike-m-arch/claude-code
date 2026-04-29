/**
 * ===============================================
 * Outbrain 掲載面集計スクリプト（独立プロジェクト）
 * 対象スプレッドシート：ブリリオ配信戦略
 * 書き込み先シート：掲載面
 * ===============================================
 *
 * 【このプロジェクトの位置づけ】
 * 数値集計スクリプトとは別の独立したGASプロジェクト。
 * 同じブリリオスプレッドシートにアクセスして「掲載面」タブに書き込む。
 *
 * 【初期設定】
 * Apps Script エディタで「プロジェクトの設定」→「スクリプトプロパティ」に以下を追加：
 *   OB_USERNAME    : Outbrainのログインメールアドレス
 *   OB_PASSWORD    : Outbrainのパスワード
 *   OB_MARKETER_ID : 00af75b8e5565b04764d17c4f90cb25caf  ← ブリリオのID（固定）
 *
 * 【使い方】
 * 1. 「掲載面」タブのC2に開始日、C3に終了日を入力
 * 2. C4のドロップダウンで「全体」または特定CPNを選択
 * 3. メニュー「📊 掲載面集計」→「▶ 掲載面集計実行」をクリック
 */

// ================================================
// 定数
// ================================================
var BASE_URL           = 'https://api.outbrain.com/amplify/v0.1';
var SPREADSHEET_ID     = '1Bk8JBek8dantAlEVPGlSZOsslLaC6aRcUycBf6Z4GY8'; // ブリリオ配信戦略
var SECTION_SHEET_NAME = '掲載面';

var LP_CONV_DEFAULT      = '01 LP 01d';
var CONFIRM_CONV_DEFAULT = '02 confirm 01d';
var CV_CONV_DEFAULT      = '03 all thanks 01d';

var TOKEN_CACHE_KEY    = 'OB_SECTION_TOKEN_CACHE';
var TOKEN_CACHE_TS_KEY = 'OB_SECTION_TOKEN_CACHE_TS';
var TOKEN_TTL_MS       = 4 * 60 * 60 * 1000; // 4時間有効

// ================================================
// カスタムメニュー
// ================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 掲載面集計')
    .addItem('▶ 掲載面集計実行', 'runSectionReport')
    .addSeparator()
    .addItem('🔍 掲載面APIデバッグ', 'debugSectionApi')
    .addItem('⚙ シート初期化', 'initSectionSheet')
    .addToUi();
}

// ================================================
// 配信金額変換（API値 → 管理画面表示値）
// ================================================
function convertSpend(spend) {
  return Math.round(spend / 0.8 * 1.1);
}

// ================================================
// 日付フォーマット
// ================================================
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
// Outbrain 認証（トークンキャッシュ付き）
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
      Logger.log('レート制限(429)。キャッシュトークンで再試行します。');
      if (cachedToken) return cachedToken;
      return null;
    }

    if (response.getResponseCode() === 200) {
      var headers = response.getHeaders();
      var token   = headers['OB-TOKEN-V1'] || headers['ob-token-v1'];
      if (!token) {
        try {
          var json = JSON.parse(response.getContentText());
          token = json.OB_TOKEN_V1 || json['OB-TOKEN-V1'];
        } catch(e) {}
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
// キャンペーン名マップ作成
// ================================================
function buildCampaignMap(token, marketerId) {
  var map = {};
  try {
    var response = UrlFetchApp.fetch(
      BASE_URL + '/marketers/' + marketerId + '/campaigns?limit=50',
      { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true }
    );
    if (response.getResponseCode() !== 200) return map;
    var data = JSON.parse(response.getContentText());
    (data.campaigns || []).forEach(function(c) {
      map[c.id] = c.name || c.id;
    });
  } catch(e) {
    Logger.log('buildCampaignMap 例外: ' + e.toString());
  }
  return map;
}

// ================================================
// 期間中に配信があったキャンペーンIDリストを取得
// ================================================
function getActiveCampaignIds(token, marketerId, from, to, campaignMap) {
  var results = [];
  try {
    var url    = BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic';
    var params = '?from=' + from + '&to=' + to + '&includeConversionDetails=false';
    var resp   = UrlFetchApp.fetch(url + params, {
      headers: { 'OB-TOKEN-V1': token },
      muteHttpExceptions: true
    });
    Logger.log('CPN list status: ' + resp.getResponseCode());
    if (resp.getResponseCode() !== 200) return results;

    var data = JSON.parse(resp.getContentText());
    (data.campaignResults || []).forEach(function(camp) {
      var spend = 0;
      (camp.results || []).forEach(function(r) {
        spend += ((r.metrics || {}).spend || 0);
      });
      if (spend >= 1) {
        results.push({
          campaignId:   camp.campaignId,
          campaignName: campaignMap[camp.campaignId] || camp.campaignId
        });
      }
    });
  } catch(e) {
    Logger.log('getActiveCampaignIds 例外: ' + e.toString());
  }
  // spend降順でソート済みではないため名前順で返す
  return results;
}

// ================================================
// 掲載面データ取得（上位20件）
// targetCpnId: null → 全CPN合算、指定 → 単一CPN
//
// キャンペーン単位の /publishers/periodic が500のため
// マーケター全体エンドポイントから取得し、CPN IDでフィルタする方式に変更
// ================================================
function getSectionData(token, marketerId, activeCampaignIds, targetCpnId, from, to, cvConv) {
  var sectionMap = {};

  // フィルタ対象のキャンペーンIDセット
  var campaignIdSet = {};
  if (targetCpnId) {
    campaignIdSet[targetCpnId] = true;
  } else {
    activeCampaignIds.forEach(function(id) { campaignIdSet[id] = true; });
  }

  // 試みるエンドポイント（優先順）
  // ① マーケター全体の publishers/periodic
  // ② campaigns/periodic?breakdown=section（section名がメタデータに入るケース）
  // ③ campaigns/periodic?breakdown=publisher
  var baseParams = '?from=' + from + '&to=' + to + '&includeConversionDetails=true&limit=500';
  var tryUrls = [
    BASE_URL + '/reports/marketers/' + marketerId + '/publishers/periodic' + baseParams,
    BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic' + baseParams + '&breakdown=section',
    BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic' + baseParams + '&breakdown=publisher'
  ];

  var succeeded = false;

  for (var i = 0; i < tryUrls.length; i++) {
    try {
      Logger.log('SectionAPI[url' + i + '] ' + tryUrls[i].substring(0, 120));
      var resp = UrlFetchApp.fetch(tryUrls[i], {
        headers: { 'OB-TOKEN-V1': token },
        muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      Logger.log('SectionAPI[url' + i + '] status=' + code);

      if (code !== 200) {
        Logger.log('SectionAPI[url' + i + '] error: ' + resp.getContentText().substring(0, 300));
        continue;
      }

      var data = JSON.parse(resp.getContentText());
      Logger.log('SectionAPI[url' + i + '] トップキー: ' + Object.keys(data).join(', '));

      // --- パターンA: results[] が直接入っている（publishers/periodicなど）---
      var flatResults = data.results || data.publisherResults || [];
      if (flatResults.length > 0) {
        Logger.log('SectionAPI パターンA 件数=' + flatResults.length);
        Logger.log('SectionAPI 最初のmetadata: ' + JSON.stringify((flatResults[0].metadata || {})));

        flatResults.forEach(function(item) {
          var meta    = item.metadata || {};
          var campId  = meta.campaignId || '';
          // CPN別フィルタ（全体の場合は配信があったCPNのみ、個別の場合は対象CPNのみ）
          if (campId && !campaignIdSet[campId]) return;

          var sectionName = meta.sectionName || meta.section || meta.publisherName || meta.publisher ||
                            meta.name || (meta.id ? String(meta.id) : '不明');
          var m  = item.metrics || {};
          var cv = 0;
          (m.conversionMetrics || []).forEach(function(cm) {
            if ((cm.name || '').trim() === cvConv) cv += (cm.conversions || 0);
          });

          if (!sectionMap[sectionName]) {
            sectionMap[sectionName] = { spend: 0, impressions: 0, clicks: 0, cvCount: 0 };
          }
          sectionMap[sectionName].spend       += (m.spend       || 0);
          sectionMap[sectionName].impressions += (m.impressions || 0);
          sectionMap[sectionName].clicks      += (m.clicks      || 0);
          sectionMap[sectionName].cvCount     += cv;
        });

        succeeded = true;
        break;
      }

      // --- パターンB: campaignResults[] の中に results[] が入っている（breakdown=section）---
      var campaignResults = data.campaignResults || [];
      if (campaignResults.length > 0) {
        Logger.log('SectionAPI パターンB campaignResults件数=' + campaignResults.length);
        if (campaignResults[0].results && campaignResults[0].results[0]) {
          Logger.log('SectionAPI パターンB 最初のresult.metadata: ' + JSON.stringify((campaignResults[0].results[0].metadata || {})));
        }

        campaignResults.forEach(function(camp) {
          var campId = camp.campaignId;
          if (!campaignIdSet[campId]) return;

          (camp.results || []).forEach(function(r) {
            var meta        = r.metadata || {};
            var sectionName = meta.sectionName || meta.section || meta.publisherName || meta.publisher ||
                              meta.name || (meta.id ? String(meta.id) : '不明');
            var m  = r.metrics || {};
            var cv = 0;
            (m.conversionMetrics || []).forEach(function(cm) {
              if ((cm.name || '').trim() === cvConv) cv += (cm.conversions || 0);
            });

            if (!sectionMap[sectionName]) {
              sectionMap[sectionName] = { spend: 0, impressions: 0, clicks: 0, cvCount: 0 };
            }
            sectionMap[sectionName].spend       += (m.spend       || 0);
            sectionMap[sectionName].impressions += (m.impressions || 0);
            sectionMap[sectionName].clicks      += (m.clicks      || 0);
            sectionMap[sectionName].cvCount     += cv;
          });
        });

        succeeded = true;
        break;
      }

      Logger.log('SectionAPI[url' + i + '] データが空（次のURLを試みます）');
    } catch(e) {
      Logger.log('SectionAPI[url' + i + '] 例外: ' + e.toString());
    }
  }

  if (!succeeded) {
    Logger.log('全URLで掲載面データ取得失敗');
  }

  var arr = Object.keys(sectionMap).map(function(name) {
    var item = sectionMap[name];
    return {
      sectionName: name,
      spend:       item.spend,
      impressions: item.impressions,
      clicks:      item.clicks,
      cvCount:     item.cvCount
    };
  });
  arr.sort(function(a, b) { return b.spend - a.spend; });
  return arr.slice(0, 20);
}

// ================================================
// 掲載面集計シートへ書き込み
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
  sheet.getRange(currentRow, 2, 1, 10)
       .setValues([['■ 掲載面集計（' + label + '）　' + startDate + ' 〜 ' + endDate, '', '', '', '', '', '', '', '', '']])
       .setFontWeight('bold').setFontSize(12)
       .setBackground('#7030A0').setFontColor('#FFFFFF')
       .setVerticalAlignment('middle');
  currentRow++;

  // ヘッダー行
  var headers = ['掲載面名', '配信金額', 'CPC', 'CPM', 'Imp', 'Click', 'CTR', 'CV数', 'CVR', 'CPA'];
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
        d.cvCount,
        '', // CVR
        ''  // CPA
      ];
    });
    sheet.getRange(dataStartRow, 2, values.length, 10).setValues(values);
    sheet.getRange(dataStartRow, 2, sectionData.length, 10)
         .setFontSize(12).setVerticalAlignment('middle');

    // 数値フォーマット
    sheet.getRange(dataStartRow, 3, sectionData.length, 1).setNumberFormat('¥#,##0');
    sheet.getRange(dataStartRow, 6, sectionData.length, 1).setNumberFormat('#,##0');
    sheet.getRange(dataStartRow, 7, sectionData.length, 1).setNumberFormat('#,##0');
    sheet.getRange(dataStartRow, 9, sectionData.length, 1).setNumberFormat('#,##0');

    sheet.getRange(dataStartRow, 3, sectionData.length, 9).setHorizontalAlignment('right');

    // 計算式
    for (var i = 0; i < sectionData.length; i++) {
      setSectionFormulas(sheet, dataStartRow + i);
    }

    // 列幅
    sheet.setColumnWidth(2, 300);
    sheet.setColumnWidth(3, 110);
    sheet.setColumnWidth(4, 80);
    sheet.setColumnWidth(5, 80);
    sheet.setColumnWidth(6, 100);
    sheet.setColumnWidth(7, 80);
    sheet.setColumnWidth(8, 75);
    sheet.setColumnWidth(9, 70);
    sheet.setColumnWidth(10, 75);
    sheet.setColumnWidth(11, 90);
  } else {
    sheet.getRange(currentRow, 2).setValue('(該当期間に掲載面データなし)');
  }

  Logger.log('掲載面シート書き込み完了。掲載面数: ' + sectionData.length);
}

// ================================================
// 掲載面 計算フォーミュラ設定
// 列: B=2(掲載面名), C=3(配信金額), D=4(CPC), E=5(CPM),
//     F=6(Imp), G=7(Click), H=8(CTR), I=9(CV数), J=10(CVR), K=11(CPA)
// ================================================
function setSectionFormulas(sheet, row) {
  var spend = 'C' + row;
  var imp   = 'F' + row;
  var click = 'G' + row;
  var cv    = 'I' + row;

  sheet.getRange(row, 4).setFormula('=IFERROR(ROUND(' + spend + '/' + click + ',1),"")');
  sheet.getRange(row, 5).setFormula('=IFERROR(ROUND(' + spend + '/' + imp + '*1000,1),"")');
  sheet.getRange(row, 8).setFormula('=IFERROR(TEXT(' + click + '/' + imp + ',"0.00%"),"")');
  sheet.getRange(row, 10).setFormula('=IFERROR(TEXT(' + cv + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 11).setFormula('=IF(' + cv + '=0,"‐",IFERROR(ROUND(' + spend + '/' + cv + ',0),"‐"))');
}

// ================================================
// C4 ドロップダウンを配信CPNで更新
// ================================================
function updateCpnDropdown(sheet, cpnList) {
  var options = ['全体'];
  cpnList.forEach(function(c) { options.push(c.campaignName); });
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(options, true)
    .build();
  sheet.getRange('C4').setDataValidation(rule);
}

// ================================================
// 掲載面集計シート初期化（初回のみ実行）
// ================================================
function initSectionSheet() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SECTION_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SECTION_SHEET_NAME);
  }

  sheet.getRange('B2').setValue('開始日').setFontWeight('bold').setFontSize(12);
  sheet.getRange('B3').setValue('終了日').setFontWeight('bold').setFontSize(12);
  sheet.getRange('B4').setValue('CPN選択').setFontWeight('bold').setFontSize(12);
  sheet.getRange('C4').setValue('全体');

  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['全体'], true)
    .build();
  sheet.getRange('C4').setDataValidation(rule);

  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 220);

  SpreadsheetApp.getUi().alert('「掲載面」シートを初期化しました。\nC2に開始日、C3に終了日を入力して実行してください。');
}

// ================================================
// 掲載面集計 メイン実行
// ================================================
function runSectionReport() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  var sheet = ss.getSheetByName(SECTION_SHEET_NAME);
  if (!sheet) {
    ui.alert('「掲載面」シートが見つかりません。\nメニューの「⚙ シート初期化」を先に実行してください。');
    return;
  }

  var startVal = sheet.getRange('C2').getValue();
  var endVal   = sheet.getRange('C3').getValue();
  var cpnSel   = sheet.getRange('C4').getValue() || '全体';

  if (!startVal || !endVal) {
    ui.alert('開始日（C2）と終了日（C3）を入力してください。\n例: 2026/04/01');
    return;
  }

  var startDate = formatDateForAPI(startVal);
  var endDate   = formatDateForAPI(endVal);

  if (!startDate || !endDate) {
    ui.alert('日付の形式が正しくありません。\n例: 2026/04/01');
    return;
  }

  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = props.getProperty('OB_MARKETER_ID') || '00af75b8e5565b04764d17c4f90cb25caf';
  var cvConv     = props.getProperty('CV_CONV_NAME') || CV_CONV_DEFAULT;

  if (!username || !password) {
    ui.alert('OB_USERNAME / OB_PASSWORD が未設定です。\nApps Script > プロジェクトの設定 > スクリプトプロパティ に設定してください。');
    return;
  }

  Logger.log('掲載面集計開始: ' + startDate + ' 〜 ' + endDate + ' / CPN=' + cpnSel);

  var token = getOutbrainToken(username, password);
  if (!token) {
    ui.alert('Outbrain認証失敗。\nメールアドレス・パスワードを確認してください。');
    return;
  }

  var campaignMap = buildCampaignMap(token, marketerId);
  var cpnList     = getActiveCampaignIds(token, marketerId, startDate, endDate, campaignMap);

  if (cpnList.length === 0) {
    ui.alert('指定期間に配信データがありませんでした。');
    return;
  }

  // ドロップダウンを配信CPNで更新
  updateCpnDropdown(sheet, cpnList);

  // 選択CPNのIDを逆引き（全体の場合はnull）
  var targetCpnId = null;
  if (cpnSel !== '全体') {
    for (var id in campaignMap) {
      if (campaignMap[id] === cpnSel) {
        targetCpnId = id;
        break;
      }
    }
    if (!targetCpnId) {
      ui.alert('選択されたCPN「' + cpnSel + '」が期間中の配信データに見つかりません。\n「全体」に切り替えて再実行してください。');
      return;
    }
  }

  var activeCampaignIds = cpnList.map(function(c) { return c.campaignId; });
  var sectionData = getSectionData(token, marketerId, activeCampaignIds, targetCpnId, startDate, endDate, cvConv);
  Logger.log('取得掲載面数: ' + sectionData.length);

  writeSectionSheet(sheet, sectionData, startDate, endDate, cpnSel);
  SpreadsheetApp.flush();

  ui.alert(
    '掲載面集計完了！\n' +
    '対象: ' + cpnSel + '\n' +
    '掲載面数: ' + sectionData.length + '件（上位20件）\n\n' +
    '⚠ 掲載面名が「不明」の場合は「🔍 掲載面APIデバッグ」でログを確認してください。'
  );
}

// ================================================
// 掲載面APIデバッグ（レスポンス構造確認用）
// ================================================
function debugSectionApi() {
  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = props.getProperty('OB_MARKETER_ID') || '00af75b8e5565b04764d17c4f90cb25caf';

  var token = getOutbrainToken(username, password);
  if (!token) { SpreadsheetApp.getUi().alert('認証失敗'); return; }

  // 掲載面集計シートの日付を流用（なければ直近7日）
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SECTION_SHEET_NAME);
  var from, to;
  if (sheet) {
    from = formatDateForAPI(sheet.getRange('C2').getValue());
    to   = formatDateForAPI(sheet.getRange('C3').getValue());
  }
  if (!from || !to) {
    var today   = new Date();
    var weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    from = formatDateForAPI(weekAgo);
    to   = formatDateForAPI(today);
  }

  var campaignMap = buildCampaignMap(token, marketerId);
  var campIds     = Object.keys(campaignMap);
  var testCampId  = campIds[0] || '';
  Logger.log('テストCPN: ' + testCampId + ' (' + campaignMap[testCampId] + ')');

  var tests = [
    {
      label: 'publishers/periodic（マーケター全体）',
      url: BASE_URL + '/reports/marketers/' + marketerId +
           '/publishers/periodic?from=' + from + '&to=' + to + '&limit=5'
    },
    {
      label: 'campaigns/periodic?breakdown=section（マーケター全体）',
      url: BASE_URL + '/reports/marketers/' + marketerId +
           '/campaigns/periodic?from=' + from + '&to=' + to + '&breakdown=section&limit=5'
    },
    {
      label: 'campaigns/periodic?breakdown=publisher（マーケター全体）',
      url: BASE_URL + '/reports/marketers/' + marketerId +
           '/campaigns/periodic?from=' + from + '&to=' + to + '&breakdown=publisher&limit=5'
    },
    {
      label: 'publishers/periodic（CPN別）',
      url: BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/' + testCampId +
           '/publishers/periodic?from=' + from + '&to=' + to + '&limit=5'
    }
  ];

  tests.forEach(function(t) {
    try {
      var resp = UrlFetchApp.fetch(t.url, {
        headers: { 'OB-TOKEN-V1': token },
        muteHttpExceptions: true
      });
      Logger.log('=== ' + t.label + ' ===');
      Logger.log('status: ' + resp.getResponseCode());
      Logger.log('response: ' + resp.getContentText().substring(0, 1000));
    } catch(e) {
      Logger.log('=== ' + t.label + ' 例外: ' + e.toString());
    }
    Utilities.sleep(300);
  });

  SpreadsheetApp.getUi().alert(
    '掲載面APIデバッグ完了。\nApps Script > ログ を確認してください。\n\n' +
    'テストCPN: ' + (campaignMap[testCampId] || testCampId) + '\n' +
    '期間: ' + from + ' 〜 ' + to
  );
}
