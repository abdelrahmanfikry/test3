// وضع الاجتماع / القراءة: خطة اليوم بخط كبير على شاشة كاملة مع إنجاز مباشر.
import { state, taskBucket, sortTasks, isMine } from './store.js';
import { api, isDemo } from './data.js';
import { esc, relativeDue } from './utils.js';
import { completionPatch } from './model.js';
import { toast } from './ui.js';

let overlay = null, clock = null;

function render() {
  const goals = state.goals.filter(g => !g.archived && !g.template);
  const gid = new Set(goals.map(g => g.id));
  const open = state.tasks.filter(t => !t.completed && gid.has(t.goalId) && !t.parentId);
  const sections = [['متأخرة', sortTasks(open.filter(t => taskBucket(t) === 'overdue')), 'danger'], ['اليوم', sortTasks(open.filter(t => taskBucket(t) === 'today')), 'warn'], ['بنجمة', sortTasks(open.filter(t => t.starred && !['overdue', 'today'].includes(taskBucket(t)))), ''], ['هذا الأسبوع', sortTasks(open.filter(t => taskBucket(t) === 'week' && !t.starred)), '']];
  const doneToday = state.tasks.filter(t => t.completed && t.completedAt && new Date(typeof t.completedAt === 'number' ? t.completedAt : (t.completedAt.seconds || 0) * 1000).toDateString() === new Date().toDateString()).length;
  overlay.innerHTML = `
    <div class="focus-top"><button class="iconbtn" id="tdClose" aria-label="إغلاق"><svg class="ic"><use href="#i-close"/></svg></button><span class="hint">${new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })} · أُنجز اليوم <strong>${doneToday}</strong></span><span style="flex:1"></span><strong class="td-clock" id="tdClock"></strong></div>
    <div class="td-body">
      ${sections.filter(s => s[1].length).map(([title, list, cls]) => `<h2 class="td-h ${cls}">${title} <small>${list.length}</small></h2><ul class="td-list">${list.map(t => { const g = goals.find(x => x.id === t.goalId); return `<li class="td-item ${isMine(t) ? '' : 'other'}"><label class="check"><input type="checkbox" data-td="${t.id}" aria-label="إنجاز"><span></span></label><span class="td-name">${t.starred ? '★ ' : ''}${esc(t.name)}</span><span class="td-meta"><span class="goal-dot" style="background:${g ? g.color : '#2563eb'}"></span>${esc(g ? g.name : '')}${t.dueDate ? ' · ' + relativeDue(t.dueDate) : ''}${t.assignedToUid && t.assignedToUid !== state.user.uid ? ' · ' + esc((state.users.find(u => u.uid === t.assignedToUid) || {}).displayName || '') : ''}</span></li>`; }).join('')}</ul>`).join('') || '<div class="empty"><svg class="ic big"><use href="#i-sun"/></svg><h3>لا شيء عاجل اليوم</h3><p>استمتع بيومك أو خطط للقادم.</p></div>'}
    </div>`;
  overlay.querySelector('#tdClose').onclick = closeToday;
  overlay.querySelectorAll('[data-td]').forEach(cb => {
    cb.onchange = async () => {
      const t = state.tasks.find(x => x.id === cb.dataset.td); if (!t) return;
      const g = state.goals.find(x => x.id === t.goalId);
      const p = completionPatch(g, true); p.completedAt = isDemo() ? Date.now() : window.firebase.firestore.FieldValue.serverTimestamp();
      cb.closest('li').classList.add('done');
      try { await api.updateTask(t.id, p); toast('أحسنت ✅', { type: 'ok', ms: 1500 }); setTimeout(render, 400); } catch { toast('تعذّر الحفظ', { type: 'err' }); cb.checked = false; }
    };
  });
  tickClock();
}
function tickClock() { const el = overlay && overlay.querySelector('#tdClock'); if (el) el.textContent = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }); }

export function openToday() {
  if (!overlay) {
    overlay = document.createElement('div'); overlay.className = 'focus-overlay today-mode'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', 'خطة اليوم');
    document.body.appendChild(overlay);
    document.addEventListener('keydown', (e) => { if (isTodayOpen() && e.key === 'Escape') closeToday(); });
  }
  overlay.hidden = false; document.body.classList.add('modal-open');
  render();
  clearInterval(clock); clock = setInterval(tickClock, 15000);
  if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
}
export function closeToday() { if (!overlay) return; overlay.hidden = true; document.body.classList.remove('modal-open'); clearInterval(clock); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
export function isTodayOpen() { return !!overlay && !overlay.hidden; }
export function refreshToday() { if (isTodayOpen()) render(); }
