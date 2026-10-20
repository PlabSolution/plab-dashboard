var SHEET_NAME = 'rows';
var LOG_SHEET_NAME = 'log';
var LOG_HEADERS = ['at', 'username', 'role', 'action', 'rowId', 'company', 'detail'];
var ROUND_SHEET_NAME = 'rounds';
// driveFolderId: 이 회차 전용 구글드라이브 루트 폴더 ID. syncFromDrive()가 이 값이 채워진
// 회차만 돌면서 그 폴더 밑 기업들을 이 회차 이름으로 동기화해요(맨 끝에 추가 — 기존 배포된
// 시트의 컬럼 위치가 안 깨지도록).
var ROUND_HEADERS = ['id', 'name', 'startDate', 'endDate', 'status', 'description', 'createdAt', 'updatedAt', 'driveFolderId'];
var MAX_SESSIONS = 12;
var DEFAULT_ROUND = '1회차';
var CURRENT_SYNC_ROUND = '1회차';
// 1회차 기본 드라이브 폴더 ID는 코드에 적지 않고 스크립트 속성 DRIVE_FOLDER_ID에서 읽어요.
// (회차별 폴더는 '프로그램 → 회차 관리'에서 회차마다 지정)
var DRIVE_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID') || '';
var FOLDER_MIME = 'application/vnd.google-apps.folder';

var HEADERS = (function () {
  var headers = [
    'id', 'date', 'folderNc', 'region', 'company',
    'session1', 'session2', 'session3', 'session4', 'session5', 'session6',
    'plan', 'report', 'complete', 'flag', 'remark', 'round',
    'upSession1', 'upSession2', 'upSession3', 'upSession4', 'upSession5', 'upSession6', 'upPlan', 'upReport'
  ];
  for (var n = 7; n <= MAX_SESSIONS; n++) headers.push('session' + n);
  for (var n2 = 7; n2 <= MAX_SESSIONS; n2++) headers.push('upSession' + n2);
  headers.push('contactEmail');
  headers.push('folderId');
  // 관리자가 이슈 상태를 수동으로 고정할 때 쓰는 값('' = 자동 계산 따름). 기존 배포된 시트의
  // 컬럼 위치가 안 깨지도록 반드시 맨 끝에 추가해요.
  headers.push('flagOverride');
  // 업로드 체크박스(upSessionN/upPlan/upReport)가 체크된 날짜예요. 체크 해제하면 같이
  // 비워요 — "마지막으로 체크된 날짜"만 의미가 있으니까. 기존 배포된 시트의 컬럼 위치가
  // 안 깨지도록 반드시 맨 끝에 추가해요.
  for (var n4 = 1; n4 <= MAX_SESSIONS; n4++) headers.push('upSession' + n4 + 'At');
  headers.push('upPlanAt');
  headers.push('upReportAt');
  return headers;
})();

// PropertiesService에 USERS_JSON이 아직 없을 때(최초 1회)만 쓰는 시드 데이터예요.
// 실제 계정 목록은 getUsers()/saveUsers()로 관리해요 — "사용자 권한" 화면에서 계정을
// 추가/수정/삭제하면 재배포 없이 바로 반영돼요.
var DEFAULT_USERS = [
  { username: 'Admin_ai', role: 'admin', region: 'all' },
  { username: 'All_ai', role: 'viewer', region: 'all' },
  { username: 'Sccei_ai', role: 'viewer', region: '수도권' },
  { username: 'Gccei_ai', role: 'viewer', region: '강원권' },
  { username: 'Jccei_ai', role: 'viewer', region: '제주권' }
];

function getUsers() {
  var raw = PropertiesService.getScriptProperties().getProperty('USERS_JSON');
  if (!raw) return DEFAULT_USERS;
  try {
    var v = JSON.parse(raw);
    if (Array.isArray(v)) return v;
  } catch (err) {}
  return DEFAULT_USERS;
}

function saveUsers(list) {
  PropertiesService.getScriptProperties().setProperty('USERS_JSON', JSON.stringify(list));
}

function findUser(username) {
  var list = getUsers();
  for (var i = 0; i < list.length; i++) {
    if (list[i].username === username) return list[i];
  }
  return null;
}

var DEFAULT_FLAG_THRESHOLDS = { caution: 3, alert: 5, issue: 7 };
var FLAG_LABELS_KO = { caution: '주의', alert: '경고', issue: '문제' };

function getSessionCount() {
  var v = Number(PropertiesService.getScriptProperties().getProperty('SESSION_COUNT'));
  if (!v || v < 1 || v > MAX_SESSIONS || Math.floor(v) !== v) return 6;
  return v;
}

function setSessionCountConfig(n, user) {
  n = Number(n);
  if (!n || n < 1 || n > MAX_SESSIONS || Math.floor(n) !== n) {
    return { ok: false, error: 'invalid', message: '세션 수는 1~' + MAX_SESSIONS + ' 사이의 정수여야 해요.' };
  }
  var old = getSessionCount();
  PropertiesService.getScriptProperties().setProperty('SESSION_COUNT', String(n));
  if (user) appendLog(user, 'setSessionCount', '', '', '세션 수 ' + old + '→' + n);
  return { ok: true, sessionCount: n };
}

function isPosInt(n) { return typeof n === 'number' && n > 0 && Math.floor(n) === n; }

function isValidFlagThresholds(v) {
  return !!v && isPosInt(v.caution) && isPosInt(v.alert) && isPosInt(v.issue) &&
    v.caution < v.alert && v.alert < v.issue;
}

function getFlagThresholds() {
  var raw = PropertiesService.getScriptProperties().getProperty('FLAG_THRESHOLDS');
  if (!raw) return DEFAULT_FLAG_THRESHOLDS;
  try {
    var v = JSON.parse(raw);
    if (isValidFlagThresholds(v)) return v;
  } catch (err) {}
  return DEFAULT_FLAG_THRESHOLDS;
}

function setFlagThresholds(v, user) {
  if (!isValidFlagThresholds(v)) {
    return { ok: false, error: 'invalid', message: '주의 < 경고 < 문제 순서로, 1 이상의 정수로 입력해주세요.' };
  }
  var old = getFlagThresholds();
  PropertiesService.getScriptProperties().setProperty('FLAG_THRESHOLDS', JSON.stringify(v));
  if (user) {
    appendLog(user, 'setFlagThresholds', '', '',
      '지연 기준일 주의 ' + old.caution + '→' + v.caution + ', 경고 ' + old.alert + '→' + v.alert + ', 문제 ' + old.issue + '→' + v.issue);
  }
  return { ok: true, flagThresholds: v };
}

function getUploadFieldNames(count) {
  var arr = [];
  for (var n = 1; n <= count; n++) arr.push('upSession' + n);
  arr.push('upPlan', 'upReport');
  return arr;
}

function getUploadToSourceMap(count) {
  var map = {};
  for (var n = 1; n <= count; n++) map['upSession' + n] = 'session' + n;
  map.upPlan = 'plan';
  map.upReport = 'report';
  return map;
}

function getKeywordMapForCount(count) {
  var map = [
    { field: 'plan', keywords: ['계획서'] },
    { field: 'report', keywords: ['결과보고서', '보고서'] }
  ];
  for (var n = 1; n <= count; n++) {
    map.push({ field: 'session' + n, keywords: [n + '회차', n + '차'] });
  }
  return map;
}
