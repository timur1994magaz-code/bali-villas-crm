// ===== Клиенты: список и карточка с документами =====
import * as S from '../store.js';
import * as data from '../data.js';
import { modal, closeModal, field, formData, formDiff, toast, confirmDialog, normalizeMoneyFields } from '../ui.js';
import { renderDocs } from '../files-ui.js';
import { bookingForm, bookingCard, plural } from '../booking.js';
import { taskRow, bindTaskList, taskForm } from './tasks.js';
import {
  esc, money, moneyShort, num, STATUS, fmtRange, fmtDate, phoneHref, waHref, tgHref, sortBy, today,
} from '../util.js';

/** Неактуальные клиенты не удаляются, а убираются из рабочего списка. */
export const isArchived = (c) => !!(c && c.archived);

export function renderClientsList(view, actions) {
  let group = sessionStorage.getItem('clientsGroup') || 'active';
  actions.innerHTML = `
    <input class="search" id="c-search" type="search" placeholder="Поиск клиента, телефона, e-mail…">
    <div class="seg" id="c-seg">
      <button data-group="active">Актуальные</button>
      <button data-group="archived">Не актуальные</button>
      <button data-group="all">Все</button>
    </div>
    <button class="btn btn-primary" id="c-add">+ Клиент</button>`;
  let q = '';
  actions.querySelector('#c-search').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
  actions.querySelector('#c-add').onclick = () => clientForm(S.emptyClient());
  actions.querySelectorAll('#c-seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.group === group);
    b.onclick = () => {
      group = b.dataset.group;
      sessionStorage.setItem('clientsGroup', group);
      actions.querySelectorAll('#c-seg button').forEach((x) => x.classList.toggle('active', x === b));
      draw();
      window.scrollTo(0, 0);        // другой список — показываем с начала
    };
  });

  /** Перерисовка без прыжка: строка уходит в другой список, а экран остаётся на месте. */
  function drawKeepingScroll() {
    const y = window.scrollY;
    draw();
    if (y && Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
  }

  async function setArchived(c, on) {
    const fresh = S.client(c.id) || c;
    await S.saveClient({
      ...fresh,
      archived: on,
      archivedAt: on ? today() : '',
    });
    toast(on ? `«${c.name}» — не актуален` : `«${c.name}» снова в работе`);
    drawKeepingScroll();
  }

  function draw() {
    const archivedCount = S.state.clients.filter(isArchived).length;
    const segArchived = actions.querySelector('[data-group="archived"]');
    if (segArchived) {
      segArchived.innerHTML = `Не актуальные${archivedCount ? ` <span class="mute">${archivedCount}</span>` : ''}`;
    }

    const list = sortBy(S.state.clients, 'name')
      .filter((c) => (group === 'all' ? true : group === 'archived' ? isArchived(c) : !isArchived(c)))
      .filter((c) => !q ||
        [c.name, c.phone, c.whatsapp, c.telegram, c.email, c.wantArea, c.source].join(' ').toLowerCase().includes(q));
    if (!S.state.clients.length) {
      view.innerHTML = `<div class="empty-state"><div class="big">👤</div><h3>Клиентов пока нет</h3>
        <p>Клиенты появляются автоматически, когда вы создаёте бронь, либо добавьте вручную.</p>
        <button class="btn btn-primary" id="e-add">+ Добавить клиента</button></div>`;
      view.querySelector('#e-add').onclick = () => clientForm(S.emptyClient());
      return;
    }
    if (!list.length) {
      view.innerHTML = `<div class="empty-state">${
        group === 'archived'
          ? 'Неактуальных клиентов нет. Галочка в последнем столбце убирает клиента из рабочего списка сюда.'
          : q ? 'Никто не найден' : 'В этом списке пусто'}</div>`;
      return;
    }

    view.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Клиент</th><th>Телефон</th><th>WhatsApp / TG</th><th>E-mail</th><th class="num">Комнат</th><th>Район</th><th class="num">Бюджет</th><th>Проживаний</th><th>Текущее / ближайшее</th><th class="num">Оплачено</th><th class="nowrap">Не актуален</th></tr></thead>
      <tbody>${list.map((c) => {
        const bs = S.bookingsOfClient(c.id);
        const cur = bs.find((b) => b.dateFrom <= today() && today() < b.dateTo)
          || bs.filter((b) => b.dateFrom > today()).sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))[0];
        const paid = bs.reduce((s, b) => s + num(b.prepaid), 0);
        const v = cur ? S.villa(cur.villaId) : null;
        return `<tr class="clickable${isArchived(c) ? ' row-archived' : ''}" data-id="${c.id}">
          <td><b>${esc(c.name)}</b>${c.source ? `<div class="file-sub">${esc(c.source)}</div>` : ''}</td>
          <td class="nowrap">${esc(c.phone || '—')}</td>
          <td class="nowrap">${esc(c.whatsapp || '')} ${esc(c.telegram || '')}</td>
          <td>${esc(c.email || '—')}</td>
          <td class="num">${esc(c.wantBedrooms || '—')}</td>
          <td>${esc(c.wantArea || '—')}</td>
          <td class="num">${c.budget
            ? `${moneyShort(c.budget, 'IDR')}<div class="file-sub">${c.budgetPeriod === 'night' ? 'в сутки' : 'в месяц'}</div>`
            : '—'}</td>
          <td>${bs.length}</td>
          <td>${cur ? `${esc(v ? v.name : '')} <span class="file-sub">${fmtRange(cur.dateFrom, cur.dateTo)}</span>` : '—'}</td>
          <td class="num">${paid ? moneyShort(paid, 'IDR') : '—'}</td>
          <td class="archive-cell">
            <label class="check" title="${isArchived(c) ? 'Вернуть в работу' : 'Убрать из рабочего списка'}">
              <input type="checkbox" data-arch="${c.id}"${isArchived(c) ? ' checked' : ''}>
            </label>
            ${isArchived(c) && c.archivedAt ? `<div class="file-sub">с ${esc(c.archivedAt)}</div>` : ''}
          </td>
        </tr>`;
      }).join('')}</tbody></table></div>`;

    view.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.onclick = (e) => {
        if (e.target.closest('.archive-cell')) return;   // галочка — не переход в карточку
        location.hash = '#/client/' + tr.dataset.id;
      };
    });
    view.querySelectorAll('[data-arch]').forEach((chk) => {
      chk.onclick = (e) => e.stopPropagation();
      chk.onchange = () => {
        const c = S.client(chk.dataset.arch);
        if (c) setArchived(c, chk.checked);
      };
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
    <button class="btn btn-sm" id="c-arch">${isArchived(c) ? '↩ Вернуть в работу' : '🗂 Не актуален'}</button>
    <button class="btn btn-sm btn-primary" id="c-book">+ Бронь клиенту</button>
    ${data.canDelete() ? '<button class="btn btn-sm btn-danger" id="c-del">Удалить</button>' : ''}`;
  actions.querySelector('#c-edit').onclick = () => clientForm(c);
  actions.querySelector('#c-arch').onclick = async () => {
    const on = !isArchived(c);
    await S.saveClient({ ...(S.client(c.id) || c), archived: on, archivedAt: on ? today() : '' });
    toast(on ? 'Клиент убран из рабочего списка' : 'Клиент снова в работе');
    renderClientCard(view, actions, id);
  };
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
  const cDel = actions.querySelector('#c-del');
  if (cDel) cDel.onclick = async () => {
    if (await confirmDialog(`Удалить клиента «${c.name}» и его файлы? Брони останутся, но без клиента.`)) {
      await S.deleteClient(c.id); toast('Клиент удалён'); location.hash = '#/clients';
    }
  };

  const bs = S.bookingsOfClient(c.id);
  const nightsTotal = bs.reduce((s, b) => s + S.nights(b), 0);
  const paid = bs.reduce((s, b) => s + num(b.prepaid), 0);
  const billed = bs.reduce((s, b) => s + num(b.priceTotal) + num(b.cleaningFee), 0);

  view.innerHTML = `
    ${isArchived(c) ? `<div class="panel archived-note">
      🗂 <b>Не актуален</b>${c.archivedAt ? ` <span class="mute">с ${esc(c.archivedAt)}</span>` : ''}
      <span class="mute">— клиент убран из рабочего списка. Данные, брони и документы на месте.</span>
    </div>` : ''}
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
          <dt>Бюджет</dt><dd>${c.budget
            ? `<b>${moneyShort(c.budget, 'IDR')}</b> ${c.budgetPeriod === 'night' ? 'в сутки' : 'в месяц'}`
            : '<span class="mute">не указан</span>'}
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
    <div class="panel" id="c-tasks"></div>
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
  const drawTasks = () => {
    const panel = view.querySelector('#c-tasks');
    if (!panel) return;
    const list = S.tasksOfClient(c.id);
    const open = list.filter((x) => !x.done).length;
    panel.innerHTML = `
      <div class="panel-head"><h3>✅ Задачи${open ? ` <span class="mute">· ${open} в работе</span>` : ''}</h3>
        <div class="spacer"></div>
        <button class="btn btn-sm" id="c-task-add">+ Задача</button></div>
      ${list.length
        ? `<div class="task-list">${list.map((x) => taskRow(x, { compact: true })).join('')}</div>`
        : '<div class="mute">Задач по клиенту нет.</div>'}`;
    bindTaskList(panel, drawTasks);
    panel.querySelector('#c-task-add').onclick = () =>
      taskForm(S.emptyTask({ clientId: c.id, title: '' }), drawTasks);
  };
  drawTasks();

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
        budget: String(c.budget || ''), budgetPeriod: c.budgetPeriod || 'month', onlyFree: true,
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
      <div class="grid-2">
        ${field('budget', 'Бюджет, Rp', { type: 'money', value: c.budget,
          floor: c.budgetPeriod === 'night' ? 1e5 : 1e6, placeholder: '30 млн' })}
        ${field('budgetPeriod', 'За период', { options: [
          { value: 'month', label: 'в месяц — долгая аренда' },
          { value: 'night', label: 'в сутки — короткий заезд' }], value: c.budgetPeriod || 'month' })}
      </div>
      <div class="hint">Район не отсекает другие: виллы в нём просто идут первыми.</div>
      ${field('source', 'Источник', { value: c.source, placeholder: 'Instagram / Airbnb / рекомендация' })}
      ${field('notes', 'Заметки', { type: 'textarea', value: c.notes, rows: 3 })}
      <div class="hint" style="margin-top:6px">📎 Паспорт и договор загружаются в карточке клиента — кнопка «Паспорт / договор» вверху.</div>`,
    footer: '<button class="btn" data-cancel>Отмена</button><button class="btn btn-primary" data-save>Сохранить</button>',
    onMount(el) {
      const initial = formData(el);
      const per = el.querySelector('[name=budgetPeriod]');
      const bud = el.querySelector('[name=budget]');
      if (per && bud) {
        per.onchange = () => {
          // суточный бюджет может быть меньше миллиона — граница другая
          bud.setAttribute('data-floor', per.value === 'night' ? '100000' : '1000000');
          bud.dispatchEvent(new Event('input', { bubbles: true }));
        };
      }
      el.querySelector('[data-cancel]').onclick = closeModal;
      const saveBtn = el.querySelector('[data-save]');
      saveBtn.onclick = async () => {
        const fixed = normalizeMoneyFields(el);
        if (fixed.length) {
          toast(fixed.map((f) => `${f.label}: ${money(f.from)} → ${money(f.to)}`).join('; '));
        }
        const d = formData(el);
        if (!d.name) return toast('Введите имя', true);
        const changed = isNew ? d : formDiff(el, initial);
        saveBtn.disabled = true;
        const fresh = S.client(c.id) || c;
        let saved;
        try {
          saved = await S.saveClient({ ...fresh, ...changed });
        } catch (e) {
          saveBtn.disabled = false;
          return toast('Не удалось сохранить: ' + e.message, true);
        }
        closeModal(); toast('Клиент сохранён');
        if (isNew) location.hash = '#/client/' + saved.id;
        else window.dispatchEvent(new Event('data-changed'));
      };
    },
  });
}
