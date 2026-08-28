// ===== Настройки: валюта, качество фото, бэкап, хранилище =====
import * as S from '../store.js';
import * as data from '../data.js';
import * as cloud from '../cloud.js';
import * as B from '../backup.js';
import * as migrate from '../migrate.js';
import { cloudConfig, setCloudConfig, clearCloudConfig } from '../config.js';
import { toast, confirmDialog, field, formData, modal, closeModal } from '../ui.js';
import { CURRENCIES, bytes, esc } from '../util.js';

const QUALITY = [
  { value: 'original', label: 'Оригинал — без сжатия (максимальное качество)' },
  { value: '2560', label: 'До 2560 px — визуально то же, файлы в 4–6 раз меньше' },
  { value: '1920', label: 'До 1920 px — самый лёгкий архив, хватает для показа клиенту' },
];

export async function renderSettings(view, actions) {
  actions.innerHTML = '';
  const est = await data.storageInfo();
  const st = await data.fileStats();
  const isCloud = data.isCloud();
  const cfg = cloudConfig();
  const user = isCloud ? await cloud.currentUser().catch(() => null) : null;
  const free = est.quota ? est.quota - est.usage : 0;
  const pct = est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
  const quality = localStorage.getItem('photoQuality') || 'original';
  const avgPhoto = st.photos ? st.size / st.photos : 0;

  view.innerHTML = `
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h3>⚙️ Общие</h3></div>
        ${field('currency', 'Валюта по умолчанию', { options: CURRENCIES, value: S.state.settings.currency })}
        <div style="margin-top:12px">
          ${field('photoQuality', 'Качество хранения фото', { options: QUALITY, value: quality,
            hint: 'Влияет только на новые загрузки. Оригинал — как просили, без потери качества; 2560 px экономит место в разы при том же виде на экране.' })}
        </div>
        <div style="margin-top:12px"><button class="btn btn-primary btn-sm" id="save-set">Сохранить</button></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>💾 Хранилище</h3>${isCloud ? '<div class="spacer"></div><span class="cloud-badge">☁️ общая база</span>' : ''}</div>
        ${isCloud ? `<div class="hint" style="margin-bottom:12px">Файлы лежат в хранилище Supabase: ${bytes(est.usage)}. На бесплатном тарифе доступен 1 ГБ, на Pro — 100 ГБ.</div>`
        : `<div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${pct > 85 ? 'var(--danger)' : pct > 60 ? 'var(--warn)' : 'var(--acc)'}"></div></div>
        <div class="hint" style="margin:6px 0 12px">Занято ${bytes(est.usage)} из ~${bytes(est.quota)}${free ? ` · свободно ${bytes(free)}` : ''}</div>`}
        <dl class="kv">
          <dt>Виллы / брони / клиенты</dt><dd>${S.state.villas.length} / ${S.state.bookings.length} / ${S.state.clients.length}</dd>
          <dt>Фотографии</dt><dd>${st.photos}${st.photos ? ` · в среднем ${bytes(avgPhoto)}` : ''}</dd>
          <dt>Документы</dt><dd>${st.docs}</dd>
          <dt>Объём файлов</dt><dd>${bytes(st.size)}</dd>
          ${st.thumbSize ? `<dt>Превью (для скорости)</dt><dd>${bytes(st.thumbSize)}</dd>` : ''}
        </dl>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>👥 Общая база и доступ сотрудников</h3>
        <div class="spacer"></div>
        <span class="badge ${isCloud ? 'b-occupied' : 'b-off'}">${isCloud ? 'подключена' : 'выключена'}</span>
      </div>
      ${isCloud ? `
        <dl class="kv">
          <dt>Проект Supabase</dt><dd class="mono">${esc(cfg.url)}</dd>
          <dt>Вы вошли как</dt><dd>${esc(user ? user.email : '—')}</dd>
        </dl>
        <div class="row" style="margin-top:12px">
          <button class="btn" id="migrate">⬆︎ Перенести локальную базу в общую</button>
          <button class="btn" id="cloud-check">Проверить связь</button>
          <button class="btn btn-danger" id="cloud-off">Отключить общую базу</button>
        </div>
        <div class="hint" style="margin-top:12px">
          Сотрудников добавляйте в панели Supabase: <b>Authentication → Users → Add user</b> — задайте почту и пароль, и человек сможет войти.
          Там же доступ отзывается. Изменения у всех появляются сразу, без обновления страницы.
        </div>`
      : `
        <div class="hint" style="margin-bottom:12px">
          Сейчас база живёт только в этом браузере, поэтому доступ сотруднику выдать нельзя.
          Подключите проект Supabase — данные, фото и документы переедут в общее хранилище, а вход будет по почте и паролю.
          Пошаговая инструкция — в файле <code>SETUP-SUPABASE.md</code> в репозитории.
        </div>
        ${field('supabaseUrl', 'Project URL', { value: cfg.url, placeholder: 'https://xxxxxxxx.supabase.co' })}
        <div style="margin-top:10px">${field('supabaseKey', 'Anon public key', { value: cfg.key, placeholder: 'eyJhbGciOi…' })}</div>
        <div class="row" style="margin-top:12px">
          <button class="btn btn-primary" id="cloud-on">Подключить общую базу</button>
        </div>`}
    </div>

    <div class="panel">
      <div class="panel-head"><h3>📦 Бэкап и перенос</h3></div>
      <div class="row">
        ${B.canUseDirectory()
          ? '<button class="btn btn-primary" id="exp-dir">📁 Бэкап в папку на диске (рекомендуется)</button>'
          : '<span class="hint">Бэкап в папку доступен в Chrome / Edge — в этом браузере используйте ZIP.</span>'}
        <button class="btn" id="exp-zip">🗜️ Бэкап в ZIP</button>
        <button class="btn" id="exp-json">📄 Только данные (JSON)</button>
      </div>
      <div class="row" style="margin-top:10px">
        ${B.canUseDirectory() ? '<button class="btn" id="imp-dir">⬆︎ Восстановить из папки</button>' : ''}
        <button class="btn" id="imp-zip">⬆︎ Восстановить из ZIP</button>
        <button class="btn" id="imp-json">⬆︎ Загрузить JSON</button>
        <input type="file" accept=".zip,application/zip" multiple hidden id="imp-zip-input">
        <input type="file" accept="application/json" hidden id="imp-json-input">
      </div>
      <div class="hint" style="margin-top:12px">
        <b>Папка</b> — самый надёжный вариант при больших архивах: пишет <code>data.json</code> и файлы прямо на диск или во внешний накопитель, размер не ограничен, повторный бэкап копирует только новое.<br>
        <b>ZIP</b> — работает в любом браузере, автоматически делится на части по 1,2 ГБ (для восстановления выберите сразу все части).<br>
        <b>JSON</b> — только виллы, брони и клиенты, без фото: маленький файл на каждый день.
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>🧪 Демо и очистка</h3></div>
      <div class="row">
        <button class="btn" id="seed">Загрузить демо-данные</button>
        <button class="btn btn-danger" id="wipe">Удалить всё</button>
      </div>
      <div class="hint" style="margin-top:10px">Демо добавит 2 виллы, 2 клиента и несколько броней, чтобы посмотреть работу календаря.</div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>ℹ️ Как это работает</h3></div>
      <ul class="dim" style="margin:0;padding-left:20px;line-height:1.8">
        <li><b>Виллы</b> — название, контакты собственника и менеджера, условия аренды, цена собственника и наша цена, маржа считается автоматически.</li>
        <li><b>Карточка виллы</b> — вкладки «Фото» (загрузка в исходном качестве), «Локация» (Google-точка с картой), «Календарь», «Брони», «Документы».</li>
        <li><b>Календарь</b> — таймлайн «виллы × дни» с зумом День / Неделя / Месяц / Год. Протяните мышью по строке, чтобы создать бронь.</li>
        <li><b>Клиенты</b> — контакты, история проживаний и файлы (договор, паспорт, виза).</li>
        <li>Данные хранятся локально в этом браузере и никуда не отправляются. Бэкап — единственная защита от потери: делайте его регулярно.</li>
      </ul>
    </div>`;

  const refresh = () => renderSettings(view, actions);

  view.querySelector('#save-set').onclick = async () => {
    const d = formData(view);
    await S.setSetting('currency', d.currency);
    localStorage.setItem('photoQuality', d.photoQuality);
    toast('Сохранено');
  };

  // --- прогресс-окно ---
  function progressModal(title) {
    let el;
    modal({
      title, size: 'narrow',
      body: '<div id="pg-text">Готовим…</div><div class="bar-track" style="margin-top:12px"><div class="bar-fill" id="pg-bar" style="width:0%"></div></div>',
      onMount: (e) => { el = e; },
    });
    return {
      set(text, done, total) {
        if (!el) return;
        el.querySelector('#pg-text').textContent = text;
        el.querySelector('#pg-bar').style.width = total ? `${Math.min(100, (done / total) * 100).toFixed(1)}%` : '0%';
      },
      done: () => closeModal(),
    };
  }

  const dirBtn = view.querySelector('#exp-dir');
  if (dirBtn) dirBtn.onclick = async () => {
    let pg;
    try {
      pg = progressModal('Бэкап в папку');
      const r = await B.exportToDirectory(({ doneBytes, totalBytes, done, total }) =>
        pg.set(`Файл ${done} из ${total} · ${bytes(doneBytes)} из ${bytes(totalBytes)}`, doneBytes, totalBytes));
      pg.done();
      toast(`Готово: записано ${r.written}, без изменений ${r.skipped} (всего ${r.total} файлов)`);
    } catch (e) {
      if (pg) pg.done();
      if (e.name !== 'AbortError') toast('Бэкап не выполнен: ' + e.message, true);
    }
  };

  view.querySelector('#exp-zip').onclick = async () => {
    let pg;
    try {
      pg = progressModal('Бэкап в ZIP');
      const r = await B.exportToZips(({ part, parts, doneBytes, totalBytes }) =>
        pg.set(`Часть ${part} из ${parts} · ${bytes(doneBytes)} из ${bytes(totalBytes)}`, doneBytes, totalBytes));
      pg.done();
      toast(`Готово: ${r.parts} ${r.parts === 1 ? 'архив' : 'архива(ов)'}, ${r.label}`);
    } catch (e) {
      if (pg) pg.done();
      toast('Бэкап не выполнен: ' + e.message, true);
    }
  };

  view.querySelector('#exp-json').onclick = () => B.exportDataOnly();

  async function restore(source) {
    const replace = await confirmDialog(
      'Заменить текущие данные данными из бэкапа? «Отмена» — данные из бэкапа добавятся к существующим.',
      { title: 'Восстановление', okText: 'Заменить', danger: true });
    const pg = progressModal('Восстановление');
    try {
      const r = await B.applyBackup(source, {
        replace,
        onProgress: ({ done, total }) => pg.set(`Файл ${done} из ${total}`, done, total),
      });
      pg.done();
      toast(`Восстановлено: вилл ${r.villas}, файлов ${r.files}`);
      refresh();
    } catch (e) {
      pg.done();
      toast('Ошибка восстановления: ' + e.message, true);
    }
  }

  const impDir = view.querySelector('#imp-dir');
  if (impDir) impDir.onclick = async () => {
    try { await restore(await B.importFromDirectory()); }
    catch (e) { if (e.name !== 'AbortError') toast('Не удалось открыть папку бэкапа: ' + e.message, true); }
  };

  const zipInput = view.querySelector('#imp-zip-input');
  view.querySelector('#imp-zip').onclick = () => zipInput.click();
  zipInput.onchange = async () => {
    if (!zipInput.files.length) return;
    try { await restore(await B.importFromZips(zipInput.files)); }
    catch (e) { toast('Ошибка чтения архива: ' + e.message, true); }
    zipInput.value = '';
  };

  const jsonInput = view.querySelector('#imp-json-input');
  view.querySelector('#imp-json').onclick = () => jsonInput.click();
  jsonInput.onchange = async () => {
    if (!jsonInput.files.length) return;
    try { await restore(await B.importFromJson(jsonInput.files[0])); }
    catch (e) { toast('Ошибка чтения файла: ' + e.message, true); }
    jsonInput.value = '';
  };

  // --- общая база ---
  const onBtn = view.querySelector('#cloud-on');
  if (onBtn) onBtn.onclick = async () => {
    const d = formData(view);
    if (!d.supabaseUrl || !d.supabaseKey) return toast('Заполните Project URL и Anon key', true);
    setCloudConfig(d.supabaseUrl, d.supabaseKey);
    cloud.resetClient();
    try {
      await cloud.getClient();
      toast('Подключено. Сейчас откроется вход в систему');
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      clearCloudConfig();
      toast('Не удалось подключиться: ' + e.message, true);
    }
  };
  const offBtn = view.querySelector('#cloud-off');
  if (offBtn) offBtn.onclick = async () => {
    if (!await confirmDialog('Отключить общую базу? Данные в облаке останутся, но это устройство вернётся к локальной базе.',
      { title: 'Отключение', okText: 'Отключить' })) return;
    try { await cloud.signOut(); } catch (e) { void e; }
    clearCloudConfig();
    location.reload();
  };
  const checkBtn = view.querySelector('#cloud-check');
  if (checkBtn) checkBtn.onclick = async () => {
    try {
      const t = Date.now();
      const res = await cloud.loadAll();
      toast(`Связь есть: вилл ${res.villas.length}, броней ${res.bookings.length} (${Date.now() - t} мс)`);
    } catch (e) { toast('Нет связи: ' + e.message, true); }
  };
  const migBtn = view.querySelector('#migrate');
  if (migBtn) migBtn.onclick = async () => {
    const c = await migrate.localCounts();
    if (!c.villas && !c.clients && !c.files) return toast('В локальной базе этого браузера ничего нет', true);
    const ok = await confirmDialog(
      `Перенести в общую базу: вилл ${c.villas}, клиентов ${c.clients}, броней ${c.bookings}, файлов ${c.files} (${bytes(c.bytes)})? Записи с теми же номерами будут перезаписаны.`,
      { title: 'Перенос в общую базу', okText: 'Перенести', danger: false });
    if (!ok) return;
    const pg = progressModal('Перенос в общую базу');
    try {
      const r = await migrate.localToCloud(({ step, totalSteps, label }) => pg.set(`${step} из ${totalSteps} · ${label}`, step, totalSteps));
      pg.done();
      toast(`Перенесено: вилл ${r.villas}, клиентов ${r.clients}, файлов ${r.uploaded}${r.failed ? `, не удалось ${r.failed}` : ''}`);
      await S.load();
      refresh();
    } catch (e) {
      pg.done();
      toast('Перенос прерван: ' + e.message, true);
    }
  };

  view.querySelector('#seed').onclick = async () => {
    if (await confirmDialog('Добавить демо-данные?', { title: 'Демо', okText: 'Добавить', danger: false })) {
      await S.seedDemo(); toast('Демо-данные добавлены'); refresh();
    }
  };
  view.querySelector('#wipe').onclick = async () => {
    if (await confirmDialog('Удалить ВСЕ виллы, брони, клиентов и файлы? Отменить нельзя.', { okText: 'Удалить всё' })) {
      await S.wipeAll(); toast('Всё удалено'); refresh();
    }
  };
  void esc;
}
