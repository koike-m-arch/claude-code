/**
 * ===============================================
 * Outbrain 数値集計スクリプト
 * スプレッドシート：山忠様案件_数値集計
 * シート：ととのえる（OB）
 * ===============================================
 *
 * 【初期設定】
 * Apps Script エディタで「プロジェクトの設定」→「スクリプトプロパティ」に以下を追加：
 *   OB_USERNAME      : Outbrainのログインメールアドレス（miraikirei）
 *   OB_PASSWORD      : Outbrainのパスワード
 *   ※ OB_MARKETER_ID は不要（コードに直接埋め込み済み）
 *
 * 【コンバージョン名（固定設定済み・変更不要）】
 *   ⑦LP遷移数（W） → "1Day 01 LP walking"
 *   ⑨LP遷移数（B） → "1Day 01LP basic"
 *   ⑪カート追加   → "Add to cart NEW(4/7~)"
 *   ⑬CV数         → "thanks 01day"
 */

// ================================================
// API・キャッシュ定数
// ================================================
var BASE_URL           = 'https://api.outbrain.com/amplify/v0.1';
var TOKEN_CACHE_KEY    = 'OB_TOKEN_CACHE';
var TOKEN_CACHE_TS_KEY = 'OB_TOKEN_CACHE_TS';
var TOKEN_TTL_MS       = 4 * 60 * 60 * 1000; // 4時間有効

// ================================================
// コンバージョン名定数（APIが返す実際の名前）
// 管理画面の表示名から " Conversions (Click)" を除いたもの
// ================================================
var LP_WALK_DEFAULT  = '1Day 01 LP walking';   // APIが返す実際の名前
var LP_BASIC_DEFAULT = '1Day 01LP basic';     // APIが返す実際の名前
var CART_DEFAULT     = 'Add to cart\u3000NEW(4/7~)'; // APIが返す実際の名前（全角スペースあり）
var CV_DEFAULT       = 'thanks 01day';         // APIが返す実際の名前

var SHEET_NAME_TOTONOERU  = 'ととのえる（OB）';
var MARKETER_ID_TOTONOERU = '007d79ad320ca3facfae0f6c585b8a46f1'; // ととのえる固定（Script Propertiesに依存しない）

// ================================================
// 配信金額変換（API値 → 管理画面表示値）
// ================================================
function convertSpendTotonoeru(spend) {
  return Math.round(spend / 0.8 * 1.1);
}

// ================================================
// カスタムメニュー
// ================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔧 ととのえるOBレポート')
    .addItem('▶ レポート取得実行', 'runOutbrainReportTotonoeru')
    .addSeparator()
    .addItem('🔍 APIデバッグ実行', 'debugApiBreakdownsTotonoeru')
    .addItem('📋 コンバージョン名を確認', 'listConversionEventsTotonoeru')
    .addItem('⚙ 設定ガイド', 'showSetupGuideTotonoeru')
    .addToUi();
}

// ================================================
// API実行用エントリポイント（UI不使用・外部から呼び出し可能）
// ================================================
function runOutbrainReportApiTotonoeru(startDate, endDate) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_TOTONOERU);

  if (!startDate || !endDate) {
    var startVal = sheet.getRange('C2').getValue();
    var endVal   = sheet.getRange('C3').getValue();
    startDate = formatDateForAPITotonoeru(startVal);
    endDate   = formatDateForAPITotonoeru(endVal);
  }

  if (!sheet)    { return { success: false, error: 'ととのえる（OB）シートが見つかりません' }; }
  if (!startDate || !endDate) { return { success: false, error: 'C2/C3に日付が設定されていません' }; }

  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = MARKETER_ID_TOTONOERU;
  var lpWalk     = props.getProperty('LP_WALK_CONV_NAME')  || LP_WALK_DEFAULT;
  var lpBasic    = props.getProperty('LP_BASIC_CONV_NAME') || LP_BASIC_DEFAULT;
  var cart       = props.getProperty('CART_CONV_NAME')     || CART_DEFAULT;
  var cv         = props.getProperty('CV_CONV_NAME')       || CV_DEFAULT;

  if (!username || !password) { return { success: false, error: 'OB_USERNAME/OB_PASSWORD が未設定です' }; }

  var token = getOutbrainTokenTotonoeru(username, password);
  if (!token) { return { success: false, error: 'Outbrain認証失敗' }; }

  var campaignMap      = buildCampaignMapTotonoeru(token, marketerId);
  var cpnData          = getCampaignReportTotonoeru(token, marketerId, startDate, endDate, lpWalk, lpBasic, cart, cv, campaignMap);
  var activeCampaignIds = cpnData.map(function(d) { return d.campaignId; });
  var crData           = getCreativeReportTotonoeru(token, marketerId, activeCampaignIds, startDate, endDate, lpWalk, lpBasic, cart, cv, campaignMap);

  writeToSheetTotonoeru(sheet, cpnData, crData, startDate, endDate);
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
function runOutbrainReportTotonoeru() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_TOTONOERU);

  if (!sheet) {
    ui.alert('「ととのえる（OB）」シートが見つかりません。');
    return;
  }

  var startVal = sheet.getRange('C2').getValue();
  var endVal   = sheet.getRange('C3').getValue();

  if (!startVal || !endVal) {
    ui.alert('開始日（C2）と終了日（C3）を入力してください。\n例: 2026/04/01');
    return;
  }

  var startDate = formatDateForAPITotonoeru(startVal);
  var endDate   = formatDateForAPITotonoeru(endVal);

  if (!startDate || !endDate) {
    ui.alert('日付の形式が正しくありません。\n例: 2026/04/01');
    return;
  }

  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = MARKETER_ID_TOTONOERU;
  var lpWalk     = props.getProperty('LP_WALK_CONV_NAME')  || LP_WALK_DEFAULT;
  var lpBasic    = props.getProperty('LP_BASIC_CONV_NAME') || LP_BASIC_DEFAULT;
  var cart       = props.getProperty('CART_CONV_NAME')     || CART_DEFAULT;
  var cv         = props.getProperty('CV_CONV_NAME')       || CV_DEFAULT;

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
  var token = getOutbrainTokenTotonoeru(username, password);
  if (!token) {
    ui.alert('Outbrain認証失敗。\nメールアドレス・パスワードを確認してください。\n詳細はログ（Apps Script > ログ）を確認。');
    return;
  }
  Logger.log('認証成功');

  var campaignMap = buildCampaignMapTotonoeru(token, marketerId);
  Logger.log('キャンペーン数: ' + Object.keys(campaignMap).length);

  var cpnData = getCampaignReportTotonoeru(token, marketerId, startDate, endDate, lpWalk, lpBasic, cart, cv, campaignMap);
  Logger.log('有効CPN数: ' + cpnData.length);

  var activeCampaignIds = cpnData.map(function(d) { return d.campaignId; });

  var crData = getCreativeReportTotonoeru(token, marketerId, activeCampaignIds, startDate, endDate, lpWalk, lpBasic, cart, cv, campaignMap);
  Logger.log('有効CR数: ' + crData.length);

  writeToSheetTotonoeru(sheet, cpnData, crData, startDate, endDate);
  SpreadsheetApp.flush();

  ui.alert(
    'レポート取得完了！\n' +
    'キャンペーン: ' + cpnData.length + '件\n' +
    'クリエイティブ: ' + crData.length + '件\n\n' +
    '⚠ コンバージョン数はOutbrain管理画面での設定が必要です。'
  );
}

// ================================================
// 日付フォーマット
// ================================================
function formatDateForAPITotonoeru(val) {
  if (!val) return null;
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return null;
  var y  = d.getFullYear();
  var m  = ('0' + (d.getMonth() + 1)).slice(-2);
  var dy = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + dy;
}

function formatDateJPTotonoeru(val) {
  if (!val) return '';
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2);
}

// ================================================
// Outbrain 認証（Basic Auth + トークンキャッシュ）
// ================================================
function getOutbrainTokenTotonoeru(username, password) {
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
function buildCampaignMapTotonoeru(token, marketerId) {
  var map    = {};
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
// コンバージョン名マッチング（柔軟一致）
// APIが " Conversions (Click)" サフィックス付きで返す場合にも対応
// ================================================
function convMatchTotonoeru(apiName, targetName) {
  if (!apiName || !targetName) return false;
  // 全角スペース(U+3000)を半角に正規化してから比較
  var normalize = function(s) { return s.replace(/\u3000/g, ' ').toLowerCase().trim(); };
  var a = normalize(apiName);
  var t = normalize(targetName);
  // 完全一致 or APIがサフィックス付き or ターゲットがサフィックス付き
  return a === t || a.indexOf(t) === 0 || t.indexOf(a) === 0;
}

// ================================================
// 管理画面コンバージョンゴールID取得（ブリリオ方式）
// ================================================
function getConversionGoalIdsTotonoeru(token, marketerId, lpWalk, lpBasic, cart, cv) {
  var ids = { lpWalkId: null, lpBasicId: null, cartId: null, cvId: null };
  var tryUrls = [
    BASE_URL + '/marketers/' + marketerId + '/conversionGoals?limit=50',
    BASE_URL + '/marketers/' + marketerId + '/conversionGoals'
  ];
  for (var t = 0; t < tryUrls.length; t++) {
    try {
      var resp = UrlFetchApp.fetch(tryUrls[t], {
        headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true
      });
      Logger.log('conversionGoals[' + t + '] status: ' + resp.getResponseCode());
      if (resp.getResponseCode() !== 200) continue;
      var data = JSON.parse(resp.getContentText());
      var list = data.conversionGoals || data.goals || [];
      Logger.log('conversionGoals 件数: ' + list.length);
      list.forEach(function(g) {
        var id   = g.id || '';
        var name = (g.name || '').toLowerCase();
        Logger.log('  goal id=' + id + ' name=' + name);
        if (!ids.lpWalkId  && (name.indexOf(lpWalk.toLowerCase())  >= 0 || lpWalk.toLowerCase().indexOf(name)  >= 0)) ids.lpWalkId  = id;
        if (!ids.lpBasicId && (name.indexOf(lpBasic.toLowerCase()) >= 0 || lpBasic.toLowerCase().indexOf(name) >= 0)) ids.lpBasicId = id;
        if (!ids.cartId    && (name.indexOf(cart.toLowerCase())    >= 0 || cart.toLowerCase().indexOf(name)    >= 0)) ids.cartId    = id;
        if (!ids.cvId      && (name.indexOf(cv.toLowerCase())      >= 0 || cv.toLowerCase().indexOf(name)      >= 0)) ids.cvId      = id;
      });
      Logger.log('goalIds: lpWalk=' + ids.lpWalkId + ' lpBasic=' + ids.lpBasicId + ' cart=' + ids.cartId + ' cv=' + ids.cvId);
      break;
    } catch(e) {
      Logger.log('getConversionGoalIds 例外: ' + e.toString());
    }
  }
  return ids;
}

// ================================================
// ゴールIDを使ったキャンペーン別コンバージョン取得
// ================================================
function getConversionsByGoalIdTotonoeru(token, marketerId, from, to, goalIds) {
  var result = {};
  var targets = [
    { id: goalIds.lpWalkId,  field: 'lpWalkCount' },
    { id: goalIds.lpBasicId, field: 'lpBasicCount' },
    { id: goalIds.cartId,    field: 'cartCount' },
    { id: goalIds.cvId,      field: 'cvCount' }
  ];
  targets.forEach(function(target) {
    if (!target.id) { Logger.log('  [' + target.field + '] ゴールIDなし'); return; }
    Utilities.sleep(200);
    try {
      var url = BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic' +
                '?from=' + from + '&to=' + to + '&conversionGoalId=' + target.id;
      var resp = UrlFetchApp.fetch(url, { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true });
      Logger.log('  [' + target.field + '] goalId=' + target.id + ' status=' + resp.getResponseCode());
      if (resp.getResponseCode() !== 200) return;
      var data = JSON.parse(resp.getContentText());
      var total = 0;
      (data.campaignResults || []).forEach(function(camp) {
        var cid = camp.campaignId;
        if (!result[cid]) result[cid] = { lpWalkCount: 0, lpBasicCount: 0, cartCount: 0, cvCount: 0 };
        (camp.results || []).forEach(function(r) {
          var val = (r.metrics || {}).conversions || (r.metrics || {}).totalConversions || 0;
          result[cid][target.field] += val;
          total += val;
        });
      });
      Logger.log('  [' + target.field + '] 合計=' + total);
    } catch(e) {
      Logger.log('  [' + target.field + '] 例外: ' + e.toString());
    }
  });
  return result;
}

// ================================================
// キャンペーン別レポート（includeConversionDetails方式）
// ================================================
function getCampaignReportTotonoeru(token, marketerId, from, to, lpWalk, lpBasic, cart, cv, campaignMap) {
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
      var tot = { spend: 0, impressions: 0, clicks: 0, lpWalkCount: 0, lpBasicCount: 0, cartCount: 0, cvCount: 0, totalConversions: 0 };
      (camp.results || []).forEach(function(r) {
        var m = r.metrics || {};
        tot.spend             += (m.spend       || 0);
        tot.impressions       += (m.impressions || 0);
        tot.clicks            += (m.clicks      || 0);
        tot.totalConversions  += (m.conversions || 0);
        var convList = m.conversionMetrics || m.conversions_per_goal || [];
        if (convList.length > 0) {
          convList.forEach(function(cm) {
            var name = (cm.name || '').trim();
            var val  = cm.conversions || 0;
            Logger.log('  CPN conv: "' + name + '" = ' + val);
            if (convMatchTotonoeru(name, lpWalk))  tot.lpWalkCount  += val;
            if (convMatchTotonoeru(name, lpBasic)) tot.lpBasicCount += val;
            if (convMatchTotonoeru(name, cart))    tot.cartCount    += val;
            if (convMatchTotonoeru(name, cv))      tot.cvCount      += val;
          });
        }
      });
      // CV が名前マッチで取れなかった場合は合計コンバージョンをフォールバック
      if (tot.cvCount === 0 && tot.totalConversions > 0) {
        tot.cvCount = tot.totalConversions;
      }
      if (tot.spend >= 1) {
        results.push({
          campaignId:    cid,
          campaignName:  campaignMap[cid] || cid,
          spend:         tot.spend,
          impressions:   tot.impressions,
          clicks:        tot.clicks,
          lpWalkCount:   tot.lpWalkCount,
          lpBasicCount:  tot.lpBasicCount,
          cartCount:     tot.cartCount,
          cvCount:       tot.cvCount
        });
      }
    });
  } catch(e) {
    Logger.log('getCampaignReport 例外: ' + e.toString());
  }

  // ── ゴールID方式フォールバック（LP値が全0の場合） ──
  var totalLp = results.reduce(function(sum, d) { return sum + d.lpWalkCount + d.lpBasicCount; }, 0);
  if (totalLp === 0 && results.length > 0) {
    Logger.log('LP値が0のためゴールID方式にフォールバック...');
    var goalIds  = getConversionGoalIdsTotonoeru(token, marketerId, lpWalk, lpBasic, cart, cv);
    var goalData = getConversionsByGoalIdTotonoeru(token, marketerId, from, to, goalIds);
    results.forEach(function(d) {
      var g = goalData[d.campaignId];
      if (!g) return;
      if (d.lpWalkCount  === 0 && g.lpWalkCount  > 0) d.lpWalkCount  = g.lpWalkCount;
      if (d.lpBasicCount === 0 && g.lpBasicCount > 0) d.lpBasicCount = g.lpBasicCount;
      if (d.cartCount    === 0 && g.cartCount    > 0) d.cartCount    = g.cartCount;
      if (d.cvCount      === 0 && g.cvCount      > 0) d.cvCount      = g.cvCount;
    });
    Logger.log('フォールバック後LP合計: ' + results.reduce(function(s, d) { return s + d.lpWalkCount + d.lpBasicCount; }, 0));
  }

  results.sort(function(a, b) { return b.spend - a.spend; });
  return results;
}

// ================================================
// CR別レポート（promotedContentエンドポイント使用）
// ================================================
function getCreativeReportTotonoeru(token, marketerId, campaignIds, from, to, lpWalk, lpBasic, cart, cv, campaignMap) {
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

      var m = item.metrics || {};
      var lpW = 0, lpB = 0, cartVal = 0, cvVal = 0;
      var convList = m.conversionMetrics || m.conversions_per_goal || [];
      convList.forEach(function(cm) {
        var name = (cm.name || '').trim();
        var val  = cm.conversions || 0;
        if (convMatchTotonoeru(name, lpWalk))  lpW     += val;
        if (convMatchTotonoeru(name, lpBasic)) lpB     += val;
        if (convMatchTotonoeru(name, cart))    cartVal += val;
        if (convMatchTotonoeru(name, cv))      cvVal   += val;
      });

      var imgMeta  = meta.imageMetadata || {};
      var imageUrl = imgMeta.originalImageUrl || imgMeta.requestedImageUrl || '';

      var cr = {
        campaignId:   campId,
        campaignName: meta.campaignName || campaignMap[campId] || campId,
        crId:         meta.id || '',
        title:        meta.title || '',
        imageUrl:     imageUrl,
        spend:        m.spend       || 0,
        impressions:  m.impressions || 0,
        clicks:       m.clicks      || 0,
        lpWalkCount:  lpW,
        lpBasicCount: lpB,
        cartCount:    cartVal,
        cvCount:      (cvVal > 0) ? cvVal : (m.conversions || 0)
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
// シートへの書き込み
// ================================================
// 【CPN別 列構成】
// B=CPN名, C=①配信金額, D=②CPC, E=③CPM,
// F=④Imp, G=⑤Click, H=⑥CTR,
// I=⑦LP遷移数(W), J=⑧LP遷移率(W),
// K=⑨LP遷移数(B), L=⑩LP遷移率(B),
// M=⑪カート追加, N=⑫カート率,
// O=⑬CV数, P=⑭CVR, Q=⑮LPCVR(W), R=⑯CPA
//
// 【CR別 列構成】
// B=CPN名, C=CR画像, D=CRタイトル,
// E=①配信金額, F=②CPC, G=③CPM,
// H=④Imp, I=⑤Click, J=⑥CTR,
// K=⑦LP遷移数(W), L=⑧LP遷移率(W),
// M=⑨LP遷移数(B), N=⑩LP遷移率(B),
// O=⑪カート追加, P=⑫カート率,
// Q=⑬CV数, R=⑭CVR, S=⑮LPCVR(W), T=⑯CPA
function writeToSheetTotonoeru(sheet, cpnData, crData, startDate, endDate) {
  // 既存データクリア（6行目以降）
  var lastRow = sheet.getLastRow();
  if (lastRow >= 6) {
    sheet.getRange(6, 1, lastRow - 5, 20).clearContent();
    sheet.getRange(6, 1, lastRow - 5, 20).clearFormat();
  }

  var currentRow = 6;

  // ===================================================
  // ■ CPN別集計
  // ===================================================
  var cpnTitleCell = sheet.getRange(currentRow, 2);
  cpnTitleCell.setValue('■ CPN別集計　（' + startDate + ' 〜 ' + endDate + '）');
  cpnTitleCell.setFontWeight('bold').setFontSize(11)
              .setBackground('#4472C4').setFontColor('#FFFFFF');
  sheet.getRange(currentRow, 2, 1, 17).setBackground('#4472C4');
  currentRow++;

  var cpnHeaders = [
    'CPN名',
    '①配信金額', '②CPC', '③CPM',
    '④Imp', '⑤Click', '⑥CTR',
    '⑦LP遷移数(W)', '⑧LP遷移率(W)',
    '⑨LP遷移数(B)', '⑩LP遷移率(B)',
    '⑪カート追加', '⑫カート率',
    '⑬CV数', '⑭CVR', '⑮LPCVR(W+B)', '⑯CPA'
  ];
  var cpnHeaderRow = currentRow;
  sheet.getRange(cpnHeaderRow, 2, 1, cpnHeaders.length).setValues([cpnHeaders]);
  sheet.getRange(cpnHeaderRow, 2, 1, cpnHeaders.length)
       .setFontWeight('bold').setBackground('#DCE6F1').setHorizontalAlignment('center');
  currentRow++;

  var cpnStartRow = currentRow;
  if (cpnData.length > 0) {
    var cpnValues = cpnData.map(function(d) {
      return [
        d.campaignName,           // B: CPN名
        convertSpendTotonoeru(d.spend),    // C: ①配信金額
        '',                       // D: ②CPC（計算）
        '',                       // E: ③CPM（計算）
        d.impressions,            // F: ④Imp
        d.clicks,                 // G: ⑤Click
        '',                       // H: ⑥CTR（計算）
        d.lpWalkCount,            // I: ⑦LP遷移数(W)
        '',                       // J: ⑧LP遷移率(W)（計算）
        d.lpBasicCount,           // K: ⑨LP遷移数(B)
        '',                       // L: ⑩LP遷移率(B)（計算）
        d.cartCount,              // M: ⑪カート追加
        '',                       // N: ⑫カート率（計算）
        d.cvCount,                // O: ⑬CV数
        '',                       // P: ⑭CVR（計算）
        '',                       // Q: ⑮LPCVR(W)（計算）
        ''                        // R: ⑯CPA（計算）
      ];
    });
    sheet.getRange(cpnStartRow, 2, cpnValues.length, 17).setValues(cpnValues);

    // 数値列を右揃え（C〜R = 列3〜18）
    sheet.getRange(cpnStartRow, 3, cpnData.length, 16).setHorizontalAlignment('right');

    // 数値フォーマット
    sheet.getRange(cpnStartRow, 3, cpnData.length, 1).setNumberFormat('¥#,##0');  // 配信金額
    sheet.getRange(cpnStartRow, 6, cpnData.length, 1).setNumberFormat('#,##0');   // Imp
    sheet.getRange(cpnStartRow, 7, cpnData.length, 1).setNumberFormat('#,##0');   // Click
    sheet.getRange(cpnStartRow, 9, cpnData.length, 1).setNumberFormat('#,##0');   // LP遷移数(W)
    sheet.getRange(cpnStartRow, 11, cpnData.length, 1).setNumberFormat('#,##0');  // LP遷移数(B)
    sheet.getRange(cpnStartRow, 13, cpnData.length, 1).setNumberFormat('#,##0');  // カート追加
    sheet.getRange(cpnStartRow, 15, cpnData.length, 1).setNumberFormat('#,##0');  // CV数

    for (var i = 0; i < cpnData.length; i++) {
      setCpnFormulasTotonoeru(sheet, cpnStartRow + i);
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
  crTitleCell.setFontWeight('bold').setFontSize(11)
             .setBackground('#375623').setFontColor('#FFFFFF');
  sheet.getRange(currentRow, 2, 1, 19).setBackground('#375623');
  currentRow++;

  var crHeaders = [
    'CPN名', 'CR画像', 'CRタイトル',
    '①配信金額', '②CPC', '③CPM',
    '④Imp', '⑤Click', '⑥CTR',
    '⑦LP遷移数(W)', '⑧LP遷移率(W)',
    '⑨LP遷移数(B)', '⑩LP遷移率(B)',
    '⑪カート追加', '⑫カート率',
    '⑬CV数', '⑭CVR', '⑮LPCVR(W+B)', '⑯CPA'
  ];
  var crHeaderRow = currentRow;
  sheet.getRange(crHeaderRow, 2, 1, crHeaders.length).setValues([crHeaders]);
  sheet.getRange(crHeaderRow, 2, 1, crHeaders.length)
       .setFontWeight('bold').setBackground('#E2EFDA').setHorizontalAlignment('center');
  currentRow++;

  var crStartRow = currentRow;
  if (crData.length > 0) {
    var crValues = crData.map(function(d) {
      return [
        d.campaignName,           // B: CPN名
        '',                       // C: CR画像（IMAGEフォーミュラ）
        d.title,                  // D: CRタイトル
        convertSpendTotonoeru(d.spend),    // E: ①配信金額
        '',                       // F: ②CPC（計算）
        '',                       // G: ③CPM（計算）
        d.impressions,            // H: ④Imp
        d.clicks,                 // I: ⑤Click
        '',                       // J: ⑥CTR（計算）
        d.lpWalkCount,            // K: ⑦LP遷移数(W)
        '',                       // L: ⑧LP遷移率(W)（計算）
        d.lpBasicCount,           // M: ⑨LP遷移数(B)
        '',                       // N: ⑩LP遷移率(B)（計算）
        d.cartCount,              // O: ⑪カート追加
        '',                       // P: ⑫カート率（計算）
        d.cvCount,                // Q: ⑬CV数
        '',                       // R: ⑭CVR（計算）
        '',                       // S: ⑮LPCVR(W)（計算）
        ''                        // T: ⑯CPA（計算）
      ];
    });
    sheet.getRange(crStartRow, 2, crValues.length, crHeaders.length).setValues(crValues);

    // 数値列を右揃え（E〜T = 列5〜20）
    sheet.getRange(crStartRow, 5, crData.length, 16).setHorizontalAlignment('right');

    // 数値フォーマット
    sheet.getRange(crStartRow, 5, crData.length, 1).setNumberFormat('¥#,##0');   // 配信金額
    sheet.getRange(crStartRow, 8, crData.length, 1).setNumberFormat('#,##0');    // Imp
    sheet.getRange(crStartRow, 9, crData.length, 1).setNumberFormat('#,##0');    // Click
    sheet.getRange(crStartRow, 11, crData.length, 1).setNumberFormat('#,##0');   // LP遷移数(W)
    sheet.getRange(crStartRow, 13, crData.length, 1).setNumberFormat('#,##0');   // LP遷移数(B)
    sheet.getRange(crStartRow, 15, crData.length, 1).setNumberFormat('#,##0');   // カート追加
    sheet.getRange(crStartRow, 17, crData.length, 1).setNumberFormat('#,##0');   // CV数

    for (var j = 0; j < crData.length; j++) {
      var crRow = crStartRow + j;
      var d     = crData[j];

      if (d.imageUrl) {
        sheet.getRange(crRow, 3).setFormula('=IMAGE("' + d.imageUrl.replace(/"/g, '') + '",1)');
      } else {
        sheet.getRange(crRow, 3).setValue('(画像なし)');
      }

      setCrFormulasTotonoeru(sheet, crRow);
    }

    for (var k = crStartRow; k < crStartRow + crData.length; k++) {
      sheet.setRowHeight(k, 80);
    }

    // 列幅設定
    sheet.setColumnWidth(2, 320);   // B: CPN名
    sheet.setColumnWidth(3, 120);   // C: 画像
    sheet.setColumnWidth(4, 280);   // D: タイトル

    currentRow += crData.length;
  } else {
    sheet.getRange(currentRow, 2).setValue('(CR別データ取得不可)');
    currentRow++;
  }

  Logger.log('シート書き込み完了。最終行: ' + currentRow);
}

// ================================================
// CPN別 計算フォーミュラ設定
// ================================================
// B=2(CPN名), C=3(配信金額), D=4(CPC), E=5(CPM),
// F=6(Imp), G=7(Click), H=8(CTR),
// I=9(LP遷移数W), J=10(LP遷移率W),
// K=11(LP遷移数B), L=12(LP遷移率B),
// M=13(カート), N=14(カート率),
// O=15(CV数), P=16(CVR), Q=17(LPCVR-W), R=18(CPA)
function setCpnFormulasTotonoeru(sheet, row) {
  var spend  = 'C' + row;
  var imp    = 'F' + row;
  var click  = 'G' + row;
  var lpW    = 'I' + row;
  var lpB    = 'K' + row;
  var cart   = 'M' + row;
  var cv     = 'O' + row;

  sheet.getRange(row, 4).setFormula(   // ②CPC
    '=IFERROR(ROUND(' + spend + '/' + click + ',1),"")');
  sheet.getRange(row, 5).setFormula(   // ③CPM
    '=IFERROR(ROUND(' + spend + '/' + imp + '*1000,1),"")');
  sheet.getRange(row, 8).setFormula(   // ⑥CTR
    '=IFERROR(TEXT(' + click + '/' + imp + ',"0.00%"),"")');
  sheet.getRange(row, 10).setFormula(  // ⑧LP遷移率(W)
    '=IFERROR(TEXT(' + lpW + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 12).setFormula(  // ⑩LP遷移率(B)
    '=IFERROR(TEXT(' + lpB + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 14).setFormula(  // ⑫カート率
    '=IFERROR(TEXT(' + cart + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 16).setFormula(  // ⑭CVR
    '=IFERROR(TEXT(' + cv + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 17).setFormula(  // ⑮LPCVR(W+B合計)
    '=IFERROR(TEXT(' + cv + '/(' + lpW + '+' + lpB + '),"0.00%"),"")');
  sheet.getRange(row, 18).setFormula(  // ⑯CPA
    '=IFERROR(ROUND(' + spend + '/' + cv + ',0),"")');
}

// ================================================
// CR別 計算フォーミュラ設定
// ================================================
// B=2(CPN名), C=3(画像), D=4(タイトル),
// E=5(配信金額), F=6(CPC), G=7(CPM),
// H=8(Imp), I=9(Click), J=10(CTR),
// K=11(LP遷移数W), L=12(LP遷移率W),
// M=13(LP遷移数B), N=14(LP遷移率B),
// O=15(カート), P=16(カート率),
// Q=17(CV数), R=18(CVR), S=19(LPCVR-W), T=20(CPA)
function setCrFormulasTotonoeru(sheet, row) {
  var spend = 'E' + row;
  var imp   = 'H' + row;
  var click = 'I' + row;
  var lpW   = 'K' + row;
  var lpB   = 'M' + row;
  var cart  = 'O' + row;
  var cv    = 'Q' + row;

  sheet.getRange(row, 6).setFormula(   // ②CPC
    '=IFERROR(ROUND(' + spend + '/' + click + ',1),"")');
  sheet.getRange(row, 7).setFormula(   // ③CPM
    '=IFERROR(ROUND(' + spend + '/' + imp + '*1000,1),"")');
  sheet.getRange(row, 10).setFormula(  // ⑥CTR
    '=IFERROR(TEXT(' + click + '/' + imp + ',"0.00%"),"")');
  sheet.getRange(row, 12).setFormula(  // ⑧LP遷移率(W)
    '=IFERROR(TEXT(' + lpW + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 14).setFormula(  // ⑩LP遷移率(B)
    '=IFERROR(TEXT(' + lpB + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 16).setFormula(  // ⑫カート率
    '=IFERROR(TEXT(' + cart + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 18).setFormula(  // ⑭CVR
    '=IFERROR(TEXT(' + cv + '/' + click + ',"0.00%"),"")');
  sheet.getRange(row, 19).setFormula(  // ⑮LPCVR(W+B合計)
    '=IFERROR(TEXT(' + cv + '/(' + lpW + '+' + lpB + '),"0.00%"),"")');
  sheet.getRange(row, 20).setFormula(  // ⑯CPA
    '=IFERROR(ROUND(' + spend + '/' + cv + ',0),"")');
}

// ================================================
// コンバージョン名一覧確認
// ================================================
function listConversionEventsTotonoeru() {
  var ui    = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var user  = props.getProperty('OB_USERNAME');
  var pass  = props.getProperty('OB_PASSWORD');
  var mid   = MARKETER_ID_TOTONOERU;

  if (!user || !pass) {
    ui.alert('OB_USERNAMEとOB_PASSWORDを設定してください。');
    return;
  }

  var token = getOutbrainTokenTotonoeru(user, pass);
  if (!token) { ui.alert('認証失敗'); return; }

  var today   = new Date();
  var weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  var from    = formatDateForAPITotonoeru(weekAgo);
  var to      = formatDateForAPITotonoeru(today);
  var url     = BASE_URL + '/reports/marketers/' + mid +
                '/campaigns/periodic?from=' + from + '&to=' + to +
                '&includeConversionDetails=true&limit=3';

  try {
    var resp = UrlFetchApp.fetch(url, { headers: { 'OB-TOKEN-V1': token }, muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());
    var names = {};

    (data.campaignResults || []).forEach(function(camp) {
      (camp.results || []).forEach(function(r) {
        var convList = (r.metrics || {}).conversionMetrics || (r.metrics || {}).conversions_per_goal || [];
        convList.forEach(function(cm) {
          var n = cm.name || '';
          if (n) names[n] = (names[n] || 0) + (cm.conversions || 0);
        });
      });
    });

    // ゴールID一覧も取得して表示
    var goalIds = getConversionGoalIdsTotonoeru(token, mid, LP_WALK_DEFAULT, LP_BASIC_DEFAULT, CART_DEFAULT, CV_DEFAULT);

    var nameList = Object.keys(names);
    var convSection = nameList.length > 0
      ? 'conversionMetrics 取得名:\n' + nameList.map(function(n) { return '  "' + n + '" : ' + names[n]; }).join('\n')
      : 'conversionMetrics: なし（Logsで詳細確認）';

    var goalSection = 'ゴールID取得結果:\n' +
      '  LP遷移数(W): ' + (goalIds.lpWalkId  || '未取得') + '\n' +
      '  LP遷移数(B): ' + (goalIds.lpBasicId || '未取得') + '\n' +
      '  カート追加:  ' + (goalIds.cartId    || '未取得') + '\n' +
      '  CV数:        ' + (goalIds.cvId      || '未取得');

    ui.alert(convSection + '\n\n' + goalSection + '\n\n期待値（定数）:\n' +
      '  "' + LP_WALK_DEFAULT  + '"\n' +
      '  "' + LP_BASIC_DEFAULT + '"\n' +
      '  "' + CART_DEFAULT     + '"\n' +
      '  "' + CV_DEFAULT       + '"');
  } catch(e) {
    Logger.log('listConversionEvents 例外: ' + e.toString());
    ui.alert('エラーが発生しました: ' + e.toString());
  }
}

// ================================================
// 設定ガイド
// ================================================
function showSetupGuideTotonoeru() {
  var html = HtmlService.createHtmlOutput(
    '<html><body style="font-family:Noto Sans JP,sans-serif;padding:15px;font-size:13px;">' +
    '<h3 style="color:#4472C4">ととのえるOutbrain数値集計 - 設定ガイド</h3>' +
    '<h4>① スクリプトプロパティの設定</h4>' +
    '<p>Apps Script エディタで：<br>' +
    '<b>プロジェクトの設定（歯車アイコン）→ スクリプトプロパティ</b> に以下を追加：</p>' +
    '<table border="1" cellpadding="5" style="border-collapse:collapse">' +
    '<tr><th>プロパティ名</th><th>値</th></tr>' +
    '<tr><td>OB_USERNAME</td><td>Outbrainのメールアドレス（miraikirei）</td></tr>' +
    '<tr><td>OB_PASSWORD</td><td>Outbrainのパスワード</td></tr>' +
    '<tr><td>OB_MARKETER_ID</td><td>007d79ad320ca3facfae0f6c585b8a46f1</td></tr>' +
    '</table>' +
    '<p>コンバージョン名は以下で固定設定済み（変更不要）：</p>' +
    '<ul>' +
    '<li>⑦LP遷移数(W) → <b>1Day 01 LP walking</b></li>' +
    '<li>⑨LP遷移数(B) → <b>1Day 01LP basic</b></li>' +
    '<li>⑪カート追加 → <b>Add to cart\u3000NEW(4/7~)</b></li>' +
    '<li>⑬CV数 → <b>thanks 01day</b></li>' +
    '</ul>' +
    '<h4>② レポート実行</h4>' +
    '<ol>' +
    '<li>「ととのえる（OB）」シートのC2に開始日を入力（例: 2026/04/01）</li>' +
    '<li>C3に終了日を入力（例: 2026/04/04）</li>' +
    '<li>メニュー「ととのえるOBレポート ▶ レポート取得実行」をクリック</li>' +
    '</ol>' +
    '<button onclick="google.script.host.close()" style="margin-top:10px;padding:5px 15px;">閉じる</button>' +
    '</body></html>'
  ).setWidth(560).setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, 'ととのえるOutbrain設定ガイド');
}

// ================================================
// APIデバッグ
// ================================================
function debugApiBreakdownsTotonoeru() {
  var props      = PropertiesService.getScriptProperties();
  var username   = props.getProperty('OB_USERNAME');
  var password   = props.getProperty('OB_PASSWORD');
  var marketerId = MARKETER_ID_TOTONOERU;

  var token = getOutbrainTokenTotonoeru(username, password);
  if (!token) { SpreadsheetApp.getUi().alert('認証失敗'); return; }

  var from       = '2026-04-01';
  var to         = '2026-04-09';
  var baseParams = '?from=' + from + '&to=' + to + '&limit=3';

  var tests = [
    { label: 'includeConversionDetails', url: BASE_URL + '/reports/marketers/' + marketerId + '/campaigns/periodic' + baseParams + '&includeConversionDetails=true' },
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
      Logger.log('=== ' + t.label + ' 例外: ' + e.toString() + ' ===');
    }
    Utilities.sleep(500);
  });

  SpreadsheetApp.getUi().alert('デバッグ完了。Apps Script > ログ で結果を確認してください。');
}
