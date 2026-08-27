// ===== Точка входа и роутер =====
import * as S from './store.js';
import * as db from './db.js';
import { toast } from './ui.js';
import { bookingForm } from './booking.js';
import { renderVillasList } from './views/villas.js';
import { renderVillaCard, villaForm } from './views/villa.js';
import { renderCalendar } from './views/calendar.js';
import { renderClientsList, renderClientCard } from './views/clients.js';
import { renderDashboard } from './views/dashboard.js';
import { renderSettings } from './views/settings.js';
import { revokeAll } from './files-ui.js';
import { bytes, today, addDays } from './util.js';

const view = document.getElementById('view');
const actions = document.getElementById('topbar-actions');
const titleEl = document.getElementById('page-title');

const TITLES = {
  dashboard: 'Дашборд', villas: 'Виллы', calendar: 'Календарь занятости',
  clients: 'Клиенты', settings: 'Настройки',
};

async function route() {
  revokeAll();
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
    view.innerHTML = `<div class="empty-state"><h3>Ошибка отображения</h3><p>${e.message}</p></div>`;
  }
}

async function updateStorageNote() {
  const est = await db.storageEstimate();
  const note = document.getElementById('storage-note');
  note.innerHTML = est.usage
    ? `💾 Локально: ${bytes(est.usage)}<br>Данные хранятся в браузере. Делайте бэкап в «Настройках».`
    : '💾 Данные хранятся локально в браузере. Делайте бэкап в «Настройках».';
}

window.addEventListener('hashchange', route);
window.addEventListener('data-changed', () => { route(); updateStorageNote(); });
S.onChange(() => updateStorageNote());

document.getElementById('btn-menu').onclick = () =>
  document.querySelector('.sidebar').classList.toggle('open');
document.getElementById('btn-quick-villa').onclick = () => villaForm(S.emptyVilla());
document.getElementById('btn-quick-booking').onclick = () => {
  if (!S.state.villas.length) return toast('Сначала добавьте виллу', true);
  bookingForm(S.emptyBooking(S.state.villas[0].id, today(), addDays(today(), 7)),
    { onSaved: () => window.dispatchEvent(new Event('data-changed')) });
};

(async function init() {
  try {
    await S.load();
  } catch (e) {
    console.error(e);
    toast('Не удалось открыть локальную базу: ' + e.message, true);
  }
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch (e) { void e; }
  }
  await updateStorageNote();
  route();
})();
