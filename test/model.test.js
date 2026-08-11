import test from 'node:test';
import assert from 'node:assert/strict';
import { eventTypeFor, normalize, pick, pickUndoGroup, summary } from '../app/src/core/model.js';

/** Terse event builder: id, group, type, and optionally what it reverses. */
let nextId = 1;
const ev = (group, type, extra = {}) => ({
  id: nextId++,
  thing_id: extra.thing_id ?? 'K7M3',
  type,
  payload: { group, ...extra.payload },
});

test('normalize fills defaults and derives the search field', () => {
  const thing = normalize({ id: 'K7M3', name: '  Cast iron pan ' });
  assert.equal(thing.name, 'Cast iron pan');
  assert.equal(thing.name_lc, 'cast iron pan');
  assert.equal(thing.status, 'unpacked');
  assert.equal(thing.parent_id, null);
  assert.deepEqual(thing.tags, []);
});

test('a container without a stated kind is a box', () => {
  assert.equal(normalize({ id: 'BXAA', is_container: true }).container_kind, 'box');
  assert.equal(normalize({ id: 'K7M3' }).container_kind, null, 'items have no kind');
});

test('a blank name is null, not an empty string', () => {
  assert.equal(normalize({ id: 'K7M3', name: '   ' }).name, null);
  assert.equal(normalize({ id: 'K7M3', name: '   ' }).name_lc, '');
});

test('summary keeps the record but never the photo', () => {
  const thing = normalize({ id: 'K7M3', name: 'Pan', photo: 'https://x/y.jpg', thumb: 'https://x/t.jpg' });
  const kept = summary(thing);
  assert.equal(kept.name, 'Pan');
  assert.ok(!('photo' in kept) && !('thumb' in kept) && !('name_lc' in kept));
});

test('pick returns exactly the requested fields, nulling what is missing', () => {
  assert.deepEqual(pick({ a: 1, b: 2 }, ['a', 'c']), { a: 1, c: null });
});

test('an event is named after the change it describes', () => {
  assert.equal(eventTypeFor({ parent_id: 'BXAA' }), 'packed');
  assert.equal(eventTypeFor({ parent_id: null }), 'unpacked');
  assert.equal(eventTypeFor({ status: 'gone' }), 'deleted');
  assert.equal(eventTypeFor({ name: 'Pan' }), 'renamed');
  assert.equal(eventTypeFor({ room: 'Kitchen' }), 'moved');
});

// ── undo selection ──────────────────────────────────────────────────────────

test('undo picks the newest action', () => {
  const log = [ev('g1', 'enrolled'), ev('g2', 'packed')];
  assert.equal(pickUndoGroup(log).group, 'g2');
});

test('a move is one action, and undo reverses both halves newest-first', () => {
  const log = [ev('g1', 'enrolled'), ev('g2', 'unpacked'), ev('g2', 'packed')];
  const chosen = pickUndoGroup(log);

  assert.equal(chosen.group, 'g2');
  assert.deepEqual(chosen.members.map((e) => e.type), ['packed', 'unpacked']);
});

test('an already-reversed action is skipped', () => {
  const log = [
    ev('g1', 'enrolled'),
    ev('g2', 'packed'),
    ev('g3', 'unpacked', { payload: { undo_of_group: 'g2' } }),
  ];
  assert.equal(pickUndoGroup(log).group, 'g1', 'walks back past what was already undone');
});

test('a reversal cannot itself be undone', () => {
  const log = [ev('g1', 'enrolled'), ev('g2', 'deleted', { payload: { undo_of_group: 'g1' } })];
  assert.equal(pickUndoGroup(log), null);
});

test('an empty log has nothing to undo', () => {
  assert.equal(pickUndoGroup([]), null);
});

test('events with no group are ignored rather than half-reversed', () => {
  assert.equal(pickUndoGroup([{ id: 1, type: 'packed', payload: {} }]), null);
});

test('order of the input does not matter — the log arrives newest-first', () => {
  const a = ev('g1', 'enrolled');
  const b = ev('g2', 'packed');
  assert.equal(pickUndoGroup([b, a]).group, pickUndoGroup([a, b]).group);
});

test('undo is shared: it reverses the last action anybody took', () => {
  // Two helpers scanning at once write into one log. Undo is not per-device.
  const log = [
    ev('g1', 'packed', { thing_id: 'AAAA' }),
    ev('g2', 'packed', { thing_id: 'BBBB' }),
  ];
  const chosen = pickUndoGroup(log);
  assert.equal(chosen.members[0].thing_id, 'BBBB');
});
