// ===== Перенос локальной базы браузера в общую (свой сервер или Supabase) =====
import * as db from './db.js';
import * as data from './data.js';

export async function localCounts() {
  const [villas, bookings, clients] = await Promise.all([
    db.all('villas'), db.all('bookings'), db.all('clients'),
  ]);
  const files = [];
  await db.eachFile((f) => files.push({ id: f.id, size: f.size || 0 }));
  return {
    villas: villas.length, bookings: bookings.length, clients: clients.length,
    files: files.length, bytes: files.reduce((s, f) => s + f.size, 0),
  };
}

export async function localToRemote(onProgress = () => {}) {
  const [villas, bookings, clients, tasks, settings] = await Promise.all([
    db.all('villas'), db.all('bookings'), db.all('clients'), db.all('tasks'), db.all('settings'),
  ]);
  const files = [];
  await db.eachFile((f) => files.push(f));

  const totalSteps = villas.length + bookings.length + clients.length + settings.length + files.length;
  let step = 0;
  const tick = (label) => { step++; onProgress({ step, totalSteps, label }); };

  for (const v of villas) { await data.putRow('villas', v); tick(`Вилла: ${v.name || v.id}`); }
  for (const c of clients) { await data.putRow('clients', c); tick(`Клиент: ${c.name || c.id}`); }
  for (const b of bookings) { await data.putRow('bookings', b); tick('Бронь'); }
  for (const t of tasks) { await data.putRow('tasks', t); tick('Задача'); }
  for (const s of settings) { await data.putRow('settings', s); tick('Настройка'); }

  let uploaded = 0, failed = 0;
  for (const f of files) {
    try {
      await data.restoreFile({
        id: f.id, ownerType: f.ownerType, ownerId: f.ownerId, kind: f.kind,
        name: f.name, mime: f.mime, size: f.size, caption: f.caption || '',
        w: f.w || null, h: f.h || null, optimized: !!f.optimized, sort: f.sort,
      }, f.blob, f.thumb || null);
      uploaded++;
    } catch (e) {
      console.error('Не перенёсся файл', f.name, e);
      failed++;
    }
    tick(`Файл: ${f.name}`);
  }
  return { villas: villas.length, bookings: bookings.length, clients: clients.length, uploaded, failed };
}

export const localToCloud = localToRemote;
