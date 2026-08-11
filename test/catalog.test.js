import test from 'node:test';
import assert from 'node:assert/strict';
import { freshCatalog, types } from './helpers.js';

test('enrolling writes the thing and a matching event', async () => {
  const { catalog } = await freshCatalog();
  const thing = await catalog.enroll({ id: 'K7M3', name: '  Cast iron pan ' });

  assert.equal(thing.name, 'Cast iron pan');
  assert.equal(thing.name_lc, 'cast iron pan', 'search field is derived, not hand-set');
  assert.equal(thing.status, 'unpacked');
  assert.equal(thing.parent_id, null);
  assert.equal(thing.is_container, false);
  assert.equal(thing.container_kind, null);

  const events = await catalog.events();
  assert.deepEqual(types(events), ['enrolled']);
  assert.equal(events[0].thing_id, 'K7M3');
});

test('a nameless quick-capture is legal', async () => {
  const { catalog } = await freshCatalog();
  const thing = await catalog.enroll({ id: 'K7M3' });
  assert.equal(thing.name, null);
  assert.equal(thing.name_lc, '');
});

test('ids are normalized on the way in', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: ' k7m3 ' });
  assert.ok(await catalog.get('K7M3'));
  assert.ok(await catalog.get('k7m3'));
});

test('enrolling a code twice is an error, not a silent overwrite', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'K7M3', name: 'Pan' });
  await assert.rejects(() => catalog.enroll({ id: 'K7M3', name: 'Other' }), /already enrolled/);
  assert.equal((await catalog.get('K7M3')).name, 'Pan');
  assert.equal(await catalog.eventCount(), 1);
});

test('a container gets a kind by default and is findable by the container index', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'BXAA', name: 'Kitchen Box A', is_container: true });
  await catalog.enroll({ id: 'K7M3', name: 'Pan' });

  const containers = await catalog.containers();
  assert.deepEqual(containers.map((c) => c.id), ['BXAA']);
  assert.equal(containers[0].container_kind, 'box');
});

test('packing sets parent and status and writes one event', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'BXAA', is_container: true, container_kind: 'crate' });
  await catalog.enroll({ id: 'K7M3', name: 'Pan' });

  const packed = await catalog.packInto('K7M3', 'BXAA');
  assert.equal(packed.parent_id, 'BXAA');
  assert.equal(packed.status, 'packed');

  assert.deepEqual(types(await catalog.events({ thingId: 'K7M3' })), ['enrolled', 'packed']);
  assert.deepEqual((await catalog.childrenOf('BXAA')).map((t) => t.id), ['K7M3']);
});

test('moving between containers logs unpacked + packed', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'BXAA', is_container: true });
  await catalog.enroll({ id: 'BXBB', is_container: true });
  await catalog.enroll({ id: 'K7M3', name: 'Pan' });

  await catalog.packInto('K7M3', 'BXAA');
  await catalog.packInto('K7M3', 'BXBB');

  assert.deepEqual(types(await catalog.events({ thingId: 'K7M3' })), [
    'enrolled',
    'packed',
    'unpacked',
    'packed',
  ]);
  assert.deepEqual(await catalog.childrenOf('BXAA'), []);
  assert.deepEqual((await catalog.childrenOf('BXBB')).map((t) => t.id), ['K7M3']);
});

test('re-packing into the same container is a no-op, not log noise', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'BXAA', is_container: true });
  await catalog.enroll({ id: 'K7M3' });
  await catalog.packInto('K7M3', 'BXAA');
  await catalog.packInto('K7M3', 'BXAA');
  assert.equal((await catalog.events({ thingId: 'K7M3' })).length, 2);
});

test('containers nest, and the breadcrumb walks outward', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'CRAT', name: 'Crate 0042', is_container: true, container_kind: 'crate' });
  await catalog.enroll({ id: 'SUTC', name: 'Suitcase', is_container: true, container_kind: 'suitcase' });
  await catalog.enroll({ id: 'K7M3', name: 'Pan' });
  await catalog.packInto('SUTC', 'CRAT');
  await catalog.packInto('K7M3', 'SUTC');

  assert.deepEqual((await catalog.breadcrumb('K7M3')).map((t) => t.name), ['Suitcase', 'Crate 0042']);
});

test('a container cannot be packed into itself or its own contents', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'BXAA', is_container: true });
  await catalog.enroll({ id: 'BXBB', is_container: true });
  await catalog.packInto('BXBB', 'BXAA');

  await assert.rejects(() => catalog.packInto('BXAA', 'BXAA'), /cannot contain itself/);
  await assert.rejects(() => catalog.packInto('BXAA', 'BXBB'), /already inside/);
});

test('packing something that was never enrolled fails loudly', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'BXAA', is_container: true });
  await assert.rejects(() => catalog.packInto('K7M3', 'BXAA'), /not enrolled/);
});

test('renaming records both sides', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'K7M3' });
  const renamed = await catalog.rename('K7M3', 'Cast iron pan');

  assert.equal(renamed.name, 'Cast iron pan');
  assert.equal(renamed.name_lc, 'cast iron pan');
  const [, event] = await catalog.events({ thingId: 'K7M3' });
  assert.equal(event.type, 'renamed');
  assert.deepEqual(event.payload.before, { name: null });
  assert.deepEqual(event.payload.after, { name: 'Cast iron pan' });
});

test('gone things leave their container but stay in the catalog', async () => {
  const { catalog } = await freshCatalog();
  await catalog.enroll({ id: 'BXAA', is_container: true });
  await catalog.enroll({ id: 'K7M3', name: 'Old lamp' });
  await catalog.packInto('K7M3', 'BXAA');
  const gone = await catalog.markGone('K7M3');

  assert.equal(gone.status, 'gone');
  assert.equal(gone.parent_id, null);
  assert.equal((await catalog.get('K7M3')).name, 'Old lamp');
  assert.deepEqual(types(await catalog.events({ thingId: 'K7M3' })).slice(-1), ['deleted']);
});

test('the session survives a close and reopen', async () => {
  const { catalog } = await freshCatalog();
  assert.deepEqual(await catalog.session(), {
    key: 'current',
    mode: 'LOOKUP',
    target_id: null,
    last_scan_id: null,
    last_scan_ts: 0,
  });
  await catalog.setSession({ mode: 'PACKING', target_id: 'BXAA' });
  const again = await catalog.session();
  assert.equal(again.mode, 'PACKING');
  assert.equal(again.target_id, 'BXAA');
});

test('meta round-trips with a fallback', async () => {
  const { catalog } = await freshCatalog();
  assert.equal(await catalog.meta('last_export_ts', 0), 0);
  await catalog.setMeta('last_export_ts', 42);
  assert.equal(await catalog.meta('last_export_ts', 0), 42);
});
