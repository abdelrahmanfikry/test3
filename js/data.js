// طبقة البيانات: Firebase (نفس مشروع النسخة القديمة ونفس المجموعات) أو وضع تجريبي محلي.
// المجموعات: userProfiles, goals, tasks, activity, mail (Trigger Email extension).
import { state, notify } from './store.js';
import { uid, isoDate, addDays } from './utils.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBj9dkTsf22p4GpLrVzZr1qdC2UFWoCi2Q',
  authDomain: 'to-do-aeb49.firebaseapp.com',
  projectId: 'to-do-aeb49',
  storageBucket: 'to-do-aeb49.firebasestorage.app',
  messagingSenderId: '434009324425',
  appId: '1:434009324425:web:ed7078ea09ed89c1f17f58',
  measurementId: 'G-8S5SLY6S2Y',
};

let auth = null, db = null, FV = null;
let unsub = [];
let adapter = null;

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
    auth.onAuthStateChanged(async (u) => {
      detach();
      if (!u) { state.user = null; state.profile = null; state.isAdmin = false; state.goals = []; state.tasks = []; onUser(null); return; }
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
    } catch (e) { console.error('profile', e); state.profile = { role: 'user' }; state.isAdmin = false; }
  },
  signIn: (email, pw) => auth.signInWithEmailAndPassword(email.trim(), pw),
  signUp: async (email, pw, name) => { const c = await auth.createUserWithEmailAndPassword(email.trim(), pw); if (name) await c.user.updateProfile({ displayName: name }).catch(() => {}); return c; },
  signInGoogle: () => auth.signInWithPopup(new window.firebase.auth.GoogleAuthProvider()),
  resetPassword: (email) => auth.sendPasswordResetEmail(email.trim()),
  signOut: () => auth.signOut(),

  // ----- قراءة حيّة -----
  attach() {
    const u = state.user;
    state.loading = true; notify('loading');
    const onErr = (label) => (e) => { console.error(label, e); state.loading = false; notify('error'); };
    if (state.isAdmin) {
      unsub.push(db.collection('goals').orderBy('createdAt', 'desc').onSnapshot(s => { state.goals = s.docs.map(d => ({ id: d.id, ...d.data() })); state.loading = false; notify('goals'); }, onErr('goals')));
      unsub.push(db.collection('tasks').orderBy('createdAt', 'desc').onSnapshot(s => { state.tasks = s.docs.map(d => ({ id: d.id, ...d.data() })); notify('tasks'); }, onErr('tasks')));
    } else {
      let assigned = {}, pub = {};
      const merge = () => {
        const m = new Map();
        Object.values(pub).forEach(g => { if (!(g.blockedUserIds || []).includes(u.uid)) m.set(g.id, g); });
        Object.values(assigned).forEach(g => m.set(g.id, g));
        state.goals = [...m.values()].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        state.loading = false; notify('goals');
      };
      unsub.push(db.collection('goals').where('assignedUserIds', 'array-contains', u.uid).onSnapshot(s => { assigned = {}; s.forEach(d => { assigned[d.id] = { id: d.id, ...d.data() }; }); merge(); }, onErr('goals-assigned')));
      unsub.push(db.collection('goals').where('visibility', '==', 'public').onSnapshot(s => { pub = {}; s.forEach(d => { pub[d.id] = { id: d.id, ...d.data() }; }); merge(); }, onErr('goals-public')));
      unsub.push(db.collection('tasks').orderBy('createdAt', 'desc').onSnapshot(s => { state.tasks = s.docs.map(d => ({ id: d.id, ...d.data() })); notify('tasks'); }, onErr('tasks')));
    }
    // البروفايلات: للأدمن الكل، ولغيره نحمّل عند الحاجة
    fb.loadUsers().catch(() => {});
  },
  async loadUsers() {
    try {
      const s = await db.collection('userProfiles').orderBy('email').get();
      state.users = s.docs.map(d => ({ uid: d.id, ...d.data() }));
      notify('users');
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
  async deleteGoal(id) {
    const s = await db.collection('tasks').where('goalId', '==', id).get();
    const batch = db.batch();
    s.forEach(d => batch.delete(d.ref));
    batch.delete(db.collection('goals').doc(id));
    await batch.commit();
    fb.log('delete', 'goal', id, {});
  },
  async createTask(t) {
    const u = state.user;
    const assignee = t.assignedToUid ? state.users.find(x => x.uid === t.assignedToUid) : null;
    const doc = { ...t, completed: false, completedAt: null, createdBy: u.uid, createdByEmail: u.email || '', assignedToUid: t.assignedToUid || null, assignedToEmail: assignee ? assignee.email : null, createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() };
    const ref = await db.collection('tasks').add(doc);
    fb.log('create', 'task', ref.id, { name: t.name, goalId: t.goalId });
    fb.syncProgress(t.goalId);
    if (doc.assignedToEmail && doc.assignedToUid !== u.uid) fb.mail([doc.assignedToEmail], 'تم تعيين مهمة لك', `<h3>مهمة جديدة</h3><p><strong>${t.name}</strong></p>${t.dueDate ? `<p>الموعد: ${t.dueDate}</p>` : ''}`);
    return ref.id;
  },
  async updateTask(id, patch) {
    if (patch.assignedToUid !== undefined) { const a = state.users.find(x => x.uid === patch.assignedToUid); patch.assignedToEmail = a ? a.email : null; }
    await db.collection('tasks').doc(id).update({ ...patch, updatedAt: FV.serverTimestamp() });
    fb.log('update', 'task', id, patch);
    const t = state.tasks.find(x => x.id === id);
    if (t) fb.syncProgress(patch.goalId || t.goalId);
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
      }
    }
  },
  async deleteTask(id) {
    const t = state.tasks.find(x => x.id === id);
    await db.collection('tasks').doc(id).delete();
    fb.log('delete', 'task', id, { goalId: t && t.goalId });
    if (t) fb.syncProgress(t.goalId);
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
    const users = [{ uid: me, email: 'me@demo.app', role: 'admin', displayName: 'أنا (تجريبي)' }, { uid: other, email: 'sara@demo.app', role: 'user', displayName: 'سارة' }, { uid: 'demo-omar', email: 'omar@demo.app', role: 'user', displayName: 'عمر' }];
    const activity = [];
    return { users, goals, tasks, activity };
  },
  init(onUser) {
    demo.load();
    const me = demo.data.users[0];
    state.user = { uid: me.uid, email: me.email, displayName: me.displayName };
    state.profile = me; state.isAdmin = true;
    state.users = demo.data.users;
    demo.refresh();
    onUser(state.user);
  },
  refresh() { state.goals = [...demo.data.goals].sort((a, b) => b.createdAt - a.createdAt); state.tasks = [...demo.data.tasks]; state.loading = false; notify('goals'); notify('tasks'); },
  attach() { demo.refresh(); },
  async loadUsers() { state.users = demo.data.users; notify('users'); return state.users; },
  async loadActivity() { state.activity = [...demo.data.activity].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100); notify('activity'); return state.activity; },
  async signOut() { state.demo = false; localStorage.removeItem('goals.demoOn'); location.hash = ''; location.reload(); },
  async createGoal(g) { const u = state.user; const doc = { id: uid(), ...g, progress: 0, createdBy: u.uid, createdByEmail: u.email, createdAt: Date.now(), updatedAt: Date.now(), assignedUserIds: g.assignedUserIds || [u.uid], visibility: g.visibility || 'private', visibilityMode: g.visibilityMode || 'private', blockedUserIds: g.blockedUserIds || [], archived: false }; demo.data.goals.push(doc); demo.log('create', 'goal', doc.id, { name: g.name }); demo.save(); demo.refresh(); return doc.id; },
  async updateGoal(id, patch) { const g = demo.data.goals.find(x => x.id === id); if (g) Object.assign(g, patch, { updatedAt: Date.now() }); demo.log('update', 'goal', id, patch); demo.save(); demo.refresh(); },
  async deleteGoal(id) { demo.data.goals = demo.data.goals.filter(x => x.id !== id); demo.data.tasks = demo.data.tasks.filter(t => t.goalId !== id); demo.log('delete', 'goal', id, {}); demo.save(); demo.refresh(); },
  async createTask(t) { const u = state.user; const a = state.users.find(x => x.uid === t.assignedToUid); const doc = { id: uid(), ...t, completed: false, completedAt: null, createdBy: u.uid, createdByEmail: u.email, assignedToUid: t.assignedToUid || null, assignedToEmail: a ? a.email : null, createdAt: Date.now(), updatedAt: Date.now() }; demo.data.tasks.push(doc); demo.log('create', 'task', doc.id, { name: t.name, goalId: t.goalId }); demo.save(); demo.refresh(); return doc.id; },
  async updateTask(id, patch) { const t = demo.data.tasks.find(x => x.id === id); if (t) { if (patch.assignedToUid !== undefined) { const a = state.users.find(x => x.uid === patch.assignedToUid); patch.assignedToEmail = a ? a.email : null; } Object.assign(t, patch, { updatedAt: Date.now() }); } demo.log('update', 'task', id, patch); demo.save(); demo.refresh(); },
  async toggleTask(id, completed) { const t = demo.data.tasks.find(x => x.id === id); if (t) { t.completed = completed; t.completedAt = completed ? Date.now() : null; t.updatedAt = Date.now(); } demo.log('update', 'task', id, { completed }); demo.save(); demo.refresh(); },
  async deleteTask(id) { demo.data.tasks = demo.data.tasks.filter(x => x.id !== id); demo.log('delete', 'task', id, {}); demo.save(); demo.refresh(); },
  async reorderTasks(ids) { ids.forEach((id, i) => { const t = demo.data.tasks.find(x => x.id === id); if (t) t.order = i; }); demo.save(); demo.refresh(); },
  async setRole(u, role) { const x = demo.data.users.find(y => y.uid === u); if (x) x.role = role; demo.save(); notify('users'); },
  async updateProfile(patch) { Object.assign(demo.data.users[0], patch); state.profile = demo.data.users[0]; demo.save(); notify('profile'); },
  log(actionType, entityType, entityId, payload) { demo.data.activity.push({ id: uid(), actionType, entityType, entityId, payload, actorUid: state.user.uid, actorEmail: state.user.email, createdAt: Date.now() }); },
  resetPassword: async () => {}, signIn: async () => {}, signUp: async () => {}, signInGoogle: async () => {},
};

// ================= واجهة موحّدة =================
export function init(onUser) {
  const demoOn = location.hash.includes('demo') || localStorage.getItem('goals.demoOn') === '1';
  state.demo = demoOn;
  adapter = demoOn ? demo : fb;
  if (demoOn) localStorage.setItem('goals.demoOn', '1');
  adapter.init(onUser);
}
export function enterDemo() { localStorage.setItem('goals.demoOn', '1'); location.hash = 'dashboard'; location.reload(); }
export function resetDemo() { localStorage.removeItem(DEMO_KEY); location.reload(); }

export const api = new Proxy({}, { get: (_, k) => (...a) => adapter[k](...a) });
