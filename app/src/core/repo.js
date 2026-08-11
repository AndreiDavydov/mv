import { STORE, SESSION_KEY, containerFlag, openCatalog } from './db.js';
import { isValidId, normalizeId } from '../../../shared/ids.js';

/**
 * The catalog. Everything that changes a `thing` goes through here, and every
 * change appends an event describing how to undo it.
 *
 * Events are grouped: one user action (a scan that moves an item out of Box A
 * and into Box B) writes an `unpacked` and a `packed` event sharing a `group`,
 * so the audit trail stays honest while undo still reverses one *action*.
 */
export class Catalog {
  #db;
  #now;
  #seq = 0;

  constructor(db, { now = () => Date.now() } = {}) {
    this.#db = db;
    this.#now = now;
  }

  static async open({ name, now } = {}) {
    return new Catalog(await openCatalog({ name }), { now });
  }

  close() {
    this.#db.close();
  }

  get raw() {
    return this.#db;
  }

  #group(ts) {
    return `g${ts}-${this.#seq++}`;
  }

  // ── reads ────────────────────────────────────────────────────────────────

  get(id) {
    return this.#db.get(STORE.things, normalizeId(id));
  }

  all() {
    return this.#db.getAll(STORE.things);
  }

  count() {
    return this.#db.count(STORE.things);
  }

  childrenOf(id) {
    return this.#db.getAllFromIndex(STORE.things, 'by_parent', normalizeId(id));
  }

  containers() {
    return this.#db.getAllFromIndex(STORE.things, 'by_container', 1);
  }

  byStatus(status) {
    return this.#db.getAllFromIndex(STORE.things, 'by_status', status);
  }

  events({ thingId } = {}) {
    return thingId
      ? this.#db.getAllFromIndex(STORE.events, 'by_thing', normalizeId(thingId))
      : this.#db.getAll(STORE.events);
  }

  eventCount() {
    return this.#db.count(STORE.events);
  }

  /** Container → ... → root, nearest first. Cycle-safe. */
  async breadcrumb(id) {
    const trail = [];
    const seen = new Set();
    let cursor = await this.get(id);
    while (cursor?.parent_id && !seen.has(cursor.parent_id)) {
      seen.add(cursor.parent_id);
      const parent = await this.get(cursor.parent_id);
      if (!parent) break;
      trail.push(parent);
      cursor = parent;
    }
    return trail;
  }

  // ── writes ───────────────────────────────────────────────────────────────

  /**
   * Create a thing. `id` must be free — enrolling over an existing thing is a
   * bug (a duplicate printed label), not something to paper over.
   */
  async enroll(input) {
    const id = normalizeId(input.id);
    if (!isValidId(id)) throw new TypeError(`not an id: ${JSON.stringify(input.id)}`);

    const ts = this.#now();
    const thing = normalize({
      ...input,
      id,
      created_at: ts,
      updated_at: ts,
    });

    const tx = this.#db.transaction([STORE.things, STORE.events], 'readwrite');
    const existing = await tx.objectStore(STORE.things).get(id);
    if (existing) {
      await tx.done;
      throw new Error(`${id} is already enrolled`);
    }
    await tx.objectStore(STORE.things).add(thing);
    await tx.objectStore(STORE.events).add({
      thing_id: id,
      type: 'enrolled',
      parent_id: thing.parent_id,
      payload: { group: this.#group(ts), before: null, after: summary(thing) },
      ts,
    });
    await tx.done;
    return thing;
  }

  /** Apply a partial update, recording `before`/`after` so it can be undone. */
  async update(id, patch, { type = 'moved' } = {}) {
    const [result] = await this.#applyGroup(this.#now(), [{ id, patch, type }]);
    return result;
  }

  rename(id, name) {
    return this.update(id, { name }, { type: 'renamed' });
  }

  /**
   * Put a thing inside a container. If it was somewhere else, the move is
   * recorded as an `unpacked` + `packed` pair in one undoable group — no
   * dialog, no confirmation; that is the whole point of PACKING mode.
   */
  async packInto(id, parentId) {
    const thingId = normalizeId(id);
    const target = normalizeId(parentId);
    if (thingId === target) throw new Error('a container cannot contain itself');

    const thing = await this.get(thingId);
    if (!thing) throw new Error(`${thingId} is not enrolled`);
    if (await this.#wouldCycle(thingId, target)) {
      throw new Error(`${target} is already inside ${thingId}`);
    }
    if (thing.parent_id === target && thing.status === 'packed') return thing;

    const ts = this.#now();
    const steps = [];
    if (thing.parent_id && thing.parent_id !== target) {
      steps.push({ id: thingId, patch: { parent_id: null, status: 'unpacked' }, type: 'unpacked' });
    }
    steps.push({ id: thingId, patch: { parent_id: target, status: 'packed' }, type: 'packed' });
    const results = await this.#applyGroup(ts, steps);
    return results.at(-1);
  }

  unpack(id) {
    return this.update(id, { parent_id: null, status: 'unpacked' }, { type: 'unpacked' });
  }

  markGone(id) {
    return this.update(id, { status: 'gone', parent_id: null }, { type: 'deleted' });
  }

  /**
   * Reverse the newest action that has not already been reversed. Nothing is
   * deleted from the log: the reversal is appended, tagged with `undo_of`.
   *
   * @returns {Promise<{group: string, events: object[]}|null>}
   */
  async undoLast() {
    const log = await this.#db.getAll(STORE.events);
    const undoneGroups = new Set(
      log.map((e) => e.payload?.undo_of_group).filter(Boolean),
    );

    let target = null;
    for (let i = log.length - 1; i >= 0; i--) {
      const group = log[i].payload?.group;
      if (!group || log[i].payload?.undo_of_group) continue;
      if (undoneGroups.has(group)) continue;
      target = group;
      break;
    }
    if (!target) return null;

    const members = log.filter((e) => e.payload?.group === target);
    const ts = this.#now();
    const group = this.#group(ts);
    const written = [];

    const tx = this.#db.transaction([STORE.things, STORE.events], 'readwrite');
    const things = tx.objectStore(STORE.things);
    const events = tx.objectStore(STORE.events);

    for (const event of [...members].reverse()) {
      if (event.type === 'enrolled') {
        await things.delete(event.thing_id);
        written.push({
          thing_id: event.thing_id,
          type: 'deleted',
          parent_id: null,
          payload: { group, undo_of_group: target, undo_of: event.id, before: event.payload.after, after: null },
          ts,
        });
        continue;
      }
      const current = await things.get(event.thing_id);
      if (!current) continue;
      const patch = event.payload?.before ?? {};
      const restored = normalize({ ...current, ...patch, updated_at: ts });
      await things.put(restored);
      written.push({
        thing_id: event.thing_id,
        type: eventTypeFor(patch),
        parent_id: restored.parent_id,
        payload: {
          group,
          undo_of_group: target,
          undo_of: event.id,
          before: pick(current, Object.keys(patch)),
          after: patch,
        },
        ts,
      });
    }
    for (const e of written) await events.add(e);
    await tx.done;
    return { group: target, events: written };
  }

  // ── session ──────────────────────────────────────────────────────────────

  async session() {
    const stored = await this.#db.get(STORE.session, SESSION_KEY);
    return { ...DEFAULT_SESSION, ...stored, key: SESSION_KEY };
  }

  async setSession(patch) {
    const next = { ...(await this.session()), ...patch, key: SESSION_KEY };
    await this.#db.put(STORE.session, next);
    return next;
  }

  // ── meta (backup bookkeeping) ────────────────────────────────────────────

  async meta(key, fallback = null) {
    const row = await this.#db.get(STORE.meta, key);
    return row ? row.value : fallback;
  }

  setMeta(key, value) {
    return this.#db.put(STORE.meta, { key, value });
  }

  // ── internals ────────────────────────────────────────────────────────────

  async #applyGroup(ts, steps) {
    const group = this.#group(ts);
    const out = [];
    const tx = this.#db.transaction([STORE.things, STORE.events], 'readwrite');
    const things = tx.objectStore(STORE.things);
    const events = tx.objectStore(STORE.events);

    for (const { id, patch, type } of steps) {
      const thingId = normalizeId(id);
      const current = await things.get(thingId);
      if (!current) {
        await tx.done;
        throw new Error(`${thingId} is not enrolled`);
      }
      const next = normalize({ ...current, ...patch, updated_at: ts });
      const before = pick(current, Object.keys(patch));
      await things.put(next);
      await events.add({
        thing_id: thingId,
        type,
        parent_id: next.parent_id,
        payload: { group, before, after: pick(next, Object.keys(patch)) },
        ts,
      });
      out.push(next);
    }
    await tx.done;
    return out;
  }

  /** True if `candidateParent` is `id` or already nested inside it. */
  async #wouldCycle(id, candidateParent) {
    let cursor = candidateParent;
    const seen = new Set();
    while (cursor) {
      if (cursor === id) return true;
      if (seen.has(cursor)) return false;
      seen.add(cursor);
      cursor = (await this.get(cursor))?.parent_id ?? null;
    }
    return false;
  }
}

export const DEFAULT_SESSION = {
  mode: 'LOOKUP',
  target_id: null,
  last_scan_id: null,
  last_scan_ts: 0,
};

/** Fill in defaults and keep derived fields (`name_lc`, `container_flag`) true. */
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
    container_flag: containerFlag(is_container),
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

/** What an event records about a thing — never the photo blobs. */
function summary(thing) {
  const { photo, thumb, name_lc, container_flag, ...rest } = thing;
  return rest;
}

function pick(source, keys) {
  return Object.fromEntries(keys.map((k) => [k, source?.[k] ?? null]));
}

function eventTypeFor(patch) {
  if ('status' in patch && patch.status === 'gone') return 'deleted';
  if ('parent_id' in patch) return patch.parent_id ? 'packed' : 'unpacked';
  if ('name' in patch) return 'renamed';
  return 'moved';
}
