// المساعد الذكي: يتصل بـ Claude API مباشرة من المتصفح بمفتاح يحفظه المستخدم على جهازه فقط (لا يُرسل إلى Firestore).
// يجيب عن أسئلة حول بياناتك، ويُنشئ مهام/مشاريع من نص حر أو صورة بعد تأكيدك.
import { state, taskBucket, sortTasks, goalProgress } from './store.js';
import { api } from './data.js';
import { isoDate, addDays, uid } from './utils.js';
import { toast, confirmDialog } from './ui.js';
import { DEFAULT_STAGES, projectStages, firstOpenStage } from './model.js';

const KEY = 'goals.aiKey';
export const AI_MODEL = 'claude-sonnet-5';
export function aiKey() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
export function setAiKey(k) { try { if (k) localStorage.setItem(KEY, k.trim()); else localStorage.removeItem(KEY); } catch { /* ignore */ } }
export function hasAI() { return !!aiKey(); }

/** ملخص مضغوط لبيانات المستخدم يُرسل مع كل سؤال */
export function dataContext() {
  const me = state.user.uid;
  const goals = state.goals.filter(g => !g.archived && !g.template);
  const gmap = new Map(goals.map(g => [g.id, g]));
  const open = sortTasks(state.tasks.filter(t => !t.completed && gmap.has(t.goalId))).slice(0, 120);
  const users = state.users.map(u => ({ id: u.uid, name: u.displayName || u.email }));
  return JSON.stringify({
    today: isoDate(), me: { id: me, name: (state.profile && state.profile.displayName) || state.user.email },
    users,
    projects: goals.map(g => ({ id: g.id, name: g.name, start: g.startDate, end: g.endDate, progress: goalProgress(g), stages: projectStages(g).map(s => s.name), tags: (g.tags || []).map(t => t.name) })),
    openTasks: open.map(t => ({ id: t.id, name: t.name, project: gmap.get(t.goalId).name, due: t.dueDate, priority: t.priority || 'medium', assignee: (users.find(u => u.id === t.assignedToUid) || {}).name || null, bucket: taskBucket(t), planned: t.plannedHours || 0 })),
    doneLast7: state.tasks.filter(t => t.completed && gmap.has(t.goalId) && (typeof t.completedAt === 'number' ? t.completedAt : (t.completedAt && t.completedAt.seconds || 0) * 1000) > Date.now() - 7 * 86400000).length,
  });
}

const SYSTEM = `أنت مساعد تخطيط داخل تطبيق «سجل أهدافي» لإدارة المشاريع والمهام. تجيب بالعربية (بلهجة مصرية خفيفة مقبولة) باختصار ووضوح، وتستند فقط إلى البيانات المرفقة. التواريخ بصيغة YYYY-MM-DD.
عندما يطلب المستخدم إنشاء مهام أو مشروع أو خطة، اكتب ردّك ثم أضف في النهاية كتلة JSON واحدة فقط بهذا الشكل بالضبط:
\`\`\`json
{"actions":[{"type":"create_task","name":"...","project":"اسم مشروع موجود","dueDate":"YYYY-MM-DD","priority":"high|medium|low","notes":"","plannedHours":0},{"type":"create_project","name":"...","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","note":"","tasks":[{"name":"...","dueDate":"YYYY-MM-DD","priority":"medium","plannedHours":0}]}]}
\`\`\`
لا تكتب كتلة JSON إذا لم يكن هناك إجراء. لا تخترع مشاريع غير موجودة إلا داخل create_project.`;

export async function askClaude({ system = SYSTEM, messages, maxTokens = 1500 }) {
  const key = aiKey(); if (!key) throw new Error('no-key');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`api ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json();
  return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}

/** يفصل النص عن كتلة الإجراءات */
export function parseActions(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  if (!m) return { text: text.trim(), actions: [] };
  let actions = [];
  try { const j = JSON.parse(m[1]); actions = Array.isArray(j.actions) ? j.actions : []; } catch { /* ignore */ }
  return { text: text.replace(m[0], '').trim(), actions };
}

/** محادثة: history = [{role:'user'|'assistant', content}] */
export async function chatAI(history) {
  const messages = [{ role: 'user', content: `بيانات المستخدم الحالية (JSON):\n${dataContext()}` }, { role: 'assistant', content: 'تمام، اطّلعت على البيانات. اسألني.' }, ...history.slice(-8)];
  const raw = await askClaude({ messages });
  return parseActions(raw);
}

/** استخراج مهام من صورة (لوح أبيض، ورقة، لقطة شاشة) */
export async function tasksFromImage(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mediaType = (meta.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
  const messages = [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } }, { type: 'text', text: `استخرج قائمة المهام من هذه الصورة. المشاريع الموجودة: ${state.goals.filter(g => !g.archived && !g.template).map(g => g.name).join('، ') || 'لا يوجد'}. أعد كتلة JSON واحدة بإجراءات create_task (اختر أقرب مشروع موجود أو اترك project فارغاً)، مع سطر قصير قبلها يلخص ما وجدته.` }] }];
  const raw = await askClaude({ messages });
  return parseActions(raw);
}

/** تنفيذ الإجراءات بعد تأكيد المستخدم */
export async function runActions(actions, { defaultGoalId = null } = {}) {
  if (!actions.length) return 0;
  const summary = actions.map(a => a.type === 'create_project' ? `• مشروع «${a.name}» مع ${(a.tasks || []).length} مهمة` : `• مهمة «${a.name}»${a.project ? ` في ${a.project}` : ''}${a.dueDate ? ` (${a.dueDate})` : ''}`).join('\n');
  if (!(await confirmDialog(`تنفيذ هذه الإجراءات؟\n${summary}`, { danger: false, okLabel: 'نفّذ', title: 'اقتراح المساعد' }))) return 0;
  let n = 0;
  const findGoal = (name) => { if (!name) return null; const q = name.trim().toLowerCase(); return state.goals.find(g => !g.archived && g.name.toLowerCase() === q) || state.goals.find(g => !g.archived && g.name.toLowerCase().includes(q)) || null; };
  for (const a of actions) {
    try {
      if (a.type === 'create_project') {
        const start = a.startDate || isoDate(), end = a.endDate || isoDate(addDays(start, 30));
        const id = await api.createGoal({ name: a.name || 'مشروع جديد', startDate: start, endDate: end, note: a.note || '', category: a.category || 'work', priority: a.priority || 'medium', color: '#2563eb', visibility: 'private', visibilityMode: 'private', stages: DEFAULT_STAGES.map(s => ({ ...s })), tags: [], milestones: [], manager: state.user.uid });
        n++;
        const tasks = (a.tasks || []).map((t, i) => ({ id: uid(), name: t.name || 'مهمة', goalId: id, dueDate: t.dueDate || null, priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium', notes: t.notes || '', plannedHours: Number(t.plannedHours) || 0, stageId: DEFAULT_STAGES[0].id, assignedToUid: state.user.uid, assignedUserIds: [state.user.uid], completed: false, completedAt: null, order: i, tags: [] }));
        if (tasks.length) { await api.createTasksBatch(tasks); n += tasks.length; }
      } else if (a.type === 'create_task') {
        const g = findGoal(a.project) || (defaultGoalId && state.goals.find(x => x.id === defaultGoalId)) || state.goals.find(x => !x.archived && !x.template);
        if (!g) continue;
        await api.createTask({ name: a.name || 'مهمة', goalId: g.id, dueDate: a.dueDate || null, priority: ['high', 'medium', 'low'].includes(a.priority) ? a.priority : 'medium', notes: a.notes || '', plannedHours: Number(a.plannedHours) || 0, stageId: firstOpenStage(projectStages(g)).id, assignedToUid: state.user.uid, assignedUserIds: [state.user.uid], tags: [] });
        n++;
      }
    } catch (e) { console.error(e); }
  }
  toast(`تم تنفيذ ${n} عنصر ✅`, { type: 'ok' });
  return n;
}
