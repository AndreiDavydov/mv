import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_FORMAT, backupStatus, fromJSON, toCSV, toJSON } from '../app/src/core/backup.js';
import { normalize } from '../app/src/core/repo.js';
import { BACKUP_NAG_DAYS, BACKUP_NAG_EVENTS } from '../config.js';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

const things = [
  normalize({ id: 'BXAA', name: 'Kitchen Box A', is_container: true, container_kind: 'box', created_at: 1, updated_at: 2 }),
  normalize({
    id: 'K7M3',
    name: 'Cast iron pan, "the heavy one"',
    parent_id: 'BXAA',
    status: 'packed',
    room: 'Kitchen',
    tags: ['heavy'],
    notes: 'line one\nline two',
    photo: { size: 1 },
    created_at: 1,
    updated_at: 3,
  }),
];
const events = [{ id: 1, thing_id: 'K7M3', type: 'enrolled', parent_id: null, payload: {}, ts: 1 }];

test('the JSON bundle carries the rows and points at the photo files', () => {
  const json = toJSON({ things, events, exportedAt: NOW });

  assert.equal(json.format, BACKUP_FORMAT);
  assert.deepEqual(json.counts, { things: 2, events: 1 });
  assert.equal(json.things[1].photo_file, 'photos/K7M3.jpg');
  assert.equal(json.things[0].photo_file, null);
  for (const thing of json.things) {
    assert.ok(!('photo' in thing) && !('thumb' in thing), 'blobs never go into the JSON');
  }
});

test('the CSV is readable by a spreadsheet, quotes and newlines included', () => {
  const rows = toCSV(things).split('\r\n');

  assert.match(rows[0], /^id,name,is_container/);
  assert.match(rows[2], /"Cast iron pan, ""the heavy one"""/);
  assert.match(rows[2], /"line one\nline two"/);
  assert.match(rows[2], /,BXAA,Kitchen Box A,/, 'the parent name is resolved for a human reader');
  assert.match(rows[2], /,yes,/, 'has_photo');
});

test('a bundle round-trips', () => {
  const restored = fromJSON(JSON.stringify(toJSON({ things, events, exportedAt: NOW })));

  assert.equal(restored.things.length, 2);
  assert.equal(restored.exportedAt, NOW);
  assert.equal(restored.things[1].parent_id, 'BXAA');
  assert.equal(restored.things[1].name_lc, 'cast iron pan, "the heavy one"');
});

test('a bad bundle is refused whole rather than half-imported', () => {
  assert.throws(() => fromJSON('{}'), /unknown backup format/);
  assert.throws(() => fromJSON(JSON.stringify({ format: BACKUP_FORMAT })), /missing things\/events/);
  assert.throws(
    () => fromJSON(JSON.stringify({ format: BACKUP_FORMAT, things: [{ id: 'K7M3', parent_id: 'GONE' }], events: [] })),
    /points at missing container/,
  );
});

test('an empty catalog is not nagged', () => {
  const status = backupStatus({ lastExportTs: 0, lastExportEventCount: 0, eventCount: 0, now: NOW });
  assert.equal(status.due, false);
});

test('a catalog that has never been exported is nagged', () => {
  const status = backupStatus({ lastExportTs: 0, lastExportEventCount: 0, eventCount: 3, now: NOW });
  assert.deepEqual({ due: status.due, reason: status.reason }, { due: true, reason: 'never' });
});

test('nagging starts after three days', () => {
  const base = { lastExportEventCount: 10, eventCount: 11, now: NOW };
  assert.equal(backupStatus({ ...base, lastExportTs: NOW - DAY }).due, false);
  const stale = backupStatus({ ...base, lastExportTs: NOW - BACKUP_NAG_DAYS * DAY });
  assert.deepEqual({ due: stale.due, reason: stale.reason }, { due: true, reason: 'stale' });
});

test('nagging also starts after fifty events', () => {
  const status = backupStatus({
    lastExportTs: NOW - 60_000,
    lastExportEventCount: 0,
    eventCount: BACKUP_NAG_EVENTS,
    now: NOW,
  });
  assert.deepEqual({ due: status.due, reason: status.reason }, { due: true, reason: 'events' });
  assert.equal(status.events, BACKUP_NAG_EVENTS);
});
