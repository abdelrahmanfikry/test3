// الحضور المباشر: من يتصفح المشروع الآن، ومن يكتب في محادثة مهمة (مجموعة presence/{uid}).
import { state } from './store.js';
import { api, isDemo } from './data.js';
import { toMillis } from './utils.js';

const HEARTBEAT = 30000, STALE = 90000, TYPING_STALE = 8000;
let cur = { page: '', projectId: null, taskId: null, typing: null }, lastSent = 0, timer = null, started = false;

function send(force) {
  if (!state.user || isDemo()) return;
  if (!force && Date.now() - lastSent < 5000) return;
  lastSent = Date.now();
  api.setPresence({ ...cur, name: (state.profile && state.profile.displayName) || state.user.displayName || state.user.email || '' }).catch(() => {});
}

export function setPresence(patch) {
  const next = { ...cur, ...patch };
  const changed = JSON.stringify(next) !== JSON.stringify(cur);
  cur = next;
  if (changed) send(true);
}
export function setTyping(taskId) { if (cur.typing !== taskId) { cur.typing = taskId; send(true); } }

export function startPresence() {
  if (started || isDemo()) return; started = true;
  timer = setInterval(() => { if (document.visibilityState === 'visible') send(true); }, HEARTBEAT);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') send(true); });
  window.addEventListener('pagehide', () => { try { api.clearPresence(); } catch { /* ignore */ } });
}
export function stopPresence() { clearInterval(timer); started = false; }

function live(p) { return Date.now() - toMillis(p.at) < STALE; }
/** المستخدمون الذين يتصفحون المشروع الآن (عدا أنا) */
export function viewers(projectId) { const me = state.user && state.user.uid; return (state.presence || []).filter(p => p.uid !== me && p.projectId === projectId && live(p)); }
/** من يكتب الآن في محادثة المهمة */
export function typers(taskId) { const me = state.user && state.user.uid; return (state.presence || []).filter(p => p.uid !== me && p.typing === taskId && Date.now() - toMillis(p.at) < TYPING_STALE); }
/** المتصلون الآن (أي صفحة) */
export function onlineNow() { return (state.presence || []).filter(live).map(p => p.uid); }
