import test from 'node:test';
import assert from 'node:assert/strict';
import { freshCatalog, types } from './helpers.js';

test('undo reverses the last pack', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'BXAA', is_container: true });
  await catalog.enroll({ id: 'K7M3', name: 'Pan' });
  await catalog.packInto('K7M3', 'BXAA');

  assert.ok(await catalog.undoLast());

  const thing = await catalog.get('K7M3');
  assert.equal(thing.parent_id, null);
  assert.equal(thing.status, 'unpacked');
  assert.deepEqual(await catalog.childrenOf('BXAA'), []);
});

test('undo reverses a move between boxes as one action, not half of one', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'BXAA', is_container: true });
  await catalog.enroll({ id: 'BXBB', is_container: true });
  await catalog.enroll({ id: 'K7M3' });
  await catalog.packInto('K7M3', 'BXAA');
  await catalog.packInto('K7M3', 'BXBB');

  await catalog.undoLast();

  const thing = await catalog.get('K7M3');
  assert.equal(thing.parent_id, 'BXAA', 'it goes back to the box it came from');
  assert.equal(thing.status, 'packed');
});

test('the log is append-only — undo adds events, never removes them', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'BXAA', is_container: true });
  await catalog.enroll({ id: 'K7M3' });
  await catalog.packInto('K7M3', 'BXAA');

  const before = await catalog.eventCount();
  await catalog.undoLast();
  const after = await catalog.events();

  assert.ok(after.length > before);
  assert.deepEqual(types(after), ['enrolled', 'enrolled', 'packed', 'unpacked']);
  assert.equal(after.at(-1).payload.undo_of, after.at(-2).id, 'the reversal points at what it reversed');
});

test('undo walks backwards through successive actions', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'BXAA', is_container: true });
  await catalog.enroll({ id: 'AAAA' });
  await catalog.enroll({ id: 'BBBB' });
  await catalog.packInto('AAAA', 'BXAA');
  await catalog.packInto('BBBB', 'BXAA');

  await catalog.undoLast();
  assert.deepEqual((await catalog.childrenOf('BXAA')).map((t) => t.id), ['AAAA']);

  await catalog.undoLast();
  assert.deepEqual(await catalog.childrenOf('BXAA'), []);
});

test('undoing an enrolment removes the thing', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'K7M3', name: 'Mistake' });
  await catalog.undoLast();

  assert.equal(await catalog.get('K7M3'), undefined);
  assert.deepEqual(types(await catalog.events()), ['enrolled', 'deleted']);
});

test('undoing a rename restores the previous name', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'K7M3', name: 'Pan' });
  await catalog.rename('K7M3', 'Wok');
  await catalog.undoLast();
  assert.equal((await catalog.get('K7M3')).name, 'Pan');
});

test('undo on an empty log returns null instead of throwing', async () => {
  const { catalog } = await freshCatalog();
  assert.equal(await catalog.undoLast(), null);
});

test('undo stops once everything has been undone', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'K7M3' });
  assert.ok(await catalog.undoLast());
  assert.equal(await catalog.undoLast(), null, 'a reversal is not itself undoable');
});
