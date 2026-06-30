// ─────────────────────────────────────────────────────────────
//  인생 타임라인 · 100년 인생 캘린더
//  순수 HTML/CSS/JavaScript · 의존성 없음
//  좌측: 인생 격자(한 칸 = 한 주, 가로 폭 고정 · 세로 스크롤)
//  중앙: 선택한 주의 7일 달력 + 일정
// ─────────────────────────────────────────────────────────────
'use strict';

(function () {
  // ===== 상수 =====
  const STORAGE_KEY = 'life-timeline-v1';
  const WEEKS_PER_YEAR = 52;
  const MS_PER_DAY = 86400000;
  const MS_PER_WEEK = MS_PER_DAY * 7;
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  // 격자 여백 / 칸 크기 (캔버스 CSS 픽셀 기준)
  const MARGIN_L = 24; // 좌측 나이 라벨
  const MARGIN_T = 10;
  const CELL = 20;          // 칸 한 변 (고정 20px)
  const GAP = 5;            // 칸 간격
  const PITCH = CELL + GAP; // 칸 피치

  const COLOR = {
    past: '#2b2d31',
    now: '#4f46e5',
    future: '#e1e1e6',
    futureFill: '#f4f4f6',
    label: '#b3b3ba',
  };
  const EVENT_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#4f46e5', '#ec4899'];

  // ===== 상태 =====
  let state = loadState();
  let lifespanYears = state.lifespan || 90;
  let selectedWeek = null;
  let pickedColor = EVENT_COLORS[3];
  let hoverWeek = null;
  let weekDates = [];     // 현재 선택 주의 7일 ISO
  let dayCols = [];       // 본문 배경 컬럼 엘리먼트 (드롭 하이라이트용)
  let lastTouchedId = null; // 방금 추가/이동한 일정 id (젤리 애니메이션 대상)
  let drag = null;          // 진행 중인 커스텀 드래그 상태
  let lastHoverCol = -1;    // 드롭 하이라이트 중인 칸
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 막대 레이아웃 상수
  const LANE_H = 28, LANE_GAP = 6, BODY_PAD = 10;
  const map = { cols: 1, height: 0 }; // 동적 레이아웃 값 (한 줄당 칸 수 / 전체 높이)

  // ===== DOM =====
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  const els = {
    progressPct: $('progressPct'),
    progressMeta: $('progressMeta'),
    progressFill: $('progressFill'),
    upcomingList: $('upcomingList'),
    selTitle: $('selTitle'),
    selRange: $('selRange'),
    weekDays: $('weekDays'),
    weekBody: $('weekBody'),
    weekPrev: $('weekPrev'),
    weekNext: $('weekNext'),
    weekCurrentLabel: $('weekCurrentLabel'),
    composeTitle: $('composeTitle'),
    composeChip: $('composeChip'),
    evSwatches: $('evSwatches'),
    prevWeek: $('prevWeek'),
    nextWeek: $('nextWeek'),
    btnToday: $('btnToday'),
    btnSettings: $('btnSettings'),
    modal: $('modal'),
    modalTitle: $('modalTitle'),
    modalCancel: $('modalCancel'),
    modalSave: $('modalSave'),
    setBirth: $('setBirth'),
    setLifespan: $('setLifespan'),
    mapWrap: document.querySelector('.map-wrap'),
  };

  // ===== 저장/로드 =====
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 무시 */ }
    return { birth: null, lifespan: 90, events: [] };
  }
  function saveState() {
    state.lifespan = lifespanYears;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* 무시 */ }
  }

  // ===== 날짜 유틸 =====
  function parseDate(str) {
    if (!str) return null;
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function fmtK(date) {
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
  }
  function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
  function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }

  function birthDate() { return parseDate(state.birth); }
  function weekStartDate(weekIndex) { return addDays(birthDate(), weekIndex * 7); }
  function dateToWeek(date) {
    const b = birthDate();
    if (!b) return null;
    return Math.floor((startOfDay(date) - startOfDay(b)) / MS_PER_WEEK);
  }
  function daysSinceBirth() {
    return Math.floor((startOfDay(new Date()) - startOfDay(birthDate())) / MS_PER_DAY);
  }
  function totalWeeks() { return lifespanYears * WEEKS_PER_YEAR; }
  function livedWeeks() { return Math.max(0, dateToWeek(new Date())); }
  function clampWeek(w) { return Math.max(0, Math.min(totalWeeks() - 1, w)); }
  function currentWeek() { return clampWeek(livedWeeks()); }

  // ===== 격자 레이아웃 (가로 폭에 맞추고 세로로 길게) =====
  function cellOrigin(weekIndex) {
    const row = Math.floor(weekIndex / map.cols);
    const col = weekIndex % map.cols;
    return { x: MARGIN_L + col * PITCH, y: MARGIN_T + row * PITCH };
  }

  function layout() {
    if (!els.mapWrap) return;
    // 세로 스크롤바를 먼저 띄워 실제 사용 가능한 가로 폭을 측정
    canvas.style.height = '40000px';
    const cssW = canvas.clientWidth;
    if (cssW <= 0) return;

    // 가로 폭은 그대로 둔 채, 20px 칸이 폭에 맞게 줄바꿈 → 행이 늘어 세로로 길어짐
    map.cols = Math.max(1, Math.floor((cssW - MARGIN_L - 4) / PITCH));

    const rows = Math.ceil(totalWeeks() / map.cols);
    map.height = MARGIN_T + rows * PITCH + 8;
    canvas.style.height = map.height + 'px';

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(map.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  // ===== 격자 렌더링 =====
  function render() {
    const W = canvas.clientWidth;
    ctx.clearRect(0, 0, W, map.height);
    if (!state.birth) return;

    const total = totalWeeks();
    const nowWeek = currentWeek();
    const cell = CELL;
    const r = Math.max(0.5, cell * 0.22);

    // 이벤트가 있는 주
    const eventWeeks = {};
    for (const ev of state.events) {
      const d = parseDate(ev.date);
      const w = d ? dateToWeek(d) : null;
      if (w != null && w >= 0 && w < total) (eventWeeks[w] = eventWeeks[w] || []).push(ev);
    }

    for (let w = 0; w < total; w++) {
      const o = cellOrigin(w);
      const isNow = w === nowWeek;
      const isPast = w < nowWeek;

      ctx.beginPath();
      roundRect(ctx, o.x, o.y, cell, cell, r);
      if (isPast) { ctx.fillStyle = COLOR.past; ctx.fill(); }
      else if (isNow) { ctx.fillStyle = COLOR.now; ctx.fill(); }
      else {
        ctx.fillStyle = COLOR.futureFill; ctx.fill();
        ctx.lineWidth = 0.5; ctx.strokeStyle = COLOR.future; ctx.stroke();
      }

      if (w === selectedWeek || w === hoverWeek) {
        ctx.lineWidth = Math.max(1.2, cell * 0.16);
        ctx.strokeStyle = COLOR.now; ctx.stroke();
      }
      if (eventWeeks[w] && cell > 4) {
        ctx.beginPath();
        ctx.arc(o.x + cell / 2, o.y + cell / 2, Math.max(1, cell * 0.2), 0, Math.PI * 2);
        ctx.fillStyle = isPast ? '#ffffff' : eventWeeks[w][0].color;
        ctx.fill();
      }
    }

    // 나이 라벨 (10년 단위) — 해당 나이가 시작되는 줄의 왼쪽에 표시
    ctx.fillStyle = COLOR.label;
    ctx.font = `10px ${getFont()}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let yr = 0; yr <= lifespanYears; yr += 10) {
      const wk = yr * WEEKS_PER_YEAR;
      if (wk > total) break;
      const o = cellOrigin(wk);
      ctx.fillText(`${yr}`, MARGIN_L - 6, o.y + cell / 2);
    }
  }

  function getFont() {
    return '-apple-system, "Segoe UI", "Noto Sans KR", "Malgun Gothic", sans-serif';
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 캔버스 좌표 (스크롤 반영: getBoundingClientRect 는 스크롤에 따라 이동)
  function localXY(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function weekAtLocal(lx, ly) {
    const col = Math.floor((lx - MARGIN_L) / PITCH);
    const row = Math.floor((ly - MARGIN_T) / PITCH);
    if (col < 0 || col >= map.cols || row < 0) return null;
    const inX = (lx - MARGIN_L) - col * PITCH;
    const inY = (ly - MARGIN_T) - row * PITCH;
    if (inX > CELL || inY > CELL) return null;
    const w = row * map.cols + col;
    return (w >= 0 && w < totalWeeks()) ? w : null;
  }
  function scrollMapToWeek(weekIndex) {
    if (!els.mapWrap) return;
    const o = cellOrigin(weekIndex);
    const target = o.y - els.mapWrap.clientHeight / 2;
    els.mapWrap.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  // ===== 진척도 =====
  function updateProgress() {
    if (!state.birth) {
      els.progressPct.textContent = '0%';
      els.progressMeta.textContent = '생년월일을 설정해 주세요';
      els.progressFill.style.width = '0%';
      return;
    }
    const total = totalWeeks();
    const lived = Math.min(livedWeeks(), total);
    const pct = (lived / total) * 100;
    const age = Math.floor(lived / WEEKS_PER_YEAR);
    els.progressPct.textContent = pct.toFixed(1) + '%';
    els.progressMeta.textContent =
      `만 ${age}세 · ${daysSinceBirth().toLocaleString()}일 · ${lived.toLocaleString()}/${total.toLocaleString()}주`;
    els.progressFill.style.width = Math.min(100, pct) + '%';
  }

  // ===== 중앙 주간 달력 =====
  function setWeek(weekIndex) {
    selectedWeek = clampWeek(weekIndex);
    renderWeekView();
    render();
  }

  function renderWeekView() {
    if (selectedWeek == null || !state.birth) return;
    const start = weekStartDate(selectedWeek);
    const end = addDays(start, 6);
    const intlAge = Math.floor(selectedWeek / WEEKS_PER_YEAR);            // 만 나이
    const koreanAge = start.getFullYear() - birthDate().getFullYear() + 1; // 한국 세는 나이
    const wk = (selectedWeek % WEEKS_PER_YEAR) + 1;

    els.selTitle.textContent = `${koreanAge}세 (만 ${intlAge}세) · ${wk}주차`;
    els.selRange.textContent = `${fmtK(start)} ~ ${fmtK(end)}`;

    // 이번주(가운데) 강조 라벨
    const isCurrent = selectedWeek === currentWeek();
    els.weekCurrentLabel.innerHTML =
      `<span class="cur-dot"></span>` +
      `<span class="cur-kind">${isCurrent ? '이번주' : '선택한 주'}</span>` +
      `<span class="cur-range">${start.getMonth() + 1}/${start.getDate()} ~ ${end.getMonth() + 1}/${end.getDate()}</span>`;

    // 현재 주 (편집 가능)
    const main = buildWeekInto(els.weekDays, els.weekBody, selectedWeek,
      { interactive: true, laneH: LANE_H, pad: BODY_PAD, gap: LANE_GAP, showDday: true });
    weekDates = main.weekDates;
    dayCols = main.dayCols;

    // 전주(윗줄) · 다음주(밑줄) 미리보기
    renderMini(els.weekPrev, selectedWeek - 1, '전주');
    renderMini(els.weekNext, selectedWeek + 1, '다음주');

    lastTouchedId = null; // 일회성 애니메이션이므로 소비 후 초기화
  }

  // 주어진 days/body 엘리먼트에 한 주를 그린다 (현재 주·미리보기 공용)
  function buildWeekInto(daysEl, bodyEl, weekIndex, opts) {
    opts = opts || {};
    const laneH = opts.laneH || LANE_H;
    const pad = opts.pad != null ? opts.pad : BODY_PAD;
    const gap = opts.gap != null ? opts.gap : LANE_GAP;
    const compact = !!opts.compact;
    const start = weekStartDate(weekIndex);
    const todayISO = toISO(startOfDay(new Date()));

    daysEl.innerHTML = '';
    bodyEl.innerHTML = '';
    const wDates = [];
    const cols = [];

    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const iso = toISO(d);
      wDates.push(iso);
      const dow = d.getDay();
      const isToday = iso === todayISO;

      const head = document.createElement('div');
      head.className = 'day-col-head';
      if (isToday) head.classList.add('today');
      if (dow === 0 || dow === 6) head.classList.add('weekend');
      head.innerHTML =
        `<div class="dow">${DOW[dow]}</div><div class="dnum">${d.getMonth() + 1}/${d.getDate()}</div>` +
        (isToday && opts.showDday ? `<div class="dday-badge">D-DAY · D+${daysSinceBirth().toLocaleString()}</div>` : '');
      daysEl.appendChild(head);

      const col = document.createElement('div');
      col.className = 'day-col';
      if (isToday) col.classList.add('today');
      bodyEl.appendChild(col);
      cols.push(col);
    }

    // 연속 같은 일정 → 막대(run) + 레인 배치
    const runs = buildRuns(wDates);
    runs.sort((a, b) => a.start - b.start || a.end - b.end);
    const laneEnds = [];
    for (const r of runs) {
      let lane = laneEnds.findIndex((e) => e < r.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(r.end); }
      else laneEnds[lane] = r.end;
      r.lane = lane;
    }
    const lanes = laneEnds.length;
    const emptyH = compact ? 30 : 96;
    bodyEl.style.height = (lanes > 0 ? pad * 2 + lanes * laneH + (lanes - 1) * gap : emptyH) + 'px';

    const layer = document.createElement('div');
    layer.className = 'bars-layer';
    if (runs.length === 0 && !compact) {
      const hint = document.createElement('div');
      hint.className = 'week-empty-hint';
      hint.textContent = '아래에서 일정을 만들어 날짜 칸으로 드래그하세요';
      layer.appendChild(hint);
    }
    for (const r of runs) layer.appendChild(buildBar(r, { interactive: opts.interactive, laneH, pad, gap }));
    bodyEl.appendChild(layer);

    return { weekDates: wDates, dayCols: cols };
  }

  // 전주/다음주 컴팩트 미리보기 (클릭하면 그 주로 이동)
  function renderMini(container, weekIndex, label) {
    container.innerHTML = '';
    if (weekIndex < 0 || weekIndex >= totalWeeks()) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');

    const start = weekStartDate(weekIndex);
    const end = addDays(start, 6);
    const lab = document.createElement('div');
    lab.className = 'mini-label';
    lab.innerHTML =
      `<span class="mini-kind">${label}</span>` +
      `<span class="mini-range">${start.getMonth() + 1}/${start.getDate()} ~ ${end.getMonth() + 1}/${end.getDate()}</span>` +
      `<span class="mini-go">이 주 보기 →</span>`;
    container.appendChild(lab);

    const cal = document.createElement('div');
    cal.className = 'week-cal mini';
    const days = document.createElement('div'); days.className = 'week-days';
    const body = document.createElement('div'); body.className = 'week-body';
    cal.appendChild(days); cal.appendChild(body);
    container.appendChild(cal);

    buildWeekInto(days, body, weekIndex, { interactive: false, compact: true, laneH: 16, pad: 6, gap: 4 });

    container.onclick = () => { setWeek(weekIndex); scrollMapToWeek(weekIndex); };
  }

  // 주간 이벤트를 (제목+색) 기준으로 묶고 연속된 날을 run 으로 병합
  function buildRuns(weekISO) {
    const byKey = new Map();
    weekISO.forEach((iso, day) => {
      state.events.filter((e) => e.date === iso).forEach((e) => {
        const key = e.title + '\u001f' + e.color;
        if (!byKey.has(key)) byKey.set(key, { title: e.title, color: e.color, days: new Map() });
        const dm = byKey.get(key).days;
        if (!dm.has(day)) dm.set(day, []);
        dm.get(day).push(e.id);
      });
    });
    const runs = [];
    for (const g of byKey.values()) {
      const idx = [...g.days.keys()].sort((a, b) => a - b);
      let i = 0;
      while (i < idx.length) {
        let j = i;
        while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
        const ids = [];
        for (let k = i; k <= j; k++) ids.push(...g.days.get(idx[k]));
        runs.push({ title: g.title, color: g.color, start: idx[i], end: idx[j], ids });
        i = j + 1;
      }
    }
    return runs;
  }

  function buildBar(r, o) {
    o = o || {};
    const laneH = o.laneH || LANE_H;
    const pad = o.pad != null ? o.pad : BODY_PAD;
    const gap = o.gap != null ? o.gap : LANE_GAP;
    const len = r.end - r.start + 1;

    const bar = document.createElement('div');
    bar.className = 'ev-bar';
    bar.style.background = r.color;
    bar.style.left = `calc(${(r.start / 7) * 100}% + 4px)`;
    bar.style.width = `calc(${(len / 7) * 100}% - 8px)`;
    bar.style.top = (pad + r.lane * (laneH + gap)) + 'px';
    bar.style.height = laneH + 'px';

    const title = document.createElement('span');
    title.className = 'bar-title';
    title.textContent = r.title;
    bar.appendChild(title);

    if (!o.interactive) { bar.style.cursor = 'pointer'; return bar; } // 미리보기: 읽기 전용

    // 방금 추가/이동된 일정이면 젤리처럼 정착하는 애니메이션
    if (lastTouchedId && r.ids.includes(lastTouchedId)) {
      bar.classList.add('jelly-settle');
      bar.addEventListener('animationend', () => bar.classList.remove('jelly-settle'), { once: true });
    }

    const del = document.createElement('button');
    del.className = 'bar-del'; del.textContent = '✕'; del.title = '삭제';
    del.addEventListener('click', (e) => { e.stopPropagation(); removeEvents(r.ids); });
    bar.appendChild(del);

    // 단일 날짜·단일 일정 막대만 드래그로 이동 가능
    if (len === 1 && r.ids.length === 1) {
      bar.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.bar-del')) return; // 삭제 버튼은 제외
        beginDrag(e, { type: 'move', id: r.ids[0], title: r.title, color: r.color }, bar);
      });
    } else {
      bar.style.cursor = 'default';
    }
    return bar;
  }

  // ===== 일정 CRUD =====
  function addEvent(dateISO, title, color) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    state.events.push({ id, date: dateISO, title, color });
    lastTouchedId = id; // 젤리 정착 애니메이션 대상
    saveState();
    renderWeekView();
    renderUpcoming();
    render();
  }
  function removeEvent(id) {
    state.events = state.events.filter((x) => x.id !== id);
    saveState();
    renderWeekView();
    renderUpcoming();
    render();
  }
  function removeEvents(ids) {
    const set = new Set(ids);
    state.events = state.events.filter((x) => !set.has(x.id));
    saveState();
    renderWeekView();
    renderUpcoming();
    render();
  }
  function moveEvent(id, dateISO) {
    const ev = state.events.find((x) => x.id === id);
    if (!ev || ev.date === dateISO) return;
    ev.date = dateISO;
    lastTouchedId = id; // 젤리 정착 애니메이션 대상
    saveState();
    renderWeekView();
    renderUpcoming();
    render();
  }

  // 집어 들 때 한 번 출렁이는 젤리 효과
  function jellyPick(el) {
    el.classList.remove('jelly-pick');
    void el.offsetWidth; // 리플로우로 애니메이션 재시작 보장
    el.classList.add('jelly-pick');
    el.addEventListener('animationend', () => el.classList.remove('jelly-pick'), { once: true });
  }

  // ===== 커스텀 포인터 드래그 (드는 동안 젤리처럼 출렁) =====
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function bodyColAt(clientX) {
    const rect = els.weekBody.getBoundingClientRect();
    return { rect, col: clamp(Math.floor((clientX - rect.left) / (rect.width / 7)), 0, 6) };
  }
  function insideBody(clientX, clientY) {
    const r = els.weekBody.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }
  function clearDropHover() {
    dayCols.forEach((c) => { c.classList.remove('drop-hover'); c.classList.remove('col-wobble'); });
    lastHoverCol = -1;
  }
  function updateHover(clientX, clientY) {
    if (!insideBody(clientX, clientY)) { clearDropHover(); return; }
    const { col } = bodyColAt(clientX);
    if (col === lastHoverCol) return;
    dayCols.forEach((c) => c.classList.remove('drop-hover'));
    lastHoverCol = col;
    const t = dayCols[col];
    if (!t) return;
    t.classList.add('drop-hover');
    t.classList.remove('col-wobble'); void t.offsetWidth; t.classList.add('col-wobble');
    t.addEventListener('animationend', () => t.classList.remove('col-wobble'), { once: true });
  }

  function beginDrag(e, payload, sourceEl) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    drag = {
      payload, sourceEl, ghost: null, started: false,
      sx: e.clientX, sy: e.clientY,
      px: e.clientX, py: e.clientY,
      gx: e.clientX, gy: e.clientY, gvx: 0, gvy: 0, raf: 0,
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
  }

  function startGhost() {
    const d = drag;
    d.started = true;
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = d.payload.title;
    ghost.style.background = d.payload.color;
    const rect = d.sourceEl.getBoundingClientRect();
    ghost.style.minWidth = Math.min(Math.max(rect.width, 60), 180) + 'px';
    document.body.appendChild(ghost);
    d.ghost = ghost;
    d.sourceEl.classList.add('drag-source');
    document.body.classList.add('dragging-active');
    jellyPick(d.sourceEl);
    d.raf = requestAnimationFrame(tickDrag);
  }

  function onDragMove(e) {
    if (!drag) return;
    drag.px = e.clientX; drag.py = e.clientY;
    if (!drag.started) {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 4) return;
      startGhost();
    }
    updateHover(e.clientX, e.clientY);
  }

  function tickDrag() {
    if (!drag || !drag.started) return;
    const d = drag;
    if (reduceMotion) {
      d.gx = d.px; d.gy = d.py;
      d.ghost.style.transform = `translate(${d.gx}px, ${d.gy}px) translate(-50%, -50%)`;
    } else {
      const STIFF = 0.22, DAMP = 0.72;
      d.gvx = (d.gvx + (d.px - d.gx) * STIFF) * DAMP;
      d.gvy = (d.gvy + (d.py - d.gy) * STIFF) * DAMP;
      d.gx += d.gvx; d.gy += d.gvy;
      const skewX = clamp(-d.gvx * 0.9, -22, 22);
      const skewY = clamp(-d.gvy * 0.5, -14, 14);
      const speed = Math.hypot(d.gvx, d.gvy);
      const stretch = Math.min(speed * 0.012, 0.22);
      const sx = 1 + stretch, sy = 1 - stretch * 0.6;
      d.ghost.style.transform =
        `translate(${d.gx}px, ${d.gy}px) translate(-50%, -50%) skew(${skewX}deg, ${skewY}deg) scale(${sx}, ${sy})`;
    }
    d.raf = requestAnimationFrame(tickDrag);
  }

  function onDragEnd(e) {
    window.removeEventListener('pointermove', onDragMove);
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.started) {
      cancelAnimationFrame(d.raf);
      if (d.ghost) d.ghost.remove();
      d.sourceEl.classList.remove('drag-source');
      document.body.classList.remove('dragging-active');
      if (insideBody(e.clientX, e.clientY)) {
        const iso = weekDates[bodyColAt(e.clientX).col];
        if (iso) {
          if (d.payload.type === 'new' && d.payload.title) addEvent(iso, d.payload.title, d.payload.color || pickedColor);
          else if (d.payload.type === 'move' && d.payload.id) moveEvent(d.payload.id, iso);
        }
      }
    }
    clearDropHover();
  }

  // 작성 칩 갱신 (제목/색 반영)
  function updateComposeChip() {
    const title = els.composeTitle.value.trim();
    els.composeChip.textContent = title || '제목을 입력하세요';
    els.composeChip.style.background = title ? pickedColor : '';
    els.composeChip.classList.toggle('disabled', !title);
    els.composeChip.draggable = false; // 커스텀 포인터 드래그 사용
  }

  // ===== 다가오는 일정 =====
  function renderUpcoming() {
    const today = startOfDay(new Date());
    const list = state.events
      .filter((ev) => parseDate(ev.date) >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8);

    els.upcomingList.innerHTML = '';
    if (list.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '예정된 일정이 없어요';
      els.upcomingList.appendChild(li);
      return;
    }
    for (const ev of list) {
      const d = parseDate(ev.date);
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'ev-dot'; dot.style.background = ev.color;
      const body = document.createElement('div');
      body.className = 'ev-body';
      body.innerHTML =
        `<span class="ev-title">${escapeHtml(ev.title)}</span><span class="ev-date">${fmtK(d)}</span>`;
      li.appendChild(dot); li.appendChild(body);
      li.addEventListener('click', () => {
        const w = dateToWeek(d);
        if (w != null) { setWeek(w); scrollMapToWeek(w); }
      });
      els.upcomingList.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ===== 색상 스와치 =====
  function buildSwatches() {
    els.evSwatches.innerHTML = '';
    EVENT_COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c === pickedColor ? ' active' : '');
      b.style.background = c;
      b.addEventListener('click', () => {
        pickedColor = c;
        [...els.evSwatches.children].forEach((s) => s.classList.remove('active'));
        b.classList.add('active');
        updateComposeChip();
      });
      els.evSwatches.appendChild(b);
    });
  }

  // ===== 모달 =====
  function openModal(isOnboarding) {
    els.modalTitle.textContent = isOnboarding ? '시작하기' : '설정';
    els.modalCancel.classList.toggle('hidden', isOnboarding);
    els.setBirth.value = state.birth || '';
    els.setLifespan.value = lifespanYears;
    els.modal.classList.remove('hidden');
  }
  function closeModal() { els.modal.classList.add('hidden'); }

  // ===== 이벤트 바인딩 =====
  function bindEvents() {
    window.addEventListener('resize', layout);

    // 격자 클릭으로 주 선택 (드래그/줌 없음, 세로 스크롤은 브라우저 기본)
    let downX = 0, downY = 0, moved = false;
    canvas.addEventListener('pointerdown', (e) => {
      const p = localXY(e); downX = p.x; downY = p.y; moved = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = localXY(e);
      if (Math.abs(p.x - downX) + Math.abs(p.y - downY) > 6) moved = true;
      const w = weekAtLocal(p.x, p.y);
      if (w !== hoverWeek) { hoverWeek = w; render(); }
      canvas.style.cursor = w != null ? 'pointer' : 'default';
    });
    canvas.addEventListener('pointerup', (e) => {
      if (moved) return;
      const p = localXY(e);
      const w = weekAtLocal(p.x, p.y);
      if (w != null) { setWeek(w); }
    });
    canvas.addEventListener('pointerleave', () => {
      if (hoverWeek != null) { hoverWeek = null; render(); }
    });

    // 주간 네비게이션
    els.prevWeek.addEventListener('click', () => { setWeek(selectedWeek - 1); scrollMapToWeek(selectedWeek); });
    els.nextWeek.addEventListener('click', () => { setWeek(selectedWeek + 1); scrollMapToWeek(selectedWeek); });
    els.btnToday.addEventListener('click', () => { setWeek(currentWeek()); scrollMapToWeek(selectedWeek); });
    els.btnSettings.addEventListener('click', () => openModal(false));

    // 모달
    els.modalSave.addEventListener('click', () => {
      const birth = els.setBirth.value;
      if (!birth) { els.setBirth.focus(); return; }
      const span = parseInt(els.setLifespan.value, 10);
      state.birth = birth;
      lifespanYears = (span >= 1 && span <= 120) ? span : 90;
      saveState();
      closeModal();
      updateProgress();
      renderUpcoming();
      layout();
      setWeek(currentWeek());
      scrollMapToWeek(selectedWeek);
    });
    els.modalCancel.addEventListener('click', closeModal);
    els.modal.addEventListener('click', (e) => {
      if (e.target === els.modal && state.birth) closeModal();
    });

    // ── 일정 작성 칩 (커스텀 드래그 소스) ──
    els.composeTitle.addEventListener('input', updateComposeChip);
    els.composeChip.addEventListener('pointerdown', (e) => {
      const title = els.composeTitle.value.trim();
      if (!title) return;
      beginDrag(e, { type: 'new', title, color: pickedColor }, els.composeChip);
    });
  }

  // ===== 초기화 =====
  function init() {
    buildSwatches();
    bindEvents();
    layout();
    updateProgress();
    renderUpcoming();
    updateComposeChip();

    if (!state.birth) {
      openModal(true);
    } else {
      setWeek(currentWeek());
      setTimeout(() => scrollMapToWeek(currentWeek()), 80);
    }

    // 초기 레이아웃이 0 인 경우 대비
    if (canvas.clientWidth === 0) {
      const retry = () => {
        if (canvas.clientWidth > 0) { layout(); if (state.birth) scrollMapToWeek(currentWeek()); }
        else requestAnimationFrame(retry);
      };
      requestAnimationFrame(retry);
    }
    window.addEventListener('load', () => {
      layout();
      if (state.birth) scrollMapToWeek(currentWeek());
    });
  }

  init();
})();
