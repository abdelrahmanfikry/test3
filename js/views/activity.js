// سجل النشاط.
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
