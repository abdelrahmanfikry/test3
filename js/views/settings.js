// الإعدادات: الحساب، التفضيلات، الإشعارات، المساعد، البيانات، القوالب.
import { state, notify, goalTasks, goalProgress, goalStatus, visibleGoals, taskBucket, sortTasks, stats, userLabel, canEditGoal, canEditTask, setPref, isMine, favorites, isFavorite } from '../store.js';
import { api, isDemo, resetDemo } from '../data.js';
import { esc, fmtDate, fmtDateTime, relativeDue, daysFromToday, isoDate, addDays, toMillis, PRIORITIES, CATEGORIES, GOAL_COLORS, QUOTES, groupBy } from '../utils.js';
import { toast, openModal, closeModal, confirmDialog, promptDialog, celebrate, setBusy, copyText } from '../ui.js';
import { ensureSortable, ensureChart } from '../lib.js';
import { bulk, toggleBulk, bulkCheckbox, bindBulk, snoozeMenu, deleteTaskWithUndo, deleteGoalWithUndo } from '../bulk.js';
import { exportJSON, importJSON, exportICS, exportProject, duplicateProject } from '../backup.js';
import { openFocus, sessionsToday } from '../focus.js';
import { workload, rebalanceSuggestions, projectCost, pivot } from '../analytics.js';
import { templatePicker, templatesHtml, bindTemplates } from '../templates.js';
import { voiceButton, tasksFromPhoto } from '../capture.js';
import { hasAI, aiKey, setAiKey, AI_MODEL } from '../ai.js';
import { enablePush, pushEnabled } from '../notify.js';
import { previewDigest } from '../digest.js';
import { stageAutomationPatch, wipStatus } from '../model.js';
import { applyLang } from '../i18n.js';
import { recentErrors, clearErrors, errorsPanelHtml } from '../monitor.js';
import { projectStages, taskStage, stagePatch, completionPatch, subtaskProgress, blockers, checklistProgress, cloneFromTemplate, DEFAULT_STAGES, DEFAULT_PERSONAL_STAGES, myActivities, activityState, ACTIVITY_TYPES, hoursSpent } from '../model.js';
import { openTask, spawnRecurrence } from '../task-panel.js';
import { renderKanban } from '../kanban.js';
import { renderGantt } from '../gantt.js';
import { kanbanCard } from '../project-page.js';
import { $, BUCKETS, STATUS, filters, goalById, avatar, priorityBadge, ring, emptyState, weekStart, heatmapHtml, weekStripHtml, workloadHtml, applyGanttChange, stageMovePatch, parseQuick, renderTaskGroups, taskList, taskRow, bindTaskList, exportCSV } from './shared.js';
// ================= الإعدادات =================
export function renderSettings(el) {
  const p = state.prefs;
  el.innerHTML = `
    <div class="grid-2">
      <div class="stack">
        <div class="panel"><h2>الحساب</h2>
          <div class="who big">${avatar(state.user.uid, 56)}<div><strong>${esc(state.profile?.displayName || state.user.displayName || '')}</strong><div class="hint">${esc(state.user.email)}</div><span class="badge ${state.isAdmin ? 'st-done' : 'cat'}">${state.isAdmin ? 'مشرف' : 'مستخدم'}</span></div></div>
          <label class="field"><span>اسم العرض</span><input type="text" id="setName" maxlength="40" value="${esc(state.profile?.displayName || state.user.displayName || '')}"></label>
          <div class="btn-row"><button class="btn btn-primary btn-sm" id="setNameSave">حفظ</button>${!isDemo() ? `<button class="btn btn-sm" id="setReset">إرسال رابط تغيير كلمة المرور</button>` : ''}</div>
        </div>
        <div class="panel"><h2>التفضيلات</h2>
          <label class="field"><span>الشكل العام</span><select id="setSkin"><option value="odoo" ${(p.skin || 'odoo') === 'odoo' ? 'selected' : ''}>على طريقة Odoo (شريط علوي، لوحة تحكم، نموذج ورقة)</option><option value="classic" ${p.skin === 'classic' ? 'selected' : ''}>كلاسيكي (قائمة جانبية وبطاقات)</option></select></label>
          <label class="field"><span>المظهر</span><select id="setTheme"><option value="auto" ${p.theme === 'auto' ? 'selected' : ''}>تلقائي (حسب الجهاز)</option><option value="light" ${p.theme === 'light' ? 'selected' : ''}>فاتح</option><option value="dark" ${p.theme === 'dark' ? 'selected' : ''}>داكن</option></select></label>
          <label class="field"><span>اللون الرئيسي</span><div class="swatches accent" id="setAccent">${[['blue', '#2563eb'], ['green', '#16a34a'], ['purple', '#7c3aed'], ['orange', '#ea580c'], ['pink', '#db2777'], ['teal', '#0d9488']].map(([k, c]) => `<button type="button" class="swatch ${(p.accent || 'blue') === k ? 'sel' : ''}" data-accent="${k}" style="background:${c}" aria-label="${k}"></button>`).join('')}</div></label>
          <div class="grid-f">
            <label class="field"><span>حجم الخط</span><select id="setFont"><option value="small" ${p.fontSize === 'small' ? 'selected' : ''}>صغير</option><option value="normal" ${!p.fontSize || p.fontSize === 'normal' ? 'selected' : ''}>عادي</option><option value="large" ${p.fontSize === 'large' ? 'selected' : ''}>كبير</option></select></label>
            <label class="field"><span>بداية الأسبوع</span><select id="setWeek"><option value="6" ${Number(p.weekStart) !== 1 ? 'selected' : ''}>السبت</option><option value="1" ${Number(p.weekStart) === 1 ? 'selected' : ''}>الاثنين</option></select></label>
          </div>
          <div class="grid-f">
            <label class="field"><span>الصفحة الافتتاحية</span><select id="setHome">${[['dashboard', 'لوحة التحكم'], ['tasks', 'المهام'], ['goals', 'المشاريع'], ['calendar', 'التقويم']].map(([k, v]) => `<option value="${k}" ${(p.home || 'dashboard') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            <label class="field"><span>جلسة التركيز / الاستراحة (دقائق)</span><div class="grid-f"><input type="number" id="setFocus" min="5" max="120" value="${p.focusMin || 25}"><input type="number" id="setBreak" min="1" max="60" value="${p.breakMin || 5}"></div></label>
          </div>
          <label class="field"><span>اللغة / Language</span><select id="setLang"><option value="ar" ${p.lang !== 'en' ? 'selected' : ''}>العربية</option><option value="en" ${p.lang === 'en' ? 'selected' : ''}>English (القوائم والعناوين الرئيسية)</option></select></label>
          <label class="switch"><input type="checkbox" id="setNotify" ${p.notify ? 'checked' : ''}><span>تنبيهات المتصفح للمهام المستحقة اليوم والمتأخرة</span></label>
          <label class="switch"><input type="checkbox" id="setCompact" ${p.compact ? 'checked' : ''}><span>عرض مكثّف (صفوف أقصر)</span></label>
        </div>
        <div class="panel"><h2>الإشعارات</h2>
          <p class="hint">إشعارات التكليف والتعليقات والإنجاز تصل إلى كل أجهزتك من داخل التطبيق. لإشعارات المتصفح (والتطبيق مغلق عند نشر Cloud Functions) فعّل الإذن.</p>
          <div class="btn-row"><button class="btn btn-sm ${pushEnabled() ? 'btn-ok' : 'btn-primary'}" id="setPush">${pushEnabled() ? '✓ إشعارات المتصفح مفعّلة' : 'تفعيل إشعارات المتصفح'}</button></div>
          <label class="switch" style="margin-top:.6rem"><input type="checkbox" id="setDigest" ${p.weeklyDigest ? 'checked' : ''}><span>ملخص أسبوعي بالبريد (يُرسل تلقائياً مرة كل أسبوع عند فتح التطبيق)</span></label>
          <div class="btn-row"><button class="btn btn-sm" id="setDigestPreview"><svg class="ic"><use href="#i-send"/></svg> معاينة الملخص وإرساله الآن</button></div>
        </div>
        <div class="panel"><h2>المساعد الذكي (Claude)</h2>
          <p class="hint">أضف مفتاح Claude API ليجيب المساعد عن أي سؤال حول بياناتك ويُنشئ مهامًا من نص حر أو من صورة. يُحفظ المفتاح على هذا الجهاز فقط ولا يُرسل إلى أي مكان سوى Anthropic. النموذج: <code>${AI_MODEL}</code>.</p>
          <div class="search"><input type="password" id="setAiKey" placeholder="sk-ant-…" value="${esc(aiKey())}" autocomplete="off"></div>
          <div class="btn-row"><button class="btn btn-primary btn-sm" id="setAiSave">حفظ المفتاح</button>${hasAI() ? '<button class="btn btn-sm btn-danger" id="setAiClear">إزالة</button><span class="hint c-ok">✓ مفعّل</span>' : '<a class="hint" href="https://console.anthropic.com/" target="_blank" rel="noopener">الحصول على مفتاح ↗</a>'}</div>
        </div>
      </div>
      <div class="stack">
        <div class="panel"><h2>اختصارات لوحة المفاتيح</h2><table class="table kbd"><tbody>
          <tr><td><kbd>N</kbd> / <kbd>G</kbd></td><td>مهمة جديدة / مشروع جديد</td></tr><tr><td><kbd>/</kbd> أو <kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>بحث وأوامر</td></tr>
          <tr><td><kbd>F</kbd> / <kbd>I</kbd></td><td>وضع التركيز / الإشعارات</td></tr>
          <tr><td><kbd>1</kbd>…<kbd>6</kbd></td><td>التنقل بين الصفحات</td></tr><tr><td><kbd>?</kbd> / <kbd>Esc</kbd></td><td>كل الاختصارات / إغلاق</td></tr></tbody></table></div>
        <div class="panel"><h2>البيانات</h2><div class="btn-row">
            <button class="btn btn-sm" id="setCsv"><svg class="ic"><use href="#i-download"/></svg> تصدير CSV</button>
            <button class="btn btn-sm" id="setJson"><svg class="ic"><use href="#i-download"/></svg> نسخة احتياطية JSON</button>
            <label class="btn btn-sm"><svg class="ic"><use href="#i-upload"/></svg> استيراد JSON <input type="file" id="setImport" accept="application/json,.json" hidden></label>
            <button class="btn btn-sm" id="setIcs"><svg class="ic"><use href="#i-cal"/></svg> تصدير للتقويم (.ics)</button>
            <a class="btn btn-sm" href="#trash"><svg class="ic"><use href="#i-trash"/></svg> سلة المحذوفات <small>${(state.trash.goals || []).length + (state.trash.tasks || []).length}</small></a>
            ${isDemo() ? `<button class="btn btn-danger btn-sm" id="setDemoReset">إعادة تعيين البيانات التجريبية</button>` : ''}</div>
          <p class="hint" style="margin-top:.6rem">النسخة الاحتياطية تشمل المشاريع والمهام بكل تفاصيلها، ويمكن استيرادها في أي حساب كعناصر جديدة.</p>
          ${!isDemo() ? `<label class="switch"><input type="checkbox" id="setAutoBackup" ${p.autoBackup ? 'checked' : ''}><span>نسخة احتياطية تلقائية أسبوعياً إلى Firebase Storage</span></label><div id="backupList" class="hint"></div>` : ''}
          ${isDemo() ? `<p class="warn">أنت في الوضع التجريبي: البيانات على هذا الجهاز فقط. سجّل الخروج للعودة لشاشة الدخول.</p>` : ''}</div>
        ${templatesHtml()}
        ${errorsPanelHtml(recentErrors())}
        <div class="panel"><h2>عن التطبيق</h2><p class="muted">سجل أهدافي — الإصدار 5.0. مشاريع على طريقة Odoo، مهام، فريق، تقويم، تقارير، إشعارات عبر الأجهزة، حضور مباشر، مشاركة برابط، مساعد ذكي، وضع تركيز، وسلة محذوفات. يعمل بدون إنترنت ويُثبَّت كتطبيق.</p>
          <div class="btn-row"><button class="btn btn-sm" id="setWhatsNew">ما الجديد</button><button class="btn btn-sm" id="setUpdate"><svg class="ic"><use href="#i-history"/></svg> تحديث التطبيق</button><button class="btn btn-danger btn-sm" id="setSignOut"><svg class="ic"><use href="#i-logout"/></svg> تسجيل الخروج</button></div></div>
      </div>
    </div>`;
  $('setAccent').querySelectorAll('[data-accent]').forEach(b => { b.onclick = () => { setPref('accent', b.dataset.accent); $('setAccent').querySelectorAll('.swatch').forEach(x => x.classList.toggle('sel', x === b)); }; });
  $('setFont').onchange = (e) => setPref('fontSize', e.target.value);
  $('setWeek').onchange = (e) => setPref('weekStart', Number(e.target.value));
  $('setHome').onchange = (e) => setPref('home', e.target.value);
  $('setFocus').onchange = (e) => setPref('focusMin', Math.max(5, Math.min(120, Number(e.target.value) || 25)));
  $('setBreak').onchange = (e) => setPref('breakMin', Math.max(1, Math.min(60, Number(e.target.value) || 5)));
  $('setImport').onchange = (e) => { const f = e.target.files[0]; if (f) importJSON(f); e.target.value = ''; };
  $('setLang').onchange = (e) => { setPref('lang', e.target.value); applyLang(); renderSettings(el); toast(e.target.value === 'en' ? 'English mode: menus and main titles are translated; detailed texts stay in Arabic for now.' : 'تم التبديل إلى العربية', { ms: 5000 }); };
  $('setPush').onclick = async () => { if (await enablePush()) renderSettings(el); };
  $('setDigest').onchange = (e) => setPref('weeklyDigest', e.target.checked);
  $('setDigestPreview').onclick = previewDigest;
  $('setAiSave').onclick = () => { setAiKey($('setAiKey').value.trim()); toast(hasAI() ? 'تم حفظ المفتاح — المساعد الذكي مفعّل' : 'أُزيل المفتاح', { type: 'ok' }); renderSettings(el); };
  const ac = $('setAiClear'); if (ac) ac.onclick = () => { setAiKey(''); renderSettings(el); };
  const ab = $('setAutoBackup'); if (ab) { ab.onchange = (e) => { setPref('autoBackup', e.target.checked); if (e.target.checked) import('./backup.js').then(m => m.autoBackup(true)); }; api.listBackups().then(list => { const el2 = $('backupList'); if (el2 && list.length) el2.innerHTML = `آخر النسخ: ${list.slice(-5).reverse().map(b => `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)}</a>`).join(' · ')}`; }).catch(() => {}); }
  bindTemplates(el, () => renderSettings(el));
  const ec = $('errClear'); if (ec) ec.onclick = () => { clearErrors(); renderSettings(el); };
  $('setIcs').onclick = () => exportICS(state.tasks, 'goals');
  $('setWhatsNew').onclick = () => openModal('whatsNewModal');
  $('setUpdate').onclick = async () => { try { if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); for (const r of regs) await r.unregister(); } if (window.caches) { const keys = await caches.keys(); for (const k of keys) await caches.delete(k); } } catch { /* ignore */ } toast('جارٍ إعادة التحميل بأحدث إصدار…'); setTimeout(() => location.reload(), 600); };
  $('setNameSave').onclick = async () => { const v = $('setName').value.trim(); await api.updateProfile({ displayName: v }); toast('تم الحفظ', { type: 'ok' }); };
  const r = $('setReset'); if (r) r.onclick = async () => { try { await api.resetPassword(state.user.email); toast('تم إرسال الرابط إلى بريدك', { type: 'ok' }); } catch { toast('تعذّر الإرسال', { type: 'err' }); } };
  $('setTheme').onchange = (e) => { setPref('theme', e.target.value); };
  $('setSkin').onchange = (e) => { setPref('skin', e.target.value); toast(e.target.value === 'odoo' ? 'تم التبديل إلى مظهر Odoo' : 'تم التبديل إلى المظهر الكلاسيكي', { type: 'ok' }); };
  $('setNotify').onchange = async (e) => {
    if (e.target.checked) { if (!('Notification' in window)) { e.target.checked = false; return; } const perm = await Notification.requestPermission(); if (perm !== 'granted') { e.target.checked = false; toast('المتصفح رفض التنبيهات', { type: 'err' }); return; } }
    setPref('notify', e.target.checked); if (e.target.checked) toast('التنبيهات مفعّلة', { type: 'ok' });
  };
  $('setCompact').onchange = (e) => setPref('compact', e.target.checked);
  $('setCsv').onclick = exportCSV;
  $('setJson').onclick = exportJSON;
  const dr = $('setDemoReset'); if (dr) dr.onclick = async () => { if (await confirmDialog('إعادة البيانات التجريبية لحالتها الأولى؟')) resetDemo(); };
  $('setSignOut').onclick = async () => { if (await confirmDialog('تسجيل الخروج؟', { danger: false, okLabel: 'خروج' })) api.signOut(); };
}
