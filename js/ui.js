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
    // а так ещё и можно писать «30 млн» или «30jt».
    // floor — граница правдоподобия: суммы ниже неё почти наверняка набраны
    // в миллионах («50» вместо 50 000 000), поэтому подсказываем и поправляем.
    const shown = fmtMoneyInput(value);
    input = `<input type="text" inputmode="numeric" data-money data-floor="${Number(opts.floor) || 0}"
      name="${name}" value="${esc(shown)}" placeholder="${esc(placeholder)}">
      <span class="money-echo" data-echo-for="${name}"></span>`;
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

/**
 * Что человек действительно изменил в форме.
 * Записывать всю форму целиком нельзя: пока она открыта, запись мог поправить
 * сотрудник или могли добавиться данные с других вкладок — сохранение всей формы
 * вернуло бы им прежние значения. Пишем только тронутые поля.
 */
export function formDiff(el, initial) {
  const now = formData(el);
  const changed = {};
  for (const k of Object.keys(now)) {
    if (!initial || initial[k] !== now[k]) changed[k] = now[k];
  }
  return changed;
}

/** Сумма в поле ввода: 50000000 → «50 000 000». */
export function fmtMoneyInput(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';        // испорченное значение не показываем как «не число»
  return n.toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
}

const floorOf = (input) => Number(input.getAttribute('data-floor')) || 0;

/** Что именно будет сохранено — видно под полем, пока человек печатает. */
function echoMoney(input) {
  const box = input.parentElement && input.parentElement.querySelector(`[data-echo-for="${input.name}"]`);
  if (!box) return;
  const n = parseAmount(input.value);
  const floor = floorOf(input);
  if (n === null) { box.textContent = ''; box.className = 'money-echo'; return; }
  if (floor && n > 0 && n < floor) {
    box.innerHTML = `⚠ будет сохранено <b>${esc(money(n))}</b> — похоже, вы имели в виду
      <b>${esc(money(n * 1e6))}</b>. Поправим при сохранении.`;
    box.className = 'money-echo warn';
    return;
  }
  box.textContent = '= ' + money(n);
  box.className = 'money-echo';
}

/**
 * Аккуратный вид сумм и живая подсказка под полем.
 * Ниже границы правдоподобия сумма домножается на миллион: цена виллы
 * в 50 рупий за месяц не существует, а «50» вместо «50 000 000» набирают постоянно.
 */
export function enhanceMoneyInputs(root) {
  root.querySelectorAll('input[data-money]').forEach((i) => {
    echoMoney(i);
    i.addEventListener('input', () => echoMoney(i));
    i.addEventListener('blur', () => {
      let n = parseAmount(i.value);
      const floor = floorOf(i);
      if (n !== null && floor && n > 0 && n < floor) n = n * 1e6;
      i.value = n === null ? '' : fmtMoneyInput(n);
      echoMoney(i);
    });
  });
}

/**
 * Последняя проверка перед записью: если человек не уходил из поля,
 * blur мог не сработать. Возвращает список поправок, чтобы о них сказать.
 */
export function normalizeMoneyFields(root) {
  const fixed = [];
  root.querySelectorAll('input[data-money]').forEach((i) => {
    const n = parseAmount(i.value);
    const floor = floorOf(i);
    if (n === null || !floor || n <= 0 || n >= floor) return;
    const label = i.closest('label')?.querySelector('span')?.textContent || i.name;
    i.value = fmtMoneyInput(n * 1e6);
    echoMoney(i);
    fixed.push({ label: String(label).replace(/,\s*Rp$/, ''), from: n, to: n * 1e6 });
  });
  return fixed;
}
