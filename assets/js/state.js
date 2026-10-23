  // ── 1) 여기에 배포한 Google Apps Script 웹 앱 URL을 붙여넣으세요 ───────────
  var CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbzmSD2QakxiGd-nHGBwIiEu-bA0hLJv8dNC2MDEKXE_iMuZmfBZpwv_S6Zn70KYdhRc/exec',  
    POLL_INTERVAL_MS: 20000
  };
  // ─────────────────────────────────────────────────────────────────────

  var REGION_PRESETS = ['수도권','강원권','제주권'];
  var DEFAULT_ROUND = '1회차';
  // '2회차'는 더 이상 하드코딩된 기본값으로 자동 표시하지 않아요 — 이제 프로그램 탭에서
  // 회차를 직접 만들면(rounds 시트) STATE.rounds를 통해 사이드바에 나오게 됐으니까요
  // (renderRoundNav()가 STATE.rounds도 같이 합쳐서 목록을 만듦).
  var ROUND_PRESETS = ['1회차'];
  // "YYYY-MM-DD" 형태의 날짜 문자열을 "2026년 10월 15일" 식으로 보여줘요. 회차 시작일 등
  // 날짜 입력값을 사람이 읽기 좋은 문구로 바꿀 때 재사용해요.
  function formatOpenDateText(dateText){
    if(!dateText) return '추후';
    var match = /^\d{4}-\d{2}-\d{2}$/.exec(String(dateText));
    if(!match) return String(dateText);
    var parts = String(dateText).split('-');
    return parts[0] + '년 ' + Number(parts[1]) + '월 ' + Number(parts[2]) + '일';
  }
  // 회차(세션) 수는 이제 고정 6이 아니라 서버(apps-script-code.gs)가 알려주는 값을 따라가요.
  // MAX_SESSIONS는 서버 쪽 상한과 반드시 같은 값으로 맞춰야 해요 (설정 화면의 입력 상한으로도 써요).
  var MAX_SESSIONS = 12;
  // 업로드현황에서 체크하는 항목들. 취합현황의 1~N회차/계획서/보고서와 1:1로 대응돼요.
  function uploadFieldNames(count){
    var arr = [];
    for(var n=1; n<=count; n++) arr.push('upSession' + n);
    arr.push('upPlan', 'upReport');
    return arr;
  }
  function timesArray(n, fn){
    var arr = [];
    for(var i=0; i<n; i++) arr.push(fn(i));
    return arr;
  }
  var viewMode = 'collect'; // 'collect'(취합현황) | 'upload'(업로드현황)
  var currentPage = 'dashboard'; // 'dashboard' | 'sessions' — 사이드바 대시보드/세션 현황 전환

  var STATE = { rows: [], rounds: [], lastSync: null, sessionCount: 6, flagThresholds: { caution:3, alert:5, issue:7 }, dataVersion: null, driveJob: null };
  var filters = { q:'', region:'all', status:'all', flag:'all', round: DEFAULT_ROUND };
  var apiUrl = null;
  var pendingSaves = {};
  var inFlight = 0;
  var pendingDeleteId = null;
  var pendingDeleteTimer = null;

  // ── 로그인/권한 상태 ─────────────────────────────────────────────
  // 계정별 아이디·비밀번호·권한은 apps-script-code.gs의 USERS 목록에서 관리해요.
  // 여기서는 로그인 후 서버가 알려준 role('admin'|'viewer')과 region만 들고 있어요.
  // v2부터는 비밀번호가 아니라 로그인 토큰만 저장해요. 예전(v1)에 저장된 비밀번호는 지워요.
  var AUTH_STORAGE_KEY = 'mt_auth_v2';
  try{ localStorage.removeItem('mt_auth_v1'); }catch(e){}
  var AUTH = { u:null, p:null, t:null, role:null, region:null };
  var pollingStarted = false;

  var statsGrid, quickPanelsEl, rowsBody, tableHeadEl, rowCountLabel, searchInput, regionNavEl, roundNavEl, stepMessageEl, filterStatus, filterFlag,
      addRowBtn, regionListEl, saveDot, saveText, refreshBtn, driveSyncBtn, refreshChecklistBtn, updateRangeInput, regionSidebarSection, loginScreen, loginForm, loginUsername, loginPassword, loginError, loginSubmit,
      roleBadge, logoutBtn, exportExcelBtn, sessionCountInput,
      sessionCountSaveBtn,
      changeLogBtn, changeLogBanner, changeLogBody, changeLogRefreshBtn, changeLogCloseBtn,
      flagCautionInput, flagAlertInput, flagIssueInput, flagThresholdsSaveBtn,
      navDashboardBtn, dashboardViewEl, navCollectBtn, navUploadBtn, tableViewEl,
      navSettingsBtn, settingsViewEl,
      navUsersBtn, usersViewEl, usersListEl, newUserUsernameInput, newUserPasswordInput, newUserRoleInput, newUserRegionInput, addUserBtn,
      navProgramBtn, programViewEl, roundsListEl, newRoundNameInput, newRoundStartInput, newRoundEndInput, newRoundStatusInput, newRoundDriveFolderInput, addRoundBtn,
      navReportBtn, reportViewEl, roundComparisonBodyEl, regionComparisonBodyEl, exportReportBtn;

  function roleLabel(){
    if(AUTH.role === 'admin') return '관리자 계정';
    if(AUTH.region && AUTH.region !== 'all') return AUTH.region + ' 열람 계정';
    return '전체 열람 계정';
  }

  function isAdmin(){
    return AUTH.role === 'admin';
  }

  function loadStoredAuth(){
    try{
      var raw = localStorage.getItem(AUTH_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }
  function saveAuth(auth){
    try{ localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth)); }catch(e){}
  }
  function clearAuth(){
    AUTH.t = null; AUTH.p = null;
    // 다른 계정으로 다시 로그인했을 때 이전 계정의 "버전"으로 데이터가 그대로라고 착각하지 않게
    STATE.dataVersion = null;
    STATE.driveJob = null;
    try{ localStorage.removeItem(AUTH_STORAGE_KEY); }catch(e){}
  }

  // ── 권역 공유 계정에서 "내 기업"만 보게 좁혀주는 기능 ─────────────────────
  // 관리자·전체 열람(All_ai) 계정은 그대로 전체를 보고, 권역이 고정된 협력사
  // 계정(예: Sccei_ai)만 업로드현황 탭에서 기업명을 먼저 골라야 그 기업 한 곳만 보여요.
  // 같은 계정을 여러 기업이 나눠 쓰다 보니, 목록을 쭉 보여주면 실수로 다른 기업 칸을
  // 건드릴 위험이 있어서 아예 화면 자체를 좁혀버리는 방식이에요. 한 번 고른 기업명은
  // 이 브라우저·이 계정에 한해 기억해뒀다가 다음 접속 때 바로 보여줘요.
  var uploadCompanySelection = null;
  function isRegionScopedViewer(){ return !isAdmin() && !!(AUTH.region && AUTH.region !== 'all'); }
  function uploadCompanyStorageKey(){ return 'mt_upload_company_v1:' + (AUTH.u || ''); }
  function loadUploadCompanySelection(){
    try{ return localStorage.getItem(uploadCompanyStorageKey()) || null; }catch(e){ return null; }
  }
  function saveUploadCompanySelection(name){
    try{ localStorage.setItem(uploadCompanyStorageKey(), name); }catch(e){}
  }
  function clearUploadCompanySelection(){
    try{ localStorage.removeItem(uploadCompanyStorageKey()); }catch(e){}
  }

  function uid(){ return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  function blankUploadFields(){
    var obj = {};
    uploadFieldNames(STATE.sessionCount).forEach(function(f){ obj[f] = false; });
    return obj;
  }

  function toDateInputValue(v){
    // 백엔드나 캐시에서 어떤 형태로 오든 <input type="date">가 요구하는
    // "yyyy-MM-dd" 형태로 항상 맞춰줍니다 (예: ISO 타임스탬프가 섞여 와도 안전하게 처리).
    if(!v) return '';
    var s = String(v);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[1] + '-' + m[2] + '-' + m[3]) : '';
  }

  // 오늘 날짜 기준으로 협약일자(date)로부터 며칠이 지났는지 계산해요. 날짜가 없거나
  // 형식이 이상하면 null을 돌려줘서 "계산 불가" 상태를 구분해요.
  function daysSince(dateStr){
    if(!dateStr) return null;
    var start = new Date(dateStr + 'T00:00:00');
    if(isNaN(start.getTime())) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.floor((today - start) / 86400000);
  }

  // 이슈 표시는 이제 관리자가 직접 고르지 않고, 협약일자로부터 지난 일수를 기준으로
  // 자동으로 매겨요(기준일은 관리자가 설정 가능 — STATE.flagThresholds). 이미 완료된
  // 기업이거나 협약일자가 없어서 계산할 수 없는 기업은 정상으로 둬요.
  function computeAutoFlag(dateStr, complete){
    if(complete) return 'none';
    var days = daysSince(dateStr);
    if(days === null) return 'none';
    var t = STATE.flagThresholds;
    if(days >= t.issue) return 'issue';
    if(days >= t.alert) return 'alert';
    if(days >= t.caution) return 'caution';
    return 'none';
  }

  function normalizeRow(r){
    var n = STATE.sessionCount;
    var sessions = timesArray(n, function(i){ return !!(r.sessions && r.sessions[i]); });
    var plan = !!r.plan, report = !!r.report;
    var dateVal = toDateInputValue(r.date);
    // 완료는 저장된 값을 그대로 믿지 않고, 1~N회차·계획서·보고서가 전부 체크됐는지로
    // 매번 다시 계산해요. 이 값들은 이제 "드라이브에서 불러오기"로만 채워지니
    // 항상 정확하게 맞아떨어져요.
    var complete = sessions.every(Boolean) && plan && report;
    var normalized = {
      id: r.id, isExample: !!r.isExample,
      date: dateVal, folderNc: r.folderNc || '', region: r.region || '', company: r.company || '',
      sessions: sessions, plan: plan, report: report,
      complete: complete,
      flag: r.flagOverride ? r.flagOverride : computeAutoFlag(dateVal, complete),
      flagOverride: r.flagOverride || '',
      remark: r.remark || '', round: r.round || DEFAULT_ROUND,
      contactEmail: r.contactEmail || '', folderId: r.folderId || ''
    };
    // 업로드 체크 여부와 함께 체크일(…At, "YYYY-MM-DD")도 보관해야 새로고침 뒤에도
    // 자료 제출 표에 "09.30 등록"이 보여요. (예전엔 여기서 체크일을 버려서 클릭 직후에만 보였음)
    uploadFieldNames(n).forEach(function(f){
      normalized[f] = !!r[f];
      normalized[f + 'At'] = r[f + 'At'] || '';
    });
    return normalized;
  }

  function computeStats(rows){
    var total = rows.length;
    var completeCount = rows.filter(function(r){ return r.complete; }).length;
    var sessionTotal = total * STATE.sessionCount;
    var sessionChecked = rows.reduce(function(sum,r){ return sum + r.sessions.filter(Boolean).length; }, 0);
    var planCount = rows.filter(function(r){ return r.plan; }).length;
    var reportCount = rows.filter(function(r){ return r.report; }).length;
    var issueCount = rows.filter(function(r){ return r.flag === 'issue'; }).length;
    var alertCount = rows.filter(function(r){ return r.flag === 'alert'; }).length;
    var cautionCount = rows.filter(function(r){ return r.flag === 'caution'; }).length;
    var byRegion = {};
    rows.forEach(function(r){ var k = r.region || '미지정'; byRegion[k] = (byRegion[k] || 0) + 1; });
    return {
      total: total, completeCount: completeCount,
      completeRate: total ? Math.round(completeCount/total*100) : 0,
      sessionChecked: sessionChecked, sessionTotal: sessionTotal,
      sessionRate: sessionTotal ? Math.round(sessionChecked/sessionTotal*100) : 0,
      planCount: planCount, reportCount: reportCount,
      issueCount: issueCount, alertCount: alertCount, cautionCount: cautionCount, byRegion: byRegion
    };
  }
