// ===== Общий календарь занятости (таймлайн: виллы × дни), зум день/неделя/месяц/год =====
import * as S from '../store.js';
import { bookingForm, bookingCard } from '../booking.js';
import {
  esc, STATUS, MONTHS, MONTHS_SHORT, DOW, today, ymd, parseYmd, addDays, addMonths,
  startOfWeek, startOfMonth, endOfMonth, daysBetween, isWeekend, dowIndex, fmtDate, fmtRange,
} from '../util.js';

const ZOOM = {
  day:   { px: 240, label: 'День',   span: (s) => ({ from: s, to: addDays(s, 3) }) },
  week:  { px: 112, label: 'Неделя', span: (s) => ({ from: startOfWeek(s), to: addDays(startOfWeek(s), 7) }) },
  month: { px: 34,  label: 'Месяц',  span: (s) => ({ from: startOfMonth(s), to: addDays(endOfMonth(s), 1) }) },
  year:  { px: 7,   label: 'Год',    span: (s) => ({ from: s.slice(0, 4) + '-01-01', to: (Number(s.slice(0, 4)) + 1) + '-01-01' }) },
};

let zoom = localStorage.getItem('calZoom') || 'month';
let cursor = today();
let query = '';

export function renderCalendar(view, actions) {
  actions.innerHTML = `
    <input class="search" id="cal-search" type="search" placeholder="Фильтр вилл…" value="${esc(query)}">
    <button class="btn btn-sm btn-primary" id="cal-add">+ Бронь</button>`;
  actions.querySelector('#cal-add').onclick = () =>
    bookingForm(S.emptyBooking(S.state.villas[0] ? S.state.villas[0].id : '', today(), addDays(today(), 7)), { onSaved: draw });
  actions.querySelector('#cal-search').oninput = (e) => { query = e.target.value.toLowerCase(); draw(); };

  function draw() { drawTimeline(view, draw); }
  draw();
}

function drawTimeline(view, redraw) {
  const z = ZOOM[zoom];
  const { from, to } = z.span(cursor);
  const total = daysBetween(from, to);
  const px = z.px;
  const villas = S.state.villas.filter((v) => !query ||
    [v.name, v.area, v.ownerName].join(' ').toLowerCase().includes(query));

  view.innerHTML = `
    <div class="cal-toolbar">
      <div class="seg" id="zoom-seg">
        ${Object.entries(ZOOM).map(([k, o]) => `<button data-z="${k}" class="${k === zoom ? 'active' : ''}">${o.label}</button>`).join('')}
      </div>
      <button class="btn btn-sm" id="prev">‹</button>
      <button class="btn btn-sm" id="now">Сегодня</button>
      <button class="btn btn-sm" id="next">›</button>
      <span class="cal-label">${rangeLabel(from, to)}</span>
      <div class="legend">
        ${Object.entries(STATUS).map(([k, s]) => `<span><i style="background:${color(k)}"></i>${s.label}</span>`).join('')}
      </div>
    </div>
    ${villas.length ? `
    <div class="tl" style="--namew:${zoom === 'day' ? 200 : 200}px">
      <div class="tl-scroll" id="scroll">
        <div class="tl-inner" style="min-width:${200 + total * px}px">
          <div class="tl-head">
            <div class="tl-corner">Вилла</div>
            <div class="tl-headcells" style="width:${total * px}px">
              <div class="tl-months">${monthsRow(from, total, px)}</div>
              <div class="tl-days">${daysRow(from, total, px)}</div>
            </div>
          </div>
          ${villas.map((v) => rowHtml(v, from, total, px)).join('')}
        </div>
      </div>
    </div>
    <div class="hint" style="margin-top:10px">
      Протяните мышью по строке виллы — создастся бронь на выбранный период. Клик по цветной полосе открывает бронь с контактами клиента и файлами.
    </div>` : `<div class="empty-state"><div class="big">🗓️</div><h3>Нет вилл для показа</h3><p>Добавьте виллу — и её занятость появится в календаре.</p></div>`}`;

  // навигация
  view.querySelectorAll('#zoom-seg button').forEach((b) => {
    b.onclick = () => { zoom = b.dataset.z; localStorage.setItem('calZoom', zoom); redraw(); };
  });
  view.querySelector('#prev').onclick = () => { cursor = step(cursor, -1); redraw(); };
  view.querySelector('#next').onclick = () => { cursor = step(cursor, +1); redraw(); };
  view.querySelector('#now').onclick = () => { cursor = today(); redraw(); };

  if (!villas.length) return;

  // клик по имени виллы
  view.querySelectorAll('.tl-name').forEach((n) => {
    n.onclick = () => { location.hash = '#/villa/' + n.dataset.v; };
  });
  // клик по брони
  view.querySelectorAll('.bar').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); bookingCard(b.dataset.b, { onChanged: redraw }); };
  });

  // протяжка для создания брони
  view.querySelectorAll('.tl-track').forEach((track) => {
    let startIdx = null, sel = null;
    const idxAt = (e) => {
      const r = track.getBoundingClientRect();
      return Math.max(0, Math.min(total - 1, Math.floor((e.clientX - r.left) / px)));
    };
    track.addEventListener('mousedown', (e) => {
      if (e.target.closest('.bar')) return;
      startIdx = idxAt(e);
      sel = document.createElement('div');
      sel.className = 'drag-sel';
      track.appendChild(sel);
      paint(startIdx, startIdx);
      e.preventDefault();
    });
    const paint = (a, b) => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      sel.style.left = lo * px + 'px';
      sel.style.width = (hi - lo + 1) * px + 'px';
    };
    track.addEventListener('mousemove', (e) => { if (startIdx !== null) paint(startIdx, idxAt(e)); });
    const finish = (e) => {
      if (startIdx === null) return;
      const endIdx = idxAt(e);
      const lo = Math.min(startIdx, endIdx), hi = Math.max(startIdx, endIdx);
      if (sel) sel.remove();
      startIdx = null; sel = null;
      const dFrom = addDays(from, lo), dTo = addDays(from, hi + 1);
      bookingForm(S.emptyBooking(track.dataset.v, dFrom, dTo), { onSaved: redraw });
    };
    track.addEventListener('mouseup', finish);
    track.addEventListener('mouseleave', () => { if (sel) { sel.remove(); sel = null; startIdx = null; } });
  });

  // автопрокрутка к сегодня
  const scroll = view.querySelector('#scroll');
  const tIdx = daysBetween(from, today());
  if (scroll && tIdx > 0 && tIdx < total) scroll.scrollLeft = Math.max(0, tIdx * px - 240);
}

function step(c, dir) {
  if (zoom === 'day') return addDays(c, 3 * dir);
  if (zoom === 'week') return addDays(c, 7 * dir);
  if (zoom === 'month') return addMonths(c, dir);
  return (Number(c.slice(0, 4)) + dir) + c.slice(4);
}
function rangeLabel(from, to) {
  const last = addDays(to, -1);
  if (zoom === 'year') return from.slice(0, 4) + ' год';
  if (zoom === 'month') return `${MONTHS[parseYmd(from).getMonth()]} ${from.slice(0, 4)}`;
  return `${fmtDate(from)} — ${fmtDate(last)}`;
}
function color(k) {
  return { occupied: '#25a586', booked: '#4a90c8', option: '#cf9c34', blocked: '#c85f57' }[k] || '#666';
}

function monthsRow(from, total, px) {
  let html = '', i = 0;
  while (i < total) {
    const d = parseYmd(addDays(from, i));
    const y = d.getFullYear(), m = d.getMonth();
    const monthEnd = new Date(y, m + 1, 0).getDate();
    const len = Math.min(total - i, monthEnd - d.getDate() + 1);
    const w = len * px;
    const label = w > 90 ? `${MONTHS[m]} ${y}` : w > 34 ? MONTHS_SHORT[m] : '';
    html += `<div class="tl-month" style="width:${w}px;flex:0 0 ${w}px">${label}</div>`;
    i += len;
  }
  return html;
}
function daysRow(from, total, px) {
  let html = '';
  for (let i = 0; i < total; i++) {
    const d = addDays(from, i);
    const dt = parseYmd(d);
    const cls = ['tl-day', isWeekend(d) ? 'we' : '', d === today() ? 'today' : ''].filter(Boolean).join(' ');
    const inner = px >= 26
      ? `<span class="dw">${DOW[dowIndex(d)]}</span><span>${dt.getDate()}</span>`
      : px >= 13 ? `<span>${dt.getDate()}</span>`
      : (dowIndex(d) === 0 ? `<span style="font-size:8px">${dt.getDate()}</span>` : '');
    html += `<div class="${cls}" style="width:${px}px;flex:0 0 ${px}px" title="${d}">${inner}</div>`;
  }
  return html;
}

function rowHtml(v, from, total, px) {
  const to = addDays(from, total);
  const bs = S.bookingsInRange(from, to, v.id);
  let cells = '';
  for (let i = 0; i < total; i++) {
    const d = addDays(from, i);
    const cls = ['cell', isWeekend(d) ? 'we' : '', d === today() ? 'today' : ''].filter(Boolean).join(' ');
    cells += `<div class="${cls}" style="left:${i * px}px;width:${px}px"></div>`;
  }
  const bars = bs.map((b) => {
    const s = b.dateFrom < from ? from : b.dateFrom;
    const e = b.dateTo > to ? to : b.dateTo;
    const left = daysBetween(from, s) * px;
    const w = Math.max(px * 0.6, daysBetween(s, e) * px - 2);
    const c = S.client(b.clientId);
    const st = STATUS[b.status] || STATUS.booked;
    const nights = S.nights(b);
    const title = `${v.name}\n${st.label}\n${fmtRange(b.dateFrom, b.dateTo)} (${nights} н.)\n${c ? c.name + (c.phone ? ' · ' + c.phone : '') : 'без клиента'}`;
    const text = w > 70 ? `${esc(c ? c.name : st.label)}${w > 170 ? ` <span class="bar-x">${nights} н.</span>` : ''}` : '';
    return `<div class="bar s-${st.cls}" data-b="${b.id}" style="left:${left}px;width:${w}px" title="${esc(title)}">${text}</div>`;
  }).join('');
  const occNow = S.bookingOnDate(v.id, today());
  return `<div class="tl-row">
    <div class="tl-name" data-v="${v.id}">
      <b>${esc(v.name)}</b>
      <span>${esc(v.area || '')}${occNow ? ' · 🟢 занята' : ' · свободна'}</span>
    </div>
    <div class="tl-track" data-v="${v.id}" style="width:${total * px}px">${cells}${bars}</div>
  </div>`;
}

void ymd;
