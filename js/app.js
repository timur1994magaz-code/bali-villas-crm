// ===== Точка входа, вход в систему и роутер =====
import * as S from './store.js';
import * as data from './data.js';
import * as cloud from './cloud.js';
import { toast } from './ui.js';
import { bookingForm } from './booking.js';
import { renderVillasList } from './views/villas.js';
import { renderVillaCard, villaForm } from './views/villa.js';
import { renderCalendar } from './views/calendar.js';
import { renderClientsList, renderClientCard } from './views/clients.js';
import { renderDashboard } from './views/dashboard.js';
import { renderSettings } from './views/settings.js';
import { bytes, esc, today, addDays } from './util.js';
import { clearCloudConfig } from './config.js';

const view = document.getElementById('view');
const actions = document.getElementById('topbar-actions');
const titleEl = document.getElementById('page-title');

const TITLES = {
  dashboard: 'Дашборд', villas: 'Виллы', calendar: 'Календарь занятости',
  clients: 'Клиенты', settings: 'Настройки',
};

let currentUser = null;
let unsubscribe = null;

async function route() {
  data.revokeAll();
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [page, id] = hash.split('/');
  actions.innerHTML = '';
  view.innerHTML = '';
  titleEl.textContent = TITLES[page] || '';

  document.querySelectorAll('.nav-item').forEach((a) => {
    const base = a.getAttribute('href').replace('#/', '');
    a.classList.toggle('active', base === page ||
      (page === 'villa' && base === 'villas') || (page === 'client' && base === 'clients'));
  });
  document.querySelector('.sidebar').classList.remove('open');

  try {
    if (page === 'villas') return renderVillasList(view, actions);
    if (page === 'villa') return renderVillaCard(view, actions, id);
    if (page === 'calendar') return renderCalendar(view, actions);
    if (page === 'clients') return renderClientsList(view, actions);
    if (page === 'client') return renderClientCard(view, actions, id);
    if (page === 'settings') return renderSettings(view, actions);
    return renderDashboard(view);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty-state"><h3>Ошибка отображения</h3><p>${esc(e.message)}</p></div>`;
  }
}

/* ---------- Экран входа ---------- */
function showLogin(message = '') {
  document.getElementById('app').style.display = 'none';
  let box = document.getElementById('login-screen');
  if (!box) {
    box = document.createElement('div');
    box.id = 'login-screen';
    box.className = 'login-screen';
    document.body.appendChild(box);
  }
  box.hidden = false;
  box.innerHTML = `
    <form class="login-card" id="login-form">
      <div class="login-logo">🌴</div>
      <h2>Bali Villas CRM</h2>
      <p class="hint">${data.isServer() ? 'Вход в систему' : 'Вход в общую базу'}</p>
      ${message ? `<div class="login-error">${esc(message)}</div>` : ''}
      <label class="field"><span>Почта</span><input type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>Пароль</span><input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary" type="submit" id="login-btn">Войти</button>
      ${data.canResetPassword() ? '<button class="btn btn-ghost btn-sm" type="button" id="forgot">Забыли пароль?</button>' : ''}
      ${data.isServer() ? '<p class="hint">Пароль забыли? Его сбросит владелец в разделе «Сотрудники».</p>'
        : '<button class="btn btn-ghost btn-sm" type="button" id="local-mode">Отключить общую базу и работать локально</button>'}
    </form>`;

  box.querySelector('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = box.querySelector('#login-btn');
    btn.disabled = true; btn.textContent = 'Входим…';
    try {
      const fd = new FormData(e.target);
      await data.signIn(fd.get('email'), fd.get('password'));
      box.hidden = true;
      document.getElementById('app').style.display = '';
      await boot();
    } catch (err) {
      showLogin(err.message);
    }
  };
  const forgot = box.querySelector('#forgot');
  if (forgot) forgot.onclick = async () => {
    const email = box.querySelector('[name=email]').value.trim();
    if (!email) return showLogin('Введите почту, на неё придёт ссылка для смены пароля');
    try { await cloud.sendPasswordReset(email); showLogin('Письмо со ссылкой отправлено на ' + email); }
    catch (err) { showLogin(err.message); }
  };
  const localBtn = box.querySelector('#local-mode');
  if (localBtn) localBtn.onclick = () => {
    // сбрасываем подключение, иначе приложение снова упрётся в недоступный сервер
    clearCloudConfig();
    cloud.resetClient();
    location.hash = '#/settings';
    location.reload();
  };
}

/* ---------- Живое обновление у второго сотрудника ---------- */
let reloadTimer = null;
async function startRealtime() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  try {
    unsubscribe = await data.subscribe(() => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        const modalOpen = !document.getElementById('modal-root').hidden;
        await S.load();
        if (!modalOpen) route();      // не выдёргиваем форму из-под рук
      }, 500);
    });
  } catch (e) {
    console.warn('Живое обновление недоступно:', e.message);
  }
}

/* ---------- Подвал боковой панели ---------- */
async function updateFooter() {
  const note = document.getElementById('storage-note');
  if (data.isRemote()) {
    const icon = data.isServer() ? '🖥️' : '☁️';
    const title = data.isServer() ? 'Ваш сервер' : 'Общая база';
    note.innerHTML = `${icon} ${title}${currentUser ? `<br>${esc(currentUser.email)}` : ''}
      <br><a href="#" id="signout-link">Выйти</a>`;
    const link = note.querySelector('#signout-link');
    if (link) link.onclick = async (e) => {
      e.preventDefault();
      await data.signOut();
      location.reload();
    };
    return;
  }
  const { usage } = await data.storageInfo();
  note.innerHTML = usage
    ? `💾 Локально: ${bytes(usage)}<br>Данные только на этом устройстве. Бэкап — в «Настройках».`
    : '💾 Данные хранятся локально в браузере. Делайте бэкап в «Настройках».';
}

window.addEventListener('hashchange', route);
window.addEventListener('data-changed', () => { route(); updateFooter(); });
S.onChange(() => updateFooter());

document.getElementById('btn-menu').onclick = () =>
  document.querySelector('.sidebar').classList.toggle('open');
document.getElementById('btn-quick-villa').onclick = () => villaForm(S.emptyVilla());
document.getElementById('btn-quick-booking').onclick = () => {
  if (!S.state.villas.length) return toast('Сначала добавьте виллу', true);
  bookingForm(S.emptyBooking(S.state.villas[0].id, today(), addDays(today(), 7)),
    { onSaved: () => window.dispatchEvent(new Event('data-changed')) });
};

async function boot() {
  await data.init();                     // свой сервер? общая база? локально?
  if (data.isRemote()) {
    try {
      currentUser = await data.currentUser();
    } catch (e) {
      console.error(e);
      showLogin(`Не удалось связаться с ${data.isServer() ? 'сервером' : 'общей базой'}: ${e.message}`);
      return;
    }
    if (!currentUser) return showLogin();
    await startRealtime();
  }
  try {
    await S.load();
  } catch (e) {
    console.error(e);
    if (data.isRemote()) return showLogin('Ошибка загрузки данных: ' + e.message);
    toast('Не удалось открыть локальную базу: ' + e.message, true);
  }
  if (!data.isRemote() && navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch (e) { void e; }
  }
  await updateFooter();
  route();
}

boot();
