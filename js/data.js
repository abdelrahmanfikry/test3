// طبقة البيانات: Firebase (نفس مشروع النسخة القديمة ونفس المجموعات) أو وضع تجريبي محلي.
// المجموعات: userProfiles, goals, tasks, activity, mail (Trigger Email extension).
import { state, notify } from './store.js';
import { uid, isoDate, addDays, toMillis } from './utils.js';
import { ensureStorage } from './lib.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBj9dkTsf22p4GpLrVzZr1qdC2UFWoCi2Q',
  authDomain: 'to-do-aeb49.firebaseapp.com',
  projectId: 'to-do-aeb49',
  storageBucket: 'to-do-aeb49.firebasestorage.app',
  messagingSenderId: '434009324425',
  appId: '1:434009324425:web:ed7078ea09ed89c1f17f58',
  measurementId: 'G-8S5SLY6S2Y',
};

/** مفتاح VAPID لإشعارات Web Push (Firebase Console → Cloud Messaging → Web Push certificates). اتركه فارغاً لتعطيل FCM. */
export const FCM_VAPID_KEY = '';

let auth = null, db = null, FV = null, storage = null;
let unsub = [];
let adapter = null;
let usersSig = '', presenceTimer = null, purgeTimer = null, notifCleaned = false;
const TRASH_MS = 30 * 86400000;
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || matchMedia('(display-mode: standalone)').matches;

/** يبني إشعارات لحدث ما (مشترك بين Firebase والتجريبي). يعيد [{to, type, title, body, taskId, projectId, tab}] */
function notifPayloads(kind, ctx) {
  const me = state.user.uid, out = [];
  const add = (to, type, title, body, extra = {}) => { if (to && to !== me && !out.some(o => o.to === to && o.type === type)) out.push({ to, type, title, body: body || '', ...extra }); };
  const t = ctx.task || {}; const g = state.goals.find(x => x.id === t.goalId);
  const base = { taskId: t.id || null, projectId: t.goalId || null };
  if (kind === 'assigned') for (const u of ctx.uids || []) add(u, 'assigned', t.name || 'مهمة', `كُلّفت بهذه المهمة${g ? ' في ' + g.name : ''}`, base);
  if (kind === 'done') add(t.createdBy, 'done', t.name || 'مهمة', 'أُنجزت مهمة أنشأتها', base);
  if (kind === 'stage') add(t.createdBy, 'stage', t.name || 'مهمة', `انتقلت إلى «${ctx.stageName}»`, base);
  if (kind === 'comment') {
    for (const u of ctx.mentions || []) add(u, 'mention', t.name || 'مهمة', (ctx.text || '').slice(0, 120), { ...base, tab: 'details' });
    for (const u of [...(t.assignedUserIds || []), t.assignedToUid, t.createdBy]) add(u, 'comment', t.name || 'مهمة', (ctx.text || '').slice(0, 120), { ...base, tab: 'details' });
  }
  return out;
}
function actorName() { return (state.profile && state.profile.displayName) || (state.user && (state.user.displayName || state.user.email)) || ''; }

function splitTasks(all) { state.trash.tasks = all.filter(t => t.deleted); state.tasks = all.filter(t => !t.deleted); }
function splitGoals(all) { state.trash.goals = all.filter(g => g.deleted); return all.filter(g => !g.deleted); }

export function isDemo() { return state.demo; }

// ================= Firebase adapter =================
const fb = {
  init(onUser) {
    if (typeof window.firebase === 'undefined') { console.warn('Firebase SDK missing'); onUser(null); return; }
    if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
    auth = window.firebase.auth();
    db = window.firebase.firestore();
    FV = window.firebase.firestore.FieldValue;
    try { db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch { /* ignore */ }
    auth.getRedirectResult().catch(e => console.warn('redirect', e));
    auth.onAuthStateChanged(async (u) => {
      detach(); clearInterval(presenceTimer); clearTimeout(purgeTimer);
      if (!u) { state.user = null; state.profile = null; state.isAdmin = false; state.goals = []; state.tasks = []; state.trash = { goals: [], tasks: [] }; state.notifications = []; state.presence = []; state.taskTemplates = []; state.pending = 0; usersSig = ''; notifCleaned = false; onUser(null); return; }
      state.user = { uid: u.uid, email: u.email || '', displayName: u.displayName || '', photoURL: u.photoURL || '' };
      await fb.ensureProfile(u);
      attach();
      onUser(state.user);
    });
  },
  async ensureProfile(u) {
    const ref = db.collection('userProfiles').doc(u.uid);
    try {
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({ email: u.email || '', role: 'user', displayName: u.displayName || '', photoURL: u.photoURL || '', createdAt: FV.serverTimestamp(), lastSeen: FV.serverTimestamp() });
        state.profile = { email: u.email, role: 'user', displayName: u.displayName || '' };
      } else {
        state.profile = snap.data();
        ref.update({ lastSeen: FV.serverTimestamp(), ...(u.displayName && !state.profile.displayName ? { displayName: u.displayName } : {}) }).catch(() => {});
      }
      state.isAdmin = state.profile.role === 'admin';
      // حضور: تحديث «آخر ظهور» كل 4 دقائق أثناء فتح الصفحة
      presenceTimer = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) ref.update({ lastSeen: FV.serverTimestamp() }).catch(() => {}); }, 4 * 60 * 1000);
    } catch (e) { console.error('profile', e); state.profile = { role: 'user' }; state.isAdmin = false; }
  },
  signIn: (email, pw) => auth.signInWithEmailAndPassword(email.trim(), pw),
  signUp: async (email, pw, name) => { const c = await auth.createUserWithEmailAndPassword(email.trim(), pw); if (name) await c.user.updateProfile({ displayName: name }).catch(() => {}); return c; },
  // على الموبايل/التطبيق المثبّت نستخدم إعادة التوجيه لأن النوافذ المنبثقة تُحجب كثيراً
  signInGoogle: () => { const p = new window.firebase.auth.GoogleAuthProvider(); return isMobile() ? auth.signInWithRedirect(p) : auth.signInWithPopup(p); },
  resetPassword: (email) => auth.sendPasswordResetEmail(email.trim()),
  signOut: () => auth.signOut(),

  // ----- قراءة حيّة -----
  attach() {
    const u = state.user;
    state.loading = true; notify('loading');
    const onErr = (label) => (e) => { console.error(label, e); state.loading = false; notify('error'); };
    // عدّاد الكتابات غير المرفوعة بعد (أوفلاين): نستمع لتغيّرات البيانات الوصفية دون إعادة رسم كاملة
    const pendingOf = (s) => { const n = s.docs.filter(d => d.metadata.hasPendingWrites).length; if (n !== state.pending) { state.pending = n; notify('pending'); } };
    const onTasks = (s) => { pendingOf(s); if (!s.docChanges().length && state.tasks.length) return; splitTasks(s.docs.map(d => ({ id: d.id, ...d.data() }))); notify('tasks'); };
    if (state.isAdmin) {
      unsub.push(db.collection('goals').orderBy('createdAt', 'desc').onSnapshot(s => { state.goals = splitGoals(s.docs.map(d => ({ id: d.id, ...d.data() }))); state.loading = false; notify('goals'); }, onErr('goals')));
      unsub.push(db.collection('tasks').orderBy('createdAt', 'desc').onSnapshot({ includeMetadataChanges: true }, onTasks, onErr('tasks')));
    } else {
      let assigned = {}, pub = {};
      const merge = () => {
        const m = new Map();
        Object.values(pub).forEach(g => { if (!(g.blockedUserIds || []).includes(u.uid)) m.set(g.id, g); });
        Object.values(assigned).forEach(g => m.set(g.id, g));
        state.goals = splitGoals([...m.values()].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
        state.loading = false; notify('goals');
      };
      unsub.push(db.collection('goals').where('assignedUserIds', 'array-contains', u.uid).onSnapshot(s => { assigned = {}; s.forEach(d => { assigned[d.id] = { id: d.id, ...d.data() }; }); merge(); }, onErr('goals-assigned')));
      unsub.push(db.collection('goals').where('visibility', '==', 'public').onSnapshot(s => { pub = {}; s.forEach(d => { pub[d.id] = { id: d.id, ...d.data() }; }); merge(); }, onErr('goals-public')));
      unsub.push(db.collection('tasks').orderBy('createdAt', 'desc').onSnapshot({ includeMetadataChanges: true }, onTasks, onErr('tasks')));
    }
    // إشعاراتي على السيرفر (تُقرأ من كل الأجهزة)
    unsub.push(db.collection('notifications').where('to', '==', u.uid).onSnapshot(s => {
      const list = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      state.notifications = list.slice(0, 80);
      document.dispatchEvent(new CustomEvent('goals:notifications', { detail: list }));
      notify('notifications');
      if (!notifCleaned) { notifCleaned = true; const cutoff = Date.now() - TRASH_MS; const old = list.filter(n => n.read && toMillis(n.createdAt) && toMillis(n.createdAt) < cutoff).slice(0, 200); if (old.length) { const b = db.batch(); old.forEach(n => b.delete(db.collection('notifications').doc(n.id))); b.commit().catch(() => {}); } }
    }, e => console.warn('notifications', e)));
    // الحضور المباشر وقوالب المهام (مجموعات صغيرة)
    unsub.push(db.collection('presence').onSnapshot(s => { state.presence = s.docs.map(d => ({ uid: d.id, ...d.data() })); notify('presence'); }, () => {}));
    unsub.push(db.collection('taskTemplates').orderBy('createdAt', 'desc').onSnapshot(s => { state.taskTemplates = s.docs.map(d => ({ id: d.id, ...d.data() })); notify('templates'); }, () => {}));
    // البروفايلات: للأدمن الكل، ولغيره نحمّل عند الحاجة
    fb.loadUsers().catch(() => {});
    // تنظيف سلة المحذوفات (أقدم من 30 يوماً) بعد استقرار البيانات
    purgeTimer = setTimeout(() => fb.autoPurge().catch(() => {}), 10000);
  },
  async loadUsers() {
    try {
      const s = await db.collection('userProfiles').orderBy('email').get();
      const list = s.docs.map(d => ({ uid: d.id, ...d.data() }));
      const sig = list.map(u => `${u.uid}|${u.role}|${u.displayName || ''}|${u.photoURL || ''}|${toMillis(u.lastSeen)}|${JSON.stringify(u.favorites || [])}|${u.hourlyRate || 0}|${u.weeklyCapacity || 0}`).join(';');
      state.users = list;
      // لا نُشعر المشتركين إلا إذا تغيّر شيء فعلاً (يمنع حلقة إعادة رسم صفحة الفريق)
      if (sig !== usersSig) { usersSig = sig; notify('users'); }
    } catch (e) { console.warn('users', e); }
    return state.users;
  },
  async loadActivity(limit = 100) {
    let q = db.collection('activity').orderBy('createdAt', 'desc').limit(limit);
    if (!state.isAdmin) q = db.collection('activity').where('actorUid', '==', state.user.uid).orderBy('createdAt', 'desc').limit(limit);
    try { const s = await q.get(); state.activity = s.docs.map(d => ({ id: d.id, ...d.data() })); }
    catch (e) { console.warn('activity', e); state.activity = []; }
    notify('activity');
    return state.activity;
  },

  // ----- كتابة -----
  async createGoal(g) {
    const u = state.user;
    const doc = { ...g, progress: 0, createdBy: u.uid, createdByEmail: u.email || '', createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(), assignedUserIds: g.assignedUserIds || [u.uid], visibility: g.visibility || 'private', visibilityMode: g.visibilityMode || 'private', blockedUserIds: g.blockedUserIds || [], archived: false };
    const ref = await db.collection('goals').add(doc);
    fb.log('create', 'goal', ref.id, { name: g.name });
    fb.mailGoalUsers(doc.assignedUserIds, 'هدف جديد', `<h3>تم إنشاء هدف جديد</h3><p><strong>${g.name}</strong></p><p>${g.startDate} → ${g.endDate}</p>`);
    return ref.id;
  },
  async updateGoal(id, patch) {
    await db.collection('goals').doc(id).update({ ...patch, updatedAt: FV.serverTimestamp() });
    fb.log('update', 'goal', id, patch);
  },
  /** حذف ناعم: ينقل المشروع ومهامه إلى سلة المحذوفات */
  async deleteGoal(id) {
    const s = await db.collection('tasks').where('goalId', '==', id).get();
    const batch = db.batch();
    s.forEach(d => { if (!d.data().deleted) batch.update(d.ref, { deleted: true, deletedAt: FV.serverTimestamp(), deletedWithGoal: id }); });
    batch.update(db.collection('goals').doc(id), { deleted: true, deletedAt: FV.serverTimestamp(), deletedBy: state.user.uid, updatedAt: FV.serverTimestamp() });
    await batch.commit();
    fb.log('delete', 'goal', id, {});
  },
  async restoreGoal(id) {
    const s = await db.collection('tasks').where('goalId', '==', id).get();
    const batch = db.batch();
    s.forEach(d => { if (d.data().deletedWithGoal === id) batch.update(d.ref, { deleted: false, deletedAt: null, deletedWithGoal: null }); });
    batch.update(db.collection('goals').doc(id), { deleted: false, deletedAt: null, deletedBy: null, updatedAt: FV.serverTimestamp() });
    await batch.commit();
    fb.log('update', 'goal', id, { restored: true });
  },
  async purgeGoal(id) {
    const s = await db.collection('tasks').where('goalId', '==', id).get();
    const batch = db.batch();
    s.forEach(d => batch.delete(d.ref));
    batch.delete(db.collection('goals').doc(id));
    await batch.commit();
    fb.log('delete', 'goal', id, { purged: true });
  },
  async createTask(t) {
    const u = state.user;
    const assignee = t.assignedToUid ? state.users.find(x => x.uid === t.assignedToUid) : null;
    const doc = { ...t, completed: false, completedAt: null, createdBy: u.uid, createdByEmail: u.email || '', assignedToUid: t.assignedToUid || null, assignedToEmail: assignee ? assignee.email : null, createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() };
    const ref = await db.collection('tasks').add(doc);
    fb.log('create', 'task', ref.id, { name: t.name, goalId: t.goalId });
    fb.syncProgress(t.goalId);
    if (doc.assignedToEmail && doc.assignedToUid !== u.uid) fb.mail([doc.assignedToEmail], 'تم تعيين مهمة لك', `<h3>مهمة جديدة</h3><p><strong>${t.name}</strong></p>${t.dueDate ? `<p>الموعد: ${t.dueDate}</p>` : ''}`);
    fb.pushNotifications(notifPayloads('assigned', { task: { ...doc, id: ref.id }, uids: [...new Set([...(doc.assignedUserIds || []), doc.assignedToUid].filter(Boolean))] }));
    return ref.id;
  },
  async updateTask(id, patch) {
    if (patch.assignedToUid !== undefined) { const a = state.users.find(x => x.uid === patch.assignedToUid); patch.assignedToEmail = a ? a.email : null; }
    const before = state.tasks.find(x => x.id === id);
    await db.collection('tasks').doc(id).update({ ...patch, updatedAt: FV.serverTimestamp() });
    fb.log('update', 'task', id, patch);
    if (before) {
      fb.syncProgress(patch.goalId || before.goalId);
      const after = { ...before, ...patch };
      const was = new Set([...(before.assignedUserIds || []), before.assignedToUid].filter(Boolean));
      const now = [...new Set([...(after.assignedUserIds || []), after.assignedToUid].filter(Boolean))].filter(x => !was.has(x));
      if (now.length) fb.pushNotifications(notifPayloads('assigned', { task: after, uids: now }));
      if (patch.completed === true && !before.completed) fb.pushNotifications(notifPayloads('done', { task: after }));
      else if (patch.stageId && patch.stageId !== before.stageId) { const g = state.goals.find(x => x.id === after.goalId); const s = g && (g.stages || []).find(x => x.id === patch.stageId); if (s) fb.pushNotifications(notifPayloads('stage', { task: after, stageName: s.name })); }
    }
  },
  async toggleTask(id, completed) {
    const t = state.tasks.find(x => x.id === id);
    await db.collection('tasks').doc(id).update({ completed, completedAt: completed ? FV.serverTimestamp() : null, updatedAt: FV.serverTimestamp() });
    fb.log('update', 'task', id, { completed });
    if (t) {
      fb.syncProgress(t.goalId);
      if (completed) {
        const g = state.goals.find(x => x.id === t.goalId);
        const to = new Set([g && g.createdBy, t.assignedToUid].filter(Boolean).filter(x => x !== state.user.uid));
        const emails = state.users.filter(x => to.has(x.uid)).map(x => x.email).filter(Boolean);
        fb.mail(emails, 'تم إنجاز مهمة', `<h3>تم إنجاز مهمة</h3><p><strong>${t.name}</strong></p>`);
        fb.pushNotifications(notifPayloads('done', { task: t }));
      }
    }
  },
  // ----- إشعارات السيرفر، الحضور، القوالب، المشاركة، الفريق، النسخ الاحتياطي -----
  pushNotifications(list) {
    for (const n of list) db.collection('notifications').add({ ...n, by: state.user.uid, byName: actorName(), read: false, createdAt: FV.serverTimestamp() }).catch(() => {});
  },
  async markNotificationRead(id) { await db.collection('notifications').doc(id).update({ read: true }); },
  async markAllNotificationsRead() { const b = db.batch(); (state.notifications || []).filter(n => !n.read).forEach(n => b.update(db.collection('notifications').doc(n.id), { read: true })); await b.commit(); },
  async registerPushToken(token) { await db.collection('userProfiles').doc(state.user.uid).set({ fcmTokens: FV.arrayUnion(token) }, { merge: true }); },
  async setPresence(p) { await db.collection('presence').doc(state.user.uid).set({ ...p, uid: state.user.uid, at: FV.serverTimestamp() }, { merge: true }); },
  clearPresence() { try { db.collection('presence').doc(state.user.uid).delete(); } catch { /* ignore */ } },
  async saveTaskTemplate(tpl) { await db.collection('taskTemplates').doc(tpl.id).set({ ...tpl, createdAt: FV.serverTimestamp() }); },
  async deleteTaskTemplate(id) { await db.collection('taskTemplates').doc(id).delete(); },
  async setShare(token, snap) { await db.collection('shares').doc(token).set({ ...snap, createdAt: FV.serverTimestamp() }, { merge: true }); },
  async deleteShare(token) { await db.collection('shares').doc(token).delete(); },
  async updateUserProfile(uidX, patch) { await db.collection('userProfiles').doc(uidX).set(patch, { merge: true }); fb.log('update', 'user', uidX, patch); usersSig = ''; await fb.loadUsers(); },
  async uploadBackup(json, name) {
    if (!storage) { try { await ensureStorage(); storage = window.firebase.storage(); } catch { storage = null; } }
    if (!storage) throw new Error('storage-unavailable');
    const ref = storage.ref(`backups/${state.user.uid}/${name}`);
    await ref.putString(json, 'raw', { contentType: 'application/json' });
    return ref.getDownloadURL();
  },
  async listBackups() {
    if (!storage) { try { await ensureStorage(); storage = window.firebase.storage(); } catch { return []; } }
    try { const r = await storage.ref(`backups/${state.user.uid}`).listAll(); return Promise.all(r.items.map(async i => ({ name: i.name, url: await i.getDownloadURL() }))); } catch { return []; }
  },
  /** حذف ناعم: تنتقل المهمة إلى سلة المحذوفات ويمكن استعادتها */
  async deleteTask(id) {
    const t = state.tasks.find(x => x.id === id);
    await db.collection('tasks').doc(id).update({ deleted: true, deletedAt: FV.serverTimestamp(), deletedBy: state.user.uid, updatedAt: FV.serverTimestamp() });
    fb.log('delete', 'task', id, { goalId: t && t.goalId, name: t && t.name });
    if (t) fb.syncProgress(t.goalId);
  },
  async restoreTask(id) {
    await db.collection('tasks').doc(id).update({ deleted: false, deletedAt: null, deletedBy: null, deletedWithGoal: null, updatedAt: FV.serverTimestamp() });
    fb.log('update', 'task', id, { restored: true });
    const t = state.trash.tasks.find(x => x.id === id); if (t) fb.syncProgress(t.goalId);
  },
  async purgeTask(id) {
    await db.collection('tasks').doc(id).delete();
    fb.log('delete', 'task', id, { purged: true });
  },
  async autoPurge() {
    const cutoff = Date.now() - TRASH_MS;
    const mine = (x) => state.isAdmin || x.deletedBy === state.user.uid || x.createdBy === state.user.uid;
    const old = (list) => list.filter(x => toMillis(x.deletedAt) && toMillis(x.deletedAt) < cutoff && mine(x));
    for (const g of old(state.trash.goals)) await fb.purgeGoal(g.id).catch(() => {});
    for (const t of old(state.trash.tasks).filter(t => !t.deletedWithGoal)) await fb.purgeTask(t.id).catch(() => {});
  },
  async reorderTasks(ids) {
    const batch = db.batch();
    ids.forEach((id, i) => batch.update(db.collection('tasks').doc(id), { order: i }));
    await batch.commit();
  },
  async setRole(uid, role) {
    await db.collection('userProfiles').doc(uid).update({ role });
    fb.log('update', 'user', uid, { role });
  },
  async updateProfile(patch) {
    await db.collection('userProfiles').doc(state.user.uid).set(patch, { merge: true });
    if (patch.displayName != null && auth.currentUser) auth.currentUser.updateProfile({ displayName: patch.displayName }).catch(() => {});
    state.profile = { ...state.profile, ...patch }; notify('profile');
  },
  // ----- Odoo-like: تعليقات، مرفقات، إنشاء من قالب، إنشاء مهام دفعة -----
  async loadMessages(taskId) {
    try { const s = await db.collection('tasks').doc(taskId).collection('messages').orderBy('createdAt', 'asc').limit(200).get(); return s.docs.map(d => ({ id: d.id, ...d.data() })); }
    catch (e) { console.warn('messages', e); return []; }
  },
  async addMessage(taskId, msg) {
    const u = state.user;
    const doc = { ...msg, uid: u.uid, email: u.email || '', name: (state.profile && state.profile.displayName) || u.displayName || '', createdAt: FV.serverTimestamp() };
    await db.collection('tasks').doc(taskId).collection('messages').add(doc);
    const t = state.tasks.find(x => x.id === taskId);
    if (t && msg.type === 'comment') {
      const to = new Set([...(t.assignedUserIds || []), t.assignedToUid, t.createdBy, ...(msg.mentions || [])].filter(x => x && x !== u.uid));
      fb.mail(state.users.filter(x => to.has(x.uid)).map(x => x.email), `تعليق جديد على «${t.name}»`, `<p><strong>${doc.name || doc.email}</strong>: ${msg.text}</p>`);
      fb.pushNotifications(notifPayloads('comment', { task: t, mentions: msg.mentions || [], text: msg.text }));
    }
    return { ...doc, createdAt: Date.now() };
  },
  async uploadAttachment(taskId, file) {
    if (!storage) { try { await ensureStorage(); storage = window.firebase.storage(); } catch { storage = null; } }
    if (!storage) throw new Error('storage-unavailable');
    if (file.size > 10 * 1024 * 1024) throw new Error('too-large');
    const ref = storage.ref(`tasks/${taskId}/${Date.now()}_${file.name}`);
    await ref.put(file);
    const url = await ref.getDownloadURL();
    const att = { id: Date.now().toString(36), name: file.name, size: file.size, type: file.type, url, uid: state.user.uid, at: Date.now() };
    await db.collection('tasks').doc(taskId).update({ attachments: FV.arrayUnion(att), updatedAt: FV.serverTimestamp() });
    return att;
  },
  async createTasksBatch(list) {
    const u = state.user;
    const batch = db.batch();
    for (const t of list) {
      const ref = t.id ? db.collection('tasks').doc(t.id) : db.collection('tasks').doc();
      const { id, ...rest } = t;
      batch.set(ref, { ...rest, createdBy: u.uid, createdByEmail: u.email || '', assignedToUid: rest.assignedToUid || null, assignedToEmail: null, createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
    }
    await batch.commit();
  },
  /** يحدّث حقل progress في الهدف (للتوافق مع النسخة القديمة) بعد أي تغيير في مهامه */
  syncProgress(goalId) {
    if (!goalId) return;
    setTimeout(() => {
      const ts = state.tasks.filter(t => t.goalId === goalId);
      if (!ts.length) return;
      const p = Math.round((ts.filter(t => t.completed).length / ts.length) * 100);
      const g = state.goals.find(x => x.id === goalId);
      if (g && g.progress !== p) db.collection('goals').doc(goalId).update({ progress: p, updatedAt: FV.serverTimestamp() }).catch(() => {});
    }, 800);
  },
  log(actionType, entityType, entityId, payload) {
    try {
      const u = state.user;
      const base = { actionType, entityType, entityId, payload: payload || {}, actorUid: u ? u.uid : null, actorEmail: u ? u.email : '', createdAt: FV.serverTimestamp() };
      db.collection('activity').add(base).catch(() => {});
      if (entityType === 'goal') db.collection('goals').doc(entityId).collection('activity').add(base).catch(() => {});
      if (entityType === 'task') db.collection('tasks').doc(entityId).collection('activity').add(base).catch(() => {});
    } catch { /* ignore */ }
  },
  mail(emails, subject, html) {
    const list = (emails || []).filter(Boolean).slice(0, 100);
    for (const to of list) db.collection('mail').add({ to, message: { subject, html: `<div style="font-family:Tahoma,Arial,sans-serif;direction:rtl">${html}</div>` } }).catch(() => {});
  },
  mailGoalUsers(uids, subject, html) {
    const emails = state.users.filter(x => uids.includes(x.uid) && x.uid !== state.user.uid).map(x => x.email);
    fb.mail(emails, subject, html);
  },
};

function detach() { unsub.forEach(fn => { try { fn(); } catch { /* ignore */ } }); unsub = []; }
function attach() { adapter.attach(); }

// ================= Demo adapter (محلي بدون Firebase) =================
const DEMO_KEY = 'goals.demo';
const demo = {
  data: null,
  load() {
    try { demo.data = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch { demo.data = null; }
    if (!demo.data) demo.data = demo.seed();
  },
  save() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(demo.data)); } catch { /* ignore */ } },
  seed() {
    const me = 'demo-me', other = 'demo-sara';
    const now = Date.now();
    const d = (n) => isoDate(addDays(new Date(), n));
    const goals = [
      { id: 'g1', name: 'تعلّم تطوير الويب', startDate: d(-30), endDate: d(40), note: 'ساعة يومياً على الأقل، والتركيز على المشاريع العملية.', category: 'study', priority: 'high', color: '#2563eb', createdBy: me, createdByEmail: 'me@demo.app', createdAt: now - 30 * 86400000, updatedAt: now, assignedUserIds: [me, other], visibility: 'private', visibilityMode: 'private', blockedUserIds: [], archived: false },
      { id: 'g2', name: 'لياقة وصحة', startDate: d(-10), endDate: d(80), note: 'ثلاث حصص أسبوعياً + 8 آلاف خطوة يومياً.', category: 'health', priority: 'medium', color: '#16a34a', createdBy: me, createdByEmail: 'me@demo.app', createdAt: now - 10 * 86400000, updatedAt: now, assignedUserIds: [me], visibility: 'private', visibilityMode: 'private', blockedUserIds: [], archived: false },
      { id: 'g3', name: 'إطلاق المتجر الإلكتروني', startDate: d(-60), endDate: d(-3), note: '', category: 'work', priority: 'high', color: '#d97706', createdBy: other, createdByEmail: 'sara@demo.app', createdAt: now - 60 * 86400000, updatedAt: now, assignedUserIds: [me, other], visibility: 'public', visibilityMode: 'public', blockedUserIds: [], archived: false },
      { id: 'g4', name: 'قراءة 12 كتاباً', startDate: d(-200), endDate: d(-20), note: '', category: 'personal', priority: 'low', color: '#7c3aed', createdBy: me, createdByEmail: 'me@demo.app', createdAt: now - 200 * 86400000, updatedAt: now, assignedUserIds: [me], visibility: 'private', visibilityMode: 'private', blockedUserIds: [], archived: false },
    ];
    const T = (id, goalId, name, due, done, pr, assignee, daysAgoDone) => ({ id, goalId, name, dueDate: due, completed: done, completedAt: done ? now - (daysAgoDone || 0) * 86400000 : null, priority: pr || 'medium', notes: '', createdBy: me, createdByEmail: 'me@demo.app', assignedToUid: assignee || me, assignedToEmail: assignee === other ? 'sara@demo.app' : 'me@demo.app', createdAt: now - 20 * 86400000, updatedAt: now, order: 0 });
    const tasks = [
      T('t1', 'g1', 'إنهاء دورة HTML و CSS', d(-12), true, 'high', me, 12), T('t2', 'g1', 'مشروع صفحة شخصية', d(-5), true, 'medium', me, 5), T('t3', 'g1', 'أساسيات JavaScript', d(0), false, 'high'), T('t4', 'g1', 'تمارين DOM', d(2), false, 'medium'), T('t5', 'g1', 'مشروع قائمة مهام', d(9), false, 'medium', other),
      T('t6', 'g2', 'تمرين الجيم', d(-1), false, 'medium'), T('t7', 'g2', 'شراء حذاء جري', d(-8), true, 'low', me, 8), T('t8', 'g2', 'فحص طبي سنوي', d(20), false, 'low'), T('t9', 'g2', 'تمرين جري 5 كم', d(1), false, 'medium'),
      T('t10', 'g3', 'تصميم الهوية', d(-40), true, 'high', other, 40), T('t11', 'g3', 'ربط بوابة الدفع', d(-6), true, 'high', me, 3), T('t12', 'g3', 'اختبار الطلبات', d(-2), false, 'high', me), T('t13', 'g3', 'إطلاق الحملة الإعلانية', d(4), false, 'medium', other),
      ...Array.from({ length: 12 }, (_, i) => T('b' + i, 'g4', `كتاب ${i + 1}`, d(-190 + i * 15), true, 'low', me, 190 - i * 15)),
    ];
    // مزايا Odoo في البيانات التجريبية: مراحل، تاجز، معالم، مهام فرعية، ساعات، أنشطة، تكرار، تبعيات، قالب
    goals[0].stages = [{ id: 'new', name: 'جديد', color: '#64748b', fold: false, done: false }, { id: 'progress', name: 'قيد التنفيذ', color: '#2563eb', fold: false, done: false }, { id: 'review', name: 'مراجعة', color: '#d97706', fold: false, done: false }, { id: 'done', name: 'منجز', color: '#16a34a', fold: true, done: true }];
    goals[0].tags = [{ id: 'tg1', name: 'فرونت', color: '#2563eb' }, { id: 'tg2', name: 'مشروع', color: '#7c3aed' }, { id: 'tg3', name: 'عاجل', color: '#dc2626' }];
    goals[0].milestones = [{ id: 'm1', name: 'إنهاء الأساسيات', date: d(-4), done: true }, { id: 'm2', name: 'أول مشروع كامل', date: d(15), done: false }];
    goals[0].manager = me; goals[0].plannedHours = 60;
    goals[2].stages = [{ id: 'todo', name: 'للتنفيذ', color: '#64748b', fold: false, done: false }, { id: 'doing', name: 'جارٍ', color: '#2563eb', fold: false, done: false }, { id: 'qa', name: 'اختبار', color: '#d97706', fold: false, done: false }, { id: 'live', name: 'مُطلق', color: '#16a34a', fold: true, done: true }];
    goals[2].milestones = [{ id: 'm3', name: 'الإطلاق التجريبي', date: d(-10), done: true }, { id: 'm4', name: 'الإطلاق الرسمي', date: d(4), done: false }];
    goals.push({ id: 'g5', name: 'قالب: إطلاق منتج', startDate: d(0), endDate: d(60), note: 'قالب جاهز بمراحل ومهام نموذجية.', category: 'work', priority: 'medium', color: '#0891b2', createdBy: me, createdByEmail: 'me@demo.app', createdAt: now - 5 * 86400000, updatedAt: now, assignedUserIds: [me], visibility: 'private', visibilityMode: 'private', blockedUserIds: [], archived: false, template: true, stages: [{ id: 'idea', name: 'فكرة', color: '#64748b', fold: false, done: false }, { id: 'build', name: 'بناء', color: '#2563eb', fold: false, done: false }, { id: 'launch', name: 'إطلاق', color: '#16a34a', fold: true, done: true }], tags: [{ id: 'tg9', name: 'تسويق', color: '#db2777' }], milestones: [{ id: 'm9', name: 'MVP', date: d(30), done: false }] });
    const tIdx = (id) => tasks.find(t => t.id === id);
    Object.assign(tIdx('t3'), { stageId: 'progress', tags: ['tg1', 'tg3'], plannedHours: 6, timesheets: [{ id: 'ts1', uid: me, date: d(-1), hours: 1.5, note: 'قراءة الفصل الأول' }, { id: 'ts2', uid: me, date: d(0), hours: 2, note: 'تمارين' }], checklist: [{ id: 'c1', text: 'المتغيرات والأنواع', done: true }, { id: 'c2', text: 'الدوال', done: true }, { id: 'c3', text: 'المصفوفات', done: false }], activities: [{ id: 'a1', type: 'reminder', summary: 'مراجعة ملخص الفصل', due: d(0), uid: me, done: false }], startDate: d(-3) });
    Object.assign(tIdx('t4'), { stageId: 'new', tags: ['tg1'], blockedBy: ['t3'], plannedHours: 4, startDate: d(1) });
    Object.assign(tIdx('t5'), { stageId: 'new', tags: ['tg2'], assignedUserIds: [me, other], plannedHours: 12, startDate: d(5) });
    Object.assign(tIdx('t1'), { stageId: 'done', tags: ['tg1'], startDate: d(-25) }); Object.assign(tIdx('t2'), { stageId: 'done', tags: ['tg2'], startDate: d(-12) });
    tasks.push({ id: 'st1', goalId: 'g1', parentId: 't5', name: 'تصميم الواجهة', dueDate: d(6), completed: true, completedAt: now - 86400000, priority: 'medium', createdBy: me, createdByEmail: 'me@demo.app', assignedToUid: me, assignedToEmail: 'me@demo.app', createdAt: now - 3 * 86400000, updatedAt: now, stageId: 'done', order: 0 });
    tasks.push({ id: 'st2', goalId: 'g1', parentId: 't5', name: 'منطق الإضافة والحذف', dueDate: d(8), completed: false, completedAt: null, priority: 'high', createdBy: me, createdByEmail: 'me@demo.app', assignedToUid: other, assignedToEmail: 'sara@demo.app', createdAt: now - 3 * 86400000, updatedAt: now, stageId: 'progress', order: 1 });
    Object.assign(tIdx('t6'), { recurrence: { freq: 'weekly', interval: 1 }, activities: [{ id: 'a2', type: 'call', summary: 'حجز حصة مع المدرّب', due: d(-1), uid: me, done: false }] });
    Object.assign(tIdx('t12'), { stageId: 'qa', startDate: d(-5), plannedHours: 8, timesheets: [{ id: 'ts3', uid: me, date: d(-2), hours: 3, note: 'اختبار سيناريوهات الدفع' }] });
    Object.assign(tIdx('t13'), { stageId: 'todo', startDate: d(2), blockedBy: ['t12'], activities: [{ id: 'a3', type: 'meeting', summary: 'اجتماع فريق التسويق', due: d(2), uid: other, done: false }] });
    Object.assign(tIdx('t10'), { stageId: 'live' }); Object.assign(tIdx('t11'), { stageId: 'live' });
    tasks.push({ id: 'tp1', goalId: 'g5', name: 'تحديد الجمهور', dueDate: d(7), startDate: d(0), completed: false, completedAt: null, priority: 'high', createdBy: me, createdByEmail: 'me@demo.app', assignedToUid: null, assignedToEmail: null, createdAt: now, updatedAt: now, stageId: 'idea', order: 0, checklist: [{ id: 'c9', text: 'استبيان', done: false }, { id: 'c10', text: 'مقابلات', done: false }] });
    tasks.push({ id: 'tp2', goalId: 'g5', name: 'بناء MVP', dueDate: d(30), startDate: d(7), completed: false, completedAt: null, priority: 'high', createdBy: me, createdByEmail: 'me@demo.app', assignedToUid: null, assignedToEmail: null, createdAt: now, updatedAt: now, stageId: 'build', order: 1, blockedBy: ['tp1'] });
    tasks.push({ id: 'tp3', goalId: 'g5', name: 'حملة الإطلاق', dueDate: d(45), startDate: d(30), completed: false, completedAt: null, priority: 'medium', createdBy: me, createdByEmail: 'me@demo.app', assignedToUid: null, assignedToEmail: null, createdAt: now, updatedAt: now, stageId: 'launch', order: 2, tags: ['tg9'] });
    const users = [{ uid: me, email: 'me@demo.app', role: 'admin', displayName: 'أنا (تجريبي)', personalStages: null, personalStageMap: { t3: 'today', t4: 'week', t6: 'today' }, savedFilters: [{ id: 'sf1', name: 'عاجل ومتأخر', filters: { priority: 'high', status: 'open', group: 'due' } }], hourlyRate: 150, weeklyCapacity: 40, lastSeen: now }, { uid: other, email: 'sara@demo.app', role: 'user', displayName: 'سارة', hourlyRate: 120, weeklyCapacity: 30, lastSeen: now - 3 * 60000 }, { uid: 'demo-omar', email: 'omar@demo.app', role: 'user', displayName: 'عمر', hourlyRate: 100, weeklyCapacity: 40, lastSeen: now - 2 * 86400000 }];
    goals[2].budget = 5000; goals[0].budget = 3000;
    goals[0].stages[1].autoAssign = other; goals[0].stages[2].limit = 2;
    const activity = [];
    const notifications = [{ id: 'n1', to: me, type: 'assigned', title: 'إطلاق الحملة الإعلانية', body: 'كُلّفت بهذه المهمة في إطلاق المتجر الإلكتروني', taskId: 't13', projectId: 'g3', by: other, byName: 'سارة', read: false, createdAt: now - 3600000 }, { id: 'n2', to: me, type: 'comment', title: 'اختبار الطلبات', body: 'هل انتهى اختبار الدفع بالبطاقة؟', taskId: 't12', projectId: 'g3', tab: 'details', by: other, byName: 'سارة', read: false, createdAt: now - 7200000 }];
    const taskTemplates = [{ id: 'tt1', name: 'مراجعة كود', priority: 'medium', notes: 'تأكد من الاختبارات والتوثيق قبل الدمج.', checklist: ['قراءة التغييرات', 'تشغيل الاختبارات', 'ملاحظات للمطوّر'], plannedHours: 2, recurrence: null, durationDays: 1, createdBy: me, createdAt: now }];
    return { users, goals, tasks, activity, notifications, taskTemplates, mailOutbox: [] };
  },
  init(onUser) {
    demo.load();
    const me = demo.data.users[0];
    state.user = { uid: me.uid, email: me.email, displayName: me.displayName };
    state.profile = me; state.isAdmin = true;
    state.users = demo.data.users;
    demo.data.notifications = demo.data.notifications || []; demo.data.taskTemplates = demo.data.taskTemplates || []; demo.data.mailOutbox = demo.data.mailOutbox || [];
    state.notifications = [...demo.data.notifications].sort((a, b) => b.createdAt - a.createdAt); state.taskTemplates = [...demo.data.taskTemplates]; state.presence = []; state.pending = 0;
    demo.refresh();
    onUser(state.user);
  },
  pushNotifications(list) {
    if (!list.length) return;
    for (const n of list) demo.data.notifications.unshift({ id: uid(), ...n, by: state.user.uid, byName: actorName(), read: false, createdAt: Date.now() });
    demo.data.notifications = demo.data.notifications.slice(0, 80);
    state.notifications = [...demo.data.notifications]; demo.save();
    document.dispatchEvent(new CustomEvent('goals:notifications', { detail: state.notifications })); notify('notifications');
  },
  async markNotificationRead(id) { const n = demo.data.notifications.find(x => x.id === id); if (n) n.read = true; state.notifications = [...demo.data.notifications]; demo.save(); notify('notifications'); },
  async markAllNotificationsRead() { demo.data.notifications.forEach(n => { n.read = true; }); state.notifications = [...demo.data.notifications]; demo.save(); notify('notifications'); },
  async registerPushToken() {}, async setPresence() {}, clearPresence() {},
  async saveTaskTemplate(tpl) { demo.data.taskTemplates.unshift(tpl); state.taskTemplates = [...demo.data.taskTemplates]; demo.save(); notify('templates'); },
  async deleteTaskTemplate(id) { demo.data.taskTemplates = demo.data.taskTemplates.filter(t => t.id !== id); state.taskTemplates = [...demo.data.taskTemplates]; demo.save(); notify('templates'); },
  async setShare() { throw new Error('demo'); }, async deleteShare() {},
  async updateUserProfile(uidX, patch) { const u = demo.data.users.find(x => x.uid === uidX); if (u) Object.assign(u, patch); state.users = [...demo.data.users]; if (uidX === state.user.uid) state.profile = u; demo.save(); notify('users'); },
  mail(emails, subject, html) { demo.data.mailOutbox.push({ to: emails, subject, html, at: Date.now() }); demo.data.mailOutbox = demo.data.mailOutbox.slice(-20); demo.save(); },
  async uploadBackup() { throw new Error('storage-unavailable'); }, async listBackups() { return []; },
  refresh() {
    const gs = [...demo.data.goals].sort((a, b) => b.createdAt - a.createdAt);
    state.trash = { goals: gs.filter(g => g.deleted), tasks: demo.data.tasks.filter(t => t.deleted) };
    state.goals = gs.filter(g => !g.deleted); state.tasks = demo.data.tasks.filter(t => !t.deleted);
    state.loading = false; notify('goals'); notify('tasks');
  },
  attach() { demo.refresh(); },
  async loadUsers() { if (state.users !== demo.data.users) { state.users = demo.data.users; notify('users'); } return state.users; },
  async loadActivity() { state.activity = [...demo.data.activity].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100); notify('activity'); return state.activity; },
  async signOut() { state.demo = false; localStorage.removeItem('goals.demoOn'); location.hash = ''; location.reload(); },
  async createGoal(g) { const u = state.user; const doc = { id: uid(), ...g, progress: 0, createdBy: u.uid, createdByEmail: u.email, createdAt: Date.now(), updatedAt: Date.now(), assignedUserIds: g.assignedUserIds || [u.uid], visibility: g.visibility || 'private', visibilityMode: g.visibilityMode || 'private', blockedUserIds: g.blockedUserIds || [], archived: false }; demo.data.goals.push(doc); demo.log('create', 'goal', doc.id, { name: g.name }); demo.save(); demo.refresh(); return doc.id; },
  async updateGoal(id, patch) { const g = demo.data.goals.find(x => x.id === id); if (g) Object.assign(g, patch, { updatedAt: Date.now() }); demo.log('update', 'goal', id, patch); demo.save(); demo.refresh(); },
  async deleteGoal(id) { const g = demo.data.goals.find(x => x.id === id); if (g) { g.deleted = true; g.deletedAt = Date.now(); g.deletedBy = state.user.uid; } demo.data.tasks.forEach(t => { if (t.goalId === id && !t.deleted) { t.deleted = true; t.deletedAt = Date.now(); t.deletedWithGoal = id; } }); demo.log('delete', 'goal', id, {}); demo.save(); demo.refresh(); },
  async restoreGoal(id) { const g = demo.data.goals.find(x => x.id === id); if (g) { g.deleted = false; g.deletedAt = null; } demo.data.tasks.forEach(t => { if (t.deletedWithGoal === id) { t.deleted = false; t.deletedAt = null; t.deletedWithGoal = null; } }); demo.save(); demo.refresh(); },
  async purgeGoal(id) { demo.data.goals = demo.data.goals.filter(x => x.id !== id); demo.data.tasks = demo.data.tasks.filter(t => t.goalId !== id); demo.save(); demo.refresh(); },
  async createTask(t) { const u = state.user; const a = state.users.find(x => x.uid === t.assignedToUid); const doc = { id: uid(), ...t, completed: false, completedAt: null, createdBy: u.uid, createdByEmail: u.email, assignedToUid: t.assignedToUid || null, assignedToEmail: a ? a.email : null, createdAt: Date.now(), updatedAt: Date.now() }; demo.data.tasks.push(doc); demo.log('create', 'task', doc.id, { name: t.name, goalId: t.goalId }); demo.save(); demo.refresh(); demo.pushNotifications(notifPayloads('assigned', { task: doc, uids: [...new Set([...(doc.assignedUserIds || []), doc.assignedToUid].filter(Boolean))] })); return doc.id; },
  async updateTask(id, patch) {
    const t = demo.data.tasks.find(x => x.id === id); const before = t ? { ...t } : null;
    if (t) { if (patch.assignedToUid !== undefined) { const a = state.users.find(x => x.uid === patch.assignedToUid); patch.assignedToEmail = a ? a.email : null; } Object.assign(t, patch, { updatedAt: Date.now() }); }
    demo.log('update', 'task', id, patch); demo.save(); demo.refresh();
    if (before) {
      const was = new Set([...(before.assignedUserIds || []), before.assignedToUid].filter(Boolean));
      const now = [...new Set([...(t.assignedUserIds || []), t.assignedToUid].filter(Boolean))].filter(x => !was.has(x));
      if (now.length) demo.pushNotifications(notifPayloads('assigned', { task: t, uids: now }));
      if (patch.completed === true && !before.completed) demo.pushNotifications(notifPayloads('done', { task: t }));
      else if (patch.stageId && patch.stageId !== before.stageId) { const g = demo.data.goals.find(x => x.id === t.goalId); const s = g && (g.stages || []).find(x => x.id === patch.stageId); if (s) demo.pushNotifications(notifPayloads('stage', { task: t, stageName: s.name })); }
    }
  },
  async toggleTask(id, completed) { const t = demo.data.tasks.find(x => x.id === id); if (t) { t.completed = completed; t.completedAt = completed ? Date.now() : null; t.updatedAt = Date.now(); } demo.log('update', 'task', id, { completed }); demo.save(); demo.refresh(); },
  async deleteTask(id) { const t = demo.data.tasks.find(x => x.id === id); if (t) { t.deleted = true; t.deletedAt = Date.now(); t.deletedBy = state.user.uid; } demo.log('delete', 'task', id, { name: t && t.name }); demo.save(); demo.refresh(); },
  async restoreTask(id) { const t = demo.data.tasks.find(x => x.id === id); if (t) { t.deleted = false; t.deletedAt = null; t.deletedWithGoal = null; } demo.save(); demo.refresh(); },
  async purgeTask(id) { demo.data.tasks = demo.data.tasks.filter(x => x.id !== id); demo.save(); demo.refresh(); },
  async reorderTasks(ids) { ids.forEach((id, i) => { const t = demo.data.tasks.find(x => x.id === id); if (t) t.order = i; }); demo.save(); demo.refresh(); },
  async setRole(u, role) { const x = demo.data.users.find(y => y.uid === u); if (x) x.role = role; demo.save(); notify('users'); },
  async updateProfile(patch) { Object.assign(demo.data.users[0], patch); state.profile = demo.data.users[0]; demo.save(); notify('profile'); },
  async loadMessages(taskId) { const t = demo.data.tasks.find(x => x.id === taskId); return t && t._messages ? [...t._messages] : []; },
  async addMessage(taskId, msg) { const t = demo.data.tasks.find(x => x.id === taskId); if (!t) return null; t._messages = t._messages || []; const doc = { id: uid(), ...msg, uid: state.user.uid, email: state.user.email, name: state.profile.displayName || '', createdAt: Date.now() }; t._messages.push(doc); demo.save(); if (msg.type === 'comment') demo.pushNotifications(notifPayloads('comment', { task: t, mentions: msg.mentions || [], text: msg.text })); return doc; },
  async uploadAttachment(taskId, file) {
    if (file.size > 400 * 1024) throw new Error('too-large');
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const att = { id: uid(), name: file.name, size: file.size, type: file.type, url, uid: state.user.uid, at: Date.now() };
    const t = demo.data.tasks.find(x => x.id === taskId); if (t) { t.attachments = [...(t.attachments || []), att]; demo.save(); demo.refresh(); }
    return att;
  },
  async createTasksBatch(list) { const u = state.user; for (const t of list) demo.data.tasks.push({ ...t, id: t.id || uid(), createdBy: u.uid, createdByEmail: u.email, assignedToUid: t.assignedToUid || null, assignedToEmail: null, createdAt: Date.now(), updatedAt: Date.now() }); demo.save(); demo.refresh(); },
  log(actionType, entityType, entityId, payload) { demo.data.activity.push({ id: uid(), actionType, entityType, entityId, payload, actorUid: state.user.uid, actorEmail: state.user.email, createdAt: Date.now() }); },
  resetPassword: async () => {}, signIn: async () => {}, signUp: async () => {}, signInGoogle: async () => {},
};

// ================= واجهة موحّدة =================
export async function init(onUser) {
  const demoOn = location.hash.includes('demo') || localStorage.getItem('goals.demoOn') === '1';
  state.demo = demoOn;
  adapter = demoOn ? demo : fb;
  if (demoOn) localStorage.setItem('goals.demoOn', '1');
  // في وضع Firebase ننتظر تحميل SDK (يُحمَّل من index.html فقط عند الحاجة)
  if (!demoOn && window.__fbReady) { try { await window.__fbReady; } catch { /* ignore */ } }
  adapter.init(onUser);
}
export function enterDemo() { localStorage.setItem('goals.demoOn', '1'); location.hash = 'dashboard'; location.reload(); }
export function resetDemo() { localStorage.removeItem(DEMO_KEY); location.reload(); }

export const api = new Proxy({}, { get: (_, k) => (...a) => adapter[k](...a) });
