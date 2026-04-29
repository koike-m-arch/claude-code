/**
 * ===============================================
 * Outbrain 数値集計スクリプト
 * スプレッドシート：りらいぶ配信戦略
 * シート：数値集計
 * アカウント：JP_Relive_wear(miraikirei)
 * ===============================================
 *
 * 【初期設定】
 * Apps Script エディタで「プロジェクトの設定」→「スクリプトプロパティ」に以下を追加：
 *   OB_USERNAME      : Outbrainのログインメールアドレス
 *   OB_PASSWORD      : Outbrainのパスワード
 *   ※ OB_MARKETER_ID は不要（コードに直接埋め込み済み）
 *
 * 【コンバージョン名】
 *   ⑦LP遷移数        → TODO: 管理画面表示名を確認して定数を更新
 *   ⑩確認画面遷移数  → TODO: 管理画面表示名を確認して定数を更新
 *   ⑫CV数            → TODO: 管理画面表示名を確認して定数を更新
 *
 * 【コンバージョン名の確認方法】
 *   メニュー「📋 コンバージョン名を確認」を実行 → ログに一覧が出る
 *   → LP_CONV_DEFAULT_RELIVE 等の定数を実際の名前に書き換える
 */

// ================================================
// コンバージョン名定数
// TODO: 初回実行後「📋 コンバージョン名を確認」で実際のAPI名を取得して書き換えること
// ================================================
var LP_CONV_DEFAULT_RELIVE      = 'TODO_LP_CONV';      // 例: '1Day LP Conversions'
var CONFIRM_CONV_DEFAULT_RELIVE = 'TODO_CONFIRM_CONV'; // 例: 'confirm Conversions'
var CV_CONV_DEFAULT_RELIVE      = 'TODO_CV_CONV';      // 例: 'thanks Conversions'

var SHEET_NAME_RELIVE  = '数値集計';
var MARKETER_ID_RELIVE = '00797d88f6ed45a3f31b85ed0d47644568'; // JP_Relive_wear(miraikirei)固定

// 以下は他GASと同じ値。単体プロジェクトでも動作するよう再定義
// （同一プロジェクト内では var の重複宣言は無害）
var BASE_URL           = 'https://api.outbrain.com/amplify/v0.1';
var TOKEN_CACHE_KEY    = 'OB_TOKEN_CACHE';
var TOKEN_CACHE_TS_KEY = 'OB_TOKEN_CACHE_TS';
var TOKEN_TTL_MS       = 4 * 60 * 60 * 1000; // 4時間有効

// ================================================
// 配信金額変換（API値 → 管理画面表示値）
// ================================================
function convertSpendRelive(spend) {
  return Math.round(spend / 0.8 * 1.1);
}

// ================================================
// カスタムメニュー
// ================================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🔧 リライブシャツコアOBレポート')
    .addItem('▶ レポート取得実行', 'runOutbrainReportRelive')
    .addSeparator()
    .addItem('🔍 APIデバッグ実行', 'debugApiBreakdownsRelive')
    .addItem('📋 コンバージョン名を確認', 'listConversionEventsRelive')
    .addItem('⚙ 設定ガイド', 'showSetupGuideRelive')
    .addToUi();
}

// ================================================
// トリガーインストール（初回1回のみ・スクリプトエディタから実行）
// メニューが表示されない場合：エディタで「installTriggerRelive」を選択→実行
// ================================================
function installTriggerRelive() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onOpen') ScriptApp.deleteTrigger(t);
  });
  var ss = SpreadsheetApp.openById('1x2ckeFixm8nF7atrURQbXBF-r-iPfCVA1LBmy93LnDA');
  ScriptApp.newTrigger('onOpen').forSpreadsheet(ss).onOpen().create();
  Logger.log('onOpenトリガー設定完了。スプレッドシートを開き直すとメニューが表示されます。');
}

// ================================================
// API実行用エントリポイント（UI不使用・外部から呼び出し可能）
// ================================================
function runOutbrainReportApiRelive(startDate, endDate) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_RELIVE);

  if (!startDate || !endDate) {
    var startVal = sheet.getRange('C2').getValue();
    var endVal   = sheet.getRange('C3').getValue();
    startDate = formatDateForAPIRelive(startVal);
    endDate   = formatDateForAPIRelive(endVal);
  }

  if (!sheet)    { return { success: false, error: '数値集計シートが見つかりません' }; }
  if (!startDate || !endDate) { return { success: false, error: 'C2/C3に日付が設定されていません' }; }

  var props       = PropertiesService.getScriptProperties();
  var username    = props.getProperty('OB_USERNAME');
  var password    = props.getProperty('OB_PASSWORD');
  var marketerId  = MARKETER_ID_RELIVE;
  var lpConv      = props.getProperty('LP_CONV_NAME')      || LP_CONV_DEFAULT_RELIVE;
  var confirmConv = props.getProperty('CONFIRM_CONV_NAME') || CONFIRM_CONV_DEFAULT_RELIVE;
  var cvConv      = props.getProperty('CV_CONV_NAME')      || CV_CONV_DEFAULT_RELIVE;

  if (!username || !password) { return { success: false, error: 'OB_USERNAME/OB_PASSWORD が未設定です' }; }

  var token = getOutbrainTokenRelive(username, password);
  if (!token) { return { success: false, error: 'Outbrain認証失敗' }; }

  var campaignMap      = buildCampaignMapRelive(token, marketerId);
  var cpnData          = getCampaignReportRelive(token, marketerId, startDate, endDate, lpConv, confirmConv, cvConv, campaignMap);
  var activeCampaignIds = cpnData.map(function(d) { return d.campaignId; });
  var crData           = getCreativeReportRelive(token, marketerId, activeCampaignIds, startDate, endDate, lpConv, cvConv, campaignMap);

  writeToSheetRelive(sheet, cpnData, crData, startDate, endDate);
  SpreadsheetApp.flush();

  return {
    success: true,
    startDate: startDate,
    endDate: endDate,
    campaignCount: cpnData.length,
    crCount: crData.length
  };
}

// ================================================
// メイン実行（カスタムメニューから呼び出し）
// ================================================
function runOutbrainReportRelive() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_RELIVE);

  if (!sheet) {
    ui.alert('「数値集計」シートが見つかりません。');
    return;
  }

  var startVal = sheet.getRange('C2').getValue();
  var endVal   = sheet.getRange('C3').getValue();

  if (!startVal || !endVal) {
    ui.alert('開始日（C2）と終了日（C3）を入力してください。\n例: 2026/04/01');
    return;
  }

  var startDate = formatDateForAPIRelive(startVal);
  var endDate   = formatDateForAPIRelive(endVal);

  if (!startDate || !endDate) {
    ui.alert('日付の形式が正しくありません。\n例: 2026/04/01');
    return;
  }

  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = MARKETER_ID_RELIVE;
  var lpConv     = props.getProperty('LP_CONV_NAME')      || LP_CONV_DEFAULT_RELIVE;
  var confirmConv= props.getProperty('CONFIRM_CONV_NAME') || CONFIRM_CONV_DEFAULT_RELIVE;
  var cvConv     = props.getProperty('CV_CONV_NAME')      || CV_CONV_DEFAULT_RELIVE;

  if (!username || !password) {
    ui.alert(
      '設定が必要です。\n\n' +
      'Apps Script > プロジェクトの設定 > スクリプトプロパティ に以下を設定：\n' +
      '  OB_USERNAME  : Outbrainログインメール\n' +
      '  OB_PASSWORD  : Outbrainパスワード'
    );
    return;
  }

  Logger.log('認証開始: ' + startDate + ' 〜 ' + endDate);
  var token = getOutbrainTokenRelive(username, password);
  if (!token) {
    ui.alert('Outbrain認証失敗。\nメールアドレス・パスワードを確認してください。\n詳細はログ（Apps Script > ログ）を確認。');
    return;
  }
  Logger.log('認証成功');

  var campaignMap = buildCampaignMapRelive(token, marketerId);
  Logger.log('キャンペーン数: ' + Object.keys(campaignMap).length);

  var cpnData = getCampaignReportRelive(token, marketerId, startDate, endDate, lpConv, confirmConv, cvConv, campaignMap);
  Logger.log('有効CPN数: ' + cpnData.length);

  var activeCampaignIds = cpnData.map(function(d) { return d.campaignId; });

  var crData = getCreativeReportRelive(token, marketerId, activeCampaignIds, startDate, endDate, lpConv, cvConv, campaignMap);
  Logger.log('有効CR数: ' + crData.length);

  writeToSheetRelive(sheet, cpnData, crData, startDate, endDate);
  SpreadsheetApp.flush();

  ui.alert(
    'レポート取得完了！\n' +
    'キャンペーン: ' + cpnData.length + '件\n' +
    'クリエイティブ: ' + crData.length + '件\n\n' +
    '⚠ LP遷移数・確認画面遷移数はコンバージョン名が設定されている場合のみ表示されます。'
  );
}

// ================================================
// 日付フォーマット
// ================================================
function formatDateForAPIRelive(val) {
  if (!val) return null;
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return null;
  var y  = d.getFullYear();
  var m  = ('0' + (d.getMonth() + 1)).slice(-2);
  var dy = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + dy;
}

function formatDateJPRelive(val) {
  if (!val) return '';
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2);
}

// ================================================
// Outbrain 認証（Basic Auth + トークンキャッシュ）
// ================================================
function getOutbrainTokenRelive(username, password) {
  var props      = PropertiesService.getScriptProperties();
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
      if (cachedToken) {
        Logger.log('期限切れキャッシュトークンをフォールバック使用');
        return cachedToken;
      }
      Logger.log('キャッシュなし。数分後に再実行してください。');
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
      Logger.log('トークンが見つかりません。レスポンス: ' + response.getContentText().substring(0, 200));
    } else {
      Logger.log('認証失敗: ' + response.getContentText().substring(0, 200));
    }
    return null;
  } catch(e) {
    Logger.log('認証例外: ' + e.toString());
    return null;
  }
}

// ================================================
// キャンペーン名マップ作成（ページネーション対応）
// ================================================
function buildCampaignMapRelive(token, marketerId) {
  var map = {};
  var offset = 0;
  var limit  = 50;
  try {
    while (true) {
      var response = UrlFetchApp.fetch(
        BASE_URL + '/marketers/' + marketerId + '/campaigns?limit=' + limit + '&offset=' + offset,
        { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true }
      );
      if (response.getResponseCode() !== 200) {
        Logger.log('キャンペーン一覧取得失敗 offset=' + offset + ': ' + response.getContentText().substring(0, 200));
        break;
      }
      var data      = JSON.parse(response.getContentText());
      var campaigns = data.campaigns || [];
      campaigns.forEach(function(c) { map[c.id] = c.name || c.id; });
      Logger.log('buildCampaignMap: offset=' + offset + ' 件数=' + campaigns.length + ' 累計=' + Object.keys(map).length);
      if (campaigns.length < limit) break;
      offset += limit;
      Utilities.sleep(300);
    }
  } catch(e) {
    Logger.log('buildCampaignMap 例外: ' + e.toString());
  }
  return map;
}

// ================================================
// キャンペーン別レポート（includeConversionDetails方式）
// ================================================
function getCampaignReportRelive(token, marketerId, from, to, lpConv, confirmConv, cvConv, campaignMap) {
  var url    = BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic';
  var params = '?from=' + from + '&to=' + to + '&includeConversionDetails=true';

  var results = [];

  try {
    var response = UrlFetchApp.fetch(url + params, {
      headers: { 'OB-TOKEN-V1': token },
      muteHttpExceptions: true
    });
    Logger.log('CPN report status: ' + response.getResponseCode());
    if (response.getResponseCode() !== 200) {
      Logger.log('CPN report error: ' + response.getContentText().substring(0, 200));
      return results;
    }
    var data = JSON.parse(response.getContentText());
    (data.campaignResults || []).forEach(function(camp) {
      var cid = camp.campaignId;
      var tot = { spend: 0, impressions: 0, clicks: 0, lpCount: 0, confirmCount: 0, cvCount: 0 };
      (camp.results || []).forEach(function(r) {
        var m = r.metrics || {};
        tot.spend       += (m.spend       || 0);
        tot.impressions += (m.impressions || 0);
        tot.clicks      += (m.clicks      || 0);
        (m.conversionMetrics || []).forEach(function(cm) {
          var name = (cm.name || '').replace(/　/g, ' ').trim();
          var val  = cm.conversions || 0;
          if (convMatchRelive(name, lpConv))      tot.lpCount      += val;
          if (convMatchRelive(name, confirmConv)) tot.confirmCount += val;
          if (convMatchRelive(name, cvConv))      tot.cvCount      += val;
        });
      });
      if (tot.spend >= 1) {
        results.push({
          campaignId:   cid,
          campaignName: campaignMap[cid] || cid,
          spend:        tot.spend,
          impressions:  tot.impressions,
          clicks:       tot.clicks,
          lpCount:      tot.lpCount,
          confirmCount: tot.confirmCount,
          cvCount:      tot.cvCount
        });
      }
    });
  } catch(e) {
    Logger.log('getCampaignReport 例外: ' + e.toString());
  }

  results.sort(function(a, b) { return b.spend - a.spend; });
  return results;
}

// ================================================
// CR別レポート（promotedContentエンドポイント使用）
// ================================================
function getCreativeReportRelive(token, marketerId, campaignIds, from, to, lpConv, cvConv, campaignMap) {
  var allCreatives = [];

  var campaignIdSet = {};
  campaignIds.forEach(function(id) { campaignIdSet[id] = true; });

  try {
    var url = BASE_URL + '/reports/marketers/' + marketerId + '/promotedContent' +
              '?from=' + from + '&to=' + to + '&includeConversionDetails=true&limit=200';
    var resp = UrlFetchApp.fetch(url, {
      headers: { 'OB-TOKEN-V1': token },
      muteHttpExceptions: true
    });
    Logger.log('promotedContent status: ' + resp.getResponseCode());
    if (resp.getResponseCode() !== 200) {
      Logger.log('promotedContent error: ' + resp.getContentText().substring(0, 200));
      return allCreatives;
    }

    var data = JSON.parse(resp.getContentText());
    Logger.log('promotedContent totalResults: ' + (data.totalResults || (data.results || []).length));

    var byCampaign = {};
    (data.results || []).forEach(function(item) {
      var meta   = item.metadata || {};
      var campId = meta.campaignId || '';
      if (!campId || !campaignIdSet[campId]) return;

      var m  = item.metrics || {};
      var lp = 0, cv = 0;
      (m.conversionMetrics || []).forEach(function(cm) {
        var name = (cm.name || '').replace(/　/g, ' ').trim();
        var val  = cm.conversions || 0;
        if (lpConv && convMatchRelive(name, lpConv)) lp += val;
        if (cvConv && convMatchRelive(name, cvConv)) cv += val;
      });

      var imgMeta  = meta.imageMetadata || {};
      var imageUrl = imgMeta.originalImageUrl || imgMeta.requestedImageUrl || '';

      var cr = {
        campaignId:   campId,
        campaignName: meta.campaignName || campaignMap[campId] || campId,
        crId:         meta.id || '',
        title:        meta.title || '',
        imageUrl:     imageUrl,
        spend:        m.spend        || 0,
        impressions:  m.impressions  || 0,
        clicks:       m.clicks       || 0,
        lpCount:      lp,
        confirmCount: 0,
        cvCount:      (cv > 0) ? cv : (m.conversions || 0)
      };

      if (cr.spend >= 1) {
        if (!byCampaign[campId]) byCampaign[campId] = [];
        byCampaign[campId].push(cr);
      }
    });

    campaignIds.forEach(function(campId) {
      var crs = byCampaign[campId] || [];
      crs.sort(function(a, b) { return b.spend - a.spend; });
      crs.forEach(function(cr) { allCreatives.push(cr); });
    });

    Logger.log('promotedContent CR総数: ' + allCreatives.length);
  } catch(e) {
    Logger.log('getCreativeReport 例外: ' + e.toString());
  }

  return allCreatives;
}

// ================================================
// コンバージョン名マッチ（全角スペース正規化・前方一致）
// ================================================
function convMatchRelive(apiName, targetName) {
  if (!apiName || !targetName) return false;
  var normalize = function(s) { return s.replace(/　/g, ' ').toLowerCase().trim(); };
  var a = normalize(apiName);
  var t = normalize(targetName);
  return a === t || a.indexOf(t) === 0 || t.indexOf(a) === 0;
}

// ================================================
// シートへの書き込み
// ================================================
function writeToSheetRelive(sheet, cpnData, crData, startDate, endDate) {
  var lastRow = sheet.getLastRow();
  if (lastRow >= 6) {
    sheet.getRange(6, 1, lastRow - 5, 26).clearContent();
    sheet.getRange(6, 1, lastRow - 5, 26).clearFormat();
  }

  var currentRow = 6;

  // ===================================================
  // ■ CPN別集計
  // ===================================================
  var cpnTitleCell = sheet.getRange(currentRow, 2);
  cpnTitleCell.setValue('■ CPN別集計　（' + startDate + ' 〜 ' + endDate + '）');
  cpnTitleCell.setFontWeight('bold').setFontSize(12)
              .setBackground('#4472C4').setFontColor('#FFFFFF')
              .setVerticalAlignment('middle');
  sheet.getRange(currentRow, 2, 1, 15).setBackground('#4472C4')
       .setFontSize(12).setVerticalAlignment('middle');
  currentRow++;

  var cpnHeaders = [
    'CPN名',
    '①配信金額', '②CPC', '③CPM',
    '④Imp', '⑤Click', '⑥CTR',
    '⑦LP遷移数', '⑧LP遷移率', '⑨LPCVR',
    '⑩確認画面遷移数', '⑪確認画面遷移率',
    '⑫CV数', '⑬CVR', '⑭CPA'
  ];
  var cpnHeaderRow = currentRow;
  sheet.getRange(cpnHeaderRow, 2, 1, cpnHeaders.length).setValues([cpnHeaders]);
  sheet.getRange(cpnHeaderRow, 2, 1, cpnHeaders.length)
       .setFontWeight('bold').setBackground('#DCE6F1').setHorizontalAlignment('center')
       .setFontSize(12).setVerticalAlignment('middle');
  currentRow++;

  var cpnStartRow = currentRow;
  if (cpnData.length > 0) {
    var cpnValues = cpnData.map(function(d) {
      return [
        d.campaignName,
        convertSpendRelive(d.spend),
        '', '', // CPC, CPM
        d.impressions,
        d.clicks,
        '',     // CTR
        d.lpCount,
        '', '', // LP遷移率, LPCVR
        d.confirmCount,
        '',     // 確認画面遷移率
        d.cvCount,
        '', ''  // CVR, CPA
      ];
    });
    sheet.getRange(cpnStartRow, 2, cpnValues.length, 15).setValues(cpnValues);
    sheet.getRange(cpnStartRow, 2, cpnData.length, 15).setFontSize(12).setVerticalAlignment('middle');
    sheet.getRange(cpnStartRow, 3, cpnData.length, 14).setHorizontalAlignment('right');
    sheet.getRange(cpnStartRow, 3, cpnData.length, 1).setNumberFormat('¥#,##0');
    sheet.getRange(cpnStartRow, 6, cpnData.length, 1).setNumberFormat('#,##0');
    sheet.getRange(cpnStartRow, 7, cpnData.length, 1).setNumberFormat('#,##0');
    sheet.getRange(cpnStartRow, 9, cpnData.length, 1).setNumberFormat('#,##0');
    sheet.getRange(cpnStartRow, 12, cpnData.length, 1).setNumberFormat('#,##0');
    sheet.getRange(cpnStartRow, 14, cpnData.length, 1).setNumberFormat('#,##0');

    for (var i = 0; i < cpnData.length; i++) {
      setCpnFormulasRelive(sheet, cpnStartRow + i);
    }
    currentRow += cpnData.length;
  } else {
    sheet.getRange(currentRow, 2).setValue('(該当期間にデータなし)');
    currentRow++;
  }

  currentRow += 2;

  // ===================================================
  // ■ CR別集計
  // ===================================================
  var crTitleCell = sheet.getRange(currentRow, 2);
  crTitleCell.setValue('■ CR別集計　（' + startDate + ' 〜 ' + endDate + '）');
  crTitleCell.setFontWeight('bold').setFontSize(12)
             .setBackground('#375623').setFontColor('#FFFFFF')
             .setVerticalAlignment('middle');
  sheet.getRange(currentRow, 2, 1, 15).setBackground('#375623')
       .setFontSize(12).setVerticalAlignment('middle');
  currentRow++;

  var crHeaders = [
    'CPN名', 'CR画像', 'CRタイトル',
    '①配信金額', '②CPC', '③CPM',
    '④Imp', '⑤Click', '⑥CTR',
    '⑦LP遷移数', '⑧LP遷移率', '⑨LPCVR',
    '⑫CV数', '⑬CVR', '⑭CPA'
  ];
  var crHeaderRow = currentRow;
  sheet.getRange(crHeaderRow, 2, 1, crHeaders.length).setValues([crHeaders]);
  sheet.getRange(crHeaderRow, 2, 1, crHeaders.length)
       .setFontWeight('bold').setBackground('#E2EFDA').setHorizontalAlignment('center')
       .setFontSize(12).setVerticalAlignment('middle');
  currentRow++;

  var crStartRow = currentRow;
  if (crData.length > 0) {
    var crValues = crData.map(function(d) {
      return [
        d.campaignName,
        '',
        d.title,
        convertSpendRelive(d.spend),
        '', '',
        d.impressions,
        d.clicks,
        '',
        d.lpCount,
        '', '',
        d.cvCount,
        '', ''
      ];
    });
    sheet.getRange(crStartRow, 2, crValues.length, crHeaders.length).setValues(crValues);
    sheet.getRange(crStartRow, 2, crData.length, crHeaders.length).setFontSize(12).setVerticalAlignment('middle');
    sheet.getRange(crStartRow, 5, crData.length, 12).setHorizontalAlignment('right');
    sheet.getRange(crStartRow, 5, crData.length, 1).setNumberFormat('¥#,##0');
    sheet.getRange(crStartRow, 8, crData.length, 1).setNumberFormat('#,##0');
    sheet.getRange(crStartRow, 9, crData.length, 1).setNumberFormat('#,##0');
    sheet.getRange(crStartRow, 11, crData.length, 1).setNumberFormat('#,##0');
    sheet.getRange(crStartRow, 13, crData.length, 1).setNumberFormat('#,##0');

    for (var j = 0; j < crData.length; j++) {
      var crRow = crStartRow + j;
      var d     = crData[j];
      if (d.imageUrl) {
        sheet.getRange(crRow, 3).setFormula('=IMAGE("' + d.imageUrl.replace(/"/g, '') + '",1)');
      } else {
        sheet.getRange(crRow, 3).setValue('(画像なし)');
      }
      setCrFormulasRelive(sheet, crRow);
    }

    for (var k = crStartRow; k < crStartRow + crData.length; k++) {
      sheet.setRowHeight(k, 80);
    }
    sheet.setColumnWidth(2, 320);
    sheet.setColumnWidth(3, 120);
    sheet.setColumnWidth(4, 280);

    currentRow += crData.length;
  } else {
    sheet.getRange(currentRow, 2).setValue('(CR別データ取得不可 - コンテンツレポートAPIへのアクセスを確認してください)');
    currentRow++;
  }

  Logger.log('シート書き込み完了。最終行: ' + currentRow);
}

// ================================================
// CPN別 計算フォーミュラ設定
// 列: B=2, C=3(配信金額), D=4(CPC), E=5(CPM), F=6(Imp), G=7(Click),
//     H=8(CTR), I=9(LP遷移数), J=10(LP遷移率), K=11(LPCVR),
//     L=12(確認画面), M=13(確認画面率), N=14(CV数), O=15(CVR), P=16(CPA)
// ================================================
function setCpnFormulasRelive(sheet, row) {
  var spend   = 'C' + row;
  var imp     = 'F' + row;
  var click   = 'G' + row;
  var lp      = 'I' + row;
  var confirm = 'L' + row;
  var cv      = 'N' + row;

  sheet.getRange(row, 4).setFormula('=IFERROR(ROUND(' + spend + '/' + click + ',1),"")');
  sheet.getRange(row, 5).setFormula('=IFERROR(ROUND(' + spend + '/' + imp + '*1000,1),"")');
  sheet.getRange(row, 8).setFormula('=IFERROR(TEXT(' + click + '/' + imp + ',"0.00%"),"")');
  sheet.getRange(row, 10).setFormula('=IFERROR(TEXT(' + lp + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 11).setFormula('=IFERROR(TEXT(' + cv + '/' + lp + ',"0.00%"),"")');
  sheet.getRange(row, 13).setFormula('=IFERROR(TEXT(' + confirm + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 15).setFormula('=IFERROR(TEXT(' + cv + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 16).setFormula('=IF(' + cv + '=0,"‐",IFERROR(ROUND(' + spend + '/' + cv + ',0),"‐"))');
}

// ================================================
// CR別 計算フォーミュラ設定
// 列: B=2(CPN名), C=3(画像), D=4(タイトル),
//     E=5(配信金額), F=6(CPC), G=7(CPM), H=8(Imp), I=9(Click),
//     J=10(CTR), K=11(LP遷移数), L=12(LP遷移率), M=13(LPCVR),
//     N=13(CV数), O=14(CVR), P=15(CPA)
// ================================================
function setCrFormulasRelive(sheet, row) {
  var spend   = 'E' + row;
  var imp     = 'H' + row;
  var click   = 'I' + row;
  var lp      = 'K' + row;
  var cv      = 'N' + row;

  sheet.getRange(row, 6).setFormula('=IFERROR(ROUND(' + spend + '/' + click + ',1),"")');
  sheet.getRange(row, 7).setFormula('=IFERROR(ROUND(' + spend + '/' + imp + '*1000,1),"")');
  sheet.getRange(row, 10).setFormula('=IFERROR(TEXT(' + click + '/' + imp + ',"0.00%"),"")');
  sheet.getRange(row, 12).setFormula('=IFERROR(TEXT(' + lp + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 13).setFormula('=IFERROR(TEXT(' + cv + '/' + lp + ',"0.00%"),"")');
  sheet.getRange(row, 15).setFormula('=IFERROR(TEXT(' + cv + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 16).setFormula('=IF(' + cv + '=0,"‐",IFERROR(ROUND(' + spend + '/' + cv + ',0),"‐"))');
}

// ================================================
// コンバージョン名一覧確認
// ================================================
function listConversionEventsRelive() {
  var ui    = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var user  = props.getProperty('OB_USERNAME');
  var pass  = props.getProperty('OB_PASSWORD');
  var mid   = MARKETER_ID_RELIVE;

  if (!user || !pass) {
    ui.alert('OB_USERNAMEとOB_PASSWORDを設定してください。');
    return;
  }

  var token = getOutbrainTokenRelive(user, pass);
  if (!token) { ui.alert('認証失敗'); return; }

  var today   = new Date();
  var weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  var from    = formatDateForAPIRelive(weekAgo);
  var to      = formatDateForAPIRelive(today);
  var url     = BASE_URL + '/reports/marketers/' + mid +
                '/campaigns/periodic?from=' + from + '&to=' + to +
                '&includeConversionDetails=true&limit=3';

  try {
    var resp = UrlFetchApp.fetch(url, { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());
    var names = {};

    (data.campaignResults || []).forEach(function(camp) {
      (camp.results || []).forEach(function(r) {
        var m = r.metrics || {};
        (m.conversionMetrics || m.conversionsByType || m.conversionsByName || []).forEach(function(cv) {
          var n = cv.name || cv.eventName || cv.type || '';
          if (n) names[n] = true;
        });
      });
    });

    var nameList = Object.keys(names);
    if (nameList.length > 0) {
      Logger.log('コンバージョン名一覧:\n' + nameList.join('\n'));
      ui.alert(
        'コンバージョン名一覧:\n' + nameList.join('\n') +
        '\n\n上記の名前をコードの定数（LP_CONV_DEFAULT_RELIVE等）に設定してください。\n' +
        'Logsにも出力しています。'
      );
    } else {
      Logger.log('コンバージョン名が見つかりません。レスポンス:\n' + JSON.stringify(data).substring(0, 800));
      ui.alert(
        'コンバージョン名が見つかりませんでした。\n' +
        'Logsで詳細を確認してください。\n\n' +
        '注意: コンバージョンはOutbrain管理画面で設定されている必要があります。'
      );
    }
  } catch(e) {
    Logger.log('listConversionEvents 例外: ' + e.toString());
    ui.alert('エラーが発生しました: ' + e.toString());
  }
}

// ================================================
// 設定ガイド
// ================================================
function showSetupGuideRelive() {
  var html = HtmlService.createHtmlOutput(
    '<html><body style="font-family:Noto Sans JP,sans-serif;padding:15px;font-size:13px;">' +
    '<h3 style="color:#4472C4">リライブシャツコア Outbrain数値集計 - 設定ガイド</h3>' +
    '<h4>① スクリプトプロパティの設定</h4>' +
    '<p>Apps Script エディタで：<br>' +
    '<b>プロジェクトの設定（歯車アイコン）→ スクリプトプロパティ</b> に以下を追加：</p>' +
    '<table border="1" cellpadding="5" style="border-collapse:collapse">' +
    '<tr><th>プロパティ名</th><th>値</th></tr>' +
    '<tr><td>OB_USERNAME</td><td>Outbrainのメールアドレス</td></tr>' +
    '<tr><td>OB_PASSWORD</td><td>Outbrainのパスワード</td></tr>' +
    '</table>' +
    '<p>マーケターID（コードに直接埋め込み済み・設定不要）：<br>' +
    '<b>00797d88f6ed45a3f31b85ed0d47644568</b></p>' +
    '<h4>② コンバージョン名の設定（初回必須）</h4>' +
    '<p>「📋 コンバージョン名を確認」メニューを実行して、実際のAPI名を確認してください。<br>' +
    'コード冒頭の定数を更新：</p>' +
    '<ul>' +
    '<li>LP_CONV_DEFAULT_RELIVE → LP遷移数のコンバージョン名</li>' +
    '<li>CONFIRM_CONV_DEFAULT_RELIVE → 確認画面遷移数のコンバージョン名</li>' +
    '<li>CV_CONV_DEFAULT_RELIVE → CV数のコンバージョン名</li>' +
    '</ul>' +
    '<h4>③ レポート実行</h4>' +
    '<ol>' +
    '<li>「数値集計」シートのC2に開始日を入力（例: 2026/04/01）</li>' +
    '<li>C3に終了日を入力</li>' +
    '<li>メニュー「▶ レポート取得実行」をクリック</li>' +
    '</ol>' +
    '<button onclick="google.script.host.close()" style="margin-top:10px;padding:5px 15px;">閉じる</button>' +
    '</body></html>'
  ).setWidth(560).setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, 'リライブシャツコア 設定ガイド');
}

// ================================================
// APIデバッグ：breakdownパラメータ別にレスポンスを確認
// ================================================
function debugApiBreakdownsRelive() {
  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = MARKETER_ID_RELIVE;

  var token = getOutbrainTokenRelive(username, password);
  if (!token) { SpreadsheetApp.getUi().alert('認証失敗'); return; }

  var today    = new Date();
  var weekAgo  = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  var from     = formatDateForAPIRelive(weekAgo);
  var to       = formatDateForAPIRelive(today);
  var baseParams = '?from=' + from + '&to=' + to + '&limit=3';

  var tests = [
    { label: 'includeConversionDetails', url: BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic' + baseParams + '&includeConversionDetails=true' },
    { label: 'no breakdown',             url: BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic' + baseParams },
    { label: 'promotedContent',          url: BASE_URL + '/reports/marketers/' + marketerId + '/promotedContent' + baseParams + '&includeConversionDetails=true' }
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

  SpreadsheetApp.getUi().alert('デバッグ完了。Apps Script > ログ を確認してください。');
}
