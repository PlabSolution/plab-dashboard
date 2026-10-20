  // 사이드바(권역/회차 내비)는 페이지와 무관하게 항상 보이니 매번 다시 그려요. 그 외
  // 페이지별 렌더링(통계·테이블·보고서)은 **지금 보이는 페이지 것만** 다시 그려요
  // — 예전엔 폴링 때마다 안 보이는 페이지까지 전부(특히 대형 테이블) 다시 그려서 낭비가
  // 컸어요. 안 그린 페이지는 setPage()가 진입 시점에 알아서 새로 그려주니 최신 상태는 그대로
  // 보장돼요.
  function renderAll(){
    renderRegionNav();
    renderRoundNav();
    if(currentPage === 'dashboard'){
      renderStats();
      renderQuickPanels();
    }
    if(currentPage === 'collect' || currentPage === 'upload'){
      renderTable();
      renderRowCountLabel();
    }
    if(currentPage === 'report') renderReportView();
  }

  function setPage(page){
    currentPage = page;
    if(dashboardViewEl) dashboardViewEl.hidden = page !== 'dashboard';
    if(tableViewEl) tableViewEl.hidden = (page !== 'collect' && page !== 'upload');
    if(settingsViewEl) settingsViewEl.hidden = page !== 'settings';
    if(usersViewEl) usersViewEl.hidden = page !== 'users';
    if(programViewEl) programViewEl.hidden = page !== 'program';
    if(reportViewEl) reportViewEl.hidden = page !== 'report';
    if(navDashboardBtn) navDashboardBtn.classList.toggle('active', page === 'dashboard');
    if(navCollectBtn) navCollectBtn.classList.toggle('active', page === 'collect');
    if(navUploadBtn) navUploadBtn.classList.toggle('active', page === 'upload');
    if(navSettingsBtn) navSettingsBtn.classList.toggle('active', page === 'settings');
    if(navUsersBtn) navUsersBtn.classList.toggle('active', page === 'users');
    if(navProgramBtn) navProgramBtn.classList.toggle('active', page === 'program');
    if(navReportBtn) navReportBtn.classList.toggle('active', page === 'report');
    if(page === 'dashboard'){ renderStats(); renderQuickPanels(); }
    if(page === 'collect' || page === 'upload') setViewMode(page);
    if(page === 'settings') renderSettingsView();
    if(page === 'users') fetchUsers();
    if(page === 'program') renderProgramView();
    if(page === 'report') renderReportView();
  }

  // 로그인한 계정 권한 + 현재 탭(취합현황/업로드현황)에 따라 편집용 버튼/문구를 보이거나 숨겨요.
  // (실제 수정 차단은 apps-script-code.gs 서버 쪽에서도 한 번 더 확인해요 — 화면에서
  // 숨기는 것만으로는 API를 직접 호출하는 걸 막을 수 없기 때문이에요.)
  function applyRoleUI(){
    var admin = isAdmin();
    var scopedRegion = !!(AUTH.region && AUTH.region !== 'all');
    var showCollectionControls = admin && viewMode === 'collect';
    var uploadGated = shouldGateUpload();
    addRowBtn.hidden = !showCollectionControls;
    driveSyncBtn.hidden = !showCollectionControls;
    if(refreshChecklistBtn) refreshChecklistBtn.hidden = !showCollectionControls;
    // 범위 선택은 동기화 버튼 전용이라 버튼이 숨으면 같이 숨겨요.
    if(updateRangeInput) updateRangeInput.hidden = !showCollectionControls;
    if(changeLogBtn) changeLogBtn.hidden = !admin;
    if(navSettingsBtn) navSettingsBtn.hidden = !admin;
    if(navUsersBtn) navUsersBtn.hidden = !admin;
    if(navProgramBtn) navProgramBtn.hidden = !admin;
    // 권역 공유 계정이 아직 기업을 안 골랐으면(uploadGated), 엑셀 내보내기도 잠가둬요.
    // 안 그러면 고르기 전 상태에서 눌러서 권역 전체 데이터가 그대로 새어나갈 수 있어요.
    if(exportExcelBtn) exportExcelBtn.hidden = uploadGated;
    if(regionSidebarSection) regionSidebarSection.hidden = scopedRegion;
    roleBadge.hidden = false;
    roleBadge.textContent = roleLabel();
    logoutBtn.hidden = false;
  }

  // 매일 새벽 자동 동기화(또는 수동으로 누른 "드라이브에서 불러오기")가 마지막으로 언제,
  // 어떤 결과로 실행됐는지 관리자에게만 보여줘요. apps-script-code.gs의 setupDailySyncTrigger로
  // 자동 동기화를 걸어두면, 관리자가 버튼을 안 눌러도 이 문구가 매일 새벽 갱신돼요.
  function formatSyncTime(iso){
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '';
    var hh = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + hh + ':' + mi;
  }
  // setPage()에서만 호출돼요 — 페이지에 들어갈 때마다 항상 다시 그려서, 백그라운드 폴링이
  // 이 페이지를 건너뛰고 있었어도(성능 최적화) 진입 시점엔 최신 상태로 보이게 해요.
  function setViewMode(mode){
    viewMode = mode;
    applyRoleUI();
    renderTableHeader();
    renderTable();
    renderRowCountLabel();
  }

  function bindEvents(){
    if(navDashboardBtn) navDashboardBtn.addEventListener('click', function(){ setPage('dashboard'); });
    if(navCollectBtn) navCollectBtn.addEventListener('click', function(){ setPage('collect'); });
    if(navUploadBtn) navUploadBtn.addEventListener('click', function(){ setPage('upload'); });

    rowsBody.addEventListener('click', onTableClick);
    rowsBody.addEventListener('input', onTableInput);
    rowsBody.addEventListener('change', onTableChange);
    rowsBody.addEventListener('blur', onTableBlur, true);

    searchInput.addEventListener('input', function(){
      filters.q = searchInput.value.trim().toLowerCase();
      refreshFilteredViews();
    });
    regionNavEl.addEventListener('click', function(e){
      var btn = e.target.closest('.region-nav-item');
      if(!btn) return;
      filters.region = btn.getAttribute('data-region');
      refreshFilteredViews();
    });
    roundNavEl.addEventListener('click', function(e){
      var btn = e.target.closest('.region-nav-item');
      if(!btn) return;
      // 오픈예정 메시지는 이제 회차 번호를 안 가리고 renderRoundNav()가 선택된 회차의
      // 마스터 데이터(startDate)를 보고 알아서 보여줘요 — 여기선 필터만 바꾸면 돼요.
      filters.round = btn.getAttribute('data-round');
      refreshFilteredViews();
    });
    filterStatus.addEventListener('change', function(){
      filters.status = filterStatus.value;
      refreshFilteredViews();
    });
    filterFlag.addEventListener('change', function(){
      filters.flag = filterFlag.value;
      refreshFilteredViews();
    });

    addRowBtn.addEventListener('click', function(){
      if(!isAdmin()) return;
      var today = new Date().toISOString().slice(0,10);
      var lastRegion = STATE.rows.length ? STATE.rows[STATE.rows.length-1].region : '';
      var newRow = Object.assign(blankUploadFields(), {
        id: uid(), isExample:false, date: today,
        folderNc: String(STATE.rows.length + 1),
        region: lastRegion || '', company: '',
        sessions: timesArray(STATE.sessionCount, function(){ return false; }),
        plan:false, report:false, complete:false, flag:'none', remark:'', contactEmail:'', folderId:'',
        round: filters.round !== 'all' ? filters.round : DEFAULT_ROUND
      });
      STATE.rows.push(newRow);
      renderAll();
      scheduleSaveRow(newRow.id);
      requestAnimationFrame(function(){
        var trs = rowsBody.querySelectorAll('tr');
        var last = trs[trs.length - 1];
        if(last){ var inp = last.querySelector('.company-input'); if(inp) inp.focus(); }
      });
    });


    refreshBtn.addEventListener('click', function(){ pollOnce(true); });


    loginForm.addEventListener('submit', function(e){
      e.preventDefault();
      var u = loginUsername.value.trim();
      var p = loginPassword.value;
      if(!u || !p) return;
      attemptLogin(u, p);
    });

    logoutBtn.addEventListener('click', function(){
      var done = function(){ clearAuth(); location.reload(); };
      if(AUTH.t){ apiPost('logout').then(done, done); } else { done(); }
    });

    driveSyncBtn.addEventListener('click', function(){
      if(!isAdmin()) return;
      driveSyncBtn.disabled = true;
      var originalLabel = driveSyncBtn.textContent;
      // 사이드바에서 지금 보고 있는 회차만 동기화해요(전체 회차를 보고 있으면 등록된 회차
      // 전부) — 다른 회차(특히 기업 수가 훨씬 많은 회차)까지 매번 같이 훑지 않게 하기 위해서.
      var targetRound = filters.round;
      driveSyncBtn.textContent = '가져오는 중…';
      saveDot.className = 'save-dot syncing';
      saveText.textContent = (targetRound !== 'all' ? targetRound + ' ' : '') + '드라이브 확인 중…';
      console.log('[드라이브 연동] 요청 시작:', apiUrl, 'round=', targetRound);
      apiPost('syncFromDrive', { round: targetRound, range: getSelectedUpdateRange() })
        .then(function(data){
          console.log('[드라이브 연동] 응답:', data);
          if(data && data.error === 'auth'){
            clearAuth();
            AUTH.u = null; AUTH.p = null;
            showLoginScreen('로그인 정보가 만료됐어요. 다시 로그인해 주세요.');
            return;
          }
          var r = data && data.result;
          var msg;
          if(!r){
            msg = '드라이브 연동 응답을 확인할 수 없어요.';
          } else if(r.error){
            msg = '드라이브 연동 오류: ' + r.error;
          } else {
            msg = '폴더 ' + r.foldersScanned + '개 확인 · 기존 ' + r.matched + '개 업데이트 · 신규 ' + r.created + '개 추가' +
              (r.skipped ? ' · 이미 완료 ' + r.skipped + '개 건너뜀' : '');
            if(r.debug) msg += ' — ' + r.debug;
          }
          // pollOnce가 화면을 새로고침한 "뒤"에 결과 메시지를 표시해야
          // "동기화됨" 상태 문구에 곧바로 덮여쓰이지 않아요.
          return pollOnce(true).then(function(){ saveText.textContent = msg; });
        })
        .catch(function(err){
          console.error('[드라이브 연동] 실패:', err);
          saveDot.className = 'save-dot error';
          saveText.textContent = '드라이브 연동에 실패했어요 (' + err.message + '). 콘솔(F12)을 확인해 주세요.';
        })
        .finally(function(){
          driveSyncBtn.disabled = false;
          driveSyncBtn.textContent = originalLabel;
        });
    });

    // "취합현황 업데이트"는 새 기업을 찾으려고 폴더 트리를 다시 훑지 않고, 이미 아는
    // 기업들의 저장된 폴더에서 파일만 다시 확인해요 — 평소 반복 작업은 이쪽이 훨씬 빨라요.
    // 새 기업이 추가됐을 때만 위의 "드라이브에서 불러오기"를 쓰면 돼요.
    if(refreshChecklistBtn) refreshChecklistBtn.addEventListener('click', function(){
      if(!isAdmin()) return;
      refreshChecklistBtn.disabled = true;
      var originalLabel = refreshChecklistBtn.textContent;
      var targetRound = filters.round;
      refreshChecklistBtn.textContent = '업데이트 중…';
      saveDot.className = 'save-dot syncing';
      saveText.textContent = (targetRound !== 'all' ? targetRound + ' ' : '') + '취합현황 업데이트 중…';
      apiPost('refreshChecklist', { round: targetRound, range: getSelectedUpdateRange() })
        .then(function(data){
          if(data && data.error === 'auth'){
            clearAuth();
            AUTH.u = null; AUTH.p = null;
            showLoginScreen('로그인 정보가 만료됐어요. 다시 로그인해 주세요.');
            return;
          }
          var r = data && data.result;
          var msg;
          if(!r){
            msg = '취합현황 업데이트 응답을 확인할 수 없어요.';
          } else if(r.error){
            msg = '취합현황 업데이트 오류: ' + r.error;
          } else {
            msg = '확인 ' + r.checked + '개 · 갱신 ' + r.updated + '개' +
              (r.skipped ? ' · 이미 완료 ' + r.skipped + '개 건너뜀' : '');
            if(r.debug) msg += ' — ' + r.debug;
          }
          return pollOnce(true).then(function(){ saveText.textContent = msg; });
        })
        .catch(function(err){
          console.error('[취합현황 업데이트] 실패:', err);
          saveDot.className = 'save-dot error';
          saveText.textContent = '취합현황 업데이트에 실패했어요 (' + err.message + '). 콘솔(F12)을 확인해 주세요.';
        })
        .finally(function(){
          refreshChecklistBtn.disabled = false;
          refreshChecklistBtn.textContent = originalLabel;
        });
    });

    exportExcelBtn.addEventListener('click', function(){
      exportExcelBtn.disabled = true;
      var originalLabel = exportExcelBtn.textContent;
      exportExcelBtn.textContent = '만드는 중…';
      exportToExcel().finally(function(){
        exportExcelBtn.disabled = false;
        exportExcelBtn.textContent = originalLabel;
      });
    });

    if(navReportBtn) navReportBtn.addEventListener('click', function(){ setPage('report'); });
    if(exportReportBtn) exportReportBtn.addEventListener('click', function(){
      exportReportBtn.disabled = true;
      var originalLabel = exportReportBtn.textContent;
      exportReportBtn.textContent = '만드는 중…';
      exportReportToExcel().finally(function(){
        exportReportBtn.disabled = false;
        exportReportBtn.textContent = originalLabel;
      });
    });

    // 변경 이력 배너는 취합현황 툴바에 남아있는 유일한 토글형 배너예요(나머지 설정은
    // 이제 "설정" 페이지에 항상 보이는 카드로 옮겨서 토글이 필요 없어졌어요).
    if(changeLogBtn) changeLogBtn.addEventListener('click', function(){
      if(!isAdmin() || !changeLogBanner) return;
      changeLogBanner.hidden = !changeLogBanner.hidden;
      if(!changeLogBanner.hidden) fetchLog();
    });
    if(changeLogRefreshBtn) changeLogRefreshBtn.addEventListener('click', fetchLog);
    if(changeLogCloseBtn) changeLogCloseBtn.addEventListener('click', function(){
      if(changeLogBanner) changeLogBanner.hidden = true;
    });
    if(flagThresholdsSaveBtn) flagThresholdsSaveBtn.addEventListener('click', function(){
      if(!isAdmin()) return;
      var caution = parseInt(flagCautionInput.value, 10);
      var alertDays = parseInt(flagAlertInput.value, 10);
      var issue = parseInt(flagIssueInput.value, 10);
      if(!caution || !alertDays || !issue || caution < 1 || !(caution < alertDays && alertDays < issue)){
        alert('주의 < 경고 < 문제 순서로, 1 이상의 정수로 입력해주세요.');
        return;
      }
      flagThresholdsSaveBtn.disabled = true;
      apiPost('setFlagThresholds', { value:{ caution:caution, alert:alertDays, issue:issue } })
        .then(function(data){
          if(!data || data.ok === false){
            alert((data && data.message) || '지연 기준일 저장에 실패했어요.');
            return;
          }
          STATE.flagThresholds = data.flagThresholds;
          // 기준일이 바뀌면 모든 행의 이슈 표시가 다시 계산돼야 하니 새로고침해요
          // (회차 수 저장과 같은 패턴 — pollOnce가 normalizeRow를 다시 돌려요).
          return pollOnce(true);
        })
        .catch(function(err){
          console.error(err);
          alert('지연 기준일 저장 중 문제가 생겼어요.');
        })
        .finally(function(){
          flagThresholdsSaveBtn.disabled = false;
        });
    });
    if(sessionCountSaveBtn) sessionCountSaveBtn.addEventListener('click', function(){
      var n = parseInt(sessionCountInput.value, 10);
      if(!n || n < 1 || n > MAX_SESSIONS){
        alert('세션 수는 1~' + MAX_SESSIONS + ' 사이의 정수로 입력해주세요.');
        return;
      }
      sessionCountSaveBtn.disabled = true;
      var originalLabel = sessionCountSaveBtn.textContent;
      sessionCountSaveBtn.textContent = '저장 중…';
      apiPost('setSessionCount', { value:n })
        .then(function(data){
          if(!data || data.ok === false){
            alert((data && data.message) || '회차 수 저장에 실패했어요.');
            return;
          }
          // 서버에 바로 반영되니, 새 회차 수에 맞춰 데이터를 다시 불러와요
          // (pollOnce가 표 머리글·본문을 새 회차 수에 맞게 다시 그려줘요).
          return pollOnce(true);
        })
        .catch(function(err){
          console.error('[회차 설정] 실패:', err);
          alert('회차 수 저장 중 문제가 생겼어요. 콘솔(F12)을 확인해 주세요.');
        })
        .finally(function(){
          sessionCountSaveBtn.disabled = false;
          sessionCountSaveBtn.textContent = originalLabel;
        });
    });
    if(navSettingsBtn) navSettingsBtn.addEventListener('click', function(){ setPage('settings'); });
    if(navUsersBtn) navUsersBtn.addEventListener('click', function(){ setPage('users'); });
    if(usersListEl){
      usersListEl.addEventListener('click', function(e){
        var saveBtn = e.target.closest('.user-save-role-btn');
        if(saveBtn){
          var username = saveBtn.getAttribute('data-username');
          var li = saveBtn.closest('li');
          var role = li.querySelector('.user-role-select').value;
          var region = li.querySelector('.user-region-select').value;
          if(!confirm(username + ' 계정의 권한을 저장할까요?')) return;
          saveBtn.disabled = true;
          apiPost('updateUserRole', { username:username, role:role, region:region })
            .then(function(data){
              if(!data || data.ok === false){ alert((data && data.message) || '저장에 실패했어요.'); return; }
              renderUsersList(data.users || []);
            })
            .catch(function(err){ console.error('[사용자 권한] 저장 실패:', err); alert('저장 중 문제가 생겼어요.'); })
            .finally(function(){ saveBtn.disabled = false; });
          return;
        }
        var resetBtn = e.target.closest('.user-reset-pw-btn');
        if(resetBtn){
          var username2 = resetBtn.getAttribute('data-username');
          var newPw = prompt(username2 + ' 계정의 새 비밀번호를 입력해주세요(6자 이상).');
          if(newPw === null) return;
          if(newPw.length < 6){ alert('비밀번호는 6자 이상이어야 해요.'); return; }
          resetBtn.disabled = true;
          apiPost('resetUserPassword', { username:username2, password:newPw })
            .then(function(data){
              if(!data || data.ok === false){ alert((data && data.message) || '재설정에 실패했어요.'); return; }
              alert('비밀번호를 재설정했어요.');
            })
            .catch(function(err){ console.error('[사용자 권한] 재설정 실패:', err); alert('재설정 중 문제가 생겼어요.'); })
            .finally(function(){ resetBtn.disabled = false; });
          return;
        }
        var delBtn = e.target.closest('.user-delete-btn');
        if(delBtn){
          var username3 = delBtn.getAttribute('data-username');
          if(!confirm(username3 + ' 계정을 삭제할까요? 되돌릴 수 없어요.')) return;
          delBtn.disabled = true;
          apiPost('deleteUser', { username:username3 })
            .then(function(data){
              if(!data || data.ok === false){ alert((data && data.message) || '삭제에 실패했어요.'); return; }
              renderUsersList(data.users || []);
            })
            .catch(function(err){ console.error('[사용자 권한] 삭제 실패:', err); alert('삭제 중 문제가 생겼어요.'); })
            .finally(function(){ delBtn.disabled = false; });
        }
      });
    }
    if(addUserBtn) addUserBtn.addEventListener('click', function(){
      if(!isAdmin()) return;
      var username = (newUserUsernameInput.value || '').trim();
      var password = newUserPasswordInput.value || '';
      var role = newUserRoleInput.value;
      var region = newUserRegionInput.value;
      if(!username){ alert('아이디를 입력해주세요.'); return; }
      if(password.length < 6){ alert('비밀번호는 6자 이상이어야 해요.'); return; }
      addUserBtn.disabled = true;
      apiPost('addUser', { username:username, password:password, role:role, region:region })
        .then(function(data){
          if(!data || data.ok === false){ alert((data && data.message) || '추가에 실패했어요.'); return; }
          newUserUsernameInput.value = '';
          newUserPasswordInput.value = '';
          newUserRoleInput.value = 'viewer';
          newUserRegionInput.value = 'all';
          renderUsersList(data.users || []);
        })
        .catch(function(err){ console.error('[사용자 권한] 추가 실패:', err); alert('추가 중 문제가 생겼어요.'); })
        .finally(function(){ addUserBtn.disabled = false; });
    });


    if(navProgramBtn) navProgramBtn.addEventListener('click', function(){ setPage('program'); });
    if(roundsListEl){
      roundsListEl.addEventListener('click', function(e){
        var toggleBtn = e.target.closest('.round-toggle-btn');
        if(toggleBtn){
          var li = toggleBtn.closest('li');
          var detail = li.querySelector('.round-detail');
          if(detail) detail.hidden = !detail.hidden;
          return;
        }
        var saveBtn = e.target.closest('.round-save-btn');
        if(saveBtn){
          var id = saveBtn.getAttribute('data-id');
          var detailEl = saveBtn.closest('.round-detail');
          var round = {
            id: id,
            startDate: detailEl.querySelector('.round-field-startDate').value,
            endDate: detailEl.querySelector('.round-field-endDate').value,
            status: detailEl.querySelector('.round-field-status').value,
            description: detailEl.querySelector('.round-field-description').value,
            driveFolderId: detailEl.querySelector('.round-field-driveFolderId').value
          };
          var existing = STATE.rounds.find(function(r){ return r.id === id; });
          if(existing) round.name = existing.name;
          saveBtn.disabled = true;
          apiPost('upsertRound', { round:round })
            .then(function(data){
              if(!data || data.ok === false){ alert((data && data.message) || '저장에 실패했어요.'); return; }
              STATE.rounds = data.rounds || [];
              renderRoundsList();
              renderRoundNav();
              if(data.warning) alert(data.warning);
            })
            .catch(function(err){ console.error('[프로그램] 회차 저장 실패:', err); alert('저장 중 문제가 생겼어요.'); })
            .finally(function(){ saveBtn.disabled = false; });
          return;
        }
        var delBtn = e.target.closest('.round-delete-btn');
        if(delBtn){
          var delId = delBtn.getAttribute('data-id');
          if(!confirm('이 회차를 삭제할까요? 회차별 참여 기록(취합현황)은 그대로 남아요.')) return;
          delBtn.disabled = true;
          apiPost('deleteRound', { id:delId })
            .then(function(data){
              if(!data || data.ok === false){ alert((data && data.message) || '삭제에 실패했어요.'); return; }
              STATE.rounds = data.rounds || [];
              renderRoundsList();
              renderRoundNav();
            })
            .catch(function(err){ console.error('[프로그램] 회차 삭제 실패:', err); alert('삭제 중 문제가 생겼어요.'); })
            .finally(function(){ delBtn.disabled = false; });
        }
      });
    }
    if(addRoundBtn) addRoundBtn.addEventListener('click', function(){
      if(!isAdmin()) return;
      var name = (newRoundNameInput.value || '').trim();
      if(!name){ alert('회차 이름을 입력해주세요.'); return; }
      var round = {
        name: name,
        startDate: newRoundStartInput.value,
        endDate: newRoundEndInput.value,
        status: newRoundStatusInput.value,
        driveFolderId: newRoundDriveFolderInput.value
      };
      addRoundBtn.disabled = true;
      apiPost('upsertRound', { round:round })
        .then(function(data){
          if(!data || data.ok === false){ alert((data && data.message) || '추가에 실패했어요.'); return; }
          newRoundNameInput.value = '';
          newRoundStartInput.value = '';
          newRoundEndInput.value = '';
          newRoundStatusInput.value = 'recruiting';
          newRoundDriveFolderInput.value = '';
          STATE.rounds = data.rounds || [];
          renderRoundsList();
          renderRoundNav();
          if(data.warning) alert(data.warning);
        })
        .catch(function(err){ console.error('[프로그램] 회차 추가 실패:', err); alert('추가 중 문제가 생겼어요.'); })
        .finally(function(){ addRoundBtn.disabled = false; });
    });

    // ── 권역 공유 계정의 "기업 선택" 게이트 ──────────────────────────────
    var uploadCompanyInput = document.getElementById('upload-company-input');
    var uploadCompanyConfirmBtn = document.getElementById('upload-company-confirm-btn');
    var uploadCompanyErrorEl = document.getElementById('upload-company-error');
    var uploadCompanyBannerEl = document.getElementById('upload-company-banner');

    function confirmUploadCompany(){
      var typed = (uploadCompanyInput.value || '').trim();
      if(!typed) return;
      var match = STATE.rows.some(function(r){ return r.company === typed; });
      if(!match){
        if(uploadCompanyErrorEl){
          uploadCompanyErrorEl.hidden = false;
          uploadCompanyErrorEl.textContent = '목록에 있는 기업명과 정확히 일치해야 조회할 수 있어요. 자동완성 목록에서 골라주세요.';
        }
        return;
      }
      if(uploadCompanyErrorEl) uploadCompanyErrorEl.hidden = true;
      uploadCompanySelection = typed;
      saveUploadCompanySelection(typed);
      applyRoleUI();
      renderTable();
    }

    if(uploadCompanyConfirmBtn) uploadCompanyConfirmBtn.addEventListener('click', confirmUploadCompany);
    if(uploadCompanyInput) uploadCompanyInput.addEventListener('keydown', function(e){
      if(e.key === 'Enter'){ e.preventDefault(); confirmUploadCompany(); }
    });
    if(uploadCompanyBannerEl) uploadCompanyBannerEl.addEventListener('click', function(e){
      if(e.target.closest('#upload-company-switch-btn')){
        uploadCompanySelection = null;
        clearUploadCompanySelection();
        if(uploadCompanyInput) uploadCompanyInput.value = '';
        if(uploadCompanyErrorEl) uploadCompanyErrorEl.hidden = true;
        applyRoleUI();
        renderTable();
      }
    });
  }

  function init(){
    statsGrid = document.getElementById('stats-grid');
    quickPanelsEl = document.getElementById('quick-panels');
    rowsBody = document.getElementById('rows-body');
    tableHeadEl = document.getElementById('table-head');
    rowCountLabel = document.getElementById('row-count-label');
    searchInput = document.getElementById('search-input');
    regionNavEl = document.getElementById('region-nav');
    roundNavEl = document.getElementById('round-nav');
    stepMessageEl = document.getElementById('step-message');
    filterStatus = document.getElementById('filter-status');
    filterFlag = document.getElementById('filter-flag');
    addRowBtn = document.getElementById('add-row-btn');
    regionListEl = document.getElementById('region-list');
    saveDot = document.getElementById('save-dot');
    saveText = document.getElementById('save-text');
    refreshBtn = document.getElementById('refresh-btn');
    driveSyncBtn = document.getElementById('drive-sync-btn');
    refreshChecklistBtn = document.getElementById('refresh-checklist-btn');
    updateRangeInput = document.getElementById('update-range-input');
    exportExcelBtn = document.getElementById('export-excel-btn');
    sessionCountInput = document.getElementById('session-count-input');
    sessionCountSaveBtn = document.getElementById('session-count-save-btn');
    changeLogBtn = document.getElementById('change-log-btn');
    changeLogBanner = document.getElementById('change-log-banner');
    changeLogBody = document.getElementById('change-log-body');
    changeLogRefreshBtn = document.getElementById('change-log-refresh-btn');
    changeLogCloseBtn = document.getElementById('change-log-close-btn');
    flagCautionInput = document.getElementById('flag-caution-input');
    flagAlertInput = document.getElementById('flag-alert-input');
    flagIssueInput = document.getElementById('flag-issue-input');
    flagThresholdsSaveBtn = document.getElementById('flag-thresholds-save-btn');
    navSettingsBtn = document.getElementById('nav-settings');
    settingsViewEl = document.getElementById('settings-view');
    navUsersBtn = document.getElementById('nav-users');
    usersViewEl = document.getElementById('users-view');
    usersListEl = document.getElementById('users-list');
    newUserUsernameInput = document.getElementById('new-user-username-input');
    newUserPasswordInput = document.getElementById('new-user-password-input');
    newUserRoleInput = document.getElementById('new-user-role-input');
    newUserRegionInput = document.getElementById('new-user-region-input');
    addUserBtn = document.getElementById('add-user-btn');
    if(newUserRegionInput){
      newUserRegionInput.innerHTML = '<option value="all">전체</option>' +
        REGION_PRESETS.map(function(r){ return '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + '</option>'; }).join('');
    }
    navProgramBtn = document.getElementById('nav-program');
    programViewEl = document.getElementById('program-view');
    roundsListEl = document.getElementById('rounds-list');
    newRoundNameInput = document.getElementById('new-round-name-input');
    newRoundStartInput = document.getElementById('new-round-start-input');
    newRoundEndInput = document.getElementById('new-round-end-input');
    newRoundStatusInput = document.getElementById('new-round-status-input');
    newRoundDriveFolderInput = document.getElementById('new-round-drive-folder-input');
    addRoundBtn = document.getElementById('add-round-btn');
    navReportBtn = document.getElementById('nav-report');
    reportViewEl = document.getElementById('report-view');
    roundComparisonBodyEl = document.getElementById('round-comparison-body');
    regionComparisonBodyEl = document.getElementById('region-comparison-body');
    exportReportBtn = document.getElementById('export-report-btn');
    navDashboardBtn = document.getElementById('nav-dashboard');
    dashboardViewEl = document.getElementById('dashboard-view');
    navCollectBtn = document.getElementById('nav-collect');
    navUploadBtn = document.getElementById('nav-upload');
    tableViewEl = document.getElementById('table-view');
    if(sessionCountInput) sessionCountInput.max = String(MAX_SESSIONS);
    regionSidebarSection = document.getElementById('region-sidebar-section');
    loginScreen = document.getElementById('login-screen');
    loginForm = document.getElementById('login-form');
    loginUsername = document.getElementById('login-username');
    loginPassword = document.getElementById('login-password');
    loginError = document.getElementById('login-error');
    loginSubmit = document.getElementById('login-submit');
    roleBadge = document.getElementById('role-badge');
    logoutBtn = document.getElementById('logout-btn');

    apiUrl = resolveApiUrl();
    renderTableHeader();
    bindEvents();

    if(isPlaceholder(apiUrl)){
      setSyncStatus('setup-needed');
      return;
    }

    var stored = loadStoredAuth();
    if(stored && stored.u && stored.t){
      AUTH.u = stored.u; AUTH.t = stored.t;
      setSyncStatus('loading');
      fetchRows().then(function(rows){
        STATE.rows = rows;
        hideLoginScreen();
        setSyncStatus('synced');
        applyRoleUI();
        renderTableHeader();
        renderAll();
        startPolling();
      }).catch(function(err){
        console.error(err);
        clearAuth();
        AUTH.u = null; AUTH.p = null;
        showLoginScreen(err && err.isAuthError ? '로그인 정보가 만료됐어요. 다시 로그인해 주세요.' : null);
      });
    } else {
      showLoginScreen();
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
