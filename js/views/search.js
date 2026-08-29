// ===== Подбор виллы под запрос клиента =====
import * as S from '../store.js';
import { bookingForm } from '../booking.js';
import { coverPhoto } from '../files-ui.js';
import {
  esc, moneyShort, parseAmount, today, fmtDate, fmtDateShort, daysBetween,
} from '../util.js';
import { plural } from '../booking.js';

const KEY = 'searchParams';

function loadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { from: today(), months: 2, bedroomsMin: '', bedroomsMax: '', budget: '',
      area: '', onlyFree: true, ...saved };
  } catch (e) {
    void e;
    return { from: today(), months: 2, onlyFree: true };
  }
}
const saveParams = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { void e; } };

export function renderSearch(view, actions) {
  let p = loadParams();

  actions.innerHTML = '<button class="btn btn-sm" id="reset">Сбросить</button>';
  actions.querySelector('#reset').onclick = () => {
    localStorage.removeItem(KEY);
    p = loadParams();
    draw();
  };

  function currentRange() {
    const from = p.from || today();
    const to = p.to || S.addMonthsTo(from, Number(p.months) || 1);
    return { from, to };
  }

  function draw() {
    const { from, to } = currentRange();
    const budget = parseAmount(p.budget);
    const res = S.searchVillas({
      from, to,
      bedroomsMin: Number(p.bedroomsMin) || 0,
      bedroomsMax: Number(p.bedroomsMax) || 0,
      budget,
      area: p.area || '',
      onlyFree: !!p.onlyFree,
      onlyWithinBudget: !!budget,
    });
    const nights = daysBetween(from, to);

    view.innerHTML = `
      <div class="panel search-panel">
        <div class="grid-4">
          <label class="field"><span>Заезд</span><input type="date" name="from" value="${esc(from)}"></label>
          <label class="field"><span>Срок</span>
            <select name="months">
              ${[1, 2, 3, 4, 6, 12].map((m) => `<option value="${m}"${Number(p.months) === m && !p.to ? ' selected' : ''}>${m} ${plural(m, 'месяц', 'месяца', 'месяцев')}</option>`).join('')}
              <option value="custom"${p.to ? ' selected' : ''}>своя дата выезда</option>
            </select></label>
          <label class="field"><span>Выезд</span><input type="date" name="to" value="${esc(to)}"></label>
          <label class="field"><span>Район</span><input type="text" name="area" value="${esc(p.area || '')}" placeholder="Чангу, Убуд…"></label>
        </div>
        <div class="grid-3" style="margin-top:12px">
          <label class="field"><span>Спален от</span><input type="number" name="bedroomsMin" min="0" value="${esc(p.bedroomsMin || '')}" placeholder="2"></label>
          <label class="field"><span>Спален до</span><input type="number" name="bedroomsMax" min="0" value="${esc(p.bedroomsMax || '')}" placeholder="не важно"></label>
          <label class="field"><span>Бюджет в месяц, Rp</span>
            <input type="text" name="budget" value="${esc(p.budget || '')}" placeholder="30 млн">
            <span class="hint">можно писать «30 млн», «30jt» или 30000000</span></label>
        </div>
        <div class="row" style="margin-top:12px">
          <label class="check"><input type="checkbox" name="onlyFree"${p.onlyFree ? ' checked' : ''}> Только полностью свободные на весь срок</label>
          <div class="spacer" style="margin-left:auto"></div>
          <span class="hint">${fmtDate(from)} → ${fmtDate(to)} · ${nights} ${plural(nights, 'ночь', 'ночи', 'ночей')}${budget ? ` · бюджет ${moneyShort(budget)} в месяц` : ''}</span>
        </div>
      </div>

      <div class="row" style="margin:14px 0 10px">
        <b>${res.rows.length ? `Подходит вилл: ${res.rows.length}` : 'Ничего не подошло'}</b>
        <span class="mute">из ${S.state.villas.length}</span>
        ${budget ? '<span class="hint">сортировка по цене, дешёвые сверху</span>' : ''}
      </div>

      <div id="results"></div>`;

    // ---- реакция на ввод ----
    const grab = () => {
      const el = view.querySelector('.search-panel');
      const get = (n) => el.querySelector(`[name=${n}]`);
      const next = {
        from: get('from').value || today(),
        months: get('months').value,
        to: get('to').value,
        area: get('area').value.trim(),
        bedroomsMin: get('bedroomsMin').value,
        bedroomsMax: get('bedroomsMax').value,
        budget: get('budget').value.trim(),
        onlyFree: get('onlyFree').checked,
      };
      return next;
    };
    view.querySelector('.search-panel').addEventListener('change', (e) => {
      const next = grab();
      if (e.target.name === 'months' && next.months !== 'custom') {
        next.to = '';                                   // срок задан месяцами — дату выезда считаем сами
      } else if (e.target.name === 'to' || e.target.name === 'from') {
        if (e.target.name === 'to') next.months = 'custom';
      }
      p = { ...p, ...next };
      if (p.months === 'custom' && !p.to) p.to = S.addMonthsTo(p.from, 1);
      if (p.months !== 'custom') p.to = '';
      saveParams(p);
      draw();
    });
    view.querySelector('[name=budget]').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { p = { ...p, ...grab() }; saveParams(p); draw(); }
    });

    drawResults(res, from, to, budget);
  }

  async function drawResults(res, from, to, budget) {
    const box = view.querySelector('#results');
    if (!res.rows.length) {
      const hint = S.state.villas.length
        ? 'Смягчите условия: увеличьте бюджет, снимите галочку «только полностью свободные» или расширьте число спален.'
        : 'Сначала добавьте виллы в разделе «Виллы».';
      box.innerHTML = `<div class="empty-state"><div class="big">🔎</div><h3>Ничего не подошло</h3><p>${hint}</p></div>`;
      return;
    }

    box.className = 'search-results';
    box.innerHTML = res.rows.map((r) => {
      const v = r.villa;
      const av = r.availability;
      const status = av.fullyFree
        ? '<span class="badge b-occupied">свободна весь срок</span>'
        : av.freeFrom
          ? `<span class="badge b-option">свободна с ${fmtDateShort(av.freeFrom)}</span>`
          : av.freeDays
            ? `<span class="badge b-booked">свободно ${av.freeDays} из ${av.total} дней</span>`
            : '<span class="badge b-blocked">занята весь срок</span>';

      const busyList = av.busy.length
        ? `<div class="file-sub" style="margin-top:4px">Занята: ${av.busy.map((b) =>
            `${fmtDateShort(b.start)}–${fmtDateShort(b.end)}${(S.client(b.booking.clientId) || {}).name ? ' · ' + esc((S.client(b.booking.clientId) || {}).name) : ''}`).join(', ')}</div>`
        : '';

      return `<div class="search-card" data-id="${v.id}">
        <div class="search-cover" data-cover="${v.id}">🏝️</div>
        <div class="search-main">
          <div class="row" style="gap:8px">
            <b class="search-name">${esc(v.name)}</b>
            ${status}
          </div>
          <div class="villa-meta">
            ${v.bedrooms ? `<span>🛏 ${esc(v.bedrooms)} ${plural(Number(v.bedrooms) || 0, 'спальня', 'спальни', 'спален')}</span>` : ''}
            ${v.area ? `<span>📍 ${esc(v.area)}</span>` : ''}
            ${v.pool ? `<span>🏊 ${esc(v.pool)}</span>` : ''}
          </div>
          ${busyList}
        </div>
        <div class="search-money">
          <div class="search-price ${r.overBudget ? 'over' : ''}">${r.price ? moneyShort(r.price.amount) : '—'}<span class="mute"> / мес</span></div>
          ${r.price && r.price.approx ? '<div class="file-sub">по цене за ночь × 30</div>' : ''}
          ${r.periodTotal ? `<div class="file-sub">за срок ≈ ${moneyShort(r.periodTotal)}</div>` : ''}
          ${budget && r.price ? `<div class="file-sub ${r.overBudget ? 'over-text' : 'ok-text'}">${r.overBudget
            ? 'дороже на ' + moneyShort(r.price.amount - budget)
            : 'в бюджете, запас ' + moneyShort(budget - r.price.amount)}</div>` : ''}
        </div>
        <div class="search-actions">
          <button class="btn btn-sm btn-primary" data-book="${v.id}">Забронировать</button>
          <a class="btn btn-sm" href="#/villa/${v.id}">Карточка</a>
        </div>
      </div>`;
    }).join('');

    box.querySelectorAll('[data-book]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const av = res.rows.find((r) => r.villa.id === b.dataset.book).availability;
        const start = av.fullyFree ? from : (av.freeFrom || from);
        bookingForm(S.emptyBooking(b.dataset.book, start, to), { onSaved: () => draw() });
      };
    });
    box.querySelectorAll('.search-card').forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest('button, a')) return;
        location.hash = '#/villa/' + card.dataset.id;
      };
    });

    for (const r of res.rows) {
      const cover = await coverPhoto('villa', r.villa.id);
      const el = box.querySelector(`[data-cover="${r.villa.id}"]`);
      if (cover && el) el.innerHTML = `<img src="${esc(cover.src)}" alt="${esc(r.villa.name)}">`;
    }
  }

  draw();
}
