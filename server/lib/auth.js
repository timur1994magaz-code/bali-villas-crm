// ===== Пароли, сессии, защита от перебора =====
import crypto from 'node:crypto';
import * as store from './store.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;   // 30 дней

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const key = crypto.scryptSync(String(password), salt, expected.length,
      { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(key, expected);
  } catch (e) {
    void e;
    return false;
  }
}

/* ---- ограничение попыток входа: 10 за 15 минут с одного адреса ---- */
const attempts = new Map();
const WINDOW = 15 * 60 * 1000, LIMIT = 10;
export function tooManyAttempts(ip) {
  const list = (attempts.get(ip) || []).filter((t) => Date.now() - t < WINDOW);
  attempts.set(ip, list);
  return list.length >= LIMIT;
}
export function noteAttempt(ip) {
  const list = attempts.get(ip) || [];
  list.push(Date.now());
  attempts.set(ip, list);
}
export function clearAttempts(ip) { attempts.delete(ip); }

/* ---- cookie сессии ---- */
export const COOKIE = 'crm_session';
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function sessionCookie(token, secure, maxAgeSec = SESSION_TTL / 1000) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}
export function clearCookie(secure) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
export function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  return store.sessionUser(token);
}
