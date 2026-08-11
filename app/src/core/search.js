import { isValidId, normalizeId } from '../../../shared/ids.js';

/**
 * Substring search across name/tags/notes, plus the filters.
 * Typing a 4-character ID resolves to that thing directly — hand-typing a
 * scuffed label must land in the same place as scanning it.
 *
 * @param {object[]} things
 * @param {{q?: string, unpacked?: boolean, unnamed?: boolean,
 *          containerKind?: string|null, room?: string|null,
 *          status?: string|null, containersOnly?: boolean}} [query]
 */
export function searchThings(things, query = {}) {
  const { q = '', unpacked, unnamed, containerKind, room, status, containersOnly } = query;
  const needle = q.trim().toLowerCase();
  const asId = isValidId(normalizeId(q)) ? normalizeId(q) : null;

  return things
    .filter((t) => {
      if (unpacked && t.status !== 'unpacked') return false;
      if (unnamed && t.name) return false;
      if (containersOnly && !t.is_container) return false;
      if (containerKind && t.container_kind !== containerKind) return false;
      if (room && t.room !== room) return false;
      if (status && t.status !== status) return false;
      return !needle || score(t, needle, asId) > 0;
    })
    .map((t) => ({ thing: t, score: needle ? score(t, needle, asId) : 1 }))
    .sort((a, b) => b.score - a.score || (b.thing.updated_at ?? 0) - (a.thing.updated_at ?? 0))
    .map((r) => r.thing);
}

function score(thing, needle, asId) {
  if (asId && thing.id === asId) return 1000;
  if (thing.id.toLowerCase().startsWith(needle)) return 900;

  const name = thing.name_lc ?? thing.name?.toLowerCase() ?? '';
  if (name === needle) return 800;
  if (name.startsWith(needle)) return 700;
  if (name.includes(needle)) return 600;

  if (thing.tags?.some((tag) => tag.toLowerCase() === needle)) return 500;
  if (thing.tags?.some((tag) => tag.toLowerCase().includes(needle))) return 400;
  if (thing.notes?.toLowerCase().includes(needle)) return 200;
  return 0;
}
