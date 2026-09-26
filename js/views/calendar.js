// التقويم: شهر وأسبوع، تصدير ics.
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
import { openTaskModal, openGoalDrawer } from './modals.js';
// ================= التقويم =================
const DAY_NAMES = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
function calViewSeg(cur) { return `<div class="seg">${[['month', 'شهر'], ['week', 'أسبوع']].map(([k, v]) => `<button class="${cur === k ? 'active' : ''}" data-cv="${k}">${v}</button>`).join('')}</div>`; }
function bindCalCommon(el) {
  el.querySelectorAll('[data-cv]').forEach(b => { b.onclick = () => { setPref('calView', b.dataset.cv); renderCalendar(el); }; });
  const ics = $('calIcs'); if (ics) ics.onclick = () => { const goals = visibleGoals().filter(g => !g.template); exportICS(state.tasks.filter(t => goals.some(g => g.id === t.goalId)), 'goals-calendar'); toast('تم تصدير ملف التقويم — استورده في Google Calendar أو Outlook', { type: 'ok' }); };
}

/** عرض الأسبوع: أعمدة الأيام مع سحب المهام بينها لتغيير الموعد */
function renderWeek(el) {
  const ws = weekStart();
  const todayIso = isoDate();
  const sel = filters.calendarSelected || todayIso;
  const base = new Date(sel + 'T00:00:00'); const off = (base.getDay() - ws + 7) % 7; const start = addDays(base, -off);
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i)));
  const goals = visibleGoals().filter(g => !g.template);
  const tasksByDay = groupBy(state.tasks.filter(t => t.dueDate && !t.parentId && goals.some(g => g.id === t.goalId)), t => t.dueDate);
  el.innerHTML = `
    <div class="toolbar">
      <div class="cal-nav"><button class="iconbtn" id="calPrev"><svg class="ic"><use href="#i-next"/></svg></button><h2>${fmtDate(days[0], { day: 'numeric', month: 'short' })} – ${fmtDate(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}</h2><button class="iconbtn" id="calNext"><svg class="ic"><use href="#i-prev"/></svg></button><button class="btn btn-sm" id="calToday">اليوم</button></div>
      <div class="toolbar-right">${calViewSeg('week')}<button class="btn" id="calIcs" title="تصدير إلى Google Calendar / Outlook"><svg class="ic"><use href="#i-download"/></svg> .ics</button><button class="btn btn-primary" id="calAdd"><svg class="ic"><use href="#i-plus"/></svg> مهمة</button></div>
    </div>
    <div class="cal-week">${days.map(iso => { const ts = sortTasks(tasksByDay.get(iso) || []); const d = new Date(iso + 'T00:00:00'); return `<div class="cw-day ${iso === todayIso ? 'today' : ''}" data-day="${iso}"><div class="cw-head"><span>${DAY_NAMES[d.getDay()]}</span><small>${fmtDate(iso, { day: 'numeric', month: 'short' })}</small></div><div class="cw-body" data-body="${iso}">${ts.map(t => `<div class="cw-task ${t.completed ? 'done' : ''}" data-task="${t.id}" style="--gc:${goalById(t.goalId)?.color || '#2563eb'}" title="${esc(t.name)}">${t.starred ? '★ ' : ''}${esc(t.name)}</div>`).join('')}</div><button class="cw-add" data-add="${iso}">+ مهمة</button></div>`; }).join('')}</div>
    <p class="hint">اسحب مهمة بين الأيام لتغيير موعدها · اضغط عليها لفتحها.</p>`;
  bindCalCommon(el);
  $('calPrev').onclick = () => { filters.calendarSelected = isoDate(addDays(start, -7)); renderWeek(el); };
  $('calNext').onclick = () => { filters.calendarSelected = isoDate(addDays(start, 7)); renderWeek(el); };
  $('calToday').onclick = () => { filters.calendarSelected = todayIso; renderWeek(el); };
  $('calAdd').onclick = () => openTaskModal(null, null, sel);
  el.querySelectorAll('[data-add]').forEach(b => { b.onclick = () => openTaskModal(null, null, b.dataset.add); });
  el.querySelectorAll('[data-task]').forEach(x => { x.onclick = () => openTask(x.dataset.task); });
  ensureSortable().then(S => { if (!el.isConnected) return; el.querySelectorAll('.cw-body').forEach(body => new S(body, { group: 'calweek', animation: 150, ghostClass: 'ghost', delay: 120, delayOnTouchOnly: true, onEnd: (ev) => { const iso = ev.to.dataset.body; const t = state.tasks.find(x => x.id === ev.item.dataset.task); if (t && t.dueDate !== iso) api.updateTask(t.id, { dueDate: iso }).then(() => toast(`نُقلت إلى ${fmtDate(iso)}`, { type: 'ok' })); } })); }).catch(() => {});
}

export function renderCalendar(el) {
  if (state.prefs.calView === 'week') { renderWeek(el); return; }
  const base = filters.calendarMonth ? new Date(filters.calendarMonth + '-01T00:00:00') : new Date();
  const y = base.getFullYear(), m = base.getMonth();
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const ws = weekStart();
  const startOffset = (first.getDay() - ws + 7) % 7;
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
      <div class="toolbar-right">${calViewSeg('month')}<button class="btn" id="calIcs" title="تصدير إلى Google Calendar / Outlook"><svg class="ic"><use href="#i-download"/></svg> .ics</button><button class="btn btn-primary" id="calAdd"><svg class="ic"><use href="#i-plus"/></svg> مهمة في ${fmtDate(sel)}</button></div>
    </div>
    <div class="grid-cal">
      <div class="panel cal">
        <div class="cal-head">${Array.from({ length: 7 }, (_, i) => `<span>${DAY_NAMES[(ws + i) % 7]}</span>`).join('')}</div>
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
  bindCalCommon(el);
  el.querySelectorAll('.cal-cell[data-day]').forEach(c => { c.onclick = () => renderDay(c.dataset.day); });
  $('calPrev').onclick = () => { filters.calendarMonth = isoDate(new Date(y, m - 1, 1)).slice(0, 7); renderCalendar(el); };
  $('calNext').onclick = () => { filters.calendarMonth = isoDate(new Date(y, m + 1, 1)).slice(0, 7); renderCalendar(el); };
  $('calToday').onclick = () => { filters.calendarMonth = null; filters.calendarSelected = todayIso; renderCalendar(el); };
  $('calAdd').onclick = () => openTaskModal(null, null, filters.calendarSelected || todayIso);
  renderDay(sel.slice(0, 7) === isoDate(first).slice(0, 7) ? sel : isoDate(first));
}
