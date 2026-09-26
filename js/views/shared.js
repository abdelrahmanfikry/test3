// مكوّنات مشتركة بين الشاشات: ثوابت، أفاتار، حلقات، قائمة المهام وصفوفها، أدوات الجانت/المراحل، CSV.
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
export const $ = (id) => document.getElementById(id);
export const BUCKETS = { overdue: 'متأخرة', today: 'اليوم', week: 'هذا الأسبوع', later: 'لاحقاً', noDate: 'بدون موعد', done: 'منجزة' };
export const STATUS = { active: ['نشط', 'st-active'], late: ['متأخر', 'st-late'], done: ['مكتمل', 'st-done'], archived: ['مؤرشف', 'st-archived'] };

export const filters = { goals: { q: '', status: 'all', category: 'all', sort: 'created', templates: false }, tasks: { q: '', goal: 'all', assignee: 'all', priority: 'all', status: 'open', group: 'due', view: 'list', tag: 'all', star: false, savedId: null }, calendarMonth: null, activityType: 'all' };

// ================= مكوّنات صغيرة =================
export function goalById(id) { return state.goals.find(g => g.id === id); }
export function avatar(uid, size = 24) {
  const u = state.users.find(x => x.uid === uid);
  const name = u ? (u.displayName || u.email || '?') : '?';
  const initials = name.trim().slice(0, 1).toUpperCase();
  const hue = [...(uid || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  if (u && u.photoURL) return `<img class="avatar" src="${esc(u.photoURL)}" alt="${esc(name)}" title="${esc(name)}" style="width:${size}px;height:${size}px" referrerpolicy="no-referrer">`;
  return `<span class="avatar" title="${esc(name)}" style="width:${size}px;height:${size}px;background:hsl(${hue} 60% 45%)">${esc(initials)}</span>`;
}
export function priorityBadge(p) { const x = PRIORITIES[p || 'medium']; return `<span class="badge ${x.cls}">${x.label}</span>`; }
export function ring(pct, size = 44, color) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" style="stroke:${color || 'var(--primary)'};stroke-dasharray:${c};stroke-dashoffset:${c * (1 - pct / 100)}"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle">${pct}%</text></svg>`;
}
export function emptyState(icon, title, sub, btn) {
  return `<div class="empty"><svg class="ic big"><use href="#i-${icon}"/></svg><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}${btn || ''}</div>`;
}
export function weekStart() { return Number(state.prefs.weekStart) === 1 ? 1 : 6; }

/** خريطة حرارية للإنجاز خلال 12 أسبوعاً */
export function heatmapHtml() {
  const counts = {};
  state.tasks.filter(t => t.completed).forEach(t => { const d = isoDate(new Date(toMillis(t.completedAt || t.updatedAt))); counts[d] = (counts[d] || 0) + 1; });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const off = (today.getDay() - weekStart() + 7) % 7;
  const start = addDays(today, -(off + 7 * 11));
  const max = Math.max(1, ...Object.values(counts));
  let cells = '';
  for (let i = 0; i < 84; i++) {
    const d = addDays(start, i); const iso = isoDate(d); const n = counts[iso] || 0;
    if (d > today) { cells += '<i style="visibility:hidden"></i>'; continue; }
    const lvl = !n ? '' : n >= max * 0.66 ? 'l3' : n >= max * 0.33 ? 'l2' : 'l1';
    cells += `<i class="${lvl} ${iso === isoDate(today) ? 'today' : ''}" title="${fmtDate(iso)}: ${n} مهمة"></i>`;
  }
  return `<div class="heatmap">${cells}</div><div class="heat-legend">أقل <i style="background:var(--surface-3)"></i><i style="background:color-mix(in srgb, var(--success) 35%, var(--surface-3))"></i><i style="background:color-mix(in srgb, var(--success) 60%, var(--surface-3))"></i><i style="background:var(--success)"></i> أكثر</div>`;
}
export function weekStripHtml(openTasks) {
  return `<div class="week-strip">${Array.from({ length: 7 }, (_, i) => { const d = addDays(new Date(), i); const iso = isoDate(d); const n = openTasks.filter(t => t.dueDate === iso).length; return `<button class="week-day ${i === 0 ? 'today' : ''} ${n >= 4 ? 'busy' : ''}" data-day="${iso}"><span class="wd-name">${i === 0 ? 'اليوم' : i === 1 ? 'غداً' : d.toLocaleDateString('ar-EG', { weekday: 'short' })}</span><span class="wd-num">${d.getDate()}</span><span class="wd-count">${n ? `${n} مهمة` : '—'}</span></button>`; }).join('')}</div>`;
}
/** عبء العمل الذكي: ساعات الأسبوع القادم مقابل طاقة كل عضو + اقتراح إعادة توزيع */
export function workloadHtml() {
  const goals = visibleGoals().filter(g => !g.template); const gid = new Set(goals.map(g => g.id));
  const rows = workload(state.users, state.tasks.filter(t => gid.has(t.goalId))).filter(r => r.tasks);
  if (!rows.length) return '<p class="muted">لا مهام مستحقة خلال الأسبوع القادم.</p>';
  const sug = rebalanceSuggestions(rows);
  const LV = { over: ['مثقل', 'c-danger'], high: ['مرتفع', 'c-warn'], ok: ['مناسب', 'c-ok'], free: ['متاح', ''] };
  return `<div class="workload">${rows.map(r => `<div class="wl-row"><span class="who">${avatar(r.uid, 20)} ${esc(r.name)}</span><div class="wl-bar" title="${r.hours} من ${r.capacity} ساعة"><i class="late" style="width:${Math.min(100, (r.late / Math.max(1, r.tasks)) * Math.min(100, r.ratio * 100))}%"></i><i class="open ${r.level}" style="width:${Math.min(100, r.ratio * 100) - Math.min(100, (r.late / Math.max(1, r.tasks)) * Math.min(100, r.ratio * 100))}%"></i></div><span class="hint"><span class="${LV[r.level][1]}">${LV[r.level][0]}</span> · ${r.hours}/${r.capacity} س · ${r.tasks} مهمة${r.late ? ` · <span class="c-danger">${r.late} متأخرة</span>` : ''}</span></div>`).join('')}</div>
    ${sug.length ? `<div class="alert bad" style="margin-top:.6rem">⚠️ ${sug.map(s => `<strong>${esc(s.from.name)}</strong> مثقل بـ ${s.excess} ساعة فوق طاقته${s.to ? ` — اقتراح: انقل جزءاً إلى <strong>${esc(s.to.name)}</strong> (${s.to.hours}/${s.to.capacity} س)` : ''}`).join(' · ')} <button class="linkbtn" data-rebalance="${sug[0].from.uid}">افتح مهامه للتوزيع</button></div>` : ''}`;
}

export async function applyGanttChange(id, p, shifts) {
  await api.updateTask(id, p);
  if (shifts && shifts.length && await confirmDialog(`تأخرت هذه المهمة، و${shifts.length} مهمة تعتمد عليها تبدأ قبل انتهائها. إزاحتها تلقائياً بنفس الفارق؟`, { danger: false, okLabel: 'إزاحة التابعة', title: 'اعتماديات' })) {
    for (const s of shifts) { const { id: sid, ...dates } = s; await api.updateTask(sid, dates); }
    toast(`تم تحديث التواريخ وإزاحة ${shifts.length} مهمة تابعة`, { type: 'ok' });
  } else toast('تم تحديث التواريخ', { type: 'ok' });
}

/** نقل مهمة إلى مرحلة مع الأتمتة وحد WIP (مشترك بين الكانبان وبطاقة المهمة) */
export function stageMovePatch(t, g, s) {
  const p = { ...stagePatch(s), ...stageAutomationPatch(s, t) };
  if (s.done && !t.completed) p.completedAt = isDemo() ? Date.now() : window.firebase.firestore.FieldValue.serverTimestamp();
  const w = wipStatus(s, g, state.tasks.filter(x => x.id !== t.id));
  if (w.full) toast(`⚠️ مرحلة «${s.name}» وصلت حدّها (${w.count + 1}/${w.limit})`, { type: 'err', ms: 4000 });
  if (p.assignedUserIds) toast(`تكليف تلقائي: ${userLabel(s.autoAssign)}`, { ms: 2500 });
  return p;
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

export function renderTaskGroups(list, group) {
  if (!list.length) return emptyState('check', 'لا توجد مهام هنا', 'أضف مهمة من الشريط أعلاه أو غيّر الفلتر.');
  if (group === 'none') return taskList(list, { sortable: true });
  let groups;
  if (group === 'stage') { const m = groupBy(list, t => taskStage(t, goalById(t.goalId)).name); groups = [...m.entries()].map(([k, v]) => [k, v, 'stage']); }
  else if (group === 'due') { const order = ['overdue', 'today', 'week', 'later', 'noDate', 'done']; const m = groupBy(list, taskBucket); groups = order.filter(k => m.has(k)).map(k => [BUCKETS[k], m.get(k), k]); }
  else if (group === 'goal') { const m = groupBy(list, t => t.goalId); groups = [...m.entries()].map(([k, v]) => [goalById(k)?.name || 'هدف غير معروف', v, k]); }
  else { const m = groupBy(list, t => t.priority || 'medium'); groups = ['high', 'medium', 'low'].filter(k => m.has(k)).map(k => [PRIORITIES[k].label, m.get(k), k]); }
  return groups.map(([title, items, key]) => `<section class="task-group ${key}"><h4 class="grp-title ${key === 'overdue' ? 'danger' : key === 'today' ? 'warn' : ''}">${esc(title)} <small>${items.length}</small></h4>${taskList(items, { sortable: true })}</section>`).join('');
}

export function taskList(items, { compact = false, sortable = false } = {}) {
  return `<div class="task-list ${sortable ? 'sortable' : ''} ${compact ? 'compact' : ''}">${items.map(t => taskRow(t, compact)).join('')}</div>`;
}

export function taskRow(t, compact) {
  const g = goalById(t.goalId);
  const b = taskBucket(t);
  const due = t.dueDate ? `<span class="due ${b === 'overdue' ? 'c-danger' : b === 'today' ? 'c-warn' : ''}"><svg class="ic"><use href="#i-cal"/></svg>${relativeDue(t.dueDate)}</span>` : '';
  const stg = g ? taskStage(t, g) : null; const sp = subtaskProgress(state.tasks, t.id); const cl = checklistProgress(t); const blk = blockers(t, state.tasks);
  const tags = g && g.tags ? g.tags.filter(x => (t.tags || []).includes(x.id)) : [];
  return `<div class="task ${t.completed ? 'done' : ''} ${PRIORITIES[t.priority || 'medium'].cls}" data-task="${t.id}">
    ${!compact ? (bulk.on ? bulkCheckbox(t) : `<span class="drag" title="اسحب للترتيب"><svg class="ic"><use href="#i-grip"/></svg></span>`) : ''}
    <label class="check"><input type="checkbox" ${t.completed ? 'checked' : ''} aria-label="إنجاز"><span></span></label>
    <div class="task-main">
      <div class="task-title">${t.starred ? '<span class="star on sm">★</span> ' : ''}${esc(t.name)}${blk.length ? ' <span class="c-danger" title="محجوبة بمهام أخرى">⛔</span>' : ''}${t.recurrence && t.recurrence.freq ? ' <span class="hint" title="متكررة">🔁</span>' : ''}</div>
      <div class="task-meta">${g ? `<span class="goal-tag" style="--gc:${g.color || '#2563eb'}">${esc(g.name)}</span>` : ''}${stg && !compact ? `<span class="badge" style="background:${stg.color}22;color:${stg.color}">${esc(stg.name)}</span>` : ''}${due}${t.assignedToUid ? `<span class="who">${avatar(t.assignedToUid, 18)} ${esc(userLabel(t.assignedToUid))}</span>` : ''}${sp ? `<span title="مهام فرعية">↳ ${sp.done}/${sp.total}</span>` : ''}${cl ? `<span title="قائمة المراجعة">☑ ${cl.done}/${cl.total}</span>` : ''}${t.plannedHours ? `<span title="ساعات">⏱ ${hoursSpent(t)}/${t.plannedHours}</span>` : ''}${(t.attachments || []).length ? `<span>📎${t.attachments.length}</span>` : ''}${tags.length && !compact ? `<span class="kc-tags">${tags.map(x => `<span class="tag" style="--tc:${x.color}">${esc(x.name)}</span>`).join('')}</span>` : ''}${t.notes ? `<span class="hint" title="${esc(t.notes)}"><svg class="ic"><use href="#i-note"/></svg></span>` : ''}</div>
    </div>
    ${!compact ? priorityBadge(t.priority) : ''}
    <div class="task-actions">
      ${canEditTask(t) ? `${!t.completed ? `<button class="iconbtn" data-act="snooze" title="تأجيل"><svg class="ic"><use href="#i-timer"/></svg></button>` : ''}<button class="iconbtn" data-act="edit" title="تعديل"><svg class="ic"><use href="#i-edit"/></svg></button><button class="iconbtn danger" data-act="del" title="حذف"><svg class="ic"><use href="#i-trash"/></svg></button>` : ''}
    </div>
  </div>`;
}

export function bindTaskList(root) {
  root.querySelectorAll('.task').forEach(row => {
    const id = row.dataset.task;
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    row.querySelector('label.check:not(.sel) input[type=checkbox]').onchange = async (e) => {
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
    const del = row.querySelector('[data-act="del"]'); if (del) del.onclick = (e) => { e.stopPropagation(); deleteTaskWithUndo(t); };
    const sn = row.querySelector('[data-act="snooze"]'); if (sn) sn.onclick = (e) => { e.stopPropagation(); snoozeMenu(t, sn); };
    row.querySelector('.task-title').onclick = () => openTask(t.id);
  });
  if (!bulk.on && root.querySelector('.task-list.sortable')) ensureSortable().then(S => {
    if (!root.isConnected) return;
    root.querySelectorAll('.task-list.sortable').forEach(list => {
      new S(list, { animation: 150, handle: '.drag', ghostClass: 'ghost', onEnd: () => { const ids = [...list.querySelectorAll('.task')].map(x => x.dataset.task); api.reorderTasks(ids).catch(() => {}); } });
    });
  }).catch(() => {});
}


export function exportCSV() {
  const rows = [['الهدف', 'المهمة', 'الموعد', 'الحالة', 'الأولوية', 'المكلّف', 'أُنشئت', 'أُنجزت']];
  for (const t of sortTasks(state.tasks)) rows.push([goalById(t.goalId)?.name || '', t.name, t.dueDate || '', t.completed ? 'منجزة' : 'مفتوحة', PRIORITIES[t.priority || 'medium'].label, userLabel(t.assignedToUid), fmtDateTime(t.createdAt), t.completedAt ? fmtDateTime(t.completedAt) : '']);
  const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `goals-${isoDate()}.csv`; a.click();
}
