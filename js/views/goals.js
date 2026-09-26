// المشاريع (الأهداف): الشبكة، القوالب، قائمة الكارت.
import { state, notify, goalTasks, goalProgress, goalStatus, visibleGoals, taskBucket, sortTasks, stats, userLabel, canEditGoal, canEditTask, setPref, isMine, favorites, isFavorite } from '../store.js';
import { api, isDemo, resetDemo } from '../data.js';
import { esc, fmtDate, fmtDateTime, relativeDue, daysFromToday, isoDate, addDays, toMillis, PRIORITIES, CATEGORIES, GOAL_COLORS, QUOTES, groupBy } from '../utils.js';
import { toast, openModal, closeModal, confirmDialog, promptDialog, celebrate, setBusy, copyText } from '../ui.js';
import { ensureSortable, ensureChart } from '../lib.js';
import { bulk, toggleBulk, bulkCheckbox, bindBulk, snoozeMenu, deleteTaskWithUndo, deleteGoalWithUndo } from '../bulk.js';
import { exportJSON, importJSON, exportICS, exportProject, duplicateProject } from '../backup.js';
import { openFocus, sessionsToday } from '../focus.js';
import { workload, rebalanceSuggestions, projectCost, pivot } from '../analytics.js';
import { templatePicker, templatesHtml, bindTemplates } from '../templates.js';
import { voiceButton, tasksFromPhoto } from '../capture.js';
import { hasAI, aiKey, setAiKey, AI_MODEL } from '../ai.js';
import { enablePush, pushEnabled } from '../notify.js';
import { previewDigest } from '../digest.js';
import { stageAutomationPatch, wipStatus } from '../model.js';
import { applyLang } from '../i18n.js';
import { projectStages, taskStage, stagePatch, completionPatch, subtaskProgress, blockers, checklistProgress, cloneFromTemplate, DEFAULT_STAGES, DEFAULT_PERSONAL_STAGES, myActivities, activityState, ACTIVITY_TYPES, hoursSpent } from '../model.js';
import { openTask, spawnRecurrence } from '../task-panel.js';
import { renderKanban } from '../kanban.js';
import { renderGantt } from '../gantt.js';
import { kanbanCard } from '../project-page.js';
import { $, BUCKETS, STATUS, filters, goalById, avatar, priorityBadge, ring, emptyState, weekStart, heatmapHtml, weekStripHtml, workloadHtml, applyGanttChange, stageMovePatch, parseQuick, renderTaskGroups, taskList, taskRow, bindTaskList, exportCSV } from './shared.js';
import { openGoalModal, openTaskModal, openAccessModal, openGoalDrawer } from './modals.js';
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
          <button data-act="fav"><svg class="ic"><use href="#i-star"/></svg> ${isFavorite(g.id) ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}</button>
          <button data-act="dup"><svg class="ic"><use href="#i-copy"/></svg> نسخ المشروع</button>
          <button data-act="export"><svg class="ic"><use href="#i-download"/></svg> تصدير JSON</button>
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
        if (act === 'fav') { const f = favorites(); await api.updateProfile({ favorites: f.includes(id) ? f.filter(x => x !== id) : [...f, id].slice(-8) }); toast(f.includes(id) ? 'أُزيل من المفضلة' : 'أُضيف إلى المفضلة ★', { type: 'ok' }); }
        if (act === 'dup') duplicateProject(g);
        if (act === 'export') exportProject(g);
        if (act === 'template') { await api.updateGoal(id, { template: !g.template }); toast(g.template ? 'لم يعد قالباً' : 'تم الحفظ كقالب', { type: 'ok' }); }
        if (act === 'task') openTaskModal(null, id);
        if (act === 'edit') openGoalModal(g);
        if (act === 'access') openAccessModal(g);
        if (act === 'archive') { await api.updateGoal(id, { archived: !g.archived }); toast(g.archived ? 'تم إلغاء الأرشفة' : 'تمت الأرشفة'); }
        if (act === 'delete') deleteGoalWithUndo(g, goalTasks(id).length);
      };
    });
  });
}
document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) document.querySelectorAll('.menu').forEach(m => { m.hidden = true; }); });
