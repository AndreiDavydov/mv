import { BACKUP_NAG_DAYS, BACKUP_NAG_EVENTS } from '../../../config.js';
import { normalize } from './repo.js';

export const BACKUP_FORMAT = 'moving-catalog/1';

/**
 * Browser storage is not a place to keep the only copy of anything. The bundle
 * is deliberately boring: JSON you can read, CSV you can open in a spreadsheet,
 * and photos as `<ID>.jpg` so they are usable even if this app disappears.
 */

/** @param {{things: object[], events: object[], exportedAt: number}} data */
export function toJSON({ things, events, exportedAt }) {
  return {
    format: BACKUP_FORMAT,
    exported_at: exportedAt,
    counts: { things: things.length, events: events.length },
    things: things.map(stripBlobs),
    events,
  };
}

const CSV_COLUMNS = [
  'id',
  'name',
  'is_container',
  'container_kind',
  'parent_id',
  'parent_name',
  'room',
  'status',
  'tags',
  'notes',
  'has_photo',
  'created_at',
  'updated_at',
];

export function toCSV(things) {
  const byId = new Map(things.map((t) => [t.id, t]));
  const rows = things.map((t) => [
    t.id,
    t.name ?? '',
    t.is_container ? 'yes' : 'no',
    t.container_kind ?? '',
    t.parent_id ?? '',
    (t.parent_id && byId.get(t.parent_id)?.name) || '',
    t.room ?? '',
    t.status,
    (t.tags ?? []).join(' '),
    t.notes ?? '',
    t.photo ? 'yes' : 'no',
    isoOrEmpty(t.created_at),
    isoOrEmpty(t.updated_at),
  ]);
  return [CSV_COLUMNS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/**
 * Validate and normalize an imported bundle. Throws with a readable message
 * rather than half-importing — a partial restore is worse than none.
 */
export function fromJSON(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || typeof data !== 'object') throw new Error('backup is not an object');
  if (data.format !== BACKUP_FORMAT) {
    throw new Error(`unknown backup format ${JSON.stringify(data.format)}`);
  }
  if (!Array.isArray(data.things) || !Array.isArray(data.events)) {
    throw new Error('backup is missing things/events');
  }
  const things = data.things.map((t) => normalize(t));
  const ids = new Set(things.map((t) => t.id));
  for (const thing of things) {
    if (thing.parent_id && !ids.has(thing.parent_id)) {
      throw new Error(`${thing.id} points at missing container ${thing.parent_id}`);
    }
  }
  return { things, events: data.events, exportedAt: data.exported_at ?? null };
}

/**
 * Should the backup banner be showing? Nagging is the only thing standing
 * between a browser-storage wipe and losing the catalog.
 *
 * @returns {{due: boolean, reason: 'never'|'stale'|'events'|null, days: number, events: number}}
 */
export function backupStatus({ lastExportTs, lastExportEventCount, eventCount, now }) {
  const events = eventCount - (lastExportEventCount ?? 0);
  // Nothing recorded yet, nothing to lose. Nagging an empty catalog just trains
  // the reader to ignore the banner that will matter later.
  if (!eventCount) return { due: false, reason: null, days: 0, events: 0 };
  if (!lastExportTs) return { due: true, reason: 'never', days: Infinity, events };
  const days = (now - lastExportTs) / 86_400_000;
  if (days >= BACKUP_NAG_DAYS) return { due: true, reason: 'stale', days, events };
  if (events >= BACKUP_NAG_EVENTS) return { due: true, reason: 'events', days, events };
  return { due: false, reason: null, days, events };
}

function stripBlobs(thing) {
  const { photo, thumb, ...rest } = thing;
  return { ...rest, photo_file: photo ? `photos/${thing.id}.jpg` : null };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isoOrEmpty(ts) {
  return ts ? new Date(ts).toISOString() : '';
}
