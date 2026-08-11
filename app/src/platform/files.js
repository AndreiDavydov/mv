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

  // Photos live in shared storage now, so they are fetched rather than read
  // from the row. One that has gone missing must not take the export with it.
  for (const thing of things) {
    if (!thing.photo) continue;
    try {
      const response = await fetch(thing.photo);
      if (!response.ok) continue;
      files[`photos/${thing.id}.jpg`] = new Uint8Array(await response.arrayBuffer());
    } catch {
      /* skip this photo, keep the bundle */
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
 * Replace the shared catalog with an imported bundle.
 *
 * This affects everybody, not just this browser — the caller is responsible for
 * making that clear before calling. Parents are cleared on the first pass and
 * restored on the second, so the rows can go in without tripping the foreign
 * key on a container that has not been inserted yet.
 */
export async function restore(catalog, bundle) {
  const db = catalog.raw;

  await db.from('events').delete().neq('id', -1);
  await db.from('things').update({ parent_id: null }).neq('id', '');
  await db.from('things').delete().neq('id', '');

  const rows = bundle.things.map((thing) => ({
    id: thing.id,
    name: thing.name,
    photo_url: thing.photo_file ? bundle.photoUrls?.get(thing.id) ?? null : null,
    is_container: thing.is_container,
    container_kind: thing.is_container ? (thing.container_kind ?? 'box') : null,
    tags: thing.tags ?? [],
    room: thing.room,
    notes: thing.notes,
    status: thing.status,
  }));

  const { error: insertError } = await db.from('things').insert(rows);
  if (insertError) throw new Error(`could not restore the catalog: ${insertError.message}`);

  // Second pass: now that every row exists, put the containment back.
  for (const thing of bundle.things.filter((t) => t.parent_id)) {
    await db.from('things').update({ parent_id: thing.parent_id }).eq('id', thing.id);
  }

  if (bundle.events.length) {
    const events = bundle.events.map(({ id, ...rest }) => rest);
    const { error } = await db.from('events').insert(events);
    if (error) throw new Error(`catalog restored, but the history did not: ${error.message}`);
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
