// ===== Карточка виллы: обзор, фото, локация, календарь, брони, документы =====
import * as S from '../store.js';
import { modal, closeModal, field, formData, toast, confirmDialog } from '../ui.js';
import { renderPhotos, renderDocs, uploadPhotos } from '../files-ui.js';
import * as data from '../data.js';
import { bookingForm, bookingCard, plural } from '../booking.js';
import {
  esc, money, num, CURRENCIES, PERIODS, STATUS, fmtDate, fmtDateShort, fmtRange,
  parseCoords, mapEmbedUrl, mapLinkUrl, phoneHref, waHref, today, addMonths,
  startOfMonth, daysInMonth, dowIndex, DOW, MONTHS, ymd, parseYmd, daysBetween, addDays,
} from '../util.js';

export async function renderVillaCard(view, actions, id) {
  const v = S.villa(id);
  if (!v) { view.innerHTML = '<div class="empty-state">Вилла не найдена. <a href="#/villas">К списку</a></div>'; return; }

  document.getElementById('page-title').textContent = v.name || 'Вилла';
  actions.innerHTML = `
    <a class="btn btn-sm" href="#/villas">← К списку</a>
    <button class="btn btn-sm" id="v-edit">✎ Редактировать</button>
    <button class="btn btn-sm" id="v-photos">📸 Фото</button>
    <button class="btn btn-sm btn-primary" id="v-book">+ Бронь</button>
    <button class="btn btn-sm btn-danger" id="v-del">Удалить</button>`;
  actions.querySelector('#v-edit').onclick = () => villaForm(v);
  actions.querySelector('#v-photos').onclick = () => {
    sessionStorage.setItem('villaTab', 'photos');
    renderVillaCard(view, actions, id);
  };
  actions.querySelector('#v-book').onclick = () => bookingForm(S.emptyBooking(v.id, today(), addDays(today(), 7)), { onSaved: () => rerender() });
  actions.querySelector('#v-del').onclick = async () => {
    if (await confirmDialog(`Удалить виллу «${v.name}» со всеми фото, документами и бронями?`)) {
      await S.deleteVilla(v.id); toast('Вилла удалена'); location.hash = '#/villas';
    }
  };

  const tabs = [
    ['overview', '📋 Обзор'], ['photos', '📸 Фото'], ['location', '📍 Локация'],
    ['calendar', '🗓️ Календарь'], ['bookings', '📖 Брони'], ['docs', '📁 Документы'],
  ];
  let active = sessionStorage.getItem('villaTab') || 'overview';

  view.innerHTML = `
    <div class="tabs">${tabs.map(([k, l]) => `<button class="tab${k === active ? ' active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="tab-body"></div>`;
  const body = view.querySelector('#tab-body');
  view.querySelector('.tabs').onclick = (e) => {
    const t = e.target.closest('.tab'); if (!t) return;
    active = t.dataset.tab; sessionStorage.setItem('villaTab', active);
    view.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    drawTab();
  };
  function rerender() { renderVillaCard(view, actions, id); }
  drawTab();

  function drawTab() {
    if (active === 'overview') return drawOverview();
    if (active === 'photos') {
      body.innerHTML = `${driveBanner()}<div class="panel" id="ph"></div>`;
      const setBtn = body.querySelector('#drive-set');
      if (setBtn) setBtn.onclick = askDrive;
      const editBtn = body.querySelector('#drive-edit');
      if (editBtn) editBtn.onclick = askDrive;
      return renderPhotos(body.querySelector('#ph'), 'villa', v.id);
    }
    if (active === 'location') return drawLocation();
    if (active === 'calendar') return drawCalendar();
    if (active === 'bookings') return drawBookings();
    if (active === 'docs') { body.innerHTML = '<div class="panel" id="dc"></div>'; return renderDocs(body.querySelector('#dc'), 'villa', v.id, { title: '📁 Документы виллы (договор с собственником, инвентарь, счета…)' }); }
  }

  // ---------- Обзор ----------
  function drawOverview() {
    const m = S.villaMargin(v);
    const bs = S.bookingsOfVilla(v.id);
    const nowB = bs.find((b) => b.dateFrom <= today() && today() < b.dateTo);
    const occ = S.occupancy(startOfMonth(today()), addMonths(startOfMonth(today()), 1), v.id);
    body.innerHTML = `
      <div class="stat-row" style="margin-bottom:14px">
        <div class="stat"><div class="stat-label">Цена собственника</div><div class="stat-value">${money(v.ownerPrice, v.currency)}</div><div class="stat-sub">${PERIODS[v.ownerPeriod] || ''}</div></div>
        <div class="stat"><div class="stat-label">Наша цена</div><div class="stat-value" style="color:var(--acc)">${v.ourPriceNight ? money(v.ourPriceNight, v.currency) : money(v.ourPriceMonth, v.currency)}</div><div class="stat-sub">${v.ourPriceNight ? 'за ночь' : 'в месяц'}${v.ourPriceNight && v.ourPriceMonth ? ' · ' + money(v.ourPriceMonth, v.currency) + ' в месяц' : ''}</div></div>
        <div class="stat"><div class="stat-label">Маржа в месяц</div><div class="stat-value" style="color:var(--warn)">${m ? money(Math.round(m.profit), v.currency) : '—'}</div><div class="stat-sub">${m ? m.pct.toFixed(0) + '% к цене собственника' : 'укажите обе цены'}</div></div>
        <div class="stat"><div class="stat-label">Занятость (тек. месяц)</div><div class="stat-value">${occ.pct.toFixed(0)}%</div><div class="stat-sub">${occ.busy} из ${occ.total} дней</div></div>
      </div>

      ${nowB ? `<div class="panel" style="border-left:3px solid var(--acc)">
        <div class="panel-head"><h3>🟢 Сейчас в вилле</h3><div class="spacer"></div>
        <button class="btn btn-sm" data-open-b="${nowB.id}">Открыть бронь</button></div>
        <div>${esc((S.client(nowB.clientId) || {}).name || 'Без клиента')} · ${fmtRange(nowB.dateFrom, nowB.dateTo)}</div>
      </div>` : ''}

      <div class="panel" id="ov-photos"></div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h3>📞 Контакты виллы</h3></div>
          <dl class="kv">
            <dt>Собственник</dt><dd>${esc(v.ownerName || '—')}</dd>
            <dt>Телефон собственника</dt><dd>${linkPhone(v.ownerPhone)}</dd>
            <dt>WhatsApp</dt><dd>${v.ownerWhatsapp ? `<a href="${waHref(v.ownerWhatsapp)}" target="_blank" rel="noopener">${esc(v.ownerWhatsapp)}</a>` : '—'}</dd>
            <dt>E-mail собственника</dt><dd>${v.ownerEmail ? `<a href="mailto:${esc(v.ownerEmail)}">${esc(v.ownerEmail)}</a>` : '—'}</dd>
            <dt>Менеджер / хаускипер</dt><dd>${esc(v.managerName || '—')}</dd>
            <dt>Телефон менеджера</dt><dd>${linkPhone(v.managerPhone)}</dd>
            <dt>Телефон виллы</dt><dd>${linkPhone(v.villaPhone)}</dd>
            <dt>E-mail виллы</dt><dd>${v.villaEmail ? `<a href="mailto:${esc(v.villaEmail)}">${esc(v.villaEmail)}</a>` : '—'}</dd>
            <dt>Instagram</dt><dd>${v.instagram ? `<a href="https://instagram.com/${esc(String(v.instagram).replace(/^@/, ''))}" target="_blank" rel="noopener">${esc(v.instagram)}</a>` : '—'}</dd>
            <dt>Wi-Fi</dt><dd>${esc(v.wifi || '—')}</dd>
          </dl>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>📜 Условия аренды</h3></div>
          <dl class="kv">
            <dt>Договор с</dt><dd>${v.contractFrom ? fmtDate(v.contractFrom) : '—'}</dd>
            <dt>Договор по</dt><dd>${v.contractTo ? fmtDate(v.contractTo) : '—'}</dd>
            <dt>Порядок оплаты</dt><dd>${esc(v.paymentTerms || '—')}</dd>
            <dt>Депозит</dt><dd>${esc(v.deposit || '—')}</dd>
            <dt>Уведомление о выходе</dt><dd>${esc(v.notice || '—')}</dd>
            <dt>Коммунальные</dt><dd>${esc(v.utilities || '—')}</dd>
          </dl>
          ${v.terms ? `<hr class="sep"><div class="pre-wrap">${esc(v.terms)}</div>` : ''}
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h3>🏠 Объект</h3></div>
          <dl class="kv">
            <dt>Район</dt><dd>${esc(v.area || '—')}</dd>
            <dt>Спальни / санузлы</dt><dd>${esc(v.bedrooms || '—')} / ${esc(v.bathrooms || '—')}</dd>
            <dt>Бассейн</dt><dd>${esc(v.pool || '—')}</dd>
            <dt>Оригиналы фото</dt><dd>${v.driveUrl
              ? `<a href="${esc(v.driveUrl)}" target="_blank" rel="noopener">Папка на Google Диске ↗</a>${v.driveNote ? `<div class="file-sub">${esc(v.driveNote)}</div>` : ''}`
              : '<span class="mute">ссылка не задана</span>'}</dd>
          </dl>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>📝 Заметки</h3></div>
          <div class="pre-wrap">${esc(v.notes || '—')}</div>
        </div>
      </div>`;
    const ob = body.querySelector('[data-open-b]');
    if (ob) ob.onclick = () => bookingCard(ob.dataset.openB, { onChanged: rerender });
    drawPhotoStrip();
  }

  /** Лента фото в обзоре: видно сразу, грузится здесь же. */
  async function drawPhotoStrip() {
    const box = body.querySelector('#ov-photos');
    if (!box) return;
    const photos = await data.listFiles('villa', v.id, 'photo');
    box.innerHTML = `
      <div class="panel-head">
        <h3>📸 Фотографии${photos.length ? ` <span class="mute">(${photos.length})</span>` : ''}</h3>
        <div class="spacer"></div>
        ${photos.length ? '<button class="btn btn-sm" data-all>Все фото и подписи</button>' : ''}
        <button class="btn btn-sm btn-primary" data-add>+ Добавить фото</button>
      </div>
      <input type="file" accept="image/*" multiple hidden data-input>
      <div class="hint" data-prog style="margin-bottom:8px"></div>
      ${photos.length
        ? `<div class="photo-strip">${photos.slice(0, 12).map((f, i) => `
            <div class="strip-item" data-i="${i}" title="${esc(f.name)}">
              <img src="${esc(f.thumbSrc)}" alt="${esc(f.caption || f.name)}" loading="lazy">
            </div>`).join('')}
          ${photos.length > 12 ? `<div class="strip-more" data-all>+${photos.length - 12}</div>` : ''}</div>`
        : `<div class="dropzone" data-dz>Перетащите фотографии виллы сюда или нажмите — они появятся у всех сотрудников</div>`}`;

    const input = box.querySelector('[data-input]');
    const prog = box.querySelector('[data-prog]');
    const openTab = () => { sessionStorage.setItem('villaTab', 'photos'); rerender(); };
    const doUpload = async (files) => {
      const n = await uploadPhotos('villa', v.id, files, { onProgress: (t) => { prog.textContent = t; } });
      if (n) drawPhotoStrip();
    };
    box.querySelector('[data-add]').onclick = () => input.click();
    input.onchange = () => { if (input.files.length) doUpload(input.files); input.value = ''; };
    box.querySelectorAll('[data-all]').forEach((b) => { b.onclick = openTab; });
    const dz = box.querySelector('[data-dz]');
    if (dz) {
      dz.onclick = () => input.click();
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
      dz.ondragleave = () => dz.classList.remove('over');
      dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); doUpload(e.dataTransfer.files); };
    }
    box.querySelectorAll('.strip-item').forEach((el) => { el.onclick = openTab; });
  }
  function linkPhone(p) { return p ? `<a href="${phoneHref(p)}">${esc(p)}</a>` : '—'; }

  function driveBanner() {
    if (!v.driveUrl) {
      return `<div class="panel drive-panel">
        <span class="drive-ico">🗂️</span>
        <div>
          <b>Оригиналы фото на Google Диске</b>
          <div class="file-sub">В CRM снимки хранятся в рабочем размере. Добавьте ссылку на папку — оригиналы всегда будут под рукой.</div>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-sm" id="drive-set">Добавить ссылку</button>
      </div>`;
    }
    return `<div class="panel drive-panel drive-on">
      <span class="drive-ico">🗂️</span>
      <div>
        <b>Оригиналы на Google Диске</b>
        <div class="file-sub">${esc(v.driveNote || 'Полноразмерные снимки этой виллы')}</div>
      </div>
      <div class="spacer"></div>
      <a class="btn btn-sm btn-primary" href="${esc(v.driveUrl)}" target="_blank" rel="noopener">Открыть папку ↗</a>
      <button class="btn btn-sm" id="drive-edit">✎</button>
    </div>`;
  }

  function askDrive() {
    modal({
      title: 'Папка с оригиналами', size: 'narrow',
      body: `
        ${field('driveUrl', 'Ссылка на папку Google Диска', { value: v.driveUrl, placeholder: 'https://drive.google.com/drive/folders/…' })}
        <div style="margin-top:10px">${field('driveNote', 'Примечание', { value: v.driveNote, placeholder: 'Съёмка март 2026' })}</div>
        <div class="hint" style="margin-top:10px">Откройте папку на Google Диске → «Поделиться» → «Доступ по ссылке» → скопируйте ссылку сюда. Иначе сотрудник увидит запрос доступа.</div>`,
      footer: `${v.driveUrl ? '<button class="btn btn-danger left" data-clear>Убрать ссылку</button>' : ''}
        <button class="btn" data-cancel>Отмена</button><button class="btn btn-primary" data-save>Сохранить</button>`,
      onMount(el) {
        el.querySelector('[data-cancel]').onclick = closeModal;
        const clr = el.querySelector('[data-clear]');
        if (clr) clr.onclick = async () => {
          await S.saveVilla({ ...v, driveUrl: '', driveNote: '' });
          closeModal(); toast('Ссылка убрана'); rerender();
        };
        el.querySelector('[data-save]').onclick = async () => {
          const d = formData(el);
          if (d.driveUrl && !/^https?:\/\//i.test(d.driveUrl)) return toast('Ссылка должна начинаться с https://', true);
          await S.saveVilla({ ...v, driveUrl: d.driveUrl, driveNote: d.driveNote });
          closeModal(); toast('Ссылка сохранена'); rerender();
        };
      },
    });
  }

  // ---------- Локация ----------
  function drawLocation() {
    const coords = v.lat && v.lng ? { lat: Number(v.lat), lng: Number(v.lng) } : parseCoords(v.mapUrl);
    body.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>📍 Локация и Google-точка</h3><div class="spacer"></div>
          ${coords ? `<a class="btn btn-sm" href="${mapLinkUrl(coords.lat, coords.lng)}" target="_blank" rel="noopener">Открыть в Google Maps</a>` : ''}
          ${coords ? `<a class="btn btn-sm" href="https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}" target="_blank" rel="noopener">Маршрут</a>` : ''}
        </div>
        ${field('mapUrl', 'Ссылка на Google Maps', { value: v.mapUrl, placeholder: 'https://maps.app.goo.gl/… или https://www.google.com/maps/@-8.6595,115.1379,17z' })}
        <div class="row" style="margin:12px 0 14px">
          <button class="btn btn-sm btn-primary" id="save-map">Сохранить</button>
          <button class="btn btn-sm btn-ghost" id="coords-toggle">Ввести координаты вручную</button>
        </div>
        <div id="coords-box" hidden style="margin-bottom:14px">
          <div class="grid-2">
            ${field('lat', 'Широта', { value: v.lat, placeholder: '-8.6595' })}
            ${field('lng', 'Долгота', { value: v.lng, placeholder: '115.1379' })}
          </div>
          <div class="hint" style="margin-top:8px">
            Нужно только для коротких ссылок вида maps.app.goo.gl — в них координат нет.
            Откройте такую ссылку в браузере, скопируйте адрес из строки и вставьте выше, либо впишите координаты сюда.
          </div>
        </div>
        <div class="map-box">
          ${coords
            ? `<iframe src="${mapEmbedUrl(coords.lat, coords.lng)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Карта"></iframe>`
            : '<div class="map-empty">Карта появится, когда будут заданы координаты.</div>'}
        </div>
      </div>`;
    body.querySelector('#coords-toggle').onclick = () => {
      const box = body.querySelector('#coords-box');
      box.hidden = !box.hidden;
    };
    body.querySelector('#save-map').onclick = async () => {
      const d = formData(body);
      let lat = d.lat, lng = d.lng;
      if (!lat || !lng) { const c = parseCoords(d.mapUrl); if (c) { lat = c.lat; lng = c.lng; } }
      await S.saveVilla({ ...v, mapUrl: d.mapUrl, lat, lng });
      toast('Локация сохранена'); rerender();
    };
  }

  // ---------- Календарь виллы (сетка по месяцам, как в Airbnb) ----------
  function drawCalendar() {
    let start = sessionStorage.getItem('villaCalStart') || startOfMonth(today());
    const draw = () => {
      const months = Array.from({ length: 12 }, (_, i) => addMonths(start, i));
      body.innerHTML = `
        <div class="cal-toolbar">
          <button class="btn btn-sm" id="prev">‹ Назад</button>
          <button class="btn btn-sm" id="now">Сегодня</button>
          <button class="btn btn-sm" id="next">Вперёд ›</button>
          <span class="cal-label">${MONTHS[parseYmd(start).getMonth()]} ${parseYmd(start).getFullYear()} — ${MONTHS[parseYmd(months[11]).getMonth()]} ${parseYmd(months[11]).getFullYear()}</span>
          <div class="legend">
            ${Object.entries(STATUS).map(([k, s]) => `<span><i style="background:${barColor(k)}"></i>${s.label}</span>`).join('')}
          </div>
        </div>
        <div class="panel"><div class="mg-wrap">${months.map(monthGrid).join('')}</div></div>
        <div class="hint" style="margin-top:10px">Кликните на свободный день — создастся бронь с этой даты. Клик по занятому дню открывает карточку брони с контактами клиента.</div>`;
      body.querySelector('#prev').onclick = () => { start = addMonths(start, -3); sessionStorage.setItem('villaCalStart', start); draw(); };
      body.querySelector('#next').onclick = () => { start = addMonths(start, 3); sessionStorage.setItem('villaCalStart', start); draw(); };
      body.querySelector('#now').onclick = () => { start = startOfMonth(today()); sessionStorage.setItem('villaCalStart', start); draw(); };
      body.querySelectorAll('.mg-day:not(.empty)').forEach((d) => {
        d.onclick = () => {
          const date = d.dataset.d;
          const b = S.bookingOnDate(v.id, date);
          if (b) bookingCard(b.id, { onChanged: rerender });
          else bookingForm(S.emptyBooking(v.id, date, addDays(date, 5)), { onSaved: () => rerender() });
        };
      });
    };
    draw();
  }

  function monthGrid(mStart) {
    const d0 = parseYmd(mStart);
    const y = d0.getFullYear(), m = d0.getMonth();
    const dim = daysInMonth(y, m);
    const pad = dowIndex(mStart);
    let cells = '';
    for (let i = 0; i < pad; i++) cells += '<div class="mg-day empty"></div>';
    for (let day = 1; day <= dim; day++) {
      const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const b = S.bookingOnDate(v.id, date);
      const cls = [
        'mg-day',
        date === today() ? 'today' : '',
        b ? 's-' + (STATUS[b.status] || STATUS.booked).cls : '',
        b && b.dateFrom === date ? 'edge-in' : '',
        b && addDays(b.dateTo, -1) === date ? 'edge-out' : '',
      ].filter(Boolean).join(' ');
      const t = b ? `${(S.client(b.clientId) || {}).name || (STATUS[b.status] || {}).label} · ${fmtRange(b.dateFrom, b.dateTo)}` : 'Свободно';
      cells += `<div class="${cls}" data-d="${date}" title="${esc(t)}">${day}</div>`;
    }
    return `<div class="mg">
      <div class="mg-title">${MONTHS[m]} ${y}</div>
      <div class="mg-grid">${DOW.map((w) => `<div class="mg-dw">${w}</div>`).join('')}${cells}</div>
    </div>`;
  }

  // ---------- Брони ----------
  function drawBookings() {
    const bs = S.bookingsOfVilla(v.id);
    body.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>📖 Брони и заселения</h3><div class="spacer"></div>
          <button class="btn btn-sm btn-primary" id="add-b">+ Бронь</button></div>
        ${bs.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Даты</th><th>Ночей</th><th>Статус</th><th>Клиент</th><th>Контакты</th><th class="num">Сумма</th><th class="num">Остаток</th><th>Источник</th></tr></thead>
          <tbody>${bs.map((b) => {
            const c = S.client(b.clientId);
            const st = STATUS[b.status] || STATUS.booked;
            const n = S.nights(b);
            const due = num(b.priceTotal) + num(b.cleaningFee) - num(b.prepaid);
            return `<tr class="clickable" data-b="${b.id}">
              <td class="nowrap">${fmtRange(b.dateFrom, b.dateTo)}</td>
              <td>${n}</td>
              <td><span class="badge b-${st.cls}">${st.label}</span></td>
              <td>${esc(c ? c.name : '—')}</td>
              <td class="file-sub">${esc(c ? (c.phone || c.whatsapp || c.email || '') : '')}</td>
              <td class="num">${money(num(b.priceTotal) + num(b.cleaningFee), b.currency)}</td>
              <td class="num" style="color:${due > 0 ? 'var(--warn)' : 'var(--acc)'}">${money(due, b.currency)}</td>
              <td>${esc(b.source || '—')}</td>
            </tr>`;
          }).join('')}</tbody></table></div>` : '<div class="mute">Броней пока нет.</div>'}
      </div>`;
    body.querySelector('#add-b').onclick = () => bookingForm(S.emptyBooking(v.id, today(), addDays(today(), 7)), { onSaved: () => rerender() });
    body.querySelectorAll('tr[data-b]').forEach((tr) => {
      tr.onclick = () => bookingCard(tr.dataset.b, { onChanged: rerender });
    });
  }
  void plural; void fmtDateShort; void ymd; void daysBetween;
}

function barColor(k) {
  return { occupied: '#25a586', booked: '#4a90c8', option: '#cf9c34', blocked: '#c85f57' }[k] || '#666';
}

// ===== Форма виллы =====
export function villaForm(v) {
  const isNew = !S.villa(v.id);
  modal({
    title: isNew ? 'Новая вилла' : 'Редактировать виллу',
    size: 'wide',
    body: `
      <div class="grid-2">
        ${field('name', 'Название виллы', { value: v.name, placeholder: 'Villa Cinta 1', required: true })}
        ${field('area', 'Район', { value: v.area, placeholder: 'Чангу / Убуд / Улувату' })}
      </div>
      ${field('mapUrl', 'Ссылка на Google Maps', { value: v.mapUrl,
        placeholder: 'https://maps.app.goo.gl/… или https://www.google.com/maps/@-8.6595,115.1379,17z',
        hint: 'Координаты вытащим из ссылки сами — карта появится на вкладке «Локация».' })}
      <div class="grid-4">
        ${field('bedrooms', 'Спальни', { value: v.bedrooms, placeholder: '3' })}
        ${field('bathrooms', 'Санузлы', { value: v.bathrooms, placeholder: '3' })}
        ${field('pool', 'Бассейн', { value: v.pool, placeholder: 'Приватный' })}
        ${field('wifi', 'Wi-Fi', { value: v.wifi, placeholder: 'Biznet 100 Mbps' })}
      </div>

      <div class="form-section"><h4>Контакты виллы</h4>
        <div class="grid-2">
          ${field('ownerName', 'Собственник', { value: v.ownerName })}
          ${field('ownerPhone', 'Телефон собственника', { value: v.ownerPhone, placeholder: '+62 812 …' })}
        </div>
        <div class="grid-2">
          ${field('ownerWhatsapp', 'WhatsApp собственника', { value: v.ownerWhatsapp })}
          ${field('ownerEmail', 'E-mail собственника', { type: 'email', value: v.ownerEmail })}
        </div>
        <div class="grid-2">
          ${field('managerName', 'Менеджер / хаускипер', { value: v.managerName })}
          ${field('managerPhone', 'Телефон менеджера', { value: v.managerPhone })}
        </div>
        <div class="grid-3">
          ${field('villaPhone', 'Телефон виллы', { value: v.villaPhone })}
          ${field('villaEmail', 'E-mail виллы', { type: 'email', value: v.villaEmail })}
          ${field('instagram', 'Instagram', { value: v.instagram, placeholder: '@villa_cinta' })}
        </div>
      </div>

      <div class="form-section"><h4>Условия аренды</h4>
        <div class="grid-2">
          ${field('contractFrom', 'Договор с', { type: 'date', value: v.contractFrom })}
          ${field('contractTo', 'Договор по', { type: 'date', value: v.contractTo })}
        </div>
        <div class="grid-2">
          ${field('paymentTerms', 'Порядок оплаты собственнику', { value: v.paymentTerms, placeholder: 'Раз в 3 месяца вперёд' })}
          ${field('deposit', 'Депозит', { value: v.deposit, placeholder: '1000 USD' })}
        </div>
        <div class="grid-2">
          ${field('notice', 'Уведомление о расторжении', { value: v.notice, placeholder: 'за 60 дней' })}
          ${field('utilities', 'Коммунальные', { value: v.utilities, placeholder: 'Электричество и вода — на нас' })}
        </div>
        ${field('terms', 'Условия текстом', { type: 'textarea', value: v.terms, rows: 4, placeholder: 'Срок субаренды, что входит, ограничения, штрафы…' })}
      </div>

      <div class="form-section"><h4>Цены</h4>
        <div class="grid-3">
          ${field('ownerPrice', 'Цена собственника', { type: 'number', step: '0.01', value: v.ownerPrice, placeholder: '2200' })}
          ${field('ownerPeriod', 'Период', { options: Object.entries(PERIODS).map(([value, label]) => ({ value, label })), value: v.ownerPeriod })}
          ${field('currency', 'Валюта', { options: CURRENCIES, value: v.currency || S.state.settings.currency })}
        </div>
        <div class="grid-2" style="margin-top:10px">
          ${field('ourPriceNight', 'Наша цена за ночь', { type: 'number', step: '0.01', value: v.ourPriceNight, placeholder: '190' })}
          ${field('ourPriceMonth', 'Наша цена в месяц', { type: 'number', step: '0.01', value: v.ourPriceMonth, placeholder: '3600' })}
        </div>
        <div class="hint" id="margin-hint" style="margin-top:8px"></div>
      </div>

      <div class="form-section"><h4>Оригиналы фото</h4>
        ${field('driveUrl', 'Ссылка на папку Google Диска', { value: v.driveUrl, placeholder: 'https://drive.google.com/drive/folders/…',
          hint: 'В CRM фото хранятся в рабочем размере, а полные оригиналы удобно держать на Диске. Кнопка на вкладку «Фото» появится автоматически.' })}
        <div style="margin-top:10px">${field('driveNote', 'Примечание к папке', { value: v.driveNote, placeholder: 'Съёмка март 2026, фотограф Ari' })}</div>
      </div>

      ${field('notes', 'Заметки', { type: 'textarea', value: v.notes, rows: 3 })}
      <div class="hint" style="margin-top:6px">📸 Фотографии добавляются в карточке виллы — кнопка «Добавить фото» в обзоре или вкладка «Фото».</div>`,
    footer: `<button class="btn" data-cancel>Отмена</button><button class="btn btn-primary" data-save>Сохранить</button>`,
    onMount(el) {
      const upd = () => {
        const d = formData(el);
        const m = S.villaMargin({ ...v, ...d });
        el.querySelector('#margin-hint').innerHTML = m
          ? `Маржа: <b style="color:var(--warn)">${money(Math.round(m.profit), d.currency)}</b> в месяц (${m.pct.toFixed(0)}% к цене собственника)`
          : 'Укажите цену собственника и нашу цену — посчитаем маржу.';
      };
      el.addEventListener('input', upd); el.addEventListener('change', upd); upd();
      el.querySelector('[data-cancel]').onclick = closeModal;
      el.querySelector('[data-save]').onclick = async () => {
        const d = formData(el);
        if (!d.name) return toast('Введите название виллы', true);
        if ((!d.lat || !d.lng) && d.mapUrl) { const c = parseCoords(d.mapUrl); if (c) { d.lat = c.lat; d.lng = c.lng; } }
        const saved = await S.saveVilla({ ...v, ...d });
        closeModal(); toast('Вилла сохранена');
        if (isNew) location.hash = '#/villa/' + saved.id;
        else window.dispatchEvent(new Event('data-changed'));
      };
    },
  });
}
