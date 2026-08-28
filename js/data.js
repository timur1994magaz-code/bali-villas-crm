// ===== Единый слой данных: локальный браузер (IndexedDB) или общая база (Supabase) =====
import * as db from './db.js';
import * as cloud from './cloud.js';

export const isCloud = () => cloud.isConfigured();
export { cloud };

/* ---------- временные ссылки на локальные файлы ---------- */
const urls = new Set();
function objUrl(blob) { const u = URL.createObjectURL(blob); urls.add(u); return u; }
export function revokeAll() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); }

/* ---------- Записи ---------- */
export async function loadAll() {
  if (isCloud()) return cloud.loadAll();
  const [villas, bookings, clients, settings] = await Promise.all([
    db.all('villas'), db.all('bookings'), db.all('clients'), db.all('settings'),
  ]);
  return {
    villas, bookings, clients,
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
  };
}
export async function putRow(table, row) {
  if (isCloud()) return cloud.putRow(table, row);
  await db.put(table === 'settings' ? 'settings' : table, row);
  return row;
}
export async function delRow(table, id) {
  if (isCloud()) return cloud.delRow(table, id);
  return db.del(table, id);
}
export async function clearEverything() {
  if (isCloud()) { await cloud.removeAllStorage(); return cloud.clearAll(); }
  for (const s of db.STORES) await db.clear(s);
}

/* ---------- Файлы ---------- */
function normalizeLocal(rec) {
  return {
    ...rec,
    src: '',                                   // создаётся по требованию
    thumbSrc: rec.thumb ? objUrl(rec.thumb) : (rec.blob ? objUrl(rec.blob) : ''),
    _blob: rec.blob, _thumb: rec.thumb,
  };
}
export async function listFiles(ownerType, ownerId, kind = null) {
  if (isCloud()) return cloud.listFiles(ownerType, ownerId, kind);
  const recs = await db.filesOf(ownerType, ownerId, kind);
  return recs.map(normalizeLocal);
}
export async function firstPhoto(ownerType, ownerId) {
  if (isCloud()) return cloud.firstPhoto(ownerType, ownerId);
  const rec = await db.firstPhoto(ownerType, ownerId);
  if (!rec) return null;
  return { ...rec, thumbSrc: objUrl(rec.thumb || rec.blob) };
}
export async function countPhotos(ownerType, ownerId) {
  if (isCloud()) return cloud.countFiles(ownerType, ownerId, 'photo');
  return db.countFiles(ownerType, ownerId, 'photo');
}
/** Ссылка на полноразмерный файл (для просмотра и открытия в новой вкладке). */
export async function fileUrl(rec) {
  if (rec.src) return rec.src;
  if (isCloud()) {
    const map = await cloud.signUrls([rec.path]);
    return map.get(rec.path) || '';
  }
  return rec._blob ? objUrl(rec._blob) : '';
}
/** Сам файл — для скачивания и бэкапа. */
export async function getBlob(rec) {
  if (!isCloud()) return rec._blob || (await db.get('files', rec.id) || {}).blob;
  return cloud.downloadBlob(rec.path);
}
export async function saveUpload(ownerType, ownerId, file, kind, caption = '', extra = {}) {
  if (!isCloud()) return db.saveFile(ownerType, ownerId, file, kind, caption, extra);
  const rec = {
    id: db.uid(), ownerType, ownerId, kind,
    name: file.name || 'file', mime: file.type || 'application/octet-stream',
    size: file.size || 0, caption,
    w: extra.w || null, h: extra.h || null, optimized: !!extra.optimized,
    sort: extra.sort !== undefined ? extra.sort : Date.now(),
  };
  return cloud.uploadFile(rec, file, extra.thumb || null);
}
/** Запись файла из бэкапа (сохраняет исходный id и метаданные). */
export async function restoreFile(meta, blob, thumb) {
  if (isCloud()) return cloud.uploadFile(meta, blob, thumb || null);
  return db.put('files', { ...meta, blob, thumb: thumb || null });
}
export async function updateFile(rec) {
  if (isCloud()) return cloud.updateFileRow(rec);
  const stored = await db.get('files', rec.id);
  if (!stored) return rec;
  return db.put('files', { ...stored, caption: rec.caption, sort: rec.sort });
}
export async function removeFile(rec) {
  if (isCloud()) return cloud.removeFile(rec);
  return db.del('files', rec.id);
}
export async function removeFilesOf(ownerType, ownerId) {
  if (isCloud()) return cloud.removeFilesOf(ownerType, ownerId);
  return db.deleteFilesOf(ownerType, ownerId);
}
export async function fileStats() {
  if (isCloud()) return cloud.fileStats();
  return db.fileStats();
}
export async function allFileRecords() {
  if (isCloud()) return cloud.allFileRecords();
  const out = [];
  await db.eachFile((f) => out.push(f));
  return out.map((f) => ({ ...f, _blob: f.blob, _thumb: f.thumb }));
}
/** Занятое место: в облаке считаем по метаданным, локально спрашиваем браузер. */
export async function storageInfo() {
  if (isCloud()) {
    const st = await cloud.fileStats();
    return { cloud: true, usage: st.size, quota: 0 };
  }
  const e = await db.storageEstimate();
  return { cloud: false, usage: e.usage, quota: e.quota };
}
