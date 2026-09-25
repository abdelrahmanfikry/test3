// التحديد المتعدد والإجراءات الجماعية على المهام + قائمة التأجيل السريع (Snooze).
import { state } from './store.js';
import { api, isDemo } from './data.js';
import { isoDate, addDays, PRIORITIES } from './utils.js';
import { toast, confirmDialog, popMenu } from './ui.js';
import { completionPatch, projectStages, firstOpenStage, stagePatch } from './model.js';

export const bulk = { on: false, ids: new Set() };
let bar = null, rerenderFn = null;

export function toggleBulk() { bulk.on = !bulk.on; bulk.ids.clear(); if (!bulk.on) removeBar(); }
export function bulkCheckbox(t) { return bulk.on ? `<label class="check sel"><input type="checkbox" data-sel="${t.id}" ${bulk.ids.has(t.id) ? 'checked' : ''} aria-label="تحديد"><span></span></label>` : ''; }

export function bindBulk(root, rerender) {
  rerenderFn = rerender;
  root.querySelectorAll('[data-sel]').forEach(cb => { cb.onchange = () => { cb.checked ? bulk.ids.add(cb.dataset.sel) : bulk.ids.delete(cb.dataset.sel); updateBar(); }; });
  if (bulk.on) updateBar(); else removeBar();
}

function removeBar() { if (bar) { bar.remove(); bar = null; } }
function nowTs() { return isDemo() ? Date.now() : window.firebase.firestore.FieldValue.serverTimestamp(); }
function selected() { return [...bulk.ids].map(id => state.tasks.find(t => t.id === id)).filter(Boolean); }

async function applyEach(fn, msg) {
  const list = selected(); if (!list.length) { toast('حدّد مهمة واحدة على الأقل', { type: 'err' }); return; }
  let ok = 0;
  for (const t of list) { try { await fn(t); ok++; } catch (e) { console.error(e); } }
  toast(`${msg} (${ok})`, { type: 'ok' });
  bulk.ids.clear(); updateBar(); if (rerenderFn) rerenderFn();
}

function updateBar() {
  if (!bulk.on) { removeBar(); return; }
  if (!bar) { bar = document.createElement('div'); bar.className = 'bulk-bar'; document.body.appendChild(bar); }
  const n = bulk.ids.size;
  bar.innerHTML = `<span class="bulk-count"><strong>${n}</strong> محددة</span>
    <button class="btn btn-sm" data-b="all">تحديد الكل</button>
    <button class="btn btn-sm btn-ok" data-b="done" ${n ? '' : 'disabled'}>✓ إنجاز</button>
    <button class="btn btn-sm" data-b="priority" ${n ? '' : 'disabled'}>الأولوية ▾</button>
    <button class="btn btn-sm" data-b="due" ${n ? '' : 'disabled'}>الموعد ▾</button>
    <button class="btn btn-sm" data-b="assignee" ${n ? '' : 'disabled'}>المكلّف ▾</button>
    <button class="btn btn-sm" data-b="move" ${n ? '' : 'disabled'}>نقل لمشروع ▾</button>
    <button class="btn btn-sm btn-danger" data-b="delete" ${n ? '' : 'disabled'}>حذف</button>
    <button class="iconbtn" data-b="cancel" aria-label="إلغاء التحديد"><svg class="ic"><use href="#i-close"/></svg></button>`;
  bar.querySelectorAll('[data-b]').forEach(b => {
    b.onclick = async () => {
      const act = b.dataset.b;
      if (act === 'cancel') { bulk.on = false; bulk.ids.clear(); removeBar(); if (rerenderFn) rerenderFn(); return; }
      if (act === 'all') { document.querySelectorAll('#view [data-sel]').forEach(cb => { cb.checked = true; bulk.ids.add(cb.dataset.sel); }); updateBar(); return; }
      if (act === 'done') { await applyEach(t => { const g = state.goals.find(x => x.id === t.goalId); const p = completionPatch(g, true); p.completedAt = nowTs(); return api.updateTask(t.id, p); }, 'تم إنجاز المهام'); return; }
      if (act === 'priority') { popMenu(b, Object.entries(PRIORITIES).map(([k, v]) => ({ label: v.label, run: () => applyEach(t => api.updateTask(t.id, { priority: k }), 'تم تغيير الأولوية') })), { above: true }); return; }
      if (act === 'due') { popMenu(b, [['اليوم', 0], ['غداً', 1], ['بعد 3 أيام', 3], ['بعد أسبوع', 7]].map(([l, d]) => ({ label: l, run: () => applyEach(t => api.updateTask(t.id, { dueDate: isoDate(addDays(new Date(), d)) }), 'تم تحديد الموعد') })).concat([{ label: 'بدون موعد', run: () => applyEach(t => api.updateTask(t.id, { dueDate: null }), 'أُزيل الموعد') }]), { above: true }); return; }
      if (act === 'assignee') { popMenu(b, [{ label: 'بدون مكلّف', run: () => applyEach(t => api.updateTask(t.id, { assignedToUid: null, assignedUserIds: [] }), 'أُزيل التكليف') }, ...state.users.map(u => ({ label: u.displayName || u.email, run: () => applyEach(t => api.updateTask(t.id, { assignedToUid: u.uid, assignedUserIds: [u.uid] }), 'تم التكليف') }))], { above: true }); return; }
      if (act === 'move') { const goals = state.goals.filter(g => !g.archived && !g.template); popMenu(b, goals.map(g => ({ label: g.name, color: g.color, run: () => applyEach(t => api.updateTask(t.id, { goalId: g.id, ...stagePatch(firstOpenStage(projectStages(g))), completed: false, completedAt: null, tags: [] }), `نُقلت إلى «${g.name}»`) })), { above: true }); return; }
      if (act === 'delete') { const ids = [...bulk.ids]; if (!(await confirmDialog(`نقل ${ids.length} مهمة إلى سلة المحذوفات؟`, { okLabel: 'حذف' }))) return; await applyEach(t => api.deleteTask(t.id), 'نُقلت إلى سلة المحذوفات'); toast('يمكنك الاستعادة من سلة المحذوفات', { action: 'تراجع', onAction: () => ids.forEach(id => api.restoreTask(id).catch(() => {})) }); }
    };
  });
}

/** قائمة تأجيل سريع لمهمة واحدة */
export function snoozeMenu(t, anchor) {
  const items = [['غداً', 1], ['بعد 3 أيام', 3], ['الأسبوع القادم', 7], ['بعد أسبوعين', 14]].map(([l, d]) => ({ label: `${l} · ${isoDate(addDays(new Date(), d)).slice(5)}`, run: () => api.updateTask(t.id, { dueDate: isoDate(addDays(new Date(), d)) }).then(() => toast(`أُجّلت إلى ${l}`, { type: 'ok' })) }));
  items.push({ label: 'اليوم', run: () => api.updateTask(t.id, { dueDate: isoDate() }).then(() => toast('الموعد: اليوم', { type: 'ok' })) });
  items.push({ label: 'بدون موعد', run: () => api.updateTask(t.id, { dueDate: null }).then(() => toast('أُزيل الموعد', { type: 'ok' })) });
  popMenu(anchor, items);
}

/** حذف مهمة مع إمكانية التراجع */
export async function deleteTaskWithUndo(t) {
  if (!(await confirmDialog(`نقل المهمة «${t.name}» إلى سلة المحذوفات؟`, { okLabel: 'حذف', danger: true }))) return false;
  await api.deleteTask(t.id);
  toast('نُقلت إلى سلة المحذوفات', { action: 'تراجع', onAction: () => api.restoreTask(t.id).then(() => toast('تمت الاستعادة', { type: 'ok' })), ms: 6000 });
  return true;
}
export async function deleteGoalWithUndo(g, taskCount) {
  if (!(await confirmDialog(`نقل المشروع «${g.name}» ومهامه (${taskCount}) إلى سلة المحذوفات؟`, { okLabel: 'حذف' }))) return false;
  await api.deleteGoal(g.id);
  toast('نُقل المشروع إلى سلة المحذوفات', { action: 'تراجع', onAction: () => api.restoreGoal(g.id).then(() => toast('تمت الاستعادة', { type: 'ok' })), ms: 6000 });
  return true;
}
