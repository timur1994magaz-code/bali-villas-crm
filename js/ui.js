// ===== UI-примитивы: модалки, тосты, лайтбокс, подтверждения =====
import { esc, parseAmount, money } from './util.js';

const root = () => document.getElementById('modal-root');
const stack = [];

export function modal({ title, body, footer = '', size = '', onMount, onClose }) {
  const el = document.createElement('div');
  el.className = 'modal ' + size;
  el.innerHTML = `
    <div class="modal-head"><h3>${esc(title)}</h3><button class="x" data-close>✕</button></div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}`;
  const r = root();
  r.hidden = false;
  r.innerHTML = '';
  r.appendChild(el);
  stack.push({ el, onClose });
  el.querySelector('[data-close]').onclick = () => closeModal();
  r.onclick = (e) => { if (e.target === r) closeModal(); };
  document.addEventListener('keydown', escHandler);
  enhanceMoneyInputs(el);
  if (onMount) onMount(el);
  const focusable = el.querySelector('input,select,textarea');
  if (focusable) setTimeout(() => focusable.focus(), 30);
  return el;
}
function escHandler(e) {
  if (e.key === 'Escape') {
    const lb = document.getElementById('lightbox');
    if (!lb.hidden) { lb.hidden = true; return; }
    closeModal();
  }
}
export function closeModal() {
  const top = stack.pop();
  const r = root();
  r.innerHTML = '';
  r.hidden = true;
  document.removeEventListener('keydown', escHandler);
  if (top && top.onClose) top.onClose();
}

export function confirmDialog(text, { title = 'Подтвердите', okText = 'Удалить', danger = true } = {}) {
  return new Promise((resolve) => {
    modal({
      title, size: 'narrow',
      body: `<div>${esc(text)}</div>`,
      footer: `<button class="btn" data-no>Отмена</button>
              <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(okText)}</button>`,
      onMount(el) {
        el.querySelector('[data-no]').onclick = () => { closeModal(); resolve(false); };
        el.querySelector('[data-yes]').onclick = () => { closeModal(); resolve(true); };
      },
    });
  });
}

export function toast(msg, isErr = false) {
  const wrap = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

// ===== Лайтбокс для фото =====
// items: [{ url, name, caption }] — ссылки уже разрешены вызывающей стороной
let lbItems = [], lbIdx = 0;
export function openLightbox(items, index = 0) {
  lbItems = items || [];
  lbIdx = index;
  if (!lbItems.length) return;
  const lb = document.getElementById('lightbox');
  lb.hidden = false;
  renderLb();
}
function renderLb() {
  if (!lbItems.length) return;
  const f = lbItems[lbIdx];
  document.getElementById('lightbox-img').src = f.url;
  document.getElementById('lightbox-caption').textContent =
    `${lbIdx + 1} / ${lbItems.length} — ${f.caption || f.name || ''}`;
}
document.addEventListener('DOMContentLoaded', () => {
  const lb = document.getElementById('lightbox');
  lb.addEventListener('click', (e) => {
    const act = e.target.dataset.lb;
    if (act === 'close' || e.target === lb) { lb.hidden = true; return; }
    if (act === 'prev') { lbIdx = (lbIdx - 1 + lbItems.length) % lbItems.length; renderLb(); }
    if (act === 'next') { lbIdx = (lbIdx + 1) % lbItems.length; renderLb(); }
  });
  document.addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'ArrowLeft') { lbIdx = (lbIdx - 1 + lbItems.length) % lbItems.length; renderLb(); }
    if (e.key === 'ArrowRight') { lbIdx = (lbIdx + 1) % lbItems.length; renderLb(); }
  });
});

// ===== Хелперы форм =====
export function field(name, label, opts = {}) {
  const { type = 'text', value = '', placeholder = '', options, rows, required, step, hint } = opts;
  let input;
  if (type === 'money') {
    // не «число»: колесо мыши над числовым полем незаметно меняет сумму,
    // а так ещё и можно писать «30 млн» или «30jt»
    const shown = value === '' || value === null || value === undefined
      ? '' : Number(value).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
    input = `<input type="text" inputmode="numeric" data-money name="${name}" value="${esc(shown)}" placeholder="${esc(placeholder)}">`;
  } else if (options) {
    input = `<select name="${name}">${options.map((o) => {
      const v = typeof o === 'string' ? o : o.value;
      const l = typeof o === 'string' ? o : o.label;
      return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`;
    }).join('')}</select>`;
  } else if (type === 'textarea') {
    input = `<textarea name="${name}" rows="${rows || 3}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
  } else {
    input = `<input type="${type}" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}"${required ? ' required' : ''}${step ? ` step="${step}"` : ''}>`;
  }
  return `<label class="field"><span>${esc(label)}</span>${input}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>`;
}
export function formData(el) {
  const out = {};
  el.querySelectorAll('input[name],select[name],textarea[name]').forEach((i) => {
    if (i.type === 'checkbox') { out[i.name] = i.checked; return; }
    if (i.hasAttribute('data-money')) {
      const n = parseAmount(i.value);
      out[i.name] = n === null ? '' : String(n);
      return;
    }
    out[i.name] = i.value.trim();
  });
  return out;
}

/** Аккуратный вид сумм при потере фокуса: 30 млн → 30 000 000. */
export function enhanceMoneyInputs(root) {
  root.querySelectorAll('input[data-money]').forEach((i) => {
    i.addEventListener('blur', () => {
      const n = parseAmount(i.value);
      i.value = n === null ? '' : n.toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
    });
  });
  void money;
}
