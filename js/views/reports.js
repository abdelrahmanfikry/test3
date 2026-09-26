// التقارير: الرسوم، الالتزام، الساعات، التكلفة، الجدول المحوري.
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
  // الالتزام بالمواعيد، السرعة، الساعات
  const withDue = state.tasks.filter(t => t.completed && t.dueDate && t.completedAt);
  const onTime = withDue.filter(t => isoDate(new Date(toMillis(t.completedAt))) <= t.dueDate).length;
  const onTimeRate = withDue.length ? Math.round((onTime / withDue.length) * 100) : null;
  const velocity = (doneW.slice(-4).reduce((a, b) => a + b, 0) / 4).toFixed(1);
  const since30 = isoDate(addDays(new Date(), -30));
  const sheets = state.tasks.flatMap(t => (t.timesheets || []).filter(x => x.date >= since30).map(x => ({ ...x, task: t })));
  const hours30 = Math.round(sheets.reduce((a, x) => a + (Number(x.hours) || 0), 0) * 10) / 10;
  const byMemberProject = [...groupBy(sheets, x => `${x.uid}|${x.task.goalId}`).entries()].map(([k, xs]) => { const [u, gid] = k.split('|'); return { u, gid, h: Math.round(xs.reduce((a, x) => a + (Number(x.hours) || 0), 0) * 10) / 10 }; }).sort((a, b) => b.h - a.h).slice(0, 12);
  const perProject = goals.filter(g => !g.template).map(g => { const ts = goalTasks(g.id); const open = ts.filter(t => !t.completed); return { g, total: ts.length, open: open.length, done: ts.length - open.length, late: open.filter(t => taskBucket(t) === 'overdue').length, hours: Math.round(ts.reduce((a, t) => a + (t.timesheets || []).reduce((b, x) => b + (Number(x.hours) || 0), 0), 0) * 10) / 10, pct: goalProgress(g) }; }).sort((a, b) => b.open - a.open);
  const costs = goals.filter(g => !g.template).map(g => ({ g, c: projectCost(g, state.tasks, state.users) })).filter(x => x.c.hours || x.c.budget);
  const totalCost = costs.reduce((a, x) => a + x.c.cost, 0);
  const pv = pivot(goals.filter(g => !g.template), state.users, state.tasks, filters.pivotMeasure || 'open');
  el.innerHTML = `
    <div class="toolbar"><h2><svg class="ic"><use href="#i-chart"/></svg> التقارير</h2><div class="toolbar-right"><button class="btn" id="repCsv"><svg class="ic"><use href="#i-download"/></svg> تصدير CSV</button><button class="btn" id="repPrint"><svg class="ic"><use href="#i-print"/></svg> طباعة</button></div></div>
    <div class="kpis">
      <div class="kpi"><span class="kpi-label">إجمالي المهام</span><span class="kpi-value">${s.tasks}</span></div>
      <div class="kpi"><span class="kpi-label">منجزة</span><span class="kpi-value c-ok">${s.done}</span></div>
      <div class="kpi"><span class="kpi-label">متأخرة</span><span class="kpi-value c-danger">${s.overdue}</span></div>
      <div class="kpi"><span class="kpi-label">نسبة الإنجاز</span><span class="kpi-value">${s.rate}%</span></div>
      <div class="kpi"><span class="kpi-label">أهداف مكتملة</span><span class="kpi-value">${s.completedGoals}/${s.goals}</span></div>
      <div class="kpi"><span class="kpi-label">متوسط أسبوعي</span><span class="kpi-value">${(doneW.reduce((a, b) => a + b, 0) / weeks).toFixed(1)}</span></div>
      <div class="kpi"><span class="kpi-label">السرعة (آخر 4 أسابيع)</span><span class="kpi-value">${velocity}<small>/أسبوع</small></span></div>
      <div class="kpi"><span class="kpi-label">الالتزام بالمواعيد</span><span class="kpi-value ${onTimeRate == null ? '' : onTimeRate >= 70 ? 'c-ok' : 'c-warn'}">${onTimeRate == null ? '—' : onTimeRate + '%'}</span></div>
      <div class="kpi"><span class="kpi-label">ساعات مسجّلة (30 يوم)</span><span class="kpi-value">${hours30}<small> س</small></span></div>
    </div>
    <div class="grid-2">
      <div class="panel"><h2>الإنجاز خلال 8 أسابيع</h2><div class="chart"><canvas id="chWeeks"></canvas></div></div>
      <div class="panel"><h2>تقدّم الأهداف</h2><div class="goal-bars">${goals.length ? goals.map(g => `<div class="gbar"><span class="gbar-name" title="${esc(g.name)}">${esc(g.name)}</span><div class="progress"><div class="progress-bar" style="width:${goalProgress(g)}%;background:${g.color || 'var(--primary)'}"></div></div><span class="gbar-pct">${goalProgress(g)}%</span></div>`).join('') : '<p class="muted">لا أهداف.</p>'}</div></div>
    </div>
    <div class="grid-2">
      <div class="panel"><h2>حسب المكلّف</h2>${perUser.length ? `<table class="table"><thead><tr><th>المستخدم</th><th>الكل</th><th>منجز</th><th>متأخر</th><th>النسبة</th></tr></thead><tbody>${perUser.map(r => `<tr><td>${avatar(r.u, 22)} ${esc(userLabel(r.u))}</td><td>${r.total}</td><td class="c-ok">${r.done}</td><td class="${r.late ? 'c-danger' : ''}">${r.late}</td><td><div class="progress sm"><div class="progress-bar" style="width:${r.total ? (r.done / r.total) * 100 : 0}%"></div></div></td></tr>`).join('')}</tbody></table>` : '<p class="muted">لا مهام مكلّفة.</p>'}</div>
      <div class="panel"><h2>حسب التصنيف</h2><div class="chart"><canvas id="chCat"></canvas></div></div>
    </div>
    <div class="grid-2">
      <div class="panel"><h2>حسب المشروع</h2>${perProject.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>المشروع</th><th>مفتوحة</th><th>منجزة</th><th>متأخرة</th><th>ساعات</th><th>التقدّم</th></tr></thead><tbody>${perProject.map(r => `<tr><td><a href="#project/${r.g.id}" class="goal-tag" style="--gc:${r.g.color || '#2563eb'}">${esc(r.g.name)}</a></td><td>${r.open}</td><td class="c-ok">${r.done}</td><td class="${r.late ? 'c-danger' : ''}">${r.late}</td><td>${r.hours || '—'}</td><td><div class="progress sm"><div class="progress-bar" style="width:${r.pct}%;background:${r.g.color || 'var(--primary)'}"></div></div></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">لا مشاريع.</p>'}</div>
      <div class="panel"><h2>الساعات المسجّلة خلال 30 يوماً</h2>${byMemberProject.length ? `<table class="table"><thead><tr><th>العضو</th><th>المشروع</th><th>الساعات</th></tr></thead><tbody>${byMemberProject.map(r => `<tr><td>${avatar(r.u, 22)} ${esc(userLabel(r.u))}</td><td>${esc(goalById(r.gid)?.name || '—')}</td><td><strong>${r.h}</strong></td></tr>`).join('')}</tbody></table>` : '<p class="muted">لا ساعات مسجّلة. سجّل الوقت من بطاقة المهمة أو عبر وضع التركيز 🍅.</p>'}</div>
    </div>
    <div class="grid-2">
      <div class="panel"><h2>التكلفة مقابل الميزانية</h2>${costs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>المشروع</th><th>ساعات</th><th>التكلفة</th><th>الميزانية</th><th>الاستهلاك</th></tr></thead><tbody>${costs.map(({ g, c }) => `<tr><td><a href="#project/${g.id}" class="goal-tag" style="--gc:${g.color || '#2563eb'}">${esc(g.name)}</a></td><td>${c.hours}</td><td><strong>${c.cost.toLocaleString('ar-EG')}</strong></td><td>${c.budget ? c.budget.toLocaleString('ar-EG') : '—'}</td><td>${c.pct != null ? `<div class="progress sm"><div class="progress-bar" style="width:${Math.min(100, c.pct)}%;background:${c.over ? 'var(--danger)' : c.pct > 80 ? 'var(--warning)' : 'var(--success)'}"></div></div><small class="${c.over ? 'c-danger' : ''}">${c.pct}%</small>` : '—'}</td></tr>`).join('')}<tr><td><strong>الإجمالي</strong></td><td></td><td><strong>${totalCost.toLocaleString('ar-EG')}</strong></td><td colspan="2"></td></tr></tbody></table></div><p class="hint">التكلفة = الساعات المسجّلة × سعر ساعة العضو (يضبطه المشرف في صفحة الفريق). الميزانية من إعدادات المشروع.</p>` : '<p class="muted">حدّد سعر الساعة للأعضاء (الفريق) وميزانية المشروع (إعدادات المشروع) لتظهر التكلفة.</p>'}</div>
      <div class="panel"><div class="panel-head"><h2>جدول محوري: مشروع × عضو</h2><select id="pivotMeasure">${[['open', 'مفتوحة'], ['done', 'منجزة'], ['late', 'متأخرة'], ['tasks', 'كل المهام'], ['hours', 'ساعات']].map(([k, v]) => `<option value="${k}" ${(filters.pivotMeasure || 'open') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        ${pv.rows.length ? `<div class="table-wrap"><table class="table pivot"><thead><tr><th>المشروع</th>${pv.cols.map(u => `<th title="${esc(u.email || '')}">${esc((u.displayName || u.email || '').split(' ')[0])}</th>`).join('')}<th>الإجمالي</th></tr></thead><tbody>${pv.rows.map(r => `<tr><td><span class="goal-tag" style="--gc:${r.goal.color || '#2563eb'}">${esc(r.goal.name)}</span></td>${r.cells.map(c => `<td class="${c ? '' : 'hint'}">${c || '·'}</td>`).join('')}<td><strong>${r.total}</strong></td></tr>`).join('')}<tr><td><strong>الإجمالي</strong></td>${pv.totals.map(c => `<td><strong>${c}</strong></td>`).join('')}<td><strong>${pv.grand}</strong></td></tr></tbody></table></div>` : '<p class="muted">لا بيانات.</p>'}</div>
    </div>`;
  $('pivotMeasure').onchange = (e) => { filters.pivotMeasure = e.target.value; renderReports(el); };
  $('repCsv').onclick = exportCSV;
  $('repPrint').onclick = () => window.print();
  ensureChart().then(() => { if ($('chWeeks')) drawReportCharts({ labels, doneW, createdW, byCat }); }).catch(() => {});
}
function drawReportCharts({ labels, doneW, createdW, byCat }) {
  const cs = getComputedStyle(document.documentElement);
  const c = { text: cs.getPropertyValue('--text-2').trim(), grid: cs.getPropertyValue('--border').trim(), primary: cs.getPropertyValue('--primary').trim(), ok: cs.getPropertyValue('--success').trim() };
  charts.push(new window.Chart($('chWeeks'), { type: 'bar', data: { labels, datasets: [{ label: 'منجزة', data: doneW, backgroundColor: c.ok + 'cc', borderRadius: 6 }, { label: 'مُضافة', data: createdW, backgroundColor: c.primary + '66', borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { rtl: true, labels: { color: c.text, font: { family: 'Cairo' } } } }, scales: { x: { ticks: { color: c.text }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: c.text, precision: 0 }, grid: { color: c.grid } } } } }));
  if (byCat.length) charts.push(new window.Chart($('chCat'), { type: 'doughnut', data: { labels: byCat.map(x => `${CATEGORIES[x.k] || x.k} (${x.p}%)`), datasets: [{ data: byCat.map(x => x.n), backgroundColor: GOAL_COLORS, borderWidth: 2, borderColor: cs.getPropertyValue('--surface').trim() }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', rtl: true, labels: { color: c.text, font: { family: 'Cairo' }, boxWidth: 12 } } } } }));
}
