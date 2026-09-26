// نقطة الدخول: الدخول، التنقل، المظهر، الاختصارات، التنبيهات، الإشعارات، التركيز، التحديثات، الاتصال.
import { state, subscribe, setPref, stats, taskBucket, favorites } from './store.js';
import { init as initData, api, enterDemo, isDemo } from './data.js';
import { toast, bindModalBasics, openModal } from './ui.js';
import * as V from './views.js';
import { initChatbot } from './chatbot.js';
import { renderProject } from './project-page.js';
import { renderActivities } from './activities.js';
import { renderTrash } from './trash.js';
import { closeTask, refreshTaskPanel, openTaskId, openTask, runningTimer } from './task-panel.js';
import { initInbox, refreshInboxBadge, toggleInbox } from './inbox.js';
import { openFocus, isFocusOpen, initFocus, focusRunning } from './focus.js';
import { initPalette, openPalette } from './palette.js';
import { initSwipe } from './gestures.js';
import { prefetchLibs } from './lib.js';
import { bulk, toggleBulk } from './bulk.js';
import { esc, isoDate } from './utils.js';
import { openToday, refreshToday, isTodayOpen } from './today.js';
import { startPresence, setPresence } from './presence.js';
import { refreshProjectPresence } from './project-page.js';
import { refreshTyping } from './task-panel.js';
import { applyLang, translateTree, t as tr } from './i18n.js';
import { maybeAutoDigest } from './digest.js';
import { autoBackup } from './backup.js';
import { initMonitor } from './monitor.js';

const APP_VERSION = '5.0';
const $ = (id) => document.getElementById(id);
const VIEWS = { dashboard: ['لوحة التحكم', V.renderDashboard], goals: ['المشاريع', V.renderGoals], tasks: ['المهام', V.renderTasks], calendar: ['التقويم', V.renderCalendar], activities: ['الأنشطة', renderActivities], reports: ['التقارير', V.renderReports], team: ['الفريق', V.renderTeam], activity: ['سجل النشاط', V.renderActivity], trash: ['سلة المحذوفات', renderTrash], settings: ['الإعدادات', V.renderSettings], project: ['المشروع', null] };
let current = 'dashboard';
let projectRoute = null;
let rerender = null;
let pendingTask = null;

// ================= المظهر =================
function applyTheme() {
  let th = state.prefs.theme;
  if (th === 'auto') th = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const h = document.documentElement;
  h.setAttribute('data-theme', th);
  h.setAttribute('data-skin', state.prefs.skin === 'classic' ? 'classic' : 'odoo');
  if (state.prefs.accent && state.prefs.accent !== 'blue') h.setAttribute('data-accent', state.prefs.accent); else h.removeAttribute('data-accent');
  if (state.prefs.fontSize && state.prefs.fontSize !== 'normal') h.setAttribute('data-font', state.prefs.fontSize); else h.removeAttribute('data-font');
  document.body.classList.toggle('compact', !!state.prefs.compact);
  $('themeBtn').innerHTML = `<svg class="ic"><use href="#${th === 'dark' ? 'i-sun' : 'i-moon'}"/></svg>`;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ================= التنقل =================
function route() {
  const hash = location.hash.replace('#', '').replace('demo', '') || (state.prefs.home || 'dashboard');
  const parts = hash.split('/');
  let view = VIEWS[parts[0]] ? parts[0] : 'dashboard';
  projectRoute = null; pendingTask = null;
  if (parts[0] === 'task' && parts[1]) { view = 'tasks'; pendingTask = parts[1]; }
  // اختصارات أيقونة التطبيق (manifest shortcuts)
  if (parts[0] === 'today') { setTimeout(openToday, 50); view = 'dashboard'; }
  if (parts[0] === 'focus') { setTimeout(() => openFocus(), 50); view = 'dashboard'; }
  if (parts[0] === 'new-task') { setTimeout(() => V.openTaskModal(), 50); view = 'tasks'; }
  if (view === 'project') { if (!parts[1]) view = 'goals'; else projectRoute = { id: parts[1], tab: parts[2] || 'overview' }; }
  if (view === 'team' && !state.isAdmin) { location.hash = 'dashboard'; return; }
  if (bulk.on && view !== 'tasks') toggleBulk();
  current = view;
  document.querySelectorAll('[data-view]').forEach(a => { const on = a.dataset.view === (view === 'project' ? 'goals' : view); a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const g = projectRoute && state.goals.find(x => x.id === projectRoute.id);
  $('pageTitle').textContent = view === 'project' ? (g ? g.name : tr('المشروع')) : tr(VIEWS[view][0]);
  $('cpTitle').textContent = $('pageTitle').textContent;
  $('crumbParent').hidden = $('crumbSep').hidden = view !== 'project';
  document.title = `${$('pageTitle').textContent} — ${tr('سجل أهدافي')}`;
  $('sidebar').classList.remove('open');
  const mm = $('moreMenu'); if (mm) mm.hidden = true;
  const mb = $('moreMenuBtn'); if (mb) mb.classList.toggle('active', ['activities', 'activity', 'team', 'trash', 'settings'].includes(view));
  render();
  $('view').scrollTop = 0;
  if (view !== 'project') setPresence({ page: view, projectId: null, taskId: null });
  if (pendingTask) { const id = pendingTask; pendingTask = null; if (state.tasks.some(t => t.id === id)) openTask(id); else if (!state.loading) toast('المهمة غير موجودة أو ليس لديك صلاحية', { type: 'err' }); }
}

function skeleton(view) {
  const rep = (n) => '<div class="skeleton"></div>'.repeat(n);
  if (['dashboard', 'reports', 'project'].includes(view)) return `<div class="sk-kpis">${rep(6)}</div><div class="grid-2"><div class="panel sk-rows">${rep(5)}</div><div class="panel sk-rows">${rep(4)}</div></div>`;
  if (view === 'goals') return `<div class="sk-cards">${rep(6)}</div>`;
  return `<div class="sk-rows">${rep(8)}</div>`;
}

function render() {
  if (!state.user) return;
  const el = $('view');
  el.dataset.view = current;
  if (state.loading && !state.goals.length && !isDemo() && !['settings', 'trash', 'activity'].includes(current)) { el.innerHTML = skeleton(current); renderBadges(); return; }
  if (current === 'project' && projectRoute) renderProject(el, projectRoute.id, projectRoute.tab);
  else VIEWS[current][1](el);
  V.refreshDrawer();
  refreshTaskPanel();
  refreshToday();
  renderBadges();
  if (state.prefs.lang === 'en') translateTree(el);
}

function renderBadges() {
  const s = stats();
  const b = $('navTasksBadge');
  b.textContent = s.overdue + s.today; b.hidden = !(s.overdue + s.today);
  b.className = 'nav-badge' + (s.overdue ? ' danger' : '');
  document.querySelectorAll('[data-view="team"]').forEach(a => { a.hidden = !state.isAdmin; });
  refreshInboxBadge();
  renderFavorites();
  const pb = $('pendingBadge'); if (pb) { pb.hidden = !state.pending; pb.textContent = state.pending ? `${state.pending} لم تُرفع بعد` : ''; }
}

function renderFavorites() {
  const gs = favorites().map(id => state.goals.find(g => g.id === id)).filter(Boolean);
  $('favWrap').hidden = !gs.length;
  $('favNav').innerHTML = gs.map(g => `<a href="#project/${g.id}" class="${projectRoute && projectRoute.id === g.id ? 'active' : ''}"><span class="goal-dot" style="background:${g.color || '#2563eb'}"></span><span>${esc(g.name)}</span></a>`).join('');
}

// ================= المؤقت في الشريط العلوي =================
function tickPill() {
  const pill = $('timerPill'), txt = $('timerPillTxt');
  const tm = runningTimer(), fx = focusRunning();
  if (tm) {
    const s = Math.floor((Date.now() - tm.at) / 1000);
    txt.textContent = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    pill.hidden = false; pill.onclick = () => openTask(tm.taskId, 'time');
  } else if (fx) {
    txt.textContent = `${fx.mode === 'focus' ? '🍅' : '☕'} ${String(Math.floor(fx.left / 60)).padStart(2, '0')}:${String(fx.left % 60).padStart(2, '0')}`;
    pill.hidden = false; pill.onclick = () => openFocus();
  } else pill.hidden = true;
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
  const mapErr = (e) => ({ 'auth/invalid-email': 'بريد إلكتروني غير صحيح', 'auth/user-disabled': 'تم إيقاف هذا الحساب', 'auth/user-not-found': 'لا يوجد حساب بهذا البريد', 'auth/wrong-password': 'كلمة المرور غير صحيحة', 'auth/invalid-credential': 'البريد أو كلمة المرور غير صحيحة', 'auth/email-already-in-use': 'هذا البريد مستخدم مسبقاً', 'auth/weak-password': 'كلمة المرور ضعيفة (6 أحرف على الأقل)', 'auth/too-many-requests': 'محاولات كثيرة، حاول لاحقاً', 'auth/network-request-failed': 'مشكلة في الاتصال', 'auth/popup-closed-by-user': 'أُغلقت نافذة Google قبل الإكمال' }[e && e.code] || (typeof window.firebase === 'undefined' ? 'تعذّر تحميل خدمة الدخول — تحقق من الاتصال ثم أعد التحميل' : 'حدث خطأ، حاول مرة أخرى'));
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
  const sp = $('splash'); if (sp) { sp.style.opacity = '0'; sp.style.transition = 'opacity .2s'; setTimeout(() => sp.remove(), 220); }
  $('authScreen').hidden = authed;
  $('app').hidden = !authed;
  if (authed) {
    const name = (state.profile && state.profile.displayName) || user.displayName || (user.email || '').split('@')[0];
    $('userName').textContent = name;
    $('userEmail').textContent = user.email || '';
    $('userMenuName').textContent = name; $('userMenuName2').textContent = name; $('userMenuEmail').textContent = user.email || '';
    $('userAvatar').textContent = (name || '?').trim().slice(0, 1).toUpperCase();
    $('userRole').textContent = state.isAdmin ? 'مشرف' : 'مستخدم';
    $('demoBar').hidden = !isDemo();
    handleShareTarget();
    route();
    setTimeout(checkNotifications, 2500);
    startPresence();
    setTimeout(() => { maybeAutoDigest(); autoBackup().catch(() => {}); }, 6000);
    try { if (localStorage.getItem('goals.seenVersion') !== APP_VERSION) { localStorage.setItem('goals.seenVersion', APP_VERSION); setTimeout(() => openModal('whatsNewModal'), 900); } } catch { /* ignore */ }
  }
}

/** استقبال المشاركة من نظام التشغيل (share_target في manifest): ?title=&text=&url= */
function handleShareTarget() {
  const q = new URLSearchParams(location.search);
  if (!q.has('title') && !q.has('text') && !q.has('url')) return;
  const text = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join(' — ').trim();
  history.replaceState(null, '', location.pathname + (location.hash || '#tasks'));
  if (!text) return;
  setTimeout(() => { V.openTaskModal(); const n = $('tName'); if (n) n.value = text.slice(0, 140); const notes = $('tNotes'); if (notes && text.length > 140) notes.value = text; toast('مشاركة من جهازك — راجع المهمة واحفظها', { ms: 4000 }); }, 400);
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

// ================= الاتصال والتحديثات =================
function setupConnectivity() {
  window.addEventListener('online', () => { state.online = true; $('offlineBar').hidden = true; if (state.user) toast('عاد الاتصال — تتم المزامنة', { type: 'ok', ms: 2000 }); });
  window.addEventListener('offline', () => { state.online = false; $('offlineBar').hidden = false; });
  $('offlineBar').hidden = navigator.onLine;
}

function setupServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // أول تثبيت
    toast('يتوفر إصدار جديد من التطبيق', { action: 'تحديث الآن', onAction: () => location.reload(), ms: 15000 });
  });
}

// ================= ربط =================
function bind() {
  window.addEventListener('hashchange', route);
  $('menuBtn').onclick = () => $('sidebar').classList.toggle('open');
  $('moreMenuBtn').onclick = (e) => { e.stopPropagation(); const m = $('moreMenu'); m.hidden = !m.hidden; $('userMenu').hidden = true; };
  $('userMenuBtn').onclick = (e) => { e.stopPropagation(); const m = $('userMenu'); m.hidden = !m.hidden; $('moreMenu').hidden = true; };
  $('userMenu').querySelectorAll('a').forEach(a => { a.onclick = () => { $('userMenu').hidden = true; }; });
  $('userShortcuts').onclick = () => { $('userMenu').hidden = true; openModal('shortcutsModal'); };
  $('userSignOut').onclick = () => { $('userMenu').hidden = true; api.signOut(); };
  $('sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) $('sidebar').classList.remove('open'); });
  $('sidebarBg').onclick = () => $('sidebar').classList.remove('open');
  $('themeBtn').onclick = () => { const cur = document.documentElement.getAttribute('data-theme'); setPref('theme', cur === 'dark' ? 'light' : 'dark'); };
  $('fab').onclick = () => V.openTaskModal();
  $('addGoalTop').onclick = () => V.openGoalModal();
  $('addTaskTop').onclick = () => V.openTaskModal();
  $('focusBtn').onclick = () => openFocus();
  $('todayBtn').onclick = () => openToday();
  $('signOutBtn').onclick = () => api.signOut();
  $('demoExit').onclick = () => api.signOut();
  $('drawerBg').onclick = V.closeDrawer;
  $('taskDrawerBg').onclick = closeTask;
  document.addEventListener('keydown', (e) => {
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (inField || !state.user || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isFocusOpen() || isTodayOpen()) return;
    const k = e.key.toLowerCase();
    if (k === 't') openToday();
    if (e.key === '/') { e.preventDefault(); openPalette(); }
    if (e.key === '?') { e.preventDefault(); openModal('shortcutsModal'); }
    if (k === 'n') V.openTaskModal();
    if (k === 'g') V.openGoalModal();
    if (k === 'f') openFocus();
    if (k === 'i') toggleInbox();
    const idx = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
    if (idx >= 0) location.hash = ['dashboard', 'goals', 'tasks', 'calendar', 'reports', 'activities'][idx];
    if (e.key === 'Escape') { V.closeDrawer(); if (openTaskId()) closeTask(); }
  });
  bindModalBasics();
  initPalette();
  initInbox();
  initSwipe($('view'));

  subscribe((s, reason) => {
    if (reason === 'prefs') { applyTheme(); return; }
    if (reason === 'notifications') { refreshInboxBadge(); return; }
    if (reason === 'presence') { refreshProjectPresence(); refreshTyping(); return; }
    if (reason === 'pending') { renderBadges(); return; }
    if (reason === 'templates') { if (current === 'settings') render(); return; }
    if (['goals', 'tasks', 'users', 'profile', 'loading', 'error'].includes(reason)) {
      clearTimeout(rerender);
      rerender = setTimeout(() => {
        if (!state.user) return;
        // نحافظ على حقول البحث أثناء الكتابة
        const active = document.activeElement;
        if (active && active.closest && active.closest('#taskDrawer')) { refreshTaskPanel(); renderBadges(); return; }
        if (active && active.closest && active.closest('#view') && active.tagName === 'INPUT' && active.type === 'search') return;
        if (active && active.id === 'quickAddName' && active.value) return;
        if (active && active.closest && active.closest('.kcol-add, .stage-list, #tagAdd, #memberModal') && active.value) return;
        if (isFocusOpen() && reason !== 'goals') { renderBadges(); return; }
        render();
      }, 60);
    }
  });
  setupServiceWorker();
  setupConnectivity();
}

function boot() {
  initMonitor(api);
  applyTheme();
  applyLang();
  setupAuth();
  bind();
  initChatbot();
  initFocus();
  initData(showApp);
  setInterval(tickPill, 1000);
  // مؤقت لتحديث «اليوم/متأخرة» عند تغيّر اليوم
  setInterval(() => { if (state.user && current !== 'settings' && !isFocusOpen()) render(); }, 5 * 60 * 1000);
  window.addEventListener('load', prefetchLibs);
}
boot();
