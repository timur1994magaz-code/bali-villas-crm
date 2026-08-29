#!/usr/bin/env node
// ===== Управление пользователями из терминала =====
// node cli.js add почта@пример.ру [--admin] [--password СТРОКА]
// node cli.js list
// node cli.js password почта@пример.ру [--password СТРОКА]
// node cli.js delete почта@пример.ру
import crypto from 'node:crypto';
import * as store from './lib/store.js';
import { hashPassword } from './lib/auth.js';

const [, , cmd, arg, ...rest] = process.argv;
const flag = (name) => {
  const i = rest.indexOf('--' + name);
  return i >= 0 ? (rest[i + 1] || true) : undefined;
};
const genPassword = () => crypto.randomBytes(9).toString('base64url');

function usage() {
  console.log(`Управление пользователями CRM:

  node cli.js add почта@пример.ру [--admin] [--password СТРОКА]
  node cli.js list
  node cli.js password почта@пример.ру [--password СТРОКА]
  node cli.js delete почта@пример.ру

Без --password пароль придумывается автоматически и печатается один раз.`);
}

if (cmd === 'add') {
  if (!arg) { usage(); process.exit(1); }
  if (store.userByEmail(arg)) { console.error('Такой пользователь уже есть:', arg); process.exit(1); }
  const password = typeof flag('password') === 'string' ? flag('password') : genPassword();
  if (String(password).length < 8) { console.error('Пароль должен быть не короче 8 символов'); process.exit(1); }
  const role = flag('admin') ? 'admin' : 'manager';
  const u = store.createUser(arg, hashPassword(password), role);
  console.log(`Создан пользователь: ${u.email} (${role === 'admin' ? 'владелец' : 'сотрудник'})`);
  console.log(`Пароль: ${password}`);
  console.log('Передайте его сотруднику — второй раз пароль не показывается.');
} else if (cmd === 'list') {
  const list = store.listUsers();
  if (!list.length) console.log('Пользователей нет.');
  for (const u of list) {
    console.log(`${u.email}\t${u.role === 'admin' ? 'владелец' : 'сотрудник'}\t${String(u.created_at).slice(0, 10)}`);
  }
} else if (cmd === 'password') {
  const u = store.userByEmail(arg || '');
  if (!u) { console.error('Пользователь не найден:', arg); process.exit(1); }
  const password = typeof flag('password') === 'string' ? flag('password') : genPassword();
  if (String(password).length < 8) { console.error('Пароль должен быть не короче 8 символов'); process.exit(1); }
  store.updateUserPassword(u.id, hashPassword(password));
  console.log(`Пароль изменён для ${u.email}`);
  console.log(`Новый пароль: ${password}`);
} else if (cmd === 'delete') {
  const u = store.userByEmail(arg || '');
  if (!u) { console.error('Пользователь не найден:', arg); process.exit(1); }
  store.deleteUser(u.id);
  console.log('Пользователь удалён:', u.email);
} else {
  usage();
}
