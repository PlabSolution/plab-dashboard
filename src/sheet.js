// 시트가 없으면 헤더와 함께 새로 만들고, 있으면(fixHeaderRow가 false가 아닌 한) 컬럼이
// 모자라거나 헤더 행이 틀어졌을 때 보정해요. getSheet/getCompanySheet/getLogSheet이 전부
// 이 로직을 거의 똑같이 반복하고 있어서 하나로 모았어요.
function ensureSheetWithHeaders(name, headers, opts) {
  var fixHeaderRow = !opts || opts.fixHeaderRow !== false;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    return sheet;
  }
  if (!fixHeaderRow) return sheet;
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var isCorrect = headers.every(function (h, i) { return firstRow[i] === h; });
  if (!isCorrect) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function getSheet() {
  return ensureSheetWithHeaders(SHEET_NAME, HEADERS);
}

// 로그 시트는 원래부터 컬럼 부족분 채우기·헤더 재보정을 하지 않았어요(그대로 유지).
function getLogSheet() {
  return ensureSheetWithHeaders(LOG_SHEET_NAME, LOG_HEADERS, { fixHeaderRow: false });
}

// 로그 기록은 항상 best-effort예요 — 로그 시트에 문제가 생겨도(예: 잠깐 잠김) 실제 데이터
// 저장 자체는 절대 막으면 안 되기 때문에 호출부에서 실패를 신경 쓰지 않도록 여기서 다 삼켜요.
function appendLog(user, action, rowId, company, detail) {
  try {
    var sheet = getLogSheet();
    sheet.appendRow([
      new Date().toISOString(),
      (user && user.username) || '',
      (user && user.role) || '',
      action || '',
      rowId || '',
      company || '',
      detail || ''
    ]);
  } catch (err) {
    Logger.log('appendLog 실패: ' + err);
  }
}

function readLog(limit) {
  var sheet = getLogSheet();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var raw = values[i];
    if (!raw[0]) continue;
    rows.push({
      at: raw[0], username: raw[1], role: raw[2], action: raw[3],
      rowId: raw[4], company: raw[5], detail: raw[6]
    });
  }
  rows.reverse();
  return limit ? rows.slice(0, limit) : rows;
}

var FIELD_LABELS_KO = {
  date: '협약일자', folderNc: '폴더NC', region: '권역', company: '기업명',
  plan: '수행계획서', report: '결과보고서', complete: '완료', flag: '이슈', remark: '비고',
  round: '회차', contactEmail: '담당자 이메일', folderId: '폴더ID',
  upPlan: '업로드-수행계획서', upReport: '업로드-결과보고서',
  upPlanAt: '업로드-수행계획서 체크일', upReportAt: '업로드-결과보고서 체크일'
};

function fieldLabelKo(h) {
  if (FIELD_LABELS_KO[h]) return FIELD_LABELS_KO[h];
  var sMatch = /^session(\d+)$/.exec(h);
  if (sMatch) return sMatch[1] + '회차';
  var uAtMatch = /^upSession(\d+)At$/.exec(h);
  if (uAtMatch) return '업로드-' + uAtMatch[1] + '회차 체크일';
  var uMatch = /^upSession(\d+)$/.exec(h);
  if (uMatch) return '업로드-' + uMatch[1] + '회차';
  return h;
}

function displayValKo(v) {
  if (v === true) return '체크';
  if (v === false) return '(없음)';
  if (v === '' || v === undefined || v === null) return '(비어있음)';
  return String(v);
}

// 수정 전(existingArr)·후(newArr) 배열을 HEADERS 기준으로 비교해서 달라진 필드만
// "필드: 이전값→새값" 형태로 요약해요. id는 행을 특정하는 값이라 비교 대상에서 빼요.
function diffRowSummary(existingArr, newArr) {
  var parts = [];
  for (var i = 0; i < HEADERS.length; i++) {
    var h = HEADERS[i];
    if (h === 'id') continue;
    var oldV = existingArr ? existingArr[i] : '';
    var newV = newArr[i];
    var oldNorm = (oldV === undefined || oldV === null) ? '' : oldV;
    var newNorm = (newV === undefined || newV === null) ? '' : newV;
    if (String(oldNorm) === String(newNorm)) continue;
    parts.push(fieldLabelKo(h) + ': ' + displayValKo(oldNorm) + '→' + displayValKo(newNorm));
  }
  var summary = parts.join(', ');
  if (summary.length > 300) summary = summary.slice(0, 297) + '...';
  return summary;
}

function formatDateCell(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  if (typeof value === 'string' && value) {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  return '';
}

function readAll() {
  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  var sessionCount = getSessionCount();
  if (values.length < 2) return { rows: [], sessionCount: sessionCount };

  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var raw = values[i];
    if (!raw[0]) continue;

    var obj = {};
    for (var c = 0; c < HEADERS.length; c++) obj[HEADERS[c]] = raw[c];
    obj.date = formatDateCell(obj.date);

    var sessions = [];
    for (var n = 1; n <= sessionCount; n++) sessions.push(!!obj['session' + n]);

    for (var n2 = 1; n2 <= MAX_SESSIONS; n2++) {
      delete obj['session' + n2];
      if (n2 > sessionCount) {
        delete obj['upSession' + n2];
        delete obj['upSession' + n2 + 'At'];
      } else {
        obj['upSession' + n2 + 'At'] = formatDateCell(obj['upSession' + n2 + 'At']);
      }
    }

    obj.sessions = sessions;
    obj.plan = !!obj.plan;
    obj.report = !!obj.report;
    obj.complete = !!obj.complete;
    obj.round = obj.round || DEFAULT_ROUND;

    for (var n3 = 1; n3 <= sessionCount; n3++) obj['upSession' + n3] = !!obj['upSession' + n3];
    obj.upPlan = !!obj.upPlan;
    obj.upReport = !!obj.upReport;
    obj.upPlanAt = formatDateCell(obj.upPlanAt);
    obj.upReportAt = formatDateCell(obj.upReportAt);
    rows.push(obj);
  }

  return { rows: rows, sessionCount: sessionCount };
}

function rowToArray(row, existingArr, sessionCountOpt) {
  var sessionCount = sessionCountOpt || getSessionCount();
  return HEADERS.map(function (h, i) {
    var sMatch = /^session(\d+)$/.exec(h);
    if (sMatch) {
      var sn = Number(sMatch[1]);
      if (sn <= sessionCount) return row.sessions ? !!row.sessions[sn - 1] : false;
      return existingArr ? existingArr[i] : false;
    }

    var uMatch = /^upSession(\d+)$/.exec(h);
    if (uMatch) {
      var un = Number(uMatch[1]);
      if (un > sessionCount) return existingArr ? existingArr[i] : false;
      return row[h] !== undefined && row[h] !== null ? row[h] : (existingArr ? existingArr[i] : false);
    }

    if (row[h] !== undefined && row[h] !== null) return row[h];
    return existingArr ? existingArr[i] : '';
  });
}

// syncFromDrive()는 회차 전체 동기화 내내 스크립트 잠금을 붙잡고 있다가, 기업마다
// upsertRow()를 반복 호출해요. upsertRow()가 매번 또 자기 잠금을 새로 걸려고 하면, 이미
// 자기 자신이 쥐고 있는 잠금을 다시 기다리는 꼴이 돼서(그 사이 다른 저장 작업이라도 끼면)
// "Lock timeout" 예외가 나요. 그래서 실제 로직은 잠금 없는 upsertRowUnlocked로 빼두고,
// syncFromDrive처럼 "이미 바깥에서 잠금을 쥐고 있는 호출부"는 이걸 직접 쓰게 해요.
function upsertRowUnlocked(row, user) {
  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  var idCol = HEADERS.indexOf('id');
  var rowIndex = -1;
  for (var i = 1; i < values.length; i++) {
    if (values[i][idCol] === row.id) {
      rowIndex = i + 1;
      break;
    }
  }
  var existingArr = rowIndex !== -1 ? values[rowIndex - 1] : null;
  var arr = rowToArray(row, existingArr);
  if (rowIndex === -1) {
    sheet.appendRow(arr);
  } else {
    sheet.getRange(rowIndex, 1, 1, HEADERS.length).setValues([arr]);
  }
  var companyCol = HEADERS.indexOf('company');
  var company = arr[companyCol];
  var detail = existingArr ? diffRowSummary(existingArr, arr) : '신규 등록';
  if (existingArr && !detail) detail = '변경 없음';
  appendLog(user, 'upsert', row.id, company, detail);
}

function upsertRow(row, user) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    upsertRowUnlocked(row, user);
  } finally {
    lock.releaseLock();
  }
}

function deleteRow(id, user) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet();
    var values = sheet.getDataRange().getValues();
    var companyCol = HEADERS.indexOf('company');
    for (var i = 1; i < values.length; i++) {
      if (values[i][0] === id) {
        var company = values[i][companyCol];
        sheet.deleteRow(i + 1);
        appendLog(user, 'delete', id, company, '기업 삭제');
        break;
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function setUploadField(user, id, field, value) {
  var sessionCount = getSessionCount();
  var uploadFields = getUploadFieldNames(sessionCount);
  var uploadToSource = getUploadToSourceMap(sessionCount);
  if (!id || uploadFields.indexOf(field) === -1) {
    return { ok: false, error: 'invalid field' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet();
    var values = sheet.getDataRange().getValues();
    var idCol = HEADERS.indexOf('id');
    var regionCol = HEADERS.indexOf('region');
    var fieldCol = HEADERS.indexOf(field);
    var atCol = HEADERS.indexOf(field + 'At');
    var sourceField = uploadToSource[field];
    var sourceCol = sourceField ? HEADERS.indexOf(sourceField) : -1;
    var companyCol = HEADERS.indexOf('company');

    for (var i = 1; i < values.length; i++) {
      if (values[i][idCol] === id) {
        var rowRegion = values[i][regionCol] || '미지정';
        if (user.region && user.region !== 'all' && rowRegion !== user.region) {
          return { ok: false, error: 'forbidden', message: '담당 권역 데이터만 체크할 수 있어요.' };
        }
        if (value && sourceCol !== -1 && !values[i][sourceCol]) {
          return { ok: false, error: 'not-available', message: '취합현황에 아직 자료가 없어서 체크할 수 없어요.' };
        }
        sheet.getRange(i + 1, fieldCol + 1).setValue(!!value);
        // 체크하면 오늘 날짜를 같이 남기고, 체크 해제하면 날짜도 같이 지워요 — 날짜가
        // 항상 "마지막으로 체크된 시점"만 나타내게.
        if (atCol !== -1) {
          sheet.getRange(i + 1, atCol + 1).setValue(value ? Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd') : '');
        }
        appendLog(user, 'setUpload', id, values[i][companyCol], fieldLabelKo(field) + (value ? ' 체크' : ' 체크 해제'));
        return { ok: true };
      }
    }
    return { ok: false, error: 'not found' };
  } finally {
    lock.releaseLock();
  }
}
