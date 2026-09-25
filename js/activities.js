// صفحة الأنشطة (على طريقة Odoo Activity view): كل أنشطتي المجدولة عبر المهام، متأخرة/اليوم/قادمة.
import { state } from './store.js';
import { api } from './data.js';
import { esc, relativeDue, fmtDate, isoDate } from './utils.js';
import { myActivities, activityState, ACTIVITY_TYPES } from './model.js';
import { openTask } from './task-panel.js';
import { toast } from './ui.js';

export function renderActivities(el) {
  const all = myActivities(state.tasks, null).filter(a => state.isAdmin || !a.uid || a.uid === state.user.uid);
  const groups = { overdue: [], today: [], planned: [] };
  for (const a of all) groups[activityState(a)].push(a);
  const titles = { overdue: 'متأخرة', today: 'اليوم', planned: 'مخططة' };
  const goalOf = (t) => state.goals.find(g => g.id === t.goalId);
  el.innerHTML = `<div class="toolbar"><h2><svg class="ic"><use href="#i-history"/></svg> الأنشطة <small class="hint">${all.length}</small></h2><p class="hint">جدول الأنشطة (اتصال، اجتماع، تذكير…) من داخل أي مهمة → تبويب «الأنشطة».</p></div>
    ${all.length ? Object.keys(groups).filter(k => groups[k].length).map(k => `<h4 class="grp-title ${k === 'overdue' ? 'danger' : k === 'today' ? 'warn' : ''}">${titles[k]} <small>${groups[k].length}</small></h4><div class="act-list">${groups[k].map(a => { const g = goalOf(a.task) || {}; return `<div class="act ${k === 'overdue' ? 'late' : ''}"><span class="act-ico">${ACTIVITY_TYPES[a.type] ? ACTIVITY_TYPES[a.type][1] : '✅'}</span><div class="act-main"><strong>${esc(a.summary || '')}</strong><div class="hint"><span class="goal-tag" style="--gc:${g.color || '#2563eb'}">${esc(g.name || '')}</span> · <button class="linkbtn" data-open="${a.task.id}">${esc(a.task.name)}</button> · ${a.due ? relativeDue(a.due) : ''}</div></div><button class="btn btn-sm" data-done="${a.task.id}:${a.id}">✓ تمّت</button></div>`; }).join('')}</div>`).join('') : `<div class="empty"><svg class="ic big"><use href="#i-history"/></svg><h3>لا أنشطة مجدولة</h3><p>افتح أي مهمة → «الأنشطة» → جدولة.</p></div>`}`;
  el.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => openTask(b.dataset.open, 'activities'); });
  el.querySelectorAll('[data-done]').forEach(b => { b.onclick = async () => { const [tid, aid] = b.dataset.done.split(':'); const t = state.tasks.find(x => x.id === tid); if (!t) return; await api.updateTask(tid, { activities: (t.activities || []).map(a => a.id === aid ? { ...a, done: true, doneAt: Date.now() } : a) }); toast('تمّ النشاط', { type: 'ok' }); }; });
}
