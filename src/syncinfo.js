// 드라이브 동기화 결과 기록(화면의 "마지막 동기화" 표시용)
function recordSyncResult(result) {
  var summary;
  if (result && result.error) {
    summary = '오류: ' + result.error;
  } else if (result) {
    summary = (result.foldersScanned || 0) + '개 폴더 확인 · 갱신 ' + (result.matched || 0) + '건 · 신규 ' + (result.created || 0) + '건' +
      (result.skipped ? (' · 건너뜀 ' + result.skipped + '건') : '') +
      (result.debug ? (' — ' + result.debug) : '');
  } else {
    summary = '완료';
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('LAST_SYNC_AT', new Date().toISOString());
  props.setProperty('LAST_SYNC_SUMMARY', summary);
}

function getLastSyncInfo() {
  var props = PropertiesService.getScriptProperties();
  var at = props.getProperty('LAST_SYNC_AT');
  if (!at) return null;
  return { at: at, summary: props.getProperty('LAST_SYNC_SUMMARY') || '' };
}
