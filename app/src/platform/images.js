/**
 * Photo downscaling. Full-resolution phone photos blow past the storage quota
 * somewhere around a few hundred items, so nothing full-size ever reaches
 * IndexedDB — the record keeps an ~800px view and a ~200px thumbnail.
 */

export const PHOTO_EDGE = 800;
export const PHOTO_QUALITY = 0.8;
export const THUMB_EDGE = 200;
export const THUMB_QUALITY = 0.7;

/**
 * @param {Blob|ImageBitmap|HTMLVideoElement|HTMLCanvasElement} source
 * @returns {Promise<{photo: Blob, thumb: Blob, width: number, height: number}>}
 */
export async function derivePhotos(source) {
  const bitmap = await toBitmap(source);
  try {
    const [photo, thumb] = await Promise.all([
      encode(bitmap, PHOTO_EDGE, PHOTO_QUALITY),
      encode(bitmap, THUMB_EDGE, THUMB_QUALITY),
    ]);
    return { photo, thumb, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close?.();
  }
}

async function toBitmap(source) {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) return source;
  if (globalThis.createImageBitmap) return createImageBitmap(source);

  // Safari fallback: decode through an <img>.
  const url = URL.createObjectURL(source);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function encode(bitmap, longestEdge, quality) {
  const scale = Math.min(1, longestEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvasToBlob(canvas, quality);
}

function makeCanvas(width, height) {
  if (globalThis.OffscreenCanvas) return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('could not encode the photo'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Object URLs for blobs, revoked as a set. A grid view that leaks these will
 * crash the tab, so every view that creates them owns a pool and empties it
 * when it is torn down.
 */
export function urlPool() {
  const urls = new Set();
  return {
    for(blob) {
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urls.add(url);
      return url;
    },
    release() {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    },
    get size() {
      return urls.size;
    },
  };
}
