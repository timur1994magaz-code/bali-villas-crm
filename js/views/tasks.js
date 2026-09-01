// ===== Задачи: что сделать по клиентам и виллам =====
import * as S from '../store.js';
import { esc, today, fmtDateShort, addDays } from '../util.js';
import { modal, closeModal, field, formData, toast, confirmDialog } from '../ui.js';

// вкладки списка: срок задаёт приоритет, а не тип задачи
const GROUPS = {
  active:  { label: 'Актуальные', test: (t) => !t.done },
  overdue: { label: 'Просроченные', test: (t) => S.isOverdue(t) },
  today:   { label: 'На сегодня', test: (t) => S.isToday(t) },
  week:    { label: 'Неделя', test: (t) => !t.done && t.due && t.due >= today() && t.due <= addDays(today(), 7) },
  done:    { label: 'Выполненные', test: (t) => t.done },
};

let group = 'active', q = '';

const linkOf = (t) => {
  const c = t.clientId && S.client(t.clientId);
  const v = t.villaId && S.villa(t.villaId);
  const out = [];
  if (c) out.push(`<a href="#/client/${esc(c.id)}">👤 ${esc(c.name || 'Клиент')}</a>`);
  if (v) out.push(`<a href="#/villa/${esc(v.id)}">🏝️ ${esc(v.name || 'Вилла')}</a>`);
  return out.join(' · ');
};

/** Срок человеческим языком: «сегодня», «вчера», «через 3 дня». */
function dueLabel(t) {
  if (!t.due) return { text: 'без срока', cls: 'due-none' };
  const d = Math.round((new Date(t.due) - new Date(today())) / 86400000);
  const time = t.dueTime ? ` в ${esc(t.dueTime)}` : '';
  if (t.done) return { text: fmtDateShort(t.due), cls: 'due-done' };
  if (d < 0) return { text: `${fmtDateShort(t.due)} · просрочена на ${-d} дн.`, cls: 'due-over' };
  if (d === 0) return { text: `сегодня${time}`, cls: 'due-today' };
  if (d === 1) return { text: `завтра${time}`, cls: 'due-soon' };
  if (d <= 7) return { text: `${fmtDateShort(t.due)} · через ${d} дн.`, cls: 'due-soon' };
  return { text: fmtDateShort(t.due), cls: '' };
}

export function taskRow(t, { compact = false } = {}) {
  const k = S.TASK_KINDS[t.kind] || S.TASK_KINDS.other;
  const due = dueLabel(t);
  const links = compact ? '' : linkOf(t);
  return `<div class="task-item${t.done ? ' is-done' : ''}" data-task="${esc(t.id)}">
    <label class="task-check" title="${t.done ? 'Вернуть в работу' : 'Выполнено'}">
      <input type="checkbox" data-toggle="${esc(t.id)}"${t.done ? ' checked' : ''}>
    </label>
    <div class="task-main">
      <div class="task-title">${esc(k.icon)} ${esc(t.title || 'Без названия')}</div>
      ${t.note ? `<div class="task-note">${esc(t.note)}</div>` : ''}
      ${links ? `<div class="task-links">${links}</div>` : ''}
    </div>
    <div class="task-side">
      <span class="task-due ${due.cls}">${esc(due.text)}</span>
      ${t.assignee ? `<span class="file-sub">${esc(t.assignee)}</span>` : ''}
    </div>
    <div class="task-acts">
      <button class="btn btn-sm btn-ghost" data-edit="${esc(t.id)}" title="Изменить">✎</button>
      <button class="btn btn-sm btn-ghost" data-del="${esc(t.id)}" title="Удалить">🗑</button>
    </div>
  </div>`;
}

/** Общий обработчик списка задач — используется и в разделе, и в карточке клиента. */
export function bindTaskList(box, redraw) {
  box.onclick = async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return taskForm(S.task(ed.dataset.edit), redraw);
    const del = e.target.closest('[data-del]');
    if (del) {
      const t = S.task(del.dataset.del);
      if (!t) return;
      if (!await confirmDialog(`Удалить задачу «${t.title || 'без названия'}»?`)) return;
      await S.deleteTask(t.id);
      toast('Задача удалена');
      redraw();
    }
  };
  box.onchange = async (e) => {
    const cb = e.target.closest('[data-toggle]');
    if (!cb) return;
    await S.toggleTask(cb.dataset.toggle, cb.checked);
    redraw();
  };
}

export function taskForm(t, onSaved) {
  const isNew = !S.task(t.id);
  const clientOpts = [{ value: '', label: '— не выбран —' }]
    .concat(S.state.clients.map((c) => ({ value: c.id, label: c.name || 'Без имени' })));
  const villaOpts = [{ value: '', label: '— не выбрана —' }]
    .concat(S.state.villas.map((v) => ({ value: v.id, label: v.name || 'Без названия' })));
  const kindOpts = Object.entries(S.TASK_KINDS).map(([v, k]) => ({ value: v, label: `${k.icon} ${k.label}` }));

  modal({
    title: isNew ? 'Новая задача' : 'Задача',
    body: `
      ${field('title', 'Что сделать', { value: t.title, placeholder: 'Позвонить собственнику, уточнить цену', required: true })}
      <div class="grid-2">
        ${field('kind', 'Тип', { value: t.kind, options: kindOpts })}
        ${field('assignee', 'Ответственный', { value: t.assignee, placeholder: 'Имя сотрудника' })}
      </div>
      <div class="grid-2">
        ${field('due', 'Срок', { type: 'date', value: t.due })}
        ${field('dueTime', 'Время', { type: 'time', value: t.dueTime })}
      </div>
      <div class="grid-2">
        ${field('clientId', 'Клиент', { value: t.clientId, options: clientOpts })}
        ${field('villaId', 'Вилла', { value: t.villaId, options: villaOpts })}
      </div>
      ${field('note', 'Заметка', { type: 'textarea', value: t.note, rows: 3 })}`,
    footer: `<button class="btn" data-cancel>Отмена</button>
             <button class="btn btn-primary" data-save>Сохранить</button>`,
    onMount(el) {
      el.querySelector('[data-cancel]').onclick = () => closeModal();
      el.querySelector('[data-save]').onclick = async () => {
        const f = formData(el);
        if (!f.title) return toast('Впишите, что нужно сделать', true);
        await S.saveTask({ ...t, ...f, done: t.done });
        closeModal();
        toast(isNew ? 'Задача создана' : 'Задача сохранена');
        if (onSaved) onSaved();
      };
    },
  });
}

export async function renderTasks(view, actions) {
  actions.innerHTML = `
    <input class="search" id="task-search" type="search" placeholder="Поиск по задачам…" value="${esc(q)}">
    <div class="seg" id="task-seg">
      ${Object.entries(GROUPS).map(([k, g]) =>
        `<button data-g="${k}"${k === group ? ' class="active"' : ''}>${g.label}</button>`).join('')}
    </div>
    <button class="btn btn-primary" id="task-add">+ Задача</button>`;

  const box = document.createElement('div');
  view.innerHTML = '';
  view.appendChild(box);

  actions.querySelector('#task-add').onclick = () => taskForm(S.emptyTask(), draw);
  actions.querySelector('#task-search').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
  actions.querySelectorAll('#task-seg button').forEach((b) => {
    b.onclick = () => {
      group = b.dataset.g;
      actions.querySelectorAll('#task-seg button').forEach((x) => x.classList.toggle('active', x === b));
      draw();
    };
  });

  function draw() {
    const c = S.taskCounts();
    const list = S.state.tasks.filter(GROUPS[group].test).filter((t) => !q ||
      [t.title, t.note, t.assignee, (S.client(t.clientId) || {}).name, (S.villa(t.villaId) || {}).name]
        .join(' ').toLowerCase().includes(q));

    if (!S.state.tasks.length) {
      box.className = '';
      box.innerHTML = `<div class="empty-state">
        <div class="big">✅</div><h3>Задач пока нет</h3>
        <p>Записывайте, что нужно сделать: позвонить собственнику, отправить договор, забрать депозит.<br>
        Просроченные и сегодняшние будут видны на дашборде.</p>
        <button class="btn btn-primary" id="empty-add">+ Первая задача</button>
      </div>`;
      box.querySelector('#empty-add').onclick = () => taskForm(S.emptyTask(), draw);
      return;
    }

    box.className = 'task-wrap';
    box.innerHTML = `
      <div class="task-summary">
        ${c.overdue ? `<span class="badge b-blocked">Просрочено: ${c.overdue}</span>` : ''}
        ${c.today ? `<span class="badge b-option">Сегодня: ${c.today}</span>` : ''}
        ${c.later ? `<span class="badge b-booked">Впереди: ${c.later}</span>` : ''}
        ${c.noDate ? `<span class="badge b-off">Без срока: ${c.noDate}</span>` : ''}
        ${!c.open ? '<span class="badge b-occupied">Всё сделано</span>' : ''}
      </div>
      ${list.length
        ? `<div class="task-list">${list.map((t) => taskRow(t)).join('')}</div>`
        : '<div class="empty-state">В этой вкладке пусто</div>'}`;
    bindTaskList(box, draw);
  }

  draw();
}
