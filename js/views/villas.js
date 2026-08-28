// ===== Список вилл =====
import * as S from '../store.js';
import { esc, money, num, PERIODS, sortBy } from '../util.js';
import { coverPhoto } from '../files-ui.js';
import { villaForm } from './villa.js';

export async function renderVillasList(view, actions) {
  actions.innerHTML = `
    <input class="search" id="villa-search" type="search" placeholder="Поиск виллы, района, собственника…">
    <div class="seg" id="mode-seg">
      <button data-mode="cards" class="active">Карточки</button>
      <button data-mode="table">Таблица</button>
    </div>
    <button class="btn btn-primary" id="add-villa">+ Вилла</button>`;

  const box = document.createElement('div');
  view.innerHTML = '';
  view.appendChild(box);

  let mode = localStorage.getItem('villasMode') || 'cards';
  let q = '';
  actions.querySelectorAll('#mode-seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
    b.onclick = () => {
      mode = b.dataset.mode; localStorage.setItem('villasMode', mode);
      actions.querySelectorAll('#mode-seg button').forEach((x) => x.classList.toggle('active', x === b));
      draw();
    };
  });
  actions.querySelector('#add-villa').onclick = () => villaForm(S.emptyVilla());
  actions.querySelector('#villa-search').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };

  async function draw() {
    const list = sortBy(S.state.villas, 'name').filter((v) => !q ||
      [v.name, v.area, v.address, v.ownerName, v.notes].join(' ').toLowerCase().includes(q));

    if (!S.state.villas.length) {
      box.innerHTML = `<div class="empty-state">
        <div class="big">🏝️</div><h3>Вилл пока нет</h3>
        <p>Добавьте первую виллу — название, контакты, условия аренды и цены.</p>
        <button class="btn btn-primary" id="empty-add">+ Добавить виллу</button>
        <p class="hint" style="margin-top:18px">Или загрузите демо-данные в разделе «Настройки», чтобы посмотреть, как всё устроено.</p>
      </div>`;
      box.querySelector('#empty-add').onclick = () => villaForm(S.emptyVilla());
      return;
    }
    if (!list.length) { box.innerHTML = '<div class="empty-state">Ничего не найдено</div>'; return; }

    if (mode === 'table') return drawTable(list);
    drawCards(list);
  }

  function statsOf(v) {
    const m = S.villaMargin(v);
    const bs = S.bookingsOfVilla(v.id);
    return { m, count: bs.length };
  }

  async function drawCards(list) {
    box.className = 'villa-grid';
    box.innerHTML = list.map((v) => {
      const { m, count } = statsOf(v);
      return `<div class="villa-card" data-id="${v.id}">
        <div class="villa-cover" data-cover="${v.id}">🏝️</div>
        <div class="villa-card-body">
          <div class="villa-name">${esc(v.name || 'Без названия')}</div>
          <div class="villa-meta">
            ${v.area ? `<span>📍 ${esc(v.area)}</span>` : ''}
            ${v.bedrooms ? `<span>🛏 ${esc(v.bedrooms)}</span>` : ''}
            ${count ? `<span>🗓️ ${count}</span>` : ''}
          </div>
          <div class="price-row">
            <div class="price-box price-owner"><span class="mute">Собственнику</span><b>${money(v.ownerPrice, v.currency)}</b><span class="mute">${PERIODS[v.ownerPeriod] || ''}</span></div>
            <div class="price-box price-ours"><span class="mute">Наша цена</span><b>${v.ourPriceMonth ? money(v.ourPriceMonth, v.currency) : money(v.ourPriceNight, v.currency)}</b><span class="mute">${v.ourPriceMonth ? 'в месяц' : 'за ночь'}</span></div>
            ${m ? `<div class="price-box price-margin"><span class="mute">Маржа</span><b>${money(Math.round(m.profit), v.currency)}</b><span class="mute">${m.pct.toFixed(0)}%</span></div>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
    box.onclick = (e) => {
      const card = e.target.closest('.villa-card');
      if (card) location.hash = '#/villa/' + card.dataset.id;
    };
    for (const v of list) {
      const cover = await coverPhoto('villa', v.id);
      const el = box.querySelector(`[data-cover="${v.id}"]`);
      if (cover && el) el.innerHTML = `<img src="${esc(cover.src)}" alt="${esc(v.name)}"><span class="photo-count">📸 ${cover.count}</span>`;
    }
  }

  function drawTable(list) {
    box.className = 'table-wrap';
    box.innerHTML = `<table>
      <thead><tr>
        <th>Вилла</th><th>Локация</th><th>Контакты</th><th>Условия</th>
        <th class="num">Цена собственника</th><th class="num">Наша цена</th><th class="num">Маржа</th><th class="num">Броней</th>
      </tr></thead>
      <tbody>${list.map((v) => {
        const { m, count } = statsOf(v);
        return `<tr class="clickable" data-id="${v.id}">
          <td><b>${esc(v.name)}</b>${v.bedrooms ? `<div class="file-sub">${esc(v.bedrooms)} спальни</div>` : ''}</td>
          <td>${esc(v.area || '—')}</td>
          <td>${esc(v.ownerName || v.managerName || '—')}<div class="file-sub">${esc(v.ownerPhone || v.managerPhone || v.villaPhone || '')}</div></td>
          <td style="max-width:260px">${esc((v.terms || v.paymentTerms || '—').slice(0, 90))}${(v.terms || '').length > 90 ? '…' : ''}</td>
          <td class="num">${money(v.ownerPrice, v.currency)}<div class="file-sub">${PERIODS[v.ownerPeriod] || ''}</div></td>
          <td class="num">${v.ourPriceMonth ? money(v.ourPriceMonth, v.currency) + '<div class="file-sub">в месяц</div>' : ''}${v.ourPriceNight ? money(v.ourPriceNight, v.currency) + '<div class="file-sub">за ночь</div>' : ''}</td>
          <td class="num" style="color:var(--warn)">${m ? money(Math.round(m.profit), v.currency) + `<div class="file-sub">${m.pct.toFixed(0)}%</div>` : '—'}</td>
          <td class="num">${count}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
    box.onclick = (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) location.hash = '#/villa/' + tr.dataset.id;
    };
  }

  draw();
  void num;
}
