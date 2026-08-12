import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteCatalog } from '../../app/src/core/remote.js';
import { SUPABASE_URL } from '../../config.js';

/**
 * Integration tests against the real Supabase project.
 *
 * These hit the network and write to the shared catalog, so they use a
 * reserved block of IDs at the very end of the space (`ZZ**`) and clean up
 * after themselves. Run with `npm run test:live`.
 *
 * The rules they cover — cycles, append-only history, undo across a shared log
 * — are enforced by Postgres, so they cannot be proved anywhere else.
 */

let catalog;
/**
 * The history is append-only — that is the point of it, and the access rules
 * enforce it — so it cannot be wiped between tests. Each test instead records
 * where the log had reached and only asserts on what came after.
 */
let watermark = 0;

before(() => {
  catalog = RemoteCatalog.open();
});

after(async () => {
  await wipeReserved();
  catalog.close();
});

beforeEach(async () => {
  await wipeReserved();
  const { data } = await catalog.raw
    .from('events').select('id').order('id', { ascending: false }).limit(1);
  watermark = data?.[0]?.id ?? 0;
});

/** Events this test wrote, ignoring everything that was already there. */
async function recent(thingId) {
  const events = await catalog.events({ thingId });
  return events.filter((e) => e.id > watermark);
}

/** Each live file owns a block of reserved ids, so two files cannot collide. */
async function wipeReserved() {
  const db = catalog.raw;
  // Detach first: a container cannot be deleted while something points at it.
  await db.from('things').update({ parent_id: null, status: 'unpacked' }).like('id', 'ZZ2%');
  await db.from('things').delete().like('id', 'ZZ2%');
}

const ids = (rows) => rows.map((r) => r.id).sort();
const types = (events) => events.map((e) => e.type);

test('the project is reachable and the schema is in place', async () => {
  const { ok, error } = await catalog.ping();
  assert.ok(ok, `${SUPABASE_URL} unreachable: ${error}`);
});

test('enrolling writes the row and its event', async () => {
  const thing = await catalog.enroll({ id: 'ZZ22', name: '  Cast iron pan ' });

  assert.equal(thing.id, 'ZZ22');
  assert.equal(thing.name, 'Cast iron pan', 'trimmed on the way in');
  assert.equal(thing.status, 'unpacked');
  assert.equal(thing.parent_id, null);

  assert.deepEqual(types(await recent('ZZ22')), ['enrolled']);
});

test('two people scanning the same fresh label — the second is refused', async () => {
  await catalog.enroll({ id: 'ZZ22', name: 'Pan' });
  await assert.rejects(() => catalog.enroll({ id: 'ZZ22', name: 'Other' }), /already enrolled/);
  assert.equal((await catalog.get('ZZ22')).name, 'Pan', 'the first writer keeps the row');
});

test('packing sets the parent and writes one event', async () => {
  await catalog.enroll({ id: 'ZZ2A', name: 'Box A', is_container: true });
  await catalog.enroll({ id: 'ZZ22', name: 'Pan' });

  const packed = await catalog.packInto('ZZ22', 'ZZ2A');
  assert.equal(packed.parent_id, 'ZZ2A');
  assert.equal(packed.status, 'packed');

  assert.deepEqual(ids(await catalog.childrenOf('ZZ2A')), ['ZZ22']);
  assert.deepEqual(types(await recent('ZZ22')), ['enrolled', 'packed']);
});

test('moving between boxes logs unpacked + packed', async () => {
  await catalog.enroll({ id: 'ZZ2A', is_container: true });
  await catalog.enroll({ id: 'ZZ2B', is_container: true });
  await catalog.enroll({ id: 'ZZ22' });

  await catalog.packInto('ZZ22', 'ZZ2A');
  await catalog.packInto('ZZ22', 'ZZ2B');

  assert.deepEqual(types(await recent('ZZ22')), [
    'enrolled', 'packed', 'unpacked', 'packed',
  ]);
  assert.deepEqual(await catalog.childrenOf('ZZ2A'), []);
  assert.deepEqual(ids(await catalog.childrenOf('ZZ2B')), ['ZZ22']);
});

test('the database refuses a container inside itself', async () => {
  await catalog.enroll({ id: 'ZZ2A', is_container: true });
  await catalog.enroll({ id: 'ZZ2B', is_container: true });
  await catalog.packInto('ZZ2B', 'ZZ2A');

  await assert.rejects(() => catalog.packInto('ZZ2A', 'ZZ2A'), /cannot contain itself/);
  await assert.rejects(() => catalog.packInto('ZZ2A', 'ZZ2B'), /already inside/);
});

test('nesting works and the breadcrumb walks outward', async () => {
  await catalog.enroll({ id: 'ZZ2C', name: 'Crate', is_container: true, container_kind: 'crate' });
  await catalog.enroll({ id: 'ZZ2A', name: 'Box A', is_container: true });
  await catalog.enroll({ id: 'ZZ22', name: 'Pan' });
  await catalog.packInto('ZZ2A', 'ZZ2C');
  await catalog.packInto('ZZ22', 'ZZ2A');

  assert.deepEqual((await catalog.breadcrumb('ZZ22')).map((t) => t.name), ['Box A', 'Crate']);
});

test('undo reverses the last pack', async () => {
  await catalog.enroll({ id: 'ZZ2A', is_container: true });
  await catalog.enroll({ id: 'ZZ22' });
  await catalog.packInto('ZZ22', 'ZZ2A');

  assert.ok(await catalog.undoLast());

  const thing = await catalog.get('ZZ22');
  assert.equal(thing.parent_id, null);
  assert.equal(thing.status, 'unpacked');
});

test('undo reverses a move as one action, not half of one', async () => {
  await catalog.enroll({ id: 'ZZ2A', is_container: true });
  await catalog.enroll({ id: 'ZZ2B', is_container: true });
  await catalog.enroll({ id: 'ZZ22' });
  await catalog.packInto('ZZ22', 'ZZ2A');
  await catalog.packInto('ZZ22', 'ZZ2B');

  await catalog.undoLast();
  assert.equal((await catalog.get('ZZ22')).parent_id, 'ZZ2A', 'back to where it came from');
});

test('undoing an enrolment removes the row but keeps the history', async () => {
  await catalog.enroll({ id: 'ZZ22', name: 'Mistake' });
  await catalog.undoLast();

  assert.equal(await catalog.get('ZZ22'), undefined);
  assert.deepEqual(types(await recent('ZZ22')), ['enrolled', 'deleted']);
});

test('the history cannot be deleted, only appended to', async () => {
  await catalog.enroll({ id: 'ZZ22', name: 'Pan' });
  const before = await recent('ZZ22');

  // Exactly what a hostile client would try. Access rules allow select and
  // insert only, so this removes nothing.
  await catalog.raw.from('events').delete().eq('thing_id', 'ZZ22');

  assert.deepEqual(await recent('ZZ22'), before);
});

test('renaming records both sides so it can be undone', async () => {
  await catalog.enroll({ id: 'ZZ22' });
  await catalog.rename('ZZ22', 'Cast iron pan');
  assert.equal((await catalog.get('ZZ22')).name, 'Cast iron pan');

  await catalog.undoLast();
  assert.equal((await catalog.get('ZZ22')).name, null);
});

test('gone items leave their box but stay in the catalog', async () => {
  await catalog.enroll({ id: 'ZZ2A', is_container: true });
  await catalog.enroll({ id: 'ZZ22', name: 'Old lamp' });
  await catalog.packInto('ZZ22', 'ZZ2A');

  const gone = await catalog.markGone('ZZ22');
  assert.equal(gone.status, 'gone');
  assert.equal(gone.parent_id, null);
  assert.equal((await catalog.get('ZZ22')).name, 'Old lamp');
});

test('a partial update leaves the other fields alone', async () => {
  // Two helpers editing one item: naming it must not wipe the room somebody
  // else just set.
  await catalog.enroll({ id: 'ZZ22', room: 'Kitchen', tags: ['heavy'] });
  await catalog.rename('ZZ22', 'Pan');

  const thing = await catalog.get('ZZ22');
  assert.equal(thing.name, 'Pan');
  assert.equal(thing.room, 'Kitchen');
  assert.deepEqual(thing.tags, ['heavy']);
});

test('an invalid id is refused by the database, not just the client', async () => {
  // 'O' is not in the alphabet; the check constraint is the last line of defence.
  const { error } = await catalog.raw.from('things').insert({ id: 'ZZ2O' });
  assert.ok(error, 'the database should have rejected ZZ2O');
  assert.match(error.message, /check constraint/);
});

test('a scan on one device is visible to another', async () => {
  // Two clients, as two phones would be. No shared memory between them.
  const other = RemoteCatalog.open();
  try {
    await catalog.enroll({ id: 'ZZ22', name: 'Written by the first device' });
    const seen = await other.get('ZZ22');
    assert.equal(seen?.name, 'Written by the first device');
  } finally {
    other.close();
  }
});

test('a photo uploads to shared storage and is readable without a key', async () => {
  await catalog.enroll({ id: 'ZZ26', name: 'Pan' });

  // A real 2x2 JPEG — small enough to inline, valid enough that storage and
  // any image decoder downstream both accept it.
  const bytes = Uint8Array.from(atob(
    '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjExLjEwMAD/2wBDAAgEBAQEBAUF' +
    'BQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsO' +
    'Dg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAA' +
    'AAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAACAAIDASIAAhEAAxEA' +
    '/9oADAMBAAIRAxEAPwCLAE1/f//Z',
  ), (c) => c.charCodeAt(0));
  const photo = new Blob([bytes], { type: 'image/jpeg' });

  const urls = await catalog.uploadPhoto('ZZ26', { photo, thumb: photo });
  assert.match(urls.photo_url, /\/storage\/v1\/object\/public\/photos\/ZZ26\.jpg/);

  // Fetched with no credentials at all, exactly as an <img> on another device.
  const response = await fetch(urls.photo_url);
  assert.equal(response.status, 200);
  assert.ok((await response.arrayBuffer()).byteLength > 0);

  await catalog.update('ZZ26', { photo: urls.photo_url, thumb: urls.thumb_url });
  assert.equal((await catalog.get('ZZ26')).photo, urls.photo_url);
});

test('undo targets the action you took, not whatever happened last', async () => {
  // Two helpers. One packs, the other packs something else a moment later.
  // Offering "undo the last action" would hand the first person the second
  // person's work to reverse.
  const other = RemoteCatalog.open();
  try {
    await catalog.enroll({ id: 'ZZ2A', name: 'Box A', is_container: true });
    await catalog.enroll({ id: 'ZZ27', name: 'Mine' });
    await other.enroll({ id: 'ZZ28', name: 'Theirs' });

    await catalog.packInto('ZZ27', 'ZZ2A');
    const mine = catalog.lastGroup;
    await other.packInto('ZZ28', 'ZZ2A');

    await catalog.undoGroup(mine);

    assert.equal((await catalog.get('ZZ27')).parent_id, null, 'my pack was reversed');
    assert.equal((await catalog.get('ZZ28')).parent_id, 'ZZ2A', 'theirs was left alone');
  } finally {
    other.close();
  }
});

test('undoing the same action twice is refused rather than doubled', async () => {
  await catalog.enroll({ id: 'ZZ2A', is_container: true });
  await catalog.enroll({ id: 'ZZ27' });
  await catalog.packInto('ZZ27', 'ZZ2A');
  const group = catalog.lastGroup;

  assert.ok(await catalog.undoGroup(group));
  assert.equal(await catalog.undoGroup(group), null, 'already reversed');
  assert.equal((await catalog.get('ZZ27')).parent_id, null);
});
