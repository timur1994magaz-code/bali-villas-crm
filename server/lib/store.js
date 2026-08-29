// ===== Хранилище сервера: SQLite + файлы на диске =====
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.CRM_DATA_DIR
  || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');

for (const d of [DATA_DIR, FILES_DIR, THUMBS_DIR]) fs.mkdirSync(d, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'crm.db'));
db.exec('pragma journal_mode = WAL');
db.exec('pragma foreign_keys = ON');
db.exec(`
  create table if not exists docs (
    tbl        text not null,
    id         text not null,
    doc        text not null,
    updated_at text not null,
    updated_by text,
    primary key (tbl, id)
  );
  create table if not exists settings (
    key   text primary key,
    value text
  );
  create table if not exists files (
    id         text primary key,
    owner_type text not null,
    owner_id   text not null,
    kind       text not null,
    name       text,
    mime       text,
    size       integer,
    caption    text default '',
    w          integer,
    h          integer,
    sort       real,
    ext        text,
    has_thumb  integer default 0,
    optimized  integer default 0,
    created_at text,
    created_by text
  );
  create index if not exists files_owner on files (owner_type, owner_id, kind, sort);
  create table if not exists users (
    id         text primary key,
    email      text unique not null,
    pass       text not null,
    role       text not null default 'manager',
    created_at text
  );
  create table if not exists sessions (
    token      text primary key,
    user_id    text not null,
    expires_at integer not null
  );
`);

export const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
export const TABLES = ['villas', 'bookings', 'clients'];

/* ---------- Записи ---------- */
export function allDocs() {
  const out = { villas: [], bookings: [], clients: [] };
  for (const r of db.prepare('select tbl, doc from docs').all()) {
    if (out[r.tbl]) out[r.tbl].push(JSON.parse(r.doc));
  }
  const settings = {};
  for (const r of db.prepare('select key, value from settings').all()) {
    settings[r.key] = JSON.parse(r.value);
  }
  return { ...out, settings };
}
export function putDoc(tbl, id, doc, userId) {
  db.prepare(`insert into docs (tbl, id, doc, updated_at, updated_by) values (?,?,?,?,?)
              on conflict(tbl, id) do update set doc = excluded.doc,
              updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(tbl, id, JSON.stringify(doc), now(), userId || null);
}
export function delDoc(tbl, id) {
  db.prepare('delete from docs where tbl = ? and id = ?').run(tbl, id);
}
export function putSetting(key, value) {
  db.prepare(`insert into settings (key, value) values (?,?)
              on conflict(key) do update set value = excluded.value`)
    .run(key, JSON.stringify(value === undefined ? null : value));
}
export function delSetting(key) {
  db.prepare('delete from settings where key = ?').run(key);
}

/* ---------- Файлы ---------- */
const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
};
export function extFor(name, mime) {
  const m = String(name || '').match(/\.([a-z0-9]{1,6})$/i);
  const e = EXT[mime] || (m ? m[1].toLowerCase() : 'bin');
  return e.replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'bin';
}
export const filePath = (id, ext) => path.join(FILES_DIR, `${id}.${ext}`);
export const thumbPath = (id) => path.join(THUMBS_DIR, `${id}.jpg`);

function rowToMeta(r) {
  return {
    id: r.id, ownerType: r.owner_type, ownerId: r.owner_id, kind: r.kind,
    name: r.name, mime: r.mime, size: r.size, caption: r.caption || '',
    w: r.w, h: r.h, sort: r.sort, ext: r.ext,
    hasThumb: !!r.has_thumb, optimized: !!r.optimized, createdAt: r.created_at,
  };
}
export function insertFile(meta, userId) {
  db.prepare(`insert into files
    (id, owner_type, owner_id, kind, name, mime, size, caption, w, h, sort, ext, has_thumb, optimized, created_at, created_by)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(meta.id, meta.ownerType, meta.ownerId, meta.kind, meta.name, meta.mime,
      meta.size, meta.caption || '', meta.w ?? null, meta.h ?? null, meta.sort ?? Date.now(),
      meta.ext, meta.hasThumb ? 1 : 0, meta.optimized ? 1 : 0, meta.createdAt || now(), userId || null);
  return getFile(meta.id);
}
export function getFile(id) {
  const r = db.prepare('select * from files where id = ?').get(id);
  return r ? rowToMeta(r) : null;
}
export function listFiles(ownerType, ownerId, kind) {
  const sql = kind
    ? 'select * from files where owner_type = ? and owner_id = ? and kind = ? order by sort asc'
    : 'select * from files where owner_type = ? and owner_id = ? order by sort asc';
  const args = kind ? [ownerType, ownerId, kind] : [ownerType, ownerId];
  return db.prepare(sql).all(...args).map(rowToMeta);
}
export function firstPhoto(ownerType, ownerId) {
  const r = db.prepare(`select * from files where owner_type = ? and owner_id = ? and kind = 'photo'
                        order by sort asc limit 1`).get(ownerType, ownerId);
  return r ? rowToMeta(r) : null;
}
export function countFiles(ownerType, ownerId, kind = 'photo') {
  const r = db.prepare(`select count(*) as n from files
                        where owner_type = ? and owner_id = ? and kind = ?`).get(ownerType, ownerId, kind);
  return r.n;
}
export function allFiles() {
  return db.prepare('select * from files order by created_at asc').all().map(rowToMeta);
}
export function updateFileMeta(id, patch) {
  const cur = getFile(id);
  if (!cur) return null;
  db.prepare('update files set caption = ?, sort = ? where id = ?')
    .run(patch.caption !== undefined ? patch.caption : cur.caption,
      patch.sort !== undefined ? patch.sort : cur.sort, id);
  return getFile(id);
}
function unlinkQuiet(p) { try { fs.unlinkSync(p); } catch (e) { void e; } }
export function deleteFile(id) {
  const f = getFile(id);
  if (!f) return false;
  unlinkQuiet(filePath(id, f.ext));
  if (f.hasThumb) unlinkQuiet(thumbPath(id));
  db.prepare('delete from files where id = ?').run(id);
  return true;
}
export function deleteFilesOf(ownerType, ownerId) {
  let n = 0;
  for (const f of listFiles(ownerType, ownerId)) { deleteFile(f.id); n++; }
  return n;
}
export function stats() {
  const r = db.prepare(`select
      sum(case when kind = 'photo' then 1 else 0 end) as photos,
      sum(case when kind = 'doc' then 1 else 0 end)   as docs,
      coalesce(sum(size), 0) as size,
      sum(case when kind = 'photo' and has_thumb = 0 then 1 else 0 end) as no_thumb
    from files`).get();
  return { photos: r.photos || 0, docs: r.docs || 0, size: r.size || 0, thumbSize: 0, noThumb: r.no_thumb || 0 };
}
export function wipeAll() {
  for (const f of allFiles()) deleteFile(f.id);
  db.exec('delete from docs; delete from settings;');
}

/* ---------- Пользователи и сессии ---------- */
export function listUsers() {
  return db.prepare('select id, email, role, created_at from users order by created_at asc').all();
}
export function userByEmail(email) {
  return db.prepare('select * from users where email = ?').get(String(email).toLowerCase().trim());
}
export function userById(id) {
  return db.prepare('select id, email, role, created_at from users where id = ?').get(id);
}
export function createUser(email, passHash, role = 'manager') {
  const u = { id: uid(), email: String(email).toLowerCase().trim(), pass: passHash, role, created_at: now() };
  db.prepare('insert into users (id, email, pass, role, created_at) values (?,?,?,?,?)')
    .run(u.id, u.email, u.pass, u.role, u.created_at);
  return { id: u.id, email: u.email, role: u.role, created_at: u.created_at };
}
export function updateUserPassword(id, passHash) {
  db.prepare('update users set pass = ? where id = ?').run(passHash, id);
}
export function deleteUser(id) {
  db.prepare('delete from sessions where user_id = ?').run(id);
  db.prepare('delete from users where id = ?').run(id);
}
export function countUsers() {
  return db.prepare('select count(*) as n from users').get().n;
}
export function createSession(userId, ttlMs) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('insert into sessions (token, user_id, expires_at) values (?,?,?)')
    .run(token, userId, Date.now() + ttlMs);
  return token;
}
export function sessionUser(token) {
  if (!token) return null;
  const s = db.prepare('select * from sessions where token = ?').get(token);
  if (!s) return null;
  if (s.expires_at < Date.now()) { db.prepare('delete from sessions where token = ?').run(token); return null; }
  return userById(s.user_id);
}
export function dropSession(token) {
  db.prepare('delete from sessions where token = ?').run(token);
}
export function purgeSessions() {
  db.prepare('delete from sessions where expires_at < ?').run(Date.now());
}
