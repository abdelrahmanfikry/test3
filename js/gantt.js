// مخطط جانت بسيط: أشرطة على محور أيام، سحب لتحريك المهمة وتغيير مدتها، خط اليوم، ومعالم المشروع.
import { esc, isoDate, addDays, fmtDate } from './utils.js';
import { ganttRange, dayIndex } from './model.js';

const DAY_W = 28;

/** opts: { project, onChange(taskId, {startDate, dueDate}), onOpen(taskId) } */
export function renderGantt(container, tasks, opts = {}) {
  const range = ganttRange(tasks, opts.project);
  const days = dayIndex(range.end, range.start) + 1;
  const todayIdx = dayIndex(isoDate(), range.start);
  const rows = tasks.filter(t => !t.parentId).concat(tasks.filter(t => t.parentId));
  // رؤوس الشهور
  const months = [];
  for (let i = 0; i < days; i++) { const d = addDays(range.start, i); const k = `${d.getFullYear()}-${d.getMonth()}`; if (!months.length || months[months.length - 1].k !== k) months.push({ k, label: d.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' }), from: i, n: 1 }); else months[months.length - 1].n++; }
  const dayCells = Array.from({ length: days }, (_, i) => { const d = addDays(range.start, i); return `<span class="g-day ${d.getDay() === 5 ? 'fri' : ''} ${i === todayIdx ? 'today' : ''}">${d.getDate()}</span>`; }).join('');
  const milestones = opts.project && opts.project.milestones ? opts.project.milestones.filter(m => m.date) : [];
  container.innerHTML = `<div class="gantt" style="--dw:${DAY_W}px;--days:${days}">
    <div class="g-side"><div class="g-side-head">المهمة</div>${rows.map(t => `<div class="g-row-label ${t.parentId ? 'sub' : ''} ${t.completed ? 'done' : ''}" data-open="${t.id}" title="${esc(t.name)}">${esc(t.name)}</div>`).join('')}</div>
    <div class="g-scroll"><div class="g-body">
      <div class="g-months">${months.map(m => `<span style="inset-inline-start:${m.from * DAY_W}px;width:${m.n * DAY_W}px">${m.label}</span>`).join('')}</div>
      <div class="g-days">${dayCells}</div>
      <div class="g-grid">
        ${todayIdx >= 0 && todayIdx < days ? `<div class="g-today" style="inset-inline-start:${todayIdx * DAY_W + DAY_W / 2}px"></div>` : ''}
        ${milestones.map(m => { const i = dayIndex(m.date, range.start); return i < 0 || i >= days ? '' : `<div class="g-ms ${m.done ? 'done' : ''}" style="inset-inline-start:${i * DAY_W + DAY_W / 2}px" title="${esc(m.name)} — ${fmtDate(m.date)}"><span>◆</span><small>${esc(m.name)}</small></div>`; }).join('')}
        ${rows.map(t => {
          const start = t.startDate || t.dueDate, end = t.dueDate || t.startDate;
          if (!start) return `<div class="g-row"><span class="g-none">بدون تاريخ</span></div>`;
          const a = dayIndex(start, range.start), b = Math.max(a, dayIndex(end, range.start));
          const color = t.completed ? 'var(--text-3)' : (opts.project && opts.project.color) || 'var(--primary)';
          return `<div class="g-row"><div class="g-bar ${t.completed ? 'done' : ''} ${t.parentId ? 'sub' : ''}" data-id="${t.id}" data-a="${a}" data-b="${b}" style="inset-inline-start:${a * DAY_W}px;width:${(b - a + 1) * DAY_W - 4}px;background:${color}" title="${esc(t.name)}: ${fmtDate(start)} → ${fmtDate(end)}"><span class="g-h g-hl"></span><span class="g-txt">${esc(t.name)}</span><span class="g-h g-hr"></span></div></div>`;
        }).join('')}
      </div>
    </div></div>
  </div>`;
  container.querySelectorAll('[data-open]').forEach(el => { el.onclick = () => opts.onOpen && opts.onOpen(el.dataset.open); });
  const scroll = container.querySelector('.g-scroll');
  scroll.scrollLeft = document.documentElement.dir === 'rtl' ? -(Math.max(0, todayIdx - 5) * DAY_W) : Math.max(0, todayIdx - 5) * DAY_W;

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
      const rtl = document.documentElement.dir === 'rtl';
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
      if (drag.moved && (a !== drag.a || b !== drag.b) && opts.onChange) opts.onChange(bar.dataset.id, { startDate: isoDate(addDays(range.start, a)), dueDate: isoDate(addDays(range.start, b)) });
      else if (!drag.moved && opts.onOpen) opts.onOpen(bar.dataset.id);
      drag = null;
    };
    bar.addEventListener('pointerup', finish); bar.addEventListener('pointercancel', finish);
  });
}
