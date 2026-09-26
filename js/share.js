// مشاركة مشروع برابط للقراءة فقط: لقطة في shares/{token} تُقرأ من share.html بدون حساب.
import { state, goalTasks, userLabel } from './store.js';
import { api, isDemo } from './data.js';
import { esc, uid } from './utils.js';
import { toast, confirmDialog, copyText, openModal } from './ui.js';

function snapshot(g) {
  const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (v && typeof v === 'object' && (v.seconds != null || v.toMillis)) ? (v.toMillis ? v.toMillis() : v.seconds * 1000) : v));
  return {
    goalId: g.id, createdBy: state.user.uid, ownerName: (state.profile && state.profile.displayName) || state.user.email || '', updatedAt: Date.now(),
    goal: strip({ name: g.name, note: g.note || '', color: g.color || '#2563eb', startDate: g.startDate, endDate: g.endDate, stages: g.stages || [], milestones: g.milestones || [], tags: g.tags || [] }),
    tasks: goalTasks(g.id).map(t => strip({ name: t.name, stageId: t.stageId || null, completed: !!t.completed, dueDate: t.dueDate || null, startDate: t.startDate || null, priority: t.priority || 'medium', tags: t.tags || [], plannedHours: t.plannedHours || 0, parentId: t.parentId || null, assigneeName: t.assignedToUid ? userLabel(t.assignedToUid) : '' })),
  };
}

export function shareUrl(token) { return `${location.origin}${location.pathname.replace(/index\.html$/, '')}share.html?t=${token}`; }

/** ينشئ (أو يحدّث) رابط المشاركة ويعرضه */
export async function shareProject(g) {
  if (isDemo()) { toast('المشاركة برابط تعمل مع حساب Firebase (ليس في الوضع التجريبي)', { ms: 5000 }); return; }
  const token = g.shareToken || uid() + uid();
  try {
    await api.setShare(token, snapshot(g));
    if (!g.shareToken) await api.updateGoal(g.id, { shareToken: token });
    const url = shareUrl(token);
    const body = document.getElementById('shareLinkBody');
    body.innerHTML = `<h2>رابط للقراءة فقط</h2><p class="hint">أي شخص يملك الرابط يرى لقطة من المشروع (المهام والمراحل والمعالم) بدون حساب. حدّث اللقطة بعد التغييرات أو ألغِ الرابط في أي وقت.</p>
      <div class="search big"><input type="text" readonly value="${esc(url)}" id="shareUrlInput"></div>
      <div class="btn-row"><button class="btn btn-primary btn-sm" id="shareCopy">نسخ الرابط</button><a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener">فتح</a><button class="btn btn-sm" id="shareRefresh">تحديث اللقطة</button><button class="btn btn-sm btn-danger" id="shareRevoke">إلغاء المشاركة</button></div>`;
    openModal('shareLinkModal');
    body.querySelector('#shareCopy').onclick = () => copyText(url, 'تم نسخ الرابط');
    body.querySelector('#shareRefresh').onclick = async () => { await api.setShare(token, snapshot(g)); toast('تم تحديث اللقطة', { type: 'ok' }); };
    body.querySelector('#shareRevoke').onclick = async () => { if (!(await confirmDialog('إلغاء الرابط؟ لن يعمل بعد الآن.', { okLabel: 'إلغاء المشاركة' }))) return; await api.deleteShare(token); await api.updateGoal(g.id, { shareToken: null }); document.getElementById('shareLinkModal').hidden = true; document.body.classList.remove('modal-open'); toast('أُلغيت المشاركة'); };
  } catch (e) { console.error(e); toast('تعذّر إنشاء الرابط — تأكد من نشر قواعد Firestore الجديدة', { type: 'err', ms: 6000 }); }
}
