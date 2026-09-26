// نسخ احتياطي واستيراد JSON، تصدير مشروع، نسخ مشروع، وتصدير المهام إلى تقويم (.ics).
import { state, goalTasks } from './store.js';
import { api } from './data.js';
import { isoDate, addDays, uid, toMillis } from './utils.js';
import { toast, confirmDialog } from './ui.js';
import { cloneFromTemplate } from './model.js';

function download(name, content, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function plain(x) { return JSON.parse(JSON.stringify(x, (k, v) => (v && typeof v === 'object' && (v.seconds != null || v.toMillis)) ? toMillis(v) : v)); }

export function exportJSON() {
  const p = state.profile || {};
  download(`goals-backup-${isoDate()}.json`, JSON.stringify({ app: 'goals', version: 4, exportedAt: new Date().toISOString(), goals: plain(state.goals), tasks: plain(state.tasks), profile: { displayName: p.displayName || '', savedFilters: p.savedFilters || [], personalStages: p.personalStages || null, favorites: p.favorites || [] }, prefs: state.prefs }, null, 2));
}

export function exportProject(g) {
  download(`project-${g.name.replace(/[^\w\u0600-\u06FF-]+/g, '_')}-${isoDate()}.json`, JSON.stringify({ app: 'goals', version: 4, exportedAt: new Date().toISOString(), goals: plain([g]), tasks: plain(goalTasks(g.id)) }, null, 2));
}

const STRIP_GOAL = ['id', 'createdAt', 'updatedAt', 'createdBy', 'createdByEmail', 'progress', 'deleted', 'deletedAt', 'deletedBy'];
const STRIP_TASK = ['createdAt', 'updatedAt', 'createdBy', 'createdByEmail', 'assignedToEmail', 'deleted', 'deletedAt', 'deletedBy', 'deletedWithGoal', '_messages'];

/** يستورد المشاريع والمهام كعناصر جديدة مع الحفاظ على الروابط (فرعية، تبعيات، مراحل) */
export async function importJSON(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('الملف ليس JSON صالحاً', { type: 'err' }); return; }
  const goals = Array.isArray(data.goals) ? data.goals : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  if (!goals.length) { toast('لا توجد مشاريع في الملف', { type: 'err' }); return; }
  if (!(await confirmDialog(`استيراد ${goals.length} مشروع و${tasks.length} مهمة كعناصر جديدة؟`, { danger: false, okLabel: 'استيراد' }))) return;
  const me = state.user.uid;
  const gmap = new Map(), tmap = new Map();
  let nGoals = 0, nTasks = 0;
  try {
    for (const g of goals) {
      const doc = { ...g }; STRIP_GOAL.forEach(k => delete doc[k]);
      doc.name = doc.name || 'مشروع مستورد'; doc.startDate = doc.startDate || isoDate(); doc.endDate = doc.endDate || isoDate(addDays(new Date(), 30));
      doc.assignedUserIds = [...new Set([me, ...(doc.assignedUserIds || []).filter(u => state.users.some(x => x.uid === u))])];
      doc.blockedUserIds = []; doc.manager = me; doc.template = !!doc.template; doc.archived = !!doc.archived;
      const id = await api.createGoal(doc); gmap.set(g.id, id); nGoals++;
    }
    const valid = tasks.filter(t => gmap.has(t.goalId));
    valid.forEach(t => tmap.set(t.id, uid()));
    const list = valid.map(t => {
      const d = { ...t }; STRIP_TASK.forEach(k => delete d[k]);
      d.id = tmap.get(t.id); d.goalId = gmap.get(t.goalId); d.name = d.name || 'مهمة';
      d.parentId = t.parentId && tmap.has(t.parentId) ? tmap.get(t.parentId) : null;
      d.blockedBy = (t.blockedBy || []).map(b => tmap.get(b)).filter(Boolean);
      d.assignedToUid = t.assignedToUid && state.users.some(u => u.uid === t.assignedToUid) ? t.assignedToUid : me;
      d.assignedUserIds = (t.assignedUserIds || []).filter(u => state.users.some(x => x.uid === u)); if (!d.assignedUserIds.length) d.assignedUserIds = [d.assignedToUid];
      d.completed = !!t.completed; d.completedAt = t.completed ? (toMillis(t.completedAt) || Date.now()) : null;
      d.timesheets = (t.timesheets || []).map(x => ({ ...x, uid: state.users.some(u => u.uid === x.uid) ? x.uid : me }));
      d.activities = (t.activities || []).map(x => ({ ...x, uid: state.users.some(u => u.uid === x.uid) ? x.uid : me }));
      d.attachments = []; return d;
    });
    for (let i = 0; i < list.length; i += 400) { await api.createTasksBatch(list.slice(i, i + 400)); nTasks += Math.min(400, list.length - i); }
    toast(`تم استيراد ${nGoals} مشروع و${nTasks} مهمة`, { type: 'ok' });
  } catch (e) { console.error(e); toast(`توقف الاستيراد بعد ${nGoals} مشروع و${nTasks} مهمة`, { type: 'err' }); }
}

export async function duplicateProject(g) {
  const { goal, tasks } = cloneFromTemplate(g, state.tasks, { name: `${g.name} (نسخة)`, startDate: g.startDate, endDate: g.endDate });
  goal.template = false; goal.assignedUserIds = g.assignedUserIds || [state.user.uid]; goal.manager = state.user.uid; goal.visibility = g.visibility; goal.visibilityMode = g.visibilityMode;
  try {
    const id = await api.createGoal(goal);
    if (tasks.length) await api.createTasksBatch(tasks.map(t => ({ ...t, goalId: id, assignedToUid: state.user.uid, assignedUserIds: [state.user.uid] })));
    toast(`تم نسخ المشروع مع ${tasks.length} مهمة`, { type: 'ok' });
    location.hash = 'project/' + id;
  } catch (e) { console.error(e); toast('تعذّر النسخ', { type: 'err' }); }
}

/** تصدير المهام ذات المواعيد كأحداث يوم كامل (Google Calendar / Outlook / Apple) */
export function exportICS(tasks, name = 'goals') {
  const d8 = (iso) => iso.replace(/-/g, '');
  const escI = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//goals//سجل أهدافي//AR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:سجل أهدافي'];
  for (const t of tasks.filter(x => x.dueDate)) {
    const g = state.goals.find(x => x.id === t.goalId);
    lines.push('BEGIN:VEVENT', `UID:${t.id}@goals.app`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d8(t.dueDate)}`, `DTEND;VALUE=DATE:${d8(isoDate(addDays(t.dueDate, 1)))}`, `SUMMARY:${escI((t.completed ? '✓ ' : '') + t.name)}`, `DESCRIPTION:${escI((g ? g.name + '\n' : '') + (t.notes || ''))}`, `STATUS:${t.completed ? 'COMPLETED' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  download(`${name}-${isoDate()}.ics`, lines.join('\r\n'), 'text/calendar;charset=utf-8');
}

const AUTO_KEY = 'goals.autoBackupWeek';
function weekKey() { const d = new Date(); return `${d.getFullYear()}-${Math.ceil((((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + new Date(d.getFullYear(), 0, 1).getDay() + 1) / 7)}`; }
/** نسخة احتياطية تلقائية أسبوعية إلى Firebase Storage (backups/{uid}/{date}.json) */
export async function autoBackup(force = false) {
  if (!state.prefs.autoBackup || !state.user || !state.goals.length) return;
  try { if (!force && localStorage.getItem(AUTO_KEY) === weekKey()) return; } catch { return; }
  const p = state.profile || {};
  const json = JSON.stringify({ app: 'goals', version: 5, exportedAt: new Date().toISOString(), goals: plain(state.goals), tasks: plain(state.tasks), profile: { displayName: p.displayName || '', savedFilters: p.savedFilters || [], personalStages: p.personalStages || null, favorites: p.favorites || [] } });
  try { await api.uploadBackup(json, `backup-${isoDate()}.json`); localStorage.setItem(AUTO_KEY, weekKey()); toast('تم حفظ نسخة احتياطية تلقائية ☁️', { type: 'ok', ms: 2500 }); }
  catch (e) { if (force) toast(e.message === 'storage-unavailable' ? 'فعّل Firebase Storage أولاً' : 'تعذّر رفع النسخة', { type: 'err' }); }
}
