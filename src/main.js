// 모든 조회·수정은 POST로만 받아요(주소창에 로그인 정보가 실리지 않게).
function doGet() {
  return respond({ ok: false, error: 'method', message: '이 주소는 대시보드 화면에서만 사용돼요.' });
}

// 조회 요청 공통 처리 (POST action: 'read')
function handleRead(user, action) {
  var ADMIN_ONLY_GET_ACTIONS = ['getLog', 'getUsers'];
  if (ADMIN_ONLY_GET_ACTIONS.indexOf(action) !== -1 && user.role !== 'admin') {
    return { ok: false, error: 'forbidden', message: '관리자만 볼 수 있어요.' };
  }
  if (action === 'getLog') return { ok: true, log: readLog(200) };
  if (action === 'getUsers') return { ok: true, users: getUsers() };
  var data = readAll();
  var rows = data.rows;
  if (user.region && user.region !== 'all') {
    rows = rows.filter(function (r) { return (r.region || '미지정') === user.region; });
  }
  var out = { rows: rows, role: user.role, region: user.region, lastSync: getLastSyncInfo(), sessionCount: data.sessionCount, flagThresholds: getFlagThresholds(), rounds: readRounds() };
  // 드라이브 이름 점검 결과는 동기화를 돌리는 관리자에게만 보여줘요.
  if (user.role === 'admin') {
    out.namingIssues = getNamingIssues();
    out.namingRules = getNamingRules();
  }
  return out;
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'login') {
      return respond(login(body.u, body.p));
    }
    var user = authenticateRequest(body);
    if (!user) {
      return respond({ ok: false, error: 'auth', message: '로그인 정보가 만료됐어요. 다시 로그인해 주세요.' });
    }
    if (body.action === 'logout') {
      revokeToken_(body.t);
      return respond({ ok: true });
    }
    if (body.action === 'read') {
      return respond(handleRead(user, body.sub));
    }

    if (body.action === 'setUpload') {
      return respond(setUploadField(user, body.id, body.field, body.value));
    }

    if (user.role !== 'admin') {
      return respond({ ok: false, error: 'forbidden', message: '이 계정은 수정 권한이 없어요.' });
    }

    if (body.action === 'upsert' && body.row) {
      upsertRow(body.row, user);
      return respond({ ok: true });
    }
    if (body.action === 'delete' && body.id) {
      deleteRow(body.id, user);
      return respond({ ok: true });
    }
    if (body.action === 'syncFromDrive') {
      var result = syncFromDrive(body.round, body.range);
      recordSyncResult(result);
      return respond({ ok: true, result: result, lastSync: getLastSyncInfo() });
    }
    if (body.action === 'refreshChecklist') {
      // syncFromDrive와 다른 결과 모양(checked/updated)이라 recordSyncResult는 안 씀 —
      // "마지막 드라이브 동기화" 기록은 새 기업 탐색이 있는 syncFromDrive 전용으로 남겨둠.
      return respond({ ok: true, result: refreshChecklistFromDrive(body.round, body.range) });
    }
    if (body.action === 'setSessionCount') {
      return respond(setSessionCountConfig(body.value, user));
    }
    if (body.action === 'setFlagThresholds') {
      return respond(setFlagThresholds(body.value, user));
    }
    if (body.action === 'addUser') {
      return respond(addUser(body.username, body.role, body.region, body.password, user));
    }
    if (body.action === 'updateUserRole') {
      return respond(updateUserRole(body.username, body.role, body.region, user));
    }
    if (body.action === 'resetUserPassword') {
      return respond(resetUserPassword(body.username, body.password, user));
    }
    if (body.action === 'deleteUser') {
      return respond(deleteUser(body.username, user));
    }
    if (body.action === 'upsertRound' && body.round) {
      return respond(upsertRound(body.round, user));
    }
    if (body.action === 'deleteRound' && body.id) {
      return respond(deleteRound(body.id, user));
    }
    return respond({ ok: false, error: 'unknown action', message: '알 수 없는 요청이에요(action: ' + body.action + '). 배포가 최신 코드로 안 됐을 수 있어요.' });
  } catch (err) {
    Logger.log('doPost 오류: ' + err + (err && err.stack ? ('\n' + err.stack) : ''));
    return respond({ ok: false, error: String(err), message: String(err) });
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
