'use strict';

const $ = (s, r = document) => r.querySelector(s);
const state = { profile: null, roadmap: null, progress: {}, sched: [] };
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86400000;
let BASE = '';
let generating = false;

const uid = (() => {
  let id = localStorage.getItem('lp_uid');
  if (!id || !/^[a-zA-Z0-9-]{8,64}$/.test(id)) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12))
      .replace(/[^a-zA-Z0-9-]/g, '');
    localStorage.setItem('lp_uid', id);
  }
  return id;
})();

/* ---------- helpers ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
  return el;
}

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(BASE + '/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  } catch {
    throw new Error("Can't reach the server. Run npm start in the terminal, then open http://localhost:3000");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}). Open the app at http://localhost:3000`);
  return data;
}

async function ping(base) {
  try {
    const j = await (await fetch(base + '/api/health')).json();
    return j && j.ok ? j : null;
  } catch { return null; }
}
async function connect() {
  let j = await ping('');
  if (j) { BASE = ''; return j; }
  j = await ping('http://localhost:3000'); // Live Server or file:// fallback
  if (j) BASE = 'http://localhost:3000';
  return j;
}

function showBanner(text, withRetry) {
  const b = $('#banner');
  b.replaceChildren(h('span', {}, text), withRetry ? h('button', { type: 'button', onclick: () => location.reload() }, 'Retry') : null);
  b.hidden = false;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3800);
}

/* ---------- dates ---------- */
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const parseDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDate = (d, long) => d.toLocaleDateString(undefined, { weekday: long ? 'long' : 'short', day: 'numeric', month: 'short' });
const shortDate = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const sameDay = (a, b) => a.getTime() === b.getTime();

/* ---------- routing ---------- */
const VIEWS = ['home', 'profile', 'roadmap'];
function route() {
  const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== name; });
  document.querySelectorAll('[data-link]').forEach((a) => a.classList.toggle('active', a.dataset.link === name));
  if (name === 'roadmap' && !generating) renderRoadmapView();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
const go = (v) => { if (location.hash === '#' + v) route(); else location.hash = v; };

/* ---------- profile ---------- */
const form = $('#profile-form');
const hoursLabel = (v) => `${v} ${Number(v) === 1 ? 'hour' : 'hours'}`;
$('#hours').addEventListener('input', (e) => ($('#hours-out').textContent = hoursLabel(e.target.value)));
function updateDaysOut() {
  const n = form.querySelectorAll('input[name=studyDays]:checked').length;
  $('#days-out').textContent = `(${n} ${n === 1 ? 'day' : 'days'} a week)`;
}
form.querySelector('.days').addEventListener('change', updateDaysOut);

function fillForm(p) {
  if (!p) return;
  for (const k of ['name', 'domain', 'background', 'goal', 'hours', 'weeks', 'style']) if (p[k] != null) form.elements[k].value = p[k];
  const r = form.querySelector(`input[name=level][value="${p.level}"]`);
  if (r) r.checked = true;
  if (p.startDate) form.elements.startDate.value = p.startDate;
  if (p.studyDays && p.studyDays.length) {
    form.querySelectorAll('input[name=studyDays]').forEach((c) => (c.checked = p.studyDays.includes(Number(c.value))));
  }
  $('#hours-out').textContent = hoursLabel(p.hours);
  updateDaysOut();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#form-error');
  err.hidden = true;
  const fd = new FormData(form);
  const d = Object.fromEntries(fd);
  d.studyDays = fd.getAll('studyDays').map(Number);
  if (!d.studyDays.length) { err.textContent = 'Choose at least one study day.'; err.hidden = false; return; }
  const buttons = form.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    const { profile } = await api(`/profile/${uid}`, { method: 'PUT', body: JSON.stringify(d) });
    state.profile = profile;
    toast('Profile saved');
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
});

/* ---------- roadmap view states ---------- */
function showRm(which) {
  ['empty', 'loading', 'content'].forEach((n) => ($('#rm-' + n).hidden = n !== which));
}

function renderRoadmapView() {
  if (state.roadmap) { renderRoadmap(); showRm('content'); return; }
  const btn = $('#rm-empty-btn');
  if (!state.profile) {
    $('#rm-empty-title').textContent = 'Create your profile first';
    $('#rm-empty-text').textContent = 'Tell us what you want to learn and we will build your roadmap.';
    btn.textContent = 'Create My Path';
    btn.onclick = () => go('profile');
  } else {
    $('#rm-empty-title').textContent = 'Ready to build your roadmap';
    $('#rm-empty-text').textContent = `${state.profile.domain} for ${state.profile.weeks} weeks at ${hoursLabel(state.profile.hours)} a day, starting from ${state.profile.level.toLowerCase()} level.`;
    btn.textContent = 'Generate my roadmap';
    btn.onclick = generate;
  }
  showRm('empty');
}

async function generate() {
  if (generating) return;
  if (!state.profile) {
    toast('Save your profile before generating a roadmap.', true);
    return;
  }
  if (state.roadmap && !confirm('Generate a new roadmap from your saved profile? This replaces the current one and resets your progress.')) return;
  generating = true;
  go('roadmap');
  showRm('loading');
  try {
    const data = await api(`/roadmap/${uid}`, { method: 'POST' });
    state.roadmap = data.roadmap;
    state.progress = {};
    $('#resume-btn').hidden = false;
    toast('Your roadmap is ready');
    go('roadmap');
  } catch (ex) {
    toast(ex.message, true);
  } finally {
    generating = false;
    renderRoadmapView();
  }
}

/* ---------- schedule model ---------- */
const tk = (w, d, t) => `${w}-${d}-${t}`;

function buildSchedule() {
  const p = state.profile || {};
  const allowed = p.studyDays && p.studyDays.length ? p.studyDays : [1, 2, 3, 4, 5];
  const start = p.startDate ? parseDate(p.startDate) : midnight(new Date(state.roadmap.generatedAt || Date.now()));
  const need = state.roadmap.weeks.reduce((n, w) => n + w.days.length, 0);
  const dates = [];
  const cur = new Date(start);
  while (dates.length < need && dates.length < 400) {
    if (allowed.includes(cur.getDay())) dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  let i = 0;
  state.sched = state.roadmap.weeks.map((w) => w.days.map(() => dates[i++]));
}

function sessions() {
  const out = [];
  state.roadmap.weeks.forEach((week, wi) => week.days.forEach((day, di) => {
    const total = day.tasks.length;
    const doneN = day.tasks.filter((_, ti) => state.progress[tk(wi, di, ti)]).length;
    out.push({ wi, di, week, day, date: state.sched[wi][di], total, doneN, done: doneN === total });
  }));
  return out;
}

function statusOf(s, today) {
  if (s.done) return ['done', 'Done'];
  if (sameDay(s.date, today)) return ['today', 'Today'];
  if (s.date < today) return ['missed', 'Missed'];
  return ['upcoming', 'Upcoming'];
}

/* ---------- roadmap rendering ---------- */
function resourceUrl(r) {
  const q = encodeURIComponent(r.query || r.title);
  return r.type === 'Video' ? `https://www.youtube.com/results?search_query=${q}` : `https://www.google.com/search?q=${q}`;
}

function taskRow(wi, di, ti, t) {
  const key = tk(wi, di, ti);
  return h('label', { class: 'task' },
    h('input', { type: 'checkbox', 'data-key': key, checked: !!state.progress[key], onchange: (e) => toggle(wi, di, ti, e.target.checked) }),
    h('span', {}, t.text, t.minutes ? h('small', {}, `(${t.minutes} min)`) : null));
}

function renderRoadmap() {
  const rm = state.roadmap, p = state.profile;
  buildSchedule();
  $('#rm-title').textContent = rm.title;
  $('#rm-summary').textContent = rm.summary;
  const chips = $('#rm-chips');
  chips.replaceChildren();
  if (p) {
    const days = (p.studyDays && p.studyDays.length ? p.studyDays : [1, 2, 3, 4, 5]).map((n) => DAY_NAMES[n]).join(', ');
    [p.domain, p.level, hoursLabel(p.hours) + '/day', `${rm.weeks.length} weeks`, days].forEach((c) => chips.append(h('li', {}, c)));
  }

  const tl = $('#timeline');
  tl.replaceChildren(...rm.weeks.map((wk, wi) =>
    h('button', { class: 'tl', type: 'button', 'data-week': wi, title: wk.theme, onclick: () => jumpToWeek(wi) }, 'W' + wk.week)));

  const wrap = $('#rm-weeks');
  wrap.replaceChildren();
  let opened = false;
  rm.weeks.forEach((wk, wi) => {
    const dates = state.sched[wi];
    const range = dates.length ? `${shortDate(dates[0])} to ${shortDate(dates[dates.length - 1])}` : '';
    const incomplete = wk.days.some((d, di) => d.tasks.some((_, ti) => !state.progress[tk(wi, di, ti)]));
    const open = !opened && incomplete;
    if (open) opened = true;

    const days = wk.days.map((d, di) =>
      h('div', { class: 'day', id: `day-${wi}-${di}` },
        h('h3', {}, `${d.day} | ${fmtDate(dates[di])}`, h('span', { class: 'st', 'data-st': `${wi}-${di}` })),
        d.focus ? h('p', { class: 'focus' }, d.focus) : null,
        d.tasks.map((t, ti) => taskRow(wi, di, ti, t))));

    const aside = h('aside', {},
      wk.checkpoint ? h('div', { class: 'checkpoint' }, h('b', {}, 'By the end of this week: '), wk.checkpoint) : null,
      wk.resources.length ? [h('h3', { class: 'res-title' }, 'Recommended resources'),
        wk.resources.map((r) => h('a', { class: 'res', href: resourceUrl(r), target: '_blank', rel: 'noopener noreferrer' },
          h('em', {}, r.type), h('b', {}, r.title), r.why ? h('p', {}, r.why) : null))] : null);

    wrap.append(h('details', { class: 'week', open, 'data-week': wi },
      h('summary', {},
        h('span', { class: 'wk-num' }, 'Week ' + wk.week),
        h('span', { class: 'wk-title' }, h('strong', {}, wk.theme), h('span', {}, [range, wk.goal].filter(Boolean).join(' | '))),
        h('span', { class: 'mini' }, h('i')),
        h('span', { class: 'wk-count' })),
      h('div', { class: 'wk-body' }, h('div', {}, days), aside)));
  });

  renderToday();
  renderSchedule();
  updateProgressUI();
}

function renderToday() {
  const box = $('#today');
  box.replaceChildren();
  const today = midnight(new Date());
  const S = sessions();
  let s = S.find((x) => sameDay(x.date, today));
  let label = 'Today';
  if (!s) { s = S.find((x) => x.date < today && !x.done); label = 'Catch up'; }
  if (!s) { s = S.find((x) => x.date > today && !x.done); label = today < S[0].date ? 'Your path starts soon' : 'Up next'; }
  if (!s) {
    box.append(h('h2', {}, 'All sessions complete'), h('p', { class: 'muted' }, 'You finished this roadmap. Regenerate to start a new one.'));
    return;
  }
  box.append(
    h('div', { class: 'today-top' },
      h('div', {},
        h('span', { class: 'today-label' }, label),
        h('h2', {}, `${fmtDate(s.date, true)}: ${s.week.theme}`),
        h('p', { class: 'muted' }, `Week ${s.week.week}, ${s.day.day}${s.day.focus ? ' | ' + s.day.focus : ''}`)),
      h('span', { class: 'st', 'data-st': `${s.wi}-${s.di}` })),
    ...s.day.tasks.map((t, ti) => taskRow(s.wi, s.di, ti, t)),
    h('button', { class: 'btn btn-ghost small', type: 'button', onclick: () => jumpTo(s.wi, s.di) }, 'Open in weekly plan'));
}

function renderSchedule() {
  const wrap = $('#tab-schedule');
  const rows = [];
  state.roadmap.weeks.forEach((wk, wi) => {
    rows.push(h('tr', { class: 'wk' }, h('td', { colspan: 5 }, `Week ${wk.week}: ${wk.theme}`)));
    wk.days.forEach((d, di) => {
      const mins = d.tasks.reduce((n, t) => n + t.minutes, 0);
      rows.push(h('tr', {},
        h('td', {}, fmtDate(state.sched[wi][di])),
        h('td', {}, d.day),
        h('td', {}, h('button', { class: 'linklike', type: 'button', onclick: () => jumpTo(wi, di) }, d.focus || d.tasks[0].text)),
        h('td', {}, `${d.tasks.length} tasks${mins ? ', ' + mins + ' min' : ''}`),
        h('td', {}, h('span', { class: 'st', 'data-st': `${wi}-${di}` }))));
    });
  });
  wrap.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'sched' },
    h('thead', {}, h('tr', {}, ['Date', 'Day', 'Focus', 'Workload', 'Status'].map((t) => h('th', {}, t)))),
    h('tbody', {}, rows))));
}

/* ---------- progress ---------- */
function updateProgressUI() {
  const today = midnight(new Date());
  const S = sessions();
  let total = 0, done = 0, minT = 0, minD = 0, due = 0, dueDone = 0;
  S.forEach((s) => s.day.tasks.forEach((t, ti) => {
    const d = !!state.progress[tk(s.wi, s.di, ti)];
    total++; minT += t.minutes;
    if (d) { done++; minD += t.minutes; }
    if (s.date < today) { due++; if (d) dueDone++; }
  }));

  state.roadmap.weeks.forEach((wk, wi) => {
    const ws = S.filter((s) => s.wi === wi);
    const wt = ws.reduce((n, s) => n + s.total, 0), wd = ws.reduce((n, s) => n + s.doneN, 0);
    const pctW = wt ? (wd / wt) * 100 : 0;
    const el = $(`.week[data-week="${wi}"]`);
    if (el) {
      $('.wk-count', el).textContent = `${wd}/${wt}`;
      $('.mini i', el).style.width = pctW + '%';
      el.classList.toggle('complete', wd === wt);
    }
    const b = $(`.tl[data-week="${wi}"]`);
    if (b) { b.style.setProperty('--p', pctW + '%'); b.classList.toggle('complete', wd === wt); }
  });

  S.forEach((s) => {
    const [cls, label] = statusOf(s, today);
    document.querySelectorAll(`[data-st="${s.wi}-${s.di}"]`).forEach((c) => { c.className = 'st ' + cls; c.textContent = label; });
  });

  const pct = total ? Math.round((done / total) * 100) : 0;
  $('#rm-pct').textContent = pct + '%';
  $('#rm-count').textContent = `${done} of ${total} tasks done`;
  $('#rm-bar').style.width = pct + '%';
  $('#st-days').textContent = `${S.filter((s) => s.done).length}/${S.length}`;
  $('#st-hours').textContent = (minD / 60).toFixed(1) + 'h';
  $('#st-hours-sub').textContent = minT ? `studied of ${Math.round(minT / 60)}h planned` : 'studied';

  const past = S.filter((s) => s.date <= today);
  let i = past.length - 1, streak = 0;
  if (i >= 0 && sameDay(past[i].date, today) && !past[i].done) i--;
  while (i >= 0 && past[i].done) { streak++; i--; }
  $('#st-streak').textContent = streak;

  const last = S[S.length - 1].date;
  const left = Math.max(0, Math.round((last - today) / DAY_MS));
  $('#st-finish').textContent = last.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  $('#st-finish-sub').textContent = `planned finish, ${left} ${left === 1 ? 'day' : 'days'} left`;

  const pace = $('#rm-pace');
  let msg, cls;
  if (done === total) { msg = 'Roadmap complete'; cls = 'ok'; }
  else if (today < S[0].date) { msg = `Starts ${fmtDate(S[0].date)}`; cls = 'info'; }
  else if (dueDone >= due) { msg = done > due ? 'Ahead of schedule' : 'On track'; cls = 'ok'; }
  else { const n = due - dueDone; msg = `Behind by ${n} ${n === 1 ? 'task' : 'tasks'}. Use Catch up above.`; cls = 'warn'; }
  pace.textContent = msg;
  pace.className = 'pace ' + cls;
  return { total, done };
}

let saveTimer;
function toggle(w, d, t, checked) {
  const key = tk(w, d, t);
  if (checked) state.progress[key] = true; else delete state.progress[key];
  document.querySelectorAll(`input[data-key="${key}"]`).forEach((c) => (c.checked = checked));
  const { total, done } = updateProgressUI();
  if (checked && done === total) toast('Roadmap complete. Well done!');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await api(`/progress/${uid}`, { method: 'PUT', body: JSON.stringify({ progress: state.progress }) }); }
    catch (ex) { toast('Progress was not saved: ' + ex.message, true); }
  }, 400);
}

/* ---------- navigation inside the roadmap ---------- */
function setTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#tab-plan').hidden = name !== 'plan';
  $('#tab-schedule').hidden = name !== 'schedule';
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

function jumpToWeek(wi) {
  setTab('plan');
  const el = $(`.week[data-week="${wi}"]`);
  el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function jumpTo(wi, di) {
  setTab('plan');
  $(`.week[data-week="${wi}"]`).open = true;
  const el = $(`#day-${wi}-${di}`);
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1700);
}

$('#rm-edit').addEventListener('click', () => go('profile'));
$('#rm-print').addEventListener('click', () => window.print());
$('#rm-regen').addEventListener('click', generate);
$('#profile-generate').addEventListener('click', generate);

$('#question-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#question-submit');
  const status = $('#question-status');
  const result = $('#question-answer');
  button.disabled = true;
  button.textContent = 'Searching…';
  status.textContent = 'Checking current sources…';
  status.className = '';
  result.hidden = true;
  try {
    const data = await api(`/ask/${uid}`, {
      method: 'POST',
      body: JSON.stringify({ question: $('#question-input').value }),
    });
    $('#question-answer-text').textContent = data.answer;
    $('#question-sources').replaceChildren(...data.sources.map((source) =>
      h('li', {}, h('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.title))));
    result.hidden = false;
    status.textContent = 'Answer checked against current sources.';
  } catch (error) {
    status.textContent = error.message;
    status.className = 'error';
  } finally {
    button.disabled = false;
    button.textContent = 'Ask Gemini';
  }
});
window.addEventListener('beforeprint', () => document.querySelectorAll('.week').forEach((d) => (d.open = true)));

/* ---------- init ---------- */
(async function init() {
  if (!form.elements.startDate.value) form.elements.startDate.value = iso(new Date());
  updateDaysOut();
  const health = await connect();
  if (!health) {
    showBanner("Can't reach the LearnPath server. In the VS Code terminal run npm install, then npm start, and open http://localhost:3000 (not the HTML file directly).", true);
  } else {
    if (!health.aiAvailable) {
      const message = health.aiStatus === 'missing-key'
        ? 'The server is running, but GEMINI_API_KEY is missing in .env. Saving works; add your key and restart to generate roadmaps.'
        : health.aiStatus === 'unreachable'
          ? 'The server is running, but it cannot reach the Gemini API. Check your internet connection or firewall and allow HTTPS access to generativelanguage.googleapis.com.'
          : `The server is running, but Gemini is not ready for ${health.model}: ${health.aiMessage || health.aiStatus || 'unknown status'}. Check your key, model access, and quota.`;
      showBanner(message, false);
    }
    try {
      const data = await api(`/state/${uid}`);
      Object.assign(state, { profile: data.profile, roadmap: data.roadmap, progress: data.progress || {} });
      fillForm(state.profile);
      $('#resume-btn').hidden = !state.roadmap;
    } catch (ex) { toast(ex.message, true); }
  }
  route();
})();
