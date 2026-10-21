// ── rows 시트 일괄 쓰기 ─────────────────────────────────────────────────
// 예전 동기화는 기업 하나를 처리할 때마다 "시트 전체 읽기 → 한 줄 쓰기 → 로그 한 줄 쓰기"를
// 반복해서, 기업이 수백 곳이면 시트 호출만 천 번이 넘었어요(6분 제한에 걸리던 주원인).
// 이제는 시트를 한 번만 읽어 메모리에서 고치고, 실제로 값이 바뀐 줄만 마지막에 한꺼번에 써요.
// 바뀐 게 없는 기업은 쓰지도, 로그를 남기지도 않아요.

function openRowBatch_() {
  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  var width = HEADERS.length;
  // 시트 열이 HEADERS보다 많거나 적어도 쓰기 범위가 어긋나지 않게 폭을 맞춰둬요.
  for (var i = 0; i < values.length; i++) {
    if (values[i].length > width) values[i] = values[i].slice(0, width);
    while (values[i].length < width) values[i].push('');
  }
  return {
    sheet: sheet,
    values: values,
    origLength: values.length,
    sessionCount: getSessionCount(),
    dirty: {},
    logs: [],
    keyIndex: null
  };
}

function batchKey_(company, round) {
  return String(company || '').trim() + '\u0001' + (round || DEFAULT_ROUND);
}

// "기업명 + 회차"로 행 위치를 찾아요(동기화가 기존 행을 찾는 기준과 동일).
function batchFindRow_(b, company, round) {
  if (!b.keyIndex) {
    b.keyIndex = {};
    var companyCol = HEADERS.indexOf('company');
    var roundCol = HEADERS.indexOf('round');
    for (var i = 1; i < b.values.length; i++) {
      var k = batchKey_(b.values[i][companyCol], b.values[i][roundCol]);
      if (!(k in b.keyIndex)) b.keyIndex[k] = i;
    }
  }
  var key = batchKey_(company, round);
  return key in b.keyIndex ? b.keyIndex[key] : -1;
}

function batchRowObject_(b, idx) {
  var arr = b.values[idx];
  var obj = {};
  for (var c = 0; c < HEADERS.length; c++) obj[HEADERS[c]] = arr[c];
  return obj;
}

// 행 하나를 메모리에서 반영해요. 반환값: 'created' | 'updated' | 'same'
function batchUpsert_(b, row, user) {
  var idCol = HEADERS.indexOf('id');
  var companyCol = HEADERS.indexOf('company');
  var idx = -1;
  for (var i = 1; i < b.values.length; i++) {
    if (b.values[i][idCol] === row.id) { idx = i; break; }
  }
  if (idx === -1) {
    var arrNew = rowToArray(row, null, b.sessionCount);
    b.values.push(arrNew);
    if (b.keyIndex) b.keyIndex[batchKey_(row.company, row.round)] = b.values.length - 1;
    b.logs.push(logRow_(user, 'upsert', row.id, arrNew[companyCol], '신규 등록'));
    return 'created';
  }
  var existingArr = b.values[idx];
  var arr = rowToArray(row, existingArr, b.sessionCount);
  var detail = diffRowSummary(existingArr, arr);
  if (!detail) return 'same';
  b.values[idx] = arr;
  if (idx < b.origLength) b.dirty[idx] = true;
  b.logs.push(logRow_(user, 'upsert', row.id, arr[companyCol], detail));
  return 'updated';
}

function logRow_(user, action, rowId, company, detail) {
  return [
    new Date().toISOString(),
    (user && user.username) || '',
    (user && user.role) || '',
    action || '',
    rowId || '',
    company || '',
    detail || ''
  ];
}

// 모아둔 변경을 시트에 써요. 바뀐 줄이 띄엄띄엄 많으면 블록 하나로 통째로 쓰는 게 더 빨라요.
// 반환값: 실제로 쓴 줄 수
function flushRowBatch_(b) {
  var width = HEADERS.length;
  var dirtyIdx = Object.keys(b.dirty).map(Number).sort(function (x, y) { return x - y; });
  var written = 0;
  if (dirtyIdx.length) {
    var groups = [];
    dirtyIdx.forEach(function (i) {
      var g = groups[groups.length - 1];
      if (g && g.end === i - 1) g.end = i; else groups.push({ start: i, end: i });
    });
    if (groups.length > 20) {
      var first = dirtyIdx[0], last = dirtyIdx[dirtyIdx.length - 1];
      b.sheet.getRange(first + 1, 1, last - first + 1, width).setValues(b.values.slice(first, last + 1));
    } else {
      groups.forEach(function (g) {
        b.sheet.getRange(g.start + 1, 1, g.end - g.start + 1, width).setValues(b.values.slice(g.start, g.end + 1));
      });
    }
    written += dirtyIdx.length;
  }
  var added = b.values.slice(b.origLength);
  if (added.length) {
    b.sheet.getRange(b.origLength + 1, 1, added.length, width).setValues(added);
    written += added.length;
  }
  if (b.logs.length) {
    try {
      var logSheet = getLogSheet();
      logSheet.getRange(logSheet.getLastRow() + 1, 1, b.logs.length, b.logs[0].length).setValues(b.logs);
    } catch (err) {
      Logger.log('로그 일괄 기록 실패: ' + err);
    }
  }
  // 다음 flush를 위해 기준점을 지금 상태로 옮겨요.
  b.dirty = {};
  b.logs = [];
  b.origLength = b.values.length;
  return written;
}
