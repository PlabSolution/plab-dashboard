  function renderSettingsView(){
    if(!isAdmin()) return;
    if(sessionCountInput) sessionCountInput.value = STATE.sessionCount;
    if(flagCautionInput) flagCautionInput.value = STATE.flagThresholds.caution;
    if(flagAlertInput) flagAlertInput.value = STATE.flagThresholds.alert;
    if(flagIssueInput) flagIssueInput.value = STATE.flagThresholds.issue;
  }

  // ── 사용자 권한 ──────────────────────────────────────────────────────
  // 계정 목록은 STATE.rows처럼 상시 캐싱하지 않고, 이 페이지에 들어갈 때마다 서버에서
  // 새로 받아와요 — 계정 변경은 드물고 민감한 데이터라 다른 뷰처럼 폴링에 얹지 않아요.
  function renderUsersList(users){
    if(!usersListEl) return;
    usersListEl.innerHTML = users.length ? users.map(function(u){
      var roleOptions = ['viewer', 'admin'].map(function(r){
        return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + (r === 'admin' ? '관리자' : '열람') + '</option>';
      }).join('');
      var regionOptions = ['all'].concat(REGION_PRESETS).map(function(r){
        return '<option value="' + escapeHtml(r) + '"' + (u.region === r ? ' selected' : '') + '>' + (r === 'all' ? '전체' : escapeHtml(r)) + '</option>';
      }).join('');
      return '<li class="side-item" style="flex-wrap:wrap; gap:10px;">' +
        '<div style="display:flex; align-items:center; gap:10px; flex:1; min-width:160px;">' +
          '<span style="font-weight:700;">' + escapeHtml(u.username) + '</span>' +
          '<span class="chip' + (u.role === 'admin' ? '' : ' muted') + '">' + (u.role === 'admin' ? '관리자' : '열람') + '</span>' +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">' +
          '<select class="compose-input user-role-select" data-username="' + escapeHtml(u.username) + '" style="height:34px; width:90px; font-size:13px;">' + roleOptions + '</select>' +
          '<select class="compose-input user-region-select" data-username="' + escapeHtml(u.username) + '" style="height:34px; width:100px; font-size:13px;">' + regionOptions + '</select>' +
          '<button type="button" class="btn btn-ghost user-save-role-btn" data-username="' + escapeHtml(u.username) + '">저장</button>' +
          '<button type="button" class="btn btn-ghost user-reset-pw-btn" data-username="' + escapeHtml(u.username) + '">비밀번호 재설정</button>' +
          '<button type="button" class="btn btn-ghost user-delete-btn" data-username="' + escapeHtml(u.username) + '" style="color:var(--danger);">삭제</button>' +
        '</div>' +
      '</li>';
    }).join('') : '<li class="side-item"><span>계정이 없어요.</span></li>';
  }

  function fetchUsers(){
    if(!usersListEl || !apiUrl) return;
    usersListEl.innerHTML = '<li class="side-item"><span>불러오는 중…</span></li>';
    return apiGet('getUsers').then(function(data){
      if(!data || data.ok === false){
        usersListEl.innerHTML = '<li class="side-item"><span>' + escapeHtml((data && data.message) || '불러오지 못했어요.') + '</span></li>';
        return;
      }
      renderUsersList(data.users || []);
    }).catch(function(err){
      console.error('[사용자 권한] 목록 조회 실패:', err);
      usersListEl.innerHTML = '<li class="side-item"><span>불러오는 중 문제가 생겼어요.</span></li>';
    });
  }

  // ── 프로그램(회차 마스터) ──────────────────────────────
  // rounds는 fetchRows()의 기본 응답에 이미 실려서 STATE에 담겨있어요
  // (고객사/사용자 목록과 달리 민감한 정보가 아니라서 별도 admin 전용 조회 없이 모두에게
  // 내려옴) — 그래서 이 페이지는 진입할 때 새로 fetch하지 않고 STATE를 그대로 그려요.
  var ROUND_STATUS_LABELS = { recruiting: '모집중', ongoing: '진행중', closed: '종료' };

  function roundDateRangeLabel(r){
    if(!r.startDate && !r.endDate) return '일정 미정';
    return formatOpenDateText(r.startDate) + (r.endDate ? (' ~ ' + formatOpenDateText(r.endDate)) : '');
  }

  function renderRoundsList(){
    if(!roundsListEl) return;
    var list = STATE.rounds.slice().sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||'')); });
    if(!list.length){
      roundsListEl.innerHTML = '<li class="side-item"><span>등록된 회차가 없어요.</span></li>';
      return;
    }
    roundsListEl.innerHTML = list.map(function(r){
      var status = r.status || 'recruiting';
      return '<li class="side-item round-item" style="flex-direction:column; align-items:stretch; gap:10px;">' +
        '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
          '<span style="font-weight:700;">' + escapeHtml(r.name) + '</span>' +
          '<span class="chip' + (status === 'recruiting' ? '' : ' muted') + '">' + (ROUND_STATUS_LABELS[status] || status) + '</span>' +
          '<span style="color:var(--muted); font-size:13px;">' + escapeHtml(roundDateRangeLabel(r)) + '</span>' +
          '<div style="margin-left:auto; display:flex; gap:6px;">' +
            '<button type="button" class="btn btn-ghost round-toggle-btn" data-id="' + escapeHtml(r.id) + '">상세</button>' +
            '<button type="button" class="btn btn-ghost round-delete-btn" data-id="' + escapeHtml(r.id) + '" style="color:var(--danger);">삭제</button>' +
          '</div>' +
        '</div>' +
        '<div class="round-detail" data-id="' + escapeHtml(r.id) + '" hidden>' +
          '<div class="settings-actions" style="align-items:flex-end; flex-wrap:wrap; margin-bottom:10px;">' +
            '<label style="display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--muted);">시작일' +
              '<input class="compose-input round-field-startDate" type="date" value="' + escapeHtml(r.startDate||'') + '" style="height:34px; width:150px;"></label>' +
            '<label style="display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--muted);">종료일' +
              '<input class="compose-input round-field-endDate" type="date" value="' + escapeHtml(r.endDate||'') + '" style="height:34px; width:150px;"></label>' +
            '<label style="display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--muted);">상태' +
              '<select class="compose-input round-field-status" style="height:34px; width:100px;">' +
                Object.keys(ROUND_STATUS_LABELS).map(function(s){
                  return '<option value="' + s + '"' + (status === s ? ' selected' : '') + '>' + ROUND_STATUS_LABELS[s] + '</option>';
                }).join('') +
              '</select></label>' +
            '<label style="display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--muted);">드라이브 폴더 ID' +
              '<input class="compose-input round-field-driveFolderId" type="text" value="' + escapeHtml(r.driveFolderId||'') + '" placeholder="이 회차 전용 폴더 ID" style="height:34px; width:220px;"></label>' +
            '<button type="button" class="btn btn-primary round-save-btn" data-id="' + escapeHtml(r.id) + '">저장</button>' +
          '</div>' +
          '<label style="display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--muted);">설명' +
            '<textarea class="compose-textarea round-field-description" style="min-height:60px;">' + escapeHtml(r.description||'') + '</textarea></label>' +
        '</div>' +
      '</li>';
    }).join('');
  }


  function renderProgramView(){
    if(!isAdmin()) return;
    renderRoundsList();
  }
