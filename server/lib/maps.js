// ===== Разворачивание коротких ссылок Google Maps =====
// Браузеру это недоступно из-за политики домена, а серверу — можно.
// Ходим только на адреса Google: чужие хосты не запрашиваем.

const MAX_HOPS = 8;
const HOP_TIMEOUT_MS = 9000;      // на каждый переход свой запас, а не один на всю цепочку
const MAX_BODY = 3 * 1024 * 1024; // страница места у Google разрослась; резать рано нельзя

function isGoogleHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'g.co'
    || /(^|\.)google\.[a-z][a-z.]{1,8}$/.test(h);
}

const inRange = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng)
  && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  && !(lat === 0 && lng === 0);

// Все виллы этой CRM — в Индонезии. Проверка нужна не для красоты: в разметке
// страницы Google лежит точка по умолчанию для локали, и без проверки вилла
// уезжала под Москву. Координатам из самого адреса доверяем без оглядки,
// вытащенным из вёрстки — только в этих границах.
const INDONESIA = { latMin: -11.5, latMax: 6.5, lngMin: 94.5, lngMax: 141.5 };
const looksIndonesian = (lat, lng) =>
  lat >= INDONESIA.latMin && lat <= INDONESIA.latMax
  && lng >= INDONESIA.lngMin && lng <= INDONESIA.lngMax;

/**
 * Координаты из адреса или тела страницы.
 * Порядок важен: сначала точка самого места, потом центр карты,
 * и только в конце — то, что попалось в вёрстке.
 * source: 'url' — доверяем; 'body' — сверяем с границами страны.
 */
export function coordsFromText(text, source = 'url') {
  if (!text) return null;
  const raw = String(text);
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch (e) { void e; }
  const hays = decoded === raw ? [raw] : [decoded, raw];
  const trust = (lat, lng) => source === 'url' || looksIndonesian(lat, lng);

  // [широта, долгота]
  const latLngPats = [
    /!3d(-?\d{1,3}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/,                 // точка места в data-части
    // ссылка «поделиться точкой»: /maps/search/-8.463275,+115.271203
    /\/maps\/(?:search|place|dir)\/(-?\d{1,3}\.\d{3,}),\s*\+?\s*(-?\d{1,3}\.\d{3,})/,
    /@(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/,                     // центр карты
    /[?&](?:q|ll|center|destination|daddr|sll)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/i,
    /"latitude"\s*:\s*(-?\d{1,3}\.\d{3,})\s*,\s*"longitude"\s*:\s*(-?\d{1,3}\.\d{3,})/i,
    /"lat"\s*:\s*(-?\d{1,3}\.\d{3,})\s*,\s*"lng"\s*:\s*(-?\d{1,3}\.\d{3,})/i,
  ];
  for (const p of latLngPats) {
    for (const hay of hays) {
      const m = hay.match(p);
      if (!m) continue;
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (inRange(lat, lng) && trust(lat, lng)) return { lat, lng };
    }
  }

  // [долгота, широта] — в таком порядке Google кладёт точку в параметр center.
  // Начальное состояние страницы в таком же виде брать нельзя: там лежит
  // точка по умолчанию для локали, а не искомое место.
  const lngLatPats = [/center=(-?\d{1,3}\.\d{4,})%2C(-?\d{1,3}\.\d{4,})/i];
  for (const p of lngLatPats) {
    for (const hay of hays) {
      const m = hay.match(p);
      if (!m) continue;
      const lat = parseFloat(m[2]);
      const lng = parseFloat(m[1]);
      if (inRange(lat, lng) && trust(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

/** Название места: из адреса /maps/place/… или из заголовка страницы. */
export function placeFromUrl(url) {
  const m = String(url).match(/\/maps\/place\/([^/@?"]+)/);
  if (!m) return '';
  let name = m[1];
  try { name = decodeURIComponent(name); } catch (e) { void e; }
  return name.replace(/\+/g, ' ').trim().slice(0, 120);
}
export function placeFromBody(body) {
  const s = String(body || '');
  const meta = s.match(/<meta[^>]+property="og:title"[^>]+content="([^"]{2,120})"/i)
    || s.match(/<title[^>]*>([^<]{2,160})<\/title>/i);
  if (!meta) return '';
  const name = meta[1]
    .replace(/\s*[-–—|]\s*Google\s*(Карты|Maps|карты)?\s*$/i, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim().slice(0, 120);
  // «Google Карты» — это не название места, а заголовок самого сервиса
  return /^google\s*(карты|maps)?$/i.test(name) ? '' : name;
}

/**
 * Текстовый запрос из адреса: ?q=95X9+GPQ, Buduk, Bali
 * Так выглядят ссылки, которыми делятся по Plus Code или адресу, а не по карточке
 * места. Координат в них нет, но по этому тексту Google строит карту точно.
 */
export function queryFromUrl(url) {
  try {
    const u = new URL(url);
    const q = u.searchParams.get('q') || u.searchParams.get('query') || '';
    let text = q.trim();
    if (!text || /^-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+$/.test(text)) return '';
    // Plus Code «95X9+GPQ» теряет плюс: в адресе он кодируется так же, как пробел.
    // Без него карта уходит в центр деревни вместо точного места.
    const PC = '23456789CFGHJMPQRVWX';
    text = text.replace(
      new RegExp(`^([${PC}]{4,8})\\s([${PC}]{2,3})(?=,|\\s|$)`, 'i'),
      '$1+$2');
    return text.slice(0, 200);
  } catch (e) {
    void e;
    return '';
  }
}

/** Страница согласия Google уводит настоящий адрес в параметр continue. */
function throughConsent(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)consent\.google\./i.test(u.hostname)) return null;
    const cont = u.searchParams.get('continue');
    return cont ? new URL(cont, url).href : null;
  } catch (e) {
    void e;
    return null;
  }
}

/**
 * Разворачивает ссылку. Возвращает объект всегда:
 *   { ok: true,  lat, lng, place, finalUrl }
 *   { ok: false, place, finalUrl, reason }  — координат нет, но название могло найтись
 * Исключение бросается только на заведомо негодный ввод.
 */
export async function resolveMapLink(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch (e) {
    void e;
    throw new Error('Это не похоже на ссылку');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Поддерживаются только ссылки http(s)');
  if (!isGoogleHost(url.hostname)) throw new Error('Ссылка не с карт Google');

  const direct = coordsFromText(url.href);
  if (direct) return { ok: true, ...direct, finalUrl: url.href, place: placeFromUrl(url.href) };

  let current = url.href;
  let place = '';

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout ? AbortSignal.timeout(HOP_TIMEOUT_MS) : undefined,
        headers: {
          // именно простой User-Agent: браузерному Google отдаёт JS-заглушку без координат,
          // а такому — честный редирект на полный адрес с точкой
          'User-Agent': 'BaliVillasCRM/1.0 (+link resolver)',
          'Accept-Language': 'ru,en;q=0.8',
        },
      });
    } catch (e) {
      return { ok: false, place, finalUrl: current, reason: 'Google не ответил: ' + (e.message || 'таймаут') };
    }

    const location = res.headers.get('location');
    if (location && res.status >= 300 && res.status < 400) {
      let next;
      try { next = new URL(location, current); } catch (e) { void e; break; }
      const past = throughConsent(next.href);
      if (past) { try { next = new URL(past); } catch (e) { void e; } }
      if (!isGoogleHost(next.hostname)) {
        return { ok: false, place, finalUrl: next.href, reason: 'Ссылка ведёт за пределы карт Google' };
      }
      current = next.href;
      place = place || placeFromUrl(current);
      const found = coordsFromText(current);
      if (found) return { ok: true, ...found, finalUrl: current, place };
      continue;
    }

    const body = (await res.text()).slice(0, MAX_BODY);
    place = place || placeFromUrl(current) || placeFromBody(body);
    const found = coordsFromText(current, 'url') || coordsFromText(body, 'body');
    if (found) return { ok: true, ...found, finalUrl: current, place };

    // тело без координат: возможно, внутри лежит ссылка на настоящую страницу места
    const inner = body.match(/https:\/\/www\.google\.[a-z.]{2,8}\/maps\/place\/[^"'\\<>\s]{10,400}/);
    if (inner && inner[0] !== current) { current = inner[0]; continue; }
    break;
  }

  // координат нет — но если Google свёл ссылку к текстовому адресу или Plus Code,
  // по нему карта строится точно, и это лучше любых догадок
  const query = queryFromUrl(current);
  return {
    ok: false,
    place: place || query,
    query,
    finalUrl: current,
    reason: query
      ? 'В ссылке нет координат — это адрес или Plus Code. Карту покажем по нему.'
      : 'Не удалось определить координаты по этой ссылке',
  };
}
