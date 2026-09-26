// الحالة الواحدة للتطبيق + الاشتراكات + الحسابات المشتقة (تقدّم، إحصائيات، سلاسل).
import { toMillis, daysFromToday, isoDate, PRIORITIES } from './utils.js';

export const state = {
  user: null,          // مستخدم Firebase أو مستخدم تجريبي
  profile: null,       // userProfiles/{uid}
  isAdmin: false,
  users: [],           // كل البروفايلات (للأدمن ولاختيار المكلّف)
  goals: [],
  tasks: [],
  activity: [],
  trash: { goals: [], tasks: [] },
  notifications: [],  // إشعارات السيرفر (notifications where to == me)
  presence: [],       // presence/{uid}
  taskTemplates: [],  // قوالب مهام مشتركة
  pending: 0,         // كتابات لم تُرفع بعد (أوفلاين)
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  loading: true,
  demo: false,
  view: 'dashboard',
  prefs: loadPrefs(),
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify(reason = 'change') { for (const fn of listeners) { try { fn(state, reason); } catch (e) { console.error(e); } } }

function loadPrefs() {
  const d = { theme: 'auto', notify: false, compact: false, density: 'normal', accent: 'blue', fontSize: 'normal', weekStart: 6, home: 'dashboard', focusMin: 25, breakMin: 5, calView: 'month', lang: 'ar', weeklyDigest: false, autoBackup: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem('goals.prefs') || '{}') }; } catch { return d; }
}
export function setPref(k, v) { state.prefs[k] = v; try { localStorage.setItem('goals.prefs', JSON.stringify(state.prefs)); } catch { /* ignore */ } notify('prefs'); }

// ---------- مشتقات ----------
let _tbg = null, _tbgRef = null;
/** فهرس المهام حسب المشروع (يُعاد بناؤه فقط عند تغيّر مصفوفة المهام) */
export function tasksByGoal() {
  if (_tbgRef !== state.tasks) {
    _tbgRef = state.tasks; _tbg = new Map();
    for (const t of state.tasks) { const a = _tbg.get(t.goalId); if (a) a.push(t); else _tbg.set(t.goalId, [t]); }
  }
  return _tbg;
}
export function goalTasks(goalId) { return tasksByGoal().get(goalId) || []; }

/** هل المهمة مكلّف بها المستخدم الحالي */
export function isMine(t) { const me = state.user && state.user.uid; return !!me && (t.assignedToUid === me || (t.assignedUserIds || []).includes(me)); }

export function favorites() { return (state.profile && state.profile.favorites) || []; }
export function isFavorite(goalId) { return favorites().includes(goalId); }

export function goalProgress(goal) {
  const ts = goalTasks(goal.id);
  if (!ts.length) return goal.progress || 0;
  return Math.round((ts.filter(t => t.completed).length / ts.length) * 100);
}

export function goalStatus(goal) {
  if (goal.archived) return 'archived';
  const p = goalProgress(goal);
  if (p === 100 && goalTasks(goal.id).length) return 'done';
  const n = daysFromToday(goal.endDate);
  if (n != null && n < 0) return 'late';
  return 'active';
}

export function visibleGoals() { return state.goals.filter(g => !g.archived); }

export function taskBucket(t) {
  if (t.completed) return 'done';
  const n = daysFromToday(t.dueDate);
  if (n == null) return 'noDate';
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  if (n <= 7) return 'week';
  return 'later';
}

export function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
    const ao = a.order ?? 1e9, bo = b.order ?? 1e9;
    if (ao !== bo) return ao - bo;
    const ad = a.dueDate || '9999', bd = b.dueDate || '9999';
    if (ad !== bd) return ad.localeCompare(bd);
    const ap = PRIORITIES[a.priority || 'medium'].order, bp = PRIORITIES[b.priority || 'medium'].order;
    if (ap !== bp) return ap - bp;
    return toMillis(b.createdAt) - toMillis(a.createdAt);
  });
}

export function stats() {
  const goals = visibleGoals();
  const tasks = state.tasks.filter(t => goals.some(g => g.id === t.goalId));
  const done = tasks.filter(t => t.completed);
  const overdue = tasks.filter(t => taskBucket(t) === 'overdue');
  const today = tasks.filter(t => taskBucket(t) === 'today');
  const completedGoals = goals.filter(g => goalStatus(g) === 'done');
  return {
    goals: goals.length, completedGoals: completedGoals.length,
    tasks: tasks.length, done: done.length, overdue: overdue.length, today: today.length,
    rate: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0,
    streak: streak(done),
    doneThisWeek: done.filter(t => { const d = daysFromToday(isoDate(new Date(toMillis(t.completedAt || t.updatedAt)))); return d != null && d > -7; }).length,
  };
}

/** أيام متتالية (حتى اليوم أو أمس) أُنجزت فيها مهمة */
export function streak(done) {
  const days = new Set(done.map(t => isoDate(new Date(toMillis(t.completedAt || t.updatedAt)))).filter(d => d !== '1970-01-01'));
  let n = 0;
  const cur = new Date(); cur.setHours(0, 0, 0, 0);
  if (!days.has(isoDate(cur))) cur.setDate(cur.getDate() - 1);
  while (days.has(isoDate(cur))) { n++; cur.setDate(cur.getDate() - 1); }
  return n;
}

export function userLabel(uid) {
  if (!uid) return '';
  if (state.user && uid === state.user.uid) return 'أنا';
  const u = state.users.find(x => x.uid === uid);
  return u ? (u.displayName || u.email || uid) : uid.slice(0, 6);
}

export function canEditGoal(goal) {
  if (state.isAdmin) return true;
  return !!(state.user && goal.createdBy === state.user.uid);
}

export function canEditTask(task) {
  if (state.isAdmin) return true;
  if (!state.user) return false;
  const g = state.goals.find(x => x.id === task.goalId);
  return task.createdBy === state.user.uid || task.assignedToUid === state.user.uid || (g && g.createdBy === state.user.uid);
}
