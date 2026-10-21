  // ── 대시보드 그래프 ────────────────────────────────────────────────────
  // 숫자 카드만으로는 "어디가 막혀 있는지"가 한눈에 안 보여서, 세 가지를 그림으로 보여줘요.
  //  1) 회차·서류별 완료 기업 수 — 어느 회차에서 진행이 끊기는지
  //  2) 권역별 평균 수행도 — 어느 권역이 뒤처지는지
  //  3) 이슈 분포 — 정상/주의/경고/문제 비율
  // 라이브러리 없이 HTML 막대로 그려요(가볍고, 표 화면과 같은 글꼴·색 체계).

  var CHART_SERIES = '#2a78d6';
  var STATUS_COLORS = { none: '#0ca30c', caution: '#fab219', alert: '#ec835a', issue: '#d03b3b' };
  var STATUS_META = [
    { key: 'none', label: '정상', icon: '✓' },
    { key: 'caution', label: '주의', icon: '!' },
    { key: 'alert', label: '경고', icon: '!!' },
    { key: 'issue', label: '문제', icon: '✕' }
  ];

  function chartPct(n, d){ return d ? Math.round(n / d * 100) : 0; }

  function renderDashboardCharts(){
    var mount = document.getElementById('dashboard-charts');
    if(!mount) return;
    var rows = STATE.rows || [];
    var total = rows.length;
    if(!total){
      mount.innerHTML = '<div class="chart-card chart-wide"><div class="chart-empty">기업이 등록되면 그래프가 나타나요.</div></div>';
      return;
    }
    mount.innerHTML = sessionColumnsHTML(rows, total) + regionBarsHTML(rows) + issueStackHTML(rows, total);
  }

  // 1) 회차·서류별 완료 기업 수 (세로 막대, 전체 기업 수를 100%로)
  function sessionColumnsHTML(rows, total){
    var items = [];
    for(var i = 0; i < STATE.sessionCount; i++){
      var c = rows.filter(function(r){ return r.sessions && r.sessions[i]; }).length;
      items.push({ label: (i + 1) + '회차', short: (i + 1) + '회차', tiny: String(i + 1), count: c });
    }
    items.push({ label: '수행계획서', short: '계획서', tiny: '계획', count: rows.filter(function(r){ return r.plan; }).length, doc: true });
    items.push({ label: '결과보고서', short: '보고서', tiny: '보고', count: rows.filter(function(r){ return r.report; }).length, doc: true });

    var cols = items.map(function(it){
      var p = chartPct(it.count, total);
      var tip = it.label + ' 완료 ' + it.count + ' / ' + total + '개사 (' + p + '%)';
      return '<div class="col-item' + (it.doc ? ' is-doc' : '') + '" data-tip="' + escapeHtml(tip) + '" tabindex="0" aria-label="' + escapeHtml(tip) + '">' +
          '<div class="col-plot">' +
            '<span class="col-value" style="bottom:calc(' + p + '% + 4px)">' + it.count + '</span>' +
            '<div class="col-bar" style="height:' + Math.max(p, it.count ? 1 : 0) + '%;background:' + CHART_SERIES + '"></div>' +
          '</div>' +
          '<div class="col-label"><span class="lbl-long">' + escapeHtml(it.short) + '</span><span class="lbl-short">' + escapeHtml(it.tiny) + '</span></div>' +
        '</div>';
    }).join('');

    return '<div class="chart-card">' +
        '<div class="chart-head"><h3>회차·서류별 완료 기업</h3><span class="chart-sub">전체 ' + total + '개사 중 완료한 기업 수</span></div>' +
        '<div class="col-chart">' +
          '<div class="col-grid"><span style="bottom:100%">' + total + '</span><span style="bottom:50%">' + Math.round(total / 2) + '</span><span style="bottom:0">0</span></div>' +
          '<div class="col-items">' + cols + '</div>' +
        '</div>' +
      '</div>';
  }

  // 2) 권역별 평균 수행도 (가로 막대)
  function regionBarsHTML(rows){
    var groups = {};
    rows.forEach(function(r){
      var k = r.region || '미지정';
      if(!groups[k]) groups[k] = { n: 0, pctSum: 0, done: 0 };
      groups[k].n++;
      groups[k].pctSum += rowProgress(r).pct;
      if(r.complete) groups[k].done++;
    });
    // 기본 권역 순서를 지키고, 그 밖의 권역·미지정은 뒤에 붙여요(색·순서가 데이터에 따라 바뀌지 않게).
    var order = REGION_PRESETS.filter(function(k){ return groups[k]; })
      .concat(Object.keys(groups).filter(function(k){ return REGION_PRESETS.indexOf(k) === -1 && k !== '미지정'; }).sort())
      .concat(groups['미지정'] ? ['미지정'] : []);

    var bars = order.map(function(k){
      var g = groups[k];
      var avg = Math.round(g.pctSum / g.n);
      var tip = k + ' · 기업 ' + g.n + '개사 · 평균 수행도 ' + avg + '% · 전체 완료 ' + g.done + '개사';
      return '<div class="hbar-row" data-tip="' + escapeHtml(tip) + '" tabindex="0" aria-label="' + escapeHtml(tip) + '">' +
          '<div class="hbar-label">' + escapeHtml(k) + '<span class="hbar-n">' + g.n + '개사</span></div>' +
          '<div class="hbar-track"><div class="hbar-bar" style="width:' + Math.max(avg, 1) + '%;background:' + CHART_SERIES + '"></div></div>' +
          '<div class="hbar-value">' + avg + '%</div>' +
        '</div>';
    }).join('');

    return '<div class="chart-card">' +
        '<div class="chart-head"><h3>권역별 평균 수행도</h3><span class="chart-sub">회차 체크 기준, 기업별 수행도의 평균</span></div>' +
        '<div class="hbar-chart">' + bars + '</div>' +
      '</div>';
  }

  // 3) 이슈 분포 (100% 누적 막대 + 아이콘·라벨이 있는 범례)
  function issueStackHTML(rows, total){
    var counts = { none: 0, caution: 0, alert: 0, issue: 0 };
    rows.forEach(function(r){ var f = counts.hasOwnProperty(r.flag) ? r.flag : 'none'; counts[f]++; });
    var segs = STATUS_META.filter(function(m){ return counts[m.key]; }).map(function(m){
      var p = counts[m.key] / total * 100;
      var tip = m.label + ' ' + counts[m.key] + '개사 (' + Math.round(p) + '%)';
      return '<div class="stack-seg" style="flex:' + counts[m.key] + ' 1 0;background:' + STATUS_COLORS[m.key] + '" data-tip="' + escapeHtml(tip) + '" tabindex="0" aria-label="' + escapeHtml(tip) + '"></div>';
    }).join('');
    var legend = STATUS_META.map(function(m){
      return '<div class="legend-item">' +
          '<span class="legend-swatch" style="background:' + STATUS_COLORS[m.key] + '">' + m.icon + '</span>' +
          '<span class="legend-text">' + m.label + '</span>' +
          '<strong>' + counts[m.key] + '</strong><span class="legend-pct">' + chartPct(counts[m.key], total) + '%</span>' +
        '</div>';
    }).join('');
    var th = STATE.flagThresholds || {};
    return '<div class="chart-card chart-wide">' +
        '<div class="chart-head"><h3>이슈 분포</h3><span class="chart-sub">협약일 기준 지연 판정 · 주의 ' + (th.caution || '-') + '일 / 경고 ' + (th.alert || '-') + '일 / 문제 ' + (th.issue || '-') + '일</span></div>' +
        '<div class="stack-bar">' + segs + '</div>' +
        '<div class="chart-legend">' + legend + '</div>' +
      '</div>';
  }

  // 막대 위에 마우스를 올리면(또는 키보드로 포커스하면) 값을 보여주는 툴팁 하나를 같이 써요.
  function setupChartTooltip(){
    var mount = document.getElementById('dashboard-charts');
    if(!mount || mount.__tipBound) return;
    mount.__tipBound = true;
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
    function show(el, x, y){
      tip.textContent = el.getAttribute('data-tip');
      tip.hidden = false;
      var w = tip.offsetWidth, h = tip.offsetHeight;
      var left = Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8);
      var top = y - h - 12;
      if(top < 8) top = y + 16;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    mount.addEventListener('mousemove', function(e){
      var el = e.target.closest('[data-tip]');
      if(!el){ tip.hidden = true; return; }
      show(el, e.clientX, e.clientY);
    });
    mount.addEventListener('mouseleave', function(){ tip.hidden = true; });
    mount.addEventListener('focusin', function(e){
      var el = e.target.closest('[data-tip]');
      if(!el) return;
      var r = el.getBoundingClientRect();
      show(el, r.left + r.width / 2, r.top);
    });
    mount.addEventListener('focusout', function(){ tip.hidden = true; });
    window.addEventListener('scroll', function(){ tip.hidden = true; }, { passive: true });
  }
