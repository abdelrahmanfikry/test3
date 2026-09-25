// إيماءات اللمس على صفوف المهام: سحب لليمين = إنجاز، سحب لليسار = تأجيل.
export function initSwipe(container) {
  let row = null, x0 = 0, y0 = 0, dx = 0, active = false;
  const reset = () => { if (row) { row.style.transition = 'transform .18s'; row.style.transform = ''; row.classList.remove('swiping', 'swipe-done', 'swipe-snooze'); } row = null; dx = 0; active = false; };
  container.addEventListener('touchstart', (e) => {
    const r = e.target.closest('.task-list .task'); if (!r || e.target.closest('input, button, a, select')) return;
    row = r; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; active = false; row.style.transition = '';
  }, { passive: true });
  container.addEventListener('touchmove', (e) => {
    if (!row) return;
    const t = e.touches[0]; dx = t.clientX - x0; const dy = t.clientY - y0;
    if (!active) { if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) { active = true; row.classList.add('swiping'); } else if (Math.abs(dy) > 10) { row = null; return; } }
    if (active) { row.style.transform = `translateX(${Math.max(-120, Math.min(120, dx))}px)`; row.classList.toggle('swipe-done', dx > 70); row.classList.toggle('swipe-snooze', dx < -70); }
  }, { passive: true });
  container.addEventListener('touchend', () => {
    if (!row || !active) { reset(); return; }
    const r = row;
    if (dx > 70) { const cb = r.querySelector('label.check:not(.sel) input[type=checkbox]'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); } }
    else if (dx < -70) { const b = r.querySelector('[data-act="snooze"]'); if (b) b.click(); }
    reset();
  });
  container.addEventListener('touchcancel', reset);
}
