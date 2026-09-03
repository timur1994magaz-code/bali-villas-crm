// ===== База собственников: контакты вилл, собранные из Google Maps и сайтов вилл =====
import * as S from '../store.js';
import * as data from '../data.js';
import { esc, phoneHref, waHref, download, fmtDateShort, parseAmount, moneyShort } from '../util.js';
import { toast } from '../ui.js';
import { villaForm } from './villa.js';

const AREAS = ['Чангу', 'Переренан', 'Сесех', 'Чемаги', 'Мунггу', 'Тумбак Баюх'];
const REJECTS_KEY = 'baseRejects';   // с кем не сложилось
const WRITTEN_KEY = 'baseWritten';   // кому уже написали
const NOTES_KEY = 'baseNotes';       // наши заметки поверх автоматического обоснования
const FACTS_KEY = 'baseFacts';       // комнаты и цена, которые проставляем руками

// вердикт → подпись и цветовой вариант бейджа
const VERDICTS = {
  'СОБСТВЕННИК (кандидат)': { label: 'Собственник', cls: 'b-occupied', rank: 0 },
  'вероятно собственник':   { label: 'Вероятно собственник', cls: 'b-option', rank: 1 },
  'не определено':          { label: 'Не определено', cls: 'b-off', rank: 2 },
  'АГЕНТ/УК':               { label: 'Агент / УК', cls: 'b-blocked', rank: 3 },
};
const OWNERISH = ['СОБСТВЕННИК (кандидат)', 'вероятно собственник'];

let cache = null;   // json грузим один раз за сессию
let me = null;      // кто работает: подписываем отказы

// состояние фильтров держим вне рендера: живая синхронизация с другим
// сотрудником перерисовывает раздел, и иначе слетал бы поиск и выбранный район
let q = '', group = 'owners', areas = new Set(), limit = 100, onlyUnwritten = false;
let roomsMin = '', priceMin = '', priceMax = '', sort = 'best';

async function loadBase() {
  if (cache) return cache;
  const res = await fetch('assets/owners.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('файл базы не найден (' + res.status + ')');
  cache = await res.json();
  return cache;
}

const rejects = () => S.state.settings[REJECTS_KEY] || {};
const written = () => S.state.settings[WRITTEN_KEY] || {};
const notes   = () => S.state.settings[NOTES_KEY] || {};
const facts   = () => S.state.settings[FACTS_KEY] || {};

// комнаты: своё значение важнее того, что подписал Google
const roomsOf = (r) => {
  const f = facts()[r.k];
  const v = f && f.rooms != null && f.rooms !== '' ? f.rooms : r.bd;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const priceOf = (r) => {
  const f = facts()[r.k];
  const n = f && f.price != null && f.price !== '' ? Number(f.price) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

export async function renderBase(view, actions) {
  actions.innerHTML = `
    <input class="search" id="base-search" type="search" placeholder="Поиск: вилла, деревня, телефон, почта…" value="${esc(q)}">
    <div class="seg" id="base-seg">
      <button data-group="owners">Собственники</button>
      <button data-group="all">Все</button>
      <button data-group="agents">Агенты</button>
      <button data-group="rejected">Отказы</button>
    </div>
    <button class="btn" id="base-export">↓ CSV</button>`;

  view.innerHTML = '<div class="empty-state">Загружаем базу…</div>';

  let base;
  try {
    base = await loadBase();
  } catch (e) {
    view.innerHTML = `<div class="empty-state">
      <div class="big">📇</div><h3>База не загрузилась</h3>
      <p>${esc(e.message)}</p>
      <p class="hint">Файл базы намеренно не хранится в репозитории — в нём личные контакты.
      Положите <code>assets/owners.json</code> на сервер вручную:<br>
      <code>scp assets/owners.json root@сервер:/opt/bali-crm/assets/</code></p>
    </div>`;
    return;
  }
  if (me === null) { try { me = await data.currentUser(); } catch { me = false; } }

  view.innerHTML = `
    <div class="base-head">
      <div class="base-chips" id="base-areas"></div>
      <div class="base-filters">
        <button class="base-chip${onlyUnwritten ? ' active' : ''}" id="base-unwritten">✉️ Кому ещё не писали</button>
        <span class="base-fsep"></span>
        <label class="base-f">Комнат от
          <input type="number" min="0" max="20" step="1" id="f-rooms" value="${esc(roomsMin)}" placeholder="любое"></label>
        <label class="base-f">Цена, млн Rp от
          <input type="text" inputmode="decimal" id="f-pmin" value="${esc(priceMin)}" placeholder="—"></label>
        <label class="base-f">до
          <input type="text" inputmode="decimal" id="f-pmax" value="${esc(priceMax)}" placeholder="—"></label>
        <label class="base-f">Сортировка
          <select id="f-sort">
            <option value="best">по вердикту</option>
            <option value="price-asc">цена ↑</option>
            <option value="price-desc">цена ↓</option>
            <option value="rooms-asc">комнат ↑</option>
            <option value="rooms-desc">комнат ↓</option>
            <option value="name">по названию</option>
          </select></label>
        <button class="btn btn-sm" id="f-reset">Сбросить</button>
      </div>
      <div class="base-note" id="base-note"></div>
    </div>
    <div id="base-body"></div>`;

  const body = view.querySelector('#base-body');
  const note = view.querySelector('#base-note');

  actions.querySelector('#base-search').oninput = (e) => { q = e.target.value.toLowerCase(); limit = 100; draw(); };
  actions.querySelectorAll('#base-seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.group === group);
    b.onclick = () => {
      group = b.dataset.group; limit = 100;
      actions.querySelectorAll('#base-seg button').forEach((x) => x.classList.toggle('active', x === b));
      draw();
    };
  });
  actions.querySelector('#base-export').onclick = () => exportCsv(filtered());
  const fr = view.querySelector('#f-rooms'), fmin = view.querySelector('#f-pmin'),
        fmax = view.querySelector('#f-pmax'), fs = view.querySelector('#f-sort');
  fs.value = sort;
  fr.oninput = () => { roomsMin = fr.value; limit = 100; draw(); };
  fmin.oninput = () => { priceMin = fmin.value; limit = 100; draw(); };
  fmax.oninput = () => { priceMax = fmax.value; limit = 100; draw(); };
  fs.onchange = () => { sort = fs.value; draw(); };
  view.querySelector('#f-reset').onclick = () => {
    roomsMin = priceMin = priceMax = ''; sort = 'best';
    fr.value = fmin.value = fmax.value = ''; fs.value = 'best';
    limit = 100; draw();
  };
  view.querySelector('#base-unwritten').onclick = (e) => {
    onlyUnwritten = !onlyUnwritten;
    e.currentTarget.classList.toggle('active', onlyUnwritten);
    limit = 100; draw();
  };

  function drawChips() {
    const all = base.rows;
    view.querySelector('#base-areas').innerHTML =
      `<button class="base-chip${areas.size ? '' : ' active'}" data-area="">Все районы</button>` +
      AREAS.map((a) => `<button class="base-chip${areas.has(a) ? ' active' : ''}" data-area="${esc(a)}">
        ${esc(a)} <span class="mute">${all.filter((r) => r.a === a).length}</span></button>`).join('');
    view.querySelector('#base-areas').onclick = (e) => {
      const b = e.target.closest('[data-area]');
      if (!b) return;
      const k = b.dataset.area;
      if (!k) areas.clear();
      else areas.has(k) ? areas.delete(k) : areas.add(k);
      limit = 100; drawChips(); draw();
    };
  }

  function filtered() {
    const rj = rejects();
    let rows = base.rows;
    // отказы убираем из рабочих списков — они живут на своей вкладке
    rows = group === 'rejected' ? rows.filter((r) => rj[r.k]) : rows.filter((r) => !rj[r.k]);
    if (group === 'owners') rows = rows.filter((r) => OWNERISH.includes(r.d));
    if (group === 'agents') rows = rows.filter((r) => r.d === 'АГЕНТ/УК');
    if (areas.size) rows = rows.filter((r) => areas.has(r.a));
    if (onlyUnwritten) { const w = written(); rows = rows.filter((r) => !w[r.k]); }
    if (q) rows = rows.filter((r) =>
      [r.n, r.v, r.p, r.e, r.c].join(' ').toLowerCase().includes(q));

    // комнаты и цена: строки без значения из фильтра выпадают — иначе
    // непроставленные виллы засоряли бы подбор
    const rmin = parseInt(roomsMin, 10);
    if (Number.isFinite(rmin)) rows = rows.filter((r) => (roomsOf(r) ?? -1) >= rmin);
    const pmin = parseAmount(priceMin), pmax = parseAmount(priceMax);
    const mln = (v) => (v == null ? null : v < 1e6 ? v * 1e6 : v);   // «45» = 45 млн
    if (mln(pmin) != null) rows = rows.filter((r) => (priceOf(r) ?? -1) >= mln(pmin));
    if (mln(pmax) != null) rows = rows.filter((r) => priceOf(r) != null && priceOf(r) <= mln(pmax));

    const byName = (a, b) => String(a.n).localeCompare(String(b.n), 'ru');
    // строки без значения всегда в конце, как бы ни сортировали
    const nulls = (v) => (v == null ? 1 : 0);
    const cmp = {
      'price-asc':  (a, b) => nulls(priceOf(a)) - nulls(priceOf(b)) || (priceOf(a) ?? 0) - (priceOf(b) ?? 0) || byName(a, b),
      'price-desc': (a, b) => nulls(priceOf(a)) - nulls(priceOf(b)) || (priceOf(b) ?? 0) - (priceOf(a) ?? 0) || byName(a, b),
      'rooms-asc':  (a, b) => nulls(roomsOf(a)) - nulls(roomsOf(b)) || (roomsOf(a) ?? 0) - (roomsOf(b) ?? 0) || byName(a, b),
      'rooms-desc': (a, b) => nulls(roomsOf(a)) - nulls(roomsOf(b)) || (roomsOf(b) ?? 0) - (roomsOf(a) ?? 0) || byName(a, b),
      name: byName,
    }[sort] || ((a, b) =>
      (VERDICTS[a.d]?.rank ?? 9) - (VERDICTS[b.d]?.rank ?? 9) ||
      (b.e ? 1 : 0) - (a.e ? 1 : 0) || byName(a, b));
    return rows.slice().sort(cmp);
  }

  // вилла уже заведена в CRM? сверяем по названию, чтобы не плодить дубли
  const inCrm = (name) => S.state.villas.some((v) =>
    (v.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase());

  function draw() {
    const rj = rejects(), wr = written(), nt = notes(), ft = facts();
    const rjCount = Object.keys(rj).length;
    const wrCount = Object.keys(wr).length;
    const segRejected = actions.querySelector('[data-group="rejected"]');
    if (segRejected) segRejected.innerHTML = `Отказы${rjCount ? ` <span class="mute">${rjCount}</span>` : ''}`;

    const rows = filtered();
    const show = rows.slice(0, limit);
    note.innerHTML = `Показано <b>${show.length}</b> из <b>${rows.length}</b> · всего в базе ${base.rows.length} контактов${
      wrCount ? ` · написали <b>${wrCount}</b>` : ''}${rjCount ? ` · отказов ${rjCount}` : ''}
      <span class="hint">· источник: ${esc(base.source)}, собрано ${esc(base.generated)}</span>`;

    if (!rows.length) {
      body.className = '';
      body.innerHTML = `<div class="empty-state">${group === 'rejected'
        ? 'Отказов пока нет. Кнопка «Отказ» убирает контакт из рабочих списков — сюда.'
        : 'Ничего не найдено'}</div>`;
      return;
    }

    body.className = 'table-wrap';
    body.innerHTML = `<table>
      <thead><tr>
        <th>Вилла</th><th>Район</th><th>Вердикт</th><th>Контакты</th>
        <th class="num">Комнат</th><th class="num">Цена, мес.</th>
        <th>Источник</th><th>Почему так размечено</th><th></th>
      </tr></thead>
      <tbody>${show.map((r, i) => {
        const v = VERDICTS[r.d] || { label: r.d, cls: 'b-off' };
        const meta = [r.c, r.bd && r.bd + ' сп.', r.rt && '★ ' + r.rt].filter(Boolean).join(' · ');
        const links = [];
        if (r.p) links.push(`<a class="chip-link" href="${waHref(r.p)}" target="_blank" rel="noopener">WhatsApp</a>`);
        if (r.i) links.push(`<a class="chip-link" href="${esc(r.i)}" target="_blank" rel="noopener">Instagram</a>`);
        if (r.w) links.push(`<a class="chip-link" href="${esc(r.w)}" target="_blank" rel="noopener">Сайт</a>`);
        const rec = rj[r.k];
        const w = wr[r.k];
        const f = ft[r.k] || {};
        const mark = `<label class="base-written${w ? ' on' : ''}" title="Отметить, что мы написали">
            <input type="checkbox" data-written="${i}"${w ? ' checked' : ''}>
            <span>${w ? `Написали · ${esc(fmtDateShort(w.at))}` : 'Написали'}</span>
          </label>`;
        let action;
        if (rec) {
          action = `<div class="base-rejected">Отказ${rec.at ? ` · ${esc(fmtDateShort(rec.at))}` : ''}</div>
            ${rec.by ? `<div class="file-sub">${esc(rec.by)}</div>` : ''}
            <button class="btn btn-sm" data-unreject="${i}">↩ Вернуть</button>`;
        } else if (inCrm(r.n)) {
          action = `${mark}<div class="file-sub" style="margin-top:4px">уже в CRM</div>`;
        } else {
          action = `${mark}<div class="base-actions">
            <button class="btn btn-sm" data-add="${i}">+ В CRM</button>
            <button class="btn btn-sm btn-danger" data-reject="${i}">Отказ</button>
          </div>`;
        }
        return `<tr class="${rec ? 'base-row-off' : ''}${w && !rec ? ' base-row-written' : ''}">
          <td><b>${esc(r.n)}</b>${meta ? `<div class="file-sub">${esc(meta)}</div>` : ''}</td>
          <td>${esc(r.a)}${r.v ? `<div class="file-sub">${esc(r.v)}</div>` : ''}</td>
          <td><span class="badge ${v.cls}">${esc(v.label)}</span></td>
          <td>
            ${r.p ? `<a href="${phoneHref(r.p)}">${esc(r.p)}</a>` : '<span class="file-sub">—</span>'}
            ${r.e ? `<div class="file-sub"><a href="mailto:${esc(r.e)}">${esc(r.e)}</a></div>` : ''}
            ${links.length ? `<div class="chip-links" style="margin-top:6px">${links.join('')}</div>` : ''}
          </td>
          <td class="num base-fact">
            <input type="number" min="0" max="30" step="1" class="fact-in" data-rooms="${i}"
              value="${esc(f.rooms ?? '')}" placeholder="${esc(r.bd || '—')}">
            ${(f.rooms == null || f.rooms === '') && r.bd ? '<div class="file-sub">из Google</div>' : ''}
          </td>
          <td class="num base-fact">
            <input type="text" inputmode="decimal" class="fact-in" data-price="${i}"
              value="${f.price ? Math.round(f.price / 1e6) : ''}" placeholder="млн">
            ${f.price ? `<div class="file-sub">${esc(moneyShort(f.price, 'IDR'))}</div>` : ''}
          </td>
          <td><a href="https://www.google.com/maps/place/?q=place_id:${esc(r.k)}" target="_blank" rel="noopener">Google Maps ↗</a></td>
          <td class="base-why">
            ${r.y ? `<span class="file-sub">${esc(r.y)}</span>` : ''}
            <textarea class="base-note-input" rows="1" data-note="${i}"
              placeholder="Заметка…">${esc(nt[r.k] || '')}</textarea>
          </td>
          <td class="num">${action}</td>
        </tr>`;
      }).join('')}</tbody></table>
      ${rows.length > limit ? `<div class="base-more"><button class="btn" id="base-more">Показать ещё ${Math.min(100, rows.length - limit)}</button></div>` : ''}`;

    body.onclick = (e) => {
      if (e.target.id === 'base-more') { limit += 100; draw(); return; }
      const add = e.target.closest('[data-add]');
      if (add) return toCrm(show[Number(add.dataset.add)]);
      const rej = e.target.closest('[data-reject]');
      if (rej) return setReject(show[Number(rej.dataset.reject)], true);
      const un = e.target.closest('[data-unreject]');
      if (un) return setReject(show[Number(un.dataset.unreject)], false);
    };

    body.onchange = (e) => {
      const w = e.target.closest('[data-written]');
      if (w) return setWritten(show[Number(w.dataset.written)], w.checked);
      const n = e.target.closest('[data-note]');
      if (n) return saveNote(show[Number(n.dataset.note)], n.value);
      const rm = e.target.closest('[data-rooms]');
      if (rm) return saveFact(show[Number(rm.dataset.rooms)], 'rooms', rm.value);
      const pr = e.target.closest('[data-price]');
      if (pr) return saveFact(show[Number(pr.dataset.price)], 'price', pr.value);
    };
  }

  // отказ храним в общих настройках: второй сотрудник увидит его сразу
  async function setReject(r, on) {
    if (!r) return;
    const next = { ...rejects() };
    if (on) next[r.k] = { at: new Date().toISOString().slice(0, 10), by: (me && me.email) || '' };
    else delete next[r.k];
    try {
      await S.setSetting(REJECTS_KEY, next);
      draw();
      toast(on ? `«${r.n}» — отказ` : `«${r.n}» вернули в работу`);
    } catch (e) {
      toast('Не удалось сохранить: ' + e.message, true);
    }
  }

  // кому написали: отметка общая, чтобы не писать одному человеку дважды
  async function setWritten(r, on) {
    if (!r) return;
    const next = { ...written() };
    if (on) next[r.k] = { at: new Date().toISOString().slice(0, 10), by: (me && me.email) || '' };
    else delete next[r.k];
    try {
      await S.setSetting(WRITTEN_KEY, next);
      draw();
    } catch (e) {
      toast('Не удалось сохранить: ' + e.message, true);
    }
  }

  // заметка сохраняется по уходу из поля; перерисовку не делаем,
  // иначе следующее поле теряло бы фокус посреди работы
  async function saveNote(r, text) {
    if (!r) return;
    const cur = notes();
    const val = String(text || '').trim();
    if ((cur[r.k] || '') === val) return;
    const next = { ...cur };
    if (val) next[r.k] = val; else delete next[r.k];
    try {
      await S.setSetting(NOTES_KEY, next);
      toast(val ? 'Заметка сохранена' : 'Заметка удалена');
    } catch (e) {
      toast('Не удалось сохранить заметку: ' + e.message, true);
    }
  }

  // комнаты и цена: пишем в общие настройки, как заметки и отказы.
  // цену вводим в миллионах — «45» превращается в 45 000 000 Rp
  async function saveFact(r, key, raw) {
    if (!r) return;
    const cur = facts();
    const prev = cur[r.k] || {};
    let val;
    if (key === 'rooms') {
      const n = parseInt(raw, 10);
      val = Number.isFinite(n) && n >= 0 ? String(n) : '';
    } else {
      const n = parseAmount(raw);
      val = n == null || n <= 0 ? '' : (n < 1e6 ? n * 1e6 : n);
    }
    if ((prev[key] ?? '') === val) return;
    const row = { ...prev, [key]: val };
    if (row.rooms === '') delete row.rooms;
    if (row.price === '') delete row.price;
    const next = { ...cur };
    if (!Object.keys(row).length) delete next[r.k]; else next[r.k] = row;
    try {
      await S.setSetting(FACTS_KEY, next);
      draw();
    } catch (e) {
      toast('Не удалось сохранить: ' + e.message, true);
    }
  }

  // переносим строку базы в карточку виллы — форма открывается уже заполненной
  function toCrm(r) {
    if (!r) return;
    villaForm({
      ...S.emptyVilla(),
      name: r.n || '',
      area: [r.a, r.v].filter(Boolean).join(', '),
      bedrooms: String(roomsOf(r) ?? r.bd ?? ''),
      ownerPrice: priceOf(r) ? String(priceOf(r)) : '',
      ownerPeriod: 'month',
      bathrooms: r.ba || '',
      ownerPhone: r.p || '',
      ownerWhatsapp: r.p || '',
      ownerEmail: r.e || '',
      instagram: r.i || '',
      lat: r.lat != null ? String(r.lat) : '',
      lng: r.lng != null ? String(r.lng) : '',
      // формат с @координатами — из него карточка виллы сама достаёт точку для вкладки «Локация»
      mapUrl: r.lat != null ? `https://www.google.com/maps/@${r.lat},${r.lng},17z` : '',
      notes: `Из базы собственников. Вердикт: ${VERDICTS[r.d]?.label || r.d}.` +
             (r.y ? ` Признаки: ${r.y}.` : '') +
             `\nКарточка в Google Maps: https://www.google.com/maps/place/?q=place_id:${r.k}`,
    });
  }

  function exportCsv(rows) {
    if (!rows.length) return toast('В выборке пусто', true);
    const rj = rejects(), wr = written(), nt = notes();
    const cols = [['Название', 'n'], ['Район', 'a'], ['Деревня', 'v'], ['Вердикт', 'd'],
                  ['Телефон', 'p'], ['Email', 'e'], ['Instagram', 'i'], ['Сайт', 'w'],
                  ['Категория', 'c'], ['Спальни', 'bd'], ['Рейтинг', 'rt'], ['Обоснование', 'y']];
    const q1 = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const extra = ['Комнат', 'Цена в месяц, Rp', 'Написали', 'Заметка', 'Отказ'];
    const csv = [cols.map((c) => q1(c[0])).concat(extra.map(q1)).join(';')]
      .concat(rows.map((r) => cols.map((c) => q1(r[c[1]])).concat([
        q1(roomsOf(r) ?? ''),
        q1(priceOf(r) ?? ''),
        q1(wr[r.k] ? wr[r.k].at || 'да' : ''),
        q1(nt[r.k] || ''),
        q1(rj[r.k] ? rj[r.k].at || 'да' : ''),
      ]).join(';')))
      .join('\n');
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }),
             `собственники-${new Date().toISOString().slice(0, 10)}.csv`);
    toast(`Выгружено строк: ${rows.length}`);
  }

  drawChips();
  draw();
}
