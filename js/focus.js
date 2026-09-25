// وضع التركيز 🍅: شاشة كاملة + مؤقّت بومودورو + إنجاز المهمة + تسجيل الجلسة كساعات على المهمة.
import { state, taskBucket, sortTasks, isMine, goalTasks } from './store.js';
import { api, isDemo } from './data.js';
import { esc, isoDate, uid } from './utils.js';
import { toast, celebrate } from './ui.js';
import { completionPatch } from './model.js';

const KEY = 'goals.focus';
let overlay = null, tick = null;
const st = { mode: 'focus', running: false, endAt: null, remaining: null, taskId: null, sessions: {} };

function load() { try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } }
load();

function minutes() { return st.mode === 'focus' ? (Number(state.prefs.focusMin) || 25) : (Number(state.prefs.breakMin) || 5); }
function total() { return minutes() * 60; }
function left() { if (st.running && st.endAt) return Math.max(0, Math.round((st.endAt - Date.now()) / 1000)); return st.remaining != null ? st.remaining : total(); }
function fmt(s) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
export function sessionsToday() { return st.sessions[isoDate()] || 0; }
export function isFocusOpen() { return !!overlay && !overlay.hidden; }
export function focusRunning() { return st.running ? { mode: st.mode, left: left(), taskId: st.taskId } : null; }

function candidates() {
  const goals = state.goals.filter(g => !g.archived && !g.template);
  const gid = new Set(goals.map(g => g.id));
  const open = state.tasks.filter(t => !t.completed && gid.has(t.goalId) && isMine(t));
  const rank = { overdue: 0, today: 1, week: 2, noDate: 3, later: 4 };
  return sortTasks(open).sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || rank[taskBucket(a)] - rank[taskBucket(b)]).slice(0, 30);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18, 0.36].forEach((d, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value = 660 + i * 120; g.gain.value = 0.08; o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.14); });
  } catch { /* ignore */ }
}

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'focus-overlay'; overlay.hidden = true; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', 'وضع التركيز');
  document.body.appendChild(overlay);
  document.addEventListener('keydown', (e) => {
    if (!isFocusOpen()) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); st.running ? pause() : start(); }
    if (e.key === 'Escape') closeFocus();
  });
  return overlay;
}

function render() {
  const o = ensureOverlay();
  const list = candidates();
  const cur = state.tasks.find(t => t.id === st.taskId);
  const secs = left(), tot = total(), pct = Math.round(((tot - secs) / tot) * 100);
  const r = 88, c = 2 * Math.PI * r;
  o.innerHTML = `
    <div class="focus-top"><button class="iconbtn" id="fxClose" aria-label="إغلاق"><svg class="ic"><use href="#i-close"/></svg></button><span class="hint">🍅 جلسات اليوم: <strong>${sessionsToday()}</strong></span></div>
    <div class="focus-main ${st.mode}">
      <div class="seg focus-modes"><button class="${st.mode === 'focus' ? 'active' : ''}" data-mode="focus">تركيز ${Number(state.prefs.focusMin) || 25} د</button><button class="${st.mode === 'break' ? 'active' : ''}" data-mode="break">استراحة ${Number(state.prefs.breakMin) || 5} د</button></div>
      <div class="focus-ring"><svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="${r}" class="ring-bg"/><circle cx="100" cy="100" r="${r}" class="ring-fg" style="stroke-dasharray:${c};stroke-dashoffset:${c * (1 - pct / 100)}"/></svg><div class="focus-time" id="fxTime">${fmt(secs)}</div></div>
      <div class="focus-task">
        ${cur ? `<div class="focus-task-name">${esc(cur.name)}</div>` : '<div class="hint">اختر مهمة لتربط الجلسة بها (اختياري)</div>'}
        <select id="fxTask"><option value="">— بدون مهمة —</option>${list.map(t => `<option value="${t.id}" ${t.id === st.taskId ? 'selected' : ''}>${t.starred ? '★ ' : ''}${esc(t.name)}${taskBucket(t) === 'overdue' ? ' (متأخرة)' : taskBucket(t) === 'today' ? ' (اليوم)' : ''}</option>`).join('')}</select>
      </div>
      <div class="btn-row center">
        <button class="btn btn-primary btn-lg" id="fxToggle">${st.running ? '⏸ إيقاف مؤقت' : '▶ ابدأ'}</button>
        <button class="btn" id="fxReset">↺ إعادة</button>
        ${cur ? `<button class="btn btn-ok" id="fxDone">✓ أنجزت المهمة</button>` : ''}
      </div>
      <p class="hint">مسافة للبدء/الإيقاف · Esc للخروج · تُسجَّل كل جلسة تركيز كساعات على المهمة</p>
    </div>`;
  o.querySelector('#fxClose').onclick = closeFocus;
  o.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => { st.mode = b.dataset.mode; st.running = false; st.endAt = null; st.remaining = null; save(); render(); }; });
  o.querySelector('#fxTask').onchange = (e) => { st.taskId = e.target.value || null; save(); render(); };
  o.querySelector('#fxToggle').onclick = () => { st.running ? pause() : start(); };
  o.querySelector('#fxReset').onclick = () => { st.running = false; st.endAt = null; st.remaining = null; save(); render(); };
  const dn = o.querySelector('#fxDone'); if (dn) dn.onclick = completeTask;
}

function start() { st.running = true; st.endAt = Date.now() + left() * 1000; st.remaining = null; save(); render(); loop(); }
function pause() { st.remaining = left(); st.running = false; st.endAt = null; save(); render(); }
function loop() {
  clearInterval(tick);
  tick = setInterval(() => {
    if (!st.running) { clearInterval(tick); return; }
    const s = left();
    const el = overlay && overlay.querySelector('#fxTime'); if (el) el.textContent = fmt(s);
    const ring = overlay && overlay.querySelector('.ring-fg'); if (ring) { const tot = total(); const c = 2 * Math.PI * 88; ring.style.strokeDashoffset = c * (s / tot); }
    document.title = `${fmt(s)} · ${st.mode === 'focus' ? 'تركيز' : 'استراحة'} — سجل أهدافي`;
    if (s <= 0) finish();
  }, 500);
}

async function finish() {
  clearInterval(tick);
  st.running = false; st.endAt = null; st.remaining = null;
  beep();
  if (st.mode === 'focus') {
    st.sessions[isoDate()] = sessionsToday() + 1;
    const t = state.tasks.find(x => x.id === st.taskId);
    if (t) {
      const hours = Math.round((minutes() / 60) * 100) / 100;
      try { await api.updateTask(t.id, { timesheets: [...(t.timesheets || []), { id: uid(), uid: state.user.uid, date: isoDate(), hours, note: 'جلسة تركيز 🍅' }] }); } catch { /* ignore */ }
    }
    try { if (state.prefs.notify && 'Notification' in window && Notification.permission === 'granted') new Notification('انتهت جلسة التركيز 🍅', { body: t ? `أحسنت! خذ استراحة قصيرة. (${t.name})` : 'أحسنت! خذ استراحة قصيرة.', icon: 'icons/icon-192.png' }); } catch { /* ignore */ }
    toast('انتهت جلسة التركيز 🍅 خذ استراحة', { type: 'ok' });
    st.mode = 'break';
  } else { st.mode = 'focus'; toast('انتهت الاستراحة — جاهز لجلسة جديدة؟', { type: 'ok' }); }
  save(); render();
}

async function completeTask() {
  const t = state.tasks.find(x => x.id === st.taskId); if (!t) return;
  const g = state.goals.find(x => x.id === t.goalId);
  const p = completionPatch(g, true); p.completedAt = isDemo() ? Date.now() : window.firebase.firestore.FieldValue.serverTimestamp();
  try { await api.updateTask(t.id, p); } catch { toast('تعذّر الحفظ', { type: 'err' }); return; }
  const remaining = goalTasks(t.goalId).filter(x => !x.completed && x.id !== t.id).length;
  if (g && remaining === 0 && goalTasks(t.goalId).length > 1) celebrate('اكتمل المشروع!', `أنجزت كل مهام «${g.name}».`); else toast('أنجزت المهمة ✅', { type: 'ok' });
  const next = candidates().find(x => x.id !== t.id);
  st.taskId = next ? next.id : null; save(); render();
}

export function openFocus(taskId) {
  ensureOverlay();
  if (taskId) st.taskId = taskId;
  if (st.taskId && !state.tasks.some(t => t.id === st.taskId && !t.completed)) st.taskId = null;
  overlay.hidden = false; document.body.classList.add('modal-open');
  render();
  if (st.running) loop();
}
export function closeFocus() { if (!overlay) return; overlay.hidden = true; document.body.classList.remove('modal-open'); if (!st.running) document.title = 'سجل أهدافي'; }
export function initFocus() { if (st.running) loop(); }
