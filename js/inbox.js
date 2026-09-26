// مركز الإشعارات: يُحسب محلياً من بياناتك (متأخر، اليوم، تكليفات جديدة، أنشطة، مواعيد مشاريع ومعالم).
import { state, taskBucket, isMine, userLabel, goalStatus } from './store.js';
import { esc, relativeDue, daysFromToday, toMillis } from './utils.js';
import { myActivities, activityState } from './model.js';
import { openTask } from './task-panel.js';
import { serverItems, onServerNotifications, markRead, markAllRead, enablePush, pushEnabled } from './notify.js';
document.addEventListener('goals:notifications', (e) => onServerNotifications(e.detail || []));

const $ = (id) => document.getElementById(id);
const KEY = 'goals.inboxRead';
const TYPES = { late: ['⚠️', 'متأخرة', 0], today: ['📅', 'مستحقة اليوم', 1], activity: ['⏰', 'نشاط مستحق', 2], assigned: ['👤', 'تكليف جديد', 3], milestone: ['🚩', 'معلم قريب', 4], goal: ['🏁', 'موعد مشروع', 5] };
let open = false;

function readSet() { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } }
function saveRead(set) { try { localStorage.setItem(KEY, JSON.stringify([...set].slice(-400))); } catch { /* ignore */ } }

export function inboxItems() {
  if (!state.user) return [];
  const me = state.user.uid;
  const goals = state.goals.filter(g => !g.archived && !g.template);
  const gid = new Set(goals.map(g => g.id));
  const items = [];
  for (const t of state.tasks) {
    if (t.completed || !gid.has(t.goalId) || !isMine(t)) continue;
    const b = taskBucket(t);
    if (b === 'overdue') items.push({ key: `late:${t.id}:${t.dueDate}`, type: 'late', title: t.name, sub: relativeDue(t.dueDate), taskId: t.id });
    else if (b === 'today') items.push({ key: `today:${t.id}:${t.dueDate}`, type: 'today', title: t.name, sub: 'مستحقة اليوم', taskId: t.id });
    if (t.createdBy && t.createdBy !== me && Date.now() - toMillis(t.createdAt) < 7 * 86400000) items.push({ key: `assigned:${t.id}`, type: 'assigned', title: t.name, sub: `كلّفك ${userLabel(t.createdBy) || t.createdByEmail || ''}`, taskId: t.id });
  }
  for (const a of myActivities(state.tasks, me)) if (activityState(a) !== 'planned' && gid.has(a.task.goalId)) items.push({ key: `act:${a.id}:${a.due}`, type: 'activity', title: a.summary || a.task.name, sub: `${a.task.name} · ${relativeDue(a.due)}`, taskId: a.task.id, tab: 'activities' });
  for (const g of goals) {
    const n = daysFromToday(g.endDate);
    if (n != null && n <= 3 && n >= -14 && goalStatus(g) !== 'done') items.push({ key: `goal:${g.id}:${g.endDate}`, type: 'goal', title: g.name, sub: n < 0 ? `تجاوز الموعد بـ ${-n} يوم` : n === 0 ? 'ينتهي اليوم' : `ينتهي خلال ${n} يوم`, projectId: g.id });
    for (const m of g.milestones || []) { const k = daysFromToday(m.date); if (!m.done && k != null && k <= 3 && k >= -14) items.push({ key: `ms:${m.id}:${m.date}`, type: 'milestone', title: m.name, sub: `${g.name} · ${relativeDue(m.date)}`, projectId: g.id, tab: 'milestones' }); }
  }
  const read = readSet();
  items.forEach(i => { i.read = read.has(i.key); });
  const srv = serverItems();
  return [...srv, ...items].sort((a, b) => (a.read - b.read) || ((a.serverId ? -1 : TYPES[a.type][2]) - (b.serverId ? -1 : TYPES[b.type][2])) || ((b.at || 0) - (a.at || 0)));
}
function ico(i) { return i.serverId ? i.icon : TYPES[i.type][0]; }
function label(i) { return i.serverId ? i.label : TYPES[i.type][1]; }

export function unreadCount() { return inboxItems().filter(i => !i.read).length; }

export function refreshInboxBadge() {
  const b = $('inboxBadge'); if (!b) return;
  const n = unreadCount();
  b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
  if (open) renderPanel();
}

function renderPanel() {
  const p = $('inboxPanel'); if (!p) return;
  const items = inboxItems();
  const unread = items.filter(i => !i.read).length;
  p.innerHTML = `<div class="inbox-head"><strong>الإشعارات</strong><span class="hint">${unread ? `${unread} غير مقروء` : 'كل شيء مقروء'}</span>${!pushEnabled() ? '<button class="linkbtn" id="inboxPush" title="إشعارات المتصفح">🔔 تفعيل</button>' : ''}${items.length ? `<button class="linkbtn" id="inboxReadAll">تعليم الكل كمقروء</button>` : ''}</div>
    <div class="inbox-list">${items.length ? items.slice(0, 50).map(i => `<button class="inbox-item ${i.read ? 'read' : ''}" data-key="${esc(i.key)}"><span class="inbox-ico">${ico(i)}</span><span class="inbox-main"><span class="inbox-title">${esc(i.title)}</span><span class="hint">${label(i)} · ${esc(i.sub)}</span></span>${i.read ? '' : '<i class="dot"></i>'}</button>`).join('') : '<p class="muted" style="padding:1rem;text-align:center">لا إشعارات الآن 🎉</p>'}</div>`;
  const all = $('inboxReadAll'); if (all) all.onclick = () => { const s = readSet(); items.forEach(i => { if (!i.serverId) s.add(i.key); }); saveRead(s); markAllRead(); refreshInboxBadge(); };
  const pb = $('inboxPush'); if (pb) pb.onclick = async () => { if (await enablePush()) renderPanel(); };
  p.querySelectorAll('[data-key]').forEach(b => {
    b.onclick = () => {
      const it = items.find(x => x.key === b.dataset.key); if (!it) return;
      if (it.serverId) markRead(it.serverId); else { const s = readSet(); s.add(it.key); saveRead(s); }
      closeInbox();
      if (it.taskId) openTask(it.taskId, it.tab); else if (it.projectId) location.hash = `project/${it.projectId}/${it.tab || 'overview'}`;
      refreshInboxBadge();
    };
  });
}

export function openInbox() { open = true; $('inboxPanel').hidden = false; $('inboxBtn').classList.add('on'); renderPanel(); }
export function closeInbox() { open = false; const p = $('inboxPanel'); if (p) p.hidden = true; $('inboxBtn').classList.remove('on'); }
export function toggleInbox() { open ? closeInbox() : openInbox(); }

export function initInbox() {
  $('inboxBtn').onclick = (e) => { e.stopPropagation(); toggleInbox(); };
  document.addEventListener('click', (e) => { if (open && !e.target.closest('#inboxPanel') && !e.target.closest('#inboxBtn')) closeInbox(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) closeInbox(); });
}
