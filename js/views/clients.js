// ===== Клиенты: список и карточка с документами =====
import * as S from '../store.js';
import { modal, closeModal, field, formData, toast, confirmDialog } from '../ui.js';
import { renderDocs } from '../files-ui.js';
import { bookingForm, bookingCard, plural } from '../booking.js';
import {
  esc, money, moneyShort, num, STATUS, fmtRange, fmtDate, phoneHref, waHref, tgHref, sortBy, today,
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
      [c.name, c.phone, c.whatsapp, c.telegram, c.email, c.wantArea, c.source].join(' ').toLowerCase().includes(q));
    if (!S.state.clients.length) {
      view.innerHTML = `<div class="empty-state"><div class="big">👤</div><h3>Клиентов пока нет</h3>
        <p>Клиенты появляются автоматически, когда вы создаёте бронь, либо добавьте вручную.</p>
        <button class="btn btn-primary" id="e-add">+ Добавить клиента</button></div>`;
      view.querySelector('#e-add').onclick = () => clientForm(S.emptyClient());
      return;
    }
    view.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Клиент</th><th>Телефон</th><th>WhatsApp / TG</th><th>E-mail</th><th class="num">Комнат</th><th>Район</th><th class="num">Бюджет</th><th>Проживаний</th><th>Текущее / ближайшее</th><th class="num">Оплачено</th></tr></thead>
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
          <td class="num">${esc(c.wantBedrooms || '—')}</td>
          <td>${esc(c.wantArea || '—')}</td>
          <td class="num">${c.budget ? moneyShort(c.budget, 'IDR') : '—'}</td>
          <td>${bs.length}</td>
          <td>${cur ? `${esc(v ? v.name : '')} <span class="file-sub">${fmtRange(cur.dateFrom, cur.dateTo)}</span>` : '—'}</td>
          <td class="num">${paid ? moneyShort(paid, 'IDR') : '—'}</td>
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
    <button class="btn btn-sm" id="c-doc">📎 Паспорт / договор</button>
    <button class="btn btn-sm btn-primary" id="c-book">+ Бронь клиенту</button>
    <button class="btn btn-sm btn-danger" id="c-del">Удалить</button>`;
  actions.querySelector('#c-edit').onclick = () => clientForm(c);
  actions.querySelector('#c-doc').onclick = () => {
    const input = view.querySelector('#c-docs [data-input]');
    if (input) input.click();
    const panel = view.querySelector('#c-docs');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
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
      <div class="stat"><div class="stat-label">Начислено</div><div class="stat-value">${moneyShort(billed, 'IDR')}</div></div>
      <div class="stat"><div class="stat-label">Оплачено</div><div class="stat-value" style="color:var(--acc)">${moneyShort(paid, 'IDR')}</div></div>
      <div class="stat"><div class="stat-label">${billed - paid < 0 ? 'Переплата' : 'Остаток'}</div>
        <div class="stat-value" style="color:${billed - paid > 0 ? 'var(--warn)' : 'var(--acc)'}">${moneyShort(Math.abs(billed - paid), 'IDR')}</div>
        ${billed === 0 && paid > 0
          ? '<div class="stat-sub" style="color:var(--warn)">в брони не указана сумма аренды</div>'
          : billed - paid < 0 ? '<div class="stat-sub">оплачено больше начисленного</div>' : ''}</div>
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
          <dt>Бюджет в месяц</dt><dd>${c.budget ? `<b>${moneyShort(c.budget, 'IDR')}</b>` : '<span class="mute">не указан</span>'}
            ${c.budget || c.wantBedrooms || c.wantArea
              ? '<button class="btn btn-sm" id="c-pick" style="margin-left:8px">🔎 Подобрать виллы</button>' : ''}</dd>
          <dt>Кол-во комнат</dt><dd>${c.wantBedrooms ? esc(c.wantBedrooms) + ' и больше' : '<span class="mute">не указано</span>'}</dd>
          <dt>Район</dt><dd>${c.wantArea ? esc(c.wantArea) + ' <span class="mute">(другие районы тоже покажем)</span>' : '<span class="mute">не важен</span>'}</dd>
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
            <td class="num">${num(b.priceTotal) + num(b.cleaningFee)
              ? money(num(b.priceTotal) + num(b.cleaningFee))
              : '<span style="color:var(--warn)" title="Откройте бронь и впишите сумму аренды">не указана</span>'}</td>
            <td class="num">${money(b.prepaid)}</td>
          </tr>`;
        }).join('')}</tbody></table></div>` : '<div class="mute">Проживаний пока нет.</div>'}
    </div>`;
  renderDocs(view.querySelector('#c-docs'), 'client', c.id,
    { title: '📁 Документы: договор, паспорт, виза' });

  // бюджет клиента сразу переносим в подбор — не переписывать же его руками
  const pick = view.querySelector('#c-pick');
  if (pick) pick.onclick = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('searchParams') || '{}');
      localStorage.setItem('searchParams', JSON.stringify({
        from: saved.from || today(), months: saved.months || 2, to: '',
        bedroomsMin: String(c.wantBedrooms || ''), bedroomsMax: '',
        preferArea: String(c.wantArea || ''),        // район поднимает, но не отсекает
        budget: String(c.budget || ''), onlyFree: true,
      }));
    } catch (e) { void e; }
    location.hash = '#/search';
  };
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
        ${field('wantBedrooms', 'Кол-во комнат', { type: 'number', value: c.wantBedrooms, placeholder: '2' })}
        ${field('wantArea', 'Район', { value: c.wantArea, placeholder: 'Переренан, Чангу…' })}
        ${field('instagram', 'Instagram', { value: c.instagram })}
      </div>
      ${field('budget', 'Бюджет в месяц, Rp', { type: 'money', value: c.budget,
        placeholder: '30 млн', hint: 'Запрос клиента. Район не отсекает другие: виллы в нём просто идут первыми.' })}
      ${field('source', 'Источник', { value: c.source, placeholder: 'Instagram / Airbnb / рекомендация' })}
      ${field('notes', 'Заметки', { type: 'textarea', value: c.notes, rows: 3 })}
      <div class="hint" style="margin-top:6px">📎 Паспорт и договор загружаются в карточке клиента — кнопка «Паспорт / договор» вверху.</div>`,
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
