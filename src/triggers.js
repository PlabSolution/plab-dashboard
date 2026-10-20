function setupDailySyncTrigger() {
  removeSyncTriggers();
  ScriptApp.newTrigger('runScheduledSync').timeBased().atHour(4).everyDays(1).create();
  Logger.log('설정 완료: 매일 새벽 4시~5시 사이에 자동으로 드라이브 동기화가 실행돼요.');
}

function removeSyncTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'runScheduledSync') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  if (removed) Logger.log(removed + '개의 기존 자동 동기화 트리거를 정리했어요.');
}

function runScheduledSync() {
  var result;
  try {
    result = syncFromDrive();
  } catch (err) {
    result = { error: String(err) };
  }
  recordSyncResult(result);
  Logger.log('자동 동기화 결과: ' + JSON.stringify(result));
}
