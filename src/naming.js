// ── 드라이브 이름 규칙 점검 ─────────────────────────────────────────────
// 대시보드의 체크 상태는 드라이브 폴더·파일 "이름"으로 판단해요. 이름이 규칙에서 조금만
// 벗어나도(예: "12-수도권-OO", "1차시 일지") 기업이 목록에서 빠지거나 제출했는데 미제출로
// 남는데, 예전엔 그게 아무 표시 없이 0으로만 보였어요. 그래서 동기화·업데이트를 돌릴 때마다
// 규칙에 안 맞는 폴더·파일을 모아서 저장해 두고, 관리자 화면에 "확인 필요" 목록으로 보여줘요.

var NAMING_ISSUES_PROP = 'NAMING_ISSUES_JSON';
var NAMING_ISSUES_MAX_BYTES = 8000; // 스크립트 속성 한 칸 최대 9KB — 여유를 두고 잘라요.

// 파일 이름에 키워드가 들어 있는지 확인해요. "1차"·"1회차"처럼 숫자로 시작하는 키워드는
// 바로 앞이 숫자면 다른 회차로 봐요("11차 일지"가 1차로, "12회차"가 2회차로 잡히던 문제 방지).
function nameHasKeyword(name, kw) {
  name = String(name || '');
  var startsWithDigit = /^\d/.test(kw);
  var from = 0;
  while (true) {
    var idx = name.indexOf(kw, from);
    if (idx === -1) return false;
    if (!startsWithDigit || idx === 0 || !/\d/.test(name.charAt(idx - 1))) return true;
    from = idx + 1;
  }
}

function nameMatchesAnyKeyword(name, keywordMap) {
  return keywordMap.some(function (k) {
    return k.keywords.some(function (kw) { return nameHasKeyword(name, kw); });
  });
}

// 한 번의 동기화/업데이트 실행 동안 문제를 모으는 그릇
function newNamingIssues(kind) {
  return { kind: kind, folders: [], files: [] };
}

// 기업 폴더 하나의 파일 중 어떤 항목(회차·계획서·보고서)에도 안 걸리는 파일을 모아요.
function collectUnrecognizedFiles(issues, info, fileNames, keywordMap, roundName) {
  if (!issues || !fileNames || !fileNames.length) return;
  fileNames.forEach(function (name) {
    if (!nameMatchesAnyKeyword(name, keywordMap)) {
      issues.files.push({ round: roundName, folderNc: String(info.folderNc || ''), company: info.company || '', name: name });
    }
  });
}

// 저장 크기 제한 안으로 목록을 줄이면서, 전체 개수는 따로 남겨요.
function saveNamingIssues(issues, scopeLabel) {
  var data = {
    at: new Date().toISOString(),
    kind: issues.kind,
    scope: scopeLabel || '',
    folderCount: typeof issues.folderCount === 'number' ? issues.folderCount : issues.folders.length,
    fileCount: issues.files.length,
    folders: issues.folders.slice(),
    files: issues.files.slice()
  };
  var json = JSON.stringify(data);
  // 한글은 1글자에 3바이트라 글자 수가 아니라 바이트 수로 재요. 넘치면 긴 쪽 목록부터 10%씩 잘라요.
  while (utf8Bytes_(json) > NAMING_ISSUES_MAX_BYTES && (data.files.length || data.folders.length)) {
    if (data.files.length >= data.folders.length) data.files.length = Math.floor(data.files.length * 0.9);
    else data.folders.length = Math.floor(data.folders.length * 0.9);
    json = JSON.stringify(data);
  }
  PropertiesService.getScriptProperties().setProperty(NAMING_ISSUES_PROP, json);
  return data;
}

function utf8Bytes_(s) {
  return unescape(encodeURIComponent(s)).length;
}

function getNamingIssues() {
  var raw = PropertiesService.getScriptProperties().getProperty(NAMING_ISSUES_PROP);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// 화면에 안내할 이름 규칙(설정된 세션 수에 맞춰서)
function getNamingRules() {
  var n = getSessionCount();
  return {
    folder: '번호_권역_기업명 (예: 12_수도권_(주)예시기업)',
    files: '1회차~' + n + '회차는 "N회차" 또는 "N차", 수행계획서는 "계획서", 결과보고서는 "보고서"가 파일 이름에 들어가야 해요.'
  };
}
