// الفريق (مشرف): الأعضاء، الأدوار، السعر والطاقة، بطاقة العضو.
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
import { errorsPanelHtml } from '../monitor.js';
import { projectStages, taskStage, stagePatch, completionPatch, subtaskProgress, blockers, checklistProgress, cloneFromTemplate, DEFAULT_STAGES, DEFAULT_PERSONAL_STAGES, myActivities, activityState, ACTIVITY_TYPES, hoursSpent } from '../model.js';
import { openTask, spawnRecurrence } from '../task-panel.js';
import { renderKanban } from '../kanban.js';
import { renderGantt } from '../gantt.js';
import { kanbanCard } from '../project-page.js';
import { $, BUCKETS, STATUS, filters, goalById, avatar, priorityBadge, ring, emptyState, weekStart, heatmapHtml, weekStripHtml, workloadHtml, applyGanttChange, stageMovePatch, parseQuick, renderTaskGroups, taskList, taskRow, bindTaskList, exportCSV } from './shared.js';
import { openTaskModal } from './modals.js';
// ================= الفريق (أدمن) =================
let usersLoadedAt = 0;
function memberStats(u) {
  const now = Date.now();
  const ts = state.tasks.filter(t => t.assignedToUid === u.uid || (t.assignedUserIds || []).includes(u.uid));
  const open = ts.filter(t => !t.completed);
  const weekAgo = isoDate(addDays(new Date(), -7));
  const seen = toMillis(u.lastSeen);
  return { ts, open, total: ts.length, done: ts.length - open.length, late: open.filter(t => taskBucket(t) === 'overdue').length, hours: Math.round(ts.reduce((a, t) => a + (t.timesheets || []).filter(x => x.uid === u.uid && x.date >= weekAgo).reduce((b, x) => b + (Number(x.hours) || 0), 0), 0) * 10) / 10, online: !!seen && now - seen < 10 * 60 * 1000, seen, goals: state.goals.filter(g => (g.assignedUserIds || []).includes(u.uid)).length };
}
export function renderTeam(el) {
  if (!state.isAdmin) { el.innerHTML = emptyState('shield', 'هذه الصفحة للمشرفين فقط'); return; }
  // نرسم فوراً من البيانات الحالية، ونحدّث البروفايلات بالخلفية (يُعاد الرسم فقط إذا تغيّر شيء)
  if (Date.now() - usersLoadedAt > 60000) { usersLoadedAt = Date.now(); api.loadUsers().catch(() => {}); }
  if (!state.users.length) { el.innerHTML = `<div class="sk-rows"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`; return; }
  const wl = workload(state.users, state.tasks.filter(t => visibleGoals().some(g => g.id === t.goalId)));
  const rows = state.users.map(u => ({ ...u, ...memberStats(u), wl: wl.find(w => w.uid === u.uid) }));
  const online = rows.filter(r => r.online).length;
  const link = `${location.origin}${location.pathname}`;
  el.innerHTML = `
    <div class="toolbar"><h2><svg class="ic"><use href="#i-users"/></svg> الفريق <small class="hint">${rows.length} عضو · <span class="c-ok">${online} متصل</span></small></h2>
      <div class="toolbar-right"><div class="search"><svg class="ic"><use href="#i-search"/></svg><input type="search" id="teamQ" placeholder="ابحث بالبريد أو الاسم…"></div><button class="btn" id="teamInvite"><svg class="ic"><use href="#i-send"/></svg> دعوة عضو</button></div></div>
    <div class="panel"><div class="table-wrap"><table class="table" id="teamTable"><thead><tr><th>العضو</th><th>الدور</th><th>المشاريع</th><th>مفتوحة</th><th>متأخرة</th><th>منجزة</th><th>ساعات الأسبوع</th><th>سعر الساعة</th><th>الطاقة/أسبوع</th><th>آخر ظهور</th><th></th></tr></thead><tbody>${rows.map(u => `<tr data-uid="${u.uid}" data-q="${esc((u.email || '') + ' ' + (u.displayName || '')).toLowerCase()}">
      <td><div class="who"><span class="online-dot ${u.online ? 'on' : ''}" title="${u.online ? 'متصل الآن' : 'غير متصل'}"></span>${avatar(u.uid, 30)}<div><button class="linkbtn" data-member="${u.uid}"><strong>${esc(u.displayName || u.email)}</strong></button><div class="hint">${esc(u.email || '')}</div></div></div></td>
      <td><span class="badge ${u.role === 'admin' ? 'st-done' : 'cat'}">${u.role === 'admin' ? 'مشرف' : 'مستخدم'}</span></td>
      <td>${u.goals}</td><td>${u.open}${u.wl && u.wl.level === 'over' ? ' <span class="badge st-late" title="مثقل: ' + u.wl.hours + '/' + u.wl.capacity + ' ساعة هذا الأسبوع">مثقل</span>' : u.wl && u.wl.level === 'high' ? ' <span class="badge cat c-warn">مرتفع</span>' : ''}</td><td class="${u.late ? 'c-danger' : ''}">${u.late}</td><td class="c-ok">${u.done}</td><td>${u.hours || '—'}</td>
      <td><input type="number" class="cell-input" data-rate="${u.uid}" value="${u.hourlyRate || ''}" placeholder="0" min="0" title="سعر الساعة"></td><td><input type="number" class="cell-input" data-cap="${u.uid}" value="${u.weeklyCapacity || ''}" placeholder="40" min="1" title="الطاقة الأسبوعية (ساعات)"></td>
      <td class="hint">${u.seen ? fmtDateTime(u.lastSeen) : '—'}</td>
      <td><div class="btn-row" style="margin:0"><button class="btn btn-sm" data-member="${u.uid}">التفاصيل</button>${u.uid !== state.user.uid ? `<button class="btn btn-sm" data-role="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'إزالة الإشراف' : 'ترقية لمشرف'}</button>` : '<span class="hint">أنت</span>'}</div></td>
    </tr>`).join('')}</tbody></table></div></div>
    <div id="teamErrors"></div>`;
  $('teamQ').oninput = (e) => { const q = e.target.value.toLowerCase(); el.querySelectorAll('tbody tr').forEach(tr => { tr.hidden = !tr.dataset.q.includes(q); }); };
  $('teamInvite').onclick = async () => { const email = await promptDialog('بريد العضو الجديد', '', { type: 'email', placeholder: 'name@email.com' }); if (!email) return; const subject = encodeURIComponent('دعوة للانضمام إلى سجل أهدافي'); const body = encodeURIComponent(`مرحباً،\n\nأدعوك للانضمام إلى فريقنا على «سجل أهدافي» لإدارة المشاريع والمهام.\nسجّل حسابك من هنا: ${link}\n\nبعد التسجيل سأضيفك إلى المشاريع.`); window.open(`mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`); copyText(link, 'فتحنا بريدك بالدعوة ونسخنا الرابط'); };
  el.querySelectorAll('[data-role]').forEach(b => { b.onclick = async () => { const uid = b.closest('tr').dataset.uid; if (await confirmDialog(`تغيير دور هذا المستخدم إلى ${b.dataset.role === 'admin' ? 'مشرف' : 'مستخدم'}؟`, { danger: false, okLabel: 'تغيير' })) { await api.setRole(uid, b.dataset.role); toast('تم تحديث الدور', { type: 'ok' }); usersLoadedAt = 0; renderTeam(el); } }; });
  el.querySelectorAll('[data-member]').forEach(b => { b.onclick = () => openMember(b.dataset.member); });
  api.loadClientErrors().then(list => { const box = $('teamErrors'); if (box) box.innerHTML = errorsPanelHtml(list, { title: 'أخطاء واجهة المستخدمين', admin: true }); }).catch(() => {});
  el.querySelectorAll('[data-rate]').forEach(i => { i.onchange = async () => { await api.updateUserProfile(i.dataset.rate, { hourlyRate: Number(i.value) || 0 }); toast('تم حفظ سعر الساعة', { type: 'ok' }); }; });
  el.querySelectorAll('[data-cap]').forEach(i => { i.onchange = async () => { await api.updateUserProfile(i.dataset.cap, { weeklyCapacity: Number(i.value) || 40 }); toast('تم حفظ الطاقة الأسبوعية', { type: 'ok' }); }; });
}

/** بطاقة العضو: إحصائياته ومهامه المفتوحة حسب المشروع + تكليف سريع */
export function openMember(uid) {
  const u = state.users.find(x => x.uid === uid); if (!u) return;
  const s = memberStats(u);
  const byGoal = groupBy(sortTasks(s.open), t => t.goalId);
  $('memberBody').innerHTML = `
    <div class="member-head">${avatar(u.uid, 52)}<div><h2 style="margin:0">${esc(u.displayName || u.email)} <span class="online-dot ${s.online ? 'on' : ''}"></span></h2><div class="hint">${esc(u.email || '')} · ${u.role === 'admin' ? 'مشرف' : 'مستخدم'} · آخر ظهور ${s.seen ? fmtDateTime(u.lastSeen) : '—'}</div></div></div>
    <div class="member-stats"><div><strong>${s.open}</strong><span class="hint">مفتوحة</span></div><div><strong class="${s.late ? 'c-danger' : ''}">${s.late}</strong><span class="hint">متأخرة</span></div><div><strong class="c-ok">${s.done}</strong><span class="hint">منجزة</span></div></div>
    <div class="btn-row"><button class="btn btn-primary btn-sm" id="memberAssign"><svg class="ic"><use href="#i-plus"/></svg> تكليف بمهمة</button><button class="btn btn-sm" id="memberTasks">كل مهامه</button></div>
    ${byGoal.size ? [...byGoal.entries()].map(([gid, ts]) => `<h4 class="grp-title">${esc(goalById(gid)?.name || '—')} <small>${ts.length}</small></h4>${taskList(ts.slice(0, 6), { compact: true })}`).join('') : '<p class="muted" style="margin-top:.8rem">لا مهام مفتوحة.</p>'}`;
  openModal('memberModal');
  bindTaskList($('memberBody'));
  $('memberAssign').onclick = () => { closeModal('memberModal'); const g = state.goals.find(x => !x.archived && !x.template && (x.assignedUserIds || []).includes(uid)); openTaskModal(null, g ? g.id : null, null, uid); };
  $('memberTasks').onclick = () => { closeModal('memberModal'); Object.assign(filters.tasks, { assignee: uid, status: 'open', view: 'list', savedId: null }); location.hash = 'tasks'; window.dispatchEvent(new Event('hashchange')); };
}
