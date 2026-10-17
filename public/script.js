'use strict';

const $ = (s, r = document) => r.querySelector(s);
const state = { profile: null, roadmap: null, progress: {}, sched: [], roadmaps: [], activeRoadmapId: null, activeProfile: null };
const IDENTITY_KEY = 'cognipath_identity';
let identity = (() => { try { return JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null') || {}; } catch { return {}; } })();
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86400000;
let BASE = '';
let generating = false;
let reminderTimer = null;
let lastReminderDate = '';
let journeyFrame = 0;
const CONFIGURED_API_BASE = String(window.LEARNPATH_API_URL || '').trim().replace(/\/+$/, '');

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
    throw new Error(BASE
      ? `Can't reach the API at ${BASE}. Check that the Render service is running.`
      : "Can't reach the server. Run npm start in the terminal, then open http://localhost:3000");
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
  if (CONFIGURED_API_BASE) {
    BASE = CONFIGURED_API_BASE;
    const remoteHealth = await ping(CONFIGURED_API_BASE);
    return remoteHealth;
  }
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

/* ---------- home journey animation ---------- */
function restartJourneyAnimation() {
  const svg = $('.hero-art');
  if (!svg) return;
  if (journeyFrame) cancelAnimationFrame(journeyFrame);
  journeyFrame = 0;
  const path = svg.querySelector('.trail');
  const milestones = [...svg.querySelectorAll('.milestone')];
  milestones.forEach((node) => node.classList.remove('is-reached'));
  const celebration = $('#journey-celebration');
  celebration?.classList.remove('is-visible');
  path.style.strokeDashoffset = '1';
  const positions = milestones.map((node, index) => {
    const point = Number(node.dataset.progress);
    return Number.isFinite(point) ? point : index / Math.max(1, milestones.length - 1);
  });
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    path.style.strokeDashoffset = '0';
    milestones.forEach((node) => node.classList.add('is-reached'));
    celebration?.classList.add('is-visible');
    return;
  }
  const duration = 4800;
  const startedAt = performance.now();
  const reached = new Set();
  if (positions[0] <= 0.0001) {
    milestones[0].classList.add('is-reached');
    reached.add(0);
  }
  const drawFrame = (now) => {
    const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
    let drawnProgress = progress;
    const nextMilestone = positions.findIndex((_, index) => !reached.has(index));
    if (nextMilestone >= 0 && progress >= positions[nextMilestone]) {
      drawnProgress = positions[nextMilestone];
      milestones[nextMilestone].classList.add('is-reached');
      reached.add(nextMilestone);
      if (milestones[nextMilestone].dataset.milestone === '12') celebration?.classList.add('is-visible');
    }
    path.style.strokeDashoffset = String(1 - drawnProgress);
    if (progress < 1) journeyFrame = requestAnimationFrame(drawFrame);
    else {
      path.style.strokeDashoffset = '0';
      celebration?.classList.add('is-visible');
      journeyFrame = 0;
    }
  };
  journeyFrame = requestAnimationFrame(drawFrame);
}

/* ---------- routing ---------- */
const VIEWS = ['home', 'login', 'profile', 'roadmap', 'library'];
function route() {
  const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== name; });
  document.querySelectorAll('[data-link]').forEach((a) => a.classList.toggle('active', a.dataset.link === name));
  if (name === 'roadmap' && !generating) renderRoadmapView();
  if (name === 'library') renderRoadmapLibrary();
  if (name === 'home') restartJourneyAnimation();
  if (name === 'login') {
    $('#identity-name').value = identity.name || state.profile?.name || '';
    $('#identity-email').value = identity.email || state.profile?.email || '';
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
const go = (v) => { if (location.hash === '#' + v) route(); else location.hash = v; };

/* ---------- profile ---------- */
const form = $('#profile-form');
const identityForm = $('#identity-form');
const profileCard = $('#profile-card');
let avatarData = '';
const hoursLabel = (v) => `${v} ${Number(v) === 1 ? 'hour' : 'hours'}`;
$('#hours').addEventListener('input', (e) => ($('#hours-out').textContent = hoursLabel(e.target.value)));
function updateDaysOut() {
  const n = form.querySelectorAll('input[name=studyDays]:checked').length;
  $('#days-out').textContent = `(${n} ${n === 1 ? 'day' : 'days'} a week)`;
}
form.querySelector('.days').addEventListener('change', updateDaysOut);

const reminderToggle = $('#reminders-enabled');
const reminderTime = $('#reminder-time');
const reminderHelp = $('#reminder-help');
function updateReminderHelp(requestPermission = false) {
  reminderTime.disabled = !reminderToggle.checked;
  if (!reminderToggle.checked) {
    reminderHelp.textContent = 'Reminders are off. Turn them on to choose a time for your selected study days.';
    return;
  }
  if (!window.isSecureContext || !('Notification' in window)) {
    reminderHelp.textContent = 'Browser notifications are unavailable here. An in-app reminder will appear at this time while CogniPath is open.';
    return;
  }
  const showStatus = () => {
    if (!reminderToggle.checked) { updateReminderHelp(false); return; }
    if (Notification.permission === 'granted') {
      reminderHelp.textContent = 'Browser notifications are enabled. Reminders run at this time on selected study days while CogniPath is open.';
    } else if (Notification.permission === 'denied') {
      reminderHelp.textContent = 'Browser notifications are blocked. An in-app reminder will appear at this time while CogniPath is open.';
    } else {
      reminderHelp.textContent = 'Save your profile to keep this setting. Browser permission is needed for desktop notifications; otherwise a reminder appears in the app.';
    }
  };
  if (requestPermission && Notification.permission === 'default') {
    Notification.requestPermission().then(showStatus).catch(() => {
      reminderHelp.textContent = 'Permission could not be requested. An in-app reminder will appear while CogniPath is open.';
    });
  } else showStatus();
}
reminderToggle.addEventListener('change', () => updateReminderHelp(reminderToggle.checked));
$('#reminder-alert .reminder-dismiss').addEventListener('click', () => { $('#reminder-alert').hidden = true; });

identityForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const error = $('#identity-error'); error.hidden = true;
  if (!identityForm.reportValidity()) return;
  identity = { name: $('#identity-name').value.trim(), email: $('#identity-email').value.trim().toLowerCase() };
  if (!identity.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email)) {
    error.textContent = 'Enter your full name and a valid email address.'; error.hidden = false; return;
  }
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  if (state.profile) fillForm(state.profile);
  form.elements.name.value = identity.name;
  form.elements.email.value = identity.email;
  if (state.profile?.email === identity.email && state.profile?.name === identity.name) { profileCard.hidden = false; form.hidden = true; renderProfileCard(); }
  else { form.hidden = false; profileCard.hidden = true; }
  go('profile');
});
$('#explore-features').addEventListener('click', () => $('#features').scrollIntoView({ behavior: 'smooth', block: 'start' }));

function fillForm(p) {
  if (!p) return;
  if (p.email) form.elements.email.value = String(p.email).trim().toLowerCase();
  for (const k of ['name', 'domain', 'background', 'goal', 'hours', 'weeks', 'style', 'reminderTime']) if (p[k] != null) form.elements[k].value = p[k];
  reminderToggle.checked = p.remindersEnabled === true;
  updateReminderHelp(false);
  const r = form.querySelector(`input[name=level][value="${p.level}"]`);
  if (r) r.checked = true;
  if (p.startDate) form.elements.startDate.value = p.startDate;
  if (p.studyDays && p.studyDays.length) {
    form.querySelectorAll('input[name=studyDays]').forEach((c) => (c.checked = p.studyDays.includes(Number(c.value))));
  }
  $('#hours-out').textContent = hoursLabel(p.hours);
  updateDaysOut();
  avatarData = p.avatar || '';
  renderAvatarPreview();
}

function renderAvatarPreview() {
  const img = $('#avatar-preview');
  img.hidden = !avatarData;
  if (avatarData) img.src = avatarData;
  $('#avatar-clear').hidden = !avatarData;
}
$('#avatar-file').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Choose an image file.', true); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const side = Math.min(image.width, image.height, 320);
      canvas.width = side; canvas.height = side;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, side, side);
      avatarData = canvas.toDataURL('image/jpeg', .78);
      renderAvatarPreview();
    };
    image.onerror = () => toast('Could not read that image.', true);
    image.src = reader.result;
  };
  reader.onerror = () => toast('Could not read that image.', true);
  reader.readAsDataURL(file);
});
$('#avatar-clear').addEventListener('click', () => { avatarData = ''; $('#avatar-file').value = ''; renderAvatarPreview(); });

function renderProfileCard() {
  const p = state.profile;
  if (!p) { profileCard.hidden = true; form.hidden = false; return; }
  profileCard.hidden = false;
  form.hidden = true;
  profileCard.replaceChildren(
    h('div', { class: 'profile-card-top' },
      p.avatar ? h('img', { class: 'profile-avatar', src: p.avatar, alt: `${p.name}'s profile` }) : h('div', { class: 'profile-avatar avatar-placeholder', 'aria-hidden': 'true' }, (p.name || '?').slice(0, 1).toUpperCase()),
      h('div', {}, h('p', { class: 'eyebrow' }, 'YOUR LEARNING PROFILE'), h('h2', {}, p.name), h('p', { class: 'muted' }, p.email || identity.email || ''), h('p', { class: 'muted' }, `${p.level} · ${p.domain}`))),
    h('p', { class: 'profile-goal' }, h('b', {}, 'Your goal'), h('br'), p.goal),
    h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost small', type: 'button', onclick: () => { if (!identity.email) { go('login'); return; } form.hidden = false; profileCard.hidden = true; } }, 'Edit profile'), h('button', { class: 'btn btn-primary small', type: 'button', onclick: () => go('roadmap') }, 'Continue')));
}

function reminderIsInLearningWindow(profile, now) {
  if (!profile || !profile.remindersEnabled || !(Number(profile.weeks) > 0)) return false;
  const start = String(profile.startDate || iso(now)).split('-').map(Number);
  if (start.length !== 3 || start.some((n) => !Number.isFinite(n) || n < 1)) return false;
  const startDay = Date.UTC(start[0], start[1] - 1, start[2]) / DAY_MS;
  const todayDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
  const daysSinceStart = todayDay - startDay;
  return daysSinceStart >= 0 && daysSinceStart < Number(profile.weeks) * 7;
}

function checkLearningReminder() {
  const p = state.profile;
  const now = new Date();
  if (!reminderIsInLearningWindow(p, now) || !Array.isArray(p.studyDays) || !p.studyDays.map(Number).includes(now.getDay())) return;
  const [hours, minutes] = String(p.reminderTime || '').split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || now.getHours() * 60 + now.getMinutes() < hours * 60 + minutes) return;
  const today = iso(now);
  const key = `cognipath_reminder_last_${uid}`;
  if (lastReminderDate === today) return;
  try { if (localStorage.getItem(key) === today) { lastReminderDate = today; return; } } catch { /* Continue with this tab's reminder schedule. */ }
  lastReminderDate = today;
  try { localStorage.setItem(key, today); } catch { /* In-memory de-duplication below still applies. */ }
  if (!window.isSecureContext || !('Notification' in window) || Notification.permission !== 'granted') {
    $('#reminder-alert').hidden = false;
    return;
  }
  try {
    const notification = new Notification('CogniPath 🎯', {
      body: '🔥 Your learning journey is waiting! Complete today’s goal and get one step closer to your dream!',
      tag: `cognipath-learning-${today}`,
    });
    notification.onclick = () => { window.focus(); notification.close(); go('roadmap'); };
  } catch {
    $('#reminder-alert').hidden = false;
  }
}

function startLearningReminders(profile = state.profile) {
  clearInterval(reminderTimer);
  reminderTimer = null;
  state.profile = profile;
  if (!profile?.remindersEnabled) return;
  checkLearningReminder();
  reminderTimer = setInterval(checkLearningReminder, 20000);
}
window.addEventListener('focus', checkLearningReminder);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkLearningReminder(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#form-error');
  err.hidden = true;
  try {
    state.profile = await saveProfileFromForm();
    renderProfileCard();
    toast('Profile saved');
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

async function saveProfileFromForm() {
  const err = $('#form-error');
  err.hidden = true;
  if (!form.reportValidity()) throw new Error('Complete the required profile fields first.');
  const fd = new FormData(form);
  const profileInput = Object.fromEntries(fd);
  profileInput.avatar = avatarData;
  profileInput.remindersEnabled = fd.has('remindersEnabled');
  profileInput.reminderTime = String(form.elements.reminderTime.value || '18:00');
  profileInput.email = String(profileInput.email || identity.email || state.profile?.email || '').trim().toLowerCase();
  if (!profileInput.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileInput.email)) throw new Error('Enter your email from the welcome step first.');
  profileInput.studyDays = fd.getAll('studyDays').map(Number);
  if (!profileInput.studyDays.length) {
    err.textContent = 'Choose at least one study day.';
    err.hidden = false;
    throw new Error('Choose at least one study day.');
  }
  const buttons = form.querySelectorAll('button');
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const { profile } = await api(`/profile/${uid}`, { method: 'PUT', body: JSON.stringify(profileInput) });
    state.profile = profile;
    identity = { name: profile.name, email: profile.email };
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
    startLearningReminders(profile);
    updateReminderHelp(false);
    return profile;
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

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
    btn.onclick = () => go('login');
  } else {
    $('#rm-empty-title').textContent = 'Ready to build your roadmap';
    $('#rm-empty-text').textContent = `${state.profile.domain} for ${state.profile.weeks} weeks at ${hoursLabel(state.profile.hours)} a day, starting from ${state.profile.level.toLowerCase()} level.`;
    btn.textContent = 'Generate Roadmap';
    btn.onclick = generate;
  }
  showRm('empty');
}

function renderRoadmapLibrary() {
  const wrap = $('#roadmap-list');
  wrap.replaceChildren();
  const items = state.roadmaps || [];
  $('#roadmap-library-empty').hidden = items.length > 0;
  items.forEach((item) => {
    const plan = item.roadmap || {};
    const tasks = (plan.weeks || []).flatMap((week) => week.days || []).flatMap((day) => day.tasks || []);
    const done = tasks.filter((_, index) => item.progress?.[taskKeyAt(plan, index)]).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const active = item.id === state.activeRoadmapId;
    const card = h('article', { class: 'roadmap-card' },
      h('div', { class: 'roadmap-card-top' }, h('span', { class: 'eyebrow' }, active ? 'CURRENT PATH' : 'SAVED ROADMAP'), h('span', { class: 'library-date' }, new Date(item.generatedAt || Date.now()).toLocaleDateString())),
      h('h2', {}, item.title || plan.title || 'Learning roadmap'),
      h('p', { class: 'muted' }, `${item.profile?.domain || state.profile?.domain || 'Learning path'} · ${(plan.weeks || []).length} weeks`),
      h('div', { class: 'bar library-bar' }, h('div', { style: `width:${pct}%` })),
      h('p', { class: 'library-progress' }, `${pct}% complete · ${done}/${tasks.length} tasks`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-primary small', type: 'button', onclick: () => openRoadmap(item.id) }, active ? 'Continue Learning' : 'Open roadmap'),
        h('button', { class: 'btn btn-ghost small', type: 'button', onclick: () => renameRoadmap(item) }, 'Edit name'),
        h('button', { class: 'btn btn-danger small', type: 'button', onclick: () => deleteRoadmap(item) }, 'Delete')));
    wrap.append(card);
  });
}

function taskKeyAt(plan, target) {
  let index = 0;
  for (let wi = 0; wi < (plan.weeks || []).length; wi++) for (let di = 0; di < (plan.weeks[wi].days || []).length; di++) for (let ti = 0; ti < (plan.weeks[wi].days[di].tasks || []).length; ti++) {
    if (index++ === target) return tk(wi, di, ti);
  }
  return '';
}

async function openRoadmap(id) {
  try {
    const data = await api(`/roadmaps/${uid}/${encodeURIComponent(id)}/open`, { method: 'POST' });
    state.roadmap = data.roadmap; state.progress = data.progress || {}; state.activeRoadmapId = data.activeRoadmapId;
    state.activeProfile = data.profile || state.profile;
    state.roadmaps = state.roadmaps.map((item) => ({ ...item, ...(item.id === id ? { roadmap: data.roadmap, progress: data.progress } : {}) }));
    go('roadmap');
  } catch (error) { toast(error.message, true); }
}

async function renameRoadmap(item) {
  const title = prompt('Roadmap name', item.title || item.roadmap?.title || '');
  if (title == null) return;
  if (!title.trim()) { toast('Enter a roadmap name.', true); return; }
  try {
    const { roadmap } = await api(`/roadmaps/${uid}/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ title: title.trim() }) });
    item.title = roadmap.title; item.roadmap = roadmap;
    if (item.id === state.activeRoadmapId) state.roadmap = roadmap;
    renderRoadmapLibrary(); renderRoadmapView(); toast('Roadmap renamed');
  } catch (error) { toast(error.message, true); }
}

async function deleteRoadmap(item) {
  if (!confirm(`Delete “${item.title || item.roadmap?.title || 'this roadmap'}” and its saved progress?`)) return;
  try {
    const data = await api(`/roadmaps/${uid}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    state.roadmaps = data.roadmaps || [];
    if (state.activeRoadmapId === item.id) {
      const active = state.roadmaps[0];
      if (active) await openRoadmap(active.id);
      else { state.activeRoadmapId = null; state.roadmap = null; state.progress = {}; state.activeProfile = state.profile; }
    }
    renderRoadmapLibrary(); renderRoadmapView(); toast('Roadmap deleted');
  } catch (error) { toast(error.message, true); }
}

async function generate() {
  if (generating) return;
  if (state.roadmap && !confirm('Generate a new roadmap using your current profile? Your current roadmap and progress will remain saved.')) return;
  try {
    await saveProfileFromForm();
  } catch (error) {
    if (error.message !== 'Complete the required profile fields first.' && error.message !== 'Choose at least one study day.') {
      toast(error.message, true);
      return;
    }
    go('profile');
    toast(error.message, true);
    return;
  }
  generating = true;
  go('roadmap');
  showRm('loading');
  try {
    const data = await api(`/roadmap/${uid}`, { method: 'POST' });
    state.roadmap = data.roadmap;
    state.progress = {};
    state.activeProfile = state.profile;
    state.activeRoadmapId = data.activeRoadmapId;
    state.roadmaps = data.roadmaps || state.roadmaps;
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
  const p = state.activeProfile || state.profile || {};
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
  const rm = state.roadmap, p = state.activeProfile || state.profile;
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
  const active = state.roadmaps.find((item) => item.id === state.activeRoadmapId);
  if (active) active.progress = { ...state.progress };
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

$('#rm-edit').addEventListener('click', () => {
  if (!identity.email) { go('login'); return; }
  fillForm(state.profile); profileCard.hidden = true; form.hidden = false; go('profile');
});
$('#rm-print').addEventListener('click', () => window.print());
$('#rm-regen').addEventListener('click', generate);
$('#profile-generate').addEventListener('click', generate);
$('#rm-library').addEventListener('click', () => go('library'));
$('#rm-rename').addEventListener('click', () => { const item = state.roadmaps.find((r) => r.id === state.activeRoadmapId); if (item) renameRoadmap(item); });
$('#rm-delete').addEventListener('click', async () => { const item = state.roadmaps.find((r) => r.id === state.activeRoadmapId); if (item) await deleteRoadmap(item); });

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
    const message = CONFIGURED_API_BASE
      ? `Can't reach the API at ${CONFIGURED_API_BASE}. Check the Render service URL and ALLOWED_ORIGINS setting.`
      : "Can't reach the CogniPath server. In the VS Code terminal run npm install, then npm start, and open http://localhost:3000 (not the HTML file directly).";
    showBanner(message, true);
  } else {
    if (!health.aiAvailable) {
      const message = health.aiStatus === 'missing-key'
        ? `The API is running, but GEMINI_API_KEY is missing from its server environment. ${CONFIGURED_API_BASE ? 'Add it to the Render service Environment settings and redeploy the backend.' : 'Add it to the root .env file and restart the server.'} Saving works; roadmap generation needs this key.`
        : health.aiStatus === 'unreachable'
          ? 'The server is running, but it cannot reach the Gemini API. Check your internet connection or firewall and allow HTTPS access to generativelanguage.googleapis.com.'
          : health.aiStatus === 'key-rejected'
            ? `Google rejected GEMINI_API_KEY. Replace it with a valid key in ${CONFIGURED_API_BASE ? 'the Render service Environment settings' : 'the root .env file'}, then redeploy or restart the backend.`
          : `The server is running, but Gemini is not ready for ${health.model}: ${health.aiMessage || health.aiStatus || 'unknown status'}. Check your key, model access, and quota.`;
      showBanner(message, true);
    }
    try {
      const data = await api(`/state/${uid}`);
      Object.assign(state, { profile: data.profile, roadmap: data.roadmap, progress: data.progress || {}, roadmaps: data.roadmaps || [], activeRoadmapId: data.activeRoadmapId || null });
      if (state.profile?.email) {
        identity = { name: state.profile.name, email: state.profile.email };
        localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
      }
      const active = state.roadmaps.find((item) => item.id === state.activeRoadmapId);
      state.activeProfile = active?.profile || state.profile;
      fillForm(state.profile);
      startLearningReminders(state.profile);
      renderProfileCard();
      $('#resume-btn').hidden = !state.roadmap;
    } catch (ex) { toast(ex.message, true); }
  }
  route();
})();
