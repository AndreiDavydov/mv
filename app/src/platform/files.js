import { strFromU8, strToU8, unzipSync, zipSync } from '../../../vendor/fflate.js';
import { BACKUP_FORMAT, fromJSON, toCSV, toJSON } from '../core/backup.js';

/**
 * Export and import. One tap produces a single ZIP holding `catalog.json`,
 * `catalog.csv` and `photos/<ID>.jpg` — they are only useful together, and a
 * bundle that has to be reassembled by hand is a bundle that gets lost.
 * A bare `catalog.json` also imports, for the case where photos are gone.
 */

export async function buildBundle(catalog, { now = Date.now() } = {}) {
  const [things, events] = await Promise.all([catalog.all(), catalog.events()]);
  const json = toJSON({ things, events, exportedAt: now });

  const files = {
    'catalog.json': strToU8(JSON.stringify(json, null, 2)),
    'catalog.csv': strToU8(toCSV(things)),
  };
  for (const thing of things) {
    if (thing.photo) {
      files[`photos/${thing.id}.jpg`] = new Uint8Array(await thing.photo.arrayBuffer());
    }
  }

  return {
    blob: new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' }),
    filename: `catalog-${stamp(now)}.zip`,
    counts: { things: things.length, events: events.length, photos: countPhotos(things) },
  };
}

/** File System Access API where available, plain download everywhere else. */
export async function save(blob, filename) {
  if (globalThis.showSaveFilePicker) {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Catalog backup', accept: { 'application/zip': ['.zip'] } }],
      });
      const stream = await handle.createWritable();
      await stream.write(blob);
      await stream.close();
      return { saved: true, method: 'file-system-access' };
    } catch (error) {
      if (error.name === 'AbortError') return { saved: false, method: 'cancelled' };
      // Fall through: some browsers expose the picker but refuse in this context.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { saved: true, method: 'download' };
}

/**
 * Read a bundle back. Returns the parsed rows without touching the database —
 * the caller decides whether to merge or replace.
 *
 * @returns {Promise<{things: object[], events: object[], photos: Map<string, Blob>}>}
 */
export async function readBundle(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const photos = new Map();

  if (looksLikeZip(bytes)) {
    const entries = unzipSync(bytes);
    const manifest = entries['catalog.json'];
    if (!manifest) throw new Error('the ZIP has no catalog.json');
    const parsed = fromJSON(strFromU8(manifest));
    for (const [path, data] of Object.entries(entries)) {
      const match = /^photos\/([^/]+)\.jpg$/.exec(path);
      if (match) photos.set(match[1], new Blob([data], { type: 'image/jpeg' }));
    }
    return { ...parsed, photos };
  }

  return { ...fromJSON(strFromU8(bytes)), photos };
}

/**
 * Replace the catalog with an imported bundle. Photos are re-attached by ID and
 * thumbnails regenerated, so a bundle whose thumbnails were stripped still
 * restores a usable grid view.
 */
export async function restore(catalog, bundle, { derivePhotos }) {
  const db = catalog.raw;
  const tx = db.transaction(['things', 'events'], 'readwrite');
  await Promise.all([tx.objectStore('things').clear(), tx.objectStore('events').clear()]);
  await tx.done;

  for (const thing of bundle.things) {
    const photo = bundle.photos.get(thing.id) ?? null;
    let thumb = null;
    if (photo) ({ thumb } = await derivePhotos(photo));
    await db.put('things', { ...thing, photo, thumb });
  }
  for (const event of bundle.events) {
    await db.put('events', event);
  }
  return { things: bundle.things.length, events: bundle.events.length, photos: bundle.photos.size };
}

export { BACKUP_FORMAT };

const looksLikeZip = (bytes) => bytes[0] === 0x50 && bytes[1] === 0x4b;
const countPhotos = (things) => things.filter((t) => t.photo).length;

function stamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
