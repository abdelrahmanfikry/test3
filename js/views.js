// كل شاشات التطبيق + نوافذ الإضافة/التعديل.
import { state, notify, goalTasks, goalProgress, goalStatus, visibleGoals, taskBucket, sortTasks, stats, userLabel, canEditGoal, canEditTask, setPref } from './store.js';
import { api, isDemo, resetDemo } from './data.js';
import { esc, fmtDate, fmtDateTime, relativeDue, daysFromToday, isoDate, addDays, toMillis, PRIORITIES, CATEGORIES, GOAL_COLORS, QUOTES, groupBy } from './utils.js';
import { toast, openModal, closeModal, confirmDialog, promptDialog, celebrate, setBusy } from './ui.js';
import { projectStages, taskStage, stagePatch, completionPatch, subtaskProgress, blockers, checklistProgress, cloneFromTemplate, DEFAULT_STAGES, DEFAULT_PERSONAL_STAGES, myActivities, activityState, ACTIVITY_TYPES, hoursSpent } from './model.js';
import { openTask, spawnRecurrence } from './task-panel.js';
import { renderKanban } from './kanban.js';
import { renderGantt } from './gantt.js';
import { kanbanCard } from './project-page.js';

const $ = (id) => document.getElementById(id);
const BUCKETS = { overdue: 'متأخرة', today: 'اليوم', week: 'هذا الأسبوع', later: 'لاحقاً', noDate: 'بدون موعد', done: 'منجزة' };
const STATUS = { active: ['نشط', 'st-active'], late: ['متأخر', 'st-late'], done: ['مكتمل', 'st-done'], archived: ['مؤرشف', 'st-archived'] };

export const filters = { goals: { q: '', status: 'all', category: 'all', sort: 'created', templates: false }, tasks: { q: '', goal: 'all', assignee: 'all', priority: 'all', status: 'open', group: 'due', view: 'list', tag: 'all', star: false, savedId: null }, calendarMonth: null, activityType: 'all' };
let kanbanFolded = null;

// ================= مكوّنات صغيرة =================
function goalById(id) { return state.goals.find(g => g.id === id); }
function avatar(uid, size = 24) {
  const u = state.users.find(x => x.uid === uid);
  const name = u ? (u.displayName || u.email || '?') : '?';
  const initials = name.trim().slice(0, 1).toUpperCase();
  const hue = [...(uid || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  if (u && u.photoURL) return `<img class="avatar" src="${esc(u.photoURL)}" alt="${esc(name)}" title="${esc(name)}" style="width:${size}px;height:${size}px" referrerpolicy="no-referrer">`;
  return `<span class="avatar" title="${esc(name)}" style="width:${size}px;height:${size}px;background:hsl(${hue} 60% 45%)">${esc(initials)}</span>`;
}
function priorityBadge(p) { const x = PRIORITIES[p || 'medium']; return `<span class="badge ${x.cls}">${x.label}</span>`; }
function ring(pct, size = 44, color) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" style="stroke:${color || 'var(--primary)'};stroke-dasharray:${c};stroke-dashoffset:${c * (1 - pct / 100)}"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle">${pct}%</text></svg>`;
}
function emptyState(icon, title, sub, btn) {
  return `<div class="empty"><svg class="ic big"><use href="#i-${icon}"/></svg><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}${btn || ''}</div>`;
}

// ================= لوحة التحكم =================
export function renderDashboard(el) {
  const s = stats();
  const goals = visibleGoals().filter(g => !g.template);
  const myOpen = state.tasks.filter(t => !t.completed && goals.some(g => g.id === t.goalId));
  const acts = myActivities(state.tasks, state.user.uid).filter(a => activityState(a) !== 'planned').slice(0, 5);
  const overdue = sortTasks(myOpen.filter(t => taskBucket(t) === 'overdue'));
  const today = sortTasks(myOpen.filter(t => taskBucket(t) === 'today'));
  const week = sortTasks(myOpen.filter(t => taskBucket(t) === 'week'));
  const mine = myOpen.filter(t => t.assignedToUid === state.user.uid);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صباح الخير' : hour < 18 ? 'مساء الخير' : 'مساء النور';
  const name = (state.profile && state.profile.displayName) || (state.user.displayName) || (state.user.email || '').split('@')[0];
  const quote = QUOTES[new Date().getDate() % QUOTES.length];
  const nearGoals = goals.filter(g => goalStatus(g) !== 'done').map(g => ({ g, n: daysFromToday(g.endDate) })).filter(x => x.n != null && x.n <= 14).sort((a, b) => a.n - b.n).slice(0, 4);

  el.innerHTML = `
    <div class="hero">
      <div>
        <h1>${greet}، ${esc(name)} 👋</h1>
        <p class="muted">${esc(quote)}</p>
      </div>
      <div class="hero-actions">
        <button class="btn btn-primary" data-act="add-task"><svg class="ic"><use href="#i-plus"/></svg> مهمة سريعة</button>
        <button class="btn" data-act="add-goal"><svg class="ic"><use href="#i-flag"/></svg> هدف جديد</button>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><span class="kpi-label">مهام اليوم</span><span class="kpi-value ${s.today ? 'c-warn' : ''}">${s.today}</span></div>
      <div class="kpi"><span class="kpi-label">متأخرة</span><span class="kpi-value ${s.overdue ? 'c-danger' : ''}">${s.overdue}</span></div>
      <div class="kpi"><span class="kpi-label">أُنجزت هذا الأسبوع</span><span class="kpi-value c-ok">${s.doneThisWeek}</span></div>
      <div class="kpi"><span class="kpi-label">سلسلة الإنجاز</span><span class="kpi-value">${s.streak} <small>يوم 🔥</small></span></div>
      <div class="kpi"><span class="kpi-label">الأهداف المكتملة</span><span class="kpi-value">${s.completedGoals}<small>/${s.goals}</small></span></div>
      <div class="kpi"><span class="kpi-label">نسبة الإنجاز</span><span class="kpi-value">${s.rate}%</span><div class="progress"><div class="progress-bar" style="width:${s.rate}%"></div></div></div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h2><svg class="ic"><use href="#i-check"/></svg> ركّز اليوم</h2><a href="#tasks" class="link">كل المهام →</a></div>
        ${overdue.length ? `<h4 class="grp-title danger">متأخرة</h4>${taskList(overdue, { compact: true })}` : ''}
        ${today.length ? `<h4 class="grp-title warn">اليوم</h4>${taskList(today, { compact: true })}` : ''}
        ${!overdue.length && !today.length ? emptyState('sun', 'يومك خالٍ من المهام العاجلة', week.length ? `عندك ${week.length} مهمة هذا الأسبوع.` : 'أضف مهمة أو استرح باستحقاق.') : ''}
        ${week.length ? `<h4 class="grp-title">هذا الأسبوع</h4>${taskList(week.slice(0, 5), { compact: true })}` : ''}
      </div>
      <div class="stack">
        <div class="panel">
          <div class="panel-head"><h2><svg class="ic"><use href="#i-flag"/></svg> أهداف قريبة من موعدها</h2><a href="#goals" class="link">كل الأهداف →</a></div>
          ${nearGoals.length ? nearGoals.map(({ g, n }) => `<div class="mini-goal" data-open-goal="${g.id}">${ring(goalProgress(g), 40, g.color)}<div class="mini-goal-body"><strong>${esc(g.name)}</strong><span class="hint ${n < 0 ? 'c-danger' : n <= 3 ? 'c-warn' : ''}">${n < 0 ? `متأخر ${-n} يوم` : n === 0 ? 'ينتهي اليوم' : `باقي ${n} يوم`} · ${goalTasks(g.id).filter(t => !t.completed).length} مهمة مفتوحة</span></div></div>`).join('') : `<p class="muted">لا توجد أهداف تنتهي خلال أسبوعين.</p>`}
        </div>
        <div class="panel">
          <div class="panel-head"><h2><svg class="ic"><use href="#i-history"/></svg> أنشطة مستحقة</h2><a href="#activities" class="link">كل الأنشطة →</a></div>
          ${acts.length ? acts.map(a => `<div class="act ${activityState(a) === 'overdue' ? 'late' : ''}"><span class="act-ico">${ACTIVITY_TYPES[a.type] ? ACTIVITY_TYPES[a.type][1] : '✅'}</span><div class="act-main"><strong>${esc(a.summary || '')}</strong><div class="hint"><button class="linkbtn" data-open-task="${a.task.id}">${esc(a.task.name)}</button> · ${a.due ? relativeDue(a.due) : ''}</div></div></div>`).join('') : `<p class="muted">لا أنشطة مستحقة اليوم.</p>`}
        </div>
        <div class="panel">
          <div class="panel-head"><h2><svg class="ic"><use href="#i-user"/></svg> مهامي المكلّف بها</h2></div>
          ${mine.length ? `<p class="muted small">${mine.length} مهمة مفتوحة مكلّف بها أنت</p>${taskList(sortTasks(mine).slice(0, 4), { compact: true })}` : `<p class="muted">لا توجد مهام مكلّف بها حالياً.</p>`}
        </div>
      </div>
    </div>`;
  bindTaskList(el);
  el.querySelector('[data-act="add-task"]').onclick = () => openTaskModal();
  el.querySelector('[data-act="add-goal"]').onclick = () => openGoalModal();
  el.querySelectorAll('[data-open-goal]').forEach(x => { x.onclick = () => { location.hash = 'project/' + x.dataset.openGoal; }; });
  el.querySelectorAll('[data-open-task]').forEach(x => { x.onclick = () => openTask(x.dataset.openTask, 'activities'); });
}

// ================= الأهداف =================
export function renderGoals(el) {
  const f = filters.goals;
  let list = state.goals.filter(g => {
    const st = goalStatus(g);
    if (f.templates !== !!g.template) return false;
    if (f.status === 'all' && st === 'archived') return false;
    if (f.status !== 'all' && st !== f.status) return false;
    if (f.category !== 'all' && (g.category || 'other') !== f.category) return false;
    if (f.q && !(g.name + ' ' + (g.note || '')).toLowerCase().includes(f.q.toLowerCase())) return false;
    return true;
  });
  list.sort((a, b) => {
    if (f.sort === 'name') return a.name.localeCompare(b.name, 'ar');
    if (f.sort === 'deadline') return (a.endDate || '9999').localeCompare(b.endDate || '9999');
    if (f.sort === 'progress') return goalProgress(b) - goalProgress(a);
    return toMillis(b.createdAt) - toMillis(a.createdAt);
  });
  const counts = { all: state.goals.filter(g => !g.archived && !g.template).length, active: 0, late: 0, done: 0, archived: 0 };
  state.goals.filter(g => !g.template).forEach(g => { counts[goalStatus(g)]++; });
  const templates = state.goals.filter(g => g.template);
  el.innerHTML = `
    <div class="toolbar">
      <div class="seg" role="tablist">${['all', 'active', 'late', 'done', 'archived'].map(k => `<button class="${f.status === k ? 'active' : ''}" data-status="${k}">${k === 'all' ? 'الكل' : STATUS[k][0]} <small>${counts[k]}</small></button>`).join('')}</div>
      <div class="toolbar-right">
        <div class="search"><svg class="ic"><use href="#i-search"/></svg><input type="search" id="goalsQ" placeholder="ابحث في الأهداف…" value="${esc(f.q)}"></div>
        <select id="goalsCat"><option value="all">كل التصنيفات</option>${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${f.category === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select id="goalsSort"><option value="created" ${f.sort === 'created' ? 'selected' : ''}>الأحدث</option><option value="deadline" ${f.sort === 'deadline' ? 'selected' : ''}>الأقرب موعداً</option><option value="progress" ${f.sort === 'progress' ? 'selected' : ''}>الأعلى تقدماً</option><option value="name" ${f.sort === 'name' ? 'selected' : ''}>الاسم</option></select>
        <button class="btn ${f.templates ? 'btn-primary' : ''}" id="goalsTpl" title="القوالب"><svg class="ic"><use href="#i-archive"/></svg> قوالب <small>${templates.length}</small></button>
        ${templates.length ? `<button class="btn" id="goalsFromTpl"><svg class="ic"><use href="#i-copy"/></svg> من قالب</button>` : ''}
        <button class="btn btn-primary" id="goalsAdd"><svg class="ic"><use href="#i-plus"/></svg> مشروع جديد</button>
      </div>
    </div>
    ${list.length ? `<div class="goals-grid">${list.map(goalCard).join('')}</div>` : emptyState('flag', state.goals.length ? 'لا توجد أهداف مطابقة' : 'ابدأ بهدفك الأول', state.goals.length ? 'غيّر الفلتر أو كلمة البحث.' : 'الهدف الواضح نصف الطريق. أضف هدفاً وقسّمه لمهام صغيرة.', `<button class="btn btn-primary" id="goalsAdd2"><svg class="ic"><use href="#i-plus"/></svg> هدف جديد</button>`)}`;
  el.querySelectorAll('[data-status]').forEach(b => { b.onclick = () => { f.status = b.dataset.status; renderGoals(el); }; });
  $('goalsQ').oninput = (e) => { f.q = e.target.value; renderGoals(el); const q = $('goalsQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); };
  $('goalsCat').onchange = (e) => { f.category = e.target.value; renderGoals(el); };
  $('goalsSort').onchange = (e) => { f.sort = e.target.value; renderGoals(el); };
  $('goalsAdd').onclick = () => openGoalModal();
  $('goalsTpl').onclick = () => { f.templates = !f.templates; renderGoals(el); };
  const ft = $('goalsFromTpl'); if (ft) ft.onclick = (e) => templateMenu(templates, ft);
  const add2 = $('goalsAdd2'); if (add2) add2.onclick = () => openGoalModal();
  bindGoalCards(el);
}

function templateMenu(templates, btn) {
  const menu = document.createElement('div'); menu.className = 'menu'; menu.style.position = 'fixed';
  const r = btn.getBoundingClientRect(); menu.style.top = r.bottom + 4 + 'px'; menu.style.insetInlineEnd = (document.documentElement.dir === 'rtl' ? r.left : window.innerWidth - r.right) + 'px';
  menu.innerHTML = templates.map(t => `<button data-tpl="${t.id}"><span class="goal-dot" style="background:${t.color || '#2563eb'}"></span> ${esc(t.name)} <small class="hint">${goalTasks(t.id).length} مهمة</small></button>`).join('');
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  menu.querySelectorAll('[data-tpl]').forEach(b => { b.onclick = () => createFromTemplate(goalById(b.dataset.tpl)); });
}

export async function createFromTemplate(tpl) {
  if (!tpl) return;
  const name = await promptDialog('اسم المشروع الجديد', tpl.name.replace(/^قالب:\s*/, ''));
  if (!name) return;
  const start = await promptDialog('تاريخ البداية', isoDate(), { type: 'date' });
  if (start == null) return;
  const days = tpl.startDate && tpl.endDate ? Math.max(1, Math.round((new Date(tpl.endDate + 'T00:00:00') - new Date(tpl.startDate + 'T00:00:00')) / 86400000)) : 30;
  const { goal, tasks } = cloneFromTemplate(tpl, state.tasks, { name, startDate: start || isoDate(), endDate: isoDate(addDays(start || isoDate(), days)) });
  try {
    const id = await api.createGoal(goal);
    if (tasks.length) await api.createTasksBatch(tasks.map(t => ({ ...t, goalId: id, assignedToUid: state.user.uid })));
    toast(`تم إنشاء «${name}» من القالب مع ${tasks.length} مهمة`, { type: 'ok' });
    location.hash = 'project/' + id;
  } catch (e) { console.error(e); toast('تعذّر الإنشاء', { type: 'err' }); }
}

function goalCard(g) {
  const p = goalProgress(g), st = goalStatus(g), ts = goalTasks(g.id);
  const n = daysFromToday(g.endDate);
  const open = ts.filter(t => !t.completed).length;
  return `<article class="goal-card" data-goal="${g.id}" style="--gc:${g.color || '#2563eb'}">
    <div class="goal-top">
      <div class="goal-title"><span class="goal-dot"></span><h3>${esc(g.name)}</h3></div>
      <div class="menu-wrap"><button class="iconbtn" data-menu aria-label="خيارات"><svg class="ic"><use href="#i-dots"/></svg></button>
        <div class="menu" hidden>
          <button data-act="project"><svg class="ic"><use href="#i-list"/></svg> صفحة المشروع</button>
          <button data-act="open"><svg class="ic"><use href="#i-eye"/></svg> عرض سريع</button>
          ${canEditGoal(g) ? `<button data-act="template"><svg class="ic"><use href="#i-copy"/></svg> ${g.template ? 'إلغاء كقالب' : 'حفظ كقالب'}</button>` : ''}
          <button data-act="task"><svg class="ic"><use href="#i-plus"/></svg> إضافة مهمة</button>
          ${canEditGoal(g) ? `<button data-act="edit"><svg class="ic"><use href="#i-edit"/></svg> تعديل</button>
          <button data-act="archive"><svg class="ic"><use href="#i-archive"/></svg> ${g.archived ? 'إلغاء الأرشفة' : 'أرشفة'}</button>` : ''}
          ${state.isAdmin ? `<button data-act="access"><svg class="ic"><use href="#i-shield"/></svg> إدارة الوصول</button>` : ''}
          ${canEditGoal(g) ? `<div class="menu-sep"></div><button class="danger" data-act="delete"><svg class="ic"><use href="#i-trash"/></svg> حذف</button>` : ''}
        </div></div>
    </div>
    <div class="goal-meta">
      <span class="badge ${STATUS[st][1]}">${STATUS[st][0]}</span>
      ${g.category ? `<span class="badge cat">${CATEGORIES[g.category] || g.category}</span>` : ''}
      ${g.priority ? priorityBadge(g.priority) : ''}
      ${g.visibility === 'public' ? `<span class="badge cat" title="عام"><svg class="ic"><use href="#i-globe"/></svg></span>` : ''}
    </div>
    ${g.note ? `<p class="goal-note">${esc(g.note)}</p>` : ''}
    <div class="goal-progress">${ring(p, 56, g.color)}<div class="goal-progress-txt"><strong>${ts.length - open}/${ts.length}</strong> مهمة منجزة<br><span class="hint ${n != null && n < 0 && st !== 'done' ? 'c-danger' : n != null && n <= 3 && st !== 'done' ? 'c-warn' : ''}">${st === 'done' ? 'اكتمل الهدف 🎉' : n == null ? '' : n < 0 ? `تجاوز الموعد بـ ${-n} يوم` : n === 0 ? 'ينتهي اليوم' : `باقي ${n} يوم`}</span></div></div>
    <div class="goal-foot">
      <div class="avatars">${(g.assignedUserIds || []).slice(0, 4).map(u => avatar(u, 26)).join('')}${(g.assignedUserIds || []).length > 4 ? `<span class="avatar more">+${g.assignedUserIds.length - 4}</span>` : ''}</div>
      <span class="hint">${fmtDate(g.startDate)} → ${fmtDate(g.endDate)}</span>
    </div>
  </article>`;
}

function bindGoalCards(root) {
  root.querySelectorAll('.goal-card').forEach(card => {
    const id = card.dataset.goal;
    const g = goalById(id);
    card.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) location.hash = 'project/' + id; });
    const btn = card.querySelector('[data-menu]'), menu = card.querySelector('.menu');
    btn.onclick = (e) => { e.stopPropagation(); document.querySelectorAll('.menu').forEach(m => { if (m !== menu) m.hidden = true; }); menu.hidden = !menu.hidden; };
    menu.querySelectorAll('button').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation(); menu.hidden = true;
        const act = b.dataset.act;
        if (act === 'open') openGoalDrawer(id);
        if (act === 'project') location.hash = 'project/' + id;
        if (act === 'template') { await api.updateGoal(id, { template: !g.template }); toast(g.template ? 'لم يعد قالباً' : 'تم الحفظ كقالب', { type: 'ok' }); }
        if (act === 'task') openTaskModal(null, id);
        if (act === 'edit') openGoalModal(g);
        if (act === 'access') openAccessModal(g);
        if (act === 'archive') { await api.updateGoal(id, { archived: !g.archived }); toast(g.archived ? 'تم إلغاء الأرشفة' : 'تمت الأرشفة'); }
        if (act === 'delete') { if (await confirmDialog(`سيتم حذف الهدف «${g.name}» وكل مهامه (${goalTasks(id).length}). لا يمكن التراجع.`, { okLabel: 'حذف' })) { await api.deleteGoal(id); toast('تم حذف الهدف'); } }
      };
    });
  });
}
document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) document.querySelectorAll('.menu').forEach(m => { m.hidden = true; }); });

// ================= المهام =================
export function renderTasks(el) {
  const f = filters.tasks;
  const goals = state.goals.filter(g => !g.template);
  let list = state.tasks.filter(t => goals.some(g => g.id === t.goalId) && !t.parentId);
  if (f.goal !== 'all') list = list.filter(t => t.goalId === f.goal);
  if (f.tag !== 'all') list = list.filter(t => (t.tags || []).includes(f.tag));
  if (f.star) list = list.filter(t => t.starred);
  if (f.assignee === 'me') list = list.filter(t => t.assignedToUid === state.user.uid);
  else if (f.assignee !== 'all') list = list.filter(t => t.assignedToUid === f.assignee);
  if (f.priority !== 'all') list = list.filter(t => (t.priority || 'medium') === f.priority);
  if (f.status === 'open') list = list.filter(t => !t.completed);
  if (f.status === 'done') list = list.filter(t => t.completed);
  if (f.q) list = list.filter(t => (t.name + ' ' + (t.notes || '')).toLowerCase().includes(f.q.toLowerCase()));
  list = sortTasks(list);
  const assignees = [...new Set(state.tasks.map(t => t.assignedToUid).filter(Boolean))];
  const allTags = f.goal !== 'all' ? (goalById(f.goal)?.tags || []) : goals.flatMap(g => (g.tags || []).map(x => ({ ...x, goal: g.name })));
  const saved = (state.profile && state.profile.savedFilters) || [];
  el.innerHTML = `
    <div class="toolbar">
      <div class="view-switch">${[['list', 'قائمة', 'list'], ['kanban', 'كانبان', 'grip'], ['my', 'مهامي', 'user'], ['gantt', 'جانت', 'chart']].map(([k, v, i]) => `<button class="${f.view === k ? 'on' : ''}" data-tview="${k}"><svg class="ic"><use href="#i-${i}"/></svg>${v}</button>`).join('')}</div>
      <div class="seg">${[['open', 'مفتوحة'], ['done', 'منجزة'], ['all', 'الكل']].map(([k, v]) => `<button class="${f.status === k ? 'active' : ''}" data-status="${k}">${v}</button>`).join('')}</div>
      <div class="toolbar-right">
        <div class="search"><svg class="ic"><use href="#i-search"/></svg><input type="search" id="tasksQ" placeholder="ابحث في المهام…" value="${esc(f.q)}"></div>
        <select id="tasksGoal"><option value="all">كل الأهداف</option>${goals.filter(g => !g.archived).map(g => `<option value="${g.id}" ${f.goal === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
        <select id="tasksAssignee"><option value="all">كل المكلّفين</option><option value="me" ${f.assignee === 'me' ? 'selected' : ''}>مهامي</option>${assignees.filter(u => u !== state.user.uid).map(u => `<option value="${u}" ${f.assignee === u ? 'selected' : ''}>${esc(userLabel(u))}</option>`).join('')}</select>
        <select id="tasksPriority"><option value="all">كل الأولويات</option>${Object.entries(PRIORITIES).map(([k, v]) => `<option value="${k}" ${f.priority === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
        ${allTags.length ? `<select id="tasksTag"><option value="all">كل التاجز</option>${allTags.map(x => `<option value="${x.id}" ${f.tag === x.id ? 'selected' : ''}>${esc(x.name)}${x.goal ? ` (${esc(x.goal)})` : ''}</option>`).join('')}</select>` : ''}
        <button class="btn ${f.star ? 'btn-primary' : ''}" id="tasksStar" title="بنجمة">★</button>
        <select id="tasksGroup"><option value="due" ${f.group === 'due' ? 'selected' : ''}>تجميع: الموعد</option><option value="goal" ${f.group === 'goal' ? 'selected' : ''}>تجميع: المشروع</option><option value="stage" ${f.group === 'stage' ? 'selected' : ''}>تجميع: المرحلة</option><option value="priority" ${f.group === 'priority' ? 'selected' : ''}>تجميع: الأولوية</option><option value="none" ${f.group === 'none' ? 'selected' : ''}>بدون تجميع</option></select>
        <button class="btn btn-primary" id="tasksAdd"><svg class="ic"><use href="#i-plus"/></svg> مهمة</button>
      </div>
    </div>
    <div class="saved-filters"><svg class="ic hint"><use href="#i-search"/></svg>${saved.map(s => `<button class="chip ${f.savedId === s.id ? 'on' : ''}" data-sf="${s.id}">${esc(s.name)}</button>`).join('')}<button class="chip" id="sfSave">＋ حفظ الفلتر الحالي</button>${f.savedId ? `<button class="chip" id="sfDel">حذف الفلتر</button>` : ''}</div>
    <form class="quick-add" id="quickAdd"><svg class="ic"><use href="#i-plus"/></svg><input type="text" id="quickAddName" placeholder="إضافة سريعة: اكتب اسم المهمة واضغط Enter (مثال: مراجعة الفصل 3 غداً !عالي)" autocomplete="off"><select id="quickAddGoal">${goals.filter(g => !g.archived).map(g => `<option value="${g.id}" ${f.goal === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select><button type="submit" class="btn btn-primary btn-sm">إضافة</button></form>
    <div id="tasksBody">${f.view === 'list' ? renderTaskGroups(list, f.group) : ''}</div>`;
  if (f.view === 'kanban') renderTasksKanban($('tasksBody'), list, goals);
  if (f.view === 'my') renderMyKanban($('tasksBody'), list);
  if (f.view === 'gantt') renderGantt($('tasksBody'), list, { onOpen: openTask, onChange: (id, p) => api.updateTask(id, p).then(() => toast('تم تحديث التواريخ', { type: 'ok' })) });
  el.querySelectorAll('[data-tview]').forEach(b => { b.onclick = () => { f.view = b.dataset.tview; renderTasks(el); }; });
  el.querySelectorAll('[data-status]').forEach(b => { b.onclick = () => { f.status = b.dataset.status; renderTasks(el); }; });
  const tt = $('tasksTag'); if (tt) tt.onchange = (e) => { f.tag = e.target.value; renderTasks(el); };
  $('tasksStar').onclick = () => { f.star = !f.star; renderTasks(el); };
  el.querySelectorAll('[data-sf]').forEach(b => { b.onclick = () => { const s = saved.find(x => x.id === b.dataset.sf); if (!s) return; if (f.savedId === s.id) { f.savedId = null; Object.assign(f, { q: '', goal: 'all', assignee: 'all', priority: 'all', status: 'open', tag: 'all', star: false }); } else { Object.assign(f, s.filters, { savedId: s.id }); } renderTasks(el); }; });
  $('sfSave').onclick = async () => { const name = await promptDialog('اسم الفلتر', ''); if (!name) return; const { savedId, ...rest } = f; const sf = { id: Date.now().toString(36), name, filters: rest }; await api.updateProfile({ savedFilters: [...saved, sf] }); f.savedId = sf.id; toast('تم حفظ الفلتر', { type: 'ok' }); renderTasks(el); };
  const sd = $('sfDel'); if (sd) sd.onclick = async () => { await api.updateProfile({ savedFilters: saved.filter(x => x.id !== f.savedId) }); f.savedId = null; renderTasks(el); };
  $('tasksQ').oninput = (e) => { f.q = e.target.value; $('tasksBody').innerHTML = renderTaskGroups(applyFilters(), f.group); bindTaskList($('tasksBody')); };
  const applyFilters = () => { renderTasks(el); return []; };
  $('tasksGoal').onchange = (e) => { f.goal = e.target.value; renderTasks(el); };
  $('tasksAssignee').onchange = (e) => { f.assignee = e.target.value; renderTasks(el); };
  $('tasksPriority').onchange = (e) => { f.priority = e.target.value; renderTasks(el); };
  $('tasksGroup').onchange = (e) => { f.group = e.target.value; renderTasks(el); };
  $('tasksAdd').onclick = () => openTaskModal(null, f.goal !== 'all' ? f.goal : null);
  $('quickAdd').onsubmit = async (e) => {
    e.preventDefault();
    const raw = $('quickAddName').value.trim(); if (!raw) return;
    const goalId = $('quickAddGoal').value; if (!goalId) { toast('أضف هدفاً أولاً', { type: 'err' }); return; }
    const parsed = parseQuick(raw);
    await api.createTask({ ...parsed, goalId, assignedToUid: state.user.uid });
    $('quickAddName').value = '';
    toast('تمت إضافة المهمة', { type: 'ok' });
  };
  bindTaskList(el);
}

/** "اسم المهمة غداً !عالي" → { name, dueDate, priority } */
export function parseQuick(raw) {
  let name = raw, dueDate = null, priority = 'medium';
  const pr = name.match(/!(عالي|عالية|مهم|high|متوسط|medium|منخفض|low)/i);
  if (pr) { const v = pr[1].toLowerCase(); priority = /عالي|مهم|high/.test(v) ? 'high' : /منخفض|low/.test(v) ? 'low' : 'medium'; name = name.replace(pr[0], ''); }
  const map = [[/\bاليوم\b|\btoday\b/i, 0], [/\bغدا?ً?\b|\bبكرة\b|\btomorrow\b/i, 1], [/\bبعد غد\b/i, 2], [/\bالأسبوع الجاي\b|\bnext week\b/i, 7]];
  for (const [re, n] of map) if (re.test(name)) { dueDate = isoDate(addDays(new Date(), n)); name = name.replace(re, ''); break; }
  const dm = name.match(/(\d{4}-\d{2}-\d{2})/); if (dm) { dueDate = dm[1]; name = name.replace(dm[0], ''); }
  return { name: name.replace(/\s+/g, ' ').trim(), dueDate, priority };
}

/** كانبان كل المشاريع: الأعمدة باسم المرحلة (مجمّعة عبر المشاريع) */
function renderTasksKanban(container, list, goals) {
  const single = filters.tasks.goal !== 'all' ? goalById(filters.tasks.goal) : null;
  let columns;
  if (single) columns = projectStages(single);
  else {
    const byName = new Map();
    for (const g of goals) for (const s of projectStages(g)) if (!byName.has(s.name)) byName.set(s.name, { id: 'n:' + s.name, name: s.name, color: s.color, fold: s.fold, done: s.done });
    columns = [...byName.values()].sort((a, b) => (a.done - b.done));
  }
  const colOf = (t) => { const g = goalById(t.goalId); const s = taskStage(t, g); return single ? s.id : 'n:' + s.name; };
  kanbanFolded = renderKanban(container, {
    columns, items: list, colOf, folded: kanbanFolded, card: (t) => kanbanCard(t, goalById(t.goalId)), onOpen: openTask,
    onMove: async (taskId, colId, ids) => {
      const t = state.tasks.find(x => x.id === taskId); const g = goalById(t.goalId);
      const s = single ? projectStages(g).find(x => x.id === colId) : projectStages(g).find(x => 'n:' + x.name === colId);
      if (!s) { toast(`المشروع «${g.name}» ليس فيه مرحلة بهذا الاسم`, { type: 'err' }); renderTasks(document.getElementById('view')); return; }
      const p = stagePatch(s); if (s.done && !t.completed) p.completedAt = isDemo() ? Date.now() : window.firebase.firestore.FieldValue.serverTimestamp();
      await api.updateTask(taskId, p); api.reorderTasks(ids).catch(() => {});
      if (s.done && t.recurrence && t.recurrence.freq && !t.completed) spawnRecurrence(t);
    },
    onQuickAdd: single ? (colId, name) => api.createTask({ name, goalId: single.id, stageId: colId, priority: 'medium', assignedToUid: state.user.uid, dueDate: null }) : null,
  });
}

/** مهامي بمراحل شخصية (مستقلة عن مراحل المشروع) */
function renderMyKanban(container, list) {
  const mine = list.filter(t => t.assignedToUid === state.user.uid || (t.assignedUserIds || []).includes(state.user.uid));
  const stages = (state.profile && state.profile.personalStages) || DEFAULT_PERSONAL_STAGES;
  const map = (state.profile && state.profile.personalStageMap) || {};
  const colOf = (t) => { if (t.completed) return (stages.find(s => s.done) || stages[stages.length - 1]).id; const id = map[t.id]; return stages.some(s => s.id === id) ? id : stages[0].id; };
  container.innerHTML = `<p class="hint" style="margin-bottom:.6rem">مراحل شخصية لترتيب يومك — لا تؤثر على مراحل المشروع. ${mine.length} مهمة مكلّف بها.</p><div id="myKan"></div>`;
  renderKanban(container.querySelector('#myKan'), {
    columns: stages, items: mine, colOf, card: (t) => kanbanCard(t, goalById(t.goalId)), onOpen: openTask,
    onMove: async (taskId, colId) => {
      const s = stages.find(x => x.id === colId); const t = state.tasks.find(x => x.id === taskId); if (!s || !t) return;
      const nm = { ...map, [taskId]: colId };
      await api.updateProfile({ personalStageMap: nm });
      if (s.done && !t.completed) { const g = goalById(t.goalId); const p = completionPatch(g, true); p.completedAt = isDemo() ? Date.now() : window.firebase.firestore.FieldValue.serverTimestamp(); await api.updateTask(taskId, p); }
      else if (!s.done && t.completed) await api.updateTask(taskId, completionPatch(goalById(t.goalId), false));
    },
    onColMenu: async (col, btn) => { const n = await promptDialog('اسم المرحلة الشخصية', col.name); if (!n) return; await api.updateProfile({ personalStages: stages.map(s => s.id === col.id ? { ...s, name: n } : s) }); },
  });
}

function renderTaskGroups(list, group) {
  if (!list.length) return emptyState('check', 'لا توجد مهام هنا', 'أضف مهمة من الشريط أعلاه أو غيّر الفلتر.');
  if (group === 'none') return taskList(list, { sortable: true });
  let groups;
  if (group === 'stage') { const m = groupBy(list, t => taskStage(t, goalById(t.goalId)).name); groups = [...m.entries()].map(([k, v]) => [k, v, 'stage']); }
  else if (group === 'due') { const order = ['overdue', 'today', 'week', 'later', 'noDate', 'done']; const m = groupBy(list, taskBucket); groups = order.filter(k => m.has(k)).map(k => [BUCKETS[k], m.get(k), k]); }
  else if (group === 'goal') { const m = groupBy(list, t => t.goalId); groups = [...m.entries()].map(([k, v]) => [goalById(k)?.name || 'هدف غير معروف', v, k]); }
  else { const m = groupBy(list, t => t.priority || 'medium'); groups = ['high', 'medium', 'low'].filter(k => m.has(k)).map(k => [PRIORITIES[k].label, m.get(k), k]); }
  return groups.map(([title, items, key]) => `<section class="task-group ${key}"><h4 class="grp-title ${key === 'overdue' ? 'danger' : key === 'today' ? 'warn' : ''}">${esc(title)} <small>${items.length}</small></h4>${taskList(items, { sortable: true })}</section>`).join('');
}

function taskList(items, { compact = false, sortable = false } = {}) {
  return `<div class="task-list ${sortable ? 'sortable' : ''} ${compact ? 'compact' : ''}">${items.map(t => taskRow(t, compact)).join('')}</div>`;
}

function taskRow(t, compact) {
  const g = goalById(t.goalId);
  const b = taskBucket(t);
  const due = t.dueDate ? `<span class="due ${b === 'overdue' ? 'c-danger' : b === 'today' ? 'c-warn' : ''}"><svg class="ic"><use href="#i-cal"/></svg>${relativeDue(t.dueDate)}</span>` : '';
  const stg = g ? taskStage(t, g) : null; const sp = subtaskProgress(state.tasks, t.id); const cl = checklistProgress(t); const blk = blockers(t, state.tasks);
  const tags = g && g.tags ? g.tags.filter(x => (t.tags || []).includes(x.id)) : [];
  return `<div class="task ${t.completed ? 'done' : ''} ${PRIORITIES[t.priority || 'medium'].cls}" data-task="${t.id}">
    ${!compact ? `<span class="drag" title="اسحب للترتيب"><svg class="ic"><use href="#i-grip"/></svg></span>` : ''}
    <label class="check"><input type="checkbox" ${t.completed ? 'checked' : ''} aria-label="إنجاز"><span></span></label>
    <div class="task-main">
      <div class="task-title">${t.starred ? '<span class="star on sm">★</span> ' : ''}${esc(t.name)}${blk.length ? ' <span class="c-danger" title="محجوبة بمهام أخرى">⛔</span>' : ''}${t.recurrence && t.recurrence.freq ? ' <span class="hint" title="متكررة">🔁</span>' : ''}</div>
      <div class="task-meta">${g ? `<span class="goal-tag" style="--gc:${g.color || '#2563eb'}">${esc(g.name)}</span>` : ''}${stg && !compact ? `<span class="badge" style="background:${stg.color}22;color:${stg.color}">${esc(stg.name)}</span>` : ''}${due}${t.assignedToUid ? `<span class="who">${avatar(t.assignedToUid, 18)} ${esc(userLabel(t.assignedToUid))}</span>` : ''}${sp ? `<span title="مهام فرعية">↳ ${sp.done}/${sp.total}</span>` : ''}${cl ? `<span title="قائمة المراجعة">☑ ${cl.done}/${cl.total}</span>` : ''}${t.plannedHours ? `<span title="ساعات">⏱ ${hoursSpent(t)}/${t.plannedHours}</span>` : ''}${(t.attachments || []).length ? `<span>📎${t.attachments.length}</span>` : ''}${tags.length && !compact ? `<span class="kc-tags">${tags.map(x => `<span class="tag" style="--tc:${x.color}">${esc(x.name)}</span>`).join('')}</span>` : ''}${t.notes ? `<span class="hint" title="${esc(t.notes)}"><svg class="ic"><use href="#i-note"/></svg></span>` : ''}</div>
    </div>
    ${!compact ? priorityBadge(t.priority) : ''}
    <div class="task-actions">
      ${canEditTask(t) ? `<button class="iconbtn" data-act="edit" title="تعديل"><svg class="ic"><use href="#i-edit"/></svg></button><button class="iconbtn danger" data-act="del" title="حذف"><svg class="ic"><use href="#i-trash"/></svg></button>` : ''}
    </div>
  </div>`;
}

function bindTaskList(root) {
  root.querySelectorAll('.task').forEach(row => {
    const id = row.dataset.task;
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    row.querySelector('input[type=checkbox]').onchange = async (e) => {
      const done = e.target.checked;
      row.classList.toggle('done', done);
      try {
        const gx = goalById(t.goalId);
        const p = completionPatch(gx, done); if (done) p.completedAt = isDemo() ? Date.now() : window.firebase.firestore.FieldValue.serverTimestamp();
        await api.updateTask(id, p);
        if (done && t.recurrence && t.recurrence.freq) spawnRecurrence(t);
        if (done) {
          const g = goalById(t.goalId);
          const remaining = goalTasks(t.goalId).filter(x => !x.completed && x.id !== id).length;
          if (g && remaining === 0 && goalTasks(t.goalId).length > 1) celebrate('اكتمل الهدف!', `أنجزت كل مهام «${g.name}». استمر!`);
          else toast(['أحسنت! 👏', 'خطوة للأمام 🚀', 'إنجاز جديد ✅', 'استمر هكذا 🔥'][Math.floor(Math.random() * 4)], { type: 'ok', action: 'تراجع', onAction: () => api.toggleTask(id, false) });
        }
      } catch (err) { console.error(err); toast('تعذّر الحفظ', { type: 'err' }); e.target.checked = !done; }
    };
    const edit = row.querySelector('[data-act="edit"]'); if (edit) edit.onclick = (e) => { e.stopPropagation(); openTask(t.id); };
    const del = row.querySelector('[data-act="del"]'); if (del) del.onclick = async (e) => { e.stopPropagation(); if (await confirmDialog(`حذف المهمة «${t.name}»؟`, { okLabel: 'حذف' })) { await api.deleteTask(id); toast('تم حذف المهمة'); } };
    row.querySelector('.task-title').onclick = () => openTask(t.id);
  });
  if (window.Sortable) {
    root.querySelectorAll('.task-list.sortable').forEach(list => {
      new window.Sortable(list, { animation: 150, handle: '.drag', ghostClass: 'ghost', onEnd: () => { const ids = [...list.querySelectorAll('.task')].map(x => x.dataset.task); api.reorderTasks(ids).catch(() => {}); } });
    });
  }
}

// ================= التقويم =================
export function renderCalendar(el) {
  const base = filters.calendarMonth ? new Date(filters.calendarMonth + '-01T00:00:00') : new Date();
  const y = base.getFullYear(), m = base.getMonth();
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const startOffset = (first.getDay() + 1) % 7; // الأسبوع يبدأ السبت
  const days = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(y, m, d));
  const todayIso = isoDate();
  const tasksByDay = groupBy(state.tasks.filter(t => t.dueDate), t => t.dueDate);
  const goalsByDay = groupBy(state.goals.filter(g => g.endDate && !g.archived), g => g.endDate);
  const sel = filters.calendarSelected || todayIso;
  el.innerHTML = `
    <div class="toolbar">
      <div class="cal-nav"><button class="iconbtn" id="calPrev"><svg class="ic"><use href="#i-next"/></svg></button><h2>${first.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })}</h2><button class="iconbtn" id="calNext"><svg class="ic"><use href="#i-prev"/></svg></button><button class="btn btn-sm" id="calToday">اليوم</button></div>
      <button class="btn btn-primary" id="calAdd"><svg class="ic"><use href="#i-plus"/></svg> مهمة في ${fmtDate(sel)}</button>
    </div>
    <div class="grid-cal">
      <div class="panel cal">
        <div class="cal-head">${['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'].map(d => `<span>${d}</span>`).join('')}</div>
        <div class="cal-grid">${days.map(d => {
          if (!d) return '<span class="cal-cell empty"></span>';
          const iso = isoDate(d); const ts = tasksByDay.get(iso) || []; const gs = goalsByDay.get(iso) || [];
          const open = ts.filter(t => !t.completed).length;
          return `<button class="cal-cell ${iso === todayIso ? 'today' : ''} ${iso === sel ? 'sel' : ''} ${d.getDay() === 5 ? 'fri' : ''}" data-day="${iso}"><span class="cal-num">${d.getDate()}</span>${gs.length ? `<span class="cal-flag" title="${esc(gs.map(g => g.name).join('، '))}">🏁</span>` : ''}${ts.length ? `<span class="cal-dots">${ts.slice(0, 4).map(t => `<i style="background:${t.completed ? 'var(--text-3)' : goalById(t.goalId)?.color || 'var(--primary)'}"></i>`).join('')}${ts.length > 4 ? `<small>+${ts.length - 4}</small>` : ''}</span>` : ''}${open ? `<span class="cal-count">${open}</span>` : ''}</button>`;
        }).join('')}</div>
      </div>
      <div class="panel" id="calDay"></div>
    </div>`;
  const renderDay = (iso) => {
    filters.calendarSelected = iso;
    const ts = sortTasks(tasksByDay.get(iso) || []);
    const gs = goalsByDay.get(iso) || [];
    $('calDay').innerHTML = `<div class="panel-head"><h2>${fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' })}</h2><span class="hint">${relativeDue(iso)}</span></div>
      ${gs.length ? `<h4 class="grp-title">مواعيد نهائية</h4>${gs.map(g => `<div class="mini-goal" data-open-goal="${g.id}">${ring(goalProgress(g), 36, g.color)}<div class="mini-goal-body"><strong>${esc(g.name)}</strong><span class="hint">ينتهي في هذا اليوم</span></div></div>`).join('')}` : ''}
      ${ts.length ? `<h4 class="grp-title">مهام (${ts.length})</h4>${taskList(ts, { compact: true })}` : `<p class="muted">لا مهام في هذا اليوم.</p>`}`;
    el.querySelectorAll('.cal-cell').forEach(c => c.classList.toggle('sel', c.dataset.day === iso));
    $('calAdd').innerHTML = `<svg class="ic"><use href="#i-plus"/></svg> مهمة في ${fmtDate(iso)}`;
    bindTaskList($('calDay'));
    $('calDay').querySelectorAll('[data-open-goal]').forEach(x => { x.onclick = () => openGoalDrawer(x.dataset.openGoal); });
  };
  el.querySelectorAll('.cal-cell[data-day]').forEach(c => { c.onclick = () => renderDay(c.dataset.day); });
  $('calPrev').onclick = () => { filters.calendarMonth = isoDate(new Date(y, m - 1, 1)).slice(0, 7); renderCalendar(el); };
  $('calNext').onclick = () => { filters.calendarMonth = isoDate(new Date(y, m + 1, 1)).slice(0, 7); renderCalendar(el); };
  $('calToday').onclick = () => { filters.calendarMonth = null; filters.calendarSelected = todayIso; renderCalendar(el); };
  $('calAdd').onclick = () => openTaskModal(null, null, filters.calendarSelected || todayIso);
  renderDay(sel.slice(0, 7) === isoDate(first).slice(0, 7) ? sel : isoDate(first));
}

// ================= التقارير =================
let charts = [];
export function renderReports(el) {
  charts.forEach(c => c.destroy()); charts = [];
  const s = stats();
  const goals = visibleGoals();
  const weeks = 8;
  const labels = [], doneW = [], createdW = [];
  const now = new Date(); now.setHours(0, 0, 0, 0);
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(now, -7 * i - now.getDay() - 1); const end = addDays(start, 7);
    labels.push(fmtDate(start, { day: 'numeric', month: 'short' }));
    doneW.push(state.tasks.filter(t => t.completed && toMillis(t.completedAt || t.updatedAt) >= start && toMillis(t.completedAt || t.updatedAt) < end).length);
    createdW.push(state.tasks.filter(t => toMillis(t.createdAt) >= start && toMillis(t.createdAt) < end).length);
  }
  const perUser = [...groupBy(state.tasks.filter(t => t.assignedToUid), t => t.assignedToUid).entries()].map(([u, ts]) => ({ u, total: ts.length, done: ts.filter(t => t.completed).length, late: ts.filter(t => taskBucket(t) === 'overdue').length })).sort((a, b) => b.done - a.done);
  const byCat = [...groupBy(goals, g => g.category || 'other').entries()].map(([k, gs]) => ({ k, n: gs.length, p: Math.round(gs.reduce((a, g) => a + goalProgress(g), 0) / gs.length) }));
  el.innerHTML = `
    <div class="toolbar"><h2><svg class="ic"><use href="#i-chart"/></svg> التقارير</h2><div class="toolbar-right"><button class="btn" id="repCsv"><svg class="ic"><use href="#i-download"/></svg> تصدير CSV</button><button class="btn" id="repPrint"><svg class="ic"><use href="#i-print"/></svg> طباعة</button></div></div>
    <div class="kpis">
      <div class="kpi"><span class="kpi-label">إجمالي المهام</span><span class="kpi-value">${s.tasks}</span></div>
      <div class="kpi"><span class="kpi-label">منجزة</span><span class="kpi-value c-ok">${s.done}</span></div>
      <div class="kpi"><span class="kpi-label">متأخرة</span><span class="kpi-value c-danger">${s.overdue}</span></div>
      <div class="kpi"><span class="kpi-label">نسبة الإنجاز</span><span class="kpi-value">${s.rate}%</span></div>
      <div class="kpi"><span class="kpi-label">أهداف مكتملة</span><span class="kpi-value">${s.completedGoals}/${s.goals}</span></div>
      <div class="kpi"><span class="kpi-label">متوسط أسبوعي</span><span class="kpi-value">${(doneW.reduce((a, b) => a + b, 0) / weeks).toFixed(1)}</span></div>
    </div>
    <div class="grid-2">
      <div class="panel"><h2>الإنجاز خلال 8 أسابيع</h2><div class="chart"><canvas id="chWeeks"></canvas></div></div>
      <div class="panel"><h2>تقدّم الأهداف</h2><div class="goal-bars">${goals.length ? goals.map(g => `<div class="gbar"><span class="gbar-name" title="${esc(g.name)}">${esc(g.name)}</span><div class="progress"><div class="progress-bar" style="width:${goalProgress(g)}%;background:${g.color || 'var(--primary)'}"></div></div><span class="gbar-pct">${goalProgress(g)}%</span></div>`).join('') : '<p class="muted">لا أهداف.</p>'}</div></div>
    </div>
    <div class="grid-2">
      <div class="panel"><h2>حسب المكلّف</h2>${perUser.length ? `<table class="table"><thead><tr><th>المستخدم</th><th>الكل</th><th>منجز</th><th>متأخر</th><th>النسبة</th></tr></thead><tbody>${perUser.map(r => `<tr><td>${avatar(r.u, 22)} ${esc(userLabel(r.u))}</td><td>${r.total}</td><td class="c-ok">${r.done}</td><td class="${r.late ? 'c-danger' : ''}">${r.late}</td><td><div class="progress sm"><div class="progress-bar" style="width:${r.total ? (r.done / r.total) * 100 : 0}%"></div></div></td></tr>`).join('')}</tbody></table>` : '<p class="muted">لا مهام مكلّفة.</p>'}</div>
      <div class="panel"><h2>حسب التصنيف</h2><div class="chart"><canvas id="chCat"></canvas></div></div>
    </div>`;
  $('repCsv').onclick = exportCSV;
  $('repPrint').onclick = () => window.print();
  if (!window.Chart) return;
  const cs = getComputedStyle(document.documentElement);
  const c = { text: cs.getPropertyValue('--text-2').trim(), grid: cs.getPropertyValue('--border').trim(), primary: cs.getPropertyValue('--primary').trim(), ok: cs.getPropertyValue('--success').trim() };
  charts.push(new window.Chart($('chWeeks'), { type: 'bar', data: { labels, datasets: [{ label: 'منجزة', data: doneW, backgroundColor: c.ok + 'cc', borderRadius: 6 }, { label: 'مُضافة', data: createdW, backgroundColor: c.primary + '66', borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { rtl: true, labels: { color: c.text, font: { family: 'Cairo' } } } }, scales: { x: { ticks: { color: c.text }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: c.text, precision: 0 }, grid: { color: c.grid } } } } }));
  if (byCat.length) charts.push(new window.Chart($('chCat'), { type: 'doughnut', data: { labels: byCat.map(x => `${CATEGORIES[x.k] || x.k} (${x.p}%)`), datasets: [{ data: byCat.map(x => x.n), backgroundColor: GOAL_COLORS, borderWidth: 2, borderColor: cs.getPropertyValue('--surface').trim() }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', rtl: true, labels: { color: c.text, font: { family: 'Cairo' }, boxWidth: 12 } } } } }));
}

function exportCSV() {
  const rows = [['الهدف', 'المهمة', 'الموعد', 'الحالة', 'الأولوية', 'المكلّف', 'أُنشئت', 'أُنجزت']];
  for (const t of sortTasks(state.tasks)) rows.push([goalById(t.goalId)?.name || '', t.name, t.dueDate || '', t.completed ? 'منجزة' : 'مفتوحة', PRIORITIES[t.priority || 'medium'].label, userLabel(t.assignedToUid), fmtDateTime(t.createdAt), t.completedAt ? fmtDateTime(t.completedAt) : '']);
  const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `goals-${isoDate()}.csv`; a.click();
}

// ================= الفريق (أدمن) =================
export async function renderTeam(el) {
  if (!state.isAdmin) { el.innerHTML = emptyState('shield', 'هذه الصفحة للمشرفين فقط'); return; }
  el.innerHTML = `<p class="muted">جارٍ التحميل…</p>`;
  await api.loadUsers();
  const rows = state.users.map(u => { const ts = state.tasks.filter(t => t.assignedToUid === u.uid); return { ...u, total: ts.length, done: ts.filter(t => t.completed).length, goals: state.goals.filter(g => (g.assignedUserIds || []).includes(u.uid)).length }; });
  el.innerHTML = `
    <div class="toolbar"><h2><svg class="ic"><use href="#i-users"/></svg> الفريق <small class="hint">${rows.length} مستخدم</small></h2><div class="search"><svg class="ic"><use href="#i-search"/></svg><input type="search" id="teamQ" placeholder="ابحث بالبريد أو الاسم…"></div></div>
    <div class="panel"><div class="table-wrap"><table class="table" id="teamTable"><thead><tr><th>المستخدم</th><th>الدور</th><th>الأهداف</th><th>المهام</th><th>آخر ظهور</th><th></th></tr></thead><tbody>${rows.map(u => `<tr data-uid="${u.uid}" data-q="${esc((u.email || '') + ' ' + (u.displayName || '')).toLowerCase()}">
      <td><div class="who">${avatar(u.uid, 30)}<div><strong>${esc(u.displayName || u.email)}</strong><div class="hint">${esc(u.email || '')}</div></div></div></td>
      <td><span class="badge ${u.role === 'admin' ? 'st-done' : 'cat'}">${u.role === 'admin' ? 'مشرف' : 'مستخدم'}</span></td>
      <td>${u.goals}</td><td>${u.done}/${u.total}</td><td class="hint">${u.lastSeen ? fmtDateTime(u.lastSeen) : '—'}</td>
      <td>${u.uid !== state.user.uid ? `<button class="btn btn-sm" data-role="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'إزالة الإشراف' : 'ترقية لمشرف'}</button>` : '<span class="hint">أنت</span>'}</td>
    </tr>`).join('')}</tbody></table></div></div>`;
  $('teamQ').oninput = (e) => { const q = e.target.value.toLowerCase(); el.querySelectorAll('tbody tr').forEach(tr => { tr.hidden = !tr.dataset.q.includes(q); }); };
  el.querySelectorAll('[data-role]').forEach(b => { b.onclick = async () => { const uid = b.closest('tr').dataset.uid; if (await confirmDialog(`تغيير دور هذا المستخدم إلى ${b.dataset.role === 'admin' ? 'مشرف' : 'مستخدم'}؟`, { danger: false, okLabel: 'تغيير' })) { await api.setRole(uid, b.dataset.role); toast('تم تحديث الدور', { type: 'ok' }); renderTeam(el); } }; });
}

// ================= سجل النشاط =================
export async function renderActivity(el) {
  el.innerHTML = `<p class="muted">جارٍ التحميل…</p>`;
  await api.loadActivity(150);
  const labels = { create: 'أنشأ', update: 'عدّل', delete: 'حذف' };
  const ent = { goal: 'هدفاً', task: 'مهمة', user: 'مستخدماً' };
  const list = state.activity.filter(a => filters.activityType === 'all' || a.entityType === filters.activityType);
  const byDay = groupBy(list, a => isoDate(new Date(toMillis(a.createdAt))));
  el.innerHTML = `<div class="toolbar"><h2><svg class="ic"><use href="#i-history"/></svg> سجل النشاط</h2><div class="seg">${[['all', 'الكل'], ['goal', 'الأهداف'], ['task', 'المهام'], ['user', 'المستخدمون']].map(([k, v]) => `<button class="${filters.activityType === k ? 'active' : ''}" data-t="${k}">${v}</button>`).join('')}</div></div>
    ${list.length ? [...byDay.entries()].map(([day, items]) => `<h4 class="grp-title">${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h4><div class="timeline">${items.map(a => {
      const name = a.payload && (a.payload.name || (a.payload.completed != null ? (a.payload.completed ? 'أنجز' : 'ألغى إنجاز') : '') || (a.payload.role ? `الدور → ${a.payload.role}` : '') || (a.payload.progress != null ? `التقدم ${a.payload.progress}%` : '') || (a.payload.archived != null ? (a.payload.archived ? 'أرشفة' : 'إلغاء أرشفة') : ''));
      const target = a.entityType === 'goal' ? goalById(a.entityId)?.name : a.entityType === 'task' ? state.tasks.find(t => t.id === a.entityId)?.name : userLabel(a.entityId);
      return `<div class="tl-item ${a.actionType}"><span class="tl-dot"></span><div><div><strong>${esc(userLabel(a.actorUid) || a.actorEmail || '—')}</strong> ${labels[a.actionType] || a.actionType} ${ent[a.entityType] || a.entityType}${target ? ` «${esc(target)}»` : ''}${name && name !== target ? ` <span class="hint">(${esc(String(name))})</span>` : ''}</div><span class="hint">${fmtDateTime(a.createdAt)}</span></div></div>`;
    }).join('')}</div>`).join('') : emptyState('history', 'لا يوجد نشاط بعد')}`;
  el.querySelectorAll('[data-t]').forEach(b => { b.onclick = () => { filters.activityType = b.dataset.t; renderActivity(el); }; });
}

// ================= الإعدادات =================
export function renderSettings(el) {
  const p = state.prefs;
  el.innerHTML = `
    <div class="grid-2">
      <div class="stack">
        <div class="panel"><h2>الحساب</h2>
          <div class="who big">${avatar(state.user.uid, 56)}<div><strong>${esc(state.profile?.displayName || state.user.displayName || '')}</strong><div class="hint">${esc(state.user.email)}</div><span class="badge ${state.isAdmin ? 'st-done' : 'cat'}">${state.isAdmin ? 'مشرف' : 'مستخدم'}</span></div></div>
          <label class="field"><span>اسم العرض</span><input type="text" id="setName" maxlength="40" value="${esc(state.profile?.displayName || state.user.displayName || '')}"></label>
          <div class="btn-row"><button class="btn btn-primary btn-sm" id="setNameSave">حفظ</button>${!isDemo() ? `<button class="btn btn-sm" id="setReset">إرسال رابط تغيير كلمة المرور</button>` : ''}</div>
        </div>
        <div class="panel"><h2>التفضيلات</h2>
          <label class="field"><span>المظهر</span><select id="setTheme"><option value="auto" ${p.theme === 'auto' ? 'selected' : ''}>تلقائي (حسب الجهاز)</option><option value="light" ${p.theme === 'light' ? 'selected' : ''}>فاتح</option><option value="dark" ${p.theme === 'dark' ? 'selected' : ''}>داكن</option></select></label>
          <label class="switch"><input type="checkbox" id="setNotify" ${p.notify ? 'checked' : ''}><span>تنبيهات المتصفح للمهام المستحقة اليوم والمتأخرة</span></label>
          <label class="switch"><input type="checkbox" id="setCompact" ${p.compact ? 'checked' : ''}><span>عرض مكثّف (صفوف أقصر)</span></label>
        </div>
      </div>
      <div class="stack">
        <div class="panel"><h2>اختصارات لوحة المفاتيح</h2><table class="table kbd"><tbody>
          <tr><td><kbd>N</kbd></td><td>مهمة جديدة</td></tr><tr><td><kbd>G</kbd></td><td>هدف جديد</td></tr><tr><td><kbd>/</kbd> أو <kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>بحث سريع</td></tr>
          <tr><td><kbd>1</kbd>…<kbd>6</kbd></td><td>التنقل بين الصفحات</td></tr><tr><td><kbd>Esc</kbd></td><td>إغلاق أي نافذة</td></tr></tbody></table></div>
        <div class="panel"><h2>البيانات</h2><div class="btn-row"><button class="btn btn-sm" id="setCsv"><svg class="ic"><use href="#i-download"/></svg> تصدير المهام CSV</button><button class="btn btn-sm" id="setJson"><svg class="ic"><use href="#i-download"/></svg> نسخة JSON</button>${isDemo() ? `<button class="btn btn-danger btn-sm" id="setDemoReset">إعادة تعيين البيانات التجريبية</button>` : ''}</div>
          ${isDemo() ? `<p class="warn" style="margin-top:.75rem">أنت في الوضع التجريبي: البيانات على هذا الجهاز فقط. سجّل الخروج للعودة لشاشة الدخول.</p>` : ''}</div>
        <div class="panel"><h2>عن التطبيق</h2><p class="muted">سجل أهدافي — الإصدار 2.0. أهداف، مهام، فريق، تقويم، تقارير، وسجل نشاط. يعمل بدون إنترنت ويُثبَّت كتطبيق.</p><div class="btn-row"><button class="btn btn-danger btn-sm" id="setSignOut"><svg class="ic"><use href="#i-logout"/></svg> تسجيل الخروج</button></div></div>
      </div>
    </div>`;
  $('setNameSave').onclick = async () => { const v = $('setName').value.trim(); await api.updateProfile({ displayName: v }); toast('تم الحفظ', { type: 'ok' }); };
  const r = $('setReset'); if (r) r.onclick = async () => { try { await api.resetPassword(state.user.email); toast('تم إرسال الرابط إلى بريدك', { type: 'ok' }); } catch { toast('تعذّر الإرسال', { type: 'err' }); } };
  $('setTheme').onchange = (e) => { setPref('theme', e.target.value); };
  $('setNotify').onchange = async (e) => {
    if (e.target.checked) { if (!('Notification' in window)) { e.target.checked = false; return; } const perm = await Notification.requestPermission(); if (perm !== 'granted') { e.target.checked = false; toast('المتصفح رفض التنبيهات', { type: 'err' }); return; } }
    setPref('notify', e.target.checked); if (e.target.checked) toast('التنبيهات مفعّلة', { type: 'ok' });
  };
  $('setCompact').onchange = (e) => setPref('compact', e.target.checked);
  $('setCsv').onclick = exportCSV;
  $('setJson').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ goals: state.goals, tasks: state.tasks }, null, 2)], { type: 'application/json' })); a.download = `goals-backup-${isoDate()}.json`; a.click(); };
  const dr = $('setDemoReset'); if (dr) dr.onclick = async () => { if (await confirmDialog('إعادة البيانات التجريبية لحالتها الأولى؟')) resetDemo(); };
  $('setSignOut').onclick = async () => { if (await confirmDialog('تسجيل الخروج؟', { danger: false, okLabel: 'خروج' })) api.signOut(); };
}

// ================= نافذة الهدف =================
export function openGoalModal(goal) {
  const isEdit = !!goal;
  $('goalModalTitle').textContent = isEdit ? 'تعديل الهدف' : 'هدف جديد';
  $('gName').value = goal ? goal.name : '';
  $('gStart').value = goal ? goal.startDate : isoDate();
  $('gEnd').value = goal ? goal.endDate : isoDate(addDays(new Date(), 30));
  $('gNote').value = goal ? goal.note || '' : '';
  $('gCategory').innerHTML = Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${goal && goal.category === k ? 'selected' : ''}>${v}</option>`).join('');
  if (!goal) $('gCategory').value = 'personal';
  $('gPriority').value = goal ? goal.priority || 'medium' : 'medium';
  const colors = $('gColors'); const cur = goal && goal.color ? goal.color : GOAL_COLORS[0];
  colors.innerHTML = GOAL_COLORS.map(c => `<button type="button" class="swatch ${c === cur ? 'sel' : ''}" style="background:${c}" data-c="${c}" aria-label="${c}"></button>`).join('');
  colors.querySelectorAll('.swatch').forEach(b => { b.onclick = () => { colors.querySelectorAll('.swatch').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); }; });
  $('gPublic').checked = goal ? goal.visibility === 'public' : false;
  $('gDelete').hidden = !isEdit;
  openModal('goalModal');
  $('gDelete').onclick = async () => { if (await confirmDialog(`حذف الهدف «${goal.name}» وكل مهامه؟`, { okLabel: 'حذف' })) { closeModal('goalModal'); await api.deleteGoal(goal.id); toast('تم حذف الهدف'); } };
  $('goalForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('gName').value.trim(); if (!name) return;
    if ($('gEnd').value < $('gStart').value) { toast('تاريخ النهاية قبل البداية', { type: 'err' }); return; }
    const pub = $('gPublic').checked;
    const data = { name, startDate: $('gStart').value, endDate: $('gEnd').value, note: $('gNote').value.trim(), category: $('gCategory').value, priority: $('gPriority').value, color: colors.querySelector('.sel')?.dataset.c || GOAL_COLORS[0], visibility: pub ? 'public' : 'private', visibilityMode: pub ? 'public' : (goal && goal.visibilityMode && goal.visibilityMode !== 'public' ? goal.visibilityMode : 'private') };
    if (!isEdit) { data.stages = DEFAULT_STAGES.map(s => ({ ...s })); data.tags = []; data.milestones = []; data.manager = state.user.uid; }
    const btn = $('goalForm').querySelector('button[type=submit]'); setBusy(btn, true);
    try {
      if (isEdit) { await api.updateGoal(goal.id, data); toast('تم حفظ التعديلات', { type: 'ok' }); closeModal('goalModal'); }
      else { const id = await api.createGoal(data); toast('تم إنشاء المشروع 🎯', { type: 'ok' }); closeModal('goalModal'); location.hash = 'project/' + id; }
    } catch (err) { console.error(err); toast('تعذّر الحفظ', { type: 'err' }); }
    setBusy(btn, false);
  };
}

// ================= نافذة المهمة =================
export function openTaskModal(task, goalId, dueDate) {
  const isEdit = !!task;
  const goals = state.goals.filter(g => !g.archived);
  if (!goals.length) { toast('أضف هدفاً أولاً', { type: 'err', action: 'هدف جديد', onAction: () => openGoalModal() }); return; }
  $('taskModalTitle').textContent = isEdit ? 'تعديل المهمة' : 'مهمة جديدة';
  $('tName').value = task ? task.name : '';
  $('tGoal').innerHTML = goals.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  $('tGoal').value = task ? task.goalId : (goalId || goals[0].id);
  $('tDue').value = task ? task.dueDate || '' : (dueDate || '');
  $('tPriority').value = task ? task.priority || 'medium' : 'medium';
  $('tNotes').value = task ? task.notes || '' : '';
  const fillAssignees = () => {
    const g = goalById($('tGoal').value);
    const ids = new Set([...(g && g.assignedUserIds ? g.assignedUserIds : []), state.user.uid]);
    const opts = [...ids].map(uid => { const u = state.users.find(x => x.uid === uid); return `<option value="${uid}">${esc(u ? (u.displayName || u.email) : uid === state.user.uid ? 'أنا' : uid)}</option>`; });
    $('tAssignee').innerHTML = `<option value="">— بدون مكلّف —</option>${opts.join('')}`;
    $('tAssignee').value = task ? (task.assignedToUid || '') : state.user.uid;
  };
  fillAssignees();
  $('tGoal').onchange = fillAssignees;
  $('tDelete').hidden = !isEdit;
  document.querySelectorAll('#taskModal [data-due]').forEach(b => { b.onclick = () => { $('tDue').value = b.dataset.due === 'none' ? '' : isoDate(addDays(new Date(), Number(b.dataset.due))); }; });
  openModal('taskModal');
  $('tDelete').onclick = async () => { if (await confirmDialog(`حذف المهمة «${task.name}»؟`, { okLabel: 'حذف' })) { closeModal('taskModal'); await api.deleteTask(task.id); toast('تم حذف المهمة'); } };
  $('taskForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('tName').value.trim(); if (!name) return;
    const gsel = goalById($('tGoal').value);
    const data = { name, goalId: $('tGoal').value, dueDate: $('tDue').value || null, priority: $('tPriority').value, notes: $('tNotes').value.trim(), assignedToUid: $('tAssignee').value || null, stageId: task ? task.stageId || null : (projectStages(gsel).find(s => !s.done) || {}).id || null, assignedUserIds: $('tAssignee').value ? [$('tAssignee').value] : [] };
    const btn = $('taskForm').querySelector('button[type=submit]'); setBusy(btn, true);
    try {
      if (isEdit) { await api.updateTask(task.id, data); toast('تم حفظ التعديلات', { type: 'ok' }); }
      else { await api.createTask(data); toast('تمت إضافة المهمة', { type: 'ok' }); }
      closeModal('taskModal');
    } catch (err) { console.error(err); toast('تعذّر الحفظ', { type: 'err' }); }
    setBusy(btn, false);
  };
}

// ================= إدارة الوصول (أدمن) =================
export async function openAccessModal(goal) {
  await api.loadUsers();
  $('aMode').value = goal.visibilityMode || (goal.visibility === 'public' ? 'public' : 'private');
  const list = $('aUsers');
  const render = () => {
    const mode = $('aMode').value;
    const sel = new Set(mode === 'denylist' ? goal.blockedUserIds || [] : goal.assignedUserIds || []);
    $('aUsersWrap').hidden = mode === 'public';
    $('aHint').textContent = { private: 'يرى الهدف المحددون فقط.', public: 'يرى الهدف كل المستخدمين.', allowlist: 'يرى الهدف المحددون فقط (قائمة مسموح بها).', denylist: 'يرى الهدف الجميع ما عدا المحددين.' }[mode];
    list.innerHTML = state.users.map(u => `<label class="user-row"><input type="checkbox" data-uid="${u.uid}" ${sel.has(u.uid) ? 'checked' : ''}>${avatar(u.uid, 26)}<span>${esc(u.displayName || u.email)}</span><small class="hint">${u.role === 'admin' ? 'مشرف' : ''}</small></label>`).join('');
  };
  render();
  $('aMode').onchange = render;
  openModal('accessModal');
  $('aSave').onclick = async () => {
    const mode = $('aMode').value;
    const checked = [...list.querySelectorAll('input:checked')].map(x => x.dataset.uid);
    const patch = { visibility: mode === 'public' ? 'public' : 'private', visibilityMode: mode };
    if (mode === 'private' || mode === 'allowlist') { patch.assignedUserIds = checked.length ? checked : [goal.createdBy]; patch.blockedUserIds = []; }
    else if (mode === 'denylist') { patch.blockedUserIds = checked; patch.assignedUserIds = goal.assignedUserIds || [goal.createdBy]; }
    else { patch.blockedUserIds = []; }
    await api.updateGoal(goal.id, patch);
    closeModal('accessModal'); toast('تم حفظ إعدادات الوصول', { type: 'ok' });
  };
}

// ================= لوحة تفاصيل الهدف (drawer) =================
export function openGoalDrawer(goalId) {
  const g = goalById(goalId); if (!g) return;
  const d = $('drawer');
  const render = () => {
    const gg = goalById(goalId); if (!gg) { closeDrawer(); return; }
    const ts = sortTasks(goalTasks(goalId));
    const p = goalProgress(gg), st = goalStatus(gg), n = daysFromToday(gg.endDate);
    const total = Math.max(1, Math.round((new Date(gg.endDate + 'T00:00:00') - new Date(gg.startDate + 'T00:00:00')) / 86400000));
    const elapsed = Math.round((new Date() - new Date(gg.startDate + 'T00:00:00')) / 86400000);
    const timePct = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
    d.innerHTML = `<div class="drawer-head" style="--gc:${gg.color || '#2563eb'}">
        <button class="iconbtn" id="drawerClose" aria-label="إغلاق"><svg class="ic"><use href="#i-close"/></svg></button>
        <div class="goal-title"><span class="goal-dot"></span><h2>${esc(gg.name)}</h2></div>
        <div class="goal-meta"><span class="badge ${STATUS[st][1]}">${STATUS[st][0]}</span>${gg.category ? `<span class="badge cat">${CATEGORIES[gg.category] || gg.category}</span>` : ''}${priorityBadge(gg.priority || 'medium')}</div>
        ${gg.note ? `<p class="goal-note">${esc(gg.note)}</p>` : ''}
        <div class="drawer-stats">
          <div>${ring(p, 64, gg.color)}<span class="hint">الإنجاز</span></div>
          <div><strong class="big">${ts.filter(t => !t.completed).length}</strong><span class="hint">مهام مفتوحة</span></div>
          <div><strong class="big ${n != null && n < 0 && st !== 'done' ? 'c-danger' : ''}">${n == null ? '—' : n < 0 ? -n : n}</strong><span class="hint">${n != null && n < 0 ? 'يوم تأخير' : 'يوم متبقٍ'}</span></div>
        </div>
        <div class="time-track"><div class="hint">الوقت المنقضي ${timePct}% ${p < timePct - 15 && st !== 'done' ? '<span class="c-warn">· الإنجاز متأخر عن الجدول</span>' : p >= timePct && st !== 'done' ? '<span class="c-ok">· سابق للجدول</span>' : ''}</div><div class="progress sm"><div class="progress-bar" style="width:${timePct}%;background:var(--text-3)"></div></div></div>
        <div class="drawer-people">${(gg.assignedUserIds || []).map(u => `<span class="who">${avatar(u, 22)} ${esc(userLabel(u))}</span>`).join('')}<span class="hint">· أنشأه ${esc(userLabel(gg.createdBy) || gg.createdByEmail || '')} · ${fmtDate(gg.startDate)} → ${fmtDate(gg.endDate)}</span></div>
        <div class="btn-row"><button class="btn btn-primary btn-sm" id="drAddTask"><svg class="ic"><use href="#i-plus"/></svg> مهمة</button>${canEditGoal(gg) ? `<button class="btn btn-sm" id="drEdit"><svg class="ic"><use href="#i-edit"/></svg> تعديل</button>` : ''}${state.isAdmin ? `<button class="btn btn-sm" id="drAccess"><svg class="ic"><use href="#i-shield"/></svg> الوصول</button>` : ''}</div>
      </div>
      <div class="drawer-body">
        <form class="quick-add" id="drQuick"><svg class="ic"><use href="#i-plus"/></svg><input type="text" placeholder="مهمة جديدة لهذا الهدف… (Enter)" autocomplete="off"><button type="submit" class="btn btn-sm btn-primary">إضافة</button></form>
        ${ts.length ? taskList(ts, { sortable: true }) : `<p class="muted">لا مهام بعد. قسّم الهدف لخطوات صغيرة.</p>`}
      </div>`;
    $('drawerClose').onclick = closeDrawer;
    $('drAddTask').onclick = () => openTaskModal(null, goalId);
    const e = $('drEdit'); if (e) e.onclick = () => openGoalModal(gg);
    const a = $('drAccess'); if (a) a.onclick = () => openAccessModal(gg);
    $('drQuick').onsubmit = async (ev) => { ev.preventDefault(); const inp = $('drQuick').querySelector('input'); const v = inp.value.trim(); if (!v) return; await api.createTask({ ...parseQuick(v), goalId, assignedToUid: state.user.uid }); inp.value = ''; };
    bindTaskList(d);
  };
  render();
  d.hidden = false; $('drawerBg').hidden = false;
  requestAnimationFrame(() => d.classList.add('open'));
  drawerRender = render; drawerGoal = goalId;
}
let drawerRender = null, drawerGoal = null;
export function refreshDrawer() { if (drawerRender && !$('drawer').hidden) drawerRender(); }
export function closeDrawer() { const d = $('drawer'); d.classList.remove('open'); setTimeout(() => { d.hidden = true; }, 250); $('drawerBg').hidden = true; drawerRender = null; drawerGoal = null; }
export function drawerOpenGoal() { return drawerGoal; }
