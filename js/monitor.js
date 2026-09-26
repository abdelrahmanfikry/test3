// مراقبة الأخطاء: تلتقط أي خطأ غير معالج عند المستخدمين وتحفظه محلياً وفي Firestore (clientErrors) ليراه المشرف،
// مع دعم اختياري لـ Sentry عبر SENTRY_DSN.
import { state } from './store.js';
import { loadScript } from './lib.js';

/** ضع DSN من Sentry هنا لتفعيل الإرسال إليه (اختياري). */
export const SENTRY_DSN = '';
const KEY = 'goals.errors';
const MAX = 30;
let adapterRef = null, sent = 0, lastSig = '', sentryReady = false;

export function recentErrors() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
export function clearErrors() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

function record(entry) {
  const sig = `${entry.message}|${entry.source}`;
  if (sig === lastSig) return; lastSig = sig; setTimeout(() => { lastSig = ''; }, 5000);
  const list = recentErrors(); list.unshift(entry);
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* ignore */ }
  document.dispatchEvent(new CustomEvent('goals:error', { detail: entry }));
  if (adapterRef && state.user && !state.demo && sent < 20 && navigator.onLine) { sent++; adapterRef.reportError(entry).catch(() => {}); }
  if (sentryReady && window.Sentry) { try { window.Sentry.captureMessage(`${entry.message} @ ${entry.source}`, 'error'); } catch { /* ignore */ } }
}

function entryFrom(message, source, stack) {
  return { message: String(message || 'خطأ غير معروف').slice(0, 300), source: String(source || '').replace(location.origin, '').slice(0, 200), stack: String(stack || '').slice(0, 1200), at: Date.now(), page: location.hash.slice(0, 80), ua: navigator.userAgent.slice(0, 120), version: document.querySelector('meta[name="app-version"]')?.content || '', uid: state.user ? state.user.uid : null, online: navigator.onLine };
}

/** يبدأ الالتقاط. adapter: كائن فيه reportError(entry) (Firebase) أو null */
export function initMonitor(adapter) {
  adapterRef = adapter || null;
  window.addEventListener('error', (e) => {
    if (e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK' || e.target.tagName === 'IMG')) { record(entryFrom(`تعذّر تحميل ${e.target.tagName.toLowerCase()}`, e.target.src || e.target.href, '')); return; }
    record(entryFrom(e.message, `${e.filename}:${e.lineno}:${e.colno}`, e.error && e.error.stack));
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason; if (r && r.code === 'permission-denied') { record(entryFrom('Firestore: صلاحيات غير كافية — انشر قواعد Firestore الجديدة', 'firestore', '')); return; }
    record(entryFrom(r && r.message ? r.message : String(r), 'promise', r && r.stack));
  });
  if (SENTRY_DSN) loadScript('https://cdnjs.cloudflare.com/ajax/libs/sentry/7.120.0/bundle.min.js').then(() => { try { window.Sentry.init({ dsn: SENTRY_DSN, release: 'goals@6' }); sentryReady = true; } catch { /* ignore */ } }).catch(() => {});
}

/** HTML لوحة الأخطاء (إعدادات/فريق) */
export function errorsPanelHtml(list, { title = 'تقرير الأخطاء على هذا الجهاز', admin = false } = {}) {
  return `<div class="panel"><div class="panel-head"><h2>🩺 ${title} <small class="hint">${list.length}</small></h2>${!admin && list.length ? '<button class="btn btn-sm" id="errClear">مسح</button>' : ''}</div>
    ${list.length ? `<div class="trash-list">${list.slice(0, 20).map(e => `<div class="trash-row"><span class="c-danger">●</span><div class="trash-main"><strong title="${(e.stack || '').replace(/"/g, '&quot;')}">${String(e.message).replace(/</g, '&lt;')}</strong><div class="hint">${String(e.source).replace(/</g, '&lt;')} · ${e.page || ''} · ${new Date(e.at && e.at.toMillis ? e.at.toMillis() : e.at).toLocaleString('ar-EG')}${admin && e.uid ? ` · ${e.uid.slice(0, 6)}` : ''}${e.ua ? ` · ${/Mobile|Android|iPhone/.test(e.ua) ? '📱' : '💻'}` : ''}</div></div></div>`).join('')}</div>` : '<p class="muted">لا أخطاء مسجّلة 🎉</p>'}
    <p class="hint" style="margin-top:.5rem">${admin ? 'أخطاء واجهة المستخدمين خلال آخر 30 يوماً (مجموعة clientErrors).' : 'تُلتقط الأخطاء غير المتوقعة تلقائياً وتُرسل للمشرف لتشخيصها.'}</p></div>`;
}
