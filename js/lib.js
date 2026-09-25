// تحميل المكتبات الخارجية عند الحاجة فقط (Sortable، Chart.js، Firebase Storage) لتسريع أول تحميل.
const pending = {};

export function loadScript(src) {
  if (!pending[src]) {
    pending[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { delete pending[src]; reject(new Error('تعذّر تحميل ' + src)); };
      document.head.appendChild(s);
    });
  }
  return pending[src];
}

const URLS = {
  sortable: 'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.0/Sortable.min.js',
  chart: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  storage: 'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage-compat.js',
};

export function ensureSortable() { return window.Sortable ? Promise.resolve(window.Sortable) : loadScript(URLS.sortable).then(() => window.Sortable); }
export function ensureChart() { return window.Chart ? Promise.resolve(window.Chart) : loadScript(URLS.chart).then(() => window.Chart); }
export function ensureStorage() { return (window.firebase && window.firebase.storage) ? Promise.resolve() : loadScript(URLS.storage); }

/** تحميل مسبق هادئ بعد استقرار الصفحة (لا يعطّل التفاعل) */
export function prefetchLibs() {
  const run = () => { loadScript(URLS.sortable).catch(() => {}); };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 2500);
}
