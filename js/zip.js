// ===== Минимальный ZIP: сборка (метод «store») и чтение (store + deflate) =====
// Без зависимостей. Данные не грузятся в память: Blob-части остаются ссылками на файлы.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export async function crc32(blob, onChunk) {
  let crc = 0xFFFFFFFF;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) crc = CRC_TABLE[(crc ^ value[i]) & 0xFF] ^ (crc >>> 8);
    if (onChunk) onChunk(value.length);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const te = new TextEncoder();
function dosTime(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/**
 * Собирает ZIP без сжатия. entries: [{name, blob}] либо [{name, size, getBlob}]
 * Возвращает Blob — части остаются ссылками, поэтому размер не ограничен памятью.
 * Ограничение формата ZIP32: до 4 ГБ на архив (выше — разбивайте на части).
 */
export async function createZip(entries, onProgress) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosTime();
  let doneBytes = 0;
  const totalBytes = entries.reduce((s, e) => s + (e.size !== undefined ? e.size : (e.blob ? e.blob.size : 0)), 0);

  for (const e of entries) {
    const nameBytes = te.encode(e.name);
    const blob = e.blob || await e.getBlob();
    const crc = await crc32(blob, (n) => {
      doneBytes += n;
      if (onProgress) onProgress(doneBytes, totalBytes);
    });
    const size = blob.size;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);   // UTF-8 имена
    lh.setUint16(8, 0, true);        // метод store
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    parts.push(lh.buffer, nameBytes, blob);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, nameBytes);
    offset += 30 + nameBytes.length + size;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const p of central) cdSize += p.byteLength !== undefined ? p.byteLength : p.length;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);

  return new Blob([...parts, ...central, eocd.buffer], { type: 'application/zip' });
}

/** Читает ZIP (store и deflate) → Map<name, Blob> */
export async function readZip(file) {
  const size = file.size;
  const tailLen = Math.min(size, 66000);
  const tail = new DataView(await file.slice(size - tailLen, size).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Это не ZIP-архив (не найден конец каталога)');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdStart = tail.getUint32(eocd + 16, true);

  const cd = new DataView(await file.slice(cdStart, cdStart + cdSize).arrayBuffer());
  const td = new TextDecoder();
  const out = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    const compSize = cd.getUint32(p + 20, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOff = cd.getUint32(p + 42, true);
    const name = td.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;

    const lh = new DataView(await file.slice(localOff, localOff + 30).arrayBuffer());
    const lNameLen = lh.getUint16(26, true);
    const lExtraLen = lh.getUint16(28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    let blob = file.slice(dataStart, dataStart + compSize);
    if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Браузер не умеет распаковывать deflate — используйте бэкап из этого приложения');
      blob = await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    } else if (method !== 0) {
      throw new Error('Неподдерживаемый метод сжатия в архиве: ' + method);
    }
    out.set(name, blob);
  }
  return out;
}
