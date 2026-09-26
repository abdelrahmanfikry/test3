// Cloud Functions اختيارية (تحتاج خطة Blaze): إشعارات Push عبر FCM + ملخص أسبوعي بالبريد.
// النشر: cd functions && npm install && npx firebase deploy --only functions
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const APP_URL = 'https://abdelrahmanfikry.github.io/test3/';

/** عند إنشاء إشعار جديد في notifications/{id}: إرسال Web Push لكل أجهزة المستلم */
exports.sendPush = functions.region('europe-west1').firestore.document('notifications/{id}').onCreate(async (snap) => {
  const n = snap.data();
  if (!n || !n.to) return null;
  const prof = await db.collection('userProfiles').doc(n.to).get();
  const tokens = (prof.data() || {}).fcmTokens || [];
  if (!tokens.length) return null;
  const link = n.taskId ? `${APP_URL}#task/${n.taskId}` : n.projectId ? `${APP_URL}#project/${n.projectId}` : APP_URL;
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: n.title || 'سجل أهدافي', body: `${n.byName ? n.byName + ': ' : ''}${n.body || ''}` },
    webpush: { fcmOptions: { link }, notification: { icon: `${APP_URL}icons/icon-192.png`, dir: 'rtl', lang: 'ar', tag: snap.id } },
    data: { taskId: n.taskId || '', projectId: n.projectId || '', type: n.type || '' },
  });
  // تنظيف الرموز المنتهية
  const bad = [];
  res.responses.forEach((r, i) => { if (!r.success && /registration-token-not-registered|invalid-argument/.test((r.error && r.error.code) || '')) bad.push(tokens[i]); });
  if (bad.length) await prof.ref.update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...bad) });
  return null;
});

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysFromToday(iso, today) { return Math.round((new Date(iso + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000); }

/** كل سبت 8 صباحاً (توقيت القاهرة): ملخص أسبوعي لكل مستخدم فعّل الخيار في بروفايله (weeklyDigest: true) */
exports.weeklyDigest = functions.region('europe-west1').pubsub.schedule('0 8 * * 6').timeZone('Africa/Cairo').onRun(async () => {
  const [users, goals, tasks] = await Promise.all([db.collection('userProfiles').get(), db.collection('goals').get(), db.collection('tasks').get()]);
  const G = new Map(goals.docs.filter(d => !d.data().deleted && !d.data().archived).map(d => [d.id, d.data()]));
  const T = tasks.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => !t.deleted && G.has(t.goalId));
  const today = isoDate(new Date()); const weekAgo = Date.now() - 7 * 86400000; const until = isoDate(new Date(Date.now() + 7 * 86400000));
  const ms = (v) => (v && v.toMillis ? v.toMillis() : typeof v === 'number' ? v : 0);
  const batch = [];
  for (const u of users.docs) {
    const p = u.data(); if (!p.weeklyDigest || !p.email) continue;
    const mine = T.filter(t => t.assignedToUid === u.id || (t.assignedUserIds || []).includes(u.id));
    const done = mine.filter(t => t.completed && ms(t.completedAt || t.updatedAt) >= weekAgo);
    const open = mine.filter(t => !t.completed);
    const late = open.filter(t => t.dueDate && t.dueDate < today);
    const next = open.filter(t => t.dueDate && t.dueDate >= today && t.dueDate <= until);
    const li = (list) => list.slice(0, 12).map(t => `<li><strong>${t.name}</strong> <span style="color:#64748b">— ${(G.get(t.goalId) || {}).name || ''}${t.dueDate ? ' · ' + t.dueDate : ''}</span></li>`).join('');
    const html = `<div style="font-family:Tahoma,Arial,sans-serif;direction:rtl"><h2>ملخصك الأسبوعي 👋 ${p.displayName || ''}</h2><p>✅ أُنجزت: <b>${done.length}</b> · ⚠️ متأخرة: <b>${late.length}</b> · 📅 القادم: <b>${next.length}</b></p>${done.length ? `<h3>أنجزت</h3><ul>${li(done)}</ul>` : ''}${late.length ? `<h3 style="color:#dc2626">متأخرة</h3><ul>${li(late)}</ul>` : ''}${next.length ? `<h3>القادم خلال 7 أيام</h3><ul>${li(next)}</ul>` : ''}<p style="color:#64748b;font-size:12px"><a href="${APP_URL}">افتح سجل أهدافي</a></p></div>`;
    batch.push(db.collection('mail').add({ to: p.email, message: { subject: `ملخصك الأسبوعي: ${done.length} منجزة · ${late.length} متأخرة · ${next.length} قادمة`, html } }));
  }
  await Promise.all(batch);
  return null;
});

/** تذكير يومي 9 صباحاً بالمهام المستحقة اليوم والمتأخرة (إشعار في المجموعة → Push عبر sendPush) */
exports.dailyReminders = functions.region('europe-west1').pubsub.schedule('0 9 * * *').timeZone('Africa/Cairo').onRun(async () => {
  const [users, tasks] = await Promise.all([db.collection('userProfiles').get(), db.collection('tasks').where('completed', '==', false).get()]);
  const today = isoDate(new Date());
  const T = tasks.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => !t.deleted && t.dueDate && t.dueDate <= today);
  const writes = [];
  for (const u of users.docs) {
    const mine = T.filter(t => t.assignedToUid === u.id || (t.assignedUserIds || []).includes(u.id));
    if (!mine.length) continue;
    const late = mine.filter(t => t.dueDate < today).length, due = mine.length - late;
    writes.push(db.collection('notifications').add({ to: u.id, type: 'due', title: 'مهامك اليوم', body: `${due ? `${due} مستحقة اليوم` : ''}${due && late ? ' · ' : ''}${late ? `${late} متأخرة` : ''}`, read: false, createdAt: admin.firestore.FieldValue.serverTimestamp() }));
  }
  await Promise.all(writes);
  return null;
});
