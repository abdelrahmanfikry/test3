// اختبار دخان للواجهة بمتصفح آلي (Playwright): يشغّل خادماً ثابتاً، يفتح الوضع التجريبي، يزور كل الصفحات
// ويتأكد من عدم وجود أخطاء في الـ console ومن ظهور العناصر الأساسية. التشغيل: npm run test:ui
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let chromium;
try { ({ chromium } = await import('playwright')); } catch { console.log('⚠ playwright غير مثبّت — تخطّي اختبار الواجهة (npm i -D playwright && npx playwright install chromium)'); server.close(); process.exit(0); }

// نجرّب Edge ثم Chrome المثبّتين (بعض أجهزة Windows تمنع كروميوم المحمّل من الشبكة) ثم كروميوم المرفق؛ PW_CHANNEL يفرض قناة
let browser = null;
for (const channel of [...new Set([process.env.PW_CHANNEL, 'msedge', 'chrome'].filter(Boolean)), undefined]) {
  try { browser = await chromium.launch(channel ? { channel } : {}); console.log('▶ المتصفح:', channel || 'chromium'); break; } catch { /* جرّب التالي */ }
}
if (!browser) { console.log('✖ تعذّر تشغيل أي متصفح'); server.close(); process.exit(1); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (name, ok) => { if (!ok) failures.push(name); console.log(`${ok ? '✔' : '✖'} ${name}`); };

await page.goto(base + '#demo', { waitUntil: 'networkidle' });
await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
await page.evaluate(() => { const m = document.getElementById('whatsNewModal'); if (m && !m.hidden) { m.hidden = true; document.body.classList.remove('modal-open'); } });
check('الوضع التجريبي يفتح ولوحة التحكم تظهر', await page.locator('.kpi').count() >= 6);
check('الشريط العلوي بمظهر Odoo', await page.locator('.o-menu > a').count() === 5);

const pages = [['goals', '.goal-card'], ['tasks', '.task'], ['calendar', '.cal-cell'], ['reports', '.kpi'], ['activities', '#view'], ['activity', '#view'], ['team', '#teamTable'], ['trash', '#view'], ['settings', '#setTheme'], ['project/g1/overview', '.pp-head'], ['project/g1/kanban', '.kcard'], ['project/g1/gantt', '.g-bar'], ['project/g1/settings', '#stageList']];
for (const [hash, sel] of pages) {
  await page.evaluate(h => { location.hash = h; }, hash);
  try { await page.waitForSelector(sel, { timeout: 8000 }); check(`صفحة ${hash}`, true); } catch { check(`صفحة ${hash}`, false); }
}
// تفاعلات أساسية
await page.evaluate(() => { location.hash = 'tasks'; });
await page.waitForSelector('#quickAddName');
await page.fill('#quickAddName', 'مهمة من اختبار الواجهة غداً !عالي');
await page.press('#quickAddName', 'Enter');
await page.waitForTimeout(400);
check('الإضافة السريعة تنشئ مهمة', await page.locator('.task-title', { hasText: 'مهمة من اختبار الواجهة' }).count() === 1);
await page.locator('.task-title', { hasText: 'مهمة من اختبار الواجهة' }).first().click();
await page.waitForSelector('#tpName');
check('بطاقة المهمة تفتح بالاسم الصحيح', (await page.inputValue('#tpName')).includes('مهمة من اختبار الواجهة'));
await page.keyboard.press('Escape');
await page.keyboard.press('Control+k');
await page.waitForSelector('#searchInput');
await page.fill('#searchInput', 'تركيز');
await page.waitForTimeout(150);
check('لوحة الأوامر تجد «وضع التركيز»', (await page.locator('#searchResults .sr').first().textContent()).includes('التركيز'));
await page.keyboard.press('Escape');
await page.click('#inboxBtn');
check('مركز الإشعارات يفتح', await page.locator('#inboxPanel:not([hidden])').count() === 1);
await page.click('#todayBtn');
check('وضع الاجتماع يفتح', await page.locator('.today-mode:not([hidden])').count() === 1);
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 390, height: 800 });
await page.evaluate(() => { location.hash = 'dashboard'; });
await page.waitForTimeout(400);
const ov = await page.evaluate(() => { const vw = window.innerWidth; return { ok: document.documentElement.scrollWidth <= vw + 1, bad: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !el.closest('.sidebar') && getComputedStyle(el).position !== 'fixed'; }).slice(0, 6).map(el => el.tagName.toLowerCase() + '#' + el.id + '.' + [...el.classList].join('.') + ' L' + Math.round(el.getBoundingClientRect().left) + ' R' + Math.round(el.getBoundingClientRect().right)) }; });
check('لا تمرير أفقي على الموبايل', ov.ok); if (!ov.ok) console.log('   يتجاوز العرض:', ov.bad.join(' | '));

check('لا أخطاء في الـ console', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));
await browser.close(); server.close();
if (failures.length) { console.log(`\n✖ فشل ${failures.length} فحص`); process.exit(1); }
console.log('\n✔ اختبار الواجهة نجح');
