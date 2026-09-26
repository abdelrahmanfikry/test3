// قوالب مهام مستقلة عن المشاريع (مشتركة للفريق): حفظ من بطاقة المهمة، وإنشاء مهمة من قالب في أي مشروع.
import { state } from './store.js';
import { api } from './data.js';
import { esc, uid, isoDate, addDays } from './utils.js';
import { toast, promptDialog, popMenu, confirmDialog } from './ui.js';
import { projectStages, firstOpenStage } from './model.js';

export function taskTemplates() { return state.taskTemplates || []; }

/** حفظ مهمة موجودة كقالب (اسم، أولوية، وصف، قائمة مراجعة، ساعات، تكرار، مدة بالأيام) */
export async function saveAsTemplate(t) {
  const name = await promptDialog('اسم القالب', t.name); if (!name) return;
  const days = t.startDate && t.dueDate ? Math.max(0, Math.round((new Date(t.dueDate + 'T00:00:00') - new Date(t.startDate + 'T00:00:00')) / 86400000)) : null;
  const tpl = { id: uid(), name, priority: t.priority || 'medium', notes: t.notes || '', checklist: (t.checklist || []).map(c => c.text), plannedHours: Number(t.plannedHours) || 0, recurrence: t.recurrence || null, durationDays: days, createdBy: state.user.uid, createdAt: Date.now() };
  try { await api.saveTaskTemplate(tpl); toast('تم حفظ القالب', { type: 'ok' }); } catch (e) { console.error(e); toast('تعذّر الحفظ', { type: 'err' }); }
}

/** إنشاء مهمة من قالب في مشروع معيّن */
export async function createFromTaskTemplate(tpl, goalId, extra = {}) {
  const g = state.goals.find(x => x.id === goalId); if (!g) { toast('اختر مشروعاً أولاً', { type: 'err' }); return null; }
  const start = extra.startDate || isoDate();
  const doc = { name: tpl.name, goalId, priority: tpl.priority || 'medium', notes: tpl.notes || '', plannedHours: tpl.plannedHours || 0, checklist: (tpl.checklist || []).map(text => ({ id: uid(), text, done: false })), recurrence: tpl.recurrence || null, stageId: firstOpenStage(projectStages(g)).id, assignedToUid: extra.assignedToUid || state.user.uid, assignedUserIds: [extra.assignedToUid || state.user.uid], startDate: tpl.durationDays != null ? start : null, dueDate: tpl.durationDays != null ? isoDate(addDays(start, tpl.durationDays)) : (extra.dueDate || null), tags: [] };
  const id = await api.createTask(doc);
  toast(`أُنشئت «${tpl.name}» من القالب`, { type: 'ok' });
  return id;
}

/** قائمة اختيار قالب قرب زر */
export function templatePicker(anchor, goalId, onCreated) {
  const list = taskTemplates();
  if (!list.length) { toast('لا قوالب مهام بعد — افتح أي مهمة ثم «حفظ كقالب مهمة»', { ms: 5000 }); return; }
  popMenu(anchor, list.map(tpl => ({ label: `${tpl.name}${tpl.checklist && tpl.checklist.length ? ` · ☑ ${tpl.checklist.length}` : ''}${tpl.plannedHours ? ` · ⏱ ${tpl.plannedHours}` : ''}`, icon: 'copy', run: async () => { const id = await createFromTaskTemplate(tpl, goalId); if (id && onCreated) onCreated(id); } })));
}

/** إدارة القوالب (في الإعدادات) */
export function templatesHtml() {
  const list = taskTemplates();
  return `<div class="panel"><h2>قوالب المهام <small class="hint">${list.length}</small></h2>
    ${list.length ? `<div class="trash-list">${list.map(tpl => `<div class="trash-row" data-tpl="${tpl.id}"><svg class="ic"><use href="#i-copy"/></svg><div class="trash-main"><strong>${esc(tpl.name)}</strong><div class="hint">${tpl.checklist && tpl.checklist.length ? `☑ ${tpl.checklist.length} عنصر · ` : ''}${tpl.plannedHours ? `⏱ ${tpl.plannedHours} س · ` : ''}${tpl.durationDays != null ? `${tpl.durationDays} يوم · ` : ''}${esc(tpl.notes || '').slice(0, 60)}</div></div><button class="btn btn-sm btn-danger" data-tpl-del="${tpl.id}">حذف</button></div>`).join('')}</div>` : '<p class="muted">لا قوالب بعد. افتح أي مهمة ← ⋯ ← «حفظ كقالب مهمة».</p>'}</div>`;
}
export function bindTemplates(root, rerender) {
  root.querySelectorAll('[data-tpl-del]').forEach(b => { b.onclick = async () => { if (!(await confirmDialog('حذف القالب؟'))) return; await api.deleteTaskTemplate(b.dataset.tplDel); toast('تم حذف القالب'); if (rerender) rerender(); }; });
}
