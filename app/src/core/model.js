/**
 * The catalog's rules, with no storage attached.
 *
 * The database moved to Postgres, but the semantics that are easy to get wrong
 * — what an event records, which action undo should reverse, what a partial
 * update means — are plain data transformations. They live here so they can be
 * tested in milliseconds without a network.
 */

export const DEFAULT_SESSION = {
  mode: 'LOOKUP',
  target_id: null,
  last_scan_id: null,
  last_scan_ts: 0,
};

/** Fill in defaults and derived fields. Used on the way in and on import. */
export function normalize(input) {
  const is_container = Boolean(input.is_container);
  const name = input.name?.trim() ? input.name.trim() : null;
  return {
    id: input.id,
    name,
    name_lc: (name ?? '').toLowerCase(),
    photo: input.photo ?? null,
    thumb: input.thumb ?? null,
    is_container,
    container_kind: is_container ? (input.container_kind ?? 'box') : null,
    parent_id: input.parent_id ?? null,
    tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : [],
    room: input.room ?? null,
    notes: input.notes ?? null,
    status: input.status ?? 'unpacked',
    created_at: input.created_at ?? input.updated_at ?? 0,
    updated_at: input.updated_at ?? 0,
  };
}

/** What an event records about a thing — never the photo itself. */
export function summary(thing) {
  const { photo, thumb, name_lc, ...rest } = thing;
  return rest;
}

export function pick(source, keys) {
  return Object.fromEntries(keys.map((k) => [k, source?.[k] ?? null]));
}

/** Name an event after the change it describes, from the patch alone. */
export function eventTypeFor(patch) {
  if ('status' in patch && patch.status === 'gone') return 'deleted';
  if ('parent_id' in patch) return patch.parent_id ? 'packed' : 'unpacked';
  if ('name' in patch) return 'renamed';
  return 'moved';
}

/**
 * Which action should undo reverse?
 *
 * Events are grouped: moving an item between boxes writes `unpacked` and
 * `packed` under one group, so the log stays honest while undo still reverses
 * one *action*. A reversal is appended rather than deleting anything, tagged
 * with `undo_of_group`, so undo walks backwards through history without ever
 * losing it — and cannot undo its own undo.
 *
 * With several people scanning at once the log is shared, so "the last action"
 * genuinely means the last one anybody took.
 *
 * @param {object[]} log events, any order
 * @returns {{group: string, members: object[]}|null} members newest first
 */
export function pickUndoGroup(log) {
  const ordered = [...log].sort((a, b) => a.id - b.id);
  const undone = new Set(ordered.map((e) => e.payload?.undo_of_group).filter(Boolean));

  for (let i = ordered.length - 1; i >= 0; i--) {
    const group = ordered[i].payload?.group;
    if (!group || ordered[i].payload?.undo_of_group) continue;
    if (undone.has(group)) continue;
    return {
      group,
      members: ordered.filter((e) => e.payload?.group === group).reverse(),
    };
  }
  return null;
}
