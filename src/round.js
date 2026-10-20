// ── 회차(프로그램) 마스터 관리 ────────────────────────────────────────────
// rows 시트의 round 필드는 지금까지 그냥 문자열이라, 회차 자체의 일정·상태·설명을 저장할
// 곳이 없었다. 이 파일은 회차 마스터를 다루는 별도 "rounds" 시트를 관리한다. company.js와
// 완전히 같은 구조(락, 이름 기준 중복 경고, appendLog)를 따른다.

function getRoundSheet() {
  return ensureSheetWithHeaders(ROUND_SHEET_NAME, ROUND_HEADERS);
}

function normalizeRoundName(name) {
  return String(name || '').trim();
}

function readRounds() {
  var sheet = getRoundSheet();
  var values = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < values.length; i++) {
    var raw = values[i];
    if (!raw[0]) continue;
    var obj = {};
    for (var c = 0; c < ROUND_HEADERS.length; c++) obj[ROUND_HEADERS[c]] = raw[c];
    list.push(obj);
  }
  return list;
}

function findRoundByName(name) {
  var target = normalizeRoundName(name).toLowerCase();
  if (!target) return null;
  var list = readRounds();
  for (var i = 0; i < list.length; i++) {
    if (normalizeRoundName(list[i].name).toLowerCase() === target) return list[i];
  }
  return null;
}

function roundToArray(round, existingArr) {
  var now = new Date().toISOString();
  return ROUND_HEADERS.map(function (h, i) {
    if (h === 'updatedAt') return now;
    if (h === 'createdAt') return existingArr ? existingArr[i] : now;
    if (h === 'id') return existingArr ? existingArr[i] : Utilities.getUuid();
    if (round[h] !== undefined && round[h] !== null) return round[h];
    return existingArr ? existingArr[i] : '';
  });
}

function upsertRound(round, user) {
  var name = normalizeRoundName(round && round.name);
  if (!name) return { ok: false, error: 'invalid', message: '회차 이름을 입력해주세요.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getRoundSheet();
    var values = sheet.getDataRange().getValues();
    var idCol = ROUND_HEADERS.indexOf('id');
    var nameCol = ROUND_HEADERS.indexOf('name');
    var rowIndex = -1;
    if (round.id) {
      for (var i = 1; i < values.length; i++) {
        if (values[i][idCol] === round.id) { rowIndex = i + 1; break; }
      }
    }

    var duplicate = null;
    for (var j = 1; j < values.length; j++) {
      if (values[j][idCol] !== round.id && normalizeRoundName(values[j][nameCol]).toLowerCase() === name.toLowerCase()) {
        duplicate = values[j][nameCol];
        break;
      }
    }

    var existingArr = rowIndex !== -1 ? values[rowIndex - 1] : null;
    var arr = roundToArray(Object.assign({}, round, { name: name }), existingArr);
    if (rowIndex === -1) {
      sheet.appendRow(arr);
    } else {
      sheet.getRange(rowIndex, 1, 1, ROUND_HEADERS.length).setValues([arr]);
    }

    if (user) {
      appendLog(user, 'upsertRound', '', name, existingArr ? '회차 정보 수정' : '회차 신규 등록');
    }

    var result = { ok: true, rounds: readRounds() };
    if (duplicate) result.warning = '이미 같은 이름의 회차가 있어요 — 오탈자가 아닌지 확인해주세요.';
    return result;
  } finally {
    lock.releaseLock();
  }
}

function deleteRound(id, user) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getRoundSheet();
    var values = sheet.getDataRange().getValues();
    var idCol = ROUND_HEADERS.indexOf('id');
    var nameCol = ROUND_HEADERS.indexOf('name');
    for (var i = 1; i < values.length; i++) {
      if (values[i][idCol] === id) {
        var name = values[i][nameCol];
        sheet.deleteRow(i + 1);
        if (user) appendLog(user, 'deleteRound', '', name, '회차 삭제(회차별 참여 기록은 유지됨)');
        return { ok: true, rounds: readRounds() };
      }
    }
    return { ok: false, error: 'not-found', message: '회차를 찾을 수 없어요.' };
  } finally {
    lock.releaseLock();
  }
}
