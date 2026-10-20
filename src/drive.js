// 회차 마스터(rounds 시트)에 아직 '1회차' 레코드가 없고 기존 DRIVE_FOLDER_ID 상수가
// 설정돼있으면, 그 값으로 '1회차' 레코드를 한 번만 자동으로 만들어줘요. 프로그램 탭으로
// 드라이브 폴더 설정을 옮기면서도, 이미 잘 되고 있던 1회차 동기화가 끊기지 않게 하는
// 안전한 이전 경로예요. 이미 '1회차' 레코드가 있으면 아무것도 안 해요.
// 회차 관리 화면에 드라이브 폴더 ID 대신 전체 URL을 붙여넣거나(예: ".../folders/xxxx?hl=ko"),
// 앞뒤에 공백이 섞여 들어오는 실수를 방어해요. 공백이 남아있으면 문자열 비교(exclude 목록
// 매칭)가 조용히 실패해서 다른 회차 폴더를 걸러내지 못하는 원인이 될 수 있어서, 쓰는
// 곳마다 다시 안 짜도 되게 여기 한 곳에서 정리해요.
function normalizeDriveFolderId(v) {
  v = String(v || '').trim();
  var m = v.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return v;
}

// range: { from, to } 형태의 폴더NC(번호) 범위로 걸러낼 때 써요. 기업 수가 많은 회차를
// 한 번에 다 처리하면 오래 걸리니까, 필요하면 일부 번호대만 나눠서 처리할 수 있게 해요.
// range가 없으면(null/undefined) 전부 통과.
function inFolderNcRange(folderNc, range) {
  if (!range || typeof range.from !== 'number' || typeof range.to !== 'number') return true;
  var n = parseInt(folderNc, 10);
  if (isNaN(n)) return true;
  return n >= range.from && n <= range.to;
}

function ensureRoundHasDefaultFolder() {
  if (findRoundByName(CURRENT_SYNC_ROUND)) return;
  if (!DRIVE_FOLDER_ID) return;
  upsertRound({ name: CURRENT_SYNC_ROUND, driveFolderId: DRIVE_FOLDER_ID, status: 'ongoing' }, null);
}

// onlyRoundName: 지정하면(그리고 'all'이 아니면) 그 회차 폴더 하나만 동기화해요. 사이드바에서
// 특정 Step을 보고 있는 상태로 "드라이브에서 불러오기"를 누르면, 다른 회차(특히 기업 수가
// 훨씬 많은 회차)까지 매번 같이 훑을 이유가 없어서 — 지금 보고 있는 회차만 빠르게 동기화할
// 수 있게 해요. 안 넘기거나 'all'이면 예전처럼 등록된 회차 전부를 동기화해요.
function syncFromDrive(onlyRoundName, range) {
  ensureRoundHasDefaultFolder();
  var allRounds = readRounds()
    .map(function (r) { return Object.assign({}, r, { driveFolderId: normalizeDriveFolderId(r.driveFolderId) }); })
    .filter(function (r) { return r.driveFolderId; });
  if (!allRounds.length) {
    return { error: '동기화할 회차가 없어요. 프로그램 탭에서 회차를 만들고 드라이브 폴더 ID를 입력해주세요.' };
  }

  var rounds = allRounds;
  if (onlyRoundName && onlyRoundName !== 'all') {
    rounds = allRounds.filter(function (r) { return r.name === onlyRoundName; });
    if (!rounds.length) {
      return { error: '"' + onlyRoundName + '" 회차에 드라이브 폴더 ID가 등록돼있지 않아요. 프로그램 탭에서 먼저 등록해주세요.' };
    }
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sessionCount = getSessionCount();
    var keywordMap = getKeywordMapForCount(sessionCount);
    var sessionNums = [];
    for (var sn = 1; sn <= sessionCount; sn++) sessionNums.push(sn);

    var startTime = Date.now();
    var TIME_BUDGET_MS = 4.5 * 60 * 1000;
    var totals = { foldersScanned: 0, matched: 0, created: 0, skipped: 0 };
    var debugParts = [];

    for (var ri = 0; ri < rounds.length; ri++) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        debugParts.push('시간이 오래 걸려서 일부 회차는 처리하지 못했어요. "드라이브에서 불러오기"를 다시 누르면 이어서 처리돼요.');
        break;
      }
      // 다른 회차 전용 폴더가 지금 회차 폴더 밑에 우연히 중첩돼 있어도(예: 공용 상위
      // 폴더 밑에 회차별 폴더가 형제로 있는 게 아니라 실수로 안쪽에 들어간 경우) 그 안까지
      // 잘못 훑지 않도록, (동기화 대상이 아니더라도) 등록된 다른 모든 회차의 driveFolderId는
      // 재귀 탐색에서 건너뛰어요.
      var otherRoundFolderIds = allRounds.filter(function (r) { return r.driveFolderId !== rounds[ri].driveFolderId; })
        .map(function (r) { return r.driveFolderId; });
      var result = syncRoundFolder(rounds[ri], sessionCount, keywordMap, sessionNums, startTime, TIME_BUDGET_MS, otherRoundFolderIds, range);
      totals.foldersScanned += result.foldersScanned;
      totals.matched += result.matched;
      totals.created += result.created;
      totals.skipped += result.skipped;
      if (result.debug) debugParts.push('[' + rounds[ri].name + '] ' + result.debug);
    }

    if (debugParts.length) totals.debug = debugParts.join(' / ');
    return totals;
  } finally {
    lock.releaseLock();
  }
}

// 회차 하나의 드라이브 루트 폴더를 스캔해서 rows 시트에 반영해요. 기존 행을 찾을 때
// "기업명 + 회차"로 매칭해서, 같은 기업이 다른 회차에도 있어도 서로 안 섞이고 독립된
// 행으로 남아요.
function syncRoundFolder(round, sessionCount, keywordMap, sessionNums, startTime, TIME_BUDGET_MS, excludeFolderIds, range) {
  var folderId = round.driveFolderId;
  var roundName = round.name;
  var excludeList = excludeFolderIds || [];
  // 진단용 접두어 — folderId·exclude 목록·실제로 제외된 폴더가 몇 개였는지를 항상 결과에
  // 남겨서, "다른 회차 폴더가 왜 안 걸러지는지" 같은 문제를 화면에서 바로 확인할 수 있게 해요.
  function diagPrefix(companyFolders) {
    var excludedNames = (companyFolders && companyFolders.excludedNames) || [];
    return 'folderId=' + folderId + ', exclude=[' + excludeList.join(', ') + '], 실제 제외된 폴더=[' + excludedNames.join(', ') + ']';
  }

  var companyFolders;
  try {
    companyFolders = collectCompanyFolders(folderId, excludeFolderIds);
  } catch (err) {
    return { foldersScanned: 0, matched: 0, created: 0, skipped: 0, debug: '드라이브 폴더에 접근할 수 없어요: ' + err.message + ' — ID가 정확한지, Drive API 서비스를 추가했는지 확인해주세요. (' + diagPrefix() + ')' };
  }

  if (companyFolders.length === 0) {
    var rootChildren = [];
    try { rootChildren = listDriveChildren(folderId); } catch (e) {}
    var debugMsg;
    if (rootChildren.length === 0) {
      debugMsg = '지정한 위치(' + folderId + ') 바로 아래에 항목이 하나도 없어요. ID가 맞는지, 스크립트를 실행하는 계정이 그 위치에 접근 권한이 있는지 확인해주세요.';
    } else {
      debugMsg = '멘티기업 폴더("번호_권역_기업명" 형태)를 찾지 못했어요. 바로 아래 항목 ' + rootChildren.length + '개: ' +
        rootChildren.slice(0, 20).map(function (f) { return f.name + ' [' + f.mimeType + ']'; }).join(', ');
    }
    return { foldersScanned: 0, matched: 0, created: 0, skipped: 0, debug: debugMsg + ' (' + diagPrefix(companyFolders) + ')' };
  }

  // 폴더NC 범위가 지정됐으면 그 번호대의 기업만 골라내요(기업 수가 많은 회차를 나눠서
  // 처리할 때 씀) — 걸러낸 뒤에도 diagPrefix가 쓰는 excludedNames는 그대로 들고가요.
  if (range) {
    var filteredFolders = companyFolders.filter(function (f) { return inFolderNcRange(f.folderNc, range); });
    filteredFolders.excludedNames = companyFolders.excludedNames;
    companyFolders = filteredFolders;
  }

  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  var companyCol = HEADERS.indexOf('company');
  var roundCol = HEADERS.indexOf('round');
  var sessionCols = sessionNums.map(function (n) { return HEADERS.indexOf('session' + n); });
  var planCol = HEADERS.indexOf('plan');
  var reportCol = HEADERS.indexOf('report');
  var folderIdCol = HEADERS.indexOf('folderId');

  var foldersScanned = 0, matched = 0, created = 0, skipped = 0;

  // 1차: 시트만 보고 바로 판단 가능한 것(건너뛰기·폴더ID만 갱신)은 API 호출 없이 처리하고,
  // "실제로 파일 목록을 확인해야 하는" 기업만 pending에 모아둬요.
  var pending = [];
  for (var idx = 0; idx < companyFolders.length; idx++) {
    var info = companyFolders[idx];
    foldersScanned++;

    var rowIndex = -1;
    for (var i = 1; i < values.length; i++) {
      var rowRound = values[i][roundCol] || DEFAULT_ROUND;
      if (String(values[i][companyCol]).trim() === info.company && rowRound === roundName) {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex !== -1) {
      var alreadyDone = sessionCols.every(function (c) { return !!values[rowIndex][c]; }) &&
        !!values[rowIndex][planCol] && !!values[rowIndex][reportCol];
      var hasFolderId = !!values[rowIndex][folderIdCol];
      if (alreadyDone && hasFolderId) {
        skipped++;
        continue;
      }
      if (alreadyDone && !hasFolderId) {
        sheet.getRange(rowIndex + 1, folderIdCol + 1).setValue(info.id || '');
        values[rowIndex][folderIdCol] = info.id || '';
        matched++;
        continue;
      }
    }
    pending.push({ info: info, rowIndex: rowIndex });
  }

  // 2차: 파일 목록 확인이 필요한 기업들만, 하나씩 순서대로 묻지 않고 한꺼번에(병렬) 물어봐요.
  // 예전엔 기업 수만큼 드라이브 API를 순서대로 호출해서 그 왕복 시간이 그대로 쌓였는데,
  // UrlFetchApp.fetchAll로 한 번에 보내면 네트워크 대기 시간이 거의 다 겹쳐져서 훨씬 빨라져요.
  var fileListsById = batchListDriveFiles(pending.map(function (p) { return p.info.id; }));

  for (var pi = 0; pi < pending.length; pi++) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      return {
        foldersScanned: foldersScanned, matched: matched, created: created, skipped: skipped,
        debug: '시간이 오래 걸려서 일부만 처리했어요 (전체 ' + companyFolders.length + '개 중 ' + (companyFolders.length - pending.length + pi) + '개 확인). 이미 다 채워진 기업은 다음 실행 때 건너뛰니, "드라이브에서 불러오기"를 몇 번 더 누르면 나머지가 이어서 처리돼요.'
      };
    }

    var info = pending[pi].info;
    var rowIndex = pending[pi].rowIndex;
    var fileNames = fileListsById[info.id] || [];
    var flags = {};
    keywordMap.forEach(function (k) {
      flags[k.field] = fileNames.some(function (name) {
        return k.keywords.some(function (kw) { return name.indexOf(kw) !== -1; });
      });
    });

    if (rowIndex === -1) {
      var newSessions = sessionNums.map(function (n) { return !!flags['session' + n]; });
      var newPlan = !!flags.plan, newReport = !!flags.report;
      var newRow = {
        id: Utilities.getUuid(),
        date: '',
        folderNc: info.folderNc || '',
        region: info.region || '',
        company: info.company,
        sessions: newSessions,
        plan: newPlan,
        report: newReport,
        complete: newSessions.every(function (v) { return v; }) && newPlan && newReport,
        flag: 'none',
        remark: '',
        round: roundName,
        folderId: info.id || ''
      };
      // syncFromDrive()가 이미 전체 동기화 동안 잠금을 쥐고 있어서(Lock timeout 방지),
      // 여기서는 잠금을 또 걸지 않는 버전을 써요.
      upsertRowUnlocked(newRow);
      created++;
    } else {
      var existingArr = values[rowIndex];
      var existing = {};
      for (var c = 0; c < HEADERS.length; c++) existing[HEADERS[c]] = existingArr[c];
      var sessionsArr = sessionNums.map(function (n) { return !!existing['session' + n]; });
      sessionNums.forEach(function (n) {
        if (flags['session' + n]) sessionsArr[n - 1] = true;
      });
      var mergedPlan = existing.plan || !!flags.plan;
      var mergedReport = existing.report || !!flags.report;
      var updatedRow = {
        id: existing.id,
        date: existing.date,
        folderNc: existing.folderNc || info.folderNc || '',
        region: existing.region || info.region || '',
        company: existing.company,
        sessions: sessionsArr,
        plan: mergedPlan,
        report: mergedReport,
        complete: sessionsArr.every(function (v) { return v; }) && mergedPlan && mergedReport,
        flag: existing.flag,
        remark: existing.remark,
        round: roundName,
        folderId: info.id || existing.folderId || ''
      };
      upsertRowUnlocked(updatedRow);
      matched++;
    }
  }

  var companyList = companyFolders.length <= 8
    ? companyFolders.map(function (f) { return f.company; }).join(', ')
    : companyFolders.slice(0, 8).map(function (f) { return f.company; }).join(', ') + ' 외 ' + (companyFolders.length - 8) + '개';
  var debugMsg = diagPrefix(companyFolders) + ', 찾은 기업 ' + companyFolders.length + '개(' + companyList + ')';
  if (fileListsById.__error) debugMsg = '⚠ ' + fileListsById.__error + ' | ' + debugMsg;
  return {
    foldersScanned: foldersScanned, matched: matched, created: created, skipped: skipped,
    debug: debugMsg
  };
}

// "드라이브에서 불러오기"(syncFromDrive)와 달리, 새 기업을 찾으려고 폴더 트리를 다시
// 훑지 않아요 — 이미 시트에 있는 행마다 저장된 folderId로 바로 그 폴더의 파일만 다시
// 확인해서 체크박스를 갱신해요. 평소에 "새로 올라온 파일 체크"만 하고 싶을 때 이 쪽이
// 훨씬 빠르고, 새 기업이 추가됐을 때만 "드라이브에서 불러오기"를 쓰면 돼요.
function refreshChecklistFromDrive(onlyRoundName, range) {
  var allRounds = readRounds()
    .map(function (r) { return Object.assign({}, r, { driveFolderId: normalizeDriveFolderId(r.driveFolderId) }); })
    .filter(function (r) { return r.driveFolderId; });
  if (!allRounds.length) {
    return { error: '업데이트할 회차가 없어요. 프로그램 탭에서 회차를 만들고 드라이브 폴더 ID를 입력해주세요.' };
  }

  var rounds = allRounds;
  if (onlyRoundName && onlyRoundName !== 'all') {
    rounds = allRounds.filter(function (r) { return r.name === onlyRoundName; });
    if (!rounds.length) {
      return { error: '"' + onlyRoundName + '" 회차에 드라이브 폴더 ID가 등록돼있지 않아요.' };
    }
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sessionCount = getSessionCount();
    var keywordMap = getKeywordMapForCount(sessionCount);
    var sessionNums = [];
    for (var sn = 1; sn <= sessionCount; sn++) sessionNums.push(sn);

    var startTime = Date.now();
    var TIME_BUDGET_MS = 4.5 * 60 * 1000;
    var totals = { checked: 0, updated: 0, skipped: 0 };
    var debugParts = [];

    for (var ri = 0; ri < rounds.length; ri++) {
      var result = refreshRoundChecklist(rounds[ri].name, sessionNums, keywordMap, startTime, TIME_BUDGET_MS, range);
      totals.checked += result.checked;
      totals.updated += result.updated;
      totals.skipped += result.skipped;
      if (result.debug) debugParts.push('[' + rounds[ri].name + '] ' + result.debug);
    }

    if (debugParts.length) totals.debug = debugParts.join(' / ');
    return totals;
  } finally {
    lock.releaseLock();
  }
}

function refreshRoundChecklist(roundName, sessionNums, keywordMap, startTime, TIME_BUDGET_MS, range) {
  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  var companyCol = HEADERS.indexOf('company');
  var roundCol = HEADERS.indexOf('round');
  var folderNcCol = HEADERS.indexOf('folderNc');
  var sessionCols = sessionNums.map(function (n) { return HEADERS.indexOf('session' + n); });
  var planCol = HEADERS.indexOf('plan');
  var reportCol = HEADERS.indexOf('report');
  var folderIdCol = HEADERS.indexOf('folderId');

  // 이 회차 소속이고, 드라이브 폴더가 이미 연결돼있고(folderId 있음), 아직 다 안 끝난 행만
  // 골라요 — 새 기업 탐색이 아니라 아는 기업의 파일만 다시 보는 거라 이걸로 충분해요.
  // 폴더NC 범위가 지정됐으면 그 번호대만 골라서, 기업 수가 많은 회차를 나눠서 처리할 수
  // 있게 해요.
  var candidates = [];
  var skipped = 0;
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[companyCol]) continue;
    var rowRound = row[roundCol] || DEFAULT_ROUND;
    if (rowRound !== roundName) continue;
    if (!inFolderNcRange(row[folderNcCol], range)) continue;
    var folderId = row[folderIdCol];
    if (!folderId) continue;
    var alreadyDone = sessionCols.every(function (c) { return !!row[c]; }) && !!row[planCol] && !!row[reportCol];
    if (alreadyDone) { skipped++; continue; }
    candidates.push({ rowIndex: i, folderId: folderId });
  }

  var fileListsById = batchListDriveFiles(candidates.map(function (c) { return c.folderId; }));
  var updated = 0;

  for (var ci = 0; ci < candidates.length; ci++) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      return {
        checked: candidates.length, updated: updated, skipped: skipped,
        debug: '시간이 오래 걸려서 일부만 처리했어요 (전체 ' + candidates.length + '개 중 ' + ci + '개 확인). "취합현황 업데이트"를 다시 누르면 이어서 처리돼요.'
      };
    }
    var c = candidates[ci];
    var row = values[c.rowIndex];
    var existing = {};
    for (var h = 0; h < HEADERS.length; h++) existing[HEADERS[h]] = row[h];

    var fileNames = fileListsById[c.folderId] || [];
    var flags = {};
    keywordMap.forEach(function (k) {
      flags[k.field] = fileNames.some(function (name) {
        return k.keywords.some(function (kw) { return name.indexOf(kw) !== -1; });
      });
    });

    var sessionsArr = sessionNums.map(function (n) { return !!existing['session' + n]; });
    sessionNums.forEach(function (n) { if (flags['session' + n]) sessionsArr[n - 1] = true; });
    var mergedPlan = existing.plan || !!flags.plan;
    var mergedReport = existing.report || !!flags.report;
    var updatedRow = {
      id: existing.id,
      date: existing.date,
      folderNc: existing.folderNc,
      region: existing.region,
      company: existing.company,
      sessions: sessionsArr,
      plan: mergedPlan,
      report: mergedReport,
      complete: sessionsArr.every(function (v) { return v; }) && mergedPlan && mergedReport,
      flag: existing.flag,
      remark: existing.remark,
      round: existing.round,
      folderId: existing.folderId
    };
    upsertRowUnlocked(updatedRow);
    updated++;
  }

  var debugMsg = '확인 ' + candidates.length + '개 · 갱신 ' + updated + '개 · 이미 완료 ' + skipped + '개 건너뜀';
  if (fileListsById.__error) debugMsg = '⚠ ' + fileListsById.__error + ' | ' + debugMsg;
  return { checked: candidates.length, updated: updated, skipped: skipped, debug: debugMsg };
}

function listDriveChildren(parentId, foldersOnly) {
  var mimeClause = '';
  if (foldersOnly === true) mimeClause = " and mimeType = '" + FOLDER_MIME + "'";
  else if (foldersOnly === false) mimeClause = " and mimeType != '" + FOLDER_MIME + "'";

  var query = "'" + parentId + "' in parents and trashed = false" + mimeClause;
  var results = [];
  var pageToken = null;
  do {
    // corpora: 'allDrives'는 특정 부모 폴더로 좁혀 묻는 이 쿼리엔 필요 없고 훨씬 느리기만
    // 해서 뺐어요(batchListDriveFiles와 동일한 이유).
    var response = Drive.Files.list({
      q: query,
      fields: 'nextPageToken, files(id, name, mimeType)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 1000,
      pageToken: pageToken || undefined
    });
    results = results.concat(response.files || []);
    pageToken = response.nextPageToken;
  } while (pageToken);
  return results;
}

// 여러 폴더의 "파일 목록"을 한 번에 병렬로 조회해요(폴더 자체를 찾는 재귀 탐색과는 별개 —
// 그건 폴더 개수가 적어서 순차 호출로도 충분히 빨라요). Drive 고급 서비스는 폴더 하나당
// 호출을 순서대로 기다려야 해서, 확인해야 할 기업이 많을수록 왕복 시간이 그대로 쌓여요.
// UrlFetchApp.fetchAll은 여러 요청을 한 번에 보내서 네트워크 대기 시간을 거의 다 겹치게
// 만들어주기 때문에, 같은 작업이라도 훨씬 빨리 끝나요.
// 병렬 조회가 실패하면(주로 권한 재승인이 안 된 경우) 예전엔 조용히 빈 목록으로 넘어가서,
// "파일이 없어서 체크가 안 됐다"와 "조회 자체가 실패해서 체크를 못 했다"를 겉보기로 구분할
// 수 없었어요. 그래서 실패하면 byId.__error에 이유를 남겨서, 호출부가 동기화 결과 메시지에
// 그대로 보여줄 수 있게 해요.
function batchListDriveFiles(folderIds) {
  var byId = {};
  if (!folderIds.length) return byId;
  var token = ScriptApp.getOAuthToken();
  var BATCH_SIZE = 80; // 한 번에 너무 많이 보내면 오히려 불안정해질 수 있어서 적당히 나눠 보내요.
  var errorNote = null;
  for (var start = 0; start < folderIds.length; start += BATCH_SIZE) {
    var chunk = folderIds.slice(start, start + BATCH_SIZE);
    var requests = chunk.map(function (id) {
      var q = "'" + id + "' in parents and trashed = false and mimeType != '" + FOLDER_MIME + "'";
      // corpora=allDrives는 "접근 가능한 모든 공유 드라이브 전체"를 뒤지는 옵션이라 훨씬
      // 느려요. 여기선 이미 특정 부모 폴더 ID로 범위를 좁혀서 묻는 거라 필요 없고,
      // supportsAllDrives만으로도 공유 드라이브 안의 폴더를 문제없이 조회할 수 있어요.
      // (100개 범위로 좁혀도 103초가 걸렸던 게 이 옵션 때문이었어요 — 제거 후 훨씬 빨라짐.)
      var url = 'https://www.googleapis.com/drive/v3/files' +
        '?q=' + encodeURIComponent(q) +
        '&fields=' + encodeURIComponent('files(name)') +
        '&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1000';
      return { url: url, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
    });
    var responses;
    try {
      responses = UrlFetchApp.fetchAll(requests);
    } catch (err) {
      chunk.forEach(function (id) { byId[id] = []; });
      if (!errorNote) {
        errorNote = '파일 목록을 병렬로 조회하는 데 실패했어요(' + err.message + ') — Apps Script 에디터에서 함수를 한 번 직접 실행해 권한을 재승인해야 할 수 있어요.';
      }
      continue;
    }
    responses.forEach(function (res, i) {
      var id = chunk[i];
      try {
        var code = res.getResponseCode();
        if (code !== 200) {
          byId[id] = [];
          if (!errorNote) {
            errorNote = '파일 목록 조회 실패(HTTP ' + code + '): ' + String(res.getContentText()).slice(0, 200) +
              ' — 권한 재승인이 필요할 수 있어요.';
          }
          return;
        }
        var data = JSON.parse(res.getContentText());
        byId[id] = (data.files || []).map(function (f) { return f.name; });
      } catch (e) {
        byId[id] = [];
      }
    });
  }
  if (errorNote) byId.__error = errorNote;
  return byId;
}

// excludeFolderIds: 이 ID들과 일치하는 하위 폴더는 재귀 탐색에서 건너뛰어요. 회차별
// 드라이브 폴더가 공용 상위 폴더 밑에 형제로 있지 않고 실수로 서로 안쪽에 중첩돼 있어도,
// 다른 회차 전용 폴더 안의 기업 폴더까지 이 회차로 잘못 잡아오는 걸 막기 위해서예요.
// excludedNames: 실제로 몇 번, 어떤 이름의 폴더가 제외됐는지 진단용으로 같이 모아둬요 —
// 제외가 기대대로 작동하는지 동기화 결과 메시지로 바로 확인할 수 있게.
function collectCompanyFolders(rootId, excludeFolderIds) {
  var results = [];
  var excludedNames = [];
  var COMPANY_NAME_RE = /^(\d+)[_.]\s*([^_]+)_(.+)$/;
  var exclude = excludeFolderIds || [];

  function walk(folderId, depth) {
    if (depth > 6) return;
    var children = listDriveChildren(folderId, true);
    children.forEach(function (child) {
      if (exclude.indexOf(child.id) !== -1) {
        excludedNames.push(child.name + '(' + child.id + ')');
        return;
      }
      var m = child.name.match(COMPANY_NAME_RE);
      if (m) {
        results.push({ id: child.id, folderNc: m[1], region: m[2].trim(), company: m[3].trim() });
      } else {
        walk(child.id, depth + 1);
      }
    });
  }

  walk(rootId, 0);
  results.excludedNames = excludedNames;
  return results;
}
