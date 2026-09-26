// مخطط جانت: أشرطة على محور أيام، سحب لتحريك المهمة وتغيير مدتها، خط اليوم، معالم المشروع،
// خطوط الاعتماديات (محجوبة بـ)، وإزاحة تلقائية للمهام التابعة عند التأخير.
import { esc, isoDate, addDays, fmtDate } from './utils.js';
import { ganttRange, dayIndex } from './model.js';
import { dependencyLinks, shiftDependents } from './analytics.js';

const DAY_W = 28, ROW_H = 36;

/** opts: { project, onChange(taskId, {startDate, dueDate}, shifts[]), onOpen(taskId) } */
export function renderGantt(container, tasks, opts = {}) {
  const range = ganttRange(tasks, opts.project);
  const days = dayIndex(range.end, range.start) + 1;
  const todayIdx = dayIndex(isoDate(), range.start);
  const rows = tasks.filter(t => !t.parentId).concat(tasks.filter(t => t.parentId));
  const rtl = document.documentElement.dir === 'rtl';
  const W = days * DAY_W;
  const px = (i) => (rtl ? W - i * DAY_W : i * DAY_W);
  // رؤوس الشهور
  const months = [];
  for (let i = 0; i < days; i++) { const d = addDays(range.start, i); const k = `${d.getFullYear()}-${d.getMonth()}`; if (!months.length || months[months.length - 1].k !== k) months.push({ k, label: d.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' }), from: i, n: 1 }); else months[months.length - 1].n++; }
  const dayCells = Array.from({ length: days }, (_, i) => { const d = addDays(range.start, i); return `<span class="g-day ${d.getDay() === 5 ? 'fri' : ''} ${i === todayIdx ? 'today' : ''}">${d.getDate()}</span>`; }).join('');
  const milestones = opts.project && opts.project.milestones ? opts.project.milestones.filter(m => m.date) : [];
  // مواضع الأشرطة لرسم خطوط الاعتماديات
  const pos = new Map();
  rows.forEach((t, i) => { const start = t.startDate || t.dueDate, end = t.dueDate || t.startDate; if (!start) return; const a = dayIndex(start, range.start), b = Math.max(a, dayIndex(end, range.start)); pos.set(t.id, { a, b, y: i * ROW_H + ROW_H / 2 }); });
  const links = dependencyLinks(rows).filter(l => pos.has(l.from) && pos.has(l.to));
  const dir = rtl ? -1 : 1;
  const paths = links.map(l => {
    const f = pos.get(l.from), t = pos.get(l.to);
    const x1 = px(f.b + 1) - dir * 4, x2 = px(t.a);
    const late = f.b >= t.a; // التابعة تبدأ قبل انتهاء الحاجبة
    const mid = x1 + dir * 10;
    return `<path d="M${x1} ${f.y} L${mid} ${f.y} L${mid} ${t.y} L${x2} ${t.y}" class="${late ? 'late' : ''}" marker-end="url(#g-arrow)"><title>${esc(rows.find(x => x.id === l.to)?.name || '')} تعتمد على ${esc(rows.find(x => x.id === l.from)?.name || '')}</title></path>`;
  }).join('');
  container.innerHTML = `<div class="gantt" style="--dw:${DAY_W}px;--days:${days}">
    <div class="g-side"><div class="g-side-head">المهمة</div>${rows.map(t => `<div class="g-row-label ${t.parentId ? 'sub' : ''} ${t.completed ? 'done' : ''}" data-open="${t.id}" title="${esc(t.name)}">${(t.blockedBy || []).length ? '<span class="hint" title="تعتمد على مهام أخرى">⛓ </span>' : ''}${esc(t.name)}</div>`).join('')}</div>
    <div class="g-scroll"><div class="g-body">
      <div class="g-months">${months.map(m => `<span style="inset-inline-start:${m.from * DAY_W}px;width:${m.n * DAY_W}px">${m.label}</span>`).join('')}</div>
      <div class="g-days">${dayCells}</div>
      <div class="g-grid">
        ${todayIdx >= 0 && todayIdx < days ? `<div class="g-today" style="inset-inline-start:${todayIdx * DAY_W + DAY_W / 2}px"></div>` : ''}
        ${milestones.map(m => { const i = dayIndex(m.date, range.start); return i < 0 || i >= days ? '' : `<div class="g-ms ${m.done ? 'done' : ''}" style="inset-inline-start:${i * DAY_W + DAY_W / 2}px" title="${esc(m.name)} — ${fmtDate(m.date)}"><span>◆</span><small>${esc(m.name)}</small></div>`; }).join('')}
        ${links.length ? `<svg class="g-links" width="${W}" height="${rows.length * ROW_H}" viewBox="0 0 ${W} ${rows.length * ROW_H}"><defs><marker id="g-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>${paths}</svg>` : ''}
        ${rows.map(t => {
          const start = t.startDate || t.dueDate, end = t.dueDate || t.startDate;
          if (!start) return `<div class="g-row"><span class="g-none">بدون تاريخ</span></div>`;
          const a = dayIndex(start, range.start), b = Math.max(a, dayIndex(end, range.start));
          const color = t.completed ? 'var(--text-3)' : (opts.project && opts.project.color) || 'var(--primary)';
          return `<div class="g-row"><div class="g-bar ${t.completed ? 'done' : ''} ${t.parentId ? 'sub' : ''}" data-id="${t.id}" data-a="${a}" data-b="${b}" style="inset-inline-start:${a * DAY_W}px;width:${(b - a + 1) * DAY_W - 4}px;background:${color}" title="${esc(t.name)}: ${fmtDate(start)} → ${fmtDate(end)}"><span class="g-h g-hl"></span><span class="g-txt">${esc(t.name)}</span><span class="g-h g-hr"></span></div></div>`;
        }).join('')}
      </div>
    </div></div>
  </div>${links.length ? `<p class="hint">⛓ ${links.length} اعتمادية · الخط الأحمر يعني أن المهمة التابعة تبدأ قبل انتهاء ما تعتمد عليه. عند تأخير مهمة تُعرض إزاحة التابعة تلقائياً.</p>` : ''}`;
  container.querySelectorAll('[data-open]').forEach(el => { el.onclick = () => opts.onOpen && opts.onOpen(el.dataset.open); });
  const scroll = container.querySelector('.g-scroll');
  scroll.scrollLeft = rtl ? -(Math.max(0, todayIdx - 5) * DAY_W) : Math.max(0, todayIdx - 5) * DAY_W;

  // سحب / تغيير حجم
  let drag = null;
  container.querySelectorAll('.g-bar').forEach(bar => {
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const mode = e.target.classList.contains('g-hl') ? 'l' : e.target.classList.contains('g-hr') ? 'r' : 'm';
      drag = { bar, mode, x0: e.clientX, a: Number(bar.dataset.a), b: Number(bar.dataset.b), moved: false };
      bar.setPointerCapture(e.pointerId); bar.classList.add('dragging');
    });
    bar.addEventListener('pointermove', (e) => {
      if (!drag || drag.bar !== bar) return;
      let dx = Math.round((e.clientX - drag.x0) / DAY_W); if (rtl) dx = -dx;
      if (dx !== 0) drag.moved = true;
      let a = drag.a, b = drag.b;
      if (drag.mode === 'm') { a += dx; b += dx; } else if (drag.mode === 'l') a = Math.min(b, drag.a + dx); else b = Math.max(a, drag.b + dx);
      bar.style.insetInlineStart = `${a * DAY_W}px`; bar.style.width = `${(b - a + 1) * DAY_W - 4}px`;
      bar.dataset.na = a; bar.dataset.nb = b;
    });
    const finish = () => {
      if (!drag || drag.bar !== bar) return;
      bar.classList.remove('dragging');
      const a = Number(bar.dataset.na ?? drag.a), b = Number(bar.dataset.nb ?? drag.b);
      if (drag.moved && (a !== drag.a || b !== drag.b) && opts.onChange) {
        const dates = { startDate: isoDate(addDays(range.start, a)), dueDate: isoDate(addDays(range.start, b)) };
        opts.onChange(bar.dataset.id, dates, shiftDependents(tasks, bar.dataset.id, dates));
      } else if (!drag.moved && opts.onOpen) opts.onOpen(bar.dataset.id);
      drag = null;
    };
    bar.addEventListener('pointerup', finish); bar.addEventListener('pointercancel', finish);
  });
}
