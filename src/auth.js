// 최초 1회 계정 비밀번호를 채우는 함수예요. 예전엔 기본 비밀번호가 코드에 적혀 있었는데,
// 저장소가 공개라 누구나 볼 수 있어서 지웠어요. 이제 비어 있는 계정에만 무작위 비밀번호를
// 만들어 넣고, 그 값은 실행 로그(이 함수를 직접 실행한 사람만 볼 수 있음)에만 남겨요.
function setupInitialPasswords() {
  var props = PropertiesService.getScriptProperties();
  var filled = [];
  getUsers().forEach(function (u) {
    var key = 'PW_' + String(u.username).toUpperCase();
    if (!props.getProperty(key)) {
      var pw = generateRandomPassword_();
      props.setProperty(key, pw);
      filled.push(u.username + ' → ' + pw);
    }
  });
  Logger.log(filled.length
    ? '비밀번호가 비어 있던 계정에 무작위 비밀번호를 채웠어요(이 로그는 지금 실행한 사람만 볼 수 있어요):\n' + filled.join('\n')
    : '모든 계정에 이미 비밀번호가 있어서 아무것도 바꾸지 않았어요.');
}

function generateRandomPassword_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  var raw = Utilities.getUuid() + Utilities.getUuid();
  var out = '';
  for (var i = 0; i < 16; i++) out += chars.charAt(parseInt(raw.replace(/-/g, '').substr(i * 2, 2), 16) % chars.length);
  return out;
}

// ── 로그인 시도 제한 ──────────────────────────────────────────────────
// 같은 아이디로 비밀번호를 연속 5번 틀리면 10분 동안 로그인을 막아요(무작위 대입 방지).
var LOGIN_MAX_FAILS = 5;
var LOGIN_LOCK_SECONDS = 600;

function loginLocked_(username) {
  return !!CacheService.getScriptCache().get('LOCK_' + String(username).toUpperCase());
}

function recordLoginFail_(username) {
  var cache = CacheService.getScriptCache();
  var key = 'FAIL_' + String(username).toUpperCase();
  var n = Number(cache.get(key) || 0) + 1;
  if (n >= LOGIN_MAX_FAILS) {
    cache.put('LOCK_' + String(username).toUpperCase(), '1', LOGIN_LOCK_SECONDS);
    cache.remove(key);
  } else {
    cache.put(key, String(n), LOGIN_LOCK_SECONDS);
  }
}

function clearLoginFails_(username) {
  CacheService.getScriptCache().remove('FAIL_' + String(username).toUpperCase());
}

// ── 로그인 토큰 ───────────────────────────────────────────────────────
// 로그인에 성공하면 무작위 토큰을 발급하고, 이후 요청은 비밀번호 대신 이 토큰으로 확인해요.
// 브라우저에는 비밀번호가 아니라 토큰만 저장돼요. 토큰은 마지막 사용 후 6시간이 지나면 만료되고,
// 해당 계정의 비밀번호를 재설정하거나 계정을 지우면 그 계정의 토큰은 모두 바로 무효가 돼요.
var TOKEN_TTL_SECONDS = 21600; // CacheService 최대치(6시간)

function tokenVersion_(username) {
  return PropertiesService.getScriptProperties().getProperty('TOKVER_' + String(username).toUpperCase()) || '0';
}

function bumpTokenVersion_(username) {
  var key = 'TOKVER_' + String(username).toUpperCase();
  var props = PropertiesService.getScriptProperties();
  props.setProperty(key, String(Number(props.getProperty(key) || 0) + 1));
}

function issueToken_(user) {
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  CacheService.getScriptCache().put('TOK_' + token, JSON.stringify({ u: user.username, v: tokenVersion_(user.username) }), TOKEN_TTL_SECONDS);
  return token;
}

function userFromToken_(token) {
  if (!token || !/^[0-9a-f]{64}$/.test(String(token))) return null;
  var cache = CacheService.getScriptCache();
  var raw = cache.get('TOK_' + token);
  if (!raw) return null;
  try {
    var t = JSON.parse(raw);
    var user = findUser(t.u);
    if (!user || String(t.v) !== tokenVersion_(t.u)) { cache.remove('TOK_' + token); return null; }
    cache.put('TOK_' + token, raw, TOKEN_TTL_SECONDS); // 쓰는 동안은 만료 시간을 계속 연장
    return user;
  } catch (err) { return null; }
}

function revokeToken_(token) {
  if (token) CacheService.getScriptCache().remove('TOK_' + token);
}

// 로그인 요청(action: 'login') 처리 — 성공하면 토큰과 권한 정보를 돌려줘요.
function login(username, password) {
  username = String(username || '').trim();
  if (!username || !password) return { ok: false, error: 'auth', message: '아이디와 비밀번호를 입력해 주세요.' };
  if (loginLocked_(username)) return { ok: false, error: 'locked', message: '로그인 시도가 너무 많아요. 10분 뒤에 다시 시도해 주세요.' };
  var user = authenticate(username, password);
  if (!user) {
    recordLoginFail_(username);
    return { ok: false, error: 'auth', message: '아이디 또는 비밀번호가 올바르지 않아요.' };
  }
  clearLoginFails_(username);
  return { ok: true, token: issueToken_(user), username: user.username, role: user.role, region: user.region };
}

// 모든 요청의 인증 진입점이에요. 로그인 때 발급한 토큰(t)으로만 확인해요.
function authenticateRequest(obj) {
  return userFromToken_((obj || {}).t);
}

function getStoredPassword(username) {
  return PropertiesService.getScriptProperties().getProperty('PW_' + String(username).toUpperCase());
}

function authenticate(username, password) {
  if (!username || !password) return null;
  var users = getUsers();
  for (var i = 0; i < users.length; i++) {
    if (users[i].username === username) {
      var stored = getStoredPassword(username);
      return stored && stored === password ? users[i] : null;
    }
  }
  return null;
}

// ── 사용자 권한 관리 ──────────────────────────────────────────────────
// USERS_JSON(config.js의 getUsers/saveUsers)과 PW_<USERNAME> 속성을 같이 다뤄요.
// 마지막 관리자를 지우거나 강등하는 것, 본인 계정을 스스로 지우는 것만 막아요 — 그
// 외 제약은 두지 않아요(권한 판단은 이걸 쓰는 관리자에게 맡김).
function countAdmins(users) {
  return users.filter(function (u) { return u.role === 'admin'; }).length;
}

function addUser(username, role, region, password, actingUser) {
  username = String(username || '').trim();
  role = role === 'admin' ? 'admin' : 'viewer';
  region = String(region || 'all').trim() || 'all';
  password = String(password || '');
  if (!username) return { ok: false, error: 'invalid', message: '아이디를 입력해주세요.' };
  if (password.length < 6) return { ok: false, error: 'invalid', message: '비밀번호는 6자 이상이어야 해요.' };
  if (findUser(username)) return { ok: false, error: 'duplicate', message: '이미 있는 아이디예요.' };

  var users = getUsers();
  users.push({ username: username, role: role, region: region });
  saveUsers(users);
  PropertiesService.getScriptProperties().setProperty('PW_' + username.toUpperCase(), password);
  if (actingUser) appendLog(actingUser, 'addUser', '', username, '계정 추가 — ' + username + ' (' + role + ', ' + region + ')');
  return { ok: true, users: users };
}

function updateUserRole(username, role, region, actingUser) {
  var users = getUsers();
  var target = null;
  for (var i = 0; i < users.length; i++) { if (users[i].username === username) { target = users[i]; break; } }
  if (!target) return { ok: false, error: 'not-found', message: '계정을 찾을 수 없어요.' };

  role = role === 'admin' ? 'admin' : 'viewer';
  if (target.role === 'admin' && role !== 'admin' && countAdmins(users) <= 1) {
    return { ok: false, error: 'last-admin', message: '마지막 관리자 계정은 권한을 바꿀 수 없어요.' };
  }

  var oldRole = target.role, oldRegion = target.region;
  target.role = role;
  target.region = String(region || 'all').trim() || 'all';
  saveUsers(users);
  if (actingUser) {
    appendLog(actingUser, 'updateUserRole', '', username,
      username + ' 권한 변경 — 역할 ' + oldRole + '→' + target.role + ', 권역 ' + oldRegion + '→' + target.region);
  }
  return { ok: true, users: users };
}

function resetUserPassword(username, newPassword, actingUser) {
  newPassword = String(newPassword || '');
  if (!findUser(username)) return { ok: false, error: 'not-found', message: '계정을 찾을 수 없어요.' };
  if (newPassword.length < 6) return { ok: false, error: 'invalid', message: '비밀번호는 6자 이상이어야 해요.' };
  PropertiesService.getScriptProperties().setProperty('PW_' + username.toUpperCase(), newPassword);
  bumpTokenVersion_(username); // 비밀번호가 바뀌면 이 계정으로 로그인돼 있던 곳은 모두 다시 로그인
  // 실제 비밀번호 값은 로그에 남기지 않아요 — "재설정했다"는 사실만 기록.
  if (actingUser) appendLog(actingUser, 'resetUserPassword', '', username, username + ' 비밀번호 재설정');
  return { ok: true };
}

function deleteUser(username, actingUser) {
  if (actingUser && actingUser.username === username) {
    return { ok: false, error: 'self', message: '본인 계정은 스스로 삭제할 수 없어요.' };
  }
  var users = getUsers();
  var target = findUser(username);
  if (!target) return { ok: false, error: 'not-found', message: '계정을 찾을 수 없어요.' };
  if (target.role === 'admin' && countAdmins(users) <= 1) {
    return { ok: false, error: 'last-admin', message: '마지막 관리자 계정은 삭제할 수 없어요.' };
  }

  var remaining = users.filter(function (u) { return u.username !== username; });
  saveUsers(remaining);
  PropertiesService.getScriptProperties().deleteProperty('PW_' + username.toUpperCase());
  bumpTokenVersion_(username);
  if (actingUser) appendLog(actingUser, 'deleteUser', '', username, '계정 삭제 — ' + username);
  return { ok: true, users: remaining };
}
