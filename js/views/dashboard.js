// لوحة التحكم.
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
import { openTaskModal, openGoalModal } from './modals.js';
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
        <button class="btn" data-act="focus" title="وضع التركيز (F)">🍅 تركيز${sessionsToday() ? ` <small>${sessionsToday()}</small>` : ''}</button>
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
    </div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h2><svg class="ic"><use href="#i-cal"/></svg> الأيام السبعة القادمة</h2><a href="#calendar" class="link">التقويم →</a></div>${weekStripHtml(myOpen)}</div>
      <div class="panel"><div class="panel-head"><h2><svg class="ic"><use href="#i-chart"/></svg> إنجازك خلال 12 أسبوعاً</h2><a href="#reports" class="link">التقارير →</a></div>${heatmapHtml()}</div>
    </div>
    ${state.users.length > 1 ? `<div class="panel"><div class="panel-head"><h2><svg class="ic"><use href="#i-users"/></svg> عبء العمل على الفريق (7 أيام)</h2>${state.isAdmin ? '<a href="#team" class="link">الفريق →</a>' : ''}</div>${workloadHtml()}</div>` : ''}`;
  bindTaskList(el);
  el.querySelector('[data-act="add-task"]').onclick = () => openTaskModal();
  el.querySelector('[data-act="add-goal"]').onclick = () => openGoalModal();
  el.querySelector('[data-act="focus"]').onclick = () => openFocus();
  el.querySelectorAll('.week-day').forEach(b => { b.onclick = () => { filters.calendarSelected = b.dataset.day; filters.calendarMonth = b.dataset.day.slice(0, 7); location.hash = 'calendar'; }; });
  const rb = el.querySelector('[data-rebalance]'); if (rb) rb.onclick = () => { Object.assign(filters.tasks, { assignee: rb.dataset.rebalance, status: 'open', view: 'list', savedId: null }); toggleBulk(); if (!bulk.on) toggleBulk(); location.hash = 'tasks'; window.dispatchEvent(new Event('hashchange')); toast('حدّد المهام ثم «المكلّف» من الشريط السفلي لنقلها', { ms: 5000 }); };
  el.querySelectorAll('[data-open-goal]').forEach(x => { x.onclick = () => { location.hash = 'project/' + x.dataset.openGoal; }; });
  el.querySelectorAll('[data-open-task]').forEach(x => { x.onclick = () => openTask(x.dataset.openTask, 'activities'); });
}
