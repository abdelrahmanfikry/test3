// Service worker: ملفات الموقع من الكاش أولاً (مع تحديث بالخلفية)، والمكتبات شبكة أولاً مع كاش احتياطي.
// عند كل نشر غيّر VERSION ليُحدَّث التطبيق عند كل المستخدمين تلقائياً.
const VERSION = 'goals-v5.0.0';
const ASSETS = ['./', './index.html', './css/style.css', './css/project.css', './css/extras.css',
  './js/app.js', './js/views.js', './js/store.js', './js/data.js', './js/ui.js', './js/utils.js', './js/chatbot.js', './js/model.js', './js/kanban.js', './js/gantt.js', './js/task-panel.js', './js/project-page.js', './js/activities.js',
  './js/lib.js', './js/inbox.js', './js/focus.js', './js/bulk.js', './js/palette.js', './js/trash.js', './js/backup.js', './js/gestures.js',
  './js/analytics.js', './js/notify.js', './js/presence.js', './js/templates.js', './js/digest.js', './js/ai.js', './js/capture.js', './js/today.js', './js/i18n.js', './js/share.js', './share.html', './js/share-page.js',
  './js/analytics.js', './js/notify.js', './js/presence.js', './js/templates.js', './js/digest.js', './js/ai.js', './js/capture.js', './js/today.js', './js/i18n.js', './js/share.js', './share.html', './js/share-page.js',
  './manifest.webmanifest', './icons/icon.svg'];

// Web Push في الخلفية (FCM): يعمل فقط إذا ضُبط مفتاح VAPID في التطبيق وسُجّل الجهاز
try {
  importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');
  firebase.initializeApp({ apiKey: 'AIzaSyBj9dkTsf22p4GpLrVzZr1qdC2UFWoCi2Q', authDomain: 'to-do-aeb49.firebaseapp.com', projectId: 'to-do-aeb49', messagingSenderId: '434009324425', appId: '1:434009324425:web:ed7078ea09ed89c1f17f58' });
  firebase.messaging().onBackgroundMessage((payload) => {
    const n = payload.notification || {}; const d = payload.data || {};
    self.registration.showNotification(n.title || 'سجل أهدافي', { body: n.body || '', icon: './icons/icon-192.png', dir: 'rtl', lang: 'ar', data: { url: d.taskId ? './#task/' + d.taskId : d.projectId ? './#project/' + d.projectId : './' } });
  });
} catch (e) { /* بدون Push */ }
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.location.href).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => { const c = list.find(w => 'focus' in w); if (c) { c.navigate(url); return c.focus(); } return clients.openWindow(url); }));
});

self.addEventListener('install', (e) => {
  // cache:'reload' يتجاوز كاش HTTP في المتصفح حتى لا تُحفظ نسخة قديمة من الملفات
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(ASSETS.map(a => fetch(a, { cache: 'reload' }).then(r => { if (r.ok) return c.put(a, r); }).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== VERSION + '-ext').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(cached => {
      const net = fetch(req).then(res => { if (res && res.ok) caches.open(VERSION).then(c => c.put(req, res.clone())); return res; }).catch(() => cached);
      return cached || net;
    }));
    return;
  }
  if (/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|gstatic\.com\/firebasejs/.test(url.host + url.pathname)) {
    e.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => { if (res && res.ok) caches.open(VERSION + '-ext').then(c => c.put(req, res.clone())); return res; })));
  }
});
