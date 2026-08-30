// ===== Сервер CRM: API, файлы, статика, живое обновление =====
// Запуск: node server.js   (порт: CRM_PORT, по умолчанию 8080)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as store from './lib/store.js';
import * as auth from './lib/auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = process.env.CRM_APP_DIR || path.join(HERE, '..');
const PORT = Number(process.env.CRM_PORT || 8080);
const HOST = process.env.CRM_HOST || '127.0.0.1';
const MAX_UPLOAD = Number(process.env.CRM_MAX_UPLOAD || 512) * 1024 * 1024;
const MAX_JSON = 4 * 1024 * 1024;
const VERSION = '1.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

/* ---------- вспомогательное ---------- */
const isSecure = (req) =>
  process.env.CRM_SECURE_COOKIES === '1' ||
  req.headers['x-forwarded-proto'] === 'https' ||
  !!req.socket.encrypted;
const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';

function send(res, code, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}
const ok = (res, body = { ok: true }, headers) => send(res, 200, body, headers);
const fail = (res, code, message) => send(res, code, { error: message });

async function readJson(req) {
  const len = Number(req.headers['content-length'] || 0);
  if (len > MAX_JSON) throw new Error('Слишком большой запрос');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_JSON) throw new Error('Слишком большой запрос');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/* ---------- живое обновление (SSE) ---------- */
const clients = new Set();
function broadcast(event, payload = {}) {
  const line = `data: ${JSON.stringify({ event, ...payload, at: Date.now() })}\n\n`;
  for (const res of clients) { try { res.write(line); } catch (e) { void e; } }
}
setInterval(() => {
  for (const res of clients) { try { res.write(': ping\n\n'); } catch (e) { void e; } }
  store.purgeSessions();
}, 25000).unref();

/* ---------- статика ---------- */
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.normalize(path.join(APP_DIR, rel));
  if (!full.startsWith(path.normalize(APP_DIR))) return fail(res, 403, 'Недопустимый путь');
  // серверные каталоги наружу не отдаём
  const blocked = [path.join(APP_DIR, 'server'), path.join(APP_DIR, 'data'), path.join(APP_DIR, '.git')];
  if (blocked.some((b) => full.startsWith(b))) return fail(res, 403, 'Недоступно');

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      if (rel === '/index.html') return fail(res, 404, 'Приложение не найдено рядом с сервером');
      return serveStatic(req, res, '/index.html');    // одностраничное приложение
    }
    const ext = path.extname(full).toLowerCase();
    // no-cache = браузер кэширует, но каждый раз переспрашивает: обновление приложения
    // применяется сразу, а неизменившиеся файлы отдаются как 304 без пересылки
    const lastModified = st.mtime.toUTCString();
    const etag = `W/"${st.size.toString(16)}-${st.mtime.getTime().toString(16)}"`;
    if (req.headers['if-none-match'] === etag || req.headers['if-modified-since'] === lastModified) {
      res.writeHead(304, { ETag: etag, 'Last-Modified': lastModified, 'Cache-Control': 'no-cache' });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      ETag: etag,
      'Last-Modified': lastModified,
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(full).pipe(res);
  });
}

/* ---------- отдача файла из хранилища ---------- */
function sendStoredFile(req, res, filePath, mime, name) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return fail(res, 404, 'Файл не найден');
    res.writeHead(200, {
      'Content-Type': mime || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name || 'file')}`,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------- маршруты ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method || 'GET';

  try {
    // здоровье — по нему приложение понимает, что работает со своим сервером
    if (p === '/api/health') {
      return ok(res, { app: 'bali-villas-crm', mode: 'server', version: VERSION, users: store.countUsers() });
    }

    // защита от запросов с чужих сайтов: заголовок нельзя подделать без CORS
    const mutating = method !== 'GET' && method !== 'HEAD';
    if (mutating && p.startsWith('/api/') && req.headers['x-crm'] !== '1') {
      return fail(res, 403, 'Запрос отклонён');
    }

    if (p === '/api/login' && method === 'POST') {
      const ip = clientIp(req);
      if (auth.tooManyAttempts(ip)) return fail(res, 429, 'Слишком много попыток входа, подождите 15 минут');
      const { email, password } = await readJson(req);
      const u = store.userByEmail(email || '');
      if (!u || !auth.verifyPassword(password || '', u.pass)) {
        auth.noteAttempt(ip);
        return fail(res, 401, 'Неверная почта или пароль');
      }
      auth.clearAttempts(ip);
      const token = store.createSession(u.id, auth.SESSION_TTL);
      return ok(res, { user: { id: u.id, email: u.email, role: u.role } },
        { 'Set-Cookie': auth.sessionCookie(token, isSecure(req)) });
    }

    if (p === '/api/logout' && method === 'POST') {
      const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE];
      if (token) store.dropSession(token);
      return ok(res, { ok: true }, { 'Set-Cookie': auth.clearCookie(isSecure(req)) });
    }

    // всё, что ниже, — только для вошедших
    if (p.startsWith('/api/') || p.startsWith('/f/') || p.startsWith('/t/')) {
      const user = auth.userFromRequest(req);
      if (!user) return fail(res, 401, 'Требуется вход');
      return handleAuthed(req, res, url, method, user);
    }

    return serveStatic(req, res, p);
  } catch (e) {
    console.error('Ошибка запроса', p, e);
    return fail(res, 500, e.message || 'Внутренняя ошибка');
  }
});

async function handleAuthed(req, res, url, method, user) {
  const p = url.pathname;
  const q = url.searchParams;

  if (p === '/api/me') return ok(res, { user });

  if (p === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return undefined;
  }

  /* ---- записи ---- */
  if (p === '/api/data' && method === 'GET') return ok(res, store.allDocs());

  const rowMatch = p.match(/^\/api\/row\/([a-z_]+)\/(.+)$/);
  if (rowMatch) {
    const [, tbl, rawId] = rowMatch;
    const id = decodeURIComponent(rawId);
    if (tbl === 'settings') {
      if (method === 'PUT') {
        const body = await readJson(req);
        store.putSetting(id, body.value);
        broadcast('settings');
        return ok(res);
      }
      if (method === 'DELETE') { store.delSetting(id); broadcast('settings'); return ok(res); }
    }
    if (!store.TABLES.includes(tbl)) return fail(res, 400, 'Неизвестная таблица');
    if (method === 'PUT') {
      const doc = await readJson(req);
      store.putDoc(tbl, id, doc, user.id);
      broadcast(tbl);
      return ok(res);
    }
    if (method === 'DELETE') { store.delDoc(tbl, id); broadcast(tbl); return ok(res); }
  }

  if (p === '/api/wipe' && method === 'POST') {
    if (user.role !== 'admin') return fail(res, 403, 'Только для владельца');
    store.wipeAll();
    broadcast('wipe');
    return ok(res);
  }

  /* ---- файлы ---- */
  if (p === '/api/files' && method === 'GET') {
    const ownerType = q.get('ownerType'), ownerId = q.get('ownerId'), kind = q.get('kind');
    if (q.get('scope') === 'all') return ok(res, { files: store.allFiles() });
    if (!ownerType || !ownerId) return fail(res, 400, 'Не указан владелец');
    return ok(res, { files: store.listFiles(ownerType, ownerId, kind || null) });
  }
  if (p === '/api/files/first' && method === 'GET') {
    return ok(res, { file: store.firstPhoto(q.get('ownerType'), q.get('ownerId')) });
  }
  if (p === '/api/files/count' && method === 'GET') {
    return ok(res, { count: store.countFiles(q.get('ownerType'), q.get('ownerId'), q.get('kind') || 'photo') });
  }
  if (p === '/api/files/stats' && method === 'GET') return ok(res, store.stats());

  if (p === '/api/files' && method === 'POST') {
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_UPLOAD) return fail(res, 413, 'Файл слишком большой');
    const request = new Request('http://upload', {
      method: 'POST',
      headers: { 'content-type': req.headers['content-type'] || '' },
      body: Readable.toWeb(req),
      duplex: 'half',
    });
    const form = await request.formData();
    const meta = JSON.parse(form.get('meta') || '{}');
    const file = form.get('file');
    const thumb = form.get('thumb');
    if (!file || typeof file === 'string') return fail(res, 400, 'Не передан файл');
    if (!meta.ownerType || !meta.ownerId || !meta.kind) return fail(res, 400, 'Не хватает данных о файле');

    const id = meta.id && /^[\w-]{6,64}$/.test(meta.id) ? meta.id : store.uid();
    const ext = store.extFor(meta.name || file.name, meta.mime || file.type);
    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(store.filePath(id, ext), buf);
    let hasThumb = false;
    if (thumb && typeof thumb !== 'string') {
      fs.writeFileSync(store.thumbPath(id), Buffer.from(await thumb.arrayBuffer()));
      hasThumb = true;
    }
    const saved = store.insertFile({
      id, ownerType: meta.ownerType, ownerId: meta.ownerId, kind: meta.kind,
      name: meta.name || file.name || 'file', mime: meta.mime || file.type || 'application/octet-stream',
      size: buf.length, caption: meta.caption || '', w: meta.w ?? null, h: meta.h ?? null,
      sort: meta.sort ?? Date.now(), ext, hasThumb, optimized: !!meta.optimized,
      createdAt: meta.createdAt || new Date().toISOString(),
    }, user.id);
    broadcast('files');
    return ok(res, { file: saved });
  }

  const fileIdMatch = p.match(/^\/api\/files\/([\w-]+)$/);
  if (fileIdMatch) {
    const id = fileIdMatch[1];
    if (method === 'PATCH') {
      const patch = await readJson(req);
      const updated = store.updateFileMeta(id, patch);
      if (!updated) return fail(res, 404, 'Файл не найден');
      broadcast('files');
      return ok(res, { file: updated });
    }
    if (method === 'DELETE') {
      store.deleteFile(id);
      broadcast('files');
      return ok(res);
    }
  }
  if (p === '/api/files' && method === 'DELETE') {
    const n = store.deleteFilesOf(q.get('ownerType'), q.get('ownerId'));
    broadcast('files');
    return ok(res, { deleted: n });
  }

  // содержимое файлов
  const blobMatch = p.match(/^\/(f|t)\/([\w-]+)$/);
  if (blobMatch) {
    const [, kind, id] = blobMatch;
    const f = store.getFile(id);
    if (!f) return fail(res, 404, 'Файл не найден');
    return kind === 'f'
      ? sendStoredFile(req, res, store.filePath(id, f.ext), f.mime, f.name)
      : sendStoredFile(req, res, store.thumbPath(id), 'image/jpeg', 'thumb.jpg');
  }

  /* ---- пользователи (только владелец) ---- */
  if (p === '/api/users') {
    if (user.role !== 'admin') return fail(res, 403, 'Только для владельца');
    if (method === 'GET') return ok(res, { users: store.listUsers() });
    if (method === 'POST') {
      const { email, password, role } = await readJson(req);
      // логин — либо почта, либо просто имя: писем система не шлёт, это только вход
      if (!email || !/^[a-zA-Z0-9._@+-]{3,64}$/.test(String(email).trim())) {
        return fail(res, 400, 'Логин: латиница, цифры, точка, дефис — от 3 символов. Можно почту.');
      }
      if (!password || String(password).length < 8) return fail(res, 400, 'Пароль должен быть не короче 8 символов');
      if (store.userByEmail(email)) return fail(res, 409, 'Такой пользователь уже есть');
      const created = store.createUser(email, auth.hashPassword(password), role === 'admin' ? 'admin' : 'manager');
      return ok(res, { user: created });
    }
  }
  const userIdMatch = p.match(/^\/api\/users\/([\w-]+)$/);
  if (userIdMatch) {
    if (user.role !== 'admin') return fail(res, 403, 'Только для владельца');
    const id = userIdMatch[1];
    if (method === 'DELETE') {
      if (id === user.id) return fail(res, 400, 'Нельзя удалить самого себя');
      store.deleteUser(id);
      return ok(res);
    }
    if (method === 'PATCH') {
      const { password } = await readJson(req);
      if (!password || String(password).length < 8) return fail(res, 400, 'Пароль должен быть не короче 8 символов');
      store.updateUserPassword(id, auth.hashPassword(password));
      return ok(res);
    }
  }

  return fail(res, 404, 'Неизвестный запрос');
}

server.listen(PORT, HOST, () => {
  const n = store.countUsers();
  console.log(`CRM работает: http://${HOST}:${PORT}`);
  console.log(`Данные: ${store.DATA_DIR}`);
  if (!n) console.log('Пользователей нет. Создайте владельца: npm run user -- add ваша@почта.ру --admin');
});
