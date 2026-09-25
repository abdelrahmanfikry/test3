// مكوّنات واجهة مشتركة: إشعارات، نوافذ، تأكيد، احتفال.
import { esc } from './utils.js';

const $ = (id) => document.getElementById(id);
let lastFocus = null;

export function toast(msg, { type = '', action, onAction, ms = 3500 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action;
    b.onclick = () => { onAction && onAction(); el.remove(); };
    el.appendChild(b);
  }
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), ms - 300);
  setTimeout(() => el.remove(), ms);
}

export function openModal(id) {
  lastFocus = document.activeElement;
  const m = $(id);
  m.hidden = false;
  document.body.classList.add('modal-open');
  const f = m.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea, button.btn-primary');
  if (f) setTimeout(() => f.focus(), 30);
  m.onkeydown = (e) => {
    if (e.key !== 'Tab') return;
    const els = [...m.querySelectorAll('input, select, textarea, button, a[href]')].filter(x => !x.disabled && !x.hidden && x.offsetParent !== null);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
}

export function closeModal(id) {
  const m = $(id);
  if (!m) return;
  m.hidden = true;
  if (!document.querySelector('.modal-bg:not([hidden])')) {
    document.body.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch { /* ignore */ } }
  }
}

export function closeAllModals() {
  document.querySelectorAll('.modal-bg:not([hidden])').forEach(m => { m.hidden = true; });
  document.body.classList.remove('modal-open');
}

export function confirmDialog(text, { title = 'تأكيد', okLabel = 'تأكيد', danger = true } = {}) {
  return new Promise(resolve => {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    const ok = $('confirmOk');
    ok.textContent = okLabel;
    ok.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    openModal('confirmModal');
    const done = (v) => { closeModal('confirmModal'); ok.onclick = null; $('confirmCancel').onclick = null; resolve(v); };
    ok.onclick = () => done(true);
    $('confirmCancel').onclick = () => done(false);
    setTimeout(() => ok.focus(), 40);
  });
}

export function promptDialog(title, value = '', { type = 'text', placeholder = '' } = {}) {
  return new Promise(resolve => {
    $('promptTitle').textContent = title;
    const input = $('promptInput');
    input.type = type; input.value = value; input.placeholder = placeholder;
    openModal('promptModal');
    setTimeout(() => { input.focus(); input.select(); }, 30);
    const done = (v) => { closeModal('promptModal'); $('promptForm').onsubmit = null; $('promptCancel').onclick = null; resolve(v); };
    $('promptForm').onsubmit = (e) => { e.preventDefault(); done(input.value.trim()); };
    $('promptCancel').onclick = () => done(null);
  });
}

/** قائمة منبثقة عامة بموضع ثابت قرب عنصر: items = [{ label, run, icon?, color?, danger? }] */
export function popMenu(anchor, items, { above = false } = {}) {
  document.querySelectorAll('.popmenu').forEach(m => m.remove());
  const menu = document.createElement('div'); menu.className = 'popmenu';
  menu.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.color ? `<span class="goal-dot" style="background:${it.color}"></span>` : it.icon ? `<svg class="ic"><use href="#i-${it.icon}"/></svg>` : ''}${esc(it.label)}</button>`).join('') || '<span class="hint" style="padding:.4rem .6rem;display:block">لا خيارات</span>';
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect(), rtl = document.documentElement.dir === 'rtl';
  const w = menu.offsetWidth, h = menu.offsetHeight;
  let left = rtl ? r.right - w : r.left; left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = above ? r.top - h - 6 : r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  if (top < 8) top = 8;
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  const close = () => { menu.remove(); document.removeEventListener('click', onDoc, true); document.removeEventListener('keydown', onKey); };
  const onDoc = (e) => { if (!menu.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('click', onDoc, true); document.addEventListener('keydown', onKey); }, 0);
  menu.querySelectorAll('[data-i]').forEach(b => { b.onclick = (e) => { e.stopPropagation(); close(); items[Number(b.dataset.i)].run(); }; });
  return menu;
}

/** نسخ نص إلى الحافظة مع إشعار */
export async function copyText(text, msg = 'تم النسخ') {
  try { await navigator.clipboard.writeText(text); toast(msg, { type: 'ok' }); }
  catch { const i = document.createElement('input'); i.value = text; document.body.appendChild(i); i.select(); try { document.execCommand('copy'); toast(msg, { type: 'ok' }); } catch { toast('تعذّر النسخ', { type: 'err' }); } i.remove(); }
}

/** احتفال خفيف بقصاصات ملوّنة */
export function celebrate(title, text) {
  const wrap = document.createElement('div');
  wrap.className = 'celebrate';
  wrap.innerHTML = `<div class="celebrate-card"><div class="celebrate-emoji">🎉</div><h2>${esc(title)}</h2><p>${esc(text)}</p><button class="btn btn-primary">متابعة</button></div>`;
  for (let i = 0; i < 40; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.setProperty('--x', `${Math.random() * 100}vw`);
    c.style.setProperty('--d', `${1.8 + Math.random() * 1.6}s`);
    c.style.setProperty('--r', `${Math.random() * 720}deg`);
    c.style.setProperty('--c', ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#db2777'][i % 6]);
    c.style.animationDelay = `${Math.random() * 0.6}s`;
    wrap.appendChild(c);
  }
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('button').onclick = close;
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  setTimeout(close, 6000);
}

export function setBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle('busy', busy);
}

export function bindModalBasics() {
  document.querySelectorAll('.modal-bg').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m && !m.dataset.static) closeModal(m.id); });
    m.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => closeModal(m.id); });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });
}
