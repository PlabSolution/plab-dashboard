  var sortState = { field: null, dir: 'asc' };

  function folderNcSortValue(v){
    var n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }

  function sortRows(rows){
    if(!sortState.field) return rows;
    var field = sortState.field;
    var dir = sortState.dir === 'desc' ? -1 : 1;
    var withIndex = rows.map(function(r, i){ return { r: r, i: i }; });
    withIndex.sort(function(a, b){
      var av = folderNcSortValue(a.r[field]);
      var bv = folderNcSortValue(b.r[field]);
      // 숫자로 못 읽는 값(빈 칸 등)은 항상 뒤로 보내요.
      if(av === null && bv === null) return a.i - b.i;
      if(av === null) return 1;
      if(bv === null) return -1;
      if(av !== bv) return (av - bv) * dir;
      return a.i - b.i;
    });
    return withIndex.map(function(x){ return x.r; });
  }

  function updateSortIndicator(){
    var indicator = document.getElementById('sort-indicator');
    if(!indicator) return;
    if(sortState.field !== 'folderNc'){ indicator.textContent = ''; return; }
    indicator.textContent = sortState.dir === 'desc' ? '▼' : '▲';
  }

  // 폴더NC 정렬 헤더는 탭을 바꿀 때마다 새로 그려지므로, 그릴 때마다 클릭 이벤트도 다시 걸어줘요.
  function bindSortHeader(){
    var th = document.getElementById('th-folder-nc');
    if(!th) return;
    th.addEventListener('click', function(){
      if(sortState.field === 'folderNc'){
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.field = 'folderNc';
        sortState.dir = 'asc';
      }
      updateSortIndicator();
      renderTable();
    });
  }

  var FOLDER_SORT_TH = '<th class="col-folder sortable-th" id="th-folder-nc" data-sort-field="folderNc">폴더NC<span class="sort-indicator" id="sort-indicator"></span></th>';

  function sessionHeaderCells(){
    var html = '';
    for(var i=1; i<=STATE.sessionCount; i++){
      html += '<th class="col-session">' + i + '회차</th>';
    }
    return html;
  }

  function renderTableHeader(){
    var headRow;
    if(viewMode === 'upload'){
      headRow =
        '<th class="col-date">협약일자</th>' + FOLDER_SORT_TH +
        '<th class="col-region">권역</th>' +
        '<th class="col-company sticky-col">멘티기업</th>' +
        sessionHeaderCells() +
        '<th class="col-doc">수행계획서</th>' +
        '<th class="col-doc">결과보고서</th>' +
        '<th class="col-complete">완료</th>';
    } else {
      headRow =
        '<th class="col-date">협약일자</th>' + FOLDER_SORT_TH +
        '<th class="col-region">권역</th>' +
        '<th class="col-company sticky-col">멘티기업</th>' +
        sessionHeaderCells() +
        '<th class="col-doc">수행계획서</th>' +
        '<th class="col-doc">결과보고서</th>' +
        '<th class="col-progress">수행도</th>' +
        '<th class="col-complete">완료</th>' +
        '<th class="col-flag">이슈</th>' +
        '<th class="col-remark">비고</th>' +
        '<th class="col-email">담당자 이메일</th>' +
        (isAdmin() ? '<th class="col-drive-link">폴더</th>' : '') +
        '<th class="col-actions"></th>';
    }
    tableHeadEl.innerHTML = '<tr>' + headRow + '</tr>';
    var mainTableEl = document.getElementById('main-table');
    if(mainTableEl) mainTableEl.classList.toggle('upload-view', viewMode === 'upload');
    bindSortHeader();
    updateSortIndicator();
  }

  function matchesCommon(r){
    if(filters.q && r.company.toLowerCase().indexOf(filters.q) === -1) return false;
    if(filters.status === 'done' && !r.complete) return false;
    if(filters.status === 'pending' && r.complete) return false;
    if(filters.flag !== 'all' && r.flag !== filters.flag) return false;
    return true;
  }

  function matchesRegion(r){
    return filters.region === 'all' || (r.region || '미지정') === filters.region;
  }

  function matchesRound(r){
    return filters.round === 'all' || (r.round || DEFAULT_ROUND) === filters.round;
  }

  function matchesFilters(r){
    return matchesCommon(r) && matchesRegion(r) && matchesRound(r);
  }

  function findRow(id){
    for(var i=0;i<STATE.rows.length;i++){ if(STATE.rows[i].id === id) return STATE.rows[i]; }
    return null;
  }

  function touchRow(row){ if(row.isExample) row.isExample = false; }

  // 1~N회차·계획서·보고서·완료는 "드라이브에서 불러오기"로만 채워지는 값이라
  // 관리자를 포함해 누구도 직접 클릭해서 바꿀 수 없어요. 상태만 보여주는 정적 표시예요.
  function autoCellHTML(checked, isComplete){
    return '<span class="toggle-view' + (isComplete ? ' complete' : '') + (checked ? ' on' : '') + '">' + (checked ? '✓' : '') + '</span>';
  }

  var FLAG_LABELS = { none:'정상', caution:'주의', alert:'경고', issue:'문제' };

  // 이슈 배지는 기본은 자동 계산이지만, 관리자는 flagOverride로 특정 기업의 상태를 직접
  // 고정할 수 있어요(협력사 계정은 여전히 읽기 전용). 마우스를 올리면 왜 이 상태인지 알 수
  // 있게 안내를 달아요.
  function flagTooltip(r){
    if(r.flagOverride) return '관리자가 직접 설정한 상태예요.';
    if(r.complete) return '완료된 기업이라 지연 계산을 하지 않아요.';
    var days = daysSince(r.date);
    if(days === null) return '협약일자가 설정되지 않아서 지연 계산을 할 수 없어요.';
    return '협약일자로부터 ' + days + '일 경과';
  }
  function flagCellHTML(r){
    var flag = r.flag || 'none';
    var label = FLAG_LABELS[flag] || '정상';
    var cls = 'flag-badge flag-' + flag + (r.flagOverride ? ' is-override' : '');
    if(!isAdmin()){
      return '<span class="' + cls + '" title="' + escapeHtml(flagTooltip(r)) + '">' + escapeHtml(label) + '</span>';
    }
    var options = [['', '자동'], ['none', '정상'], ['caution', '주의'], ['alert', '경고'], ['issue', '문제']];
    var optionsHtml = options.map(function(o){
      return '<option value="' + o[0] + '"' + (r.flagOverride === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
    return '<select class="' + cls + '" data-field="flagOverride" data-id="' + escapeHtml(r.id) + '" title="' + escapeHtml(flagTooltip(r)) + '">' + optionsHtml + '</select>';
  }

  function textCellHTML(opts){
    if(isAdmin()){
      return '<input class="cell-input' + (opts.extraClass ? ' ' + opts.extraClass : '') + '" type="' + opts.type + '"' +
        (opts.list ? ' list="' + opts.list + '"' : '') +
        (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') +
        ' data-field="' + opts.field + '" placeholder="' + escapeHtml(opts.placeholder || '') + '" title="' + escapeHtml(opts.value || '') + '" value="' + escapeHtml(opts.value || '') + '">';
    }
    return '<span class="readonly-text" title="' + escapeHtml(opts.value || '') + '">' + escapeHtml(opts.value || '') + '</span>';
  }

  function rowProgress(row){
    // 수행도는 계획서·보고서는 빼고, 1~N회차 체크 여부만으로 계산해요.
    var checked = row.sessions.filter(Boolean).length;
    var total = row.sessions.length || STATE.sessionCount;
    return { checked: checked, total: total, pct: total ? Math.round(checked/total*100) : 0 };
  }

  function gaugeHTML(row){
    var p = rowProgress(row);
    return '<div class="mini-gauge" title="' + p.checked + ' / ' + p.total + '">' +
      '<div class="mini-gauge-track"><div class="mini-gauge-bar" style="width:' + p.pct + '%"></div></div>' +
      '<span class="mini-gauge-label">' + p.pct + '%</span>' +
    '</div>';
  }

  function sessionCellsHTML(r){
    var html = '';
    for(var i=0; i<r.sessions.length; i++) html += '<td class="center">' + autoCellHTML(r.sessions[i]) + '</td>';
    return html;
  }

  // 드라이브 동기화로 자동 채워지는 값이라 직접 입력/수정은 못 해요. 관리자에게만 보여줘요
  // (권역 공유 계정은 내부 드라이브 폴더 접근 권한이 없어서, 링크를 눌러도 오류만 보게 되니까요).
  function folderLinkHTML(r){
    if(!r.folderId) return '<span class="folder-link-empty" title="드라이브에서 불러오기를 하면 자동으로 채워져요">-</span>';
    var url = 'https://drive.google.com/drive/folders/' + encodeURIComponent(r.folderId);
    return '<a class="folder-link" href="' + url + '" target="_blank" rel="noopener noreferrer" title="' +
      escapeHtml(r.company || '') + ' 드라이브 폴더 열기">📁</a>';
  }

  function renderRowHTML(r){
    var admin = isAdmin();
    return '' +
    '<tr data-id="' + r.id + '" class="flag-' + r.flag + '">' +
      '<td>' + textCellHTML({ type:'date', field:'date', value:r.date }) + '</td>' +
      '<td>' + textCellHTML({ type:'text', field:'folderNc', value:r.folderNc, extraClass:'cell-narrow', inputmode:'numeric' }) + '</td>' +
      '<td>' + textCellHTML({ type:'text', field:'region', value:r.region, placeholder:'권역', list:'region-list' }) + '</td>' +
      '<td class="sticky-col company-cell">' +
        textCellHTML({ type:'text', field:'company', value:r.company, placeholder:'기업명 입력', extraClass:'company-input' }) +
        (r.isExample ? '<span class="example-badge">예시</span>' : '') +
      '</td>' +
      sessionCellsHTML(r) +
      '<td class="center">' + autoCellHTML(r.plan) + '</td>' +
      '<td class="center">' + autoCellHTML(r.report) + '</td>' +
      '<td class="center">' + gaugeHTML(r) + '</td>' +
      '<td class="center">' + autoCellHTML(r.complete, true) + '</td>' +
      '<td class="center">' + flagCellHTML(r) + '</td>' +
      '<td>' + textCellHTML({ type:'text', field:'remark', value:r.remark, placeholder: r.date ? '메모' : '협약일자 설정X' }) + '</td>' +
      '<td>' + textCellHTML({ type:'email', field:'contactEmail', value:r.contactEmail, placeholder:'담당자 이메일' }) + '</td>' +
      (admin ? '<td class="center">' + folderLinkHTML(r) + '</td>' : '') +
      '<td class="center">' + (admin ? '<button type="button" class="delete-btn" data-action="delete">삭제</button>' : '') + '</td>' +
    '</tr>';
  }

  // 업로드현황 체크칸: 취합현황에 해당 항목 자료가 이미 올라와 있으면(available) 파란 테두리로
  // 눈에 띄게 표시해요. 관리자·협력사 계정 모두 클릭해서 체크/해제할 수 있어요.
  // 단, 취합현황에 자료가 없는(available=false) 항목은 아직 체크된 적이 없다면 클릭을 막아요
  // (이미 체크되어 있던 항목은, 취합현황이 나중에 되돌아가도 직접 해제는 할 수 있게 열어둬요).
  function uploadToggleHTML(id, field, checked, available){
    var clickable = available || checked;
    var cls = 'upload-toggle' + (available ? ' available' : '') + (checked ? ' on' : '') + (clickable ? '' : ' disabled');
    return '<button type="button" class="' + cls + '" data-upload-field="' + field + '" data-id="' + escapeHtml(id) + '"' +
      (clickable ? '' : ' disabled title="취합현황에 자료가 없어서 아직 체크할 수 없어요"') +
      ' aria-pressed="' + !!checked + '">' + (checked ? '✓' : '') + '</button>';
  }

  // 업로드현황의 1~N회차·계획서·보고서 칸 공통 정의예요. 화면 렌더링과 엑셀 내보내기가
  // 똑같은 기준(취합현황에 자료가 있는지=available, 업로드 체크가 됐는지=checked)을 쓰도록
  // 한 곳에 모아뒀어요.
  function uploadItemsForRow(r){
    var items = [];
    for(var i=0; i<r.sessions.length; i++){
      items.push({ field:'upSession'+(i+1), label:(i+1)+'회차', available:r.sessions[i], checked:r['upSession'+(i+1)], checkedAt:r['upSession'+(i+1)+'At'] });
    }
    items.push({ field:'upPlan', label:'수행계획서', available:r.plan, checked:r.upPlan, checkedAt:r.upPlanAt });
    items.push({ field:'upReport', label:'결과보고서', available:r.report, checked:r.upReport, checkedAt:r.upReportAt });
    return items;
  }

  // "2026-09-30" -> "09.30" — 표에 넣기엔 연도까지는 굳이 안 보여줘도 돼서 월.일만 남겨요.
  function shortCheckDate(v){
    if(!v) return '';
    var m = /^\d{4}-(\d{2})-(\d{2})/.exec(v);
    return m ? (m[1] + '.' + m[2]) : v;
  }

  function renderUploadRowHTML(r){
    var items = uploadItemsForRow(r);
    var uploadComplete = items.every(function(it){ return it.checked; });
    return '' +
    '<tr data-id="' + r.id + '">' +
      '<td data-label="협약일자"><span class="readonly-text">' + escapeHtml(r.date || '') + '</span></td>' +
      '<td data-label="폴더NC"><span class="readonly-text">' + escapeHtml(r.folderNc || '') + '</span></td>' +
      '<td data-label="권역"><span class="readonly-text">' + escapeHtml(r.region || '') + '</span></td>' +
      '<td class="sticky-col company-cell"><span class="readonly-text" title="' + escapeHtml(r.company || '') + '">' + escapeHtml(r.company || '') + '</span></td>' +
      items.map(function(it){
        var dateLabel = it.checked && it.checkedAt ? '<span class="upload-check-date">' + escapeHtml(shortCheckDate(it.checkedAt)) + ' 등록</span>' : '';
        return '<td class="center" data-label="' + escapeHtml(it.label) + '">' + uploadToggleHTML(r.id, it.field, it.checked, it.available) + dateLabel + '</td>';
      }).join('') +
      '<td class="center" data-label="완료">' + autoCellHTML(uploadComplete, true) + '</td>' +
    '</tr>';
  }

  // ── 엑셀(.xlsx) 내보내기 ────────────────────────────────────────────────
  // 지금 화면에 보이는 필터·정렬 상태 그대로, 취합현황/업로드현황 탭에 맞는 컬럼 구성으로
  // 서식(제목·헤더 색, 이슈별 행 색, 완료 표시)까지 갖춘 엑셀 파일을 만들어서 바로 내려받아요.
  var FLAG_FILL = {
    caution: 'FFF7E9D2', alert: 'FFF8E3CC', issue: 'FFF6DEDA'
  };
  var FLAG_FONT = {
    caution: 'FF8A631F', alert: 'FF8A4415', issue: 'FF8A3327'
  };

  function excelFilenamePart(s){
    return String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
  }

  function buildExportTitle(sheetLabel){
    var regionLabel = (filters.region === 'all' || !filters.region) ? '전체 권역' : filters.region;
    var roundLabel = (filters.round === 'all' || !filters.round) ? '전체 회차' : filters.round;
    var todayLabel = new Date().toISOString().slice(0, 10);
    return '멘토링 프로그램 ' + sheetLabel + ' — ' + regionLabel + ' · ' + roundLabel + ' (기준일: ' + todayLabel + ')';
  }

  function styleHeaderRow(row){
    row.eachCell(function(cell){
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B6777' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF1D4A56' } } };
    });
    row.height = 26;
  }

  // row.worksheet 같은 내부 참조에 기대지 않고, sheet를 직접 받아서 병합해요
  // (ExcelJS 내부 구현이 바뀌어도 안전하게 동작하도록).
  function styleTitleRow(sheet, span){
    var row = sheet.getRow(1);
    row.getCell(1).font = { bold: true, size: 13, color: { argb: 'FF1D4A56' } };
    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    row.height = 24;
    if(span > 1) sheet.mergeCells(1, 1, 1, span);
    return row;
  }

  function buildCollectSheet(workbook, rows){
    var n = STATE.sessionCount;
    var admin = isAdmin();
    var sheet = workbook.addWorksheet('취합현황', { views: [{ state: 'frozen', ySplit: 2 }] });
    var sessionColDefs = timesArray(n, function(i){ return { header: (i+1)+'회차', key: 's'+(i+1), width: 7 }; });
    var tailColDefs = [
      { header: '수행계획서', key: 'plan', width: 12 },
      { header: '결과보고서', key: 'report', width: 12 },
      { header: '수행도', key: 'progress', width: 9 },
      { header: '완료', key: 'complete', width: 8 },
      { header: '이슈', key: 'flag', width: 9 },
      { header: '비고', key: 'remark', width: 28 },
      { header: '담당자 이메일', key: 'contactEmail', width: 24 }
    ];
    // 드라이브 폴더 링크는 관리자 전용이에요 — 권역 공유 계정은 어차피 그 폴더에 접근 권한이
    // 없어서 링크를 눌러도 오류만 보게 되니, 그 계정이 내보낸 엑셀에는 아예 넣지 않아요.
    if(admin) tailColDefs.push({ header: '드라이브 폴더', key: 'folderLink', width: 14 });
    sheet.columns = [
      { header: '협약일자', key: 'date', width: 13 },
      { header: '폴더NC', key: 'folderNc', width: 9 },
      { header: '권역', key: 'region', width: 10 },
      { header: '멘티기업', key: 'company', width: 26 }
    ].concat(sessionColDefs, tailColDefs);
    var columnDefs = sheet.columns;
    var sessionKeys = sessionColDefs.map(function(c){ return c.key; });
    sheet.spliceRows(1, 0, []);
    styleTitleRow(sheet, columnDefs.length).getCell(1).value = buildExportTitle('취합현황');
    styleHeaderRow(sheet.getRow(2));
    var leftAlignKeys = { company: true, remark: true, contactEmail: true };

    rows.forEach(function(r){
      var progress = rowProgress(r);
      var values = {
        date: r.date || '', folderNc: r.folderNc || '', region: r.region || '', company: r.company || '',
        plan: r.plan ? '✓' : '', report: r.report ? '✓' : '',
        progress: progress.pct, complete: r.complete ? '✓' : '',
        flag: FLAG_LABELS[r.flag] || '정상', remark: r.remark || '', contactEmail: r.contactEmail || ''
      };
      sessionKeys.forEach(function(key, i){ values[key] = r.sessions[i] ? '✓' : ''; });
      var row = sheet.addRow(values);
      if(admin){
        var folderCell = row.getCell('folderLink');
        if(r.folderId){
          folderCell.value = { text: '열기', hyperlink: 'https://drive.google.com/drive/folders/' + r.folderId };
          folderCell.font = { color: { argb: 'FF1155CC' }, underline: true };
        } else {
          folderCell.value = '-';
        }
      }
      row.getCell('progress').numFmt = '0"%"';
      row.eachCell(function(cell, colNumber){
        var key = columnDefs[colNumber - 1] && columnDefs[colNumber - 1].key;
        cell.alignment = { vertical: 'middle', horizontal: leftAlignKeys[key] ? 'left' : 'center' };
      });
      sessionKeys.concat(['plan','report','complete']).forEach(function(key){
        if(row.getCell(key).value === '✓') row.getCell(key).font = { bold: true, color: { argb: 'FF2F8F5B' } };
      });
      if(FLAG_FILL[r.flag]){
        row.eachCell(function(cell){ cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FLAG_FILL[r.flag] } }; });
      }
      if(FLAG_FONT[r.flag]) row.getCell('flag').font = { bold: true, color: { argb: FLAG_FONT[r.flag] } };
      if(r.complete) row.getCell('complete').font = { bold: true, color: { argb: 'FF1D4A56' } };
    });

    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: sheet.columns.length } };
    return sheet;
  }

  function buildUploadSheet(workbook, rows){
    var n = STATE.sessionCount;
    var sheet = workbook.addWorksheet('업로드현황', { views: [{ state: 'frozen', ySplit: 2 }] });
    var sessionColDefs = timesArray(n, function(i){ return { header: (i+1)+'회차', key: 'u'+(i+1), width: 7 }; });
    sheet.columns = [
      { header: '협약일자', key: 'date', width: 13 },
      { header: '폴더NC', key: 'folderNc', width: 9 },
      { header: '권역', key: 'region', width: 10 },
      { header: '멘티기업', key: 'company', width: 26 }
    ].concat(sessionColDefs, [
      { header: '수행계획서', key: 'uPlan', width: 12 },
      { header: '결과보고서', key: 'uReport', width: 12 },
      { header: '완료', key: 'complete', width: 8 }
    ]);
    var columnDefs = sheet.columns;
    sheet.spliceRows(1, 0, []);
    styleTitleRow(sheet, columnDefs.length).getCell(1).value = buildExportTitle('업로드현황');
    styleHeaderRow(sheet.getRow(2));
    var leftAlignKeys = { company: true };

    var itemKeys = sessionColDefs.map(function(c){ return c.key; }).concat(['uPlan','uReport']);
    rows.forEach(function(r){
      var items = uploadItemsForRow(r);
      var uploadComplete = items.every(function(it){ return it.checked; });
      var values = { date: r.date || '', folderNc: r.folderNc || '', region: r.region || '', company: r.company || '', complete: uploadComplete ? '✓' : '' };
      items.forEach(function(it, i){ values[itemKeys[i]] = it.checked ? '✓' : (it.available ? '' : '—'); });
      var row = sheet.addRow(values);
      row.eachCell(function(cell, colNumber){
        var key = columnDefs[colNumber - 1] && columnDefs[colNumber - 1].key;
        cell.alignment = { vertical: 'middle', horizontal: leftAlignKeys[key] ? 'left' : 'center' };
      });
      items.forEach(function(it, i){
        var cell = row.getCell(itemKeys[i]);
        if(it.checked) cell.font = { bold: true, color: { argb: 'FF2F8F5B' } };
        else if(!it.available){ cell.font = { color: { argb: 'FFB0A99A' } }; }
        else { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEAEA' } }; }
      });
      if(uploadComplete) row.getCell('complete').font = { bold: true, color: { argb: 'FF1D4A56' } };
    });

    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: sheet.columns.length } };
    return sheet;
  }

  // ExcelJS는 꽤 무거운 라이브러리라서, 페이지를 열 때마다 미리 받아두지 않고 "엑셀로
  // 내보내기" 버튼을 실제로 눌렀을 때만 그때그때 불러와요 (그래야 대시보드 첫 로딩이
  // 느려지지 않아요). 한 번 불러온 뒤에는 다시 내려받지 않도록 캐시해둬요.
  var exceljsLoadPromise = null;
  function ensureExcelJSLoaded(){
    if(typeof ExcelJS !== 'undefined') return Promise.resolve();
    if(exceljsLoadPromise) return exceljsLoadPromise;
    exceljsLoadPromise = new Promise(function(resolve, reject){
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      script.onload = function(){ resolve(); };
      script.onerror = function(){
        exceljsLoadPromise = null;
        reject(new Error('엑셀 내보내기 기능을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해주세요.'));
      };
      document.head.appendChild(script);
    });
    return exceljsLoadPromise;
  }

  function exportToExcel(){
    return ensureExcelJSLoaded().then(function(){
      // visibleRows()를 그대로 써요 — 권역 공유 계정이 업로드현황에서 기업을 골라둔
      // 상태라면, 엑셀로도 그 기업 것만 나가야지 권역 전체가 새어나가면 안 되니까요.
      var rows = sortRows(visibleRows());
      var workbook = new ExcelJS.Workbook();
      workbook.creator = '멘토링 트래커';
      workbook.created = new Date();

      if(viewMode === 'upload') buildUploadSheet(workbook, rows);
      else buildCollectSheet(workbook, rows);

      var sheetLabel = viewMode === 'upload' ? '업로드현황' : '취합현황';
      var regionPart = excelFilenamePart((filters.region === 'all' || !filters.region) ? '전체권역' : filters.region);
      var roundPart = excelFilenamePart((filters.round === 'all' || !filters.round) ? '전체회차' : filters.round);
      var datePart = new Date().toISOString().slice(0,10).replace(/-/g, '');
      var filename = sheetLabel + '_' + regionPart + '_' + roundPart + '_' + datePart + '.xlsx';

      return workbook.xlsx.writeBuffer().then(function(buffer){
        var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
      });
    }).catch(function(err){
      console.error('[엑셀 내보내기] 실패:', err);
      alert(err && err.message ? err.message : '엑셀 파일을 만드는 중 문제가 생겼어요.');
    });
  }

  // ── 보고서(회차별·권역별 비교) 엑셀 내보내기 ─────────────────────────────
  // reportRoundGroups()/reportRegionGroups()(dashboard-sessions-nav.js)가 만든 그룹을
  // 화면 표와 똑같은 기준으로 시트 두 개에 담아요. 서식은 기존 엑셀 인프라
  // (styleTitleRow/styleHeaderRow) 그대로 재사용.
  var REPORT_COLUMN_DEFS = [
    { header: '이름', key: 'name', width: 14 },
    { header: '기업 수', key: 'total', width: 10 },
    { header: '완료율(%)', key: 'completeRate', width: 11 },
    { header: '회차 진행률(%)', key: 'sessionRate', width: 13 },
    { header: '수행계획서', key: 'planCount', width: 11 },
    { header: '결과보고서', key: 'reportCount', width: 11 },
    { header: '문제', key: 'issueCount', width: 8 },
    { header: '경고', key: 'alertCount', width: 8 },
    { header: '주의', key: 'cautionCount', width: 8 }
  ];

  function buildReportSheet(workbook, sheetName, titleLabel, groups){
    var sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 2 }] });
    sheet.columns = REPORT_COLUMN_DEFS;
    sheet.spliceRows(1, 0, []);
    styleTitleRow(sheet, REPORT_COLUMN_DEFS.length).getCell(1).value =
      titleLabel + ' (기준일: ' + new Date().toISOString().slice(0, 10) + ')';
    styleHeaderRow(sheet.getRow(2));
    groups.forEach(function(g){
      var s = computeStats(g.rows);
      sheet.addRow({
        name: g.name, total: s.total, completeRate: s.completeRate, sessionRate: s.sessionRate,
        planCount: s.planCount, reportCount: s.reportCount,
        issueCount: s.issueCount, alertCount: s.alertCount, cautionCount: s.cautionCount
      }).eachCell(function(cell, colNumber){
        cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'left' : 'center' };
      });
    });
    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: REPORT_COLUMN_DEFS.length } };
    return sheet;
  }

  function exportReportToExcel(){
    return ensureExcelJSLoaded().then(function(){
      var workbook = new ExcelJS.Workbook();
      workbook.creator = '멘토링 트래커';
      workbook.created = new Date();
      buildReportSheet(workbook, '회차별 비교', '멘토링 프로그램 회차별 비교', reportRoundGroups());
      buildReportSheet(workbook, '권역별 비교', '멘토링 프로그램 권역별 비교', reportRegionGroups());

      var datePart = new Date().toISOString().slice(0,10).replace(/-/g, '');
      var filename = '보고서_' + datePart + '.xlsx';

      return workbook.xlsx.writeBuffer().then(function(buffer){
        var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
      });
    }).catch(function(err){
      console.error('[보고서 내보내기] 실패:', err);
      alert(err && err.message ? err.message : '엑셀 파일을 만드는 중 문제가 생겼어요.');
    });
  }

  function shouldGateUpload(){
    return viewMode === 'upload' && isRegionScopedViewer() && !uploadCompanySelection;
  }

  function renderUploadCompanyList(){
    var listEl = document.getElementById('upload-company-list');
    if(!listEl) return;
    var names = [];
    STATE.rows.forEach(function(r){ if(r.company && names.indexOf(r.company) === -1) names.push(r.company); });
    names.sort();
    listEl.innerHTML = names.map(function(n){ return '<option value="' + escapeHtml(n) + '">'; }).join('');
  }

  function renderUploadCompanyBanner(){
    var banner = document.getElementById('upload-company-banner');
    if(!banner) return;
    var show = viewMode === 'upload' && isRegionScopedViewer() && !!uploadCompanySelection;
    banner.hidden = !show;
    if(show){
      banner.innerHTML = escapeHtml(uploadCompanySelection) + ' 기업의 업로드 현황이에요 · ' +
        '<button type="button" id="upload-company-switch-btn" style="background:none;border:none;padding:0;color:var(--accent);text-decoration:underline;cursor:pointer;font:inherit;">다른 기업 조회</button>';
    }
  }

  // "드라이브에서 불러오기"/"취합현황 업데이트"를 지금 선택된 회차의 폴더NC(번호) 범위로만
  // 돌릴 수 있게, 현재 회차에 실제로 있는 기업들의 번호 범위를 보고 100개씩 구간을 만들어요.
  // 기업 수가 많은 회차를 한 번에 다 처리하면 오래 걸리니, 나눠서 처리할 수 있게 하기 위함.
  function renderUpdateRangeOptions(){
    if(!updateRangeInput) return;
    var prevValue = updateRangeInput.value;
    var relevant = STATE.rows.filter(function(r){ return matchesRound(r); });
    var maxNc = 0;
    relevant.forEach(function(r){
      var n = parseInt(r.folderNc, 10);
      if(!isNaN(n) && n > maxNc) maxNc = n;
    });
    var BUCKET = 100;
    var values = ['all'];
    var html = ['<option value="all">전체 범위</option>'];
    for(var start = 1; start <= maxNc; start += BUCKET){
      var end = start + BUCKET - 1;
      var v = start + '-' + end;
      values.push(v);
      html.push('<option value="' + v + '">' + start + '~' + end + '</option>');
    }
    updateRangeInput.innerHTML = html.join('');
    if(values.indexOf(prevValue) !== -1) updateRangeInput.value = prevValue;
  }

  // update-range-input에서 고른 값을 { from, to } 형태로 바꿔요. "전체 범위"면 null
  // (=범위 제한 없음, 서버 쪽 inFolderNcRange가 null을 "전부 통과"로 처리해요).
  function getSelectedUpdateRange(){
    if(!updateRangeInput) return null;
    var v = updateRangeInput.value;
    if(!v || v === 'all') return null;
    var parts = v.split('-');
    return { from: parseInt(parts[0], 10), to: parseInt(parts[1], 10) };
  }

  function renderTable(){
    renderUpdateRangeOptions();
    var gate = shouldGateUpload();
    var gateEl = document.getElementById('upload-company-gate');
    var mainCardEl = document.getElementById('table-card-main');
    if(gateEl) gateEl.hidden = !gate;
    if(mainCardEl) mainCardEl.hidden = gate;
    renderUploadCompanyBanner();
    if(gate){
      renderUploadCompanyList();
      return;
    }

    var filtered = sortRows(visibleRows());
    var colCount = viewMode === 'upload' ? (7 + STATE.sessionCount) : (12 + STATE.sessionCount + (isAdmin() ? 1 : 0));
    if(filtered.length === 0){
      rowsBody.innerHTML = '<tr class="empty-row"><td colspan="' + colCount + '">' +
        (STATE.rows.length === 0
          ? '아직 등록된 멘티기업이 없어요. 아래 “+ 멘티기업 추가” 버튼으로 시작해 보세요.'
          : '조건에 맞는 멘티기업이 없어요.') +
        '</td></tr>';
      return;
    }
    rowsBody.innerHTML = filtered.map(viewMode === 'upload' ? renderUploadRowHTML : renderRowHTML).join('');
  }

  // 지금 화면에 실제로 보여줄 행들을 걸러내요. 권역 공유 계정이 업로드현황에서 기업을
  // 골랐으면 다른 필터와 무관하게 그 기업 한 곳만, 아니면 평소처럼 필터 조건대로 걸러요.
  function visibleRows(){
    if(viewMode === 'upload' && isRegionScopedViewer() && uploadCompanySelection){
      return STATE.rows.filter(function(r){ return r.company === uploadCompanySelection; });
    }
    return STATE.rows.filter(matchesFilters);
  }

  // "전체 N개사"는 시스템 전체가 아니라 지금 선택된 회차·권역 범위 안에서의 전체예요
  // (검색·상태·이슈 필터만 무시하고 셈) — 회차별로 데이터가 분리된 지금 구조에서
  // "전체"가 다른 회차 데이터까지 합친 숫자로 보이면 혼란스러우니까요.
  function renderRowCountLabel(){
    var scopedTotal = STATE.rows.filter(function(r){ return matchesRegion(r) && matchesRound(r); }).length;
    var shown = visibleRows().length;
    rowCountLabel.textContent = (shown === scopedTotal) ? ('전체 ' + scopedTotal + '개사') : (shown + '개 표시 중 · 전체 ' + scopedTotal + '개사');
  }

  function onTableClick(e){
    // 업로드현황 체크는 관리자·협력사 계정 모두 가능해서, "관리자만" 가드보다 먼저 처리해요.
    var uploadBtn = e.target.closest('.upload-toggle');
    if(uploadBtn){
      // 취합현황에 자료가 없어서 막아둔 칸은 (이론상 disabled 속성 덕에 여기까지 오지 않지만) 한 번 더 막아요.
      if(uploadBtn.disabled || uploadBtn.classList.contains('disabled')) return;
      var uid2 = uploadBtn.getAttribute('data-id');
      var field = uploadBtn.getAttribute('data-upload-field');
      var newVal = !uploadBtn.classList.contains('on');
      uploadBtn.classList.toggle('on', newVal);
      uploadBtn.textContent = newVal ? '✓' : '';
      uploadBtn.setAttribute('aria-pressed', newVal);
      // 체크 버튼은 전체 다시 그리기 없이 DOM을 직접 바꾸는 낙관적 업데이트라, 체크일
      // 표시(.upload-check-date)도 renderUploadRowHTML을 다시 타지 않고 여기서 같이
      // 넣거나 지워줘야 화면에 바로 보여요.
      var atField = field + 'At';
      var todayStr = new Date().toISOString().slice(0, 10);
      var dateEl = uploadBtn.parentElement ? uploadBtn.parentElement.querySelector('.upload-check-date') : null;
      if(newVal){
        if(!dateEl){
          dateEl = document.createElement('span');
          dateEl.className = 'upload-check-date';
          if(uploadBtn.parentElement) uploadBtn.parentElement.appendChild(dateEl);
        }
        dateEl.textContent = shortCheckDate(todayStr) + ' 등록';
      } else if(dateEl){
        dateEl.remove();
      }
      var uploadRow = findRow(uid2);
      if(uploadRow){
        uploadRow[field] = newVal;
        uploadRow[atField] = newVal ? todayStr : '';
      }
      saveUploadField(uid2, field, newVal);
      return;
    }
    if(!isAdmin()) return;
    var delBtn = e.target.closest('[data-action="delete"]');
    if(delBtn){
      var trd = e.target.closest('tr');
      var id = trd.getAttribute('data-id');
      if(pendingDeleteId === id){
        clearTimeout(pendingDeleteTimer);
        var wasExample = STATE.rows.some(function(r){ return r.id === id && r.isExample; });
        STATE.rows = STATE.rows.filter(function(r){ return r.id !== id; });
        pendingDeleteId = null;
        renderAll();
        if(!wasExample) deleteRowRemote(id);
      } else {
        pendingDeleteId = id;
        delBtn.textContent = '정말 삭제?';
        delBtn.classList.add('confirm');
        clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = setTimeout(function(){
          pendingDeleteId = null;
          delBtn.textContent = '삭제';
          delBtn.classList.remove('confirm');
        }, 3500);
      }
    }
  }

  function onTableInput(e){
    if(!isAdmin()) return;
    var field = e.target.getAttribute('data-field');
    if(!field) return;
    if(field === 'company' || field === 'folderNc' || field === 'remark' || field === 'region' || field === 'contactEmail'){
      var tr = e.target.closest('tr');
      var row = findRow(tr.getAttribute('data-id'));
      if(!row) return;
      touchRow(row);
      row[field] = e.target.value;
      scheduleSaveRow(row.id);
    }
  }

  function onTableChange(e){
    if(!isAdmin()) return;
    var field = e.target.getAttribute('data-field');
    if(!field) return;
    var tr = e.target.closest('tr');
    var row = findRow(tr.getAttribute('data-id'));
    if(!row) return;
    touchRow(row);
    if(field === 'date'){
      row.date = e.target.value;
      // 협약일자가 바뀌면 이슈 표시(주의/경고/문제)도 그 즉시 다시 계산해서 보여줘요 —
      // 단, 관리자가 flagOverride로 고정해뒀으면 날짜가 바뀌어도 그 값을 그대로 유지해요.
      row.flag = row.flagOverride || computeAutoFlag(row.date, row.complete);
      tr.className = 'flag-' + row.flag;
      var flagBadge = tr.querySelector('.flag-badge');
      if(flagBadge){
        flagBadge.className = 'flag-badge flag-' + row.flag + (row.flagOverride ? ' is-override' : '');
        flagBadge.title = flagTooltip(row);
        if(flagBadge.tagName !== 'SELECT') flagBadge.textContent = FLAG_LABELS[row.flag] || '정상';
      }
      var remarkInput = tr.querySelector('[data-field="remark"]');
      if(remarkInput) remarkInput.placeholder = row.date ? '메모' : '협약일자 설정X';
      renderStats();
    }
    if(field === 'flagOverride'){
      // ''(자동)을 고르면 다시 날짜 기준 자동 계산으로 돌아가요.
      row.flagOverride = e.target.value;
      row.flag = row.flagOverride || computeAutoFlag(row.date, row.complete);
      tr.className = 'flag-' + row.flag;
      e.target.className = 'flag-badge flag-' + row.flag + (row.flagOverride ? ' is-override' : '');
      e.target.title = flagTooltip(row);
      renderStats();
    }
    scheduleSaveRow(row.id);
  }

  function onTableBlur(e){
    var field = e.target.getAttribute && e.target.getAttribute('data-field');
    if(field === 'region'){
      renderRegionNav();
      renderRoundNav();
      renderStats();
      renderRowCountLabel();
    }
  }

  // 검색/권역/회차/상태/이슈 필터가 바뀔 때 공통으로 다시 그려야 하는 것들 — 사이드바
  // 내비는 항상 그리고, 테이블/세션현황은 지금 보이는 페이지일 때만(renderAll()과 같은 이유).
  function refreshFilteredViews(){
    renderRegionNav();
    renderRoundNav();
    if(currentPage === 'collect' || currentPage === 'upload'){
      renderTable();
      renderRowCountLabel();
    }
  }
