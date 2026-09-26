// الصفحة العامة للقراءة فقط (share.html?t=TOKEN): تقرأ لقطة المشروع من shares/{token} بدون حساب.
import { esc, fmtDate, relativeDue, daysFromToday, PRIORITIES } from './utils.js';

const CONFIG = { apiKey: 'AIzaSyBj9dkTsf22p4GpLrVzZr1qdC2UFWoCi2Q', authDomain: 'to-do-aeb49.firebaseapp.com', projectId: 'to-do-aeb49' };
const $ = (id) => document.getElementById(id);

function ring(pct, color) { const size = 64, r = 29, c = 2 * Math.PI * r; return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="32" cy="32" r="${r}" class="ring-bg"/><circle cx="32" cy="32" r="${r}" class="ring-fg" style="stroke:${color};stroke-dasharray:${c};stroke-dashoffset:${c * (1 - pct / 100)}"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle">${pct}%</text></svg>`; }

function render(s) {
  const g = s.goal, tasks = (s.tasks || []).filter(t => !t.parentId);
  const done = tasks.filter(t => t.completed).length, pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const late = tasks.filter(t => !t.completed && t.dueDate && daysFromToday(t.dueDate) < 0).length;
  const stages = g.stages && g.stages.length ? g.stages : [{ id: 'open', name: 'مفتوحة', color: '#64748b', done: false }, { id: 'done', name: 'منجزة', color: '#16a34a', done: true }];
  const stageOf = (t) => stages.find(x => x.id === t.stageId) || (t.completed ? stages.find(x => x.done) || stages[stages.length - 1] : stages[0]);
  const tags = g.tags || [];
  document.title = `${g.name} — سجل أهدافي`;
  $('shareInfo').textContent = `· آخر تحديث ${s.updatedAt ? new Date(s.updatedAt).toLocaleString('ar-EG') : ''}${s.ownerName ? ' · شاركه ' + s.ownerName : ''}`;
  $('shareBody').innerHTML = `
    <div class="pp-head" style="--gc:${g.color || '#2563eb'}">
      <div class="pp-title"><span class="goal-dot"></span><h1>${esc(g.name)}</h1></div>
      <div class="pp-meta"><span class="hint">${fmtDate(g.startDate)} → ${fmtDate(g.endDate)}</span>${g.endDate ? `<span class="hint">${relativeDue(g.endDate)}</span>` : ''}</div>
      <div class="pp-progress"><div class="progress"><div class="progress-bar" style="width:${pct}%;background:var(--gc)"></div></div><span>${pct}% · ${done}/${tasks.length} مهمة</span></div>
    </div>
    <div class="kpis">
      <div class="kpi"><span class="kpi-label">المهام</span><span class="kpi-value">${tasks.length}</span></div>
      <div class="kpi"><span class="kpi-label">منجزة</span><span class="kpi-value c-ok">${done}</span></div>
      <div class="kpi"><span class="kpi-label">مفتوحة</span><span class="kpi-value">${tasks.length - done}</span></div>
      <div class="kpi"><span class="kpi-label">متأخرة</span><span class="kpi-value ${late ? 'c-danger' : ''}">${late}</span></div>
      <div class="kpi"><span class="kpi-label">المعالم</span><span class="kpi-value">${(g.milestones || []).filter(m => m.done).length}<small>/${(g.milestones || []).length}</small></span></div>
    </div>
    ${g.note ? `<div class="panel"><h2>الوصف</h2><p class="muted">${esc(g.note)}</p></div>` : ''}
    <div class="panel"><h2>المهام حسب المرحلة</h2><div class="ro-kanban">${stages.map(st => { const list = tasks.filter(t => stageOf(t).id === st.id); return `<div class="ro-col"><h3><i style="background:${st.color}"></i>${esc(st.name)}<small>${list.length}</small></h3>${list.map(t => `<div class="ro-card ${t.completed ? 'done' : ''}"><strong>${esc(t.name)}</strong><div class="meta"><span class="badge ${PRIORITIES[t.priority || 'medium'].cls}">${PRIORITIES[t.priority || 'medium'].label}</span>${t.dueDate ? `<span class="${!t.completed && daysFromToday(t.dueDate) < 0 ? 'c-danger' : ''}">${relativeDue(t.dueDate)}</span>` : ''}${t.assigneeName ? `<span>👤 ${esc(t.assigneeName)}</span>` : ''}${(t.tags || []).map(id => tags.find(x => x.id === id)).filter(Boolean).map(x => `<span class="tag" style="--tc:${x.color}">${esc(x.name)}</span>`).join('')}</div></div>`).join('') || '<p class="hint">—</p>'}</div>`; }).join('')}</div></div>
    ${(g.milestones || []).length ? `<div class="panel"><h2>المعالم</h2>${(g.milestones || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(m => `<div class="ms ${m.done ? 'done' : ''} ${!m.done && m.date && daysFromToday(m.date) < 0 ? 'late' : ''}"><span class="ms-ico">◆</span><div><strong>${esc(m.name)}</strong><div class="hint">${m.date ? fmtDate(m.date) + ' · ' + relativeDue(m.date) : ''}</div></div></div>`).join('')}</div>` : ''}
    <p class="hint" style="text-align:center">هذه لقطة للقراءة فقط شاركها صاحب المشروع. <a href="./">افتح سجل أهدافي</a></p>`;
}

async function main() {
  const token = new URLSearchParams(location.search).get('t');
  const fail = (msg) => { $('shareBody').innerHTML = `<div class="empty"><h3>${msg}</h3><p><a class="btn" href="./">الذهاب إلى التطبيق</a></p></div>`; };
  if (!token) return fail('الرابط غير مكتمل');
  if (typeof window.firebase === 'undefined') return fail('تعذّر الاتصال بالخدمة');
  try {
    if (!window.firebase.apps.length) window.firebase.initializeApp(CONFIG);
    const snap = await window.firebase.firestore().collection('shares').doc(token).get();
    if (!snap.exists) return fail('هذا الرابط غير موجود أو أُلغيت مشاركته');
    const s = snap.data();
    if (s.expiresAt && Date.now() > s.expiresAt) return fail('انتهت صلاحية هذا الرابط');
    render(s);
  } catch (e) { console.error(e); fail('تعذّر تحميل المشروع — تأكد من نشر قواعد Firestore الجديدة'); }
}
main();
