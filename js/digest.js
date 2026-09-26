// الملخص الأسبوعي: ما أنجزته، ما تأخر، ما القادم، الساعات، السلسلة — معاينة وإرسال بالبريد (Trigger Email).
import { state, stats, taskBucket, sortTasks, isMine, goalTasks } from './store.js';
import { api, isDemo } from './data.js';
import { esc, isoDate, addDays, toMillis, fmtDate, relativeDue } from './utils.js';
import { toast, openModal } from './ui.js';

const KEY = 'goals.digestSent';

export function buildDigest(uidX = state.user.uid) {
  const u = state.users.find(x => x.uid === uidX) || state.profile || {};
  const goals = state.goals.filter(g => !g.archived && !g.template);
  const gid = new Set(goals.map(g => g.id));
  const mine = state.tasks.filter(t => gid.has(t.goalId) && (t.assignedToUid === uidX || (t.assignedUserIds || []).includes(uidX)));
  const weekAgo = Date.now() - 7 * 86400000;
  const done = mine.filter(t => t.completed && toMillis(t.completedAt || t.updatedAt) >= weekAgo);
  const open = mine.filter(t => !t.completed);
  const late = sortTasks(open.filter(t => taskBucket(t) === 'overdue'));
  const next7 = sortTasks(open.filter(t => ['today', 'week'].includes(taskBucket(t))));
  const since = isoDate(addDays(new Date(), -7));
  const hours = Math.round(mine.reduce((a, t) => a + (t.timesheets || []).filter(x => x.uid === uidX && x.date >= since).reduce((b, x) => b + (Number(x.hours) || 0), 0), 0) * 10) / 10;
  const s = uidX === state.user.uid ? stats() : null;
  const pname = (t) => esc((goals.find(g => g.id === t.goalId) || {}).name || '');
  const li = (list, withDue = true) => list.slice(0, 12).map(t => `<li><strong>${esc(t.name)}</strong> <span style="color:#64748b">— ${pname(t)}${withDue && t.dueDate ? ' · ' + esc(relativeDue(t.dueDate)) : ''}</span></li>`).join('') + (list.length > 12 ? `<li>… و${list.length - 12} أخرى</li>` : '');
  const html = `
    <h2 style="margin:0 0 4px">ملخصك الأسبوعي 👋 ${esc(u.displayName || '')}</h2>
    <p style="color:#64748b;margin:0 0 14px">${fmtDate(isoDate(addDays(new Date(), -7)))} → ${fmtDate(isoDate())}</p>
    <table style="border-collapse:collapse;width:100%;max-width:520px;margin-bottom:14px"><tr>
      <td style="padding:10px;background:#dcfce7;border-radius:10px;text-align:center"><div style="font-size:22px;font-weight:800">${done.length}</div><div style="font-size:12px">أُنجزت</div></td><td style="width:8px"></td>
      <td style="padding:10px;background:#fee2e2;border-radius:10px;text-align:center"><div style="font-size:22px;font-weight:800">${late.length}</div><div style="font-size:12px">متأخرة</div></td><td style="width:8px"></td>
      <td style="padding:10px;background:#dbeafe;border-radius:10px;text-align:center"><div style="font-size:22px;font-weight:800">${next7.length}</div><div style="font-size:12px">الأسبوع القادم</div></td><td style="width:8px"></td>
      <td style="padding:10px;background:#fef3c7;border-radius:10px;text-align:center"><div style="font-size:22px;font-weight:800">${hours}</div><div style="font-size:12px">ساعة مسجّلة</div></td>
    </tr></table>
    ${s ? `<p>🔥 سلسلة الإنجاز: <strong>${s.streak}</strong> يوم · نسبة الإنجاز الكلية <strong>${s.rate}%</strong></p>` : ''}
    ${done.length ? `<h3>✅ أنجزت هذا الأسبوع</h3><ul>${li(done, false)}</ul>` : '<p>لم تُنجز مهام هذا الأسبوع — الأسبوع القادم فرصة جديدة 💪</p>'}
    ${late.length ? `<h3 style="color:#dc2626">⚠️ متأخرة تحتاج قرارك</h3><ul>${li(late)}</ul>` : ''}
    ${next7.length ? `<h3>📅 القادم خلال 7 أيام</h3><ul>${li(next7)}</ul>` : ''}
    <p style="color:#64748b;font-size:12px;margin-top:18px">أُرسل من «سجل أهدافي» · <a href="${location.origin}${location.pathname}">افتح التطبيق</a></p>`;
  return { subject: `ملخصك الأسبوعي: ${done.length} منجزة · ${late.length} متأخرة · ${next7.length} قادمة`, html, email: u.email || state.user.email, counts: { done: done.length, late: late.length, next: next7.length, hours } };
}

/** معاينة الملخص في نافذة مع زر إرسال */
export function previewDigest() {
  const d = buildDigest();
  const body = document.getElementById('digestBody');
  body.innerHTML = `<div class="btn-row" style="margin:0 0 .8rem"><button class="btn btn-primary btn-sm" id="digestSend">${isDemo() ? 'إرسال (تجريبي)' : `إرسال إلى ${esc(d.email)}`}</button><span class="hint">يُرسل عبر إضافة Trigger Email في Firebase</span></div><div class="digest-preview" dir="rtl">${d.html}</div>`;
  openModal('digestModal');
  body.querySelector('#digestSend').onclick = async () => { await sendDigest(); };
}

export async function sendDigest(uidX = state.user.uid) {
  const d = buildDigest(uidX);
  try { await api.mail([d.email], d.subject, d.html); toast(isDemo() ? 'في الوضع التجريبي لا يُرسل بريد فعلي — هذه معاينة' : 'تم وضع الملخص في صف الإرسال ✉️', { type: 'ok' }); localStorage.setItem(KEY, weekKey()); }
  catch (e) { console.error(e); toast('تعذّر الإرسال', { type: 'err' }); }
}

function weekKey() { const d = new Date(); const onejan = new Date(d.getFullYear(), 0, 1); return `${d.getFullYear()}-w${Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)}`; }

/** إرسال تلقائي مرة كل أسبوع عند فتح التطبيق (إذا فعّل المستخدم الخيار) */
export function maybeAutoDigest() {
  if (!state.prefs.weeklyDigest || isDemo() || !state.user) return;
  try { if (localStorage.getItem(KEY) === weekKey()) return; } catch { return; }
  if (!state.tasks.length) return;
  setTimeout(() => sendDigest().catch(() => {}), 4000);
}
export { goalTasks, isMine };
