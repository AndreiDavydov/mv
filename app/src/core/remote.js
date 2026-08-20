import { createClient } from '../../../vendor/supabase.js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../../config.js';
import { isValidId, normalizeId } from '../../../shared/ids.js';
import { DEFAULT_SESSION, eventTypeFor, pick, pickUndoGroup, summary } from './model.js';
import { assertCan, isValidThingId, normalizeThingId, retiredCode } from './capabilities.js';

/**
 * The shared catalog, backed by Postgres.
 *
 * Deliberately the same method surface as the local `Catalog` it replaces, so
 * the views and the state machine did not have to change: `get`, `all`,
 * `childrenOf`, `enroll`, `packInto`, `undoLast` and friends behave the same,
 * they just resolve over the network.
 *
 * Two things genuinely differ, and both are visible in the UI rather than
 * papered over:
 *   - There is no offline mode. A scan with no signal fails loudly instead of
 *     queueing, because a queued pack that silently lands ten minutes later is
 *     worse than being told to move two metres.
 *   - Rows can change underneath you. `onChange` fires on every remote write,
 *     which is what makes a phone scan appear on the laptop screen.
 */
export class RemoteCatalog {
  #db;
  #channel = null;
  #listeners = new Set();
  #now;
  #seq = 0;
  #lastGroup = null;
  #actor = null;

  constructor(client, { now = () => Date.now() } = {}) {
    this.#db = client;
    this.#now = now;
  }

  static open({ url = SUPABASE_URL, key = SUPABASE_ANON_KEY, now } = {}) {
    if (!url || !key) throw new Error('Supabase is not configured — see config.js');
    const client = createClient(url, key, {
      auth: {
        // The session is what gets you past the gate, so it has to survive a
        // locked phone and a closed tab: sign in once per device, not once per
        // box. supabase-js refreshes it in the background.
        persistSession: true,
        autoRefreshToken: true,
        // Our fragment carries a label ID (`#K7M3`), never an auth token — and
        // a library that rewrites location.hash on boot would eat the scan that
        // brought the browser here.
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    return new RemoteCatalog(client, { now });
  }

  get raw() {
    return this.#db;
  }

  /**
   * The name stamped on every event this device writes.
   *
   * Everyone shares one password, so the database cannot tell helpers apart —
   * this is the only thing that can. It is set once at sign-in and is not a
   * credential: it buys no access, it just makes the log readable. Since the
   * log is append-only in Postgres, a name that lands in it stays there.
   */
  set actor(name) {
    this.#actor = name || null;
  }

  get actor() {
    return this.#actor;
  }

  // ── liveness ─────────────────────────────────────────────────────────────

  /**
   * Fire `listener` whenever anything in the catalog changes anywhere.
   * @returns {() => void} unsubscribe
   */
  onChange(listener) {
    this.#listeners.add(listener);
    this.#ensureChannel();
    return () => this.#listeners.delete(listener);
  }

  #ensureChannel() {
    if (this.#channel) return;
    this.#channel = this.#db
      .channel('catalog')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'things' }, (payload) =>
        this.#emit({ table: 'things', ...payload }),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, (payload) =>
        this.#emit({ table: 'events', ...payload }),
      )
      .subscribe();
  }

  #emit(change) {
    for (const listener of this.#listeners) {
      try {
        listener(change);
      } catch {
        // A broken listener must not stop the others from updating.
      }
    }
  }

  close() {
    this.#channel?.unsubscribe();
    this.#channel = null;
    this.#listeners.clear();
  }

  /** Cheap round trip, so "is the database reachable" is answerable. */
  async ping() {
    const { error } = await this.#db.from('things').select('id', { head: true, count: 'exact' });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  // ── reads ────────────────────────────────────────────────────────────────

  async get(id) {
    const key = normalizeThingId(id);
    if (!isValidThingId(key)) return undefined;
    const { data, error } = await this.#db.from('things').select('*').eq('id', key).maybeSingle();
    if (error) throw wrap(error, `could not read ${key}`);
    return data ? fromRow(data) : undefined;
  }

  async all() {
    const { data, error } = await this.#db.from('things').select('*').order('updated_at', { ascending: false });
    if (error) throw wrap(error, 'could not load the catalog');
    return data.map(fromRow);
  }

  async count() {
    const { count, error } = await this.#db.from('things').select('id', { head: true, count: 'exact' });
    if (error) throw wrap(error, 'could not count the catalog');
    return count ?? 0;
  }

  async childrenOf(id) {
    const { data, error } = await this.#db
      .from('things')
      .select('*')
      .eq('parent_id', normalizeThingId(id))
      .order('updated_at', { ascending: false });
    if (error) throw wrap(error, 'could not read the contents');
    return data.map(fromRow);
  }

  async containers() {
    const { data, error } = await this.#db.from('things').select('*').eq('is_container', true);
    if (error) throw wrap(error, 'could not load containers');
    return data.map(fromRow);
  }

  async byStatus(status) {
    const { data, error } = await this.#db.from('things').select('*').eq('status', status);
    if (error) throw wrap(error, 'could not load by status');
    return data.map(fromRow);
  }

  async events({ thingId } = {}) {
    let query = this.#db.from('events').select('*').order('id', { ascending: true });
    if (thingId) query = query.eq('thing_id', normalizeThingId(thingId));
    const { data, error } = await query;
    if (error) throw wrap(error, 'could not load the history');
    return data.map(fromEventRow);
  }

  async eventCount() {
    const { count, error } = await this.#db.from('events').select('id', { head: true, count: 'exact' });
    if (error) throw wrap(error, 'could not count events');
    return count ?? 0;
  }

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

  async enroll(input) {
    const id = normalizeId(input.id);
    if (!isValidId(id)) throw new TypeError(`not an id: ${JSON.stringify(input.id)}`);

    const row = toRow({ ...input, id });
    const { data, error } = await this.#db.from('things').insert(row).select().single();
    if (error) {
      // 23505 is a unique violation: two people scanned the same fresh label.
      throw error.code === '23505' ? new Error(`${id} is already enrolled`) : wrap(error, 'could not enrol');
    }

    const thing = fromRow(data);
    await this.#log([
      { thing_id: id, type: 'enrolled', parent_id: thing.parent_id, payload: { group: this.#group(), before: null, after: summary(thing) } },
    ]);
    return thing;
  }

  async update(id, patch, { type = 'moved' } = {}) {
    const [result] = await this.#applyGroup([{ id, patch, type }]);
    return result;
  }

  rename(id, name) {
    return this.update(id, { name }, { type: 'renamed' });
  }

  async packInto(id, parentId) {
    const thingId = normalizeThingId(id);
    const target = normalizeThingId(parentId);
    if (thingId === target) throw new Error('a container cannot contain itself');

    const thing = await this.get(thingId);
    if (!thing) throw new Error(`${thingId} is not enrolled`);
    if (thing.parent_id === target && thing.status === 'packed') return thing;

    // Packing used to write `packed` straight over `gone`, so the only way back
    // from gone was an accident. One rule, asked here and by the buttons.
    assertCan('pack', thing, { packingTarget: target });

    const steps = [];
    if (thing.parent_id && thing.parent_id !== target) {
      steps.push({ id: thingId, patch: { parent_id: null, status: 'unpacked' }, type: 'unpacked' });
    }
    steps.push({ id: thingId, patch: { parent_id: target, status: 'packed' }, type: 'packed' });
    const results = await this.#applyGroup(steps);
    return results.at(-1);
  }

  unpack(id) {
    return this.update(id, { parent_id: null, status: 'unpacked' }, { type: 'unpacked' });
  }

  /**
   * Mark a thing gone — sold, donated, binned.
   *
   * A container comes with its contents: everything inside is taken out first
   * and stays in the catalog, loose. Leaving them pointing at a box the catalog
   * says no longer exists is the one state this model must never produce. It is
   * all one group, so a single undo puts the box back and everything into it.
   */
  async markGone(id) {
    const thingId = normalizeThingId(id);
    const thing = await this.get(thingId);
    if (!thing) throw new Error(`${thingId} is not enrolled`);

    const children = thing.is_container ? await this.childrenOf(thingId) : [];
    assertCan('markGone', thing, { childCount: children.length });

    const steps = children.map((child) => ({
      id: child.id,
      patch: { parent_id: null, status: 'unpacked' },
      type: 'unpacked',
    }));
    steps.push({ id: thingId, patch: { status: 'gone', parent_id: null }, type: 'deleted' });

    const results = await this.#applyGroup(steps);
    return results.at(-1);
  }

  /** Bring a gone thing back. It returns loose, never to wherever it used to be. */
  async restore(id) {
    const thing = await this.get(id);
    if (!thing) throw new Error(`${normalizeThingId(id)} is not enrolled`);
    assertCan('restore', thing);
    return this.update(id, { status: 'unpacked', parent_id: null }, { type: 'restored' });
  }

  /**
   * Take everything out of a container in one action — the other half of the
   * move, when a box is opened at the far end and emptied.
   */
  async emptyContainer(id) {
    const thingId = normalizeThingId(id);
    const thing = await this.get(thingId);
    if (!thing) throw new Error(`${thingId} is not enrolled`);

    const children = await this.childrenOf(thingId);
    assertCan('empty', thing, { childCount: children.length });

    return this.#applyGroup(children.map((child) => ({
      id: child.id,
      patch: { parent_id: null, status: 'unpacked' },
      type: 'unpacked',
    })));
  }

  /**
   * Move a label onto something else.
   *
   * The old record is retired rather than overwritten: its id becomes `K7M3-1`,
   * carrying its history, photos and contents with it, and the code `K7M3` is
   * freed for a fresh enrolment. That is what lets the same sticker be reused
   * twice without the log describing two different objects under one id.
   *
   * @returns {Promise<{freed: string, retired: string}>}
   */
  async recode(id) {
    const code = normalizeThingId(id);
    const thing = await this.get(code);
    if (!thing) throw new Error(`${code} is not enrolled`);
    assertCan('recode', thing);

    // One transaction in the database. Doing it from here would need two
    // writes, and the second — carrying the events across — is not something a
    // client is allowed to do, because the log is append-only by policy.
    const { data, error } = await this.#db.rpc('retire_code', { code });
    if (error) {
      throw /function .* does not exist/i.test(error.message)
        ? new Error('needs supabase/migration-003-rules.sql')
        : wrap(error, 'could not free the label');
    }

    return { freed: code, retired: data };
  }

  /**
   * Reverse the newest action nobody has reversed yet. Reads the tail of the
   * log rather than the whole thing — with several people scanning at once
   * this runs often, and the log only grows.
   */
  /** Reverse the newest action anybody took. Used by tests and the history view. */
  async undoLast() {
    const log = await this.#tail();
    const chosen = pickUndoGroup(log);
    return chosen ? this.#reverse(chosen.group, chosen.members) : null;
  }

  /**
   * Reverse one specific action. This is what the UI offers, because the
   * catalog is shared: undo must mean "the thing I just did", never "whatever
   * happened most recently anywhere".
   */
  async undoGroup(group) {
    if (!group) return null;
    const log = await this.#tail();
    if (log.some((e) => e.payload?.undo_of_group === group)) return null; // already reversed
    const members = log.filter((e) => e.payload?.group === group).sort((a, b) => b.id - a.id);
    return members.length ? this.#reverse(group, members) : null;
  }

  async #tail() {
    const { data, error } = await this.#db
      .from('events')
      .select('*')
      .order('id', { ascending: false })
      .limit(200);
    if (error) throw wrap(error, 'could not read the history');
    return data.map(fromEventRow);
  }

  async #reverse(group, members) {
    const newGroup = this.#group();
    const written = [];

    for (const event of members) {
      if (event.type === 'enrolled') {
        // Undoing an enrolment removes the row. Anything inside it has to be
        // let go first, or the delete is refused — rightly, because the
        // database will not orphan things to make a delete convenient.
        const children = await this.childrenOf(event.thing_id);
        for (const child of children) {
          await this.#db.from('things')
            .update({ parent_id: null, status: 'unpacked' })
            .eq('id', child.id);
        }

        const { error: deleteError } = await this.#db.from('things').delete().eq('id', event.thing_id);
        if (deleteError) throw wrap(deleteError, 'could not undo the enrolment');
        written.push({
          thing_id: event.thing_id,
          type: 'deleted',
          parent_id: null,
          payload: { group: newGroup, undo_of_group: group, undo_of: event.id, before: event.payload.after, after: null },
        });
        continue;
      }

      const current = await this.get(event.thing_id);
      if (!current) continue;
      const patch = event.payload?.before ?? {};
      const { error: updateError } = await this.#db
        .from('things')
        .update(toRow({ ...current, ...patch }, { partial: Object.keys(patch) }))
        .eq('id', event.thing_id);
      if (updateError) throw wrap(updateError, 'could not undo');

      written.push({
        thing_id: event.thing_id,
        type: eventTypeFor(patch),
        parent_id: patch.parent_id ?? current.parent_id ?? null,
        payload: { group: newGroup, undo_of_group: group, undo_of: event.id, before: pick(current, Object.keys(patch)), after: patch },
      });
    }

    await this.#log(written);
    return { group, events: written };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * The id of the last action *this client* wrote.
   *
   * On a shared catalog "undo the last thing" is the wrong offer — the last
   * thing may be someone else's scan from two seconds ago. Undo is offered
   * against a specific group instead, and this is how the UI knows which.
   */
  get lastGroup() {
    return this.#lastGroup;
  }

  #group() {
    this.#lastGroup = `g${this.#now()}-${this.#seq++}`;
    return this.#lastGroup;
  }

  async #applyGroup(steps) {
    const group = this.#group();
    const out = [];
    const log = [];

    for (const { id, patch, type } of steps) {
      const thingId = normalizeThingId(id);
      const current = await this.get(thingId);
      if (!current) throw new Error(`${thingId} is not enrolled`);

      const { data, error } = await this.#db
        .from('things')
        .update(toRow({ ...current, ...patch }, { partial: Object.keys(patch) }))
        .eq('id', thingId)
        .select()
        .single();
      if (error) throw wrap(error, 'could not save');

      const next = fromRow(data);
      out.push(next);
      log.push({
        thing_id: thingId,
        type,
        parent_id: next.parent_id,
        payload: { group, before: pick(current, Object.keys(patch)), after: pick(next, Object.keys(patch)) },
      });
    }

    await this.#log(log);
    return out;
  }

  async #log(rows) {
    if (!rows.length) return;
    const stamped = rows.map((row) => ({ actor: this.#actor, ...row }));
    const { error } = await this.#db.from('events').insert(stamped);
    // The write already happened; a lost log line must not present as a failed
    // action. It is worth knowing about, so it is not swallowed silently.
    if (error) console.error('event log write failed', error);
  }

  // ── photos ───────────────────────────────────────────────────────────────

  /**
   * Upload a photo and its thumbnail, returning the URLs to store on the row.
   *
   * The path used to be `<ID>.jpg`, which had two problems. The ID is printed
   * on the outside of the box, so the URL of any photo was derivable by anyone
   * who had seen a label — a hole the login could not close, because the
   * storage bucket answers without one. And uploading over it replaced the
   * previous image, the one way something in this catalog could actually be
   * destroyed rather than merely superseded.
   *
   * A random half fixes both. The path is unguessable, and the only copy of it
   * lives in the `things` row, which now requires a session to read; and every
   * photograph writes a new file, so the earlier one is still there.
   */
  async uploadPhoto(id, { photo, thumb }) {
    const key = normalizeId(id);
    const stamp = token();
    const urls = {};
    for (const [field, blob, path] of [
      ['photo_url', photo, `${key}-${stamp}.jpg`],
      ['thumb_url', thumb, `${key}-${stamp}-thumb.jpg`],
    ]) {
      if (!blob) continue;
      const { error } = await this.#db.storage
        .from('photos')
        .upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw wrap(error, 'could not upload the photo');
      urls[field] = this.#db.storage.from('photos').getPublicUrl(path).data.publicUrl;
    }
    return urls;
  }

  // ── session: deliberately NOT shared ─────────────────────────────────────

  /**
   * Which box you are packing into is per-person, not per-catalog: two helpers
   * fill two boxes at once. It stays on the device, in localStorage, and is the
   * only thing a scanning device remembers.
   */
  async session() {
    try {
      return { ...DEFAULT_SESSION, ...JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}') };
    } catch {
      return { ...DEFAULT_SESSION };
    }
  }

  async setSession(patch) {
    const next = { ...(await this.session()), ...patch };
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    return next;
  }
}

const SESSION_KEY = 'catalog.session';
export { DEFAULT_SESSION };

// ── row mapping ─────────────────────────────────────────────────────────────

/** Postgres row → the shape the views already expect. */
function fromRow(row) {
  return {
    id: row.id,
    name: row.name ?? null,
    name_lc: (row.name ?? '').toLowerCase(),
    photo: row.photo_url ?? null,
    thumb: row.thumb_url ?? row.photo_url ?? null,
    is_container: Boolean(row.is_container),
    container_kind: row.container_kind ?? null,
    parent_id: row.parent_id ?? null,
    tags: row.tags ?? [],
    room: row.room ?? null,
    notes: row.notes ?? null,
    status: row.status ?? 'unpacked',
    created_at: Date.parse(row.created_at ?? 0) || 0,
    updated_at: Date.parse(row.updated_at ?? 0) || 0,
  };
}

function fromEventRow(row) {
  return { ...row, ts: Date.parse(row.ts ?? 0) || 0 };
}

/**
 * @param {object} input
 * @param {{partial?: string[]}} [options] restrict the update to these fields,
 *   so two people editing different fields of one thing do not clobber each
 *   other's work.
 */
function toRow(input, { partial } = {}) {
  const is_container = Boolean(input.is_container);
  const name = input.name?.trim() ? input.name.trim() : null;
  const full = {
    id: input.id,
    name,
    photo_url: input.photo_url ?? (typeof input.photo === 'string' ? input.photo : null),
    thumb_url: input.thumb_url ?? (typeof input.thumb === 'string' ? input.thumb : null),
    is_container,
    container_kind: is_container ? (input.container_kind ?? 'box') : null,
    parent_id: input.parent_id ?? null,
    tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : [],
    room: input.room ?? null,
    notes: input.notes ?? null,
    status: input.status ?? 'unpacked',
  };
  if (!partial) return full;

  const columns = { photo: 'photo_url', thumb: 'thumb_url' };
  return Object.fromEntries(
    partial.map((field) => {
      const column = columns[field] ?? field;
      return [column, full[column]];
    }),
  );
}

/** Postgres errors are terse; the trigger messages are the useful part. */
function wrap(error, context) {
  const detail = error.message ?? String(error);
  if (/already inside|cannot contain itself/.test(detail)) return new Error(detail);
  return new Error(`${context}: ${detail}`);
}

/**
 * Eight hex characters of randomness for a storage path — 32 bits, which is
 * plenty for a house's worth of photos and short enough to stay readable in a
 * URL. It is not a secret in the cryptographic sense; it only has to be
 * something you cannot derive from the code printed on the box.
 */
function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
