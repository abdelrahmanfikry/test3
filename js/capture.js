// إدخال المهام بالصوت (Web Speech API) أو من صورة (Claude vision).
import { toast } from './ui.js';
import { hasAI, tasksFromImage, runActions } from './ai.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export function voiceSupported() { return !!SR; }

/** زر ميكروفون يملأ حقل إدخال بالنص المنطوق (يُستدعى onResult عند الانتهاء) */
export function voiceButton(input, { onResult, lang = 'ar-EG' } = {}) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'iconbtn voice-btn'; b.title = 'إدخال بالصوت'; b.setAttribute('aria-label', 'إدخال بالصوت');
  b.innerHTML = '<svg class="ic"><use href="#i-mic"/></svg>';
  if (!SR) { b.disabled = true; b.title = 'المتصفح لا يدعم الإدخال الصوتي'; return b; }
  let rec = null;
  b.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = lang; rec.interimResults = true; rec.continuous = false;
    b.classList.add('on');
    let finalText = '';
    rec.onresult = (e) => { let s = ''; for (const r of e.results) s += r[0].transcript; input.value = s; if (e.results[e.results.length - 1].isFinal) finalText = s; };
    rec.onerror = (e) => { if (e.error !== 'aborted') toast(e.error === 'not-allowed' ? 'لم يُسمح باستخدام الميكروفون' : 'تعذّر التعرف على الصوت', { type: 'err' }); };
    rec.onend = () => { b.classList.remove('on'); rec = null; if (finalText && onResult) onResult(finalText.trim()); };
    try { rec.start(); input.focus(); } catch { rec = null; b.classList.remove('on'); }
  };
  return b;
}

/** تصغير الصورة قبل الإرسال */
function shrink(file, max = 1400) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad-image')); };
    img.src = url;
  });
}

/** يفتح منتقي صورة ويستخرج المهام بالذكاء الاصطناعي ثم ينفّذها بعد التأكيد */
export function tasksFromPhoto({ goalId = null } = {}) {
  if (!hasAI()) { toast('أضف مفتاح Claude API من الإعدادات أولاً لاستخراج المهام من الصور', { ms: 5000 }); location.hash = 'settings'; return; }
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    toast('جارٍ قراءة الصورة…', { ms: 4000 });
    try { const data = await shrink(f); const { text, actions } = await tasksFromImage(data); if (!actions.length) { toast(text || 'لم أجد مهام واضحة في الصورة', { ms: 5000 }); return; } await runActions(actions, { defaultGoalId: goalId }); }
    catch (e) { console.error(e); toast(e.message === 'no-key' ? 'لا يوجد مفتاح API' : 'تعذّر تحليل الصورة', { type: 'err' }); }
  };
  inp.click();
}
