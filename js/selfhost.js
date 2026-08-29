// ===== Работа со своим сервером (Node + SQLite на вашем VPS) =====
// Все адреса относительные — приложение работает и в корне домена, и в подпапке.

const api = (p) => new URL(p, document.baseURI).toString();
let _probed = null;

async function req(path, { method = 'GET', json, form, raw = false } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-CRM'] = '1';
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(api(path), { method, headers, body, credentials: 'same-origin' });
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch (e) { void e; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Ошибка сервера (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Проверяем один раз при запуске: обслуживает ли нас собственный сервер. */
export async function probe() {
  if (_probed !== null) return _probed;
  try {
    const ctl = AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined;
    const res = await fetch(api('api/health'), { signal: ctl, credentials: 'same-origin' });
    if (!res.ok) { _probed = false; return false; }
    const data = await res.json();
    _probed = data && data.app === 'bali-villas-crm' && data.mode === 'server';
  } catch (e) {
    void e;
    _probed = false;
  }
  return _probed;
}
export function isDetected() { return _probed === true; }

/* ---------- Вход ---------- */
export async function currentUser() {
  try { return (await req('api/me')).user; }
  catch (e) { if (e.status === 401) return null; throw e; }
}
export async function signIn(email, password) {
  return (await req('api/login', { method: 'POST', json: { email, password } })).user;
}
export async function signOut() { await req('api/logout', { method: 'POST' }); }

/* ---------- Записи ---------- */
export async function loadAll() {
  const d = await req('api/data');
  return { villas: d.villas || [], bookings: d.bookings || [], clients: d.clients || [], settings: d.settings || {} };
}
export async function putRow(table, row) {
  if (table === 'settings') {
    await req(`api/row/settings/${encodeURIComponent(row.key)}`, { method: 'PUT', json: { value: row.value } });
    return row;
  }
  await req(`api/row/${table}/${encodeURIComponent(row.id)}`, { method: 'PUT', json: row });
  return row;
}
export async function delRow(table, id) {
  await req(`api/row/${table}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export async function clearAll() { await req('api/wipe', { method: 'POST' }); }

/* ---------- Файлы ---------- */
const withUrls = (f) => ({
  ...f,
  src: api(`f/${f.id}`),
  thumbSrc: f.hasThumb ? api(`t/${f.id}`) : api(`f/${f.id}`),
});
export async function listFiles(ownerType, ownerId, kind = null) {
  const q = new URLSearchParams({ ownerType, ownerId });
  if (kind) q.set('kind', kind);
  const d = await req(`api/files?${q}`);
  return (d.files || []).map(withUrls);
}
export async function firstPhoto(ownerType, ownerId) {
  const d = await req(`api/files/first?${new URLSearchParams({ ownerType, ownerId })}`);
  return d.file ? withUrls(d.file) : null;
}
export async function countFiles(ownerType, ownerId, kind = 'photo') {
  return (await req(`api/files/count?${new URLSearchParams({ ownerType, ownerId, kind })}`)).count;
}
export async function uploadFile(rec, blob, thumb) {
  const form = new FormData();
  form.append('meta', JSON.stringify(rec));
  form.append('file', blob, rec.name || 'file');
  if (thumb) form.append('thumb', thumb, 'thumb.jpg');
  const d = await req('api/files', { method: 'POST', form });
  return withUrls(d.file);
}
export async function updateFileRow(rec) {
  const d = await req(`api/files/${rec.id}`, { method: 'PATCH', json: { caption: rec.caption, sort: rec.sort } });
  return withUrls(d.file);
}
export async function removeFile(rec) { await req(`api/files/${rec.id}`, { method: 'DELETE' }); }
export async function removeFilesOf(ownerType, ownerId) {
  await req(`api/files?${new URLSearchParams({ ownerType, ownerId })}`, { method: 'DELETE' });
}
export async function downloadBlob(rec) {
  const res = await fetch(api(`f/${rec.id}`), { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Не удалось скачать файл');
  return res.blob();
}
export async function allFileRecords() {
  const d = await req('api/files?scope=all');
  return (d.files || []).map(withUrls);
}
export async function fileStats() { return req('api/files/stats'); }

/* ---------- Живое обновление ---------- */
export function subscribe(onChange) {
  const es = new EventSource(api('api/events'), { withCredentials: true });
  es.onmessage = (e) => {
    try { onChange(JSON.parse(e.data).event); } catch (err) { void err; }
  };
  es.onerror = () => { /* EventSource переподключается сам */ };
  return () => es.close();
}

/* ---------- Пользователи ---------- */
export async function listUsers() { return (await req('api/users')).users; }
export async function createUser(email, password, role = 'manager') {
  return (await req('api/users', { method: 'POST', json: { email, password, role } })).user;
}
export async function deleteUser(id) { await req(`api/users/${id}`, { method: 'DELETE' }); }
export async function setUserPassword(id, password) {
  await req(`api/users/${id}`, { method: 'PATCH', json: { password } });
}
