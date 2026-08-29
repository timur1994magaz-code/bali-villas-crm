// ===== Модалки брони: создание/редактирование и карточка брони с контактами клиента =====
import * as S from './store.js';
import { modal, closeModal, field, formData, toast, confirmDialog } from './ui.js';
import { renderDocs } from './files-ui.js';
import {
  esc, STATUS, fmtDate, fmtRange, daysBetween, money, num,
  phoneHref, waHref, tgHref, today, addDays,
} from './util.js';

const statusOptions = Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }));

export function bookingForm(b, { onSaved } = {}) {
  const isNew = !S.booking(b.id);
  const villaOpts = S.state.villas.map((v) => ({ value: v.id, label: v.name }));
  const clientOpts = [{ value: '', label: '— без клиента (блок/ремонт) —' }]
    .concat(S.state.clients.map((c) => ({ value: c.id, label: c.name + (c.phone ? ` · ${c.phone}` : '') })));

  if (!villaOpts.length) { toast('Сначала добавьте хотя бы одну виллу', true); return; }

  modal({
    title: isNew ? 'Новая бронь' : 'Редактировать бронь',
    body: `
      <div class="grid-2">
        ${field('villaId', 'Вилла', { options: villaOpts, value: b.villaId || villaOpts[0].value })}
        ${field('status', 'Статус', { options: statusOptions, value: b.status })}
      </div>
      <div class="grid-2">
        ${field('dateFrom', 'Заезд', { type: 'date', value: b.dateFrom })}
        ${field('dateTo', 'Выезд', { type: 'date', value: b.dateTo, hint: 'День выезда свободен для следующего заезда' })}
      </div>
      <div id="nights-info" class="hint"></div>
      <div class="form-section">
        <h4>Клиент</h4>
        <div class="grid-2">
          ${field('clientId', 'Клиент', { options: clientOpts, value: b.clientId })}
          ${field('guests', 'Гостей', { type: 'number', value: b.guests, placeholder: '2' })}
        </div>
        <div style="margin-top:8px"><button type="button" class="btn btn-sm" data-newclient>+ Создать нового клиента</button></div>
      </div>
      <div class="form-section">
        <h4>Деньги</h4>
        <div class="grid-2">
          ${field('priceTotal', 'Сумма аренды, Rp', { type: 'number', value: b.priceTotal, placeholder: '0' })}
          ${field('prepaid', 'Предоплата, Rp', { type: 'number', value: b.prepaid, placeholder: '0' })}
        </div>
        <div class="grid-2" style="margin-top:10px">
          ${field('source', 'Источник', { value: b.source, placeholder: 'Instagram / Airbnb / друзья' })}
          ${field('cleaningFee', 'Доп. сборы, Rp', { type: 'number', value: b.cleaningFee || '' })}
        </div>
      </div>
      ${field('notes', 'Заметки', { type: 'textarea', value: b.notes, rows: 3 })}
      <div id="conflict" class="hint"></div>`,
    footer: `
      ${isNew ? '' : '<button class="btn btn-danger left" data-del>Удалить бронь</button>'}
      <button class="btn" data-cancel>Отмена</button>
      <button class="btn btn-primary" data-save>Сохранить</button>`,
    onMount(el) {
      const upd = () => {
        const d = formData(el);
        const n = daysBetween(d.dateFrom, d.dateTo);
        const info = el.querySelector('#nights-info');
        info.textContent = n > 0
          ? `${n} ${plural(n, 'ночь', 'ночи', 'ночей')} · ${fmtRange(d.dateFrom, d.dateTo)}`
          : 'Дата выезда должна быть позже даты заезда';
        const test = { ...b, ...d };
        const cf = S.conflicts(test);
        const cbox = el.querySelector('#conflict');
        cbox.innerHTML = cf.length
          ? `<span style="color:var(--danger)">⚠ Пересечение с бронью: ${cf.map((c) => fmtRange(c.dateFrom, c.dateTo)).join(', ')}</span>`
          : '';
      };
      el.addEventListener('input', upd);
      el.addEventListener('change', upd);
      upd();

      el.querySelector('[data-newclient]').onclick = () => {
        const draft = formData(el);
        closeModal();
        clientQuickForm(async (c) => {
          bookingForm({ ...b, ...draft, clientId: c.id }, { onSaved });
        });
      };
      el.querySelector('[data-cancel]').onclick = closeModal;
      const delBtn = el.querySelector('[data-del]');
      if (delBtn) delBtn.onclick = async () => {
        if (await confirmDialog('Удалить бронь? Файлы брони тоже будут удалены.')) {
          await S.deleteBooking(b.id); closeModal(); toast('Бронь удалена'); onSaved && onSaved(null);
        }
      };
      el.querySelector('[data-save]').onclick = async () => {
        const d = formData(el);
        if (daysBetween(d.dateFrom, d.dateTo) <= 0) return toast('Проверьте даты', true);
        const saved = await S.saveBooking({ ...b, ...d });
        closeModal(); toast('Бронь сохранена'); onSaved && onSaved(saved);
      };
    },
  });
}

export function clientQuickForm(onCreated) {
  const c = S.emptyClient();
  modal({
    title: 'Новый клиент', size: 'narrow',
    body: `
      ${field('name', 'Имя', { value: '', placeholder: 'Анна Петрова', required: true })}
      <div class="grid-2">
        ${field('phone', 'Телефон', { value: '', placeholder: '+7 916 ...' })}
        ${field('whatsapp', 'WhatsApp', { value: '', placeholder: '+62 812 ...' })}
      </div>
      <div class="grid-2">
        ${field('telegram', 'Telegram', { value: '', placeholder: '@nickname' })}
        ${field('email', 'E-mail', { type: 'email', value: '' })}
      </div>
      <div class="grid-2">
        ${field('country', 'Страна', { value: '' })}
        ${field('passport', 'Паспорт №', { value: '' })}
      </div>`,
    footer: '<button class="btn" data-cancel>Отмена</button><button class="btn btn-primary" data-save>Создать</button>',
    onMount(el) {
      el.querySelector('[data-cancel]').onclick = closeModal;
      el.querySelector('[data-save]').onclick = async () => {
        const d = formData(el);
        if (!d.name) return toast('Введите имя', true);
        const saved = await S.saveClient({ ...c, ...d });
        closeModal(); toast('Клиент создан'); onCreated && onCreated(saved);
      };
    },
  });
}

// ===== Карточка брони: даты + контакты клиента + файлы =====
export function bookingCard(id, { onChanged } = {}) {
  const b = S.booking(id);
  if (!b) return;
  const v = S.villa(b.villaId);
  const c = S.client(b.clientId);
  const n = S.nights(b);
  const st = STATUS[b.status] || STATUS.booked;
  const cur = 'IDR';
  const total = num(b.priceTotal) + num(b.cleaningFee);
  const due = total - num(b.prepaid);

  const contactChips = c ? `
    <div class="chip-links">
      ${c.phone ? `<a class="chip-link" href="${phoneHref(c.phone)}">📞 ${esc(c.phone)}</a>` : ''}
      ${c.whatsapp ? `<a class="chip-link" href="${waHref(c.whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
      ${c.telegram ? `<a class="chip-link" href="${tgHref(c.telegram)}" target="_blank" rel="noopener">✈️ ${esc(c.telegram)}</a>` : ''}
      ${c.email ? `<a class="chip-link" href="mailto:${esc(c.email)}">✉️ ${esc(c.email)}</a>` : ''}
    </div>` : '<div class="mute">Клиент не привязан к этой брони.</div>';

  modal({
    title: `${st.label} · ${v ? v.name : 'вилла удалена'}`,
    size: 'wide',
    body: `
      <div class="row">
        <span class="badge b-${st.cls}">${st.label}</span>
        <span class="dim">${fmtDate(b.dateFrom)} → ${fmtDate(b.dateTo)}</span>
        <span class="badge">${n} ${plural(n, 'ночь', 'ночи', 'ночей')}</span>
        ${b.guests ? `<span class="badge">👥 ${esc(b.guests)}</span>` : ''}
        ${b.source ? `<span class="badge">${esc(b.source)}</span>` : ''}
      </div>
      <div class="grid-2">
        <div class="panel" style="padding:14px">
          <div class="panel-head"><h3>👤 Клиент</h3><div class="spacer"></div>
            ${c ? `<a class="btn btn-sm" href="#/client/${c.id}" data-goclient>Карточка клиента</a>` : ''}</div>
          <div style="font-size:16px;font-weight:650;margin-bottom:8px">${c ? esc(c.name) : '—'}</div>
          ${contactChips}
          ${c && (c.country || c.passport) ? `<div class="hint" style="margin-top:8px">${c.country ? '🌍 ' + esc(c.country) : ''} ${c.passport ? ' · 🛂 ' + esc(c.passport) : ''}</div>` : ''}
        </div>
        <div class="panel" style="padding:14px">
          <div class="panel-head"><h3>💰 Деньги</h3></div>
          <dl class="kv">
            <dt>Сумма аренды</dt><dd>${money(b.priceTotal, cur)}</dd>
            ${b.cleaningFee ? `<dt>Доп. сборы</dt><dd>${money(b.cleaningFee, cur)}</dd>` : ''}
            <dt>Итого</dt><dd><b>${money(total, cur)}</b></dd>
            <dt>Предоплата</dt><dd>${money(b.prepaid, cur)}</dd>
            <dt>Остаток к оплате</dt><dd style="color:${due > 0 ? 'var(--warn)' : 'var(--acc)'}"><b>${money(due, cur)}</b></dd>
            ${n ? `<dt>За ночь</dt><dd>${money(total / n, cur)}</dd>` : ''}
          </dl>
        </div>
      </div>
      ${b.notes ? `<div class="panel" style="padding:14px"><div class="panel-head"><h3>📝 Заметки</h3></div><div class="pre-wrap">${esc(b.notes)}</div></div>` : ''}
      ${c ? '<div class="panel" style="padding:14px" id="client-docs"></div>' : ''}
      <div class="panel" style="padding:14px" id="booking-docs"></div>`,
    footer: `
      ${v ? `<a class="btn left" href="#/villa/${v.id}" data-govilla>🏝️ Открыть виллу</a>` : ''}
      <button class="btn" data-edit>✎ Редактировать</button>
      <button class="btn btn-primary" data-close2>Готово</button>`,
    onMount(el) {
      el.querySelector('[data-close2]').onclick = closeModal;
      el.querySelector('[data-edit]').onclick = () => {
        closeModal();
        bookingForm(b, { onSaved: () => onChanged && onChanged() });
      };
      const goV = el.querySelector('[data-govilla]');
      if (goV) goV.onclick = () => setTimeout(closeModal, 0);
      const goC = el.querySelector('[data-goclient]');
      if (goC) goC.onclick = () => setTimeout(closeModal, 0);
      if (c) renderDocs(el.querySelector('#client-docs'), 'client', c.id, { title: '📁 Документы клиента (договор, паспорт…)' });
      renderDocs(el.querySelector('#booking-docs'), 'booking', b.id, { title: '📎 Файлы по этой брони' });
    },
    onClose: () => onChanged && onChanged(),
  });
}

export function newBookingQuick(villaId = '', from = today(), to = '') {
  bookingForm({ ...S.emptyBooking(villaId, from, to || addDays(from, 7)) }, { onSaved: () => location.reload === null ? null : window.dispatchEvent(new Event('data-changed')) });
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
