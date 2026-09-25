// نموذج المشاريع على طريقة Odoo: مراحل، مراحل شخصية، تكرار، تبعيات، جانت، معالم.
import { uid, isoDate, addDays, daysFromToday } from './utils.js';

export const DEFAULT_STAGES = [
  { id: 'new', name: 'جديد', color: '#64748b', fold: false, done: false },
  { id: 'progress', name: 'قيد التنفيذ', color: '#2563eb', fold: false, done: false },
  { id: 'review', name: 'مراجعة', color: '#d97706', fold: false, done: false },
  { id: 'done', name: 'منجز', color: '#16a34a', fold: true, done: true },
];
export const DEFAULT_PERSONAL_STAGES = [
  { id: 'inbox', name: 'وارد', color: '#64748b' },
  { id: 'today', name: 'اليوم', color: '#d97706' },
  { id: 'week', name: 'هذا الأسبوع', color: '#2563eb' },
  { id: 'later', name: 'لاحقاً', color: '#7c3aed' },
  { id: 'pdone', name: 'منجز', color: '#16a34a', done: true },
];
export const ACTIVITY_TYPES = { todo: ['مهمة', '✅'], call: ['اتصال', '📞'], meeting: ['اجتماع', '📅'], email: ['بريد', '✉️'], reminder: ['تذكير', '⏰'] };
export const TAG_COLORS = ['#2563eb', '#0891b2', '#16a34a', '#84cc16', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#475569'];
export const RECURRENCE = { daily: 'يومياً', weekly: 'أسبوعياً', biweekly: 'كل أسبوعين', monthly: 'شهرياً' };

export function newStage(name, extra = {}) { return { id: uid(), name, color: '#2563eb', fold: false, done: false, ...extra }; }

/** مراحل المشروع (الأهداف القديمة بدون مراحل تستخدم الافتراضية) */
export function projectStages(project) {
  return project && Array.isArray(project.stages) && project.stages.length ? project.stages : DEFAULT_STAGES;
}
export function doneStage(stages) { return stages.find(s => s.done) || stages[stages.length - 1]; }
export function firstOpenStage(stages) { return stages.find(s => !s.done) || stages[0]; }

/** مرحلة المهمة مع تراجع منطقي للمهام القديمة */
export function taskStage(task, project) {
  const stages = projectStages(project);
  const byId = task.stageId && stages.find(s => s.id === task.stageId);
  if (byId) return byId;
  return task.completed ? doneStage(stages) : firstOpenStage(stages);
}

/** الحقول اللازمة عند نقل مهمة لمرحلة (تزامن completed) */
export function stagePatch(stage) {
  return stage.done ? { stageId: stage.id, completed: true } : { stageId: stage.id, completed: false, completedAt: null };
}

/** الحقول عند تغيير الإنجاز من الـ checkbox (تزامن المرحلة) */
export function completionPatch(project, completed) {
  const stages = projectStages(project);
  return completed ? { completed: true, stageId: doneStage(stages).id } : { completed: false, completedAt: null, stageId: firstOpenStage(stages).id };
}

export function subtasksOf(tasks, parentId) { return tasks.filter(t => t.parentId === parentId); }
export function subtaskProgress(tasks, parentId) {
  const subs = subtasksOf(tasks, parentId);
  if (!subs.length) return null;
  return { total: subs.length, done: subs.filter(s => s.completed).length };
}

/** هل المهمة محجوبة بمهام غير منجزة؟ */
export function blockers(task, tasks) {
  return (task.blockedBy || []).map(id => tasks.find(t => t.id === id)).filter(t => t && !t.completed);
}

/** تاريخ التكرار التالي */
export function nextOccurrence(rec, fromIso) {
  if (!rec || !rec.freq) return null;
  const base = fromIso ? new Date(fromIso + 'T00:00:00') : new Date();
  const d = new Date(base);
  const n = Math.max(1, Number(rec.interval) || 1);
  if (rec.freq === 'daily') d.setDate(d.getDate() + n);
  else if (rec.freq === 'weekly') d.setDate(d.getDate() + 7 * n);
  else if (rec.freq === 'biweekly') d.setDate(d.getDate() + 14 * n);
  else if (rec.freq === 'monthly') d.setMonth(d.getMonth() + n);
  const iso = isoDate(d);
  if (rec.until && iso > rec.until) return null;
  return iso;
}

export function hoursSpent(task) { return (task.timesheets || []).reduce((a, x) => a + (Number(x.hours) || 0), 0); }

export function checklistProgress(task) {
  const c = task.checklist || [];
  return c.length ? { total: c.length, done: c.filter(x => x.done).length } : null;
}

/** تجميع أنشطة المهام المفتوحة للمستخدم مرتبة بالاستحقاق */
export function myActivities(tasks, uidMe) {
  const out = [];
  for (const t of tasks) for (const a of t.activities || []) if (!a.done && (!a.uid || a.uid === uidMe || !uidMe)) out.push({ ...a, task: t });
  return out.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
}
export function activityState(a) { const n = daysFromToday(a.due); if (n == null) return 'planned'; return n < 0 ? 'overdue' : n === 0 ? 'today' : 'planned'; }

/** نطاق جانت: من أقدم بداية لأبعد نهاية مع هامش */
export function ganttRange(tasks, project) {
  let min = null, max = null;
  const push = (iso) => { if (!iso) return; if (!min || iso < min) min = iso; if (!max || iso > max) max = iso; };
  for (const t of tasks) { push(t.startDate || t.dueDate); push(t.dueDate || t.startDate); }
  if (project) { push(project.startDate); push(project.endDate); }
  const today = isoDate();
  push(today);
  if (!min) min = today;
  if (!max) max = isoDate(addDays(today, 30));
  return { start: isoDate(addDays(min, -3)), end: isoDate(addDays(max, 7)) };
}
export function dayIndex(iso, startIso) { return Math.round((new Date(iso + 'T00:00:00') - new Date(startIso + 'T00:00:00')) / 86400000); }

/** إحصائيات مشروع على طريقة Odoo */
export function projectStats(project, tasks) {
  const ts = tasks.filter(t => t.goalId === project.id && !t.parentId);
  const stages = projectStages(project);
  const byStage = stages.map(s => ({ stage: s, count: ts.filter(t => taskStage(t, project).id === s.id).length }));
  const done = ts.filter(t => t.completed).length;
  const late = ts.filter(t => !t.completed && t.dueDate && daysFromToday(t.dueDate) < 0).length;
  const planned = ts.reduce((a, t) => a + (Number(t.plannedHours) || 0), 0);
  const spent = ts.reduce((a, t) => a + hoursSpent(t), 0);
  const ms = project.milestones || [];
  return { total: ts.length, done, open: ts.length - done, late, byStage, planned, spent, milestones: ms.length, milestonesDone: ms.filter(m => m.done).length, pct: ts.length ? Math.round((done / ts.length) * 100) : 0 };
}

/** بيانات burndown: المهام المفتوحة المتبقية يومياً خلال آخر N يوم */
export function burndown(project, tasks, days = 30) {
  const ts = tasks.filter(t => t.goalId === project.id && !t.parentId);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(new Date(), -i); day.setHours(23, 59, 59, 999);
    const created = ts.filter(t => toMs(t.createdAt) <= day.getTime());
    const remaining = created.filter(t => !(t.completed && toMs(t.completedAt || t.updatedAt) <= day.getTime())).length;
    out.push({ date: isoDate(day), remaining, total: created.length });
  }
  return out;
}
function toMs(v) { if (!v) return 0; if (typeof v === 'number') return v; if (v.toMillis) return v.toMillis(); if (v.seconds) return v.seconds * 1000; return new Date(v).getTime() || 0; }

/** نسخ مشروع كقالب: مراحل، تاجز، معالم، ومهام (بدون إنجاز) */
export function cloneFromTemplate(tpl, tasks, overrides) {
  const stages = projectStages(tpl).map(s => ({ ...s }));
  const goal = { name: overrides.name || tpl.name, startDate: overrides.startDate, endDate: overrides.endDate, note: tpl.note || '', category: tpl.category || '', priority: tpl.priority || 'medium', color: tpl.color, stages, tags: (tpl.tags || []).map(t => ({ ...t })), milestones: (tpl.milestones || []).map(m => ({ ...m, id: uid(), done: false })), template: false, visibility: 'private', visibilityMode: 'private' };
  const shift = overrides.startDate && tpl.startDate ? dayIndex(overrides.startDate, tpl.startDate) : 0;
  const tplTasks = tasks.filter(t => t.goalId === tpl.id);
  const idMap = new Map(tplTasks.map(t => [t.id, uid()]));
  const newTasks = tplTasks.map(t => ({
    id: idMap.get(t.id), name: t.name, priority: t.priority || 'medium', notes: t.notes || '', tags: t.tags || [], plannedHours: t.plannedHours || 0,
    checklist: (t.checklist || []).map(c => ({ ...c, id: uid(), done: false })), stageId: firstOpenStage(stages).id, completed: false, completedAt: null,
    parentId: t.parentId ? idMap.get(t.parentId) || null : null, blockedBy: (t.blockedBy || []).map(b => idMap.get(b)).filter(Boolean),
    dueDate: t.dueDate ? isoDate(addDays(t.dueDate, shift)) : null, startDate: t.startDate ? isoDate(addDays(t.startDate, shift)) : null, order: t.order || 0,
  }));
  return { goal, tasks: newTasks };
}
