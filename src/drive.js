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
      // 이어 달리기(continuation) 때 매번 같은 순서로 훑어야 "어디까지 했는지"가 맞아서 이름순으로 고정해요.
      orderBy: 'name',
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
  // 기업 폴더 규칙에 안 맞고, 안에 하위 폴더도 없는 "막다른" 폴더 — 이름을 잘못 지은 기업
  // 폴더일 가능성이 높아서 확인 목록에 올려요.
  var suspectFolders = [];
  var COMPANY_NAME_RE = /^(\d+)[_.]\s*([^_]+)_(.+)$/;
  var exclude = excludeFolderIds || [];

  function walk(folderId, depth, path) {
    if (depth > 6) return -1;
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
        var sub = walk(child.id, depth + 1, path + child.name + ' / ');
        if (sub === 0) suspectFolders.push({ name: child.name, path: path });
      }
    });
    return children.length;
  }

  walk(rootId, 0, '');
  results.excludedNames = excludedNames;
  results.suspectFolders = suspectFolders;
  return results;
}
