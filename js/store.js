// ===== Хранилище данных приложения (поверх IndexedDB) =====
import * as db from './db.js';
import * as data from './data.js';
import { ymd, overlaps, num, daysBetween, today } from './util.js';

export const state = { villas: [], bookings: [], clients: [], settings: {} };
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((f) => f()); }

export async function load() {
  const { villas, bookings, clients, settings } = await data.loadAll();
  state.villas = villas.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  state.bookings = bookings.sort((a, b) => String(a.dateFrom).localeCompare(String(b.dateFrom)));
  state.clients = clients.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  state.settings = settings || {};
  state.settings.currency = 'IDR';   // единственная валюта
  emit();
}

export const villa = (id) => state.villas.find((v) => v.id === id) || null;
export const client = (id) => state.clients.find((c) => c.id === id) || null;
export const booking = (id) => state.bookings.find((b) => b.id === id) || null;

// ===== Виллы =====
export function emptyVilla() {
  return {
    id: db.uid(), name: '', area: '', address: '', bedrooms: '', bathrooms: '', pool: '',
    ownerName: '', ownerPhone: '', ownerWhatsapp: '', ownerEmail: '',
    managerName: '', managerPhone: '', villaPhone: '', villaEmail: '', instagram: '',
    contractFrom: '', contractTo: '', paymentTerms: '', deposit: '', notice: '', terms: '',
    ownerPrice: '', ownerPeriod: 'month', ourPriceNight: '', ourPriceMonth: '', currency: 'IDR',
    utilities: '', mapUrl: '', lat: '', lng: '', wifi: '', notes: '', status: 'active',
    driveUrl: '', driveNote: '', mapPlace: '',
    createdAt: new Date().toISOString(),
  };
}
export async function saveVilla(v) {
  v.updatedAt = new Date().toISOString();
  if (!v.createdAt) v.createdAt = v.updatedAt;
  await data.putRow('villas', v);
  await load();
  return v;
}
export async function deleteVilla(id) {
  const bs = state.bookings.filter((b) => b.villaId === id);
  for (const b of bs) { await data.removeFilesOf('booking', b.id); await data.delRow('bookings', b.id); }
  await data.removeFilesOf('villa', id);
  await data.delRow('villas', id);
  await load();
}

// ===== Клиенты =====
export function emptyClient() {
  return {
    id: db.uid(), name: '', phone: '', whatsapp: '', telegram: '', email: '',
    instagram: '', source: '', notes: '',
    budget: '', wantBedrooms: '', wantArea: '',   // запрос клиента: бюджет, комнаты, желаемый район
    country: '', passport: '',                     // остались для старых записей, в интерфейсе не показываются
    createdAt: new Date().toISOString(),
  };
}
export async function saveClient(c) {
  c.updatedAt = new Date().toISOString();
  if (!c.createdAt) c.createdAt = c.updatedAt;
  await data.putRow('clients', c);
  await load();
  return c;
}
export async function deleteClient(id) {
  await data.removeFilesOf('client', id);
  for (const b of state.bookings.filter((b) => b.clientId === id)) {
    b.clientId = ''; await data.putRow('bookings', b);
  }
  await data.delRow('clients', id);
  await load();
}

// ===== Брони =====
export function emptyBooking(villaId = '', dateFrom = today(), dateTo = '') {
  return {
    id: db.uid(), villaId, clientId: '',
    dateFrom, dateTo: dateTo || dateFrom,
    status: 'booked', guests: '', priceTotal: '', prepaid: '', currency: 'IDR',
    source: '', notes: '', createdAt: new Date().toISOString(),
  };
}
export async function saveBooking(b) {
  b.updatedAt = new Date().toISOString();
  if (!b.createdAt) b.createdAt = b.updatedAt;
  await data.putRow('bookings', b);
  await load();
  return b;
}
export async function deleteBooking(id) {
  await data.removeFilesOf('booking', id);
  await data.delRow('bookings', id);
  await load();
}

// Конфликты: даты заезда/выезда считаем как [from, to) — день выезда свободен
export function conflicts(b) {
  return state.bookings.filter((x) =>
    x.id !== b.id && x.villaId === b.villaId && x.status !== 'cancelled' &&
    overlaps(b.dateFrom, b.dateTo, x.dateFrom, x.dateTo));
}
export const nights = (b) => Math.max(0, daysBetween(b.dateFrom, b.dateTo));

export function bookingsOfVilla(id) {
  return state.bookings.filter((b) => b.villaId === id)
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
}
export function bookingsOfClient(id) {
  return state.bookings.filter((b) => b.clientId === id)
    .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));
}
export function bookingsInRange(from, to, villaId = null) {
  return state.bookings.filter((b) =>
    (!villaId || b.villaId === villaId) && overlaps(b.dateFrom, b.dateTo, from, to));
}
export function bookingOnDate(villaId, date) {
  return state.bookings.find((b) => b.villaId === villaId && b.dateFrom <= date && date < b.dateTo) || null;
}

// ===== Финансы / аналитика =====
export function villaMargin(v) {
  const owner = num(v.ownerPrice);
  const ours = num(v.ourPriceMonth) || (num(v.ourPriceNight) ? num(v.ourPriceNight) * 30 : 0);
  const ownerMonthly = v.ownerPeriod === 'year' ? owner / 12 : v.ownerPeriod === 'night' ? owner * 30 : owner;
  if (!ownerMonthly || !ours) return null;
  return { ownerMonthly, ours, profit: ours - ownerMonthly, pct: ((ours - ownerMonthly) / ownerMonthly) * 100 };
}
export function occupancy(from, to, villaId = null) {
  const villas = villaId ? [villa(villaId)].filter(Boolean) : state.villas;
  const total = villas.length * Math.max(1, daysBetween(from, to));
  let busy = 0;
  for (const v of villas) {
    for (const b of bookingsInRange(from, to, v.id)) {
      const s = b.dateFrom > from ? b.dateFrom : from;
      const e = b.dateTo < to ? b.dateTo : to;
      busy += Math.max(0, daysBetween(s, e));
    }
  }
  return { busy, total, pct: total ? (busy / total) * 100 : 0 };
}
export function revenueInRange(from, to) {
  let sum = 0;
  for (const b of bookingsInRange(from, to)) {
    const n = nights(b);
    if (!n || !num(b.priceTotal)) continue;
    const s = b.dateFrom > from ? b.dateFrom : from;
    const e = b.dateTo < to ? b.dateTo : to;
    sum += num(b.priceTotal) * (Math.max(0, daysBetween(s, e)) / n);
  }
  return sum;
}

// ===== Настройки =====
export async function setSetting(key, value) {
  await data.putRow('settings', { key, value });
  state.settings[key] = value;
  emit();
}

// ===== Экспорт / импорт живёт в backup.js (папка / ZIP / JSON) =====

export async function wipeAll() {
  await data.clearEverything();
  await load();
}

// ===== Демо-данные =====
export async function seedDemo() {
  const v1 = { ...emptyVilla(), name: 'Villa Cinta 1', area: 'Чангу (Berawa)', bedrooms: '3', bathrooms: '3', pool: 'Приватный 8×3',
    ownerName: 'Pak Wayan', ownerPhone: '+62 812 3456 7890', ownerWhatsapp: '+62 812 3456 7890',
    managerName: 'Kadek (менеджер)', managerPhone: '+62 813 1111 2222',
    contractFrom: ymd(new Date()), contractTo: '', paymentTerms: 'Оплата собственнику раз в 3 месяца вперёд',
    deposit: '16 млн Rp', notice: 'Уведомление о расторжении за 60 дней',
    terms: 'Долгосрочная субаренда на 12 месяцев. Электричество и вода — на нас, налог PB1 — на собственнике. Разрешена посуточная сдача.',
    ownerPrice: '36000000', ownerPeriod: 'month', ourPriceNight: '3100000', ourPriceMonth: '58000000', currency: 'IDR',
    mapUrl: 'https://www.google.com/maps/@-8.6595,115.1379,17z', lat: '-8.6595', lng: '115.1379',
    wifi: 'Biznet 100 Mbps', notes: 'Уборка 3 раза в неделю включена.' };
  const v2 = { ...emptyVilla(), name: 'Villa Sunset Uluwatu', area: 'Улувату (Bingin)', bedrooms: '2', bathrooms: '2', pool: 'Инфинити',
    ownerName: 'Made Sutrisna', ownerPhone: '+62 878 9999 1234', ownerWhatsapp: '+62 878 9999 1234',
    contractFrom: ymd(new Date()), paymentTerms: 'Полгода вперёд', deposit: '24 млн Rp',
    terms: 'Субаренда 24 месяца, продление по той же ставке +7%.',
    ownerPrice: '29000000', ownerPeriod: 'month', ourPriceNight: '2600000', ourPriceMonth: '50000000', currency: 'IDR',
    mapUrl: 'https://www.google.com/maps/@-8.8065,115.1141,17z', lat: '-8.8065', lng: '115.1141' };
  await data.putRow('villas', v1); await data.putRow('villas', v2);

  const c1 = { ...emptyClient(), name: 'Анна Петрова', phone: '+7 916 123-45-67', whatsapp: '+79161234567',
    telegram: '@anna_p', email: 'anna@example.com', country: 'Россия', source: 'Instagram' };
  const c2 = { ...emptyClient(), name: 'James Miller', phone: '+61 400 111 222', whatsapp: '+61400111222',
    email: 'james@example.com', country: 'Австралия', source: 'Airbnb' };
  await data.putRow('clients', c1); await data.putRow('clients', c2);

  const t = today();
  await data.putRow('bookings', { ...emptyBooking(v1.id, t, ''), dateFrom: t, dateTo: addD(t, 9),
    clientId: c1.id, status: 'occupied', guests: '2', priceTotal: '27900000', prepaid: '14000000', currency: 'IDR', source: 'Instagram' });
  await data.putRow('bookings', { ...emptyBooking(v1.id), dateFrom: addD(t, 14), dateTo: addD(t, 27),
    clientId: c2.id, status: 'booked', guests: '4', priceTotal: '40300000', prepaid: '11000000', currency: 'IDR', source: 'Airbnb' });
  await data.putRow('bookings', { ...emptyBooking(v2.id), dateFrom: addD(t, 3), dateTo: addD(t, 12),
    clientId: c2.id, status: 'booked', guests: '2', priceTotal: '23400000', currency: 'IDR', source: 'Booking.com' });
  await data.putRow('bookings', { ...emptyBooking(v2.id), dateFrom: addD(t, 30), dateTo: addD(t, 35),
    status: 'blocked', notes: 'Ремонт бассейна' });
  await load();
}
function addD(s, n) { const d = new Date(s); d.setDate(d.getDate() + n); return ymd(d); }

// ===== Подбор виллы под запрос клиента =====

/**
 * Месячная цена виллы для сравнения с бюджетом.
 * Если задана только цена за ночь, считаем по 30 ночей и помечаем как приблизительную.
 */
export function monthlyPrice(v) {
  const month = num(v.ourPriceMonth);
  if (month) return { amount: month, approx: false };
  const night = num(v.ourPriceNight);
  if (night) return { amount: night * 30, approx: true };
  return null;
}

/**
 * Занятость виллы в периоде [from, to): свободные и занятые отрезки.
 * Отдельно считаем, с какой даты вилла свободна до конца периода —
 * это ответ на «а когда освободится».
 */
export function availability(villaId, from, to) {
  const total = Math.max(0, daysBetween(from, to));
  const busy = bookingsInRange(from, to, villaId)
    .map((b) => ({
      booking: b,
      start: b.dateFrom > from ? b.dateFrom : from,
      end: b.dateTo < to ? b.dateTo : to,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));

  const free = [];
  let cursor = from;
  for (const seg of busy) {
    if (seg.start > cursor) free.push({ start: cursor, end: seg.start });
    if (seg.end > cursor) cursor = seg.end;
  }
  if (cursor < to) free.push({ start: cursor, end: to });

  const busyDays = busy.reduce((s, x) => s + Math.max(0, daysBetween(x.start, x.end)), 0);
  const tail = free.length && free[free.length - 1].end === to ? free[free.length - 1] : null;

  return {
    total,
    busyDays,
    freeDays: Math.max(0, total - busyDays),
    fullyFree: busy.length === 0,
    busy,
    free,
    // с какой даты свободна до конца периода (null, если конец периода занят)
    freeFrom: tail ? tail.start : null,
    longestFree: free.reduce((best, f) => {
      const d = daysBetween(f.start, f.end);
      return !best || d > best.days ? { ...f, days: d } : best;
    }, null),
  };
}

/**
 * Подбор под запрос: спальни, бюджет в любой валюте, период.
 * Возвращает список вилл с ценой в валюте бюджета и раскладом по свободным датам.
 */
export function searchVillas({ from, to, bedroomsMin, bedroomsMax, budget,
  preferArea = '', onlyFree = true, onlyWithinBudget = true } = {}) {
  const wanted = String(preferArea || '').trim().toLowerCase();
  const months = from && to ? daysBetween(from, to) / 30.44 : 1;

  const rows = state.villas.map((v) => {
    const price = monthlyPrice(v);
    const av = from && to ? availability(v.id, from, to) : null;
    const beds = num(v.bedrooms);
    return {
      villa: v,
      beds,
      // район не исключает: просто помечаем совпадение и поднимаем такие виллы выше
      areaMatch: !!wanted && String(v.area || '').toLowerCase().includes(wanted),
      price,
      monthTotal: price ? price.amount : null,
      periodTotal: price ? price.amount * months : null,
      availability: av,
      overBudget: budget && price ? price.amount > budget : false,
    };
  });

  const filtered = rows.filter((r) => {
    if (bedroomsMin && (!r.beds || r.beds < bedroomsMin)) return false;
    if (bedroomsMax && r.beds && r.beds > bedroomsMax) return false;
    if (onlyWithinBudget && budget && (!r.price || r.overBudget)) return false;
    if (onlyFree && r.availability && !r.availability.fullyFree) return false;
    return true;
  });

  // сначала нужный район, внутри — от дешёвых; виллы без цены в конец
  filtered.sort((a, b) => {
    if (a.areaMatch !== b.areaMatch) return a.areaMatch ? -1 : 1;
    if (a.monthTotal === null) return 1;
    if (b.monthTotal === null) return -1;
    return a.monthTotal - b.monthTotal;
  });
  return { rows: filtered, all: rows, months };
}

/** Быстрый расчёт даты выезда через N месяцев. */
export function addMonthsTo(dateStr, months) {
  const d = parseYmdLocal(dateStr);
  d.setMonth(d.getMonth() + months);
  return ymd(d);
}
function parseYmdLocal(str) {
  const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
