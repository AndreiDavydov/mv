import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteCatalog } from '../../app/src/core/remote.js';

/**
 * The rules that were being enforced by whether a button had been rendered,
 * now enforced by the data layer and checked against the real database.
 *
 * Reserved ids: `ZZ6*`.
 */

const P = 'ZZ6';
const BOX = 'ZZ6A';
const OTHER_BOX = 'ZZ6B';
const X = 'ZZ62';
const Y = 'ZZ63';

let catalog;

before(() => {
  catalog = RemoteCatalog.open();
});

after(async () => {
  await wipe();
  catalog.close();
});

beforeEach(() => wipe());

async function wipe() {
  const db = catalog.raw;
  await db.from('things').update({ parent_id: null, status: 'unpacked' }).like('id', `${P}%`);
  await db.from('things').delete().like('id', `${P}%`);
}

const ids = (rows) => rows.map((r) => r.id).sort();

/** Some migrations only a human with the SQL editor can apply. */
async function migrationApplied() {
  const { error } = await catalog.raw.rpc('retire_code', { code: 'ZZ69' });
  // "not enrolled" means the function is there and did its checks.
  return !error || /not enrolled/.test(error.message);
}

// ── no ghost containers ─────────────────────────────────────────────────────

test('marking a box gone releases everything inside it', async () => {
  await catalog.enroll({ id: BOX, name: 'Box', is_container: true });
  await catalog.enroll({ id: X, name: 'Pan' });
  await catalog.enroll({ id: Y, name: 'Pot' });
  await catalog.packInto(X, BOX);
  await catalog.packInto(Y, BOX);

  await catalog.markGone(BOX);

  assert.equal((await catalog.get(BOX)).status, 'gone');
  assert.deepEqual(await catalog.childrenOf(BOX), [], 'no ghost contents');
  for (const id of [X, Y]) {
    const thing = await catalog.get(id);
    assert.equal(thing.parent_id, null, `${id} should be loose`);
    assert.equal(thing.status, 'unpacked', `${id} should be unpacked`);
  }
});

test('releasing the contents is one action — undo puts the box and its contents back', async () => {
  await catalog.enroll({ id: BOX, name: 'Box', is_container: true });
  await catalog.enroll({ id: X, name: 'Pan' });
  await catalog.packInto(X, BOX);

  await catalog.markGone(BOX);
  await catalog.undoLast();

  assert.equal((await catalog.get(BOX)).status, 'unpacked');
  assert.equal((await catalog.get(X)).parent_id, BOX, 'and back in the box');
});

test('an empty box goes quietly', async () => {
  await catalog.enroll({ id: BOX, name: 'Box', is_container: true });
  await catalog.markGone(BOX);
  assert.equal((await catalog.get(BOX)).status, 'gone');
});

// ── gone is a state you leave deliberately ──────────────────────────────────

test('a gone thing cannot be packed by accident', async () => {
  await catalog.enroll({ id: BOX, name: 'Box', is_container: true });
  await catalog.enroll({ id: X, name: 'Old lamp' });
  await catalog.markGone(X);

  await assert.rejects(() => catalog.packInto(X, BOX), /was marked gone/);
  assert.equal((await catalog.get(X)).status, 'gone', 'still gone');
});

test('restore brings it back, loose', async () => {
  await catalog.enroll({ id: BOX, name: 'Box', is_container: true });
  await catalog.enroll({ id: X, name: 'Old lamp' });
  await catalog.packInto(X, BOX);
  await catalog.markGone(X);

  await catalog.restore(X);

  const thing = await catalog.get(X);
  assert.equal(thing.status, 'unpacked');
  assert.equal(thing.parent_id, null, 'not silently back in its old box');
  await catalog.packInto(X, BOX);
  assert.equal((await catalog.get(X)).parent_id, BOX);
});

test('restoring something that is not gone is refused', async () => {
  await catalog.enroll({ id: X, name: 'Pan' });
  await assert.rejects(() => catalog.restore(X), /not gone/);
});

// ── emptying a box: the other half of the move ──────────────────────────────

test('emptying takes everything out and leaves the box alone', async () => {
  await catalog.enroll({ id: BOX, name: 'Box', is_container: true });
  await catalog.enroll({ id: X, name: 'Pan' });
  await catalog.enroll({ id: Y, name: 'Pot' });
  await catalog.packInto(X, BOX);
  await catalog.packInto(Y, BOX);

  await catalog.emptyContainer(BOX);

  assert.deepEqual(await catalog.childrenOf(BOX), []);
  assert.equal((await catalog.get(BOX)).status, 'unpacked', 'the box itself is untouched');
  assert.deepEqual(ids([await catalog.get(X), await catalog.get(Y)]), [X, Y].sort());
  for (const id of [X, Y]) assert.equal((await catalog.get(id)).status, 'unpacked');
});

test('emptying is one action — undo refills the box', async () => {
  await catalog.enroll({ id: BOX, name: 'Box', is_container: true });
  await catalog.enroll({ id: X, name: 'Pan' });
  await catalog.enroll({ id: Y, name: 'Pot' });
  await catalog.packInto(X, BOX);
  await catalog.packInto(Y, BOX);

  await catalog.emptyContainer(BOX);
  await catalog.undoLast();

  assert.deepEqual(ids(await catalog.childrenOf(BOX)), [X, Y].sort());
});

test('emptying an empty box is refused rather than writing nothing', async () => {
  await catalog.enroll({ id: BOX, name: 'Box', is_container: true });
  await assert.rejects(() => catalog.emptyContainer(BOX), /already empty/);
});

test('an item cannot be emptied', async () => {
  await catalog.enroll({ id: X, name: 'Pan' });
  await assert.rejects(() => catalog.emptyContainer(X), /not a container/);
});

// ── nesting still holds ─────────────────────────────────────────────────────

test('emptying a crate releases the box inside it, contents intact', async () => {
  await catalog.enroll({ id: BOX, name: 'Crate', is_container: true, container_kind: 'crate' });
  await catalog.enroll({ id: OTHER_BOX, name: 'Box', is_container: true });
  await catalog.enroll({ id: X, name: 'Pan' });
  await catalog.packInto(OTHER_BOX, BOX);
  await catalog.packInto(X, OTHER_BOX);

  await catalog.emptyContainer(BOX);

  assert.equal((await catalog.get(OTHER_BOX)).parent_id, null, 'the box came out');
  assert.equal((await catalog.get(X)).parent_id, OTHER_BOX, 'and kept what was in it');
});

// ── moving a label onto something else ──────────────────────────────────────

test('a label can be moved to another thing, and the old record survives', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('needs supabase/migration-003-retire-code.sql');
    return;
  }

  await catalog.enroll({ id: X, name: 'The first thing' });
  await catalog.enroll({ id: BOX, name: 'Box', is_container: true });
  await catalog.packInto(X, BOX);

  const { freed, retired } = await catalog.recode(X);
  assert.equal(freed, X);
  assert.equal(retired, `${X}-1`);

  // The code is free, and means something else now.
  assert.equal(await catalog.get(X), undefined);
  await catalog.enroll({ id: X, name: 'The second thing' });
  assert.equal((await catalog.get(X)).name, 'The second thing');

  // The old record kept everything except the label.
  const old = await catalog.get(retired);
  assert.equal(old.name, 'The first thing');
  assert.equal(old.parent_id, BOX, 'including where it was');

  const history = (await catalog.events({ thingId: retired })).map((e) => e.type);
  assert.ok(history.includes('enrolled'), 'its history came with it');
  assert.ok(history.includes('recoded'));
});

test('a label can be reused more than once', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('needs supabase/migration-003-retire-code.sql');
    return;
  }

  await catalog.enroll({ id: X, name: 'First' });
  assert.equal((await catalog.recode(X)).retired, `${X}-1`);
  await catalog.enroll({ id: X, name: 'Second' });
  assert.equal((await catalog.recode(X)).retired, `${X}-2`);
  await catalog.enroll({ id: X, name: 'Third' });

  assert.equal((await catalog.get(X)).name, 'Third');
  assert.equal((await catalog.get(`${X}-1`)).name, 'First');
  assert.equal((await catalog.get(`${X}-2`)).name, 'Second');
});

test('a retired record cannot have its label moved again', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('needs supabase/migration-003-retire-code.sql');
    return;
  }

  await catalog.enroll({ id: X, name: 'First' });
  const { retired } = await catalog.recode(X);
  await assert.rejects(() => catalog.recode(retired), /no label/);
});

// ── what the database refuses on its own ─────────────────────────────────────
//
// The client already refuses all of these. These prove the database does too,
// so a second writer — an import, a script, a future client — cannot produce a
// state the model says is impossible.

const raw = () => catalog.raw;

/** Migration 004 is applied when a non-container cannot be a parent. */
async function containmentEnforced() {
  await raw().from('things').insert({ id: 'ZZ68', name: 'probe item', is_container: false });
  const { error } = await raw().from('things')
    .insert({ id: 'ZZ69', parent_id: 'ZZ68', status: 'packed' });
  await raw().from('things').delete().in('id', ['ZZ68', 'ZZ69']);
  return Boolean(error);
}

test('nothing can be packed into something that is not a container', async (t) => {
  if (!(await containmentEnforced())) {
    t.skip('needs supabase/migration-004-containment.sql');
    return;
  }
  await catalog.enroll({ id: X, name: 'A plain item' });
  const { error } = await raw().from('things').insert({ id: Y, parent_id: X, status: 'packed' });
  assert.ok(error, 'an item must not be able to contain anything');
  assert.match(error.message, /not a container/);
});

test('nothing can be packed into a container that is gone', async (t) => {
  if (!(await containmentEnforced())) {
    t.skip('needs supabase/migration-004-containment.sql');
    return;
  }
  await catalog.enroll({ id: BOX, name: 'Box', is_container: true });
  await catalog.markGone(BOX);

  const { error } = await raw().from('things').insert({ id: X, parent_id: BOX, status: 'packed' });
  assert.ok(error, 'a gone box must not accept contents');
  assert.match(error.message, /was marked gone/);
});

test('an item cannot carry a container kind', async (t) => {
  if (!(await containmentEnforced())) {
    t.skip('needs supabase/migration-004-containment.sql');
    return;
  }
  const { error } = await raw().from('things')
    .insert({ id: X, is_container: false, container_kind: 'crate' });
  assert.ok(error);
});

test('deleting a container releases what is in it rather than failing', async (t) => {
  if (!(await containmentEnforced())) {
    t.skip('needs supabase/migration-004-containment.sql');
    return;
  }
  // This is the path undo takes when reversing the enrolment of a container
  // somebody has since packed into.
  await catalog.enroll({ id: BOX, name: 'Box', is_container: true });
  await catalog.enroll({ id: X, name: 'Pan' });
  await catalog.packInto(X, BOX);

  const { error } = await raw().from('things').delete().eq('id', BOX);
  assert.ok(!error, `deleting the box failed: ${error?.message}`);

  const freed = await catalog.get(X);
  assert.equal(freed.parent_id, null, 'its contents came out');
  assert.equal(freed.status, 'unpacked');
});

test('packed and loose still cannot disagree', async () => {
  assert.ok((await raw().from('things').insert({ id: X, parent_id: null, status: 'packed' })).error);
  await catalog.enroll({ id: BOX, name: 'Box', is_container: true });
  assert.ok((await raw().from('things').insert({ id: Y, parent_id: BOX, status: 'unpacked' })).error);
});
