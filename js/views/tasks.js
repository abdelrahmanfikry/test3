// صفحة المهام: قائمة/كانبان/مهامي/جانت، الفلاتر المحفوظة، الإضافة السريعة.
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
import { openTaskModal } from './modals.js';
let kanbanFolded = null;

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
        ${f.view === 'list' ? `<button class="btn ${bulk.on ? 'btn-primary' : ''}" id="tasksSelect" title="تحديد متعدد">☑</button>` : ''}
        <select id="tasksGroup"><option value="due" ${f.group === 'due' ? 'selected' : ''}>تجميع: الموعد</option><option value="goal" ${f.group === 'goal' ? 'selected' : ''}>تجميع: المشروع</option><option value="stage" ${f.group === 'stage' ? 'selected' : ''}>تجميع: المرحلة</option><option value="priority" ${f.group === 'priority' ? 'selected' : ''}>تجميع: الأولوية</option><option value="none" ${f.group === 'none' ? 'selected' : ''}>بدون تجميع</option></select>
        <button class="btn btn-primary" id="tasksAdd"><svg class="ic"><use href="#i-plus"/></svg> مهمة</button>
      </div>
    </div>
    <div class="saved-filters"><svg class="ic hint"><use href="#i-search"/></svg>${saved.map(s => `<button class="chip ${f.savedId === s.id ? 'on' : ''}" data-sf="${s.id}">${esc(s.name)}</button>`).join('')}<button class="chip" id="sfSave">＋ حفظ الفلتر الحالي</button>${f.savedId ? `<button class="chip" id="sfDel">حذف الفلتر</button>` : ''}</div>
    <form class="quick-add" id="quickAdd"><svg class="ic"><use href="#i-plus"/></svg><input type="text" id="quickAddName" placeholder="إضافة سريعة: اكتب اسم المهمة واضغط Enter (مثال: مراجعة الفصل 3 غداً !عالي)" autocomplete="off"><span id="quickVoice"></span><button type="button" class="iconbtn" id="quickPhoto" title="مهام من صورة (ذكاء اصطناعي)"><svg class="ic"><use href="#i-camera"/></svg></button><button type="button" class="iconbtn" id="quickTpl" title="من قالب مهمة"><svg class="ic"><use href="#i-copy"/></svg></button><select id="quickAddGoal">${goals.filter(g => !g.archived).map(g => `<option value="${g.id}" ${f.goal === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select><button type="submit" class="btn btn-primary btn-sm">إضافة</button></form>
    <div id="tasksBody">${f.view === 'list' ? renderTaskGroups(list, f.group) : ''}</div>`;
  if (f.view === 'kanban') renderTasksKanban($('tasksBody'), list, goals);
  if (f.view === 'my') renderMyKanban($('tasksBody'), list);
  if (f.view === 'gantt') renderGantt($('tasksBody'), list, { onOpen: openTask, onChange: (id, p, shifts) => applyGanttChange(id, p, shifts) });
  $('quickVoice').appendChild(voiceButton($('quickAddName'), { onResult: () => $('quickAdd').requestSubmit() }));
  $('quickPhoto').onclick = () => tasksFromPhoto({ goalId: $('quickAddGoal').value || null });
  $('quickTpl').onclick = (e) => templatePicker(e.currentTarget, $('quickAddGoal').value, (id) => openTask(id));
  el.querySelectorAll('[data-tview]').forEach(b => { b.onclick = () => { f.view = b.dataset.tview; renderTasks(el); }; });
  el.querySelectorAll('[data-status]').forEach(b => { b.onclick = () => { f.status = b.dataset.status; renderTasks(el); }; });
  const tt = $('tasksTag'); if (tt) tt.onchange = (e) => { f.tag = e.target.value; renderTasks(el); };
  $('tasksStar').onclick = () => { f.star = !f.star; renderTasks(el); };
  const tsel = $('tasksSelect'); if (tsel) tsel.onclick = () => { toggleBulk(); renderTasks(el); };
  if (f.view === 'list') bindBulk(el, () => renderTasks(el));
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

/** تغيير تواريخ من الجانت مع عرض إزاحة المهام التابعة */

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
      const p = stageMovePatch(t, g, s);
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
