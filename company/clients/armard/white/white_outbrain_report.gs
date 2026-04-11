/**
 * ===============================================
 * Outbrain 数値集計スクリプト
 * スプレッドシート：チェルラーホワイト
 * シート：数値集計②
 * ===============================================
 *
 * 【初期設定】
 * Apps Script エディタで「プロジェクトの設定」→「スクリプトプロパティ」に以下を追加：
 *   OB_USERNAME      : Outbrainのログインメールアドレス
 *   OB_PASSWORD      : Outbrainのパスワード
 *   ※ OB_MARKETER_ID は不要（コードに直接埋め込み済み）
 *
 * 【コンバージョン名（固定設定済み・変更不要）】
 *   ⑦LP遷移数        → "01LP Conversions (Click)"
 *   ⑩確認画面遷移数  → "02 confirm 1day Conversions (Click)"
 *   ⑫CV数            → "thanks 1day Conversions (Click)"
 */

// ================================================
// コンバージョン名定数（Outbrain管理画面の表示名と一致させること）
// ================================================
var LP_CONV_DEFAULT_WHITE      = '01LP';             // API実測値（管理画面: "01LP Conversions (Click)"）
var CONFIRM_CONV_DEFAULT_WHITE = '02 confirm 1day'; // API実測値（管理画面: "02 confirm 1day Conversions (Click)"）
var CV_CONV_DEFAULT_WHITE      = 'thanks 1day';     // API実測値（管理画面: "thanks 1day Conversions (Click)"）

var SHEET_NAME_WHITE  = '数値集計②';
var MARKETER_ID_WHITE = '0033e4d3d312b31c84630c2166acec7b27'; // ホワイト固定（Script Propertiesに依存しない）

// 以下は brillio_outbrain_report.gs と同じ値。単体プロジェクトでも動作するよう再定義
// （同一プロジェクト内では var の重複宣言は無害）
var BASE_URL           = 'https://api.outbrain.com/amplify/v0.1';
var TOKEN_CACHE_KEY    = 'OB_TOKEN_CACHE';
var TOKEN_CACHE_TS_KEY = 'OB_TOKEN_CACHE_TS';
var TOKEN_TTL_MS       = 4 * 60 * 60 * 1000; // 4時間有効

// ================================================
// 配信金額変換（API値 → 管理画面表示値）
// ================================================
function convertSpendWhite(spend) {
  return Math.round(spend / 0.8 * 1.1);
}

// ================================================
// カスタムメニュー
// ================================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🔧 ホワイトOBレポート')
    .addItem('▶ レポート取得実行', 'runOutbrainReportWhite')
    .addSeparator()
    .addItem('🔍 APIデバッグ実行', 'debugApiBreakdownsWhite')
    .addItem('📋 コンバージョン名を確認', 'listConversionEventsWhite')
    .addItem('⚙ 設定ガイド', 'showSetupGuideWhite')
    .addToUi();
}

// ================================================
// API実行用エントリポイント（UI不使用・外部から呼び出し可能）
// ================================================
function runOutbrainReportApiWhite(startDate, endDate) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_WHITE);

  if (!startDate || !endDate) {
    // 引数なしの場合はシートから読み取る
    var startVal = sheet.getRange('C2').getValue();
    var endVal   = sheet.getRange('C3').getValue();
    startDate = formatDateForAPIWhite(startVal);
    endDate   = formatDateForAPIWhite(endVal);
  }

  if (!sheet)    { return { success: false, error: '数値集計②シートが見つかりません' }; }
  if (!startDate || !endDate) { return { success: false, error: 'C2/C3に日付が設定されていません' }; }

  var props       = PropertiesService.getScriptProperties();
  var username    = props.getProperty('OB_USERNAME');
  var password    = props.getProperty('OB_PASSWORD');
  var marketerId  = MARKETER_ID_WHITE;
  var lpConv      = props.getProperty('LP_CONV_NAME')      || LP_CONV_DEFAULT_WHITE;
  var confirmConv = props.getProperty('CONFIRM_CONV_NAME') || CONFIRM_CONV_DEFAULT_WHITE;
  var cvConv      = props.getProperty('CV_CONV_NAME')      || CV_CONV_DEFAULT_WHITE;

  if (!username || !password) { return { success: false, error: 'OB_USERNAME/OB_PASSWORD が未設定です' }; }

  var token = getOutbrainTokenWhite(username, password);
  if (!token) { return { success: false, error: 'Outbrain認証失敗' }; }

  var campaignMap      = buildCampaignMapWhite(token, marketerId);
  var cpnData          = getCampaignReportWhite(token, marketerId, startDate, endDate, lpConv, confirmConv, cvConv, campaignMap);
  var activeCampaignIds = cpnData.map(function(d) { return d.campaignId; });
  var crData           = getCreativeReportWhite(token, marketerId, activeCampaignIds, startDate, endDate, lpConv, cvConv, campaignMap);

  writeToSheetWhite(sheet, cpnData, crData, startDate, endDate);
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
function runOutbrainReportWhite() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_WHITE);

  if (!sheet) {
    ui.alert('「数値集計②」シートが見つかりません。'); // ★変更
    return;
  }

  // 日付取得（C2: 開始日, C3: 終了日）
  var startVal = sheet.getRange('C2').getValue();
  var endVal   = sheet.getRange('C3').getValue();

  if (!startVal || !endVal) {
    ui.alert('開始日（C2）と終了日（C3）を入力してください。\n例: 2026/04/01');
    return;
  }

  var startDate = formatDateForAPIWhite(startVal);
  var endDate   = formatDateForAPIWhite(endVal);

  if (!startDate || !endDate) {
    ui.alert('日付の形式が正しくありません。\n例: 2026/04/01');
    return;
  }

  // 認証情報
  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = MARKETER_ID_WHITE;
  var lpConv     = props.getProperty('LP_CONV_NAME')      || LP_CONV_DEFAULT_WHITE;
  var confirmConv= props.getProperty('CONFIRM_CONV_NAME') || CONFIRM_CONV_DEFAULT_WHITE;
  var cvConv     = props.getProperty('CV_CONV_NAME')      || CV_CONV_DEFAULT_WHITE;

  if (!username || !password) {
    ui.alert(
      '設定が必要です。\n\n' +
      'Apps Script > プロジェクトの設定 > スクリプトプロパティ に以下を設定：\n' +
      '  OB_USERNAME  : Outbrainログインメール\n' +
      '  OB_PASSWORD  : Outbrainパスワード'
    );
    return;
  }

  // トークン取得
  Logger.log('認証開始: ' + startDate + ' 〜 ' + endDate);
  var token = getOutbrainTokenWhite(username, password);
  if (!token) {
    ui.alert('Outbrain認証失敗。\nメールアドレス・パスワードを確認してください。\n詳細はログ（Apps Script > ログ）を確認。');
    return;
  }
  Logger.log('認証成功');

  // キャンペーン一覧（名前マップ用）
  var campaignMap = buildCampaignMapWhite(token, marketerId);
  Logger.log('キャンペーン数: ' + Object.keys(campaignMap).length);

  // キャンペーン別レポート（includeConversionDetails方式）
  var cpnData = getCampaignReportWhite(token, marketerId, startDate, endDate, lpConv, confirmConv, cvConv, campaignMap);
  Logger.log('有効CPN数: ' + cpnData.length);

  // CPN IDリスト（spend >= 1円）
  var activeCampaignIds = cpnData.map(function(d) { return d.campaignId; });

  // CR別レポート（各キャンペーンのCR）
  var crData = getCreativeReportWhite(token, marketerId, activeCampaignIds, startDate, endDate, lpConv, cvConv, campaignMap);
  Logger.log('有効CR数: ' + crData.length);

  // シートへ書き込み
  writeToSheetWhite(sheet, cpnData, crData, startDate, endDate);
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
function formatDateForAPIWhite(val) {
  if (!val) return null;
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return null;
  var y  = d.getFullYear();
  var m  = ('0' + (d.getMonth() + 1)).slice(-2);
  var dy = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + dy;
}

function formatDateJPWhite(val) {
  if (!val) return '';
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2);
}

// ================================================
// Outbrain 認証（Basic Auth + トークンキャッシュ）
// ================================================
function getOutbrainTokenWhite(username, password) {
  // キャッシュ確認
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
      // 期限切れでもキャッシュトークンをフォールバックとして使用
      if (cachedToken) {
        Logger.log('期限切れキャッシュトークンをフォールバック使用');
        return cachedToken;
      }
      Logger.log('キャッシュなし。数分後に再実行してください。');
      return null;
    }

    if (response.getResponseCode() === 200) {
      // トークンはレスポンスヘッダーに含まれる
      var headers = response.getHeaders();
      var token   = headers['OB-TOKEN-V1'] || headers['ob-token-v1'];
      if (!token) {
        // JSONにある場合を試みる
        try {
          var json = JSON.parse(response.getContentText());
          token = json.OB_TOKEN_V1 || json['OB-TOKEN-V1'];
        } catch(e) {}
      }
      if (token) {
        // キャッシュに保存
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
function buildCampaignMapWhite(token, marketerId) {
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
      if (campaigns.length < limit) break; // 最終ページ
      offset += limit;
      Utilities.sleep(300);
    }
  } catch(e) {
    Logger.log('buildCampaignMap 例外: ' + e.toString());
  }
  return map;
}

// ================================================
// コンバージョンゴールID取得（複数URLを試みる）
// ================================================
function getConversionGoalIdsWhite(token, marketerId, lpConv, confirmConv, cvConv) {
  var ids = { lpId: null, confirmId: null, cvId: null };
  var tryUrls = [
    BASE_URL + '/marketers/' + marketerId + '/conversionGoals?limit=50',
    BASE_URL + '/marketers/' + marketerId + '/conversionGoals',
    BASE_URL + '/reports/marketers/' + marketerId + '/conversionGoals?limit=50'
  ];
  for (var t = 0; t < tryUrls.length; t++) {
    try {
      var resp = UrlFetchApp.fetch(tryUrls[t], {
        headers: { 'OB-TOKEN-V1': token },
        muteHttpExceptions: true
      });
      Logger.log('ConversionGoals[' + t + '] status: ' + resp.getResponseCode() + ' url: ' + tryUrls[t]);
      var body = resp.getContentText();
      Logger.log('ConversionGoals[' + t + '] response: ' + body.substring(0, 400));
      if (resp.getResponseCode() !== 200) continue;

      var data = JSON.parse(body);
      var list = data.conversionGoals || data.goals || [];
      list.forEach(function(g) {
        var id   = g.id || '';
        var name = (g.name || '').toLowerCase();
        var lpL  = lpConv.toLowerCase();
        var cnL  = confirmConv.toLowerCase();
        var cvL  = cvConv.toLowerCase();
        if (!ids.lpId      && (name === lpL || name.indexOf(lpL) >= 0 || lpL.indexOf(name) >= 0)) ids.lpId      = id;
        if (!ids.confirmId && (name === cnL || name.indexOf(cnL) >= 0 || cnL.indexOf(name) >= 0)) ids.confirmId = id;
        if (!ids.cvId      && (name === cvL || name.indexOf(cvL) >= 0 || cvL.indexOf(name) >= 0)) ids.cvId      = id;
      });
      break; // 成功したらループ終了
    } catch(e) {
      Logger.log('getConversionGoalIds[' + t + '] 例外: ' + e.toString());
    }
  }
  return ids;
}

// ================================================
// キャンペーン別レポート（includeConversionDetails方式）
// ================================================
function getCampaignReportWhite(token, marketerId, from, to, lpConv, confirmConv, cvConv, campaignMap) {
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
        // conversionMetrics から名前付きコンバージョンを取得
        (m.conversionMetrics || []).forEach(function(cm) {
          var name = (cm.name || '').trim();
          var val  = cm.conversions || 0;
          if (name === lpConv)      tot.lpCount      += val;
          if (name === confirmConv) tot.confirmCount += val;
          if (name === cvConv)      tot.cvCount      += val;
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

  // 配信金額降順でソート
  results.sort(function(a, b) { return b.spend - a.spend; });
  return results;
}

// ================================================
// キャンペーン単位のコンバージョン取得（ゴールIDを使用）
// ================================================
function getCampaignNamedConversionsWhite(token, marketerId, campaignId, from, to, goalIds) {
  var result = { lpCount: 0, confirmCount: 0, cvCount: 0 };
  var base   = BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/' + campaignId +
               '/periodic?from=' + from + '&to=' + to + '&breakdown=daily';

  var goals = [
    { id: goalIds.lpId,      key: 'lpCount',      label: 'LP' },
    { id: goalIds.confirmId, key: 'confirmCount',  label: 'confirm' },
    { id: goalIds.cvId,      key: 'cvCount',       label: 'CV' }
  ];

  goals.forEach(function(g) {
    if (!g.id) {
      Logger.log('  [' + g.label + '] ゴールIDなし → スキップ');
      return;
    }
    Utilities.sleep(100);
    try {
      var url  = base + '&conversionGoalId=' + g.id;
      var resp = UrlFetchApp.fetch(url, {
        headers: { 'OB-TOKEN-V1': token },
        muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      Logger.log('  [' + g.label + '] goalId=' + g.id + ' status=' + code);
      if (code !== 200) {
        Logger.log('  → ' + resp.getContentText().substring(0, 150));
        return;
      }
      var data  = JSON.parse(resp.getContentText());
      var total = 0;
      (data.results || []).forEach(function(r) {
        var m = r.metrics || {};
        total += (m.conversions || m.totalConversions || 0);
      });
      result[g.key] = total;
      Logger.log('  [' + g.label + '] ' + campaignId + ' = ' + total);
    } catch(e) {
      Logger.log('  [' + g.label + '] 例外: ' + e.toString());
    }
  });

  Logger.log('Campaign ' + campaignId + ' 最終: LP=' + result.lpCount +
             ' confirm=' + result.confirmCount + ' cv=' + result.cvCount);
  return result;
}

// ================================================
// CR別レポート（promotedContentエンドポイント使用）
// 1回のAPIコールで全CR のスペック・画像・LP/CV込みで取得
// ================================================
function getCreativeReportWhite(token, marketerId, campaignIds, from, to, lpConv, cvConv, campaignMap) {
  var allCreatives = [];

  // 有効なキャンペーンIDのセット（フィルタ用）
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
    Logger.log('promotedContent totalResults: ' + (data.totalResults || data.results.length));

    // campaignId別にグループ化
    var byCampaign = {};
    (data.results || []).forEach(function(item) {
      var meta   = item.metadata || {};
      var campId = meta.campaignId || '';
      if (!campId || !campaignIdSet[campId]) return;

      var m  = item.metrics || {};
      var lp = 0, cv = 0;
      (m.conversionMetrics || []).forEach(function(cm) {
        var name = (cm.name || '').trim();
        var val  = cm.conversions || 0;
        if (lpConv && name === lpConv) lp += val;
        if (cvConv && name === cvConv) cv += val;
      });

      // 画像URL（originalImageUrl優先）
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

    // campaignIds の順番通りに、各CPN内は配信費降順でフラットリストに変換
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
// cbnの部分一致検索（スペース違い等の揺れに対応）
// ================================================
function cbnLookupWhite(cbn, convName) {
  if (!convName) return 0;
  // 完全一致
  if (cbn[convName] !== undefined) return cbn[convName] || 0;
  // 部分一致（大文字小文字区別なし）
  var convLower = convName.toLowerCase();
  var total = 0;
  Object.keys(cbn).forEach(function(key) {
    var keyLower = key.toLowerCase();
    if (keyLower === convLower ||
        keyLower.indexOf(convLower) >= 0 ||
        convLower.indexOf(keyLower) >= 0) {
      total += (cbn[key] || 0);
    }
  });
  return total;
}


// ================================================
// シートへの書き込み
// ================================================
function writeToSheetWhite(sheet, cpnData, crData, startDate, endDate) {
  // ---- 既存データクリア（6行目以降）----
  var lastRow = sheet.getLastRow();
  if (lastRow >= 6) {
    sheet.getRange(6, 1, lastRow - 5, 26).clearContent();
    sheet.getRange(6, 1, lastRow - 5, 26).clearFormat();
  }

  var currentRow = 6;

  // ===================================================
  // ■ CPN別集計
  // ===================================================
  // セクションタイトル
  var cpnTitleCell = sheet.getRange(currentRow, 2);
  cpnTitleCell.setValue('■ CPN別集計　（' + startDate + ' 〜 ' + endDate + '）');
  cpnTitleCell.setFontWeight('bold').setFontSize(11)
              .setBackground('#4472C4').setFontColor('#FFFFFF');
  sheet.getRange(currentRow, 2, 1, 15).setBackground('#4472C4');
  currentRow++;

  // ヘッダー行
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
       .setFontWeight('bold').setBackground('#DCE6F1').setHorizontalAlignment('center');
  currentRow++;

  // データ行
  var cpnStartRow = currentRow;
  if (cpnData.length > 0) {
    var cpnValues = cpnData.map(function(d) {
      return [
        d.campaignName,           // B: CPN名
        convertSpendWhite(d.spend),    // C: ①配信金額
        '',                   // D: ②CPC (計算)
        '',                   // E: ③CPM (計算)
        d.impressions,        // F: ④Imp
        d.clicks,             // G: ⑤Click
        '',                   // H: ⑥CTR (計算)
        d.lpCount,            // I: ⑦LP遷移数
        '',                   // J: ⑧LP遷移率 (計算)
        '',                   // K: ⑨LPCVR (計算)
        d.confirmCount,       // L: ⑩確認画面遷移数
        '',                   // M: ⑪確認画面遷移率 (計算)
        d.cvCount,            // N: ⑫CV数
        '',                   // O: ⑬CVR (計算)
        ''                    // P: ⑭CPA (計算)
      ];
    });
    sheet.getRange(cpnStartRow, 2, cpnValues.length, 15).setValues(cpnValues);

    // 数値列を右揃え（C列=3 〜 P列=16 の14列、B列=CPN名は除く）
    sheet.getRange(cpnStartRow, 3, cpnData.length, 14).setHorizontalAlignment('right');

    // 数値フォーマット
    sheet.getRange(cpnStartRow, 3, cpnData.length, 1).setNumberFormat('¥#,##0');   // 配信金額
    sheet.getRange(cpnStartRow, 6, cpnData.length, 1).setNumberFormat('#,##0');    // Imp
    sheet.getRange(cpnStartRow, 7, cpnData.length, 1).setNumberFormat('#,##0');    // Click
    sheet.getRange(cpnStartRow, 9, cpnData.length, 1).setNumberFormat('#,##0');    // LP遷移数
    sheet.getRange(cpnStartRow, 12, cpnData.length, 1).setNumberFormat('#,##0');   // 確認画面遷移数
    sheet.getRange(cpnStartRow, 14, cpnData.length, 1).setNumberFormat('#,##0');   // CV数

    // 計算列のフォーミュラ設定
    for (var i = 0; i < cpnData.length; i++) {
      var row = cpnStartRow + i;
      setCpnFormulasWhite(sheet, row);
    }

    currentRow += cpnData.length;
  } else {
    sheet.getRange(currentRow, 2).setValue('(該当期間にデータなし)');
    currentRow++;
  }

  currentRow += 2;  // 空行

  // ===================================================
  // ■ CR別集計
  // ===================================================
  var crTitleCell = sheet.getRange(currentRow, 2);
  crTitleCell.setValue('■ CR別集計　（' + startDate + ' 〜 ' + endDate + '）');
  crTitleCell.setFontWeight('bold').setFontSize(11)
             .setBackground('#375623').setFontColor('#FFFFFF');
  sheet.getRange(currentRow, 2, 1, 17).setBackground('#375623');
  currentRow++;

  // CR ヘッダー行
  var crHeaders = [
    'CPN名', 'CR画像', 'CRタイトル',
    '①配信金額', '②CPC', '③CPM',
    '④Imp', '⑤Click', '⑥CTR',
    '⑦LP遷移数', '⑧LP遷移率', '⑨LPCVR',
    '⑩確認画面遷移数', '⑪確認画面遷移率',
    '⑫CV数', '⑬CVR', '⑭CPA'
  ];
  var crHeaderRow = currentRow;
  sheet.getRange(crHeaderRow, 2, 1, crHeaders.length).setValues([crHeaders]);
  sheet.getRange(crHeaderRow, 2, 1, crHeaders.length)
       .setFontWeight('bold').setBackground('#E2EFDA').setHorizontalAlignment('center');
  currentRow++;

  // CR データ行
  var crStartRow = currentRow;
  if (crData.length > 0) {
    var crValues = crData.map(function(d) {
      return [
        d.campaignName,   // B: CPN名
        '',               // C: CR画像 (IMAGEフォーミュラ)
        d.title,          // D: CRタイトル
        convertSpendWhite(d.spend),    // E: ①配信金額
        '',               // F: ②CPC (計算)
        '',               // G: ③CPM (計算)
        d.impressions,    // H: ④Imp
        d.clicks,         // I: ⑤Click
        '',               // J: ⑥CTR (計算)
        d.lpCount,        // K: ⑦LP遷移数
        '',               // L: ⑧LP遷移率 (計算)
        '',               // M: ⑨LPCVR (計算)
        d.confirmCount,   // N: ⑩確認画面遷移数
        '',               // O: ⑪確認画面遷移率 (計算)
        d.cvCount,        // P: ⑫CV数
        '',               // Q: ⑬CVR (計算)
        ''                // R: ⑭CPA (計算)
      ];
    });
    sheet.getRange(crStartRow, 2, crValues.length, crHeaders.length).setValues(crValues);

    // 数値列を右揃え（E列=5 〜 R列=18 の14列、B=CPN名/C=画像/D=タイトルは除く）
    sheet.getRange(crStartRow, 5, crData.length, 14).setHorizontalAlignment('right');

    // 数値フォーマット
    sheet.getRange(crStartRow, 5, crData.length, 1).setNumberFormat('¥#,##0');   // 配信金額
    sheet.getRange(crStartRow, 8, crData.length, 1).setNumberFormat('#,##0');    // Imp
    sheet.getRange(crStartRow, 9, crData.length, 1).setNumberFormat('#,##0');    // Click
    sheet.getRange(crStartRow, 11, crData.length, 1).setNumberFormat('#,##0');   // LP遷移数
    sheet.getRange(crStartRow, 14, crData.length, 1).setNumberFormat('#,##0');   // 確認画面遷移数
    sheet.getRange(crStartRow, 16, crData.length, 1).setNumberFormat('#,##0');   // CV数

    // 画像と計算列のフォーミュラ
    for (var j = 0; j < crData.length; j++) {
      var crRow = crStartRow + j;
      var d     = crData[j];

      // 画像セル（C列 = 列3）
      if (d.imageUrl) {
        sheet.getRange(crRow, 3).setFormula('=IMAGE("' + d.imageUrl.replace(/"/g, '') + '",1)');
      } else {
        sheet.getRange(crRow, 3).setValue('(画像なし)');
      }

      setCrFormulasWhite(sheet, crRow);
    }

    // 行の高さを設定（画像表示用）
    for (var k = crStartRow; k < crStartRow + crData.length; k++) {
      sheet.setRowHeight(k, 80);
    }

    // 列幅設定
    sheet.setColumnWidth(2, 320);   // B: CPN名
    sheet.setColumnWidth(3, 120);   // C: 画像
    sheet.setColumnWidth(4, 280);   // D: タイトル

    currentRow += crData.length;
  } else {
    sheet.getRange(currentRow, 2).setValue('(CR別データ取得不可 - コンテンツレポートAPIへのアクセスを確認してください)');
    currentRow++;
  }

  Logger.log('シート書き込み完了。最終行: ' + currentRow);
}

// ================================================
// CPN別 計算フォーミュラ設定
// ================================================
// 列: B=2, C=3(配信金額), D=4(CPC), E=5(CPM), F=6(Imp), G=7(Click),
//     H=8(CTR), I=9(LP遷移数), J=10(LP遷移率), K=11(LPCVR),
//     L=12(確認画面), M=13(確認画面率), N=14(CV数), O=15(CVR), P=16(CPA)
function setCpnFormulasWhite(sheet, row) {
  var spend   = 'C' + row;
  var imp     = 'F' + row;
  var click   = 'G' + row;
  var lp      = 'I' + row;
  var confirm = 'L' + row;
  var cv      = 'N' + row;

  sheet.getRange(row, 4).setFormula(  // ②CPC
    '=IFERROR(ROUND(' + spend + '/' + click + ',1),"")');
  sheet.getRange(row, 5).setFormula(  // ③CPM
    '=IFERROR(ROUND(' + spend + '/' + imp + '*1000,1),"")');
  sheet.getRange(row, 8).setFormula(  // ⑥CTR
    '=IFERROR(TEXT(' + click + '/' + imp + ',"0.00%"),"")');
  sheet.getRange(row, 10).setFormula( // ⑧LP遷移率
    '=IFERROR(TEXT(' + lp + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 11).setFormula( // ⑨LPCVR
    '=IFERROR(TEXT(' + cv + '/' + lp + ',"0.00%"),"")');
  sheet.getRange(row, 13).setFormula( // ⑪確認画面遷移率
    '=IFERROR(TEXT(' + confirm + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 15).setFormula( // ⑬CVR
    '=IFERROR(TEXT(' + cv + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 16).setFormula( // ⑭CPA
    '=IFERROR(ROUND(' + spend + '/' + cv + ',0),"")');
}

// ================================================
// CR別 計算フォーミュラ設定
// ================================================
// 列: B=2(CPN名), C=3(画像), D=4(タイトル),
//     E=5(配信金額), F=6(CPC), G=7(CPM), H=8(Imp), I=9(Click),
//     J=10(CTR), K=11(LP遷移数), L=12(LP遷移率), M=13(LPCVR),
//     N=14(確認画面), O=15(確認画面率), P=16(CV数), Q=17(CVR), R=18(CPA)
function setCrFormulasWhite(sheet, row) {
  var spend   = 'E' + row;
  var imp     = 'H' + row;
  var click   = 'I' + row;
  var lp      = 'K' + row;
  var confirm = 'N' + row;
  var cv      = 'P' + row;

  sheet.getRange(row, 6).setFormula(  // ②CPC
    '=IFERROR(ROUND(' + spend + '/' + click + ',1),"")');
  sheet.getRange(row, 7).setFormula(  // ③CPM
    '=IFERROR(ROUND(' + spend + '/' + imp + '*1000,1),"")');
  sheet.getRange(row, 10).setFormula( // ⑥CTR
    '=IFERROR(TEXT(' + click + '/' + imp + ',"0.00%"),"")');
  sheet.getRange(row, 12).setFormula( // ⑧LP遷移率
    '=IFERROR(TEXT(' + lp + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 13).setFormula( // ⑨LPCVR
    '=IFERROR(TEXT(' + cv + '/' + lp + ',"0.00%"),"")');
  sheet.getRange(row, 15).setFormula( // ⑪確認画面遷移率
    '=IFERROR(TEXT(' + confirm + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 17).setFormula( // ⑬CVR
    '=IFERROR(TEXT(' + cv + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 18).setFormula( // ⑭CPA
    '=IFERROR(ROUND(' + spend + '/' + cv + ',0),"")');
}

// ================================================
// コンバージョン名一覧確認
// ================================================
function listConversionEventsWhite() {
  var ui    = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var user  = props.getProperty('OB_USERNAME');
  var pass  = props.getProperty('OB_PASSWORD');
  var mid   = MARKETER_ID_WHITE;

  if (!user || !pass) {
    ui.alert('OB_USERNAMEとOB_PASSWORDを設定してください。');
    return;
  }

  var token = getOutbrainTokenWhite(user, pass);
  if (!token) { ui.alert('認証失敗'); return; }

  // 1キャンペーンのレポートを取得してコンバージョン名を確認
  var today     = new Date();
  var weekAgo   = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  var from      = formatDateForAPIWhite(weekAgo);
  var to        = formatDateForAPIWhite(today);
  var url       = BASE_URL + '/reports/marketers/' + mid + '/campaigns/periodic?from=' + from + '&to=' + to + '&breakdown=daily&limit=5';

  try {
    var resp = UrlFetchApp.fetch(url, { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());
    var names = {};

    (data.campaignResults || []).forEach(function(camp) {
      (camp.results || []).forEach(function(r) {
        var m = r.metrics || {};
        (m.conversionsByType || m.conversionsByName || []).forEach(function(cv) {
          var n = cv.name || cv.eventName || cv.type || '';
          if (n) names[n] = true;
        });
      });
    });

    var nameList = Object.keys(names);
    if (nameList.length > 0) {
      ui.alert('コンバージョン名一覧:\n' + nameList.join('\n') +
               '\n\nスクリプトプロパティに設定してください。');
    } else {
      Logger.log('コンバージョン名が見つかりません。レスポンス例:\n' + JSON.stringify(data).substring(0, 500));
      ui.alert('コンバージョン名が見つかりませんでした。\nLogsで詳細を確認してください。\n\n' +
               '注意: LP遷移数などはOutbrain管理画面でコンバージョンとして設定する必要があります。');
    }
  } catch(e) {
    Logger.log('listConversionEvents 例外: ' + e.toString());
    ui.alert('エラーが発生しました: ' + e.toString());
  }
}

// ================================================
// 設定ガイド
// ================================================
function showSetupGuideWhite() {
  var html = HtmlService.createHtmlOutput(
    '<html><body style="font-family:Noto Sans JP,sans-serif;padding:15px;font-size:13px;">' +
    '<h3 style="color:#4472C4">ホワイトOutbrain数値集計 - 設定ガイド</h3>' + // ★変更
    '<h4>① スクリプトプロパティの設定</h4>' +
    '<p>Apps Script エディタで：<br>' +
    '<b>プロジェクトの設定（歯車アイコン）→ スクリプトプロパティ</b> に以下を追加：</p>' +
    '<table border="1" cellpadding="5" style="border-collapse:collapse">' +
    '<tr><th>プロパティ名</th><th>値</th></tr>' +
    '<tr><td>OB_USERNAME</td><td>Outbrainのメールアドレス</td></tr>' +
    '<tr><td>OB_PASSWORD</td><td>Outbrainのパスワード</td></tr>' +
    '<tr><td>OB_MARKETER_ID</td><td>0033e4d3d312b31c84630c2166acec7b27</td></tr>' + // ★変更
    '</table>' +
    '<p>コンバージョン名は以下で固定設定済み（変更不要）：</p>' +
    '<ul>' +
    '<li>⑦LP遷移数 → <b>01LP Conversions (Click)</b></li>' +         // ★変更
    '<li>⑩確認画面遷移数 → <b>02 confirm 1day Conversions (Click)</b></li>' + // ★変更
    '<li>⑫CV数 → <b>thanks 1day Conversions (Click)</b></li>' +      // ★変更
    '</ul>' +
    '<h4>② レポート実行</h4>' +
    '<ol>' +
    '<li>「数値集計②」シートのC2に開始日を入力（例: 2026/04/01）</li>' + // ★変更
    '<li>C3に終了日を入力（例: 2026/04/04）</li>' +
    '<li>メニュー「ホワイトOutbrainレポート ▶ レポート取得実行」をクリック</li>' + // ★変更
    '</ol>' +
    '<h4>③ コンバージョン名の確認</h4>' +
    '<p>「コンバージョン名を確認」メニューを使うと、設定されているコンバージョン名を確認できます。</p>' +
    '<p><b>注意：</b>LP遷移数・確認画面遷移数は、Outbrain管理画面でコンバージョンとして設定されている必要があります。</p>' +
    '<button onclick="google.script.host.close()" style="margin-top:10px;padding:5px 15px;">閉じる</button>' +
    '</body></html>'
  ).setWidth(560).setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, 'ホワイトOutbrain設定ガイド'); // ★変更
}

// ================================================
// APIデバッグ：breakdownパラメータ別にレスポンスを確認
// ================================================
function debugApiBreakdownsWhite() {
  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = MARKETER_ID_WHITE;

  var token = getOutbrainTokenWhite(username, password);
  if (!token) { SpreadsheetApp.getUi().alert('認証失敗'); return; }

  var from = '2026-04-01';
  var to   = '2026-04-04';
  var baseParams = '?from=' + from + '&to=' + to + '&limit=5';

  var tests = [
    { label: 'breakdown=conversionGoal', url: BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic' + baseParams + '&breakdown=conversionGoal' },
    { label: 'breakdown=promotedLink',   url: BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic' + baseParams + '&breakdown=promotedLink' },
    { label: 'breakdown=content',        url: BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic' + baseParams + '&breakdown=content' },
    { label: 'breakdown=section',        url: BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic' + baseParams + '&breakdown=section' },
    { label: 'no breakdown',             url: BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic' + baseParams }
  ];

  tests.forEach(function(t) {
    try {
      var resp = UrlFetchApp.fetch(t.url, {
        headers: { 'OB-TOKEN-V1': token },
        muteHttpExceptions: true
      });
      Logger.log('=== ' + t.label + ' ===');
      Logger.log('status: ' + resp.getResponseCode());
      Logger.log('response: ' + resp.getContentText().substring(0, 800));
    } catch(e) {
      Logger.log('=== ' + t.label + ' 例外: ' + e.toString());
    }
    Utilities.sleep(300);
  });

  SpreadsheetApp.getUi().alert('デバッグ完了。Apps Script > ログ を確認してください。');
}
