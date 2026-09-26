// نوافذ الهدف والمهمة وإدارة الوصول + لوحة تفاصيل الهدف (drawer).
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
export function openTaskModal(task, goalId, dueDate, assignee) {
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
    const ids = new Set([...(g && g.assignedUserIds ? g.assignedUserIds : []), state.user.uid, ...(assignee ? [assignee] : [])]);
    const opts = [...ids].map(uid => { const u = state.users.find(x => x.uid === uid); return `<option value="${uid}">${esc(u ? (u.displayName || u.email) : uid === state.user.uid ? 'أنا' : uid)}</option>`; });
    $('tAssignee').innerHTML = `<option value="">— بدون مكلّف —</option>${opts.join('')}`;
    $('tAssignee').value = task ? (task.assignedToUid || '') : (assignee || state.user.uid);
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
