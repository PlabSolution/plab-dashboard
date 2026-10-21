// ── 드라이브 동기화 작업(이어 달리기 지원) ───────────────────────────────
// "드라이브에서 불러오기"(sync)와 "취합현황 업데이트"(refresh)를 하나의 작업 엔진으로 돌려요.
//
// 1) 일괄 쓰기: 시트를 한 번만 읽고, 바뀐 줄만 마지막에 한꺼번에 써요(batch.js).
// 2) 바뀐 폴더만: "취합현황 업데이트"는 드라이브 변경 기록(Changes API)을 보고, 마지막 확인
//    이후 파일이 추가·이동·이름변경된 기업 폴더만 다시 확인해요.
// 3) 이어 달리기: 4분 30초가 지나면 지금까지 한 걸 저장하고, 1분 뒤 자동으로 이어서 처리해요.
//    작업 상태는 스크립트 속성(DRIVE_JOB_JSON)에 남겨서, 화면에서도 진행 상황을 보여줘요.

var DRIVE_JOB_PROP = 'DRIVE_JOB_JSON';
var DRIVE_CHANGES_TOKEN_PROP = 'DRIVE_CHANGES_TOKEN';
var DRIVE_JOB_TIME_BUDGET_MS = 4.5 * 60 * 1000;
var DRIVE_JOB_CHUNK = 60;               // 파일 목록을 한 번에 병렬 조회할 기업 수
var DRIVE_JOB_STALE_MS = 20 * 60 * 1000; // 이 시간 넘게 진척이 없으면 멈춘 작업으로 봐요
var DRIVE_JOB_HANDLER = 'continueDriveJob';
var COMPANY_FOLDER_RE = /^(\d+)[_.]\s*([^_]+)_(.+)$/;

// ── 진입점 ────────────────────────────────────────────────────────────

// 화면 버튼·새벽 트리거에서 불러요. type: 'sync' | 'refresh'
function startDriveJob(type, onlyRoundName, range, opts) {
  opts = opts || {};
  var running = loadDriveJob_();
  if (running && !isDriveJobStale_(running)) {
    return { running: true, job: summarizeDriveJob_(running) };
  }

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

  var job = {
    id: Utilities.getUuid(),
    type: type,
    mode: 'full',
    scope: namingScopeLabel(onlyRoundName, range),
    round: onlyRoundName || 'all',
    range: range || null,
    roundNames: rounds.map(function (r) { return r.name; }),
    ri: 0,
    offset: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runs: 0,
    scheduled: !!opts.scheduled,
    totals: type === 'sync'
      ? { foldersScanned: 0, matched: 0, created: 0, skipped: 0 }
      : { checked: 0, updated: 0, skipped: 0 },
    notes: [],
    newFolderHints: 0
  };

  // "취합현황 업데이트"는 마지막 확인 이후 바뀐 폴더만 봐요(변경 기록이 있을 때).
  if (type === 'refresh' && !opts.forceFull) {
    var token = PropertiesService.getScriptProperties().getProperty(DRIVE_CHANGES_TOKEN_PROP);
    if (token) {
      var ch = listDriveChangesSince_(token);
      if (ch && !ch.error && !ch.tooMany) {
        job.mode = 'incremental';
        job.touched = Object.keys(ch.touched);
        job.changesTokenAfter = ch.newStartPageToken;
        job.changeCount = ch.count;
        job.newFolderHintIds = ch.folderIds;
      } else if (ch && ch.error) {
        job.notes.push('변경 기록을 못 읽어서 전체를 확인했어요(' + ch.error + ')');
      }
    }
  }
  // 전체 확인은 시작 시점의 변경 기록 위치를 잡아뒀다가, 끝나면 그 위치부터 다음 증분을 봐요.
  if (job.mode === 'full') job.changesTokenAtStart = getDriveStartToken_();

  saveDriveJob_(job, null);
  return runDriveJob_(job, opts.scheduled ? DRIVE_JOB_TIME_BUDGET_MS : 100 * 1000);
}

// 이어 달리기 트리거가 부르는 함수(1분 뒤 실행)
function continueDriveJob() {
  deleteDriveJobTriggers_();
  var job = loadDriveJob_();
  if (!job) return;
  var res = runDriveJob_(job);
  Logger.log('드라이브 작업 이어서 실행: ' + JSON.stringify(res));
}

// 멈춘 작업을 지우고 싶을 때 편집기에서 직접 실행
function cancelDriveJob() {
  deleteDriveJobTriggers_();
  var job = loadDriveJob_();
  if (job) cacheRemoveLarge_('DRIVE_JOB_ISSUES_' + job.id);
  PropertiesService.getScriptProperties().deleteProperty(DRIVE_JOB_PROP);
  bumpDataVersion_();
  Logger.log('진행 중이던 드라이브 작업을 취소했어요.');
}

// ── 실행 ──────────────────────────────────────────────────────────────

// budgetMs: 화면 버튼에서 바로 실행할 땐 짧게(사용자가 오래 기다리지 않게), 나머지는
// 1분 뒤 자동 이어 달리기가 4분 30초씩 처리해요.
function runDriveJob_(job, budgetMs) {
  var timeBudget = budgetMs || DRIVE_JOB_TIME_BUDGET_MS;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    scheduleDriveJobContinuation_();
    return { continuing: true, job: summarizeDriveJob_(job), note: '다른 작업이 끝나길 기다렸다가 이어서 처리할게요.' };
  }
  // 실행이 6분 제한으로 강제 종료돼도 작업이 멈춰 있지 않게, 시작하자마자 안전망 트리거를 걸어둬요.
  scheduleDriveJobContinuation_(7 * 60 * 1000);

  var startTime = Date.now();
  var issues = loadDriveJobIssues_(job);
  var finished = false;
  try {
    job.runs++;
    var sessionCount = getSessionCount();
    var keywordMap = getKeywordMapForCount(sessionCount);
    var batch = openRowBatch_();
    var allRounds = readRounds()
      .map(function (r) { return Object.assign({}, r, { driveFolderId: normalizeDriveFolderId(r.driveFolderId) }); })
      .filter(function (r) { return r.driveFolderId; });
    var touchedSet = null;
    if (job.mode === 'incremental') {
      touchedSet = {};
      (job.touched || []).forEach(function (id) { touchedSet[id] = true; });
    }

    var outOfTime = false;
    while (job.ri < job.roundNames.length) {
      var roundName = job.roundNames[job.ri];
      var round = allRounds.filter(function (r) { return r.name === roundName; })[0];
      if (!round) { job.ri++; job.offset = 0; continue; }

      var items;
      if (job.type === 'sync') {
        items = syncItemsForRound_(job, round, allRounds, issues);
      } else {
        items = refreshItemsForRound_(job, batch, roundName, touchedSet);
      }

      while (job.offset < items.length) {
        if (Date.now() - startTime > timeBudget) { outOfTime = true; break; }
        var chunk = items.slice(job.offset, job.offset + DRIVE_JOB_CHUNK);
        processDriveChunk_(job, batch, chunk, roundName, sessionCount, keywordMap, issues);
        job.offset += chunk.length;
      }
      if (outOfTime) break;
      job.ri++;
      job.offset = 0;
    }

    flushRowBatch_(batch);
    finished = !outOfTime;
  } catch (err) {
    job.notes.push('오류: ' + err.message);
    Logger.log('드라이브 작업 오류: ' + err + (err.stack ? '\n' + err.stack : ''));
    // 오류가 나도 작업 상태는 남겨두고(안전망 트리거가 다시 시도), 같은 오류가 반복되면 사람이 확인하게 해요.
    if (job.runs >= 5) finished = true;
  } finally {
    job.updatedAt = new Date().toISOString();
    try {
      if (finished) finishDriveJob_(job, issues);
      else {
        saveDriveJob_(job, issues);
        scheduleDriveJobContinuation_();
      }
      bumpDataVersion_();
    } finally {
      lock.releaseLock();
    }
  }
  return buildDriveJobResult_(job, finished, issues);
}

// sync: 회차 폴더를 훑어서 기업 폴더 목록을 만들어요(이름순이라 이어 달려도 순서가 같아요).
function syncItemsForRound_(job, round, allRounds, issues) {
  var exclude = allRounds.filter(function (r) { return r.driveFolderId !== round.driveFolderId; })
    .map(function (r) { return r.driveFolderId; });
  var folders;
  try {
    folders = collectCompanyFolders(round.driveFolderId, exclude);
  } catch (err) {
    if (job.notes.join().indexOf('[' + round.name + '] 드라이브 폴더에 접근') === -1) job.notes.push('[' + round.name + '] 드라이브 폴더에 접근할 수 없어요: ' + err.message + ' — ID와 공유 권한을 확인해주세요.');
    return [];
  }
  // 폴더 문제·진단은 회차마다 처음 한 번만 기록해요(이어 달릴 때 중복 방지).
  job.notedRounds = job.notedRounds || [];
  if (job.notedRounds.indexOf(round.name) === -1) {
    job.notedRounds.push(round.name);
    (folders.suspectFolders || []).forEach(function (f) {
      issues.folders.push({ round: round.name, path: f.path, name: f.name });
    });
    if (!folders.length) {
      var rootChildren = [];
      try { rootChildren = listDriveChildren(round.driveFolderId); } catch (e) {}
      job.notes.push('[' + round.name + '] ' + (rootChildren.length
        ? '기업 폴더("번호_권역_기업명")를 찾지 못했어요. 바로 아래 항목: ' + rootChildren.slice(0, 10).map(function (f) { return f.name; }).join(', ')
        : '지정한 폴더 아래에 항목이 없어요. ID와 공유 권한을 확인해주세요.'));
    } else {
      job.notes.push('[' + round.name + '] 찾은 기업 ' + folders.length + '개');
    }
  }
  return folders
    .filter(function (f) { return inFolderNcRange(f.folderNc, job.range); })
    .map(function (f) { return { folderId: f.id, folderNc: f.folderNc, region: f.region, company: f.company }; });
}

// refresh: 시트에 이미 있는 이 회차 기업 중 폴더가 연결된 것(증분이면 바뀐 폴더만)
function refreshItemsForRound_(job, batch, roundName, touchedSet) {
  var companyCol = HEADERS.indexOf('company');
  var roundCol = HEADERS.indexOf('round');
  var ncCol = HEADERS.indexOf('folderNc');
  var regionCol = HEADERS.indexOf('region');
  var folderIdCol = HEADERS.indexOf('folderId');
  var items = [];
  for (var i = 1; i < batch.values.length; i++) {
    var row = batch.values[i];
    if (!row[companyCol] || !row[folderIdCol]) continue;
    if ((row[roundCol] || DEFAULT_ROUND) !== roundName) continue;
    if (!inFolderNcRange(row[ncCol], job.range)) continue;
    if (touchedSet && !touchedSet[row[folderIdCol]]) continue;
    items.push({ folderId: row[folderIdCol], folderNc: row[ncCol], region: row[regionCol], company: row[companyCol] });
  }
  return items;
}

function isRowAllDone_(arr, sessionCount) {
  for (var n = 1; n <= sessionCount; n++) {
    if (!arr[HEADERS.indexOf('session' + n)]) return false;
  }
  return !!arr[HEADERS.indexOf('plan')] && !!arr[HEADERS.indexOf('report')];
}

// 기업 묶음 하나 처리: 이미 다 끝난 기업은 건너뛰고, 나머지만 파일 목록을 병렬로 확인해요.
function processDriveChunk_(job, batch, chunk, roundName, sessionCount, keywordMap, issues) {
  var folderIdCol = HEADERS.indexOf('folderId');
  var pending = [];
  chunk.forEach(function (item) {
    if (job.type === 'sync') job.totals.foldersScanned++;
    var idx = batchFindRow_(batch, item.company, roundName);
    if (idx !== -1 && isRowAllDone_(batch.values[idx], sessionCount)) {
      // 다 끝난 기업은 파일을 볼 필요가 없어요. 폴더 연결만 비어 있으면 채워줘요.
      if (job.type === 'sync' && !batch.values[idx][folderIdCol] && item.folderId) {
        var r = batchRowObject_(batch, idx);
        r.folderId = item.folderId;
        r.sessions = sessionsFromObj_(r, sessionCount);
        batchUpsert_(batch, r, null);
        job.totals.matched++;
      } else {
        job.totals.skipped++;
      }
      return;
    }
    pending.push({ item: item, idx: idx });
  });
  if (!pending.length) return;

  var lists = batchListDriveFiles(pending.map(function (p) { return p.item.folderId; }));
  if (lists.__error && job.notes.indexOf(lists.__error) === -1) job.notes.push('⚠ ' + lists.__error);

  pending.forEach(function (p) {
    var item = p.item;
    var fileNames = lists[item.folderId] || [];
    markCompanySeen_(job, roundName, item.company);
    collectUnrecognizedFiles(issues, item, fileNames, keywordMap, roundName);
    var flags = {};
    keywordMap.forEach(function (k) {
      flags[k.field] = fileNames.some(function (name) {
        return k.keywords.some(function (kw) { return nameHasKeyword(name, kw); });
      });
    });

    if (p.idx === -1) {
      if (job.type !== 'sync') return;
      var newSessions = [];
      for (var n = 1; n <= sessionCount; n++) newSessions.push(!!flags['session' + n]);
      var newRow = {
        id: Utilities.getUuid(), date: '', folderNc: item.folderNc || '', region: item.region || '',
        company: item.company, sessions: newSessions, plan: !!flags.plan, report: !!flags.report,
        flag: 'none', remark: '', round: roundName, folderId: item.folderId || ''
      };
      newRow.complete = newSessions.every(Boolean) && newRow.plan && newRow.report;
      batchUpsert_(batch, newRow, null);
      job.totals.created++;
      return;
    }

    var ex = batchRowObject_(batch, p.idx);
    var sessionsArr = sessionsFromObj_(ex, sessionCount);
    for (var s = 1; s <= sessionCount; s++) if (flags['session' + s]) sessionsArr[s - 1] = true;
    var plan = !!ex.plan || !!flags.plan;
    var report = !!ex.report || !!flags.report;
    var updated = {
      id: ex.id, date: ex.date,
      folderNc: ex.folderNc || item.folderNc || '', region: ex.region || item.region || '',
      company: ex.company, sessions: sessionsArr, plan: plan, report: report,
      complete: sessionsArr.every(Boolean) && plan && report,
      flag: ex.flag, remark: ex.remark, round: ex.round || roundName,
      folderId: item.folderId || ex.folderId || ''
    };
    var res = batchUpsert_(batch, updated, null);
    if (job.type === 'sync') { if (res === 'updated') job.totals.matched++; }
    else {
      job.totals.checked++;
      if (res === 'updated') job.totals.updated++;
    }
  });
}

function sessionsFromObj_(obj, sessionCount) {
  var arr = [];
  for (var n = 1; n <= sessionCount; n++) arr.push(!!obj['session' + n]);
  return arr;
}

function finishDriveJob_(job, issues) {
  var props = PropertiesService.getScriptProperties();
  if (job.mode === 'full' && job.changesTokenAtStart) props.setProperty(DRIVE_CHANGES_TOKEN_PROP, job.changesTokenAtStart);
  if (job.mode === 'incremental' && job.changesTokenAfter) props.setProperty(DRIVE_CHANGES_TOKEN_PROP, job.changesTokenAfter);

  // 증분 업데이트는 바뀐 기업만 봐서 파일 문제도 그 기업 것만 알아요 — 나머지 기업의
  // 기존 파일 문제는 그대로 두고, 이번에 본 기업 것만 새 결과로 바꿔요.
  if (job.type === 'refresh') {
    var prev = getNamingIssues();
    if (prev) {
      issues.folders = prev.folders || [];
      issues.folderCount = prev.folderCount || issues.folders.length;
      if (job.mode === 'incremental') {
        var seen = {};
        (job.seenCompanies || []).forEach(function (k) { seen[k] = true; });
        var kept = (prev.files || []).filter(function (f) { return !seen[(f.round || '') + '|' + (f.company || '')]; });
        issues.files = kept.concat(issues.files);
      }
    }
  }
  var saved = saveNamingIssues(issues, job.scope);
  job.namingFolderCount = saved.folderCount;
  job.namingFileCount = saved.fileCount;

  if (job.type === 'sync') recordSyncResult(Object.assign({}, job.totals, { debug: job.notes.join(' / ') }));
  cacheRemoveLarge_('DRIVE_JOB_ISSUES_' + job.id);
  props.deleteProperty(DRIVE_JOB_PROP);
  deleteDriveJobTriggers_();
  props.setProperty('LAST_DRIVE_JOB_JSON', JSON.stringify(summarizeDriveJob_(job, true)));
}

function buildDriveJobResult_(job, finished, issues) {
  var out = Object.assign({}, job.totals);
  out.mode = job.mode;
  out.finished = finished;
  out.continuing = !finished;
  out.job = summarizeDriveJob_(job, finished);
  if (job.notes.length) out.debug = job.notes.join(' / ');
  if (finished) {
    out.namingFolderCount = job.namingFolderCount || 0;
    out.namingFileCount = job.namingFileCount || 0;
  }
  if (job.mode === 'incremental') {
    out.changeCount = job.changeCount || 0;
    out.touchedCompanies = job.type === 'refresh' ? (job.totals.checked + job.totals.skipped) : 0;
    out.newFolderHints = countNewFolderHints_(job);
  }
  return out;
}

// 증분 모드에서, 변경 기록에 "기업 폴더처럼 생긴 새 폴더"가 보이면 불러오기를 권해요.
function countNewFolderHints_(job) {
  var ids = job.newFolderHintIds || [];
  if (!ids.length) return 0;
  var known = {};
  var folderIdCol = HEADERS.indexOf('folderId');
  var values = getSheet().getDataRange().getValues();
  for (var i = 1; i < values.length; i++) if (values[i][folderIdCol]) known[values[i][folderIdCol]] = true;
  return ids.filter(function (id) { return !known[id]; }).length;
}

// ── 드라이브 변경 기록(Changes API) ──────────────────────────────────

function getDriveStartToken_() {
  try {
    return Drive.Changes.getStartPageToken({ supportsAllDrives: true }).startPageToken;
  } catch (err) {
    Logger.log('변경 기록 시작 위치를 못 가져왔어요: ' + err);
    return null;
  }
}

// 토큰 이후에 바뀐 파일들의 "부모 폴더"를 모아요. 파일 추가·이동·이름변경 모두 잡혀요.
function listDriveChangesSince_(token) {
  var touched = {};
  var folderIds = [];
  var count = 0;
  var pageToken = token;
  var newStart = null;
  try {
    do {
      var resp = Drive.Changes.list(pageToken, {
        fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents,trashed))',
        pageSize: 1000,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      });
      (resp.changes || []).forEach(function (c) {
        count++;
        var f = c.file;
        if (!f || c.removed) return;
        (f.parents || []).forEach(function (p) { touched[p] = true; });
        if (f.mimeType === FOLDER_MIME) {
          touched[f.id] = true;
          if (COMPANY_FOLDER_RE.test(f.name || '')) folderIds.push(f.id);
        }
      });
      if (resp.newStartPageToken) newStart = resp.newStartPageToken;
      pageToken = resp.nextPageToken;
      if (count > 20000) return { tooMany: true };
    } while (pageToken);
  } catch (err) {
    return { error: err.message };
  }
  return { touched: touched, folderIds: folderIds, newStartPageToken: newStart || token, count: count };
}

// ── 작업 상태 저장 ─────────────────────────────────────────────────────

function loadDriveJob_() {
  var raw = PropertiesService.getScriptProperties().getProperty(DRIVE_JOB_PROP);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function saveDriveJob_(job, issues) {
  // 증분 작업의 바뀐 폴더 목록은 길어질 수 있어서 속성(9KB 제한) 대신 캐시에 같이 둬요.
  var light = Object.assign({}, job);
  cachePutLarge_('DRIVE_JOB_ISSUES_' + job.id, {
    folders: (issues && issues.folders) || [],
    files: (issues && issues.files) || [],
    touched: job.touched || [],
    newFolderHintIds: job.newFolderHintIds || [],
    seenCompanies: job.seenCompanies || []
  }, 6 * 60 * 60);
  delete light.touched;
  delete light.newFolderHintIds;
  delete light.seenCompanies;
  PropertiesService.getScriptProperties().setProperty(DRIVE_JOB_PROP, JSON.stringify(light));
}

function loadDriveJobIssues_(job) {
  var issues = newNamingIssues(job.type);
  var stored = cacheGetLarge_('DRIVE_JOB_ISSUES_' + job.id);
  if (stored) {
    issues.folders = stored.folders || [];
    issues.files = stored.files || [];
    if (!job.touched) job.touched = stored.touched || [];
    if (!job.newFolderHintIds) job.newFolderHintIds = stored.newFolderHintIds || [];
    if (!job.seenCompanies) job.seenCompanies = stored.seenCompanies || [];
  }
  if (!job.seenCompanies) job.seenCompanies = [];
  return issues;
}

// 증분 업데이트에서 이번에 다시 확인한 기업을 기록해둬요(그 기업의 파일 문제만 새 결과로 교체).
function markCompanySeen_(job, round, company) {
  var k = (round || '') + '|' + (company || '');
  if (job.seenCompanies.indexOf(k) === -1) job.seenCompanies.push(k);
}

function isDriveJobStale_(job) {
  return Date.now() - new Date(job.updatedAt || job.startedAt).getTime() > DRIVE_JOB_STALE_MS;
}

function summarizeDriveJob_(job, finished) {
  if (!job) return null;
  return {
    type: job.type,
    mode: job.mode,
    scope: job.scope,
    finished: !!finished,
    roundIndex: job.ri,
    roundCount: (job.roundNames || []).length,
    offset: job.offset,
    totals: job.totals,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    runs: job.runs
  };
}

// 화면에 보여줄 "진행 중인 작업" 요약(없으면 null)
function getDriveJobSummary_() {
  var job = loadDriveJob_();
  if (!job || isDriveJobStale_(job)) return null;
  return summarizeDriveJob_(job, false);
}

function scheduleDriveJobContinuation_(delayMs) {
  deleteDriveJobTriggers_();
  ScriptApp.newTrigger(DRIVE_JOB_HANDLER).timeBased().after(delayMs || 60 * 1000).create();
}

function deleteDriveJobTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === DRIVE_JOB_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

// 이름 점검 결과가 어느 범위를 돌린 결과인지 화면에 같이 보여주려고 만드는 설명
function namingScopeLabel(onlyRoundName, range) {
  var parts = [];
  parts.push(onlyRoundName && onlyRoundName !== 'all' ? onlyRoundName : '전체 회차');
  if (range && typeof range.from === 'number') parts.push('폴더NC ' + range.from + '~' + range.to);
  return parts.join(' · ');
}
