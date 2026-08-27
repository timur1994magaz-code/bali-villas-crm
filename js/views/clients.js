// ===== Клиенты: список и карточка с документами =====
import * as S from '../store.js';
import { modal, closeModal, field, formData, toast, confirmDialog } from '../ui.js';
import { renderDocs } from '../files-ui.js';
import { bookingForm, bookingCard, plural } from '../booking.js';
import {
  esc, money, num, STATUS, fmtRange, fmtDate, phoneHref, waHref, tgHref, sortBy, today,
} from '../util.js';

export function renderClientsList(view, actions) {
  actions.innerHTML = `
    <input class="search" id="c-search" type="search" placeholder="Поиск клиента, телефона, e-mail…">
    <button class="btn btn-primary" id="c-add">+ Клиент</button>`;
  let q = '';
  actions.querySelector('#c-search').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
  actions.querySelector('#c-add').onclick = () => clientForm(S.emptyClient());

  function draw() {
    const list = sortBy(S.state.clients, 'name').filter((c) => !q ||
      [c.name, c.phone, c.whatsapp, c.telegram, c.email, c.country, c.passport].join(' ').toLowerCase().includes(q));
    if (!S.state.clients.length) {
      view.innerHTML = `<div class="empty-state"><div class="big">👤</div><h3>Клиентов пока нет</h3>
        <p>Клиенты появляются автоматически, когда вы создаёте бронь, либо добавьте вручную.</p>
        <button class="btn btn-primary" id="e-add">+ Добавить клиента</button></div>`;
      view.querySelector('#e-add').onclick = () => clientForm(S.emptyClient());
      return;
    }
    view.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Клиент</th><th>Телефон</th><th>WhatsApp / TG</th><th>E-mail</th><th>Страна</th><th>Проживаний</th><th>Текущее / ближайшее</th><th class="num">Оплачено</th></tr></thead>
      <tbody>${list.map((c) => {
        const bs = S.bookingsOfClient(c.id);
        const cur = bs.find((b) => b.dateFrom <= today() && today() < b.dateTo)
          || bs.filter((b) => b.dateFrom > today()).sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))[0];
        const paid = bs.reduce((s, b) => s + num(b.prepaid), 0);
        const v = cur ? S.villa(cur.villaId) : null;
        return `<tr class="clickable" data-id="${c.id}">
          <td><b>${esc(c.name)}</b>${c.source ? `<div class="file-sub">${esc(c.source)}</div>` : ''}</td>
          <td class="nowrap">${esc(c.phone || '—')}</td>
          <td class="nowrap">${esc(c.whatsapp || '')} ${esc(c.telegram || '')}</td>
          <td>${esc(c.email || '—')}</td>
          <td>${esc(c.country || '—')}</td>
          <td>${bs.length}</td>
          <td>${cur ? `${esc(v ? v.name : '')} <span class="file-sub">${fmtRange(cur.dateFrom, cur.dateTo)}</span>` : '—'}</td>
          <td class="num">${paid ? money(paid, 'USD') : '—'}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
    view.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.onclick = () => { location.hash = '#/client/' + tr.dataset.id; };
    });
  }
  draw();
}

export function renderClientCard(view, actions, id) {
  const c = S.client(id);
  if (!c) { view.innerHTML = '<div class="empty-state">Клиент не найден. <a href="#/clients">К списку</a></div>'; return; }
  document.getElementById('page-title').textContent = c.name || 'Клиент';
  actions.innerHTML = `
    <a class="btn btn-sm" href="#/clients">← К списку</a>
    <button class="btn btn-sm" id="c-edit">✎ Редактировать</button>
    <button class="btn btn-sm btn-primary" id="c-book">+ Бронь клиенту</button>
    <button class="btn btn-sm btn-danger" id="c-del">Удалить</button>`;
  actions.querySelector('#c-edit').onclick = () => clientForm(c);
  actions.querySelector('#c-book').onclick = () => {
    const b = S.emptyBooking(S.state.villas[0] ? S.state.villas[0].id : '', today());
    bookingForm({ ...b, clientId: c.id }, { onSaved: () => renderClientCard(view, actions, id) });
  };
  actions.querySelector('#c-del').onclick = async () => {
    if (await confirmDialog(`Удалить клиента «${c.name}» и его файлы? Брони останутся, но без клиента.`)) {
      await S.deleteClient(c.id); toast('Клиент удалён'); location.hash = '#/clients';
    }
  };

  const bs = S.bookingsOfClient(c.id);
  const nightsTotal = bs.reduce((s, b) => s + S.nights(b), 0);
  const paid = bs.reduce((s, b) => s + num(b.prepaid), 0);
  const billed = bs.reduce((s, b) => s + num(b.priceTotal) + num(b.cleaningFee), 0);

  view.innerHTML = `
    <div class="stat-row" style="margin-bottom:14px">
      <div class="stat"><div class="stat-label">Проживаний</div><div class="stat-value">${bs.length}</div><div class="stat-sub">${nightsTotal} ${plural(nightsTotal, 'ночь', 'ночи', 'ночей')} всего</div></div>
      <div class="stat"><div class="stat-label">Начислено</div><div class="stat-value">${money(billed, 'USD')}</div></div>
      <div class="stat"><div class="stat-label">Оплачено</div><div class="stat-value" style="color:var(--acc)">${money(paid, 'USD')}</div></div>
      <div class="stat"><div class="stat-label">Остаток</div><div class="stat-value" style="color:${billed - paid > 0 ? 'var(--warn)' : 'var(--acc)'}">${money(billed - paid, 'USD')}</div></div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h3>👤 Контакты</h3></div>
        <div class="chip-links" style="margin-bottom:12px">
          ${c.phone ? `<a class="chip-link" href="${phoneHref(c.phone)}">📞 ${esc(c.phone)}</a>` : ''}
          ${c.whatsapp ? `<a class="chip-link" href="${waHref(c.whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
          ${c.telegram ? `<a class="chip-link" href="${tgHref(c.telegram)}" target="_blank" rel="noopener">✈️ ${esc(c.telegram)}</a>` : ''}
          ${c.email ? `<a class="chip-link" href="mailto:${esc(c.email)}">✉️ ${esc(c.email)}</a>` : ''}
          ${c.instagram ? `<a class="chip-link" href="https://instagram.com/${esc(String(c.instagram).replace(/^@/, ''))}" target="_blank" rel="noopener">📷 ${esc(c.instagram)}</a>` : ''}
        </div>
        <dl class="kv">
          <dt>Страна</dt><dd>${esc(c.country || '—')}</dd>
          <dt>Паспорт №</dt><dd>${esc(c.passport || '—')}</dd>
          <dt>Источник</dt><dd>${esc(c.source || '—')}</dd>
          <dt>Добавлен</dt><dd>${c.createdAt ? fmtDate(c.createdAt.slice(0, 10)) : '—'}</dd>
        </dl>
        ${c.notes ? `<hr class="sep"><div class="pre-wrap">${esc(c.notes)}</div>` : ''}
      </div>
      <div class="panel" id="c-docs"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>🗓️ История проживаний</h3></div>
      ${bs.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Вилла</th><th>Даты</th><th>Ночей</th><th>Статус</th><th class="num">Сумма</th><th class="num">Предоплата</th></tr></thead>
        <tbody>${bs.map((b) => {
          const v = S.villa(b.villaId); const st = STATUS[b.status] || STATUS.booked;
          return `<tr class="clickable" data-b="${b.id}">
            <td>${esc(v ? v.name : '—')}</td>
            <td class="nowrap">${fmtRange(b.dateFrom, b.dateTo)}</td>
            <td>${S.nights(b)}</td>
            <td><span class="badge b-${st.cls}">${st.label}</span></td>
            <td class="num">${money(num(b.priceTotal) + num(b.cleaningFee), b.currency)}</td>
            <td class="num">${money(b.prepaid, b.currency)}</td>
          </tr>`;
        }).join('')}</tbody></table></div>` : '<div class="mute">Проживаний пока нет.</div>'}
    </div>`;
  renderDocs(view.querySelector('#c-docs'), 'client', c.id, { title: '📁 Документы (договор, паспорт, виза…)' });
  view.querySelectorAll('tr[data-b]').forEach((tr) => {
    tr.onclick = () => bookingCard(tr.dataset.b, { onChanged: () => renderClientCard(view, actions, id) });
  });
}

export function clientForm(c) {
  const isNew = !S.client(c.id);
  modal({
    title: isNew ? 'Новый клиент' : 'Редактировать клиента',
    body: `
      ${field('name', 'Имя', { value: c.name, required: true })}
      <div class="grid-2">
        ${field('phone', 'Телефон', { value: c.phone })}
        ${field('whatsapp', 'WhatsApp', { value: c.whatsapp })}
      </div>
      <div class="grid-2">
        ${field('telegram', 'Telegram', { value: c.telegram, placeholder: '@nickname' })}
        ${field('email', 'E-mail', { type: 'email', value: c.email })}
      </div>
      <div class="grid-3">
        ${field('country', 'Страна', { value: c.country })}
        ${field('passport', 'Паспорт №', { value: c.passport })}
        ${field('instagram', 'Instagram', { value: c.instagram })}
      </div>
      ${field('source', 'Источник', { value: c.source, placeholder: 'Instagram / Airbnb / рекомендация' })}
      ${field('notes', 'Заметки', { type: 'textarea', value: c.notes, rows: 3 })}`,
    footer: '<button class="btn" data-cancel>Отмена</button><button class="btn btn-primary" data-save>Сохранить</button>',
    onMount(el) {
      el.querySelector('[data-cancel]').onclick = closeModal;
      el.querySelector('[data-save]').onclick = async () => {
        const d = formData(el);
        if (!d.name) return toast('Введите имя', true);
        const saved = await S.saveClient({ ...c, ...d });
        closeModal(); toast('Клиент сохранён');
        if (isNew) location.hash = '#/client/' + saved.id;
        else window.dispatchEvent(new Event('data-changed'));
      };
    },
  });
}
