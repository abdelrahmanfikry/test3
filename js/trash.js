// سلة المحذوفات: استعادة أو حذف نهائي للمشاريع والمهام (تُحذف تلقائياً بعد 30 يوماً).
import { state } from './store.js';
import { api } from './data.js';
import { esc, fmtDateTime, toMillis } from './utils.js';
import { toast, confirmDialog } from './ui.js';

export const TRASH_DAYS = 30;

export function renderTrash(el) {
  const goals = [...(state.trash.goals || [])].sort((a, b) => toMillis(b.deletedAt) - toMillis(a.deletedAt));
  const tasks = [...(state.trash.tasks || [])].filter(t => !t.deletedWithGoal || !goals.some(g => g.id === t.deletedWithGoal)).sort((a, b) => toMillis(b.deletedAt) - toMillis(a.deletedAt));
  const daysLeft = (x) => { const d = toMillis(x.deletedAt); if (!d) return TRASH_DAYS; return Math.max(0, TRASH_DAYS - Math.floor((Date.now() - d) / 86400000)); };
  const row = (x, kind) => `<div class="trash-row" data-kind="${kind}" data-id="${x.id}">
      <svg class="ic"><use href="#i-${kind === 'goal' ? 'flag' : 'check'}"/></svg>
      <div class="trash-main"><strong>${esc(x.name)}</strong><div class="hint">${kind === 'goal' ? `مشروع · ${(state.trash.tasks || []).filter(t => t.deletedWithGoal === x.id).length} مهمة` : `مهمة · ${esc((state.goals.find(g => g.id === x.goalId) || {}).name || '')}`} · حُذف ${x.deletedAt ? fmtDateTime(x.deletedAt) : ''} · يُحذف نهائياً خلال ${daysLeft(x)} يوم</div></div>
      <button class="btn btn-sm" data-restore>استعادة</button><button class="btn btn-sm btn-danger" data-purge>حذف نهائي</button></div>`;
  el.innerHTML = `<div class="toolbar"><h2><svg class="ic"><use href="#i-trash"/></svg> سلة المحذوفات <small class="hint">${goals.length + tasks.length} عنصر</small></h2>${goals.length + tasks.length ? `<button class="btn btn-danger" id="trashEmpty">إفراغ السلة</button>` : ''}</div>
    <p class="hint">العناصر المحذوفة تبقى هنا ${TRASH_DAYS} يوماً ويمكن استعادتها بكل تفاصيلها، ثم تُحذف نهائياً.</p>
    ${goals.length ? `<div class="panel"><h2>مشاريع</h2><div class="trash-list">${goals.map(g => row(g, 'goal')).join('')}</div></div>` : ''}
    ${tasks.length ? `<div class="panel"><h2>مهام</h2><div class="trash-list">${tasks.map(t => row(t, 'task')).join('')}</div></div>` : ''}
    ${!goals.length && !tasks.length ? `<div class="empty"><svg class="ic big"><use href="#i-trash"/></svg><h3>السلة فارغة</h3><p>المهام والمشاريع المحذوفة ستظهر هنا.</p></div>` : ''}`;
  el.querySelectorAll('.trash-row').forEach(r => {
    const kind = r.dataset.kind, id = r.dataset.id;
    r.querySelector('[data-restore]').onclick = async () => { try { await (kind === 'goal' ? api.restoreGoal(id) : api.restoreTask(id)); toast('تمت الاستعادة', { type: 'ok' }); } catch (e) { console.error(e); toast('تعذّرت الاستعادة', { type: 'err' }); } };
    r.querySelector('[data-purge]').onclick = async () => { if (!(await confirmDialog('حذف نهائي؟ لا يمكن التراجع بعدها.', { okLabel: 'حذف نهائي' }))) return; try { await (kind === 'goal' ? api.purgeGoal(id) : api.purgeTask(id)); toast('تم الحذف النهائي'); } catch (e) { console.error(e); toast('تعذّر الحذف', { type: 'err' }); } };
  });
  const em = el.querySelector('#trashEmpty'); if (em) em.onclick = async () => { if (!(await confirmDialog(`حذف ${goals.length + tasks.length} عنصر نهائياً؟`, { okLabel: 'إفراغ' }))) return; for (const g of goals) await api.purgeGoal(g.id).catch(() => {}); for (const t of tasks) await api.purgeTask(t.id).catch(() => {}); toast('أُفرغت السلة'); };
}
