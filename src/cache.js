// ── 데이터 버전과 조회 캐시 ─────────────────────────────────────────────
// 화면은 20초마다 서버에 "새 데이터 있어?"를 물어요. 예전엔 그때마다 시트 전체를 읽었는데,
// 이제는 데이터가 바뀔 때마다 버전 번호를 올려두고, 화면이 가진 버전과 같으면 시트를 안 읽고
// "그대로예요"라고만 답해요. 버전이 바뀌었을 때도 첫 사람만 시트를 읽고, 그 결과를 캐시에
// 잠깐 저장해서 다른 사람들은 캐시에서 받아가요.

var DATA_VERSION_PROP = 'DATA_VERSION';
var BASE_CACHE_TTL_SEC = 300;   // 시트를 사람이 직접 고친 경우에도 최대 5분 안에 반영되게
var CACHE_CHUNK_CHARS = 30000;  // CacheService 한 칸 100KB 제한 — 한글 3바이트를 감안해 넉넉히

function getDataVersion_() {
  return PropertiesService.getScriptProperties().getProperty(DATA_VERSION_PROP) || '0';
}

function bumpDataVersion_() {
  try {
    PropertiesService.getScriptProperties().setProperty(DATA_VERSION_PROP, String(Date.now()));
  } catch (err) {
    Logger.log('버전 갱신 실패: ' + err);
  }
}

// 시트를 사람이 직접 고쳐도 화면이 바로 알아채도록(설치 없이 자동으로 동작하는 단순 트리거)
function onEdit(e) {
  bumpDataVersion_();
}

function cachePutLarge_(key, obj, ttlSec) {
  try {
    var s = JSON.stringify(obj);
    var n = Math.ceil(s.length / CACHE_CHUNK_CHARS) || 1;
    var parts = {};
    for (var i = 0; i < n; i++) parts[key + '_' + i] = s.substr(i * CACHE_CHUNK_CHARS, CACHE_CHUNK_CHARS);
    parts[key + '_n'] = String(n);
    CacheService.getScriptCache().putAll(parts, ttlSec);
  } catch (err) {
    Logger.log('캐시 저장 실패(무시): ' + err);
  }
}

function cacheGetLarge_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(key + '_n'), 10);
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + '_' + i);
    var got = cache.getAll(keys);
    var s = '';
    for (var j = 0; j < n; j++) {
      if (got[keys[j]] == null) return null;
      s += got[keys[j]];
    }
    return JSON.parse(s);
  } catch (err) {
    return null;
  }
}

function cacheRemoveLarge_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(key + '_n'), 10) || 0;
    var keys = [key + '_n'];
    for (var i = 0; i < n; i++) keys.push(key + '_' + i);
    cache.removeAll(keys);
  } catch (err) {}
}

// 모든 계정이 공통으로 받는 조회 데이터(권역 필터 전). 버전별로 캐시해요.
function getBasePayload_() {
  var v = getDataVersion_();
  var key = 'BASE_' + v;
  var cached = cacheGetLarge_(key);
  if (cached) return cached;
  var data = readAll();
  var base = {
    v: v,
    rows: data.rows,
    sessionCount: data.sessionCount,
    flagThresholds: getFlagThresholds(),
    rounds: readRounds(),
    lastSync: getLastSyncInfo(),
    namingIssues: getNamingIssues(),
    namingRules: getNamingRules(),
    driveJob: getDriveJobSummary_()
  };
  // 캐시에 넣었다 꺼내도 화면에 보내는 JSON과 똑같은 모양이 되도록 한 번 직렬화해서 맞춰둬요.
  base = JSON.parse(JSON.stringify(base));
  cachePutLarge_(key, base, BASE_CACHE_TTL_SEC);
  return base;
}
