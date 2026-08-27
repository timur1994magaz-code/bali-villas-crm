// ===== IndexedDB: виллы, брони, клиенты, файлы =====
const DB_NAME = 'bali-villas-crm';
const DB_VERSION = 1;
export const STORES = ['villas', 'bookings', 'clients', 'files', 'settings'];

let _db = null;

export function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('villas')) {
        db.createObjectStore('villas', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('bookings')) {
        const s = db.createObjectStore('bookings', { keyPath: 'id' });
        s.createIndex('villaId', 'villaId');
        s.createIndex('clientId', 'clientId');
        s.createIndex('dateFrom', 'dateFrom');
      }
      if (!db.objectStoreNames.contains('clients')) {
        db.createObjectStore('clients', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        const s = db.createObjectStore('files', { keyPath: 'id' });
        s.createIndex('owner', ['ownerType', 'ownerId']);
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      void e;
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return open().then((db) => db.transaction(store, mode).objectStore(store));
}
function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function put(store, value) {
  const os = await tx(store, 'readwrite');
  await wrap(os.put(value));
  return value;
}
export async function get(store, id) {
  const os = await tx(store, 'readonly');
  return wrap(os.get(id));
}
export async function all(store) {
  const os = await tx(store, 'readonly');
  return wrap(os.getAll());
}
export async function del(store, id) {
  const os = await tx(store, 'readwrite');
  return wrap(os.delete(id));
}
export async function byIndex(store, index, value) {
  const os = await tx(store, 'readonly');
  return wrap(os.index(index).getAll(value));
}
export async function clear(store) {
  const os = await tx(store, 'readwrite');
  return wrap(os.clear());
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ==== Файлы (фото / документы) ====
export async function saveFile(ownerType, ownerId, file, kind, caption = '') {
  const rec = {
    id: uid(),
    ownerType, ownerId, kind,
    name: file.name || 'file',
    mime: file.type || 'application/octet-stream',
    size: file.size || 0,
    caption,
    blob: file,                 // Blob хранится как есть — без сжатия, полное качество
    createdAt: new Date().toISOString(),
    sort: Date.now(),
  };
  await put('files', rec);
  return rec;
}
export async function filesOf(ownerType, ownerId, kind = null) {
  const list = await byIndex('files', 'owner', [ownerType, ownerId]);
  const out = kind ? list.filter((f) => f.kind === kind) : list;
  return out.sort((a, b) => (a.sort || 0) - (b.sort || 0));
}
export async function deleteFilesOf(ownerType, ownerId) {
  const list = await byIndex('files', 'owner', [ownerType, ownerId]);
  for (const f of list) await del('files', f.id);
}

// ==== Оценка занятого места ====
export async function storageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    const e = await navigator.storage.estimate();
    return { usage: e.usage || 0, quota: e.quota || 0 };
  }
  return { usage: 0, quota: 0 };
}
