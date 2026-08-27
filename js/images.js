// ===== Работа с изображениями: превью и (по желанию) оптимизация оригинала =====

const THUMB_MAX = 560;      // сторона превью для сеток и обложек
const THUMB_QUALITY = 0.82;

async function draw(file, max, quality, mime = 'image/jpeg') {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch (e) {
    void e;
    return null; // формат, который браузер не декодирует (например HEIC в Chrome)
  }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const dims = { w: bmp.width, h: bmp.height };
  let blob = null;
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    blob = await c.convertToBlob({ type: mime, quality });
  } else {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    blob = await new Promise((res) => c.toBlob(res, mime, quality));
  }
  bmp.close && bmp.close();
  return blob ? { blob, w, h, srcW: dims.w, srcH: dims.h } : null;
}

/** Маленькое превью (~30–80 КБ) — им рисуются сетки, обложки и карточки. */
export async function makeThumb(file) {
  const r = await draw(file, THUMB_MAX, THUMB_QUALITY);
  return r ? { thumb: r.blob, w: r.srcW, h: r.srcH } : { thumb: null, w: null, h: null };
}

/**
 * Оптимизация оригинала под выбранный режим хранения.
 * 'original' — файл сохраняется как есть, без изменений.
 * число (2560 / 1920) — длинная сторона ограничивается, JPEG q=0.88.
 */
export async function prepareOriginal(file, mode) {
  if (mode === 'original' || !String(file.type).startsWith('image/')) {
    return { file, optimized: false };
  }
  const max = Number(mode) || 2560;
  const r = await draw(file, max, 0.88);
  if (!r || r.blob.size >= file.size) return { file, optimized: false };
  const name = file.name.replace(/\.(heic|heif|png|webp|tiff?|bmp|jpe?g)$/i, '') + '.jpg';
  const out = new File([r.blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
  return { file: out, optimized: true, srcSize: file.size };
}

export function supportsHeic() {
  // Safari декодирует HEIC, Chrome/Firefox — нет
  return /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
}
export function isHeic(file) {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
}
