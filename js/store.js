// ===== Хранилище данных приложения (поверх IndexedDB) =====
import * as db from './db.js';
import { ymd, overlaps, num, daysBetween, today } from './util.js';

export const state = { villas: [], bookings: [], clients: [], settings: {} };
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((f) => f()); }

export async function load() {
  const [villas, bookings, clients, settings] = await Promise.all([
    db.all('villas'), db.all('bookings'), db.all('clients'), db.all('settings'),
  ]);
  state.villas = villas.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  state.bookings = bookings.sort((a, b) => String(a.dateFrom).localeCompare(String(b.dateFrom)));
  state.clients = clients.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  state.settings = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  if (!state.settings.currency) state.settings.currency = 'USD';
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
    ownerPrice: '', ownerPeriod: 'month', ourPriceNight: '', ourPriceMonth: '', currency: 'USD',
    utilities: '', mapUrl: '', lat: '', lng: '', wifi: '', notes: '', status: 'active',
    createdAt: new Date().toISOString(),
  };
}
export async function saveVilla(v) {
  v.updatedAt = new Date().toISOString();
  if (!v.createdAt) v.createdAt = v.updatedAt;
  await db.put('villas', v);
  await load();
  return v;
}
export async function deleteVilla(id) {
  const bs = state.bookings.filter((b) => b.villaId === id);
  for (const b of bs) { await db.deleteFilesOf('booking', b.id); await db.del('bookings', b.id); }
  await db.deleteFilesOf('villa', id);
  await db.del('villas', id);
  await load();
}

// ===== Клиенты =====
export function emptyClient() {
  return {
    id: db.uid(), name: '', phone: '', whatsapp: '', telegram: '', email: '',
    country: '', passport: '', instagram: '', source: '', notes: '',
    createdAt: new Date().toISOString(),
  };
}
export async function saveClient(c) {
  c.updatedAt = new Date().toISOString();
  if (!c.createdAt) c.createdAt = c.updatedAt;
  await db.put('clients', c);
  await load();
  return c;
}
export async function deleteClient(id) {
  await db.deleteFilesOf('client', id);
  for (const b of state.bookings.filter((b) => b.clientId === id)) {
    b.clientId = ''; await db.put('bookings', b);
  }
  await db.del('clients', id);
  await load();
}

// ===== Брони =====
export function emptyBooking(villaId = '', dateFrom = today(), dateTo = '') {
  return {
    id: db.uid(), villaId, clientId: '',
    dateFrom, dateTo: dateTo || dateFrom,
    status: 'booked', guests: '', priceTotal: '', prepaid: '', currency: 'USD',
    source: '', notes: '', createdAt: new Date().toISOString(),
  };
}
export async function saveBooking(b) {
  b.updatedAt = new Date().toISOString();
  if (!b.createdAt) b.createdAt = b.updatedAt;
  await db.put('bookings', b);
  await load();
  return b;
}
export async function deleteBooking(id) {
  await db.deleteFilesOf('booking', id);
  await db.del('bookings', id);
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
  await db.put('settings', { key, value });
  state.settings[key] = value;
  emit();
}

// ===== Экспорт / импорт живёт в backup.js (папка / ZIP / JSON) =====

export async function wipeAll() {
  for (const s of db.STORES) await db.clear(s);
  await load();
}

// ===== Демо-данные =====
export async function seedDemo() {
  const v1 = { ...emptyVilla(), name: 'Villa Cinta 1', area: 'Чангу (Berawa)', bedrooms: '3', bathrooms: '3', pool: 'Приватный 8×3',
    ownerName: 'Pak Wayan', ownerPhone: '+62 812 3456 7890', ownerWhatsapp: '+62 812 3456 7890',
    managerName: 'Kadek (менеджер)', managerPhone: '+62 813 1111 2222',
    contractFrom: ymd(new Date()), contractTo: '', paymentTerms: 'Оплата собственнику раз в 3 месяца вперёд',
    deposit: '1000 USD', notice: 'Уведомление о расторжении за 60 дней',
    terms: 'Долгосрочная субаренда на 12 месяцев. Электричество и вода — на нас, налог PB1 — на собственнике. Разрешена посуточная сдача.',
    ownerPrice: '2200', ownerPeriod: 'month', ourPriceNight: '190', ourPriceMonth: '3600', currency: 'USD',
    mapUrl: 'https://www.google.com/maps/@-8.6595,115.1379,17z', lat: '-8.6595', lng: '115.1379',
    wifi: 'Biznet 100 Mbps', notes: 'Уборка 3 раза в неделю включена.' };
  const v2 = { ...emptyVilla(), name: 'Villa Sunset Uluwatu', area: 'Улувату (Bingin)', bedrooms: '2', bathrooms: '2', pool: 'Инфинити',
    ownerName: 'Made Sutrisna', ownerPhone: '+62 878 9999 1234', ownerWhatsapp: '+62 878 9999 1234',
    contractFrom: ymd(new Date()), paymentTerms: 'Полгода вперёд', deposit: '1500 USD',
    terms: 'Субаренда 24 месяца, продление по той же ставке +7%.',
    ownerPrice: '1800', ownerPeriod: 'month', ourPriceNight: '160', ourPriceMonth: '3100', currency: 'USD',
    mapUrl: 'https://www.google.com/maps/@-8.8065,115.1141,17z', lat: '-8.8065', lng: '115.1141' };
  await db.put('villas', v1); await db.put('villas', v2);

  const c1 = { ...emptyClient(), name: 'Анна Петрова', phone: '+7 916 123-45-67', whatsapp: '+79161234567',
    telegram: '@anna_p', email: 'anna@example.com', country: 'Россия', source: 'Instagram' };
  const c2 = { ...emptyClient(), name: 'James Miller', phone: '+61 400 111 222', whatsapp: '+61400111222',
    email: 'james@example.com', country: 'Австралия', source: 'Airbnb' };
  await db.put('clients', c1); await db.put('clients', c2);

  const t = today();
  await db.put('bookings', { ...emptyBooking(v1.id, t, ''), dateFrom: t, dateTo: addD(t, 9),
    clientId: c1.id, status: 'occupied', guests: '2', priceTotal: '1710', prepaid: '855', currency: 'USD', source: 'Instagram' });
  await db.put('bookings', { ...emptyBooking(v1.id), dateFrom: addD(t, 14), dateTo: addD(t, 27),
    clientId: c2.id, status: 'booked', guests: '4', priceTotal: '2470', prepaid: '700', currency: 'USD', source: 'Airbnb' });
  await db.put('bookings', { ...emptyBooking(v2.id), dateFrom: addD(t, 3), dateTo: addD(t, 12),
    clientId: c2.id, status: 'booked', guests: '2', priceTotal: '1440', currency: 'USD', source: 'Booking.com' });
  await db.put('bookings', { ...emptyBooking(v2.id), dateFrom: addD(t, 30), dateTo: addD(t, 35),
    status: 'blocked', notes: 'Ремонт бассейна' });
  await load();
}
function addD(s, n) { const d = new Date(s); d.setDate(d.getDate() + n); return ymd(d); }
