// 모든 조회·수정은 POST로만 받아요(주소창에 로그인 정보가 실리지 않게).
function doGet() {
  return respond({ ok: false, error: 'method', message: '이 주소는 대시보드 화면에서만 사용돼요.' });
}

// 조회 요청 공통 처리 (POST action: 'read')
// clientVersion: 화면이 가진 데이터 버전. 서버 버전과 같으면 시트를 안 읽고 "그대로"라고만 답해요.
function handleRead(user, action, clientVersion) {
  var ADMIN_ONLY_GET_ACTIONS = ['getLog', 'getUsers'];
  if (ADMIN_ONLY_GET_ACTIONS.indexOf(action) !== -1 && user.role !== 'admin') {
    return { ok: false, error: 'forbidden', message: '관리자만 볼 수 있어요.' };
  }
  if (action === 'getLog') return { ok: true, log: readLog(200) };
  if (action === 'getUsers') return { ok: true, users: getUsers() };
  if (clientVersion && clientVersion === getDataVersion_()) {
    return { ok: true, unchanged: true, v: clientVersion, role: user.role, region: user.region };
  }
  var base = getBasePayload_();
  var rows = base.rows;
  if (user.region && user.region !== 'all') {
    rows = rows.filter(function (r) { return (r.region || '미지정') === user.region; });
  }
  var out = {
    v: base.v, rows: rows, role: user.role, region: user.region, lastSync: base.lastSync,
    sessionCount: base.sessionCount, flagThresholds: base.flagThresholds, rounds: base.rounds
  };
  // 드라이브 이름 점검·진행 중인 동기화 작업은 동기화를 돌리는 관리자에게만 보여줘요.
  if (user.role === 'admin') {
    out.namingIssues = base.namingIssues;
    out.namingRules = base.namingRules;
    out.driveJob = base.driveJob;
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
      return respond(handleRead(user, body.sub, body.v));
    }
    // 여기부터는 데이터를 바꾸는 요청이라, 처리 후 버전을 올려서 다른 화면들이 새로 받아가게 해요.
    var res = handleWrite_(user, body);
    bumpDataVersion_();
    return respond(res);
  } catch (err) {
    Logger.log('doPost 오류: ' + err + (err && err.stack ? ('\n' + err.stack) : ''));
    return respond({ ok: false, error: String(err), message: String(err) });
  }
}

function handleWrite_(user, body) {
  if (body.action === 'setUpload') {
    return setUploadField(user, body.id, body.field, body.value);
  }

  if (user.role !== 'admin') {
    return { ok: false, error: 'forbidden', message: '이 계정은 수정 권한이 없어요.' };
  }

  if (body.action === 'upsert' && body.row) {
    upsertRow(body.row, user);
    return { ok: true };
  }
  if (body.action === 'delete' && body.id) {
    deleteRow(body.id, user);
    return { ok: true };
  }
  if (body.action === 'syncFromDrive') {
    return { ok: true, result: startDriveJob('sync', body.round, body.range) };
  }
  if (body.action === 'refreshChecklist') {
    // 마지막 확인 이후 바뀐 기업 폴더만 다시 봐요(forceFull이면 전체).
    return { ok: true, result: startDriveJob('refresh', body.round, body.range, { forceFull: !!body.full }) };
  }
  if (body.action === 'setSessionCount') {
    return setSessionCountConfig(body.value, user);
  }
  if (body.action === 'setFlagThresholds') {
    return setFlagThresholds(body.value, user);
  }
  if (body.action === 'addUser') {
    return addUser(body.username, body.role, body.region, body.password, user);
  }
  if (body.action === 'updateUserRole') {
    return updateUserRole(body.username, body.role, body.region, user);
  }
  if (body.action === 'resetUserPassword') {
    return resetUserPassword(body.username, body.password, user);
  }
  if (body.action === 'deleteUser') {
    return deleteUser(body.username, user);
  }
  if (body.action === 'upsertRound' && body.round) {
    return upsertRound(body.round, user);
  }
  if (body.action === 'deleteRound' && body.id) {
    return deleteRound(body.id, user);
  }
  return { ok: false, error: 'unknown action', message: '알 수 없는 요청이에요(action: ' + body.action + '). 배포가 최신 코드로 안 됐을 수 있어요.' };
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
