// ===== IndexedDB: виллы, брони, клиенты, файлы =====
const DB_NAME = 'bali-villas-crm';
const DB_VERSION = 3;
export const STORES = ['villas', 'bookings', 'clients', 'tasks', 'files', 'settings'];

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
      let filesStore;
      if (!db.objectStoreNames.contains('files')) {
        filesStore = db.createObjectStore('files', { keyPath: 'id' });
        filesStore.createIndex('owner', ['ownerType', 'ownerId']);
      } else {
        filesStore = req.transaction.objectStore('files');
      }
      // индекс для быстрой обложки и порядка фото без чтения всех блобов
      if (!filesStore.indexNames.contains('ownerKindSort')) {
        filesStore.createIndex('ownerKindSort', ['ownerType', 'ownerId', 'kind', 'sort']);
      }
      if (!db.objectStoreNames.contains('tasks')) {
        const t = db.createObjectStore('tasks', { keyPath: 'id' });
        t.createIndex('due', 'due');
        t.createIndex('clientId', 'clientId');
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
export async function saveFile(ownerType, ownerId, file, kind, caption = '', extra = {}) {
  const rec = {
    id: uid(),
    ownerType, ownerId, kind,
    name: file.name || 'file',
    mime: file.type || 'application/octet-stream',
    size: file.size || 0,
    caption,
    blob: file,                 // оригинал хранится как есть
    thumb: extra.thumb || null,  // превью ~50 КБ для сеток и обложек
    w: extra.w || null,
    h: extra.h || null,
    optimized: !!extra.optimized,
    createdAt: new Date().toISOString(),
    sort: extra.sort !== undefined ? extra.sort : Date.now(),
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

/** Первое фото владельца — через курсор, без чтения остальных записей. */
export async function firstPhoto(ownerType, ownerId) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const idx = db.transaction('files', 'readonly').objectStore('files').index('ownerKindSort');
    const range = IDBKeyRange.bound(
      [ownerType, ownerId, 'photo', -Infinity],
      [ownerType, ownerId, 'photo', Infinity]);
    const req = idx.openCursor(range, 'next');
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}
/** Количество файлов — считается по индексу, блобы не читаются. */
export async function countFiles(ownerType, ownerId, kind = 'photo') {
  const db = await open();
  return new Promise((resolve, reject) => {
    const idx = db.transaction('files', 'readonly').objectStore('files').index('ownerKindSort');
    const req = idx.count(IDBKeyRange.bound(
      [ownerType, ownerId, kind, -Infinity],
      [ownerType, ownerId, kind, Infinity]));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
/** Проход по всем файлам курсором — по одной записи, без загрузки всего списка. */
export async function eachFile(cb) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction('files', 'readonly').objectStore('files').openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      cb(cur.value);          // синхронно: иначе транзакция закроется до continue()
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
/** Сводка по файлам без удержания всех записей в памяти. */
export async function fileStats() {
  const st = { photos: 0, docs: 0, size: 0, thumbSize: 0, noThumb: 0 };
  await eachFile((f) => {
    if (f.kind === 'photo') st.photos++; else st.docs++;
    st.size += f.size || 0;
    if (f.thumb) st.thumbSize += f.thumb.size || 0;
    else if (f.kind === 'photo') st.noThumb++;
  });
  return st;
}

// ==== Оценка занятого места ====
export async function storageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    const e = await navigator.storage.estimate();
    return { usage: e.usage || 0, quota: e.quota || 0 };
  }
  return { usage: 0, quota: 0 };
}
