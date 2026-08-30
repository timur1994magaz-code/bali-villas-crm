// ===== Разворачивание коротких ссылок Google Maps =====
// Браузеру это недоступно из-за политики домена, а серверу — можно.
// Ходим только на адреса Google: чужие хосты не запрашиваем.

const MAX_HOPS = 6;
const TIMEOUT_MS = 9000;
const MAX_BODY = 400 * 1024;

function isGoogleHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'g.co'
    || /(^|\.)google\.[a-z][a-z.]{1,8}$/.test(h);
}

/** Координаты из адреса: /@lat,lng , !3dlat!4dlng , ?q=lat,lng , ll=lat,lng */
export function coordsFromText(text) {
  if (!text) return null;
  const raw = String(text);
  // в теле страницы попадаются битые %-последовательности — декодируем аккуратно
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch (e) { void e; }
  const pats = [
    /!3d(-?\d{1,3}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/,   // сама точка места
    /@(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/,        // центр карты — запасной вариант
    /[?&](?:q|ll|center|destination|daddr)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/i,   // явный параметр — можно мягче
    /"(-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})"/,
  ];
  for (const p of pats) {
    for (const hay of decoded === raw ? [raw] : [decoded, raw]) {
      const m = hay.match(p);
      if (!m) continue;
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

/** Название места из адреса вида /maps/place/Villa+Cinta/@... */
export function placeFromUrl(url) {
  const m = String(url).match(/\/maps\/place\/([^/@?"]+)/);
  if (!m) return '';
  let name = m[1];
  try { name = decodeURIComponent(name); } catch (e) { void e; }
  return name.replace(/\+/g, ' ').trim().slice(0, 120);
}

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

  // вдруг координаты уже в самой ссылке
  const direct = coordsFromText(url.href);
  if (direct) return { ...direct, finalUrl: url.href, place: placeFromUrl(url.href) };

  const ctl = AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  let current = url.href;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      signal: ctl,
      headers: {
        // именно простой User-Agent: браузерному Google отдаёт JS-заглушку без координат,
        // а такому — честный редирект на полный адрес с точкой
        'User-Agent': 'BaliVillasCRM/1.0 (+link resolver)',
        'Accept-Language': 'ru,en;q=0.8',
      },
    });

    const location = res.headers.get('location');
    if (location && res.status >= 300 && res.status < 400) {
      const next = new URL(location, current);
      if (!isGoogleHost(next.hostname)) throw new Error('Ссылка ведёт за пределы карт Google');
      current = next.href;
      const found = coordsFromText(current);
      if (found) return { ...found, finalUrl: current, place: placeFromUrl(current) };
      continue;
    }

    // редиректов больше нет — ищем координаты в теле страницы
    const body = (await res.text()).slice(0, MAX_BODY);
    const found = coordsFromText(current) || coordsFromText(body);
    if (found) return { ...found, finalUrl: current, place: placeFromUrl(current) || placeFromUrl(body) };
    break;
  }
  throw new Error('Не удалось определить координаты по этой ссылке');
}
