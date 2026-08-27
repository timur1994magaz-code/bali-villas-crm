// ===== Загрузка/показ файлов: фотогалерея и документы =====
import * as db from './db.js';
import { esc, bytes, download, fmtDateShort } from './util.js';
import { toast, confirmDialog, openLightbox } from './ui.js';

const objectUrls = new Set();
function url(blob) { const u = URL.createObjectURL(blob); objectUrls.add(u); return u; }
export function revokeAll() { objectUrls.forEach((u) => URL.revokeObjectURL(u)); objectUrls.clear(); }

function fileIcon(mime, name) {
  const n = (name || '').toLowerCase();
  if ((mime || '').startsWith('image/')) return '🖼️';
  if ((mime || '').includes('pdf') || n.endsWith('.pdf')) return '📕';
  if (n.match(/\.(doc|docx|rtf)$/)) return '📄';
  if (n.match(/\.(xls|xlsx|csv)$/)) return '📊';
  if (n.match(/\.(zip|rar|7z)$/)) return '🗜️';
  if ((mime || '').startsWith('video/')) return '🎬';
  return '📎';
}

/**
 * Фотогалерея с загрузкой (drag&drop + выбор файлов).
 * mount(container, ownerType, ownerId, onChange)
 */
export async function renderPhotos(box, ownerType, ownerId, opts = {}) {
  const files = await db.filesOf(ownerType, ownerId, 'photo');
  box.innerHTML = `
    <div class="panel-head">
      <h3>📸 Фотографии${files.length ? ` <span class="mute">(${files.length})</span>` : ''}</h3>
      <div class="spacer"></div>
      ${files.length ? '<button class="btn btn-sm" data-dl-all>⬇︎ Скачать все</button>' : ''}
      <button class="btn btn-sm btn-primary" data-add>+ Загрузить фото</button>
    </div>
    <div class="dropzone" data-dz>Перетащите фото сюда или нажмите — загружаются в исходном качестве, без сжатия</div>
    <input type="file" accept="image/*" multiple hidden data-input>
    <div class="photo-grid" data-grid style="margin-top:14px"></div>`;

  const grid = box.querySelector('[data-grid]');
  if (!files.length) {
    grid.innerHTML = '<div class="mute" style="grid-column:1/-1;padding:10px">Фото пока нет.</div>';
  } else {
    grid.innerHTML = files.map((f, i) => `
      <div class="photo-item" data-i="${i}" title="${esc(f.name)}">
        <img src="${url(f.blob)}" alt="${esc(f.caption || f.name)}" loading="lazy">
        <div class="photo-tools">
          <button data-act="dl" data-id="${f.id}" title="Скачать оригинал">⬇︎</button>
          <button data-act="cap" data-id="${f.id}" title="Подпись">✎</button>
          <button data-act="del" data-id="${f.id}" title="Удалить">✕</button>
        </div>
        ${f.caption ? `<div class="photo-cap">${esc(f.caption)}</div>` : ''}
      </div>`).join('');
  }

  const input = box.querySelector('[data-input]');
  const dz = box.querySelector('[data-dz]');
  const reload = () => renderPhotos(box, ownerType, ownerId, opts).then(() => opts.onChange && opts.onChange());

  const upload = async (fileList) => {
    const arr = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!arr.length) return toast('Выберите изображения', true);
    for (const f of arr) await db.saveFile(ownerType, ownerId, f, 'photo');
    toast(`Загружено фото: ${arr.length}`);
    reload();
  };
  box.querySelector('[data-add]').onclick = () => input.click();
  dz.onclick = () => input.click();
  input.onchange = () => { if (input.files.length) upload(input.files); input.value = ''; };
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); upload(e.dataTransfer.files); };

  const dlAll = box.querySelector('[data-dl-all]');
  if (dlAll) dlAll.onclick = () => files.forEach((f, i) => setTimeout(() => download(f.blob, f.name), i * 250));

  grid.onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (btn) {
      e.stopPropagation();
      const f = files.find((x) => x.id === btn.dataset.id);
      if (btn.dataset.act === 'dl') return download(f.blob, f.name);
      if (btn.dataset.act === 'del') {
        if (await confirmDialog(`Удалить фото «${f.name}»?`)) { await db.del('files', f.id); reload(); }
        return;
      }
      if (btn.dataset.act === 'cap') {
        const cap = prompt('Подпись к фото:', f.caption || '');
        if (cap !== null) { f.caption = cap; await db.put('files', f); reload(); }
        return;
      }
    }
    const item = e.target.closest('.photo-item');
    if (item) openLightbox(files, Number(item.dataset.i));
  };
}

/**
 * Документы (договор, паспорт, чеки…)
 */
export async function renderDocs(box, ownerType, ownerId, opts = {}) {
  const title = opts.title || '📁 Документы';
  const files = await db.filesOf(ownerType, ownerId, 'doc');
  box.innerHTML = `
    <div class="panel-head">
      <h3>${title}${files.length ? ` <span class="mute">(${files.length})</span>` : ''}</h3>
      <div class="spacer"></div>
      <button class="btn btn-sm btn-primary" data-add>+ Загрузить файл</button>
    </div>
    <input type="file" multiple hidden data-input>
    <div class="dropzone" data-dz style="margin-bottom:12px">Перетащите сюда договор, паспорт, чек, скан — любой файл</div>
    <div class="file-list" data-list></div>`;

  const list = box.querySelector('[data-list]');
  list.innerHTML = files.length ? files.map((f) => `
    <div class="file-row">
      <span class="file-ico">${fileIcon(f.mime, f.name)}</span>
      <div>
        <div class="file-name">${esc(f.name)}</div>
        <div class="file-sub">${bytes(f.size)} · ${fmtDateShort(f.createdAt)}${f.caption ? ' · ' + esc(f.caption) : ''}</div>
      </div>
      <div class="spacer"></div>
      <button class="btn btn-sm" data-act="open" data-id="${f.id}">Открыть</button>
      <button class="btn btn-sm" data-act="dl" data-id="${f.id}">⬇︎</button>
      <button class="btn btn-sm btn-danger" data-act="del" data-id="${f.id}">✕</button>
    </div>`).join('') : '<div class="mute">Файлов пока нет.</div>';

  const input = box.querySelector('[data-input]');
  const dz = box.querySelector('[data-dz]');
  const reload = () => renderDocs(box, ownerType, ownerId, opts).then(() => opts.onChange && opts.onChange());
  const upload = async (fl) => {
    for (const f of [...fl]) await db.saveFile(ownerType, ownerId, f, 'doc');
    toast(`Загружено файлов: ${fl.length}`);
    reload();
  };
  box.querySelector('[data-add]').onclick = () => input.click();
  dz.onclick = () => input.click();
  input.onchange = () => { if (input.files.length) upload(input.files); input.value = ''; };
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); upload(e.dataTransfer.files); };

  list.onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const f = files.find((x) => x.id === btn.dataset.id);
    if (btn.dataset.act === 'dl') return download(f.blob, f.name);
    if (btn.dataset.act === 'open') return window.open(url(f.blob), '_blank');
    if (btn.dataset.act === 'del' && await confirmDialog(`Удалить файл «${f.name}»?`)) {
      await db.del('files', f.id); reload();
    }
  };
}

export async function coverPhoto(ownerType, ownerId) {
  const files = await db.filesOf(ownerType, ownerId, 'photo');
  return files.length ? { blob: files[0].blob, count: files.length } : null;
}
export function blobUrl(blob) { return url(blob); }
