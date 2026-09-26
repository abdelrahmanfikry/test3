// لوحة كانبان عامة (على طريقة Odoo): أعمدة قابلة للطيّ، حدود، سحب بين الأعمدة، إضافة سريعة في العمود.
import { esc } from './utils.js';

/**
 * opts: { columns:[{id,name,color,fold,done,limit}], items, colOf(item)->id, card(item)->html,
 *         onMove(itemId, colId, orderedIds), onOpen(itemId), onQuickAdd(colId, name), onColMenu(col, action), folded:Set }
 */
import { ensureSortable } from './lib.js';

export function renderKanban(container, opts) {
  const folded = opts.folded || new Set(opts.columns.filter(c => c.fold).map(c => c.id));
  const groups = new Map(opts.columns.map(c => [c.id, []]));
  for (const it of opts.items) { const cid = opts.colOf(it); if (!groups.has(cid)) groups.set(cid, []); groups.get(cid).push(it); }
  container.innerHTML = `<div class="kanban">${opts.columns.map(col => {
    const items = groups.get(col.id) || [];
    const isFold = folded.has(col.id);
    const over = col.limit && items.length > col.limit;
    // شريط تقدّم العمود كما في Odoo: منجز (أخضر) / متأخر (أحمر) / أولوية عالية (أصفر) / الباقي
    const n = Math.max(1, items.length);
    const seg = { done: items.filter(i => i.completed).length, late: items.filter(i => !i.completed && i.dueDate && i.dueDate < new Date().toISOString().slice(0, 10)).length };
    seg.high = items.filter(i => !i.completed && i.priority === 'high' && !(i.dueDate && i.dueDate < new Date().toISOString().slice(0, 10))).length;
    const bar = items.length ? `<div class="kcol-bar" title="منجز ${seg.done} · متأخر ${seg.late} · عالي ${seg.high}"><i class="done" style="width:${(seg.done / n) * 100}%"></i><i class="late" style="width:${(seg.late / n) * 100}%"></i><i class="high" style="width:${(seg.high / n) * 100}%"></i></div>` : '';
    return `<section class="kcol ${isFold ? 'folded' : ''} ${col.done ? 'done' : ''}" data-col="${col.id}" style="--kc:${col.color || '#64748b'}">
      <header class="kcol-head">
        <button class="kcol-fold" data-fold="${col.id}" title="${isFold ? 'فتح' : 'طيّ'}"><svg class="ic"><use href="#i-${isFold ? 'next' : 'prev'}"/></svg></button>
        <span class="kcol-dot"></span><h3>${esc(col.name)}</h3>
        <span class="kcol-count ${over ? 'over' : ''}">${items.length}${col.limit ? `/${col.limit}` : ''}</span>
        ${opts.onColMenu ? `<button class="iconbtn kcol-menu" data-colmenu="${col.id}" aria-label="خيارات"><svg class="ic"><use href="#i-dots"/></svg></button>` : ''}
        ${opts.onQuickAdd && !col.done ? `<button class="iconbtn" data-qa="${col.id}" title="إضافة"><svg class="ic"><use href="#i-plus"/></svg></button>` : ''}
      </header>
      ${isFold ? '' : bar}
      <div class="kcol-body" data-body="${col.id}">${isFold ? '' : items.map(it => `<article class="kcard" data-id="${it.id}">${opts.card(it)}</article>`).join('')}</div>
      ${opts.onQuickAdd && !col.done && !isFold ? `<form class="kcol-add" data-qaform="${col.id}" hidden><input type="text" placeholder="اسم المهمة… Enter" maxlength="140"><div class="btn-row"><button type="submit" class="btn btn-primary btn-sm">إضافة</button><button type="button" class="btn btn-sm" data-cancel>إلغاء</button></div></form>` : ''}
    </section>`;
  }).join('')}</div>`;

  container.querySelectorAll('[data-fold]').forEach(b => { b.onclick = () => { const id = b.dataset.fold; folded.has(id) ? folded.delete(id) : folded.add(id); renderKanban(container, { ...opts, folded }); }; });
  container.querySelectorAll('.kcard').forEach(c => { c.onclick = (e) => { if (e.target.closest('input, button, a')) return; opts.onOpen(c.dataset.id); }; });
  container.querySelectorAll('[data-qa]').forEach(b => { b.onclick = () => { const f = container.querySelector(`[data-qaform="${b.dataset.qa}"]`); if (!f) return; f.hidden = false; f.querySelector('input').focus(); }; });
  container.querySelectorAll('[data-qaform]').forEach(f => {
    f.onsubmit = (e) => { e.preventDefault(); const inp = f.querySelector('input'); const v = inp.value.trim(); if (!v) return; inp.value = ''; inp.blur(); f.hidden = true; opts.onQuickAdd(f.dataset.qaform, v); };
    f.querySelector('[data-cancel]').onclick = () => { f.hidden = true; };
  });
  if (opts.onColMenu) container.querySelectorAll('[data-colmenu]').forEach(b => { b.onclick = (e) => { e.stopPropagation(); opts.onColMenu(opts.columns.find(c => c.id === b.dataset.colmenu), b); }; });
  // السحب: تُحمَّل مكتبة Sortable عند أول حاجة فقط
  ensureSortable().then(S => {
    if (!container.isConnected) return;
    container.querySelectorAll('.kcol-body').forEach(body => {
      new S(body, {
        group: 'kanban', animation: 150, ghostClass: 'ghost', delay: 120, delayOnTouchOnly: true,
        onEnd: (ev) => {
          const colId = ev.to.dataset.body;
          const ids = [...ev.to.querySelectorAll('.kcard')].map(x => x.dataset.id);
          opts.onMove(ev.item.dataset.id, colId, ids);
        },
      });
    });
  }).catch(() => {});
  return folded;
}
