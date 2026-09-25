// صفحة المشروع (على طريقة Odoo): نظرة عامة، كانبان، قائمة، جانت، معالم، إعدادات (مراحل، تاجز، خصوصية، قالب).
import { state, sortTasks, userLabel, canEditGoal, goalProgress, isFavorite, favorites } from './store.js';
import { api, isDemo } from './data.js';
import { esc, fmtDate, relativeDue, isoDate, addDays, uid, PRIORITIES, CATEGORIES, daysFromToday } from './utils.js';
import { toast, confirmDialog, promptDialog, copyText } from './ui.js';
import { ensureChart, ensureSortable } from './lib.js';
import { duplicateProject, exportProject, exportICS } from './backup.js';
import { deleteGoalWithUndo } from './bulk.js';
import { projectStages, taskStage, stagePatch, projectStats, burndown, newStage, TAG_COLORS, subtaskProgress, blockers, checklistProgress, hoursSpent } from './model.js';
import { renderKanban } from './kanban.js';
import { renderGantt } from './gantt.js';
import { openTask } from './task-panel.js';

const $ = (id) => document.getElementById(id);
const TABS = [['overview', 'نظرة عامة'], ['kanban', 'كانبان'], ['list', 'قائمة'], ['gantt', 'جانت'], ['milestones', 'المعالم'], ['settings', 'الإعدادات']];
let charts = [];
let foldedByProject = {};

function avatar(uidX, size = 24) { const u = state.users.find(x => x.uid === uidX); const name = u ? (u.displayName || u.email || '?') : '?'; const hue = [...(uidX || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360; return `<span class="avatar" title="${esc(name)}" style="width:${size}px;height:${size}px;background:hsl(${hue} 60% 45%)">${esc(name.trim().slice(0, 1).toUpperCase())}</span>`; }

/** كارت مهمة في الكانبان (مشترك مع صفحة المهام) */
export function kanbanCard(t, g) {
  const tags = (g && g.tags ? g.tags : []).filter(x => (t.tags || []).includes(x.id));
  const sp = subtaskProgress(state.tasks, t.id); const cl = checklistProgress(t); const blk = blockers(t, state.tasks);
  const n = daysFromToday(t.dueDate);
  const people = t.assignedUserIds && t.assignedUserIds.length ? t.assignedUserIds : (t.assignedToUid ? [t.assignedToUid] : []);
  return `<div class="kc-top"><span class="kc-title">${esc(t.name)}</span>${t.starred ? '<span class="star on sm">★</span>' : ''}</div>
    ${tags.length ? `<div class="kc-tags">${tags.map(x => `<span class="tag" style="--tc:${x.color}">${esc(x.name)}</span>`).join('')}</div>` : ''}
    <div class="kc-foot">
      <span class="badge ${PRIORITIES[t.priority || 'medium'].cls}">${PRIORITIES[t.priority || 'medium'].label}</span>
      ${t.dueDate ? `<span class="due ${!t.completed && n < 0 ? 'c-danger' : !t.completed && n === 0 ? 'c-warn' : ''}">${relativeDue(t.dueDate)}</span>` : ''}
      ${sp ? `<span class="hint" title="مهام فرعية">↳ ${sp.done}/${sp.total}</span>` : ''}${cl ? `<span class="hint" title="قائمة المراجعة">☑ ${cl.done}/${cl.total}</span>` : ''}${blk.length ? `<span class="c-danger" title="محجوبة">⛔</span>` : ''}${(t.attachments || []).length ? `<span class="hint">📎${t.attachments.length}</span>` : ''}${t.recurrence && t.recurrence.freq ? '<span class="hint" title="متكررة">🔁</span>' : ''}${t.plannedHours ? `<span class="hint">${hoursSpent(t)}/${t.plannedHours}س</span>` : ''}
      <span class="avatars">${people.slice(0, 3).map(u => avatar(u, 22)).join('')}</span>
    </div>`;
}

export function renderProject(el, id, tab = 'overview') {
  charts.forEach(c => c.destroy()); charts = [];
  const g = state.goals.find(x => x.id === id);
  if (!g) { el.innerHTML = `<div class="empty"><h3>المشروع غير موجود</h3><a class="btn" href="#goals">رجوع للأهداف</a></div>`; return; }
  const tasks = state.tasks.filter(t => t.goalId === id);
  const st = projectStats(g, state.tasks);
  const can = canEditGoal(g);
  el.innerHTML = `
    <div class="pp-head" style="--gc:${g.color || '#2563eb'}">
      <a href="#goals" class="iconbtn" title="رجوع"><svg class="ic"><use href="#i-next"/></svg></a>
      <div class="pp-title"><span class="goal-dot"></span><h1>${esc(g.name)}</h1>${g.template ? '<span class="badge cat">قالب</span>' : ''}${g.archived ? '<span class="badge st-archived">مؤرشف</span>' : ''}<button class="star ${isFavorite(g.id) ? 'on' : ''}" id="ppFav" title="إضافة للمفضلة (تظهر في القائمة الجانبية)">★</button></div>
      <div class="pp-meta"><span class="hint">${fmtDate(g.startDate)} → ${fmtDate(g.endDate)}</span>${g.manager ? `<span class="who">${avatar(g.manager, 20)} ${esc(userLabel(g.manager))}</span>` : ''}<span class="avatars">${(g.assignedUserIds || []).slice(0, 6).map(u => avatar(u, 22)).join('')}</span></div>
      <div class="pp-progress"><div class="progress"><div class="progress-bar" style="width:${st.pct}%;background:var(--gc)"></div></div><span>${st.pct}% · ${st.done}/${st.total} مهمة</span></div>
      <nav class="tabs">${TABS.map(([k, v]) => `<a href="#project/${id}/${k}" class="${tab === k ? 'on' : ''}">${v}</a>`).join('')}</nav>
    </div>
    <div id="ppBody"></div>`;
  const body = $('ppBody');
  document.dispatchEvent(new CustomEvent('goals:open', { detail: { type: 'project', id } }));
  $('ppFav').onclick = () => { const f = favorites(); api.updateProfile({ favorites: f.includes(id) ? f.filter(x => x !== id) : [...f, id].slice(-8) }); toast(f.includes(id) ? 'أُزيل من المفضلة' : 'أُضيف إلى المفضلة ★', { type: 'ok' }); };
  ({ overview: renderOverview, kanban: renderKan, list: renderList, gantt: renderGan, milestones: renderMilestones, settings: renderSettings }[tab] || renderOverview)(body, g, tasks, st, can);
}

function renderOverview(body, g, tasks, st, can) {
  const open = sortTasks(tasks.filter(t => !t.completed && !t.parentId));
  const late = open.filter(t => t.dueDate && daysFromToday(t.dueDate) < 0);
  const ms = (g.milestones || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const bd = burndown(g, state.tasks, 30);
  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="kpi-label">المهام</span><span class="kpi-value">${st.total}</span></div>
      <div class="kpi"><span class="kpi-label">منجزة</span><span class="kpi-value c-ok">${st.done}</span></div>
      <div class="kpi"><span class="kpi-label">مفتوحة</span><span class="kpi-value">${st.open}</span></div>
      <div class="kpi"><span class="kpi-label">متأخرة</span><span class="kpi-value ${st.late ? 'c-danger' : ''}">${st.late}</span></div>
      <div class="kpi"><span class="kpi-label">الساعات</span><span class="kpi-value">${st.spent}<small>/${st.planned || g.plannedHours || '—'}</small></span></div>
      <div class="kpi"><span class="kpi-label">المعالم</span><span class="kpi-value">${st.milestonesDone}<small>/${st.milestones}</small></span></div>
    </div>
    <div class="grid-2">
      <div class="panel"><h2>المهام حسب المرحلة</h2><div class="stage-bars">${st.byStage.map(x => `<div class="sbar"><span class="sbar-name"><i style="background:${x.stage.color}"></i>${esc(x.stage.name)}</span><div class="progress sm"><div class="progress-bar" style="width:${st.total ? (x.count / st.total) * 100 : 0}%;background:${x.stage.color}"></div></div><span class="sbar-n">${x.count}</span></div>`).join('')}</div>
        <h2 style="margin-top:1rem">Burndown (30 يوم)</h2><div class="chart"><canvas id="ppBurn"></canvas></div></div>
      <div class="stack">
        <div class="panel"><div class="panel-head"><h2>المعالم</h2><a href="#project/${g.id}/milestones" class="link">إدارة →</a></div>${ms.length ? ms.map(m => `<div class="ms ${m.done ? 'done' : ''} ${!m.done && m.date && m.date < isoDate() ? 'late' : ''}"><span class="ms-ico">◆</span><div><strong>${esc(m.name)}</strong><div class="hint">${m.date ? relativeDue(m.date) : ''}</div></div></div>`).join('') : '<p class="muted">لا معالم بعد.</p>'}</div>
        <div class="panel"><div class="panel-head"><h2>مهام متأخرة</h2><a href="#project/${g.id}/list" class="link">القائمة →</a></div>${late.length ? late.slice(0, 6).map(t => `<div class="mini-task" data-open="${t.id}"><span class="c-danger">●</span><span>${esc(t.name)}</span><small class="hint">${relativeDue(t.dueDate)}</small></div>`).join('') : '<p class="muted">لا مهام متأخرة 👏</p>'}</div>
        ${g.note ? `<div class="panel"><h2>الوصف</h2><p class="muted">${esc(g.note)}</p></div>` : ''}
      </div>
    </div>`;
  body.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => openTask(b.dataset.open); });
  ensureChart().then((Chart) => {
    if (!$('ppBurn')) return;
    const cs = getComputedStyle(document.documentElement);
    charts.push(new Chart($('ppBurn'), { type: 'line', data: { labels: bd.map(x => fmtDate(x.date, { day: 'numeric', month: 'short' })), datasets: [{ label: 'مهام متبقية', data: bd.map(x => x.remaining), borderColor: g.color || cs.getPropertyValue('--primary'), backgroundColor: (g.color || '#2563eb') + '22', fill: true, tension: .3, pointRadius: 0 }, { label: 'إجمالي', data: bd.map(x => x.total), borderColor: cs.getPropertyValue('--text-3'), borderDash: [4, 4], pointRadius: 0 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { rtl: true, labels: { color: cs.getPropertyValue('--text-2'), font: { family: 'Cairo' } } } }, scales: { x: { ticks: { color: cs.getPropertyValue('--text-3'), maxTicksLimit: 8 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: cs.getPropertyValue('--text-3'), precision: 0 }, grid: { color: cs.getPropertyValue('--border') } } } } }));
  }).catch(() => {});
}

function renderKan(body, g, tasks, st, can) {
  const stages = projectStages(g);
  body.innerHTML = `<div class="toolbar"><div class="search"><svg class="ic"><use href="#i-search"/></svg><input type="search" id="kq" placeholder="بحث…"></div><div class="toolbar-right">${can ? `<button class="btn btn-sm" id="kStage"><svg class="ic"><use href="#i-plus"/></svg> مرحلة</button>` : ''}<button class="btn btn-primary btn-sm" id="kTask"><svg class="ic"><use href="#i-plus"/></svg> مهمة</button></div></div><div id="kWrap"></div>`;
  const draw = (q = '') => {
    const items = tasks.filter(t => !t.parentId && (!q || t.name.toLowerCase().includes(q.toLowerCase())));
    foldedByProject[g.id] = renderKanban($('kWrap'), {
      columns: stages, items, colOf: (t) => taskStage(t, g).id, card: (t) => kanbanCard(t, g), folded: foldedByProject[g.id],
      onOpen: openTask,
      onMove: async (taskId, colId, ids) => { const s = stages.find(x => x.id === colId); const t = state.tasks.find(x => x.id === taskId); if (!s || !t) return; const p = stagePatch(s); if (s.done && !t.completed) p.completedAt = isDemo() ? Date.now() : window.firebase.firestore.FieldValue.serverTimestamp(); await api.updateTask(taskId, p); api.reorderTasks(ids).catch(() => {}); },
      onQuickAdd: (colId, name) => api.createTask({ name, goalId: g.id, stageId: colId, priority: 'medium', assignedToUid: state.user.uid, dueDate: null }),
      onColMenu: can ? (col, btn) => stageMenu(g, col, btn) : null,
    });
  };
  draw();
  $('kq').oninput = (e) => draw(e.target.value);
  $('kTask').onclick = () => api.createTask({ name: 'مهمة جديدة', goalId: g.id, stageId: stages[0].id, priority: 'medium', assignedToUid: state.user.uid, dueDate: null }).then(id => id && openTask(id));
  const ks = $('kStage'); if (ks) ks.onclick = async () => { const name = await promptDialog('اسم المرحلة الجديدة', ''); if (name) await api.updateGoal(g.id, { stages: [...stages.filter(s => !s.done), newStage(name), ...stages.filter(s => s.done)] }); };
}

async function stageMenu(g, col, btn) {
  const stages = projectStages(g);
  const menu = document.createElement('div'); menu.className = 'menu'; menu.style.position = 'fixed';
  const r = btn.getBoundingClientRect(); menu.style.top = r.bottom + 4 + 'px'; menu.style.insetInlineEnd = (document.documentElement.dir === 'rtl' ? r.left : window.innerWidth - r.right) + 'px';
  menu.innerHTML = `<button data-a="rename"><svg class="ic"><use href="#i-edit"/></svg> إعادة تسمية</button><button data-a="color">🎨 اللون</button><button data-a="limit">🔢 حد المهام (WIP)</button><button data-a="fold">${col.fold ? '📂 عدم الطيّ' : '📁 طيّ افتراضياً'}</button><button data-a="done">${col.done ? '⭕ مرحلة غير نهائية' : '✅ مرحلة نهائية (منجز)'}</button><button data-a="left">← نقل</button><button data-a="right">→ نقل</button><div class="menu-sep"></div><button class="danger" data-a="del"><svg class="ic"><use href="#i-trash"/></svg> حذف المرحلة</button>`;
  document.body.appendChild(menu);
  const close = () => menu.remove();
  setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
  menu.onclick = async (e) => {
    const a = e.target.closest('button')?.dataset.a; if (!a) return;
    let next = stages.map(s => ({ ...s })); const i = next.findIndex(s => s.id === col.id);
    if (a === 'rename') { const n = await promptDialog('اسم المرحلة', col.name); if (!n) return; next[i].name = n; }
    if (a === 'color') { const c = await promptDialog('لون المرحلة (hex)', col.color || '#2563eb'); if (!c) return; next[i].color = c; }
    if (a === 'limit') { const n = await promptDialog('الحد الأقصى للمهام في هذه المرحلة (0 = بدون)', String(col.limit || 0), { type: 'number' }); if (n == null) return; next[i].limit = Number(n) || 0; }
    if (a === 'fold') next[i].fold = !col.fold;
    if (a === 'done') { next[i].done = !col.done; if (next[i].done) next[i].fold = true; }
    if (a === 'left' && i > 0) [next[i - 1], next[i]] = [next[i], next[i - 1]];
    if (a === 'right' && i < next.length - 1) [next[i + 1], next[i]] = [next[i], next[i + 1]];
    if (a === 'del') { if (next.length <= 1) { toast('لا يمكن حذف آخر مرحلة', { type: 'err' }); return; } const inCol = state.tasks.filter(t => t.goalId === g.id && taskStage(t, g).id === col.id); if (!(await confirmDialog(`حذف مرحلة «${col.name}»؟ ${inCol.length ? `ستنتقل ${inCol.length} مهمة إلى المرحلة الأولى.` : ''}`, { okLabel: 'حذف' }))) return; next.splice(i, 1); for (const t of inCol) await api.updateTask(t.id, stagePatch(next[0])); }
    if (!next.some(s => s.done)) next[next.length - 1].done = true;
    await api.updateGoal(g.id, { stages: next });
  };
}

function renderList(body, g, tasks) {
  const stages = projectStages(g);
  const rows = sortTasks(tasks.filter(t => !t.parentId));
  body.innerHTML = `<div class="panel"><div class="table-wrap"><table class="table tasks-table"><thead><tr><th></th><th>المهمة</th><th>المرحلة</th><th>المكلّف</th><th>الموعد</th><th>الأولوية</th><th>الساعات</th><th>تاجز</th></tr></thead><tbody>
    ${rows.map(t => { const s = taskStage(t, g); const sp = subtaskProgress(state.tasks, t.id); const n = daysFromToday(t.dueDate); return `<tr data-open="${t.id}" class="${t.completed ? 'done' : ''}"><td>${t.starred ? '<span class="star on sm">★</span>' : ''}</td><td><strong>${esc(t.name)}</strong>${sp ? ` <small class="hint">↳ ${sp.done}/${sp.total}</small>` : ''}</td><td><span class="badge" style="background:${s.color}22;color:${s.color}">${esc(s.name)}</span></td><td>${t.assignedToUid ? `${avatar(t.assignedToUid, 20)} ${esc(userLabel(t.assignedToUid))}` : '—'}</td><td class="${!t.completed && n != null && n < 0 ? 'c-danger' : ''}">${t.dueDate ? relativeDue(t.dueDate) : '—'}</td><td><span class="badge ${PRIORITIES[t.priority || 'medium'].cls}">${PRIORITIES[t.priority || 'medium'].label}</span></td><td>${hoursSpent(t)}${t.plannedHours ? `/${t.plannedHours}` : ''}</td><td>${(g.tags || []).filter(x => (t.tags || []).includes(x.id)).map(x => `<span class="tag" style="--tc:${x.color}">${esc(x.name)}</span>`).join(' ')}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">لا مهام.</td></tr>'}
  </tbody></table></div><p class="hint" style="margin-top:.5rem">${stages.length} مراحل · ${rows.length} مهمة رئيسية</p></div>`;
  body.querySelectorAll('[data-open]').forEach(tr => { tr.onclick = () => openTask(tr.dataset.open); });
}

function renderGan(body, g, tasks, st, can) {
  body.innerHTML = `<div class="panel"><p class="hint">اسحب الشريط لتحريك المهمة، أو اسحب طرفيه لتغيير المدة. اضغط للفتح. ◆ = معلم.</p><div id="ganttWrap"></div></div>`;
  renderGantt($('ganttWrap'), sortTasks(tasks), { project: g, onOpen: openTask, onChange: can ? (id, p) => api.updateTask(id, p).then(() => toast('تم تحديث التواريخ', { type: 'ok' })) : null });
}

function renderMilestones(body, g, tasks, st, can) {
  const ms = (g.milestones || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  body.innerHTML = `<div class="panel"><div class="panel-head"><h2>المعالم</h2>${can ? `<button class="btn btn-primary btn-sm" id="msAdd"><svg class="ic"><use href="#i-plus"/></svg> معلم</button>` : ''}</div>
    ${ms.length ? `<div class="ms-list">${ms.map(m => `<div class="ms ${m.done ? 'done' : ''} ${!m.done && m.date && m.date < isoDate() ? 'late' : ''}" data-id="${m.id}"><label class="check"><input type="checkbox" ${m.done ? 'checked' : ''} ${can ? '' : 'disabled'} data-ms-cb="${m.id}"><span></span></label><div class="ms-main"><strong>${esc(m.name)}</strong><div class="hint">${m.date ? `${fmtDate(m.date)} · ${relativeDue(m.date)}` : 'بدون تاريخ'}${m.note ? ` · ${esc(m.note)}` : ''}</div></div>${can ? `<button class="iconbtn" data-ms-edit="${m.id}"><svg class="ic"><use href="#i-edit"/></svg></button><button class="iconbtn danger" data-ms-del="${m.id}"><svg class="ic"><use href="#i-trash"/></svg></button>` : ''}</div>`).join('')}</div>` : '<p class="muted">لا معالم. المعالم نقاط تحقق رئيسية بتاريخ (مثال: إطلاق النسخة التجريبية).</p>'}</div>`;
  const save = (list) => api.updateGoal(g.id, { milestones: list });
  const add = $('msAdd'); if (add) add.onclick = async () => { const name = await promptDialog('اسم المعلم', ''); if (!name) return; const date = await promptDialog('التاريخ', isoDate(addDays(new Date(), 14)), { type: 'date' }); save([...(g.milestones || []), { id: uid(), name, date: date || null, done: false }]); };
  body.querySelectorAll('[data-ms-cb]').forEach(c => { c.onchange = () => save((g.milestones || []).map(m => m.id === c.dataset.msCb ? { ...m, done: c.checked } : m)); });
  body.querySelectorAll('[data-ms-edit]').forEach(b => { b.onclick = async () => { const m = (g.milestones || []).find(x => x.id === b.dataset.msEdit); const name = await promptDialog('اسم المعلم', m.name); if (!name) return; const date = await promptDialog('التاريخ', m.date || '', { type: 'date' }); save((g.milestones || []).map(x => x.id === m.id ? { ...x, name, date: date || null } : x)); }; });
  body.querySelectorAll('[data-ms-del]').forEach(b => { b.onclick = async () => { if (await confirmDialog('حذف المعلم؟', { okLabel: 'حذف' })) save((g.milestones || []).filter(x => x.id !== b.dataset.msDel)); }; });
}

function renderSettings(body, g, tasks, st, can) {
  if (!can) { body.innerHTML = '<div class="empty"><h3>الإعدادات لمالك المشروع أو المشرف فقط</h3></div>'; return; }
  const stages = projectStages(g);
  const privacy = g.visibility === 'public' ? 'public' : 'followers';
  body.innerHTML = `<div class="grid-2">
    <div class="stack">
      <div class="panel"><h2>المراحل</h2><p class="hint">اسحب لإعادة الترتيب. المرحلة النهائية تعني إنجاز المهمة.</p>
        <div class="stage-list" id="stageList">${stages.map(s => `<div class="stage-row" data-id="${s.id}"><span class="drag"><svg class="ic"><use href="#i-grip"/></svg></span><input type="color" value="${s.color || '#2563eb'}" data-f="color" aria-label="اللون"><input type="text" value="${esc(s.name)}" data-f="name" maxlength="40"><label class="switch small"><input type="checkbox" data-f="fold" ${s.fold ? 'checked' : ''}><span>طيّ</span></label><label class="switch small"><input type="checkbox" data-f="done" ${s.done ? 'checked' : ''}><span>نهائية</span></label><input type="number" min="0" data-f="limit" value="${s.limit || ''}" placeholder="حد" title="حد المهام (WIP)" style="width:64px"><button class="iconbtn danger" data-del="${s.id}" aria-label="حذف"><svg class="ic"><use href="#i-trash"/></svg></button></div>`).join('')}</div>
        <div class="btn-row"><button class="btn btn-sm" id="stAdd"><svg class="ic"><use href="#i-plus"/></svg> مرحلة</button><button class="btn btn-primary btn-sm" id="stSave">حفظ المراحل</button></div></div>
      <div class="panel"><h2>التاجز</h2><div class="tags-edit" id="tagList">${(g.tags || []).map(t => `<span class="tag" style="--tc:${t.color}">${esc(t.name)} <button data-tag-del="${t.id}" aria-label="حذف">×</button></span>`).join('') || '<span class="hint">لا تاجز.</span>'}</div>
        <form class="quick-add" id="tagAdd"><svg class="ic"><use href="#i-plus"/></svg><input type="text" placeholder="تاج جديد… Enter" maxlength="30"><button class="btn btn-sm btn-primary" type="submit">إضافة</button></form></div>
    </div>
    <div class="stack">
      <div class="panel"><h2>عام</h2>
        <label class="field"><span>مدير المشروع</span><select id="psManager"><option value="">—</option>${state.users.map(u => `<option value="${u.uid}" ${g.manager === u.uid ? 'selected' : ''}>${esc(u.displayName || u.email)}</option>`).join('')}</select></label>
        <label class="field"><span>الساعات المخططة للمشروع</span><input type="number" id="psHours" min="0" value="${g.plannedHours || ''}"></label>
        <label class="field"><span>التصنيف</span><select id="psCat">${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${g.category === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>الخصوصية</span><select id="psPrivacy"><option value="followers" ${privacy === 'followers' ? 'selected' : ''}>المتابعون فقط (المكلّفون بالمشروع)</option><option value="public" ${privacy === 'public' ? 'selected' : ''}>كل أعضاء الفريق</option></select></label>
        <label class="switch"><input type="checkbox" id="psTemplate" ${g.template ? 'checked' : ''}><span>استخدام هذا المشروع كقالب</span></label>
        <label class="switch"><input type="checkbox" id="psArchived" ${g.archived ? 'checked' : ''}><span>مؤرشف</span></label>
      </div>
      <div class="panel"><h2>أدوات</h2><div class="btn-row">
        <button class="btn btn-sm" id="psDup"><svg class="ic"><use href="#i-copy"/></svg> نسخ المشروع</button>
        <button class="btn btn-sm" id="psExport"><svg class="ic"><use href="#i-download"/></svg> تصدير JSON</button>
        <button class="btn btn-sm" id="psIcs"><svg class="ic"><use href="#i-cal"/></svg> تصدير للتقويم (.ics)</button>
        <button class="btn btn-sm" id="psLink"><svg class="ic"><use href="#i-link"/></svg> نسخ الرابط</button>
        <button class="btn btn-sm btn-danger" id="psDelete"><svg class="ic"><use href="#i-trash"/></svg> حذف المشروع</button>
      </div><p class="hint">الحذف ينقل المشروع ومهامه إلى سلة المحذوفات ويمكن استعادته خلال 30 يوماً.</p></div>
      <div class="panel"><h2>المتابعون / الأعضاء</h2><div class="tp-people">${(g.assignedUserIds || []).map(u => `<span class="pill">${avatar(u, 20)} ${esc(userLabel(u))} <button data-rm-member="${u}" aria-label="إزالة">×</button></span>`).join('')}<select id="psAddMember" class="pill-add"><option value="">+ عضو</option>${state.users.filter(u => !(g.assignedUserIds || []).includes(u.uid)).map(u => `<option value="${u.uid}">${esc(u.displayName || u.email)}</option>`).join('')}</select></div></div>
    </div></div>`;
  // أدوات
  $('psDup').onclick = () => duplicateProject(g);
  $('psExport').onclick = () => exportProject(g);
  $('psIcs').onclick = () => exportICS(tasks, g.name.replace(/\s+/g, '-'));
  $('psLink').onclick = () => copyText(`${location.origin}${location.pathname}#project/${g.id}`, 'تم نسخ رابط المشروع');
  $('psDelete').onclick = async () => { if (await deleteGoalWithUndo(g, tasks.length)) location.hash = 'goals'; };
  // المراحل
  ensureSortable().then(S => { if ($('stageList')) new S($('stageList'), { animation: 150, handle: '.drag' }); }).catch(() => {});
  $('stAdd').onclick = () => { const row = document.createElement('div'); row.className = 'stage-row'; row.dataset.id = uid(); row.innerHTML = `<span class="drag"><svg class="ic"><use href="#i-grip"/></svg></span><input type="color" value="#2563eb" data-f="color"><input type="text" value="" data-f="name" placeholder="اسم المرحلة" maxlength="40"><label class="switch small"><input type="checkbox" data-f="fold"><span>طيّ</span></label><label class="switch small"><input type="checkbox" data-f="done"><span>نهائية</span></label><input type="number" min="0" data-f="limit" placeholder="حد" style="width:64px"><button class="iconbtn danger" data-del="new" aria-label="حذف"><svg class="ic"><use href="#i-trash"/></svg></button>`; $('stageList').appendChild(row); row.querySelector('[data-f="name"]').focus(); row.querySelector('[data-del]').onclick = () => row.remove(); };
  body.querySelectorAll('[data-del]').forEach(b => { b.onclick = (e) => e.target.closest('.stage-row').remove(); });
  $('stSave').onclick = async () => {
    const rows = [...$('stageList').querySelectorAll('.stage-row')];
    const next = rows.map(r => ({ id: r.dataset.id, name: r.querySelector('[data-f="name"]').value.trim() || 'مرحلة', color: r.querySelector('[data-f="color"]').value, fold: r.querySelector('[data-f="fold"]').checked, done: r.querySelector('[data-f="done"]').checked, limit: Number(r.querySelector('[data-f="limit"]').value) || 0 }));
    if (!next.length) { toast('لازم مرحلة واحدة على الأقل', { type: 'err' }); return; }
    if (!next.some(s => s.done)) next[next.length - 1].done = true;
    const removed = stages.filter(s => !next.some(n => n.id === s.id));
    for (const s of removed) for (const t of tasks.filter(t => taskStage(t, g).id === s.id)) await api.updateTask(t.id, stagePatch(next[0]));
    await api.updateGoal(g.id, { stages: next }); toast('تم حفظ المراحل', { type: 'ok' });
  };
  // التاجز
  $('tagAdd').onsubmit = (e) => { e.preventDefault(); const inp = e.target.querySelector('input'); const v = inp.value.trim(); if (!v) return; api.updateGoal(g.id, { tags: [...(g.tags || []), { id: uid(), name: v, color: TAG_COLORS[(g.tags || []).length % TAG_COLORS.length] }] }); inp.value = ''; };
  body.querySelectorAll('[data-tag-del]').forEach(b => { b.onclick = () => api.updateGoal(g.id, { tags: (g.tags || []).filter(t => t.id !== b.dataset.tagDel) }); });
  // عام
  $('psManager').onchange = e => api.updateGoal(g.id, { manager: e.target.value || null });
  $('psHours').onchange = e => api.updateGoal(g.id, { plannedHours: Number(e.target.value) || 0 });
  $('psCat').onchange = e => api.updateGoal(g.id, { category: e.target.value });
  $('psPrivacy').onchange = e => api.updateGoal(g.id, e.target.value === 'public' ? { visibility: 'public', visibilityMode: 'public' } : { visibility: 'private', visibilityMode: 'private' });
  $('psTemplate').onchange = e => api.updateGoal(g.id, { template: e.target.checked });
  $('psArchived').onchange = e => api.updateGoal(g.id, { archived: e.target.checked });
  $('psAddMember').onchange = e => { if (e.target.value) api.updateGoal(g.id, { assignedUserIds: [...(g.assignedUserIds || []), e.target.value] }); };
  body.querySelectorAll('[data-rm-member]').forEach(b => { b.onclick = () => { const list = (g.assignedUserIds || []).filter(u => u !== b.dataset.rmMember); if (!list.length) { toast('لازم عضو واحد على الأقل', { type: 'err' }); return; } api.updateGoal(g.id, { assignedUserIds: list }); }; });
}
