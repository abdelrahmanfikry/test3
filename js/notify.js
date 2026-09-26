// إشعارات على السيرفر (مجموعة notifications في Firestore) تُقرأ من كل الأجهزة + Web Push عبر FCM.
import { state } from './store.js';
import { api, isDemo, FCM_VAPID_KEY } from './data.js';
import { toMillis, relativeDue } from './utils.js';
import { toast } from './ui.js';
import { loadScript } from './lib.js';

const TYPES = { assigned: ['👤', 'تكليف جديد'], mention: ['💬', 'ذكرك أحدهم'], comment: ['💬', 'تعليق جديد'], done: ['✅', 'أُنجزت مهمة'], stage: ['📌', 'تغيّرت المرحلة'], due: ['📅', 'موعد قريب'], system: ['ℹ️', 'تنبيه'] };
let seenIds = null;

/** عناصر الإشعارات القادمة من السيرفر بصيغة مركز الإشعارات */
export function serverItems() {
  return (state.notifications || []).map(n => ({ key: 'srv:' + n.id, serverId: n.id, type: n.type || 'system', icon: TYPES[n.type] ? TYPES[n.type][0] : 'ℹ️', label: TYPES[n.type] ? TYPES[n.type][1] : 'تنبيه', title: n.title || '', sub: `${n.byName ? n.byName + ' · ' : ''}${n.body || ''}`, taskId: n.taskId || null, projectId: n.projectId || null, tab: n.tab || null, read: !!n.read, at: toMillis(n.createdAt) }));
}

/** يُستدعى عند كل تحديث للمجموعة: يعرض تنبيه متصفح للجديد فقط */
export function onServerNotifications(list) {
  if (seenIds === null) { seenIds = new Set(list.map(n => n.id)); return; }
  const fresh = list.filter(n => !seenIds.has(n.id) && !n.read);
  list.forEach(n => seenIds.add(n.id));
  for (const n of fresh.slice(0, 3)) {
    toast(`${TYPES[n.type] ? TYPES[n.type][0] : '🔔'} ${n.title}`, { ms: 5000 });
    if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(n.title, { body: `${n.byName ? n.byName + ': ' : ''}${n.body || ''}`, icon: 'icons/icon-192.png', tag: n.id }); } catch { /* ignore */ }
    }
  }
}

export async function markRead(id) { try { await api.markNotificationRead(id); } catch { /* ignore */ } }
export async function markAllRead() { try { await api.markAllNotificationsRead(); } catch { /* ignore */ } }

/** تفعيل الإشعارات: إذن المتصفح + رمز FCM (إن كان مفتاح VAPID مضبوطاً) */
export async function enablePush() {
  if (!('Notification' in window)) { toast('المتصفح لا يدعم الإشعارات', { type: 'err' }); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('لم يُمنح إذن الإشعارات', { type: 'err' }); return false; }
  if (isDemo()) { toast('الإشعارات مفعّلة (محلياً في الوضع التجريبي)', { type: 'ok' }); return true; }
  if (!FCM_VAPID_KEY) { toast('إشعارات المتصفح مفعّلة. للإشعارات والتطبيق مغلق أضف مفتاح VAPID في data.js وانشر مجلد functions', { ms: 6000 }); return true; }
  try {
    await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');
    const reg = await navigator.serviceWorker.ready;
    const token = await window.firebase.messaging().getToken({ vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) { await api.registerPushToken(token); toast('تم تفعيل الإشعارات على هذا الجهاز ✅', { type: 'ok' }); return true; }
  } catch (e) { console.warn('fcm', e); toast('تعذّر تسجيل الجهاز للإشعارات', { type: 'err' }); }
  return false;
}

export function pushEnabled() { return 'Notification' in window && Notification.permission === 'granted'; }
export { TYPES as NOTIFY_TYPES, relativeDue };
