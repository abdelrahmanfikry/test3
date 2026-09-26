// حسابات خالصة (بدون DOM): عبء العمل، التكلفة، الجدول المحوري، إزاحة التبعيات في الجانت.
import { isoDate, addDays, daysFromToday } from './utils.js';

export const DEFAULT_CAPACITY = 40; // ساعات/أسبوع

function assignees(t) { return t.assignedUserIds && t.assignedUserIds.length ? t.assignedUserIds : (t.assignedToUid ? [t.assignedToUid] : []); }
function spent(t) { return (t.timesheets || []).reduce((a, x) => a + (Number(x.hours) || 0), 0); }

/**
 * عبء العمل لكل عضو خلال الأيام القادمة: الساعات المتبقية من المهام المستحقة في النافذة (المخطط − المسجّل، وافتراضياً ساعتان للمهمة بلا تقدير).
 * يعيد [{ uid, hours, tasks, late, capacity, ratio, level }] مرتّبة تنازلياً.
 */
export function workload(users, tasks, { days = 7, defaultHours = 2, today = isoDate() } = {}) {
  const until = isoDate(addDays(today, days));
  const rows = users.map(u => ({ uid: u.uid, name: u.displayName || u.email || u.uid, capacity: Number(u.weeklyCapacity) || DEFAULT_CAPACITY, hours: 0, tasks: 0, late: 0 }));
  const byUid = new Map(rows.map(r => [r.uid, r]));
  for (const t of tasks) {
    if (t.completed || t.parentId) continue;
    const due = t.dueDate; if (!due || due > until) continue;
    const remaining = Math.max(0, (Number(t.plannedHours) || defaultHours) - spent(t));
    const people = assignees(t); if (!people.length) continue;
    for (const uid of people) { const r = byUid.get(uid); if (!r) continue; r.tasks++; r.hours += remaining / people.length; if (due < today) r.late++; }
  }
  for (const r of rows) { r.hours = Math.round(r.hours * 10) / 10; r.ratio = r.capacity ? r.hours / (r.capacity * (days / 7)) : 0; r.level = r.ratio > 1 ? 'over' : r.ratio > 0.8 ? 'high' : r.ratio > 0 ? 'ok' : 'free'; }
  return rows.sort((a, b) => b.ratio - a.ratio);
}

/** اقتراحات إعادة التوزيع: من المثقلين إلى الأقل حملاً */
export function rebalanceSuggestions(rows) {
  const over = rows.filter(r => r.level === 'over');
  const free = rows.filter(r => r.level === 'free' || r.level === 'ok').sort((a, b) => a.ratio - b.ratio);
  return over.map(o => ({ from: o, to: free[0] || null, excess: Math.round((o.hours - o.capacity) * 10) / 10 }));
}

/** تكلفة المشروع من الساعات المسجّلة × سعر ساعة العضو (أو سعر افتراضي) */
export function projectCost(project, tasks, users, { defaultRate = 0 } = {}) {
  const rate = new Map(users.map(u => [u.uid, Number(u.hourlyRate) || defaultRate]));
  let cost = 0, hours = 0; const byUser = new Map();
  for (const t of tasks) {
    if (t.goalId !== project.id) continue;
    for (const s of t.timesheets || []) { const h = Number(s.hours) || 0; const r = rate.get(s.uid) ?? defaultRate; hours += h; cost += h * r; byUser.set(s.uid, (byUser.get(s.uid) || 0) + h * r); }
  }
  const budget = Number(project.budget) || 0;
  return { hours: Math.round(hours * 10) / 10, cost: Math.round(cost), budget, pct: budget ? Math.round((cost / budget) * 100) : null, over: budget ? cost > budget : false, byUser: [...byUser.entries()].map(([uid, c]) => ({ uid, cost: Math.round(c) })).sort((a, b) => b.cost - a.cost) };
}

/** جدول محوري: مشروع × عضو، القياس: tasks | open | done | late | hours */
export function pivot(goals, users, tasks, measure = 'open') {
  const val = (list) => {
    if (measure === 'tasks') return list.length;
    if (measure === 'open') return list.filter(t => !t.completed).length;
    if (measure === 'done') return list.filter(t => t.completed).length;
    if (measure === 'late') return list.filter(t => !t.completed && t.dueDate && daysFromToday(t.dueDate) < 0).length;
    if (measure === 'hours') return Math.round(list.reduce((a, t) => a + spent(t), 0) * 10) / 10;
    return list.length;
  };
  const cols = users.map(u => u.uid);
  const rows = goals.map(g => { const gt = tasks.filter(t => t.goalId === g.id && !t.parentId); const cells = cols.map(uid => val(gt.filter(t => assignees(t).includes(uid)))); return { goal: g, cells, total: val(gt) }; }).filter(r => r.total);
  const totals = cols.map((_, i) => rows.reduce((a, r) => a + r.cells[i], 0));
  return { cols: users, rows, totals, grand: rows.reduce((a, r) => a + r.total, 0) };
}

/**
 * عند تغيير تواريخ مهمة: المهام التي تعتمد عليها (blockedBy) ويبدأ تنفيذها قبل نهايتها الجديدة تُزاح للأمام بنفس الفارق.
 * يعيد قائمة { id, startDate, dueDate } للمهام المتأثرة (بشكل متسلسل).
 */
export function shiftDependents(tasks, changedId, newDates) {
  const byId = new Map(tasks.map(t => [t.id, { ...t }]));
  const cur = byId.get(changedId); if (!cur) return [];
  Object.assign(cur, newDates);
  const out = [], seen = new Set([changedId]);
  const queue = [changedId];
  while (queue.length) {
    const pid = queue.shift(); const p = byId.get(pid);
    const pEnd = p.dueDate || p.startDate; if (!pEnd) continue;
    for (const t of byId.values()) {
      if (seen.has(t.id) || t.completed || !(t.blockedBy || []).includes(pid)) continue;
      const tStart = t.startDate || t.dueDate; if (!tStart) continue;
      if (tStart > pEnd) continue;
      const delta = Math.round((new Date(pEnd + 'T00:00:00') - new Date(tStart + 'T00:00:00')) / 86400000) + 1;
      const patch = { id: t.id };
      if (t.startDate) patch.startDate = isoDate(addDays(t.startDate, delta));
      if (t.dueDate) patch.dueDate = isoDate(addDays(t.dueDate, delta));
      if (!t.startDate && !t.dueDate) continue;
      Object.assign(t, patch); out.push(patch); seen.add(t.id); queue.push(t.id);
    }
  }
  return out;
}

/** خطوط الاعتماديات في الجانت: من نهاية الحاجب إلى بداية المحجوب */
export function dependencyLinks(tasks) {
  const ids = new Set(tasks.map(t => t.id));
  const out = [];
  for (const t of tasks) for (const b of t.blockedBy || []) if (ids.has(b)) out.push({ from: b, to: t.id });
  return out;
}
