// ===== База собственников: контакты вилл, собранные из Google Maps и сайтов вилл =====
import * as S from '../store.js';
import { esc, phoneHref, waHref, download } from '../util.js';
import { toast } from '../ui.js';
import { villaForm } from './villa.js';

const AREAS = ['Чангу', 'Переренан', 'Сесех', 'Чемаги', 'Мунггу', 'Тумбак Баюх'];

// вердикт → подпись и цветовой вариант бейджа
const VERDICTS = {
  'СОБСТВЕННИК (кандидат)': { label: 'Собственник', cls: 'b-occupied', rank: 0 },
  'вероятно собственник':   { label: 'Вероятно собственник', cls: 'b-option', rank: 1 },
  'не определено':          { label: 'Не определено', cls: 'b-off', rank: 2 },
  'АГЕНТ/УК':               { label: 'Агент / УК', cls: 'b-blocked', rank: 3 },
};
const OWNERISH = ['СОБСТВЕННИК (кандидат)', 'вероятно собственник'];

let cache = null;   // json грузим один раз за сессию

async function loadBase() {
  if (cache) return cache;
  const res = await fetch('assets/owners.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('файл базы не найден (' + res.status + ')');
  cache = await res.json();
  return cache;
}

export async function renderBase(view, actions) {
  actions.innerHTML = `
    <input class="search" id="base-search" type="search" placeholder="Поиск: вилла, деревня, телефон, почта…">
    <div class="seg" id="base-seg">
      <button data-group="owners" class="active">Собственники</button>
      <button data-group="all">Все</button>
      <button data-group="agents">Агенты</button>
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

  let q = '', group = 'owners', areas = new Set(), limit = 100;

  view.innerHTML = `
    <div class="base-head">
      <div class="base-chips" id="base-areas"></div>
      <div class="base-note" id="base-note"></div>
    </div>
    <div id="base-body"></div>`;

  const body = view.querySelector('#base-body');
  const note = view.querySelector('#base-note');

  actions.querySelector('#base-search').oninput = (e) => { q = e.target.value.toLowerCase(); limit = 100; draw(); };
  actions.querySelectorAll('#base-seg button').forEach((b) => {
    b.onclick = () => {
      group = b.dataset.group; limit = 100;
      actions.querySelectorAll('#base-seg button').forEach((x) => x.classList.toggle('active', x === b));
      draw();
    };
  });
  actions.querySelector('#base-export').onclick = () => exportCsv(filtered());

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
    let rows = base.rows;
    if (group === 'owners') rows = rows.filter((r) => OWNERISH.includes(r.d));
    if (group === 'agents') rows = rows.filter((r) => r.d === 'АГЕНТ/УК');
    if (areas.size) rows = rows.filter((r) => areas.has(r.a));
    if (q) rows = rows.filter((r) =>
      [r.n, r.v, r.p, r.e, r.c].join(' ').toLowerCase().includes(q));
    return rows.slice().sort((a, b) =>
      (VERDICTS[a.d]?.rank ?? 9) - (VERDICTS[b.d]?.rank ?? 9) ||
      (b.e ? 1 : 0) - (a.e ? 1 : 0) ||
      String(a.n).localeCompare(String(b.n), 'ru'));
  }

  // вилла уже заведена в CRM? сверяем по названию, чтобы не плодить дубли
  const inCrm = (name) => S.state.villas.some((v) =>
    (v.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase());

  function draw() {
    const rows = filtered();
    const show = rows.slice(0, limit);
    note.innerHTML = `Показано <b>${show.length}</b> из <b>${rows.length}</b> · всего в базе ${base.rows.length} контактов
      <span class="hint">· источник: ${esc(base.source)}, собрано ${esc(base.generated)}</span>`;

    if (!rows.length) { body.innerHTML = '<div class="empty-state">Ничего не найдено</div>'; return; }

    body.className = 'table-wrap';
    body.innerHTML = `<table>
      <thead><tr>
        <th>Вилла</th><th>Район</th><th>Вердикт</th><th>Контакты</th>
        <th>Источник</th><th>Почему так размечено</th><th></th>
      </tr></thead>
      <tbody>${show.map((r, i) => {
        const v = VERDICTS[r.d] || { label: r.d, cls: 'b-off' };
        const meta = [r.c, r.bd && r.bd + ' сп.', r.rt && '★ ' + r.rt].filter(Boolean).join(' · ');
        const links = [];
        if (r.p) links.push(`<a class="chip-link" href="${waHref(r.p)}" target="_blank" rel="noopener">WhatsApp</a>`);
        if (r.i) links.push(`<a class="chip-link" href="${esc(r.i)}" target="_blank" rel="noopener">Instagram</a>`);
        if (r.w) links.push(`<a class="chip-link" href="${esc(r.w)}" target="_blank" rel="noopener">Сайт</a>`);
        const added = inCrm(r.n);
        return `<tr>
          <td><b>${esc(r.n)}</b>${meta ? `<div class="file-sub">${esc(meta)}</div>` : ''}</td>
          <td>${esc(r.a)}${r.v ? `<div class="file-sub">${esc(r.v)}</div>` : ''}</td>
          <td><span class="badge ${v.cls}">${esc(v.label)}</span></td>
          <td>
            ${r.p ? `<a href="${phoneHref(r.p)}">${esc(r.p)}</a>` : '<span class="file-sub">—</span>'}
            ${r.e ? `<div class="file-sub"><a href="mailto:${esc(r.e)}">${esc(r.e)}</a></div>` : ''}
            ${links.length ? `<div class="chip-links" style="margin-top:6px">${links.join('')}</div>` : ''}
          </td>
          <td><a href="https://www.google.com/maps/place/?q=place_id:${esc(r.k)}" target="_blank" rel="noopener">Google Maps ↗</a></td>
          <td style="max-width:230px"><span class="file-sub">${esc(r.y || '')}</span></td>
          <td class="num">${added
            ? '<span class="file-sub">уже в CRM</span>'
            : `<button class="btn btn-sm" data-add="${i}">+ В CRM</button>`}</td>
        </tr>`;
      }).join('')}</tbody></table>
      ${rows.length > limit ? `<div class="base-more"><button class="btn" id="base-more">Показать ещё ${Math.min(100, rows.length - limit)}</button></div>` : ''}`;

    body.onclick = (e) => {
      if (e.target.id === 'base-more') { limit += 100; draw(); return; }
      const add = e.target.closest('[data-add]');
      if (add) toCrm(show[Number(add.dataset.add)]);
    };
  }

  // переносим строку базы в карточку виллы — форма открывается уже заполненной
  function toCrm(r) {
    if (!r) return;
    villaForm({
      ...S.emptyVilla(),
      name: r.n || '',
      area: [r.a, r.v].filter(Boolean).join(', '),
      bedrooms: r.bd || '',
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
    const cols = [['Название', 'n'], ['Район', 'a'], ['Деревня', 'v'], ['Вердикт', 'd'],
                  ['Телефон', 'p'], ['Email', 'e'], ['Instagram', 'i'], ['Сайт', 'w'],
                  ['Категория', 'c'], ['Спальни', 'bd'], ['Рейтинг', 'rt'], ['Обоснование', 'y']];
    const q1 = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.map((c) => q1(c[0])).join(';')]
      .concat(rows.map((r) => cols.map((c) => q1(r[c[1]])).join(';')))
      .join('\n');
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }),
             `собственники-${new Date().toISOString().slice(0, 10)}.csv`);
    toast(`Выгружено строк: ${rows.length}`);
  }

  drawChips();
  draw();
}
