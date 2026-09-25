// بطاقة المهمة الكاملة (على طريقة Odoo): حقول، مرحلة، نجمة، مكلّفون، تاجز، تواريخ، ساعات، قائمة مراجعة،
// مهام فرعية، تبعيات، تكرار، أنشطة، مرفقات، وChatter (تعليقات/ملاحظات + سجل).
import { state, notify, userLabel, canEditTask } from './store.js';
import { api, isDemo } from './data.js';
import { esc, fmtDate, fmtDateTime, relativeDue, isoDate, addDays, uid, PRIORITIES, toMillis } from './utils.js';
import { toast, confirmDialog, promptDialog, popMenu, copyText } from './ui.js';
import { projectStages, taskStage, stagePatch, completionPatch, subtasksOf, blockers, hoursSpent, checklistProgress, nextOccurrence, ACTIVITY_TYPES, RECURRENCE, TAG_COLORS } from './model.js';
import { deleteTaskWithUndo, snoozeMenu } from './bulk.js';
import { openFocus } from './focus.js';

const $ = (id) => document.getElementById(id);
let currentId = null, tab = 'details', messages = [], timerStart = null, timerTick = null;

const TIMER_KEY = 'goals.timer';
function loadTimer() { try { const t = JSON.parse(localStorage.getItem(TIMER_KEY) || 'null'); if (t && t.taskId) { timerStart = t; } } catch { /* ignore */ } }
loadTimer();
export function runningTimer() { return timerStart; }

export function openTask(id, initialTab) {
  currentId = id; tab = initialTab || 'details'; messages = null;
  const d = $('taskDrawer');
  d.hidden = false; $('taskDrawerBg').hidden = false;
  requestAnimationFrame(() => d.classList.add('open'));
  render();
  document.dispatchEvent(new CustomEvent('goals:open', { detail: { type: 'task', id } }));
  api.loadMessages(id).then(m => { messages = m; if (currentId === id) renderChatter(); });
}
export function closeTask() { const d = $('taskDrawer'); d.classList.remove('open'); setTimeout(() => { d.hidden = true; }, 250); $('taskDrawerBg').hidden = true; currentId = null; }
export function refreshTaskPanel() { if (currentId && !$('taskDrawer').hidden) render(); }
export function openTaskId() { return currentId; }

function task() { return state.tasks.find(t => t.id === currentId); }
function project(t) { return state.goals.find(g => g.id === t.goalId); }
function patch(p) { const t = task(); if (!t) return Promise.resolve(); return api.updateTask(t.id, p).catch(e => { console.error(e); toast('تعذّر الحفظ', { type: 'err' }); }); }
function avatar(uidX, size = 24) {
  const u = state.users.find(x => x.uid === uidX); const name = u ? (u.displayName || u.email || '?') : '?';
  const hue = [...(uidX || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `<span class="avatar" title="${esc(name)}" style="width:${size}px;height:${size}px;background:hsl(${hue} 60% 45%)">${esc(name.trim().slice(0, 1).toUpperCase())}</span>`;
}

function render() {
  const t = task(); const d = $('taskDrawer');
  if (!t) { closeTask(); return; }
  const g = project(t) || {}; const stages = projectStages(g); const st = taskStage(t, g);
  const can = canEditTask(t);
  const assignees = t.assignedUserIds && t.assignedUserIds.length ? t.assignedUserIds : (t.assignedToUid ? [t.assignedToUid] : []);
  const tags = (g.tags || []).filter(x => (t.tags || []).includes(x.id));
  const subs = subtasksOf(state.tasks, t.id); const blk = blockers(t, state.tasks);
  const spent = hoursSpent(t); const cl = checklistProgress(t);
  const parent = t.parentId ? state.tasks.find(x => x.id === t.parentId) : null;
  const tabs = [['details', 'التفاصيل'], ['checklist', `قائمة المراجعة${cl ? ` ${cl.done}/${cl.total}` : ''}`], ['subtasks', `مهام فرعية${subs.length ? ` ${subs.length}` : ''}`], ['time', `الساعات${spent ? ` ${spent}` : ''}`], ['activities', `الأنشطة${(t.activities || []).filter(a => !a.done).length ? ` ${(t.activities || []).filter(a => !a.done).length}` : ''}`], ['files', `مرفقات${(t.attachments || []).length ? ` ${(t.attachments || []).length}` : ''}`]];
  d.innerHTML = `
    <div class="tp-head" style="--gc:${g.color || '#2563eb'}">
      <div class="tp-top">
        <button class="iconbtn" id="tpClose" aria-label="إغلاق"><svg class="ic"><use href="#i-close"/></svg></button>
        <span class="goal-tag" style="--gc:${g.color || '#2563eb'}" data-open-project="${g.id || ''}">${esc(g.name || '—')}</span>
        ${parent ? `<span class="hint">↳ فرعية من <button class="linkbtn" data-open-task="${parent.id}">${esc(parent.name)}</button></span>` : ''}
        <span style="flex:1"></span>
        <button class="star ${t.starred ? 'on' : ''}" id="tpStar" title="أولوية بنجمة" ${can ? '' : 'disabled'}>★</button>
        <button class="iconbtn" id="tpMore" title="المزيد"><svg class="ic"><use href="#i-dots"/></svg></button>
        ${can ? `<button class="iconbtn danger" id="tpDelete" title="حذف"><svg class="ic"><use href="#i-trash"/></svg></button>` : ''}
      </div>
      <input class="tp-title" id="tpName" value="${esc(t.name)}" ${can ? '' : 'readonly'} maxlength="140">
      <div class="tp-stages">${stages.map(s => `<button class="tp-stage ${s.id === st.id ? 'on' : ''} ${s.done ? 'done' : ''}" data-stage="${s.id}" style="--kc:${s.color}" ${can ? '' : 'disabled'}>${esc(s.name)}</button>`).join('')}</div>
      ${blk.length ? `<div class="alert bad">⛔ محجوبة بـ: ${blk.map(b => `<button class="linkbtn" data-open-task="${b.id}">${esc(b.name)}</button>`).join('، ')}</div>` : ''}
      <nav class="tp-tabs">${tabs.map(([k, v]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${v}</button>`).join('')}</nav>
    </div>
    <div class="tp-body" id="tpBody"></div>
    <div class="tp-chatter" id="tpChatter"></div>`;
  $('tpClose').onclick = closeTask;
  d.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
  d.querySelectorAll('[data-open-task]').forEach(b => { b.onclick = () => openTask(b.dataset.openTask); });
  const op = d.querySelector('[data-open-project]'); if (op && op.dataset.openProject) op.onclick = () => { closeTask(); location.hash = `project/${op.dataset.openProject}`; };
  $('tpName').onchange = (e) => { const v = e.target.value.trim(); if (v && v !== t.name) patch({ name: v }); };
  $('tpStar').onclick = () => patch({ starred: !t.starred });
  const del = $('tpDelete'); if (del) del.onclick = async () => { if (await deleteTaskWithUndo(t)) { for (const s of subs) await api.deleteTask(s.id).catch(() => {}); closeTask(); } };
  $('tpMore').onclick = (e) => {
    const items = [
      { label: 'نسخ رابط المهمة', icon: 'link', run: () => copyText(`${location.origin}${location.pathname}#task/${t.id}`, 'تم نسخ رابط المهمة') },
      { label: 'وضع التركيز على هذه المهمة 🍅', icon: 'target', run: () => { closeTask(); openFocus(t.id); } },
    ];
    if (can) {
      items.push({ label: 'تأجيل الموعد…', icon: 'cal', run: () => snoozeMenu(t, e.target.closest('button')) });
      items.push({ label: 'تكرار المهمة (نسخة)', icon: 'copy', run: async () => { const id = await api.createTask({ name: `${t.name} (نسخة)`, goalId: t.goalId, stageId: t.stageId || null, priority: t.priority || 'medium', notes: t.notes || '', tags: t.tags || [], plannedHours: t.plannedHours || 0, dueDate: t.dueDate || null, startDate: t.startDate || null, assignedToUid: t.assignedToUid || state.user.uid, assignedUserIds: t.assignedUserIds || [], parentId: t.parentId || null, checklist: (t.checklist || []).map(c => ({ ...c, id: uid(), done: false })), recurrence: t.recurrence || null }); toast('تم إنشاء نسخة', { type: 'ok' }); if (id) openTask(id); } });
      items.push({ label: t.completed ? 'إعادة فتح المهمة' : 'إنجاز المهمة ✓', icon: 'check', run: () => { const p = completionPatch(g, !t.completed); if (!t.completed) p.completedAt = isDemo() ? Date.now() : window.firebase.firestore.FieldValue.serverTimestamp(); patch(p); } });
    }
    popMenu(e.target.closest('button'), items);
  };
  d.querySelectorAll('[data-stage]').forEach(b => { b.onclick = () => moveToStage(t, g, b.dataset.stage); });
  renderTab(t, g, can, { assignees, tags, subs, spent, stages });
  renderChatter();
}

async function moveToStage(t, g, stageId) {
  const stages = projectStages(g); const s = stages.find(x => x.id === stageId); if (!s) return;
  const p = stagePatch(s);
  if (s.done && !t.completed) p.completedAt = isDemo() ? Date.now() : window.firebase.firestore.FieldValue.serverTimestamp();
  await patch(p);
  if (s.done && t.recurrence && t.recurrence.freq) spawnRecurrence(t);
}
export async function spawnRecurrence(t) {
  const next = nextOccurrence(t.recurrence, t.dueDate || isoDate());
  if (!next) return;
  const g = state.goals.find(x => x.id === t.goalId);
  const first = projectStages(g).find(s => !s.done);
  await api.createTask({ name: t.name, goalId: t.goalId, dueDate: next, startDate: t.startDate && t.dueDate ? isoDate(addDays(next, -Math.max(0, Math.round((new Date(t.dueDate + 'T00:00:00') - new Date(t.startDate + 'T00:00:00')) / 86400000)))) : null, priority: t.priority || 'medium', notes: t.notes || '', assignedToUid: t.assignedToUid || null, assignedUserIds: t.assignedUserIds || [], tags: t.tags || [], recurrence: t.recurrence, stageId: first ? first.id : null, plannedHours: t.plannedHours || 0, checklist: (t.checklist || []).map(c => ({ ...c, id: uid(), done: false })) });
  toast(`تم إنشاء التكرار التالي: ${fmtDate(next)}`, { type: 'ok' });
}

function renderTab(t, g, can, x) {
  const body = $('tpBody');
  const ro = can ? '' : 'disabled';
  if (tab === 'details') {
    const others = state.tasks.filter(o => o.goalId === t.goalId && o.id !== t.id && !o.parentId);
    body.innerHTML = `
      <div class="tp-grid">
        <label class="field"><span>الأولوية</span><select id="tpPriority" ${ro}>${Object.entries(PRIORITIES).map(([k, v]) => `<option value="${k}" ${(t.priority || 'medium') === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label class="field"><span>الساعات المخططة</span><input type="number" id="tpPlanned" min="0" step="0.5" value="${t.plannedHours || ''}" placeholder="0" ${ro}></label>
        <label class="field"><span>تاريخ البداية</span><input type="date" id="tpStart" value="${t.startDate || ''}" ${ro}></label>
        <label class="field"><span>الموعد النهائي</span><input type="date" id="tpDue" value="${t.dueDate || ''}" ${ro}></label>
      </div>
      <div class="field"><span>المكلّفون</span><div class="tp-people">${x.assignees.map(u => `<span class="pill">${avatar(u, 20)} ${esc(userLabel(u))}${can ? ` <button data-rm-user="${u}" aria-label="إزالة">×</button>` : ''}</span>`).join('')}${can ? `<select id="tpAddUser" class="pill-add"><option value="">+ مكلّف</option>${state.users.filter(u => !x.assignees.includes(u.uid)).map(u => `<option value="${u.uid}">${esc(u.displayName || u.email)}</option>`).join('')}</select>` : ''}</div></div>
      <div class="field"><span>التاجز</span><div class="tp-people">${x.tags.map(tg => `<span class="tag" style="--tc:${tg.color}">${esc(tg.name)}${can ? ` <button data-rm-tag="${tg.id}" aria-label="إزالة">×</button>` : ''}</span>`).join('')}${can ? `<select id="tpAddTag" class="pill-add"><option value="">+ تاج</option>${(g.tags || []).filter(tg => !(t.tags || []).includes(tg.id)).map(tg => `<option value="${tg.id}">${esc(tg.name)}</option>`).join('')}<option value="__new">＋ تاج جديد…</option></select>` : ''}</div></div>
      <label class="field"><span>محجوبة بـ (تبعيات)</span><div class="tp-people">${(t.blockedBy || []).map(id => { const o = state.tasks.find(z => z.id === id); return o ? `<span class="pill ${o.completed ? 'done' : ''}">${esc(o.name)}${can ? ` <button data-rm-blk="${id}" aria-label="إزالة">×</button>` : ''}</span>` : ''; }).join('')}${can && others.length ? `<select id="tpAddBlk" class="pill-add"><option value="">+ تعتمد على…</option>${others.filter(o => !(t.blockedBy || []).includes(o.id)).map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>` : ''}</div></label>
      <div class="tp-grid">
        <label class="field"><span>التكرار</span><select id="tpRec" ${ro}><option value="">بدون تكرار</option>${Object.entries(RECURRENCE).map(([k, v]) => `<option value="${k}" ${t.recurrence && t.recurrence.freq === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field" ${t.recurrence && t.recurrence.freq ? '' : 'hidden'} id="tpRecUntilWrap"><span>حتى تاريخ</span><input type="date" id="tpRecUntil" value="${t.recurrence && t.recurrence.until ? t.recurrence.until : ''}" ${ro}></label>
      </div>
      <label class="field"><span>الوصف</span><textarea id="tpNotes" rows="4" maxlength="2000" ${ro} placeholder="تفاصيل، روابط، ملاحظات…">${esc(t.notes || '')}</textarea></label>
      <p class="hint">أنشأها ${esc(userLabel(t.createdBy) || t.createdByEmail || '')} · ${fmtDateTime(t.createdAt)}${t.completedAt ? ` · أُنجزت ${fmtDateTime(t.completedAt)}` : ''}</p>`;
    if (!can) return;
    $('tpPriority').onchange = e => patch({ priority: e.target.value });
    $('tpPlanned').onchange = e => patch({ plannedHours: Number(e.target.value) || 0 });
    $('tpStart').onchange = e => patch({ startDate: e.target.value || null });
    $('tpDue').onchange = e => patch({ dueDate: e.target.value || null });
    $('tpNotes').onchange = e => patch({ notes: e.target.value.trim() });
    $('tpRec').onchange = e => { const f = e.target.value; patch({ recurrence: f ? { freq: f, interval: 1, until: $('tpRecUntil').value || null } : null }); };
    $('tpRecUntil').onchange = e => patch({ recurrence: { ...(t.recurrence || { freq: 'weekly', interval: 1 }), until: e.target.value || null } });
    const au = $('tpAddUser'); if (au) au.onchange = e => { const v = e.target.value; if (!v) return; const list = [...x.assignees, v]; patch({ assignedUserIds: list, assignedToUid: t.assignedToUid || v }); };
    body.querySelectorAll('[data-rm-user]').forEach(b => { b.onclick = () => { const list = x.assignees.filter(u => u !== b.dataset.rmUser); patch({ assignedUserIds: list, assignedToUid: list[0] || null }); }; });
    const at = $('tpAddTag'); if (at) at.onchange = async e => { let v = e.target.value; if (!v) return; if (v === '__new') { const name = await promptDialog('اسم التاج الجديد', ''); if (!name) { render(); return; } const tag = { id: uid(), name, color: TAG_COLORS[(g.tags || []).length % TAG_COLORS.length] }; await api.updateGoal(g.id, { tags: [...(g.tags || []), tag] }); v = tag.id; } patch({ tags: [...(t.tags || []), v] }); };
    body.querySelectorAll('[data-rm-tag]').forEach(b => { b.onclick = () => patch({ tags: (t.tags || []).filter(z => z !== b.dataset.rmTag) }); });
    const ab = $('tpAddBlk'); if (ab) ab.onchange = e => { if (e.target.value) patch({ blockedBy: [...(t.blockedBy || []), e.target.value] }); };
    body.querySelectorAll('[data-rm-blk]').forEach(b => { b.onclick = () => patch({ blockedBy: (t.blockedBy || []).filter(z => z !== b.dataset.rmBlk) }); });
  }
  if (tab === 'checklist') {
    const items = t.checklist || [];
    body.innerHTML = `${items.length ? `<div class="progress sm" style="margin-bottom:.6rem"><div class="progress-bar" style="width:${(items.filter(i => i.done).length / items.length) * 100}%"></div></div>` : ''}
      <div class="cl-list">${items.map(i => `<label class="cl-item ${i.done ? 'done' : ''}"><input type="checkbox" data-cl="${i.id}" ${i.done ? 'checked' : ''} ${ro}><span>${esc(i.text)}</span>${can ? `<button class="iconbtn danger" data-cl-del="${i.id}" aria-label="حذف"><svg class="ic"><use href="#i-close"/></svg></button>` : ''}</label>`).join('')}</div>
      ${can ? `<form class="quick-add" id="clAdd"><svg class="ic"><use href="#i-plus"/></svg><input type="text" placeholder="عنصر جديد… Enter" maxlength="200"><button class="btn btn-sm btn-primary" type="submit">إضافة</button></form>` : ''}`;
    if (!can) return;
    body.querySelectorAll('[data-cl]').forEach(c => { c.onchange = () => patch({ checklist: items.map(i => i.id === c.dataset.cl ? { ...i, done: c.checked } : i) }); });
    body.querySelectorAll('[data-cl-del]').forEach(b => { b.onclick = () => patch({ checklist: items.filter(i => i.id !== b.dataset.clDel) }); });
    $('clAdd').onsubmit = e => { e.preventDefault(); const inp = e.target.querySelector('input'); const v = inp.value.trim(); if (!v) return; patch({ checklist: [...items, { id: uid(), text: v, done: false }] }); inp.value = ''; };
  }
  if (tab === 'subtasks') {
    body.innerHTML = `<div class="task-list compact">${x.subs.map(s => `<div class="task ${s.completed ? 'done' : ''} ${PRIORITIES[s.priority || 'medium'].cls}" data-sub="${s.id}"><label class="check"><input type="checkbox" ${s.completed ? 'checked' : ''} data-sub-cb="${s.id}"><span></span></label><div class="task-main"><div class="task-title" data-open-task="${s.id}">${esc(s.name)}</div><div class="task-meta">${s.dueDate ? `<span class="due">${relativeDue(s.dueDate)}</span>` : ''}${s.assignedToUid ? `<span class="who">${avatar(s.assignedToUid, 16)} ${esc(userLabel(s.assignedToUid))}</span>` : ''}</div></div></div>`).join('') || '<p class="muted">لا مهام فرعية.</p>'}</div>
      ${can ? `<form class="quick-add" id="subAdd"><svg class="ic"><use href="#i-plus"/></svg><input type="text" placeholder="مهمة فرعية جديدة… Enter" maxlength="140"><button class="btn btn-sm btn-primary" type="submit">إضافة</button></form>` : ''}`;
    body.querySelectorAll('[data-open-task]').forEach(b => { b.onclick = () => openTask(b.dataset.openTask); });
    body.querySelectorAll('[data-sub-cb]').forEach(c => { c.onchange = () => { const s = state.tasks.find(z => z.id === c.dataset.subCb); const gg = project(s) || {}; api.updateTask(s.id, { ...completionPatch(gg, c.checked), ...(c.checked ? { completedAt: isDemo() ? Date.now() : window.firebase.firestore.FieldValue.serverTimestamp() } : {}) }); }; });
    const f = $('subAdd'); if (f) f.onsubmit = e => { e.preventDefault(); const inp = f.querySelector('input'); const v = inp.value.trim(); if (!v) return; api.createTask({ name: v, goalId: t.goalId, parentId: t.id, dueDate: t.dueDate || null, priority: t.priority || 'medium', assignedToUid: t.assignedToUid || state.user.uid, stageId: (projectStages(g).find(s => !s.done) || {}).id || null, tags: t.tags || [] }); inp.value = ''; };
  }
  if (tab === 'time') {
    const ts = [...(t.timesheets || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const planned = Number(t.plannedHours) || 0; const pct = planned ? Math.min(100, Math.round((x.spent / planned) * 100)) : 0;
    const running = timerStart && timerStart.taskId === t.id;
    body.innerHTML = `<div class="tp-time-head"><div><strong class="big">${x.spent}</strong> <span class="hint">ساعة مسجّلة${planned ? ` من ${planned} مخططة` : ''}</span>${planned ? `<div class="progress sm" style="margin-top:.4rem;width:220px"><div class="progress-bar" style="width:${pct}%;background:${x.spent > planned ? 'var(--danger)' : 'var(--primary)'}"></div></div>` : ''}</div>
        ${can ? `<button class="btn ${running ? 'btn-danger' : 'btn-primary'}" id="tpTimer">${running ? '⏹ إيقاف المؤقت' : '▶ ابدأ المؤقت'}</button>` : ''}</div>
      ${running ? `<p class="hint" id="tpTimerTxt"></p>` : ''}
      ${can ? `<form class="ts-form" id="tsAdd"><input type="date" id="tsDate" value="${isoDate()}" required><input type="number" id="tsHours" min="0.25" step="0.25" placeholder="ساعات" required><input type="text" id="tsNote" placeholder="وصف العمل" maxlength="120"><button type="submit" class="btn btn-primary btn-sm">تسجيل</button></form>` : ''}
      <table class="table"><thead><tr><th>التاريخ</th><th>المستخدم</th><th>الوصف</th><th>الساعات</th><th></th></tr></thead><tbody>${ts.map(r => `<tr><td>${fmtDate(r.date)}</td><td>${esc(userLabel(r.uid))}</td><td>${esc(r.note || '')}</td><td><strong>${r.hours}</strong></td><td>${can || r.uid === state.user.uid ? `<button class="iconbtn danger" data-ts-del="${r.id}" aria-label="حذف"><svg class="ic"><use href="#i-trash"/></svg></button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">لا تسجيلات.</td></tr>'}</tbody></table>`;
    const f = $('tsAdd'); if (f) f.onsubmit = e => { e.preventDefault(); const h = Number($('tsHours').value); if (!h) return; patch({ timesheets: [...(t.timesheets || []), { id: uid(), uid: state.user.uid, date: $('tsDate').value, hours: h, note: $('tsNote').value.trim() }] }); };
    body.querySelectorAll('[data-ts-del]').forEach(b => { b.onclick = () => patch({ timesheets: (t.timesheets || []).filter(r => r.id !== b.dataset.tsDel) }); });
    const tb = $('tpTimer'); if (tb) tb.onclick = () => toggleTimer(t);
    if (running) tickTimer();
  }
  if (tab === 'activities') {
    const acts = [...(t.activities || [])].sort((a, b) => (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999'));
    body.innerHTML = `<div class="act-list">${acts.map(a => { const n = a.due ? relativeDue(a.due) : ''; const late = a.due && a.due < isoDate() && !a.done; return `<div class="act ${a.done ? 'done' : ''} ${late ? 'late' : ''}"><span class="act-ico">${ACTIVITY_TYPES[a.type] ? ACTIVITY_TYPES[a.type][1] : '✅'}</span><div class="act-main"><strong>${esc(a.summary || (ACTIVITY_TYPES[a.type] || ['نشاط'])[0])}</strong><div class="hint">${ACTIVITY_TYPES[a.type] ? ACTIVITY_TYPES[a.type][0] : ''} · ${n}${a.uid ? ` · ${esc(userLabel(a.uid))}` : ''}</div></div>${can ? `${a.done ? '' : `<button class="btn btn-sm" data-act-done="${a.id}">✓ تمّت</button>`}<button class="iconbtn danger" data-act-del="${a.id}" aria-label="حذف"><svg class="ic"><use href="#i-trash"/></svg></button>` : ''}</div>`; }).join('') || '<p class="muted">لا أنشطة مجدولة.</p>'}</div>
      ${can ? `<form class="act-form" id="actAdd"><select id="actType">${Object.entries(ACTIVITY_TYPES).map(([k, v]) => `<option value="${k}">${v[1]} ${v[0]}</option>`).join('')}</select><input type="text" id="actSummary" placeholder="الملخص" maxlength="120" required><input type="date" id="actDue" value="${isoDate(addDays(new Date(), 1))}"><select id="actUser">${state.users.map(u => `<option value="${u.uid}" ${u.uid === state.user.uid ? 'selected' : ''}>${esc(u.displayName || u.email)}</option>`).join('')}</select><button type="submit" class="btn btn-primary btn-sm">جدولة</button></form>` : ''}`;
    const f = $('actAdd'); if (f) f.onsubmit = e => { e.preventDefault(); patch({ activities: [...(t.activities || []), { id: uid(), type: $('actType').value, summary: $('actSummary').value.trim(), due: $('actDue').value || null, uid: $('actUser').value, done: false, createdAt: Date.now() }] }); };
    body.querySelectorAll('[data-act-done]').forEach(b => { b.onclick = () => { patch({ activities: (t.activities || []).map(a => a.id === b.dataset.actDone ? { ...a, done: true, doneAt: Date.now() } : a) }); api.addMessage(t.id, { type: 'note', text: `✅ تمّ النشاط: ${(t.activities || []).find(a => a.id === b.dataset.actDone)?.summary || ''}` }).then(m => { if (messages && m) { messages.push(m); renderChatter(); } }); }; });
    body.querySelectorAll('[data-act-del]').forEach(b => { b.onclick = () => patch({ activities: (t.activities || []).filter(a => a.id !== b.dataset.actDel) }); });
  }
  if (tab === 'files') {
    const files = t.attachments || [];
    body.innerHTML = `<div class="files">${files.map(f => `<a class="file" href="${esc(f.url)}" target="_blank" rel="noopener">${f.type && f.type.startsWith('image/') ? `<img src="${esc(f.url)}" alt="">` : `<span class="file-ico">📄</span>`}<span class="file-name">${esc(f.name)}</span><small class="hint">${(f.size / 1024).toFixed(0)} KB · ${esc(userLabel(f.uid))}</small></a>`).join('') || '<p class="muted">لا مرفقات.</p>'}</div>
      ${can ? `<label class="btn btn-sm" id="fileBtn"><svg class="ic"><use href="#i-plus"/></svg> إضافة ملف <input type="file" id="fileInput" hidden multiple></label><p class="hint">${isDemo() ? 'الوضع التجريبي: حتى 400KB لكل ملف، يُحفظ على الجهاز.' : 'يُرفع إلى Firebase Storage (حتى 10MB).'}</p>` : ''}`;
    const inp = $('fileInput'); if (inp) inp.onchange = async () => { for (const f of inp.files) { try { await api.uploadAttachment(t.id, f); toast(`تم رفع ${f.name}`, { type: 'ok' }); } catch (e) { toast(e.message === 'too-large' ? 'الملف كبير جداً' : e.message === 'storage-unavailable' ? 'التخزين غير مفعّل في Firebase' : 'تعذّر الرفع', { type: 'err' }); } } };
  }
}

// ---------- المؤقت ----------
function toggleTimer(t) {
  if (timerStart && timerStart.taskId === t.id) {
    const hours = Math.max(0.25, Math.round(((Date.now() - timerStart.at) / 3600000) * 4) / 4);
    localStorage.removeItem(TIMER_KEY); timerStart = null; clearInterval(timerTick);
    patch({ timesheets: [...(t.timesheets || []), { id: uid(), uid: state.user.uid, date: isoDate(), hours, note: 'مؤقت' }] });
    toast(`تم تسجيل ${hours} ساعة`, { type: 'ok' });
  } else {
    if (timerStart) { toast('يوجد مؤقت يعمل على مهمة أخرى', { type: 'err' }); return; }
    timerStart = { taskId: t.id, at: Date.now() }; localStorage.setItem(TIMER_KEY, JSON.stringify(timerStart)); render();
  }
}
function tickTimer() {
  clearInterval(timerTick);
  const upd = () => { const el = $('tpTimerTxt'); if (!el || !timerStart) { clearInterval(timerTick); return; } const s = Math.floor((Date.now() - timerStart.at) / 1000); el.textContent = `المؤقت يعمل: ${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  upd(); timerTick = setInterval(upd, 1000);
}

// ---------- Chatter ----------
function renderChatter() {
  const t = task(); const box = $('tpChatter'); if (!t || !box) return;
  const items = (messages || []).slice().sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
  box.innerHTML = `<div class="ch-head"><h3>المحادثة والسجل</h3><span class="hint">${items.length} رسالة</span></div>
    <div class="ch-list">${messages == null ? '<p class="hint">جارٍ التحميل…</p>' : items.map(m => `<div class="ch-msg ${m.type || 'comment'}">${avatar(m.uid, 28)}<div class="ch-body"><div class="ch-meta"><strong>${esc(m.name || userLabel(m.uid) || m.email || '')}</strong><span class="hint">${fmtDateTime(m.createdAt)}${m.type === 'note' ? ' · ملاحظة داخلية' : ''}</span></div><div class="ch-text">${linkify(esc(m.text || ''))}</div></div></div>`).join('') || '<p class="muted">لا رسائل بعد. ابدأ المحادثة أو سجّل ملاحظة.</p>'}</div>
    <form class="ch-form" id="chForm"><textarea id="chText" rows="2" placeholder="اكتب تعليقاً… (@اسم للإشارة)" maxlength="2000"></textarea><div class="ch-actions"><label class="switch small"><input type="checkbox" id="chNote"><span>ملاحظة داخلية</span></label><button type="submit" class="btn btn-primary btn-sm">إرسال</button></div></form>`;
  $('chForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('chText').value.trim(); if (!text) return;
    const mentions = state.users.filter(u => u.displayName && text.includes('@' + u.displayName)).map(u => u.uid);
    const m = await api.addMessage(t.id, { type: $('chNote').checked ? 'note' : 'comment', text, mentions });
    if (m) { messages = [...(messages || []), m]; renderChatter(); }
    $('chText').value = '';
  };
  $('chText').onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('chForm').requestSubmit(); };
  const list = box.querySelector('.ch-list'); list.scrollTop = 1e9;
}
function linkify(s) { return s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/@([\p{L}\d_]+)/gu, '<span class="mention">@$1</span>'); }
