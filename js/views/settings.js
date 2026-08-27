// ===== Настройки: валюта, бэкап, демо-данные, хранилище =====
import * as S from '../store.js';
import * as db from '../db.js';
import { toast, confirmDialog, field, formData } from '../ui.js';
import { CURRENCIES, bytes, download, esc } from '../util.js';

export async function renderSettings(view, actions) {
  actions.innerHTML = '';
  const est = await db.storageEstimate();
  const files = await db.all('files');
  const photos = files.filter((f) => f.kind === 'photo');
  const docs = files.filter((f) => f.kind === 'doc');
  const filesSize = files.reduce((s, f) => s + (f.size || 0), 0);

  view.innerHTML = `
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h3>⚙️ Общие</h3></div>
        ${field('currency', 'Валюта по умолчанию', { options: CURRENCIES, value: S.state.settings.currency })}
        <div style="margin-top:12px"><button class="btn btn-primary btn-sm" id="save-set">Сохранить</button></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>💾 Хранилище</h3></div>
        <dl class="kv">
          <dt>Виллы</dt><dd>${S.state.villas.length}</dd>
          <dt>Брони</dt><dd>${S.state.bookings.length}</dd>
          <dt>Клиенты</dt><dd>${S.state.clients.length}</dd>
          <dt>Фотографии</dt><dd>${photos.length}</dd>
          <dt>Документы</dt><dd>${docs.length}</dd>
          <dt>Объём файлов</dt><dd>${bytes(filesSize)}</dd>
          <dt>Занято браузером</dt><dd>${bytes(est.usage)}${est.quota ? ' из ~' + bytes(est.quota) : ''}</dd>
        </dl>
        <div class="hint" style="margin-top:10px">Данные и файлы хранятся локально в этом браузере (IndexedDB) — ничего не уходит в интернет. Делайте бэкап регулярно.</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>📦 Бэкап и перенос</h3></div>
      <div class="row">
        <button class="btn btn-primary" id="exp-full">⬇︎ Скачать полный бэкап (с фото)</button>
        <button class="btn" id="exp-light">⬇︎ Только данные (без файлов)</button>
        <button class="btn" id="imp">⬆︎ Загрузить бэкап</button>
        <input type="file" accept="application/json" hidden id="imp-input">
      </div>
      <div class="hint" style="margin-top:10px">Полный бэкап — один JSON-файл со всеми фото и документами: можно перенести на другой компьютер или в другой браузер. Файл с фотографиями бывает большим (десятки–сотни МБ).</div>
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
        <li>Клик по цветной полосе в календаре открывает бронь с контактами клиента и его документами.</li>
      </ul>
    </div>`;

  view.querySelector('#save-set').onclick = async () => {
    const d = formData(view);
    await S.setSetting('currency', d.currency);
    toast('Сохранено');
  };
  view.querySelector('#exp-full').onclick = async () => {
    toast('Готовим бэкап…');
    const data = await S.exportAll(true);
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }),
      `bali-villas-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };
  view.querySelector('#exp-light').onclick = async () => {
    const data = await S.exportAll(false);
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      `bali-villas-data-${new Date().toISOString().slice(0, 10)}.json`);
  };
  const impInput = view.querySelector('#imp-input');
  view.querySelector('#imp').onclick = () => impInput.click();
  impInput.onchange = async () => {
    const f = impInput.files[0]; if (!f) return;
    const replace = await confirmDialog('Заменить текущие данные данными из бэкапа? «Отмена» — данные будут добавлены к существующим.',
      { title: 'Импорт', okText: 'Заменить', danger: true });
    try {
      const data = JSON.parse(await f.text());
      await S.importAll(data, { replace });
      toast('Бэкап загружен');
      renderSettings(view, actions);
    } catch (e) {
      toast('Ошибка импорта: ' + e.message, true);
    }
    impInput.value = '';
  };
  view.querySelector('#seed').onclick = async () => {
    if (await confirmDialog('Добавить демо-данные?', { title: 'Демо', okText: 'Добавить', danger: false })) {
      await S.seedDemo(); toast('Демо-данные добавлены'); renderSettings(view, actions);
    }
  };
  view.querySelector('#wipe').onclick = async () => {
    if (await confirmDialog('Удалить ВСЕ виллы, брони, клиентов и файлы? Отменить нельзя.', { okText: 'Удалить всё' })) {
      await S.wipeAll(); toast('Всё удалено'); renderSettings(view, actions);
    }
  };
  void esc;
}
