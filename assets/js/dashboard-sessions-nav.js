  // ── 세션 현황 ────────────────────────────────────────────────────────
  // 회차별(1~N회차) 체크 완료율을 계산해요. 대시보드의 "회차 진행률"과 달리 여기는
  // 항상 matchesFilters()로 걸러진(사이드바 권역·회차 선택이 반영된) 행 기준이에요.
  function renderStats(){
    var s = computeStats(STATE.rows);
    var regionEntries = Object.keys(s.byRegion).map(function(k){ return [k, s.byRegion[k]]; });
    var regionChips = regionEntries.length
      ? regionEntries.map(function(e){ return '<span class="chip">' + escapeHtml(e[0]) + ' ' + e[1] + '</span>'; }).join('')
      : '<span class="chip muted">데이터 없음</span>';

    // 이슈 심각도 미터: 정상 비율은 total에서 나머지 세 상태를 뺀 값이에요 (computeStats가
    // 따로 안 돌려줘서 여기서만 파생시켜요 — 다른 로직에는 영향 없음).
    var normalCount = Math.max(0, s.total - s.issueCount - s.alertCount - s.cautionCount);
    var meterTotal = s.total || 1;
    var severityMeter = '<div class="severity-meter" title="정상 ' + normalCount + ' · 주의 ' + s.cautionCount + ' · 경고 ' + s.alertCount + ' · 문제 ' + s.issueCount + '">' +
      '<div class="severity-seg normal" style="width:' + (normalCount / meterTotal * 100) + '%"></div>' +
      '<div class="severity-seg caution" style="width:' + (s.cautionCount / meterTotal * 100) + '%"></div>' +
      '<div class="severity-seg alert" style="width:' + (s.alertCount / meterTotal * 100) + '%"></div>' +
      '<div class="severity-seg issue" style="width:' + (s.issueCount / meterTotal * 100) + '%"></div>' +
    '</div>';

    statsGrid.innerHTML =
      '<div class="stat-card"><div class="stat-label">전체 멘티기업</div><div class="stat-value">' + s.total + '<span class="stat-unit">개사</span></div></div>' +
      '<div class="stat-card"><div class="stat-label">완료</div><div class="stat-value">' + s.completeCount + '<span class="stat-unit">/ ' + s.total + '</span></div>' +
        '<div class="progress"><div class="progress-bar" style="width:' + s.completeRate + '%"></div></div></div>' +
      '<div class="stat-card"><div class="stat-label">회차 진행률</div><div class="stat-value">' + s.sessionRate + '<span class="stat-unit">%</span></div>' +
        '<div class="progress"><div class="progress-bar success" style="width:' + s.sessionRate + '%"></div></div></div>' +
      '<div class="stat-card"><div class="stat-label">서류 제출</div><div class="stat-value">' + s.planCount + '<span class="stat-unit">수행계획서</span></div>' +
        '<div class="stat-value small">' + s.reportCount + '<span class="stat-unit">결과보고서</span></div></div>' +
      '<div class="stat-card"><div class="stat-label">이슈 표시</div><div class="stat-value">' + s.issueCount + '<span class="stat-unit">문제</span></div>' +
        '<div class="stat-value small">' + s.alertCount + '<span class="stat-unit">경고</span> · ' + s.cautionCount + '<span class="stat-unit">주의</span></div>' + severityMeter + '</div>';
    // 권역별 기업 수는 아래 "권역별 평균 수행도" 그래프에 같이 보여줘요.
  }

  // "즉시 처리 필요"·"회차별 참여 현황" — 전부 STATE.rows에서 바로 계산하는 실데이터예요.
  // 새로 만든 값이 없어서 renderStats()의 computeStats()와는 별도로 여기서만 파생시켜요.
  function renderQuickPanels(){
    if(!quickPanelsEl) return;
    var rows = STATE.rows;
    var delayed = rows.filter(function(r){ return r.flag === 'alert' || r.flag === 'issue'; }).length;
    var missingDocs = rows.filter(function(r){ return !r.plan || !r.report; }).length;
    var missingDate = rows.filter(function(r){ return !r.date; }).length;
    var missingEmail = rows.filter(function(r){ return !r.contactEmail; }).length;

    var roundCounts = {};
    rows.forEach(function(r){ var k = r.round || DEFAULT_ROUND; roundCounts[k] = (roundCounts[k] || 0) + 1; });
    var roundKeys = Object.keys(roundCounts).sort();
    var roundItems = roundKeys.length
      ? roundKeys.map(function(k){
          var stepNum = String(k).replace(/[^0-9]/g, '');
          var label = stepNum ? 'Step ' + stepNum : k;
          return '<li class="side-item"><span>' + escapeHtml(label) + '</span><span class="chip">' + roundCounts[k] + '개사</span></li>';
        }).join('')
      : '<li class="side-item"><span>데이터 없음</span></li>';

    quickPanelsEl.innerHTML =
      '<div class="mini-card">' +
        '<h3>즉시 처리 필요</h3>' +
        '<ul class="side-list">' +
          '<li class="side-item"><span>지연 표시 기업(경고·문제)</span><span class="chip' + (delayed ? '' : ' muted') + '">' + delayed + '건</span></li>' +
          '<li class="side-item"><span>수행계획서·결과보고서 미제출</span><span class="chip' + (missingDocs ? '' : ' muted') + '">' + missingDocs + '건</span></li>' +
          '<li class="side-item"><span>협약일자 미설정</span><span class="chip' + (missingDate ? '' : ' muted') + '">' + missingDate + '건</span></li>' +
          '<li class="side-item"><span>담당자 이메일 미등록</span><span class="chip' + (missingEmail ? '' : ' muted') + '">' + missingEmail + '건</span></li>' +
        '</ul>' +
      '</div>' +
      '<div class="mini-card">' +
        '<h3>회차별 참여 현황</h3>' +
        '<ul class="side-list">' + roundItems + '</ul>' +
      '</div>';
  }

  // ── 보고서: 회차별·권역별 비교 ──────────────────────────────────────────
  // computeStats(rows)가 이미 범용이라(어떤 row 부분집합이든 받아 완료율·회차 진행률·서류
  // 제출·이슈 건수를 계산) 그룹별로 한 번씩 돌리기만 하면 돼요 — 새 집계 로직 불필요.
  function comparisonRowHTML(label, rows){
    var s = computeStats(rows);
    return '<tr>' +
      '<td>' + escapeHtml(label) + '</td>' +
      '<td>' + s.total + '개사</td>' +
      '<td>' + s.completeRate + '%</td>' +
      '<td>' + s.sessionRate + '%</td>' +
      '<td>' + s.planCount + '</td>' +
      '<td>' + s.reportCount + '</td>' +
      '<td>' + s.issueCount + '</td>' +
      '<td>' + s.alertCount + '</td>' +
      '<td>' + s.cautionCount + '</td>' +
    '</tr>';
  }

  // 회차별/권역별 비교는 사이드바에서 지금 어떤 필터가 선택돼있든 상관없이 항상 전체
  // 기준으로 계산해요 — 필터에 좌우되면 "비교"라는 목적 자체가 흐려지기 때문이에요.
  // 화면 렌더링과 엑셀 내보내기(table-view.js의 exportReportToExcel)가 같은 그룹핑을
  // 쓰도록 여기 한 곳에 모아뒀어요.
  function reportRoundGroups(){
    var usedRounds = [];
    STATE.rows.forEach(function(r){ var k = r.round || DEFAULT_ROUND; if(usedRounds.indexOf(k) === -1) usedRounds.push(k); });
    var allRounds = ROUND_PRESETS.slice();
    usedRounds.forEach(function(r){ if(allRounds.indexOf(r) === -1) allRounds.push(r); });
    STATE.rounds.forEach(function(r){ if(r.name && allRounds.indexOf(r.name) === -1) allRounds.push(r.name); });
    allRounds.sort();
    return allRounds.map(function(name){
      return { name: name, rows: STATE.rows.filter(function(r){ return (r.round || DEFAULT_ROUND) === name; }) };
    });
  }

  function reportRegionGroups(){
    var usedRegions = [];
    STATE.rows.forEach(function(r){ var k = r.region || '미지정'; if(usedRegions.indexOf(k) === -1) usedRegions.push(k); });
    var allRegions = REGION_PRESETS.slice();
    usedRegions.forEach(function(r){ if(allRegions.indexOf(r) === -1) allRegions.push(r); });
    return allRegions.map(function(name){
      return { name: name, rows: STATE.rows.filter(function(r){ return (r.region || '미지정') === name; }) };
    });
  }

  function renderReportView(){
    if(!roundComparisonBodyEl || !regionComparisonBodyEl) return;
    var roundGroups = reportRoundGroups();
    roundComparisonBodyEl.innerHTML = roundGroups.length
      ? roundGroups.map(function(g){ return comparisonRowHTML(g.name, g.rows); }).join('')
      : '<tr class="empty-row"><td colspan="9">표시할 회차가 없어요.</td></tr>';

    var regionGroups = reportRegionGroups();
    regionComparisonBodyEl.innerHTML = regionGroups.length
      ? regionGroups.map(function(g){ return comparisonRowHTML(g.name, g.rows); }).join('')
      : '<tr class="empty-row"><td colspan="9">표시할 권역이 없어요.</td></tr>';
  }

  function buildNavHTML(items, activeKey, dataAttr){
    return items.map(function(it){
      return '<button type="button" class="region-nav-item' + (it.key === activeKey ? ' active' : '') + '" data-' + dataAttr + '="' + escapeHtml(it.key) + '">' +
        '<span class="region-nav-name">' + escapeHtml(it.label) + '</span>' +
        '<span class="region-nav-count">' + it.count + '</span></button>';
    }).join('');
  }

  // 권역/회차 목록·유효성 검증을 각자 렌더 함수 안에만 두면, 한쪽이 먼저 실행될 때
  // 상대 필터가 아직 검증 전(=구식 값)인 상태로 카운트를 계산하게 돼요 — 예를 들어
  // renderRegionNav()가 matchesRound()로 권역별 개수를 셀 때, filters.round가 그 시점에
  // 아직 유효하지 않은 값이면 모든 권역이 0으로 잘못 계산된 채 그려지고, 그 다음에야
  // renderRoundNav()가 filters.round를 정상값으로 되돌려요(그마저도 한 렌더 늦게). 그래서
  // 두 렌더 함수 모두 시작할 때 "내 필터"뿐 아니라 "상대 필터"까지 같이 검증해요 — 어느
  // 쪽이 먼저 호출되든 카운트를 계산하는 시점엔 둘 다 이미 정상값이 되도록.
  function validateRegionFilter(){
    var used = [];
    STATE.rows.forEach(function(r){ var k = r.region || '미지정'; if(used.indexOf(k) === -1) used.push(k); });
    var all = REGION_PRESETS.slice();
    used.forEach(function(r){ if(r !== '미지정' && all.indexOf(r) === -1) all.push(r); });
    if(used.indexOf('미지정') !== -1) all.push('미지정');
    if(filters.region !== 'all' && all.indexOf(filters.region) === -1) filters.region = 'all';
    return all;
  }

  function validateRoundFilter(){
    var used = [];
    STATE.rows.forEach(function(r){ var k = r.round || DEFAULT_ROUND; if(used.indexOf(k) === -1) used.push(k); });
    var all = ROUND_PRESETS.slice();
    used.forEach(function(r){ if(all.indexOf(r) === -1) all.push(r); });
    // 회차 마스터(프로그램 탭에서 관리)에만 있고 아직 기업이 하나도 없는 회차도 미리 보이게 해요.
    STATE.rounds.forEach(function(r){ if(r.name && all.indexOf(r.name) === -1) all.push(r.name); });
    all.sort(); // "1회차","2회차"... 순서대로 (문자열 정렬이라 10회차 이상이면 따로 손봐야 할 수 있어요)
    if(filters.round !== 'all' && all.indexOf(filters.round) === -1) filters.round = 'all';
    return all;
  }

  function renderRegionNav(){
    validateRoundFilter();
    var all = validateRegionFilter();

    // 자동완성용 datalist에는 "미지정"은 굳이 안 넣어도 돼요 (직접 입력할 값이 아니라서).
    regionListEl.innerHTML = all.filter(function(r){ return r !== '미지정'; })
      .map(function(r){ return '<option value="' + escapeHtml(r) + '">'; }).join('');

    var current = filters.region;

    // 회차 필터·검색·상태·이슈 조건은 유지한 채, "권역"만 무시하고 센 개수예요
    // (다른 사이드바를 고를 때 이 목록의 개수도 같이 갱신되도록).
    var baseRows = STATE.rows.filter(function(r){ return matchesCommon(r) && matchesRound(r); });
    var counts = {};
    baseRows.forEach(function(r){ var k = r.region || '미지정'; counts[k] = (counts[k] || 0) + 1; });

    var items = [{ key:'all', label:'전체', count: baseRows.length }]
      .concat(all.map(function(r){ return { key:r, label:r, count: counts[r] || 0 }; }));
    regionNavEl.innerHTML = buildNavHTML(items, current, 'region');
  }

  function renderRoundNav(){
    validateRegionFilter();
    var all = validateRoundFilter();

    var current = filters.round;
    var baseRows = STATE.rows.filter(function(r){ return matchesCommon(r) && matchesRegion(r); });
    var counts = {};
    baseRows.forEach(function(r){ var k = r.round || DEFAULT_ROUND; counts[k] = (counts[k] || 0) + 1; });

    var items = [{ key:'all', label:'전체', count: baseRows.length }]
      .concat(all.map(function(r){
        var stepNum = String(r).replace(/[^0-9]/g, '');
        var label = stepNum ? 'Step ' + stepNum : r;
        return { key:r, label:label, count: counts[r] || 0 };
      }));
    roundNavEl.innerHTML = buildNavHTML(items, current, 'round');
    if(!stepMessageEl) return;
    // 선택된 회차의 마스터 데이터(프로그램 탭에서 등록)에 시작일이 있으면 오픈예정 메시지를
    // 보여줘요 — 예전엔 "회차 번호가 2일 때만" 하드코딩이었는데, 이제 회차 무관하게 다 됨.
    var roundInfo = current !== 'all' ? STATE.rounds.find(function(r){ return r.name === current; }) : null;
    if(roundInfo && roundInfo.startDate){
      stepMessageEl.textContent = current + '는 ' + formatOpenDateText(roundInfo.startDate) + '에 오픈예정입니다.';
      stepMessageEl.style.display = 'block';
    } else {
      stepMessageEl.textContent = '';
      stepMessageEl.style.display = 'none';
    }
  }
