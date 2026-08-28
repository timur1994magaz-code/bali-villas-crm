// ===== Бэкап и восстановление: папка на диске, ZIP-части, JSON только с данными =====
import * as data from './data.js';
import * as S from './store.js';
import { createZip, readZip } from './zip.js';
import { download, bytes } from './util.js';

const ZIP_PART_LIMIT = 1.2 * 1024 * 1024 * 1024; // ZIP32 надёжно живёт до 4 ГБ — режем с запасом
const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
  'image/heif': 'heif', 'image/gif': 'gif', 'application/pdf': 'pdf',
};
function extOf(rec) {
  const byName = (rec.name || '').match(/\.([a-z0-9]{1,6})$/i);
  return EXT[rec.mime] || (byName ? byName[1].toLowerCase() : 'bin');
}

export function canUseDirectory() {
  return typeof window.showDirectoryPicker === 'function';
}

/** Собирает манифест: метаданные всех записей + список файлов для выгрузки. */
export async function buildManifest() {
  const records = await data.allFileRecords();
  const entries = [];
  const meta = [];
  for (const f of records) {
    const path = `files/${f.id}.${extOf(f)}`;
    const thumbPath = f._thumb ? `thumbs/${f.id}.jpg` : null;
    // блоб достаётся по требованию: в облаке файл скачивается прямо перед записью,
    // поэтому память не забивается всем архивом сразу
    entries.push({ name: path, size: f.size || 0, getBlob: () => data.getBlob(f) });
    if (f._thumb) entries.push({ name: thumbPath, size: f._thumb.size, getBlob: async () => f._thumb });
    meta.push({
      id: f.id, ownerType: f.ownerType, ownerId: f.ownerId, kind: f.kind,
      name: f.name, mime: f.mime, size: f.size, caption: f.caption || '',
      w: f.w || null, h: f.h || null, optimized: !!f.optimized,
      createdAt: f.createdAt, sort: f.sort, path, thumbPath: f._thumb ? thumbPath : null,
    });
  }
  const manifest = {
    app: 'bali-villas-crm', version: 2, exportedAt: new Date().toISOString(),
    villas: S.state.villas, bookings: S.state.bookings, clients: S.state.clients,
    settings: Object.entries(S.state.settings).map(([key, value]) => ({ key, value })),
    files: meta,
  };
  const totalBytes = entries.reduce((s, e) => s + (e.size || 0), 0);
  return { data: manifest, entries, totalBytes };
}

/* ---------- Бэкап в папку на диске (без ограничений по размеру) ---------- */
export async function exportToDirectory(onProgress = () => {}) {
  const root = await window.showDirectoryPicker({ mode: 'readwrite', id: 'bali-villas-backup' });
  const { data: manifest, entries, totalBytes } = await buildManifest();

  const dirs = new Map();
  const dirFor = async (path) => {
    const d = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (!d) return root;
    if (!dirs.has(d)) dirs.set(d, await root.getDirectoryHandle(d, { create: true }));
    return dirs.get(d);
  };
  const write = async (path, blob) => {
    const dir = await dirFor(path);
    const name = path.slice(path.lastIndexOf('/') + 1);
    try {   // уже выгруженный файл того же размера пропускаем — повторный бэкап быстрый
      const existing = await (await dir.getFileHandle(name)).getFile();
      if (existing.size === blob.size) return false;
    } catch (e) { void e; }
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(blob);
    await w.close();
    return true;
  };

  await write('data.json', new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
  let doneBytes = 0, written = 0, skipped = 0;
  for (const e of entries) {
    const isNew = await write(e.name, await e.getBlob());
    if (isNew) written++; else skipped++;
    doneBytes += e.size || 0;
    onProgress({ doneBytes, totalBytes, done: written + skipped, total: entries.length });
  }
  return { written, skipped, total: entries.length, bytes: totalBytes };
}

export async function importFromDirectory() {
  const root = await window.showDirectoryPicker({ mode: 'read', id: 'bali-villas-backup' });
  const dataFile = await (await root.getFileHandle('data.json')).getFile();
  const manifest = JSON.parse(await dataFile.text());
  const getBlob = async (path) => {
    if (!path) return null;
    const parts = path.split('/');
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
    return (await (await dir.getFileHandle(parts[parts.length - 1])).getFile());
  };
  return { data: manifest, getBlob };
}

/* ---------- Бэкап в ZIP (работает во всех браузерах) ---------- */
export async function exportToZips(onProgress = () => {}) {
  const { data: manifest, entries, totalBytes } = await buildManifest();
  const parts = [[]];
  let acc = 0;
  for (const e of entries) {
    if (acc + (e.size || 0) > ZIP_PART_LIMIT && parts[parts.length - 1].length) {
      parts.push([]); acc = 0;
    }
    parts[parts.length - 1].push(e);
    acc += e.size || 0;
  }
  const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  parts[0].unshift({ name: 'data.json', size: manifestBlob.size, getBlob: async () => manifestBlob });

  const stamp = new Date().toISOString().slice(0, 10);
  let base = 0;
  for (let i = 0; i < parts.length; i++) {
    const zip = await createZip(parts[i], (doneBytes) =>
      onProgress({ part: i + 1, parts: parts.length, doneBytes: base + doneBytes, totalBytes }));
    base += parts[i].reduce((s, e) => s + (e.size || 0), 0);
    const name = parts.length === 1
      ? `bali-villas-backup-${stamp}.zip`
      : `bali-villas-backup-${stamp}-part${i + 1}of${parts.length}.zip`;
    download(zip, name);
    await new Promise((r) => setTimeout(r, 900)); // браузеру нужен зазор между скачиваниями
  }
  return { parts: parts.length, bytes: totalBytes, label: bytes(totalBytes) };
}

export async function importFromZips(fileList) {
  const maps = [];
  let manifest = null;
  for (const f of [...fileList]) {
    const map = await readZip(f);
    if (map.has('data.json')) manifest = JSON.parse(await map.get('data.json').text());
    maps.push(map);
  }
  if (!manifest) throw new Error('В выбранных архивах нет data.json — добавьте часть 1 бэкапа');
  const getBlob = async (path) => {
    for (const m of maps) if (m.has(path)) return m.get(path);
    return null;
  };
  return { data: manifest, getBlob };
}

/* ---------- Применение бэкапа ---------- */
export async function applyBackup({ data: backup, getBlob }, { replace = false, onProgress = () => {} } = {}) {
  if (!backup || backup.app !== 'bali-villas-crm') throw new Error('Неподходящий файл бэкапа');
  if (replace) await data.clearEverything();

  for (const v of backup.villas || []) await data.putRow('villas', v);
  for (const b of backup.bookings || []) await data.putRow('bookings', b);
  for (const c of backup.clients || []) await data.putRow('clients', c);
  for (const st of backup.settings || []) await data.putRow('settings', st);

  const files = backup.files || [];
  let done = 0, restored = 0;
  for (const f of files) {
    done++;
    onProgress({ done, total: files.length });
    let blob = null;
    if (f.path && getBlob) blob = await getBlob(f.path);
    else if (f.data) blob = dataUrlToBlob(f.data);   // старый JSON-бэкап версии 1
    if (!blob) continue;
    const thumb = f.thumbPath && getBlob ? await getBlob(f.thumbPath) : null;
    await data.restoreFile({
      id: f.id, ownerType: f.ownerType, ownerId: f.ownerId, kind: f.kind,
      name: f.name, mime: f.mime, size: f.size || blob.size, caption: f.caption || '',
      w: f.w || null, h: f.h || null, optimized: !!f.optimized,
      createdAt: f.createdAt, sort: f.sort,
    }, blob, thumb);
    restored++;
  }
  await S.load();
  return { villas: (backup.villas || []).length, files: restored };
}

function dataUrlToBlob(url) {   // поддержка старых JSON-бэкапов версии 1
  const [head, b64] = url.split(',');
  const mime = (head.match(/:(.*?);/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Только данные, без файлов — маленький JSON на случай быстрого переноса. */
export async function exportDataOnly() {
  const payload = {
    app: 'bali-villas-crm', version: 2, exportedAt: new Date().toISOString(),
    villas: S.state.villas, bookings: S.state.bookings, clients: S.state.clients,
    settings: Object.entries(S.state.settings).map(([key, value]) => ({ key, value })),
    files: [],
  };
  download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `bali-villas-data-${new Date().toISOString().slice(0, 10)}.json`);
}
export async function importFromJson(file) {
  return { data: JSON.parse(await file.text()), getBlob: null };
}
