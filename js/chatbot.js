// مساعد التخطيط: قواعد + بيانات المستخدم الفعلية (مهام اليوم، المتأخرة، التقدم…).
import { state, stats, goalProgress, goalStatus, visibleGoals, taskBucket, sortTasks, userLabel } from './store.js';
import { relativeDue } from './utils.js';
import { openGoalModal, openTaskModal } from './views.js';

const $ = (id) => document.getElementById(id);
const QUICK = ['إيه مهامي اليوم؟', 'المتأخر إيه؟', 'إحصائياتي', 'أقرب هدف ينتهي', 'أضف مهمة', 'مساعدة'];

function fmtTasks(list, max = 6) {
  return list.slice(0, max).map(t => `• ${t.name}${t.dueDate ? ` (${relativeDue(t.dueDate)})` : ''}${t.assignedToUid && t.assignedToUid !== state.user.uid ? ` — ${userLabel(t.assignedToUid)}` : ''}`).join('\n') + (list.length > max ? `\n… و${list.length - max} أخرى` : '');
}

function reply(text) {
  const q = text.toLowerCase();
  const goals = visibleGoals();
  const open = state.tasks.filter(t => !t.completed && goals.some(g => g.id === t.goalId));
  const s = stats();
  if (/(اليوم|النهارده|today)/.test(q)) {
    const today = sortTasks(open.filter(t => taskBucket(t) === 'today'));
    const late = open.filter(t => taskBucket(t) === 'overdue');
    if (!today.length && !late.length) return { text: 'يومك خالٍ من المهام العاجلة ✅' + (open.length ? ` عندك ${open.length} مهمة مفتوحة إجمالاً.` : ''), actions: ['المتأخر إيه؟', 'أضف مهمة'] };
    return { text: (today.length ? `مهام اليوم (${today.length}):\n${fmtTasks(today)}` : 'مفيش مهام مستحقة اليوم.') + (late.length ? `\n\n⚠️ وعندك ${late.length} مهمة متأخرة.` : ''), actions: ['المتأخر إيه؟', 'إحصائياتي'] };
  }
  if (/(متأخر|فايت|overdue|late)/.test(q)) {
    const late = sortTasks(open.filter(t => taskBucket(t) === 'overdue'));
    if (!late.length) return { text: 'مفيش مهام متأخرة، ممتاز 👏', actions: ['إيه مهامي اليوم؟', 'إحصائياتي'] };
    return { text: `المهام المتأخرة (${late.length}):\n${fmtTasks(late)}\n\nنصيحة: ابدأ بأقدمها أو أعد جدولتها بتاريخ واقعي.`, actions: ['إيه مهامي اليوم؟', 'أقرب هدف ينتهي'] };
  }
  if (/(الأسبوع|الاسبوع|week|قادم|القادمة|الجاي)/.test(q)) {
    const wk = sortTasks(open.filter(t => ['today', 'week'].includes(taskBucket(t))));
    return { text: wk.length ? `مهام هذا الأسبوع (${wk.length}):\n${fmtTasks(wk, 8)}` : 'مفيش مهام مستحقة خلال الأسبوع.', actions: ['إيه مهامي اليوم؟', 'أضف مهمة'] };
  }
  if (/(إحصائ|احصائ|تقدم|نسبة|stats|progress)/.test(q)) {
    return { text: `إحصائياتك:\n• المهام: ${s.done}/${s.tasks} منجزة (${s.rate}%)\n• الأهداف المكتملة: ${s.completedGoals}/${s.goals}\n• متأخرة: ${s.overdue} · اليوم: ${s.today}\n• أُنجزت هذا الأسبوع: ${s.doneThisWeek}\n• سلسلة الإنجاز: ${s.streak} يوم 🔥`, actions: ['أقرب هدف ينتهي', 'المتأخر إيه؟'] };
  }
  if (/(هدف|أهداف|اهداف|goal)/.test(q) && /(قريب|ينتهي|أقرب|اقرب|موعد|deadline)/.test(q)) {
    const near = goals.filter(g => goalStatus(g) !== 'done' && g.endDate).sort((a, b) => a.endDate.localeCompare(b.endDate))[0];
    if (!near) return { text: 'مفيش أهداف مفتوحة بموعد نهائي.', actions: ['إحصائياتي'] };
    return { text: `أقرب هدف: «${near.name}» — ${relativeDue(near.endDate)}، الإنجاز ${goalProgress(near)}% وباقي ${state.tasks.filter(t => t.goalId === near.id && !t.completed).length} مهمة.`, actions: ['إيه مهامي اليوم؟', 'إحصائياتي'] };
  }
  if (/(أضف|اضف|ضيف|إضافة|اضافة|add|جديد)/.test(q)) {
    if (/(هدف|goal)/.test(q)) { openGoalModal(); return { text: 'فتحت لك نافذة هدف جديد 🎯', actions: [] }; }
    openTaskModal(); return { text: 'فتحت لك نافذة مهمة جديدة ✍️', actions: [] };
  }
  if (/(مساعدة|help|إزاي|ازاي|كيف)/.test(q)) {
    return { text: 'أقدر أساعدك في:\n• «إيه مهامي اليوم؟» / «المتأخر إيه؟» / «مهام الأسبوع»\n• «إحصائياتي» و«أقرب هدف ينتهي»\n• «أضف مهمة» أو «أضف هدف» — بفتح النافذة مباشرة\n\nنصائح: استخدم الإضافة السريعة في صفحة المهام واكتب «غداً» أو «!عالي» في النص وهفهمها تلقائياً.', actions: QUICK.slice(0, 4) };
  }
  if (/(شكر|thanks|تمام|ممتاز)/.test(q)) return { text: 'بالتوفيق! 💪', actions: ['إيه مهامي اليوم؟'] };
  return { text: 'مش متأكد إني فهمت. جرّب أحد الأزرار أو اكتب «مساعدة».', actions: QUICK.slice(0, 4) };
}

export function initChatbot() {
  const win = $('chatWin'), msgs = $('chatMsgs'), input = $('chatInput');
  const add = (text, who, actions) => {
    const el = document.createElement('div'); el.className = `msg ${who}`; el.textContent = text;
    if (actions && actions.length) { const q = document.createElement('div'); q.className = 'quick'; actions.forEach(a => { const b = document.createElement('button'); b.textContent = a; b.onclick = () => ask(a); q.appendChild(b); }); el.appendChild(q); }
    msgs.appendChild(el); msgs.scrollTop = 1e9;
  };
  const ask = (text) => {
    text = (text || '').trim(); if (!text) return;
    add(text, 'user'); input.value = '';
    const typing = document.createElement('div'); typing.className = 'msg bot'; typing.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>'; msgs.appendChild(typing); msgs.scrollTop = 1e9;
    setTimeout(() => { typing.remove(); const r = reply(text); add(r.text, 'bot', r.actions); }, 400);
  };
  $('chatFab').onclick = () => { win.hidden = !win.hidden; if (!win.hidden) { if (!msgs.children.length) add('أهلاً! أنا مساعد التخطيط. اسألني عن مهام اليوم، المتأخر، أو إحصائياتك.', 'bot', QUICK); input.focus(); } };
  $('chatClose').onclick = () => { win.hidden = true; };
  $('chatForm').onsubmit = (e) => { e.preventDefault(); ask(input.value); };
}
