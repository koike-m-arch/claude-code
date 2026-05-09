// ============================================================
// ブリリオ・ホワイト CPA日次反映スクリプト
// スクリプトプロパティ: OB_USERNAME / OB_PASSWORD
// ============================================================

const OB_BASE = 'https://api.outbrain.com/amplify/v0.1/';
const BRILLIO_MARKETER_ID = '00af75b8e5565b04764d17c4f90cb25caf';
const WHITE_MARKETER_ID   = '0033e4d3d312b31c84630c2166acec7b27';
const BRILLIO_CV_NAME     = '03 all thanks 01d';
const WHITE_CV_NAME       = 'thanks 1day';

const TOKEN_CACHE_KEY    = 'OB_CPA_TOKEN';
const TOKEN_CACHE_TS_KEY = 'OB_CPA_TOKEN_TS';
const TOKEN_TTL_MS       = 4 * 60 * 60 * 1000;

// ---- スプレッドシートを開いたときにカスタムメニューを追加 ----
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CPA更新')
    .addItem('📊 シート日付で更新（A2〜A3）', 'updateCpaFromSheet')
    .addItem('📅 今日を更新', 'updateTodayCpa')
    .addSeparator()
    .addItem('⚙️ C2ボタンの初期設定（初回のみ）', 'setupOnEditTrigger')
    .addToUi();
}

// ---- C2チェックボックスのトリガー設定（初回のみ実行） ----
function setupOnEditTrigger() {
  // 既存のonEditHandlerトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'onEditHandler') {
      ScriptApp.deleteTrigger(t);
    }
  }
  // installableトリガーを新規作成
  ScriptApp.newTrigger('onEditHandler')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();

  // 日予算（ブリリオ）タブのC2にチェックボックスを設置
  const sheet = SpreadsheetApp.getActive().getSheetByName('日予算（ブリリオ）');
  if (sheet) {
    const cell = sheet.getRange('C2');
    cell.insertCheckboxes();
    cell.setNote('クリックするとA2〜A3の日付範囲でCPA更新を実行します');
    cell.setBackground('#e8f5e9');
  }

  SpreadsheetApp.getUi().alert(
    'C2にチェックボックスを設置しました。\n' +
    'チェックボックスをクリックするとCPA更新が実行されます。\n\n' +
    '（A2に開始日、A3に終了日を yyyy/MM/dd 形式で入力してください）'
  );
}

// ---- C2チェックボックスクリック時のハンドラー ----
function onEditHandler(e) {
  try {
    const range = e.range;
    const sheet = range.getSheet();
    if (sheet.getName() !== '日予算（ブリリオ）') return;
    if (range.getA1Notation() !== 'C2') return;
    if (e.value !== 'TRUE') return;

    // チェックをすぐ外す（トグルボタンのように動作）
    range.setValue(false);

    updateCpaFromSheet();
    SpreadsheetApp.getActive().toast('CPA更新が完了しました', '✅ 完了', 5);
  } catch (err) {
    SpreadsheetApp.getActive().toast('エラー: ' + err.message, '❌ エラー', 10);
    Logger.log('onEditHandler エラー: ' + err.message);
  }
}

// ---- Outbrain認証（トークンキャッシュ付き） ----
function getObToken_() {
  const props = PropertiesService.getScriptProperties();
  const cachedToken = props.getProperty(TOKEN_CACHE_KEY);
  const cachedTs    = parseInt(props.getProperty(TOKEN_CACHE_TS_KEY) || '0', 10);
  if (cachedToken && (Date.now() - cachedTs) < TOKEN_TTL_MS) {
    Logger.log('Outbrain認証: キャッシュ使用');
    return cachedToken;
  }
  const username = props.getProperty('OB_USERNAME');
  const password = props.getProperty('OB_PASSWORD');
  if (!username || !password) throw new Error('スクリプトプロパティに OB_USERNAME / OB_PASSWORD を設定してください');
  const creds = Utilities.base64Encode(username + ':' + password);
  const res = UrlFetchApp.fetch(OB_BASE + 'login', {
    method: 'get',
    headers: { 'Authorization': 'Basic ' + creds },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 429) {
    if (cachedToken) { Logger.log('レートリミット: キャッシュトークンで代替'); return cachedToken; }
    throw new Error('レートリミットに達しました。数分待って再実行してください');
  }
  if (res.getResponseCode() !== 200) throw new Error('Outbrain認証失敗: ' + res.getContentText());
  const headers = res.getHeaders();
  const token = headers['OB-TOKEN-V1'] || headers['ob-token-v1'] || JSON.parse(res.getContentText())['OB-TOKEN-V1'];
  if (!token) throw new Error('トークンの取得に失敗しました');
  props.setProperty(TOKEN_CACHE_KEY, token);
  props.setProperty(TOKEN_CACHE_TS_KEY, String(Date.now()));
  Logger.log('Outbrain認証: OK（新規取得）');
  return token;
}

// ---- Outbrain APIリクエスト ----
function obGet_(token, path, params) {
  let url = OB_BASE + path;
  if (params) {
    const qs = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    url += '?' + qs;
  }
  const res = UrlFetchApp.fetch(url, {
    headers: { 'OB-TOKEN-V1': token },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('OB API error ' + res.getResponseCode() + ': ' + path);
  return JSON.parse(res.getContentText());
}

// ---- 列番号 → アルファベット ----
function colToLetter_(n) {
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

// ---- 日付文字列 "yyyy/MM/dd" から列アルファベットを返す ----
function findDateCol_(sheet, dateStr) {
  const values = sheet.getRange('F1:AZ1').getValues()[0];
  for (let i = 0; i < values.length; i++) {
    const cell = values[i];
    if (!cell) continue;
    let cellStr;
    if (cell instanceof Date) {
      const y = cell.getFullYear();
      const m = String(cell.getMonth() + 1).padStart(2, '0');
      const d = String(cell.getDate()).padStart(2, '0');
      cellStr = `${y}/${m}/${d}`;
    } else {
      cellStr = String(cell).trim();
      const parts = cellStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      if (parts) cellStr = `${parts[1]}/${parts[2].padStart(2,'0')}/${parts[3].padStart(2,'0')}`;
    }
    if (cellStr === dateStr) return colToLetter_(6 + i);
  }
  return null;
}

// ---- OBデータ取得（CPN合算・CPN別CPA込み） ----
function fetchCpnData_(token, marketerId, dateStr, cvName) {
  const apiDate = dateStr.replace(/\//g, '-');
  const report = obGet_(token, `reports/marketers/${marketerId}/campaigns/periodic`, {
    from: apiDate, to: apiDate, breakdown: 'daily', includeConversionDetails: 'true'
  });
  const cpnIdToMetrics = {};
  if (report.campaignResults) {
    for (const cpn of report.campaignResults) {
      if (cpn.results && cpn.results.length > 0) {
        cpnIdToMetrics[cpn.campaignId] = cpn.results[0].metrics;
      }
    }
  }

  const campaigns = obGet_(token, `marketers/${marketerId}/campaigns`, { limit: 50 });
  const idToName = {};
  if (campaigns.campaigns) {
    for (const c of campaigns.campaigns) idToName[c.id] = c.name;
  }

  const cpnNumToMetrics = {};
  for (const [cid, metrics] of Object.entries(cpnIdToMetrics)) {
    const match = (idToName[cid] || '').match(/【(\d+)】/);
    if (match) cpnNumToMetrics[match[1]] = metrics;
  }

  let totalSpend = 0, totalConversions = 0;
  for (const metrics of Object.values(cpnIdToMetrics)) {
    totalSpend += parseFloat(metrics.spend || 0);
    for (const cm of (metrics.conversionMetrics || [])) {
      if (cm.name === cvName) { totalConversions += parseFloat(cm.conversions || 0); break; }
    }
  }

  function getCpnCpa(metrics) {
    for (const cm of (metrics.conversionMetrics || [])) {
      if (cm.name === cvName) return parseFloat(cm.cpa || 0);
    }
    return 0;
  }

  return { totalSpend, totalConversions, cpnNumToMetrics, getCpnCpa };
}

// ---- 円フォーマット ----
function fmtYen_(v) {
  return '¥' + Math.round(v).toLocaleString('ja-JP');
}

// ---- CPN別行に書き込む共通処理 ----
function writeCpnRows_(cpaSheet, col, cpnNumToMetrics, getCpnCpa, convertFn) {
  const cpnNames = cpaSheet.getRange('A5:A25').getValues();
  let updated = 0, skipped = 0;
  for (let i = 0; i < cpnNames.length; i++) {
    const cpnName = cpnNames[i][0];
    if (!cpnName) continue;
    const match = String(cpnName).match(/【(\d+)】/);
    if (!match) continue;
    const num = match[1];
    const rowNum = 5 + i;
    if (cpnNumToMetrics[num]) {
      const rawCpa = getCpnCpa(cpnNumToMetrics[num]);
      const cpa = convertFn ? convertFn(rawCpa) : rawCpa;
      cpaSheet.getRange(col + rowNum).setValue(cpa > 0 ? fmtYen_(cpa) : '-');
      updated++;
    } else {
      skipped++;
    }
  }
  Logger.log(`  CPN更新: ${updated}件 / スキップ(配信なし): ${skipped}件`);
}

// ---- ブリリオ更新 ----
function updateBrillioForDate_(token, dateStr) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const budgetSheet = ss.getSheetByName('日予算（ブリリオ）');
  const cpaSheet    = ss.getSheetByName('CPA（ブリリオ）');

  const col = findDateCol_(budgetSheet, dateStr);
  if (!col) throw new Error(`ブリリオ: ${dateStr} に対応する列が見つかりません`);
  Logger.log(`[ブリリオ] ${dateStr} → ${col}列`);

  const { totalSpend, totalConversions, cpnNumToMetrics, getCpnCpa } =
    fetchCpnData_(token, BRILLIO_MARKETER_ID, dateStr, BRILLIO_CV_NAME);

  const totalCpa = totalConversions > 0 ? Math.round(totalSpend / totalConversions) : 0;
  Logger.log(`  配信金額: ${Math.round(totalSpend)}, 全体CPA: ${totalCpa}`);

  if (totalSpend > 0) budgetSheet.getRange(col + '4').setValue(Math.round(totalSpend));
  if (totalCpa > 0)   cpaSheet.getRange(col + '3').setValue(fmtYen_(totalCpa));

  writeCpnRows_(cpaSheet, col, cpnNumToMetrics, getCpnCpa, null);
}

// ---- ホワイト更新（換算係数 /0.8*1.1 を適用） ----
function updateWhiteForDate_(token, dateStr) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const budgetSheet = ss.getSheetByName('日予算（ホワイト） ');
  const cpaSheet    = ss.getSheetByName('CPA（ホワイト） ');

  const col = findDateCol_(budgetSheet, dateStr);
  if (!col) throw new Error(`ホワイト: ${dateStr} に対応する列が見つかりません`);
  Logger.log(`[ホワイト] ${dateStr} → ${col}列`);

  const { totalSpend, totalConversions, cpnNumToMetrics, getCpnCpa } =
    fetchCpnData_(token, WHITE_MARKETER_ID, dateStr, WHITE_CV_NAME);

  const convert = (v) => v > 0 ? v / 0.8 * 1.1 : 0;
  const totalSpendDisplay = convert(totalSpend);
  const totalCpaRaw = totalConversions > 0 ? totalSpend / totalConversions : 0;
  const totalCpa = convert(totalCpaRaw);
  Logger.log(`  配信金額(換算): ${Math.round(totalSpendDisplay)}, 全体CPA(換算): ${Math.round(totalCpa)}`);

  if (totalSpendDisplay > 0) budgetSheet.getRange(col + '4').setValue(Math.round(totalSpendDisplay));
  if (totalCpa > 0)          cpaSheet.getRange(col + '3').setValue(fmtYen_(totalCpa));

  writeCpnRows_(cpaSheet, col, cpnNumToMetrics, getCpnCpa, (rawCpa) => convert(rawCpa));
}

// ============================================================
// 公開関数
// ============================================================

// 今日の日付でブリリオ・ホワイト両方を更新
function updateTodayCpa() {
  const dateStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  updateCpaForDate(dateStr);
}

// 日予算（ブリリオ）タブのA2(開始日)〜A3(終了日)の範囲で更新
function updateCpaFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('日予算（ブリリオ）');
  if (!sheet) throw new Error('日予算（ブリリオ）タブが見つかりません');

  const startRaw = sheet.getRange('A2').getValue();
  const endRaw   = sheet.getRange('A3').getValue();

  function toDateStr(v) {
    if (v instanceof Date) {
      return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM/dd');
    }
    const s = String(v).trim();
    const parts = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (parts) return `${parts[1]}/${parts[2].padStart(2,'0')}/${parts[3].padStart(2,'0')}`;
    return s;
  }

  const startStr = toDateStr(startRaw);
  const endStr   = endRaw ? toDateStr(endRaw) : startStr;
  Logger.log(`実行範囲: ${startStr} 〜 ${endStr}`);

  const startDate = new Date(startStr.replace(/\//g, '-'));
  const endDate   = new Date(endStr.replace(/\//g, '-'));

  const token = getObToken_();
  const cur = new Date(startDate);
  while (cur <= endDate) {
    const ds = Utilities.formatDate(cur, 'Asia/Tokyo', 'yyyy/MM/dd');
    Logger.log(`===== CPA反映: ${ds} =====`);
    updateBrillioForDate_(token, ds);
    updateWhiteForDate_(token, ds);
    cur.setDate(cur.getDate() + 1);
  }
  Logger.log('===== 完了 =====');
}

// 指定日付（例: "2026/05/05"）でブリリオ・ホワイト両方を更新
function updateCpaForDate(dateStr) {
  Logger.log(`===== CPA反映開始: ${dateStr} =====`);
  const token = getObToken_();
  Logger.log('Outbrain認証: OK');
  updateBrillioForDate_(token, dateStr);
  updateWhiteForDate_(token, dateStr);
  Logger.log('===== 完了 =====');
}
