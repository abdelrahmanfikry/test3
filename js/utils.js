// أدوات عامة: تهريب HTML، تواريخ، معرّفات.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** YYYY-MM-DD بالتوقيت المحلي */
export function isoDate(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function addDays(d, n) {
  const x = new Date(d instanceof Date ? d : d + 'T00:00:00');
  x.setDate(x.getDate() + n);
  return x;
}

/** الفرق بالأيام بين تاريخ ISO واليوم (سالب = فات) */
export function daysFromToday(iso) {
  if (!iso) return null;
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const d = new Date(iso + 'T00:00:00');
  return Math.round((d - t0) / 86400000);
}

export function fmtDate(iso, opts) {
  if (!iso) return '';
  try {
    const d = iso instanceof Date ? iso : new Date(String(iso).length === 10 ? iso + 'T00:00:00' : iso);
    return d.toLocaleDateString('ar-EG', opts || { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return ''; }
}

export function fmtDateTime(d) {
  try {
    const x = d && d.toDate ? d.toDate() : d instanceof Date ? d : new Date(d);
    return x.toLocaleString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

/** نص نسبي: اليوم، غداً، متأخرة 3 أيام، باقي 5 أيام */
export function relativeDue(iso) {
  const n = daysFromToday(iso);
  if (n == null) return '';
  if (n === 0) return 'اليوم';
  if (n === 1) return 'غداً';
  if (n === -1) return 'أمس';
  if (n < 0) return `متأخرة ${-n} يوم`;
  if (n <= 7) return `باقي ${n} أيام`;
  return fmtDate(iso);
}

export function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  const n = new Date(ts).getTime();
  return Number.isNaN(n) ? 0 : n;
}

export function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

export function debounce(fn, ms = 250) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const PRIORITIES = { high: { label: 'عالية', cls: 'p-high', order: 0 }, medium: { label: 'متوسطة', cls: 'p-medium', order: 1 }, low: { label: 'منخفضة', cls: 'p-low', order: 2 } };
export const CATEGORIES = { work: 'عمل', study: 'دراسة', health: 'صحة', personal: 'شخصي', finance: 'مال', other: 'أخرى' };
export const GOAL_COLORS = ['#2563eb', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#475569'];

export const QUOTES = [
  'كل يوم صغير يقرّبك لهدفك الكبير.',
  'خطوة واحدة اليوم أفضل من لا شيء غداً.',
  'كل إنجاز، مهما كان صغيراً، يستحق الاحتفال.',
  'طريق النجاح يبدأ من خطة واضحة. ابدأ الآن.',
  'لا تتوقف حتى تفخر بنفسك.',
  'أنت أقوى من التحديات التي تواجهك.',
  'كل مهمة تكملها تبني بها مستقبلك.',
  'الثقة بالنفس تبدأ من الالتزام بخطتك.',
  'لو شعرت بالتعب، تذكّر لماذا بدأت.',
  'أهدافك تستحق كل جهد تبذله اليوم.',
];
