// نقطة الدخول: الدخول، التنقل، المظهر، الاختصارات، التنبيهات.
import { state, subscribe, setPref, stats, taskBucket, sortTasks } from './store.js';
import { init as initData, api, enterDemo, isDemo } from './data.js';
import { toast, bindModalBasics, openModal, closeModal, closeAllModals } from './ui.js';
import * as V from './views.js';
import { initChatbot } from './chatbot.js';
import { renderProject } from './project-page.js';
import { renderActivities } from './activities.js';
import { closeTask, refreshTaskPanel, openTaskId } from './task-panel.js';
import { esc, relativeDue, isoDate } from './utils.js';

const $ = (id) => document.getElementById(id);
const VIEWS = { dashboard: ['لوحة التحكم', V.renderDashboard], goals: ['المشاريع', V.renderGoals], tasks: ['المهام', V.renderTasks], calendar: ['التقويم', V.renderCalendar], activities: ['الأنشطة', renderActivities], reports: ['التقارير', V.renderReports], team: ['الفريق', V.renderTeam], activity: ['سجل النشاط', V.renderActivity], settings: ['الإعدادات', V.renderSettings], project: ['المشروع', null] };
let current = 'dashboard';
let projectRoute = null;
let rerender = null;

// ================= المظهر =================
function applyTheme() {
  let th = state.prefs.theme;
  if (th === 'auto') th = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', th);
  document.body.classList.toggle('compact', !!state.prefs.compact);
  $('themeBtn').innerHTML = `<svg class="ic"><use href="#${th === 'dark' ? 'i-sun' : 'i-moon'}"/></svg>`;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ================= التنقل =================
function route() {
  const hash = location.hash.replace('#', '').replace('demo', '') || 'dashboard';
  const parts = hash.split('/');
  let view = VIEWS[parts[0]] ? parts[0] : 'dashboard';
  projectRoute = null;
  if (view === 'project') { if (!parts[1]) view = 'goals'; else projectRoute = { id: parts[1], tab: parts[2] || 'overview' }; }
  if (view === 'team' && !state.isAdmin) { location.hash = 'dashboard'; return; }
  current = view;
  document.querySelectorAll('[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === (view === 'project' ? 'goals' : view)));
  const g = projectRoute && state.goals.find(x => x.id === projectRoute.id);
  $('pageTitle').textContent = view === 'project' ? (g ? g.name : 'المشروع') : VIEWS[view][0];
  document.title = `${$('pageTitle').textContent} — سجل أهدافي`;
  $('sidebar').classList.remove('open');
  render();
  $('view').scrollTop = 0;
}

function render() {
  if (!state.user) return;
  const el = $('view');
  el.dataset.view = current;
  if (current === 'project' && projectRoute) renderProject(el, projectRoute.id, projectRoute.tab);
  else VIEWS[current][1](el);
  V.refreshDrawer();
  refreshTaskPanel();
  renderBadges();
}

function renderBadges() {
  const s = stats();
  const b = $('navTasksBadge');
  b.textContent = s.overdue + s.today; b.hidden = !(s.overdue + s.today);
  b.className = 'nav-badge' + (s.overdue ? ' danger' : '');
  $('teamNav').hidden = !state.isAdmin;
  $('teamNavM').hidden = !state.isAdmin;
}

// ================= الدخول =================
function setupAuth() {
  const err = $('authError'), email = $('authEmail'), pass = $('authPassword'), name = $('authName');
  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    $('authNameWrap').hidden = m !== 'register';
    $('authPassWrap').hidden = m === 'reset';
    $('authSubmit').textContent = m === 'login' ? 'دخول' : m === 'register' ? 'إنشاء الحساب' : 'إرسال رابط الاستعادة';
    $('authTitle').textContent = m === 'login' ? 'مرحباً بعودتك' : m === 'register' ? 'حساب جديد' : 'استعادة كلمة المرور';
    $('authSub').textContent = m === 'login' ? 'ادخل إلى أهدافك وخطتك اليومية' : m === 'register' ? 'خطوة واحدة وتبدأ التخطيط' : 'سنرسل رابطاً إلى بريدك';
    $('toRegister').hidden = m === 'register'; $('toLogin').hidden = m === 'login'; $('toReset').hidden = m === 'reset';
    err.textContent = ''; err.className = 'form-error';
  };
  $('toRegister').onclick = () => setMode('register');
  $('toLogin').onclick = () => setMode('login');
  $('toReset').onclick = () => setMode('reset');
  const mapErr = (e) => ({ 'auth/invalid-email': 'بريد إلكتروني غير صحيح', 'auth/user-disabled': 'تم إيقاف هذا الحساب', 'auth/user-not-found': 'لا يوجد حساب بهذا البريد', 'auth/wrong-password': 'كلمة المرور غير صحيحة', 'auth/invalid-credential': 'البريد أو كلمة المرور غير صحيحة', 'auth/email-already-in-use': 'هذا البريد مستخدم مسبقاً', 'auth/weak-password': 'كلمة المرور ضعيفة (6 أحرف على الأقل)', 'auth/too-many-requests': 'محاولات كثيرة، حاول لاحقاً', 'auth/network-request-failed': 'مشكلة في الاتصال', 'auth/popup-closed-by-user': 'أُغلقت نافذة Google قبل الإكمال' }[e && e.code] || 'حدث خطأ، حاول مرة أخرى');
  const busy = (on) => { $('authSubmit').disabled = on; $('authGoogle').disabled = on; $('authSubmit').classList.toggle('busy', on); };
  $('authForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!email.value) { err.textContent = 'اكتب بريدك الإلكتروني'; return; }
    if (mode !== 'reset' && pass.value.length < 6) { err.textContent = 'كلمة المرور 6 أحرف على الأقل'; return; }
    busy(true);
    try {
      if (mode === 'login') await api.signIn(email.value, pass.value);
      else if (mode === 'register') await api.signUp(email.value, pass.value, name.value.trim());
      else { await api.resetPassword(email.value); err.textContent = 'تم إرسال الرابط إلى بريدك ✅'; err.className = 'form-error ok'; setMode('login'); }
    } catch (ex) { console.warn(ex); err.textContent = mapErr(ex); }
    busy(false);
  };
  $('authGoogle').onclick = async () => { busy(true); try { await api.signInGoogle(); } catch (ex) { err.textContent = mapErr(ex); } busy(false); };
  $('authDemo').onclick = enterDemo;
  $('authPassEye').onclick = () => { pass.type = pass.type === 'password' ? 'text' : 'password'; };
}

function showApp(user) {
  const authed = !!user;
  $('authScreen').hidden = authed;
  $('app').hidden = !authed;
  if (authed) {
    const name = (state.profile && state.profile.displayName) || user.displayName || (user.email || '').split('@')[0];
    $('userName').textContent = name;
    $('userEmail').textContent = user.email || '';
    $('userRole').textContent = state.isAdmin ? 'مشرف' : 'مستخدم';
    $('demoBar').hidden = !isDemo();
    route();
    setTimeout(checkNotifications, 2500);
  }
}

// ================= بحث سريع =================
function openSearch() {
  const input = $('searchInput'); input.value = ''; $('searchResults').innerHTML = '';
  openModal('searchModal'); setTimeout(() => input.focus(), 30);
}
function runSearch(q) {
  q = q.trim().toLowerCase();
  const out = $('searchResults');
  if (!q) { out.innerHTML = '<p class="hint">اكتب اسم هدف أو مهمة…</p>'; return; }
  const goals = state.goals.filter(g => g.name.toLowerCase().includes(q)).slice(0, 5);
  const tasks = sortTasks(state.tasks.filter(t => t.name.toLowerCase().includes(q))).slice(0, 8);
  out.innerHTML = (goals.length ? `<h4 class="grp-title">أهداف</h4>${goals.map(g => `<button class="sr" data-goal="${g.id}"><svg class="ic"><use href="#i-flag"/></svg><span>${esc(g.name)}</span><small class="hint">${g.endDate ? relativeDue(g.endDate) : ''}</small></button>`).join('')}` : '') +
    (tasks.length ? `<h4 class="grp-title">مهام</h4>${tasks.map(t => `<button class="sr" data-task="${t.id}"><svg class="ic"><use href="#i-check"/></svg><span class="${t.completed ? 'done' : ''}">${esc(t.name)}</span><small class="hint">${t.dueDate ? relativeDue(t.dueDate) : ''}</small></button>`).join('')}` : '') +
    (!goals.length && !tasks.length ? '<p class="hint">لا نتائج.</p>' : '');
  out.querySelectorAll('[data-goal]').forEach(b => { b.onclick = () => { closeModal('searchModal'); V.openGoalDrawer(b.dataset.goal); }; });
  out.querySelectorAll('[data-task]').forEach(b => { b.onclick = () => { closeModal('searchModal'); const t = state.tasks.find(x => x.id === b.dataset.task); if (t) V.openTaskModal(t); }; });
}

// ================= تنبيهات المتصفح =================
function checkNotifications() {
  if (!state.prefs.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const key = 'goals.notified.' + isoDate();
  if (localStorage.getItem(key)) return;
  const open = state.tasks.filter(t => !t.completed);
  const today = open.filter(t => taskBucket(t) === 'today'), late = open.filter(t => taskBucket(t) === 'overdue');
  if (!today.length && !late.length) return;
  try { new Notification('سجل أهدافي', { body: `${today.length ? `${today.length} مهمة مستحقة اليوم` : ''}${today.length && late.length ? ' · ' : ''}${late.length ? `${late.length} متأخرة` : ''}`, icon: 'icons/icon-192.png' }); localStorage.setItem(key, '1'); } catch { /* ignore */ }
}

// ================= ربط =================
function bind() {
  window.addEventListener('hashchange', route);
  $('menuBtn').onclick = () => $('sidebar').classList.toggle('open');
  $('sidebarBg').onclick = () => $('sidebar').classList.remove('open');
  $('themeBtn').onclick = () => { const cur = document.documentElement.getAttribute('data-theme'); setPref('theme', cur === 'dark' ? 'light' : 'dark'); };
  $('searchBtn').onclick = openSearch;
  $('searchInput').oninput = (e) => runSearch(e.target.value);
  $('fab').onclick = () => V.openTaskModal();
  $('addGoalTop').onclick = () => V.openGoalModal();
  $('addTaskTop').onclick = () => V.openTaskModal();
  $('signOutBtn').onclick = () => api.signOut();
  $('demoExit').onclick = () => api.signOut();
  $('drawerBg').onclick = V.closeDrawer;
  $('taskDrawerBg').onclick = closeTask;
  document.addEventListener('keydown', (e) => {
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    if (inField || !state.user) return;
    if (e.key === '/') { e.preventDefault(); openSearch(); }
    if (e.key.toLowerCase() === 'n') V.openTaskModal();
    if (e.key.toLowerCase() === 'g') V.openGoalModal();
    const idx = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
    if (idx >= 0) location.hash = ['dashboard', 'goals', 'tasks', 'calendar', 'reports', 'activities'][idx];
    if (e.key === 'Escape') { V.closeDrawer(); if (openTaskId()) closeTask(); }
  });
  bindModalBasics();

  subscribe((s, reason) => {
    if (reason === 'prefs') { applyTheme(); return; }
    if (['goals', 'tasks', 'users', 'profile', 'loading', 'error'].includes(reason)) {
      clearTimeout(rerender);
      rerender = setTimeout(() => {
        if (!state.user) return;
        // نحافظ على حقول البحث أثناء الكتابة
        const active = document.activeElement;
        if (active && active.closest && active.closest('#taskDrawer')) { refreshTaskPanel(); return; }
        if (active && active.closest && active.closest('#view') && active.tagName === 'INPUT' && active.type === 'search') return;
        if (active && active.id === 'quickAddName' && active.value) return;
        if (active && active.closest && active.closest('.kcol-add, .stage-list, #tagAdd') && active.value) return;
        render();
      }, 60);
    }
  });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function boot() {
  applyTheme();
  setupAuth();
  bind();
  initChatbot();
  initData(showApp);
  // مؤقت لتحديث «اليوم/متأخرة» عند تغيّر اليوم
  setInterval(() => { if (state.user && current !== 'settings') render(); }, 5 * 60 * 1000);
}
boot();
