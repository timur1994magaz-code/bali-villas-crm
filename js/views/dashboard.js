// ===== Дашборд =====
import * as S from '../store.js';
import { bookingCard } from '../booking.js';
import {
  esc, money, num, STATUS, today, addDays, addMonths, startOfMonth, fmtRange, fmtDateShort,
  monthLabel, daysBetween,
} from '../util.js';
import { plural } from '../booking.js';

export function renderDashboard(view) {
  const t = today();
  const mFrom = startOfMonth(t), mTo = addMonths(mFrom, 1);
  const occ = S.occupancy(mFrom, mTo);
  const rev = S.revenueInRange(mFrom, mTo);
  const ownerCost = S.state.villas.reduce((s, v) => {
    const m = S.villaMargin(v); return s + (m ? m.ownerMonthly : 0);
  }, 0);
  const freeNow = S.state.villas.filter((v) => !S.bookingOnDate(v.id, t));
  const busyNow = S.state.villas.length - freeNow.length;

  const soon = S.state.bookings
    .filter((b) => b.dateFrom >= t && b.dateFrom <= addDays(t, 14))
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const outs = S.state.bookings
    .filter((b) => b.dateTo >= t && b.dateTo <= addDays(t, 14))
    .sort((a, b) => a.dateTo.localeCompare(b.dateTo));
  const debts = S.state.bookings
    .filter((b) => num(b.priceTotal) + num(b.cleaningFee) - num(b.prepaid) > 0 && b.dateTo >= t)
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));

  view.innerHTML = `
    <div class="stat-row" style="margin-bottom:16px">
      <div class="stat"><div class="stat-label">Вилл в управлении</div><div class="stat-value">${S.state.villas.length}</div>
        <div class="stat-sub">${busyNow} занято · ${freeNow.length} свободно сейчас</div></div>
      <div class="stat"><div class="stat-label">Занятость · ${monthLabel(t)}</div><div class="stat-value">${occ.pct.toFixed(0)}%</div>
        <div class="stat-sub">${occ.busy} из ${occ.total} вилло-дней</div></div>
      <div class="stat"><div class="stat-label">Выручка месяца</div><div class="stat-value" style="color:var(--acc)">${money(Math.round(rev), 'USD')}</div>
        <div class="stat-sub">по броням, пропорционально дням</div></div>
      <div class="stat"><div class="stat-label">Платежи собственникам</div><div class="stat-value" style="color:var(--txt-dim)">${money(Math.round(ownerCost), 'USD')}</div>
        <div class="stat-sub">в месяц по всем виллам</div></div>
      <div class="stat"><div class="stat-label">Расчётная маржа</div><div class="stat-value" style="color:var(--warn)">${money(Math.round(rev - ownerCost), 'USD')}</div>
        <div class="stat-sub">выручка минус аренда</div></div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h3>🛬 Заезды (14 дней)</h3><div class="spacer"></div><a class="btn btn-sm" href="#/calendar">Календарь</a></div>
        ${listRows(soon, 'in')}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>🛫 Выезды (14 дней)</h3></div>
        ${listRows(outs, 'out')}
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h3>💸 Остатки к оплате</h3></div>
        ${debts.length ? `<div class="file-list">${debts.map((b) => {
          const c = S.client(b.clientId); const v = S.villa(b.villaId);
          const due = num(b.priceTotal) + num(b.cleaningFee) - num(b.prepaid);
          return `<div class="file-row" data-b="${b.id}" style="cursor:pointer">
            <span class="file-ico">💰</span>
            <div><div class="file-name">${esc(c ? c.name : 'без клиента')}</div>
              <div class="file-sub">${esc(v ? v.name : '')} · ${fmtRange(b.dateFrom, b.dateTo)}</div></div>
            <div class="spacer"></div>
            <b style="color:var(--warn)">${money(due, b.currency)}</b>
          </div>`;
        }).join('')}</div>` : '<div class="mute">Всё оплачено.</div>'}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>🟢 Свободны сегодня</h3></div>
        ${freeNow.length ? `<div class="file-list">${freeNow.map((v) => {
          const next = S.bookingsOfVilla(v.id).find((b) => b.dateFrom > t);
          return `<div class="file-row" style="cursor:pointer" data-v="${v.id}">
            <span class="file-ico">🏝️</span>
            <div><div class="file-name">${esc(v.name)}</div>
              <div class="file-sub">${esc(v.area || '')}${next ? ` · следующий заезд ${fmtDateShort(next.dateFrom)} (через ${daysBetween(t, next.dateFrom)} ${plural(daysBetween(t, next.dateFrom), 'день', 'дня', 'дней')})` : ' · броней впереди нет'}</div></div>
            <div class="spacer"></div>
            <span class="badge">${v.ourPriceNight ? money(v.ourPriceNight, v.currency) + '/ночь' : ''}</span>
          </div>`;
        }).join('')}</div>` : '<div class="mute">Все виллы заняты 🎉</div>'}
      </div>
    </div>`;

  function listRows(list, kind) {
    if (!list.length) return '<div class="mute">Ничего не запланировано.</div>';
    return `<div class="file-list">${list.map((b) => {
      const c = S.client(b.clientId); const v = S.villa(b.villaId);
      const st = STATUS[b.status] || STATUS.booked;
      const date = kind === 'in' ? b.dateFrom : b.dateTo;
      return `<div class="file-row" data-b="${b.id}" style="cursor:pointer">
        <span class="file-ico">${kind === 'in' ? '🛬' : '🛫'}</span>
        <div>
          <div class="file-name">${fmtDateShort(date)} · ${esc(v ? v.name : '—')}</div>
          <div class="file-sub">${esc(c ? c.name : st.label)}${c && c.phone ? ' · ' + esc(c.phone) : ''} · ${fmtRange(b.dateFrom, b.dateTo)}</div>
        </div>
        <div class="spacer"></div>
        <span class="badge b-${st.cls}">${st.label}</span>
      </div>`;
    }).join('')}</div>`;
  }

  view.querySelectorAll('[data-b]').forEach((el) => {
    el.onclick = () => bookingCard(el.dataset.b, { onChanged: () => renderDashboard(view) });
  });
  view.querySelectorAll('[data-v]').forEach((el) => {
    el.onclick = () => { location.hash = '#/villa/' + el.dataset.v; };
  });
}
