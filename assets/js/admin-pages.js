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
      var name = escapeHtml(u.username);
      var regionLabel = (!u.region || u.region === 'all') ? '전체 권역' : escapeHtml(u.region);
      return '<li class="side-item ui-list-item">' +
        '<div class="ui-list-main">' +
          '<span class="ui-avatar" aria-hidden="true">' + escapeHtml(String(u.username || '?').charAt(0).toUpperCase()) + '</span>' +
          '<div class="ui-list-text">' +
            '<span class="ui-list-title">' + name +
              '<span class="chip' + (u.role === 'admin' ? '' : ' muted') + '">' + (u.role === 'admin' ? '관리자' : '열람') + '</span></span>' +
            '<span class="ui-list-sub">담당 ' + regionLabel + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="ui-list-actions">' +
          '<select class="compose-input user-role-select" data-username="' + name + '" aria-label="' + name + ' 권한">' + roleOptions + '</select>' +
          '<select class="compose-input user-region-select" data-username="' + name + '" aria-label="' + name + ' 담당 권역">' + regionOptions + '</select>' +
          '<button type="button" class="btn btn-ghost ui-btn-sm user-save-role-btn" data-ui-icon="check" data-username="' + name + '">저장</button>' +
          '<button type="button" class="btn btn-ghost ui-btn-sm user-reset-pw-btn" data-ui-icon="key" data-username="' + name + '">비밀번호 재설정</button>' +
          '<button type="button" class="btn btn-ghost ui-btn-sm ui-btn-destructive user-delete-btn" data-ui-icon="trash" data-username="' + name + '">삭제</button>' +
        '</div>' +
      '</li>';
    }).join('') : '<li class="side-item ui-list-empty"><span>계정이 없어요.</span></li>';
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
    var list = STATE.rounds.slice().sort(function(a,b){ return naturalCompare(a.name, b.name); });
    if(!list.length){
      roundsListEl.innerHTML = '<li class="side-item ui-list-empty"><span>등록된 회차가 없어요. 아래에서 회차를 추가해 주세요.</span></li>';
      return;
    }
    // 진행중=초록, 모집중=파랑, 종료=회색 배지
    var STATUS_CHIP = { ongoing: ' is-success', recruiting: '', closed: ' muted' };
    roundsListEl.innerHTML = list.map(function(r, idx){
      var status = r.status || 'recruiting';
      var id = escapeHtml(r.id);
      var fid = 'round-' + idx + '-'; // label for= 연결용 (회차 id에 특수문자가 있어도 안전하게 순번 사용)
      return '<li class="side-item round-item ui-list-item">' +
        '<div class="ui-list-main">' +
          '<span class="ui-avatar is-square" data-ui-icon="calendar" aria-hidden="true"></span>' +
          '<div class="ui-list-text">' +
            '<span class="ui-list-title">' + escapeHtml(r.name) +
              '<span class="chip' + (STATUS_CHIP[status] || '') + '">' + (ROUND_STATUS_LABELS[status] || status) + '</span></span>' +
            '<span class="ui-list-sub">' + escapeHtml(roundDateRangeLabel(r)) + (r.driveFolderId ? ' · 전용 폴더 연결됨' : '') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="ui-list-actions">' +
          '<button type="button" class="btn btn-ghost ui-btn-sm round-toggle-btn" data-ui-icon="pencil" data-id="' + id + '">상세</button>' +
          '<button type="button" class="btn btn-ghost ui-btn-sm ui-btn-destructive round-delete-btn" data-ui-icon="trash" data-id="' + id + '">삭제</button>' +
        '</div>' +
        '<div class="round-detail" data-id="' + id + '" hidden>' +
          '<div class="ui-form-grid">' +
            '<div class="ui-field"><label class="ui-label" for="' + fid + 'start">시작일</label>' +
              '<input class="compose-input round-field-startDate" id="' + fid + 'start" type="date" value="' + escapeHtml(r.startDate||'') + '"></div>' +
            '<div class="ui-field"><label class="ui-label" for="' + fid + 'end">종료일</label>' +
              '<input class="compose-input round-field-endDate" id="' + fid + 'end" type="date" value="' + escapeHtml(r.endDate||'') + '"></div>' +
            '<div class="ui-field"><label class="ui-label" for="' + fid + 'status">상태</label>' +
              '<select class="compose-input round-field-status" id="' + fid + 'status">' +
                Object.keys(ROUND_STATUS_LABELS).map(function(s){
                  return '<option value="' + s + '"' + (status === s ? ' selected' : '') + '>' + ROUND_STATUS_LABELS[s] + '</option>';
                }).join('') +
              '</select></div>' +
            '<div class="ui-field ui-field-wide"><label class="ui-label" for="' + fid + 'folder">드라이브 폴더 ID</label>' +
              '<input class="compose-input round-field-driveFolderId" id="' + fid + 'folder" type="text" value="' + escapeHtml(r.driveFolderId||'') + '" placeholder="이 회차 전용 폴더 ID"></div>' +
            '<div class="ui-field ui-field-full"><label class="ui-label" for="' + fid + 'desc">설명</label>' +
              '<textarea class="compose-textarea round-field-description" id="' + fid + 'desc">' + escapeHtml(r.description||'') + '</textarea></div>' +
          '</div>' +
          '<div class="round-detail-footer">' +
            '<button type="button" class="btn btn-primary ui-btn-sm round-save-btn" data-ui-icon="check" data-id="' + id + '">저장</button>' +
          '</div>' +
        '</div>' +
      '</li>';
    }).join('');
  }


  function renderProgramView(){
    if(!isAdmin()) return;
    renderRoundsList();
  }
