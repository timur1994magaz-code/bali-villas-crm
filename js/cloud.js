// ===== Общая база: Supabase (данные, файлы, вход, живое обновление) =====
import { cloudConfig, SUPABASE_JS } from './config.js';

const BUCKET = 'villa-files';
const TABLE = { villas: 'villas', bookings: 'bookings', clients: 'clients', tasks: 'tasks' };
const SIGNED_TTL = 60 * 60; // ссылки на файлы живут час

let _client = null;
let _clientPromise = null;

export function isConfigured() {
  const c = cloudConfig();
  return !!(c.url && c.key);
}

export async function getClient() {
  if (_client) return _client;
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const c = cloudConfig();
      if (!c.url || !c.key) throw new Error('Общая база не настроена');
      const { createClient } = await import(/* @vite-ignore */ SUPABASE_JS);
      _client = createClient(c.url, c.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
      return _client;
    })();
  }
  return _clientPromise;
}
export function resetClient() { _client = null; _clientPromise = null; }
/** Подстановка клиента для самопроверки без обращения к сети. */
export function __setTestClient(c) { _client = c; _clientPromise = c ? Promise.resolve(c) : null; }

/* ---------- Вход ---------- */
export async function currentUser() {
  if (!isConfigured()) return null;
  const sb = await getClient();
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.user : null;
}
export async function signIn(email, password) {
  const sb = await getClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(translateAuthError(error.message));
  return data.user;
}
export async function signOut() {
  const sb = await getClient();
  await sb.auth.signOut();
}
export async function sendPasswordReset(email) {
  const sb = await getClient();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
  if (error) throw new Error(error.message);
}
export async function onAuthChange(cb) {
  const sb = await getClient();
  sb.auth.onAuthStateChange((event, sess) => cb(sess ? sess.user : null, event));
}
function translateAuthError(msg) {
  const m = String(msg || '');
  if (/invalid login credentials/i.test(m)) return 'Неверная почта или пароль';
  if (/email not confirmed/i.test(m)) return 'Почта не подтверждена — откройте письмо от Supabase';
  if (/rate limit|too many/i.test(m)) return 'Слишком много попыток, подождите минуту';
  if (/failed to fetch|network/i.test(m)) return 'Нет связи с сервером — проверьте интернет';
  return m;
}

/* ---------- Данные ---------- */
function check(error, what) {
  if (error) throw new Error(`${what}: ${error.message || error}`);
}
export async function loadAll() {
  const sb = await getClient();
  const [v, b, c, s, t] = await Promise.all([
    sb.from('villas').select('id,doc'),
    sb.from('bookings').select('id,doc'),
    sb.from('clients').select('id,doc'),
    sb.from('app_settings').select('key,value'),
    sb.from('tasks').select('id,doc'),
  ]);
  check(v.error, 'Загрузка вилл');
  check(b.error, 'Загрузка броней');
  check(c.error, 'Загрузка клиентов');
  check(s.error, 'Загрузка настроек');
  const unwrap = (rows) => (rows || []).map((r) => ({ ...r.doc, id: r.id }));
  // задачи появились позже: в старой базе таблицы может не быть — это не повод падать
  if (t.error) console.warn('Задачи недоступны, добавьте таблицу tasks: ' + t.error.message);
  return {
    villas: unwrap(v.data),
    bookings: unwrap(b.data),
    clients: unwrap(c.data),
    tasks: t.error ? [] : unwrap(t.data),
    settings: Object.fromEntries((s.data || []).map((r) => [r.key, r.value])),
  };
}
export async function putRow(table, row) {
  const sb = await getClient();
  if (table === 'settings') {
    const { error } = await sb.from('app_settings').upsert({ key: row.key, value: row.value });
    check(error, 'Сохранение настройки');
    return row;
  }
  const { error } = await sb.from(TABLE[table]).upsert({ id: row.id, doc: row });
  check(error, 'Сохранение записи');
  return row;
}
export async function delRow(table, id) {
  const sb = await getClient();
  const t = table === 'settings' ? 'app_settings' : TABLE[table];
  const col = table === 'settings' ? 'key' : 'id';
  const { error } = await sb.from(t).delete().eq(col, id);
  check(error, 'Удаление записи');
}
export async function clearAll() {
  const sb = await getClient();
  for (const p of ['files', 'bookings', 'tasks', 'clients', 'villas']) {
    const { error } = await sb.from(p).delete().neq('id', '__never__');
    check(error, 'Очистка ' + p);
  }
  const { error } = await sb.from('app_settings').delete().neq('key', '__never__');
  check(error, 'Очистка настроек');
  // сами файлы в Storage удаляются вызывающей стороной через listAllFilePaths
}

/* ---------- Файлы ---------- */
const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
  'image/heif': 'heif', 'image/gif': 'gif', 'application/pdf': 'pdf',
};
function extOf(name, mime) {
  const m = (name || '').match(/\.([a-z0-9]{1,6})$/i);
  return EXT[mime] || (m ? m[1].toLowerCase() : 'bin');
}
function rowToRec(r) {
  return {
    id: r.id, ownerType: r.owner_type, ownerId: r.owner_id, kind: r.kind,
    name: r.name, mime: r.mime, size: r.size, caption: r.caption || '',
    w: r.w, h: r.h, sort: r.sort, path: r.path, thumbPath: r.thumb_path,
    optimized: !!r.optimized, createdAt: r.created_at,
  };
}
function recToRow(rec) {
  return {
    id: rec.id, owner_type: rec.ownerType, owner_id: rec.ownerId, kind: rec.kind,
    name: rec.name, mime: rec.mime, size: rec.size, caption: rec.caption || '',
    w: rec.w || null, h: rec.h || null, sort: rec.sort, path: rec.path,
    thumb_path: rec.thumbPath || null, optimized: !!rec.optimized,
  };
}

/** Временные ссылки на файлы. Сопоставляем по порядку: поле path сервер отдаёт не всегда. */
export async function signUrls(paths) {
  const clean = paths.filter(Boolean);
  if (!clean.length) return new Map();
  const sb = await getClient();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(clean, SIGNED_TTL);
  check(error, 'Ссылки на файлы');
  const map = new Map();
  (data || []).forEach((item, i) => {
    const link = item && (item.signedUrl || item.signedURL);
    if (link) map.set(item.path || clean[i], link);
  });
  return map;
}

export async function listFiles(ownerType, ownerId, kind = null) {
  const sb = await getClient();
  let q = sb.from('files').select('*').eq('owner_type', ownerType).eq('owner_id', ownerId);
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q.order('sort', { ascending: true });
  check(error, 'Список файлов');
  const recs = (data || []).map(rowToRec);
  const urls = await signUrls(recs.flatMap((r) => [r.path, r.thumbPath]));
  return recs.map((r) => ({
    ...r,
    src: urls.get(r.path) || '',
    thumbSrc: urls.get(r.thumbPath) || urls.get(r.path) || '',
  }));
}
export async function firstPhoto(ownerType, ownerId) {
  const sb = await getClient();
  const { data, error } = await sb.from('files').select('*')
    .eq('owner_type', ownerType).eq('owner_id', ownerId).eq('kind', 'photo')
    .order('sort', { ascending: true }).limit(1);
  check(error, 'Обложка');
  if (!data || !data.length) return null;
  const rec = rowToRec(data[0]);
  const urls = await signUrls([rec.thumbPath || rec.path]);
  return { ...rec, thumbSrc: urls.get(rec.thumbPath || rec.path) || '' };
}
export async function countFiles(ownerType, ownerId, kind = 'photo') {
  const sb = await getClient();
  const { count, error } = await sb.from('files')
    .select('id', { count: 'exact', head: true })
    .eq('owner_type', ownerType).eq('owner_id', ownerId).eq('kind', kind);
  check(error, 'Подсчёт файлов');
  return count || 0;
}

export async function uploadFile(rec, blob, thumb) {
  const sb = await getClient();
  const path = `${rec.ownerType}/${rec.ownerId}/${rec.id}.${extOf(rec.name, rec.mime)}`;
  const thumbPath = thumb ? `${rec.ownerType}/${rec.ownerId}/thumbs/${rec.id}.jpg` : null;

  const up = await sb.storage.from(BUCKET).upload(path, blob, {
    contentType: rec.mime || 'application/octet-stream', upsert: true,
  });
  check(up.error, 'Загрузка файла');
  if (thumb) {
    const upT = await sb.storage.from(BUCKET).upload(thumbPath, thumb, { contentType: 'image/jpeg', upsert: true });
    check(upT.error, 'Загрузка превью');
  }
  const full = { ...rec, path, thumbPath };
  const { error } = await sb.from('files').upsert(recToRow(full));
  if (error) {   // строка не записалась — не оставляем мусор в хранилище
    await sb.storage.from(BUCKET).remove([path, thumbPath].filter(Boolean));
    check(error, 'Сохранение файла');
  }
  return full;
}
export async function updateFileRow(rec) {
  const sb = await getClient();
  const { error } = await sb.from('files').upsert(recToRow(rec));
  check(error, 'Обновление файла');
  return rec;
}
export async function removeFile(rec) {
  const sb = await getClient();
  await sb.storage.from(BUCKET).remove([rec.path, rec.thumbPath].filter(Boolean));
  const { error } = await sb.from('files').delete().eq('id', rec.id);
  check(error, 'Удаление файла');
}
export async function removeFilesOf(ownerType, ownerId) {
  const recs = await listFiles(ownerType, ownerId);
  if (!recs.length) return;
  const sb = await getClient();
  await sb.storage.from(BUCKET).remove(recs.flatMap((r) => [r.path, r.thumbPath]).filter(Boolean));
  const { error } = await sb.from('files').delete().eq('owner_type', ownerType).eq('owner_id', ownerId);
  check(error, 'Удаление файлов');
}
export async function downloadBlob(path) {
  const sb = await getClient();
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  check(error, 'Скачивание файла');
  return data;
}
export async function allFileRecords() {
  const sb = await getClient();
  const { data, error } = await sb.from('files').select('*').order('created_at', { ascending: true });
  check(error, 'Список всех файлов');
  return (data || []).map(rowToRec);
}
export async function fileStats() {
  const recs = await allFileRecords();
  return {
    photos: recs.filter((r) => r.kind === 'photo').length,
    docs: recs.filter((r) => r.kind === 'doc').length,
    size: recs.reduce((s, r) => s + (r.size || 0), 0),
    thumbSize: 0,
    noThumb: recs.filter((r) => r.kind === 'photo' && !r.thumbPath).length,
  };
}
export async function removeAllStorage() {
  const recs = await allFileRecords();
  if (!recs.length) return;
  const sb = await getClient();
  const paths = recs.flatMap((r) => [r.path, r.thumbPath]).filter(Boolean);
  for (let i = 0; i < paths.length; i += 100) {
    await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
  }
}

/* ---------- Живое обновление ---------- */
export async function subscribe(onChange) {
  const sb = await getClient();
  const ch = sb.channel('crm-changes');
  for (const t of ['villas', 'bookings', 'clients', 'files']) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, (payload) => onChange(t, payload));
  }
  ch.subscribe();
  return () => sb.removeChannel(ch);
}
