// Service worker: ملفات الموقع من الكاش أولاً، والمكتبات شبكة أولاً مع كاش احتياطي.
const VERSION = 'goals-v2.0.0';
const ASSETS = ['./', './index.html', './css/style.css', './js/app.js', './js/views.js', './js/store.js', './js/data.js', './js/ui.js', './js/utils.js', './js/chatbot.js', './manifest.webmanifest', './icons/icon.svg'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== VERSION + '-ext').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then(cached => {
      const net = fetch(req).then(res => { if (res && res.ok) caches.open(VERSION).then(c => c.put(req, res.clone())); return res; }).catch(() => cached);
      return cached || net;
    }));
    return;
  }
  if (/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|gstatic\.com\/firebasejs/.test(url.host + url.pathname)) {
    e.respondWith(fetch(req).then(res => { if (res && res.ok) caches.open(VERSION + '-ext').then(c => c.put(req, res.clone())); return res; }).catch(() => caches.match(req)));
  }
});
