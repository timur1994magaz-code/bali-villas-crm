// ===== Утилиты: даты, деньги, экранирование, Google Maps =====

export const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
export const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
export const MONTHS_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
export const DOW = ['пн','вт','ср','чт','пт','сб','вс'];

export const STATUS = {
  occupied: { label: 'Заселён', cls: 'occupied' },
  booked:   { label: 'Забронировано', cls: 'booked' },
  option:   { label: 'Опция / ждём оплату', cls: 'option' },
  blocked:  { label: 'Блок (собственник/ремонт)', cls: 'blocked' },
};

export const CURRENCIES = ['USD', 'IDR', 'RUB', 'EUR', 'AUD'];
export const PERIODS = { night: 'за ночь', month: 'в месяц', year: 'в год' };

// ---- даты: работаем со строками YYYY-MM-DD, без таймзонных сюрпризов ----
export function ymd(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseYmd(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function today() { return ymd(new Date()); }
export function addDays(s, n) {
  const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d);
}
export function addMonths(s, n) {
  const d = parseYmd(s); d.setDate(1); d.setMonth(d.getMonth() + n); return ymd(d);
}
export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}
export function startOfWeek(s) {
  const d = parseYmd(s);
  const dow = (d.getDay() + 6) % 7; // пн = 0
  d.setDate(d.getDate() - dow);
  return ymd(d);
}
export function startOfMonth(s) { return s.slice(0, 7) + '-01'; }
export function endOfMonth(s) {
  const d = parseYmd(s); d.setMonth(d.getMonth() + 1); d.setDate(0); return ymd(d);
}
export function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
export function isWeekend(s) { const g = parseYmd(s).getDay(); return g === 0 || g === 6; }
export function dowIndex(s) { return (parseYmd(s).getDay() + 6) % 7; }

export function fmtDate(s) {
  if (!s) return '—';
  const d = parseYmd(s);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtDateShort(s) {
  if (!s) return '—';
  const d = parseYmd(s);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
}
export function fmtRange(a, b) { return `${fmtDateShort(a)} → ${fmtDateShort(b)}`; }
export function monthLabel(s) { const d = parseYmd(s); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }

// пересечение периодов [a1,a2) и [b1,b2)
export function overlaps(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }

// ---- деньги ----
export function money(v, cur = 'USD') {
  if (v === '' || v === null || v === undefined || isNaN(Number(v))) return '—';
  const n = Number(v);
  const s = n.toLocaleString('ru-RU', { maximumFractionDigits: n % 1 ? 2 : 0 });
  const sign = { USD: '$', EUR: '€', RUB: '₽', IDR: 'Rp', AUD: 'A$' }[cur] || cur;
  return cur === 'RUB' || cur === 'IDR' ? `${s} ${sign}` : `${sign}${s}`;
}
export function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

// ---- строки ----
export function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function bytes(n) {
  if (!n) return '0 Б';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}
export function phoneHref(p) { return 'tel:' + String(p || '').replace(/[^\d+]/g, ''); }
export function waHref(p) {
  const digits = String(p || '').replace(/\D/g, '');
  return digits ? 'https://wa.me/' + digits : '';
}
export function tgHref(t) {
  const v = String(t || '').trim().replace(/^@/, '');
  if (!v) return '';
  if (/^https?:\/\//.test(v)) return v;
  return 'https://t.me/' + v;
}

// ---- Google Maps ----
// Достаём координаты из любой ссылки Google Maps / просто из "-8.65, 115.13"
export function parseCoords(input) {
  if (!input) return null;
  const s = String(input).trim();
  const pats = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,                  // .../@-8.65,115.13,17z
    /[?&]q=(-?\d+\.\d+)%2C(-?\d+\.\d+)/i,
    /[?&](?:q|ll|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/i,
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,              // data-часть ссылки
    /^\s*(-?\d+\.\d+)\s*[, ]\s*(-?\d+\.\d+)\s*$/,  // просто координаты
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}
export function mapEmbedUrl(lat, lng, z = 16) {
  return `https://www.google.com/maps?q=${lat},${lng}&z=${z}&hl=ru&output=embed`;
}
export function mapLinkUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

// ---- прочее ----
export function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
export function sortBy(arr, key) {
  return [...arr].sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || ''), 'ru'));
}
