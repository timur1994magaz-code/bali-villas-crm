// ===== Единый слой данных: свой сервер | общая база Supabase | локальный браузер =====
import * as db from './db.js';
import * as cloud from './cloud.js';
import * as selfhost from './selfhost.js';

let _mode = null;   // 'server' | 'cloud' | 'local'

/** Определяется один раз при запуске: обслуживает ли страницу наш собственный сервер. */
export async function init() {
  if (await selfhost.probe()) _mode = 'server';
  else _mode = cloud.isConfigured() ? 'cloud' : 'local';
  return _mode;
}
export function mode() {
  if (_mode) return _mode;
  return cloud.isConfigured() ? 'cloud' : 'local';
}
export const isRemote = () => mode() !== 'local';
export const isCloud = () => mode() === 'cloud';
export const isServer = () => mode() === 'server';
export const modeLabel = () => ({ server: 'свой сервер', cloud: 'общая база Supabase', local: 'этот браузер' }[mode()]);
export { cloud, selfhost };

/* ---------- временные ссылки на локальные файлы ---------- */
const urls = new Set();
function objUrl(blob) { const u = URL.createObjectURL(blob); urls.add(u); return u; }
export function revokeAll() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); }

/* ---------- Вход ---------- */
export async function currentUser() {
  if (isServer()) return selfhost.currentUser();
  if (isCloud()) return cloud.currentUser();
  return null;
}
export async function signIn(email, password) {
  if (isServer()) return selfhost.signIn(email, password);
  return cloud.signIn(email, password);
}
export async function signOut() {
  if (isServer()) return selfhost.signOut();
  if (isCloud()) return cloud.signOut();
}
export async function subscribe(cb) {
  if (isServer()) return selfhost.subscribe(cb);
  if (isCloud()) return cloud.subscribe(cb);
  return () => {};
}
/** Восстановление пароля есть только у Supabase; на своём сервере пароль меняет владелец. */
export const canResetPassword = () => isCloud();

/** Умеет ли текущий режим разворачивать короткие ссылки карт (это делает наш сервер). */
export const canResolveMaps = () => isServer();
export async function resolveMapLink(url) {
  if (!isServer()) throw new Error('Разворачивать короткие ссылки умеет только свой сервер');
  return selfhost.resolveMapLink(url);
}

/* ---------- Записи ---------- */
export async function loadAll() {
  if (isServer()) return selfhost.loadAll();
  if (isCloud()) return cloud.loadAll();
  const [villas, bookings, clients, settings] = await Promise.all([
    db.all('villas'), db.all('bookings'), db.all('clients'), db.all('settings'),
  ]);
  return { villas, bookings, clients, settings: Object.fromEntries(settings.map((s) => [s.key, s.value])) };
}
export async function putRow(table, row) {
  if (isServer()) return selfhost.putRow(table, row);
  if (isCloud()) return cloud.putRow(table, row);
  await db.put(table === 'settings' ? 'settings' : table, row);
  return row;
}
export async function delRow(table, id) {
  if (isServer()) return selfhost.delRow(table, id);
  if (isCloud()) return cloud.delRow(table, id);
  return db.del(table, id);
}
export async function clearEverything() {
  if (isServer()) return selfhost.clearAll();
  if (isCloud()) { await cloud.removeAllStorage(); return cloud.clearAll(); }
  for (const s of db.STORES) await db.clear(s);
}

/* ---------- Файлы ---------- */
function normalizeLocal(rec) {
  return {
    ...rec,
    src: '',
    thumbSrc: rec.thumb ? objUrl(rec.thumb) : (rec.blob ? objUrl(rec.blob) : ''),
    _blob: rec.blob, _thumb: rec.thumb,
  };
}
export async function listFiles(ownerType, ownerId, kind = null) {
  if (isServer()) return selfhost.listFiles(ownerType, ownerId, kind);
  if (isCloud()) return cloud.listFiles(ownerType, ownerId, kind);
  const recs = await db.filesOf(ownerType, ownerId, kind);
  return recs.map(normalizeLocal);
}
export async function firstPhoto(ownerType, ownerId) {
  if (isServer()) return selfhost.firstPhoto(ownerType, ownerId);
  if (isCloud()) return cloud.firstPhoto(ownerType, ownerId);
  const rec = await db.firstPhoto(ownerType, ownerId);
  if (!rec) return null;
  return { ...rec, thumbSrc: objUrl(rec.thumb || rec.blob) };
}
export async function countPhotos(ownerType, ownerId) {
  if (isServer()) return selfhost.countFiles(ownerType, ownerId, 'photo');
  if (isCloud()) return cloud.countFiles(ownerType, ownerId, 'photo');
  return db.countFiles(ownerType, ownerId, 'photo');
}
export async function fileUrl(rec) {
  if (rec.src) return rec.src;
  if (isCloud()) {
    const map = await cloud.signUrls([rec.path]);
    return map.get(rec.path) || '';
  }
  return rec._blob ? objUrl(rec._blob) : '';
}
export async function getBlob(rec) {
  if (isServer()) return selfhost.downloadBlob(rec);
  if (isCloud()) return cloud.downloadBlob(rec.path);
  return rec._blob || (await db.get('files', rec.id) || {}).blob;
}
/** Есть ли у записи превью — в каждом режиме признак свой. */
export function hasThumb(rec) {
  if (isServer()) return !!rec.hasThumb;
  if (isCloud()) return !!rec.thumbPath;
  return !!rec._thumb;
}
/** Само превью — нужно бэкапу, чтобы после восстановления сетки не потеряли скорость. */
export async function getThumbBlob(rec) {
  if (!hasThumb(rec)) return null;
  if (isServer()) {
    const res = await fetch(rec.thumbSrc, { credentials: 'same-origin' });
    return res.ok ? res.blob() : null;
  }
  if (isCloud()) return cloud.downloadBlob(rec.thumbPath);
  return rec._thumb || null;
}
export async function saveUpload(ownerType, ownerId, file, kind, caption = '', extra = {}) {
  if (!isRemote()) return db.saveFile(ownerType, ownerId, file, kind, caption, extra);
  const rec = {
    id: db.uid(), ownerType, ownerId, kind,
    name: file.name || 'file', mime: file.type || 'application/octet-stream',
    size: file.size || 0, caption,
    w: extra.w || null, h: extra.h || null, optimized: !!extra.optimized,
    sort: extra.sort !== undefined ? extra.sort : Date.now(),
  };
  if (isServer()) return selfhost.uploadFile(rec, file, extra.thumb || null);
  return cloud.uploadFile(rec, file, extra.thumb || null);
}
/** Запись файла из бэкапа (сохраняет исходный id и метаданные). */
export async function restoreFile(meta, blob, thumb) {
  if (isServer()) return selfhost.uploadFile(meta, blob, thumb || null);
  if (isCloud()) return cloud.uploadFile(meta, blob, thumb || null);
  return db.put('files', { ...meta, blob, thumb: thumb || null });
}
export async function updateFile(rec) {
  if (isServer()) return selfhost.updateFileRow(rec);
  if (isCloud()) return cloud.updateFileRow(rec);
  const stored = await db.get('files', rec.id);
  if (!stored) return rec;
  return db.put('files', { ...stored, caption: rec.caption, sort: rec.sort });
}
export async function removeFile(rec) {
  if (isServer()) return selfhost.removeFile(rec);
  if (isCloud()) return cloud.removeFile(rec);
  return db.del('files', rec.id);
}
export async function removeFilesOf(ownerType, ownerId) {
  if (isServer()) return selfhost.removeFilesOf(ownerType, ownerId);
  if (isCloud()) return cloud.removeFilesOf(ownerType, ownerId);
  return db.deleteFilesOf(ownerType, ownerId);
}
export async function fileStats() {
  if (isServer()) return selfhost.fileStats();
  if (isCloud()) return cloud.fileStats();
  return db.fileStats();
}
export async function allFileRecords() {
  if (isServer()) return selfhost.allFileRecords();
  if (isCloud()) return cloud.allFileRecords();
  const out = [];
  await db.eachFile((f) => out.push(f));
  return out.map((f) => ({ ...f, _blob: f.blob, _thumb: f.thumb }));
}
export async function storageInfo() {
  if (isRemote()) {
    const st = await fileStats();
    return { remote: true, usage: st.size, quota: 0 };
  }
  const e = await db.storageEstimate();
  return { remote: false, usage: e.usage, quota: e.quota };
}
