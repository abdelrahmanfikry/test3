// لوحة الأوامر (Ctrl+K): بحث ضبابي في المهام والمشاريع والتاجز والأعضاء + أوامر سريعة + الأخيرة.
import { state, sortTasks, setPref } from './store.js';
import { api } from './data.js';
import { esc, relativeDue } from './utils.js';
import { openModal, closeModal } from './ui.js';
import { openTask } from './task-panel.js';
import { openTaskModal, openGoalModal, filters } from './views.js';
import { openFocus } from './focus.js';

const $ = (id) => document.getElementById(id);
const RECENT_KEY = 'goals.recent';
let items = [], sel = 0;

function norm(s) { return String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي'); }
function score(q, text) {
  const t = norm(text), i = t.indexOf(q);
  if (i >= 0) return 100 - Math.min(i, 40) + (i === 0 ? 20 : 0);
  let j = 0, gaps = 0; for (const ch of q) { const k = t.indexOf(ch, j); if (k < 0) return 0; gaps += k - j; j = k + 1; }
  return Math.max(1, 50 - gaps);
}

function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } }
export function trackRecent(type, id) {
  const list = recent().filter(r => !(r.type === type && r.id === id));
  list.unshift({ type, id });
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* ignore */ }
}
document.addEventListener('goals:open', (e) => { if (e.detail) trackRecent(e.detail.type, e.detail.id); });

function actions() {
  const go = (h) => () => { location.hash = h; };
  const list = [
    { label: 'مهمة جديدة', kw: 'اضافة إضافة مهمة جديد new task add', icon: 'plus', kbd: 'N', run: () => openTaskModal() },
    { label: 'مشروع جديد', kw: 'اضافة هدف مشروع جديد new goal project', icon: 'flag', kbd: 'G', run: () => openGoalModal() },
    { label: 'وضع التركيز 🍅', kw: 'تركيز بومودورو مؤقت focus pomodoro timer', icon: 'target', kbd: 'F', run: () => openFocus() },
    { label: 'مهامي المفتوحة', kw: 'مهامي my tasks', icon: 'user', run: () => { Object.assign(filters.tasks, { assignee: 'me', status: 'open', view: 'list', savedId: null }); location.hash = 'tasks'; if (location.hash === '#tasks') window.dispatchEvent(new Event('hashchange')); } },
    { label: 'المهام المتأخرة', kw: 'متاخر متأخر overdue late', icon: 'history', run: () => { Object.assign(filters.tasks, { assignee: 'all', status: 'open', group: 'due', view: 'list', savedId: null }); location.hash = 'tasks'; window.dispatchEvent(new Event('hashchange')); } },
    { label: 'تبديل المظهر (فاتح/داكن)', kw: 'مظهر ثيم داكن فاتح theme dark light', icon: 'moon', run: () => { const cur = document.documentElement.getAttribute('data-theme'); setPref('theme', cur === 'dark' ? 'light' : 'dark'); } },
    { label: 'لوحة التحكم', kw: 'الرئيسية home dashboard', icon: 'home', kbd: '1', run: go('dashboard') },
    { label: 'المشاريع', kw: 'اهداف أهداف goals projects', icon: 'flag', kbd: '2', run: go('goals') },
    { label: 'المهام', kw: 'tasks', icon: 'check', kbd: '3', run: go('tasks') },
    { label: 'التقويم', kw: 'calendar', icon: 'cal', kbd: '4', run: go('calendar') },
    { label: 'التقارير', kw: 'reports احصائيات', icon: 'chart', kbd: '5', run: go('reports') },
    { label: 'الأنشطة', kw: 'activities', icon: 'history', kbd: '6', run: go('activities') },
    { label: 'سجل النشاط', kw: 'log history سجل', icon: 'list', run: go('activity') },
    { label: 'سلة المحذوفات', kw: 'trash محذوف استعادة', icon: 'trash', run: go('trash') },
    { label: 'الإعدادات', kw: 'settings تفضيلات', icon: 'settings', run: go('settings') },
    { label: 'اختصارات لوحة المفاتيح', kw: 'shortcuts keyboard كيبورد', icon: 'note', kbd: '?', run: () => openModal('shortcutsModal') },
    { label: 'تسجيل الخروج', kw: 'logout signout خروج', icon: 'logout', run: () => api.signOut() },
  ];
  if (state.isAdmin) list.splice(14, 0, { label: 'الفريق', kw: 'team users اعضاء أعضاء', icon: 'users', run: go('team') });
  return list;
}

function build(qRaw) {
  const q = norm(qRaw.trim());
  const goals = state.goals.filter(g => !g.archived);
  const out = [];
  if (!q) {
    for (const r of recent()) {
      if (r.type === 'task') { const t = state.tasks.find(x => x.id === r.id); if (t) out.push({ group: 'الأخيرة', label: t.name, sub: goals.find(g => g.id === t.goalId)?.name || '', icon: 'check', run: () => openTask(t.id) }); }
      if (r.type === 'project') { const g = state.goals.find(x => x.id === r.id); if (g) out.push({ group: 'الأخيرة', label: g.name, sub: 'مشروع', icon: 'flag', color: g.color, run: () => { location.hash = 'project/' + g.id; } }); }
    }
    actions().slice(0, 6).forEach(a => out.push({ ...a, group: 'أوامر' }));
    return out.slice(0, 12);
  }
  const acts = actions().map(a => ({ ...a, s: Math.max(score(q, a.label), score(q, a.kw) * 0.8), group: 'أوامر' })).filter(a => a.s > 0).sort((a, b) => b.s - a.s).slice(0, 4);
  const gs = goals.map(g => ({ g, s: score(q, g.name) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5).map(({ g }) => ({ group: 'مشاريع', label: g.name, sub: g.template ? 'قالب' : `${state.tasks.filter(t => t.goalId === g.id && !t.completed).length} مهمة مفتوحة`, icon: 'flag', color: g.color, run: () => { location.hash = 'project/' + g.id; } }));
  const ts = sortTasks(state.tasks.map(t => ({ t, s: score(q, t.name) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map(x => x.t)).slice(0, 8).map(t => ({ group: 'مهام', label: t.name, sub: `${goals.find(g => g.id === t.goalId)?.name || ''}${t.dueDate ? ' · ' + relativeDue(t.dueDate) : ''}`, icon: 'check', done: t.completed, run: () => openTask(t.id) }));
  const tags = goals.flatMap(g => (g.tags || []).map(x => ({ ...x, goal: g }))).map(x => ({ x, s: score(q, x.name) })).filter(y => y.s > 0).slice(0, 3).map(({ x }) => ({ group: 'تاجز', label: `#${x.name}`, sub: x.goal.name, icon: 'note', color: x.color, run: () => { Object.assign(filters.tasks, { goal: x.goal.id, tag: x.id, view: 'list', savedId: null }); location.hash = 'tasks'; window.dispatchEvent(new Event('hashchange')); } }));
  const us = state.isAdmin ? state.users.map(u => ({ u, s: Math.max(score(q, u.displayName || ''), score(q, u.email || '')) })).filter(x => x.s > 0).slice(0, 3).map(({ u }) => ({ group: 'أعضاء', label: u.displayName || u.email, sub: u.email, icon: 'user', run: () => { Object.assign(filters.tasks, { assignee: u.uid, status: 'open', view: 'list', savedId: null }); location.hash = 'tasks'; window.dispatchEvent(new Event('hashchange')); } })) : [];
  return [...acts, ...gs, ...ts, ...tags, ...us];
}

function render(q) {
  items = build(q); sel = 0;
  const out = $('searchResults');
  if (!items.length) { out.innerHTML = '<p class="hint">لا نتائج. جرّب كلمة أخرى.</p>'; return; }
  let html = '', last = null;
  items.forEach((it, i) => {
    if (it.group !== last) { html += `<h4 class="grp-title">${it.group}</h4>`; last = it.group; }
    html += `<button class="sr ${i === sel ? 'sel' : ''}" data-i="${i}">${it.color ? `<span class="goal-dot" style="background:${it.color}"></span>` : `<svg class="ic"><use href="#i-${it.icon || 'check'}"/></svg>`}<span class="${it.done ? 'done' : ''}">${esc(it.label)}</span><small class="hint">${esc(it.sub || '')}</small>${it.kbd ? `<kbd>${it.kbd}</kbd>` : ''}</button>`;
  });
  out.innerHTML = html;
  out.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => pick(Number(b.dataset.i)); b.onmousemove = () => { sel = Number(b.dataset.i); mark(); }; });
}
function mark() { $('searchResults').querySelectorAll('.sr').forEach((b, i) => b.classList.toggle('sel', i === sel)); const cur = $('searchResults').querySelector('.sr.sel'); if (cur) cur.scrollIntoView({ block: 'nearest' }); }
function pick(i) { const it = items[i]; if (!it) return; closeModal('searchModal'); setTimeout(() => it.run(), 10); }

export function openPalette() { const input = $('searchInput'); input.value = ''; openModal('searchModal'); render(''); setTimeout(() => input.focus(), 30); }

export function initPalette() {
  $('searchBtn').onclick = openPalette;
  const input = $('searchInput');
  input.oninput = (e) => render(e.target.value);
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
  };
}
