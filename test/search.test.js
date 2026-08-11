import test from 'node:test';
import assert from 'node:assert/strict';
import { searchThings } from '../app/src/core/search.js';
import { normalize } from '../app/src/core/repo.js';

const make = (id, extra = {}) => normalize({ id, updated_at: 1, ...extra });

const catalog = [
  make('K7M3', { name: 'Cast iron pan', room: 'Kitchen', tags: ['heavy', 'cookware'] }),
  make('K7M4', { name: 'Espresso pot', room: 'Kitchen', status: 'packed', parent_id: 'BXAA' }),
  make('K7M5', { name: 'Winter coat', room: 'Hallway', notes: 'The grey one' }),
  make('K7M6'), // quick-captured, no name
  make('BXAA', { name: 'Kitchen Box A', is_container: true, container_kind: 'box', status: 'packed' }),
  make('CRAT', { name: 'Crate 0042', is_container: true, container_kind: 'crate' }),
];

const ids = (result) => result.map((t) => t.id);

test('an empty query returns everything', () => {
  assert.equal(searchThings(catalog).length, catalog.length);
});

test('a 4-character code outranks everything else', () => {
  assert.equal(searchThings(catalog, { q: 'K7M3' })[0].id, 'K7M3');
  assert.equal(searchThings(catalog, { q: 'k7m3' })[0].id, 'K7M3', 'case does not matter');
});

test('a typed code and a scanned code resolve to the same thing', () => {
  // '1' cannot be an ID character, so it can only be a misread 'L' — the same
  // repair the scanner applies.
  const typed = searchThings(catalog, { q: 'k7m3' });
  assert.deepEqual(ids(typed).slice(0, 1), ['K7M3']);
});

test('names beat tags beat rooms beat notes', () => {
  assert.equal(searchThings(catalog, { q: 'kitchen' })[0].id, 'BXAA', 'name match first');
  assert.deepEqual(ids(searchThings(catalog, { q: 'heavy' })), ['K7M3']);
  assert.deepEqual(ids(searchThings(catalog, { q: 'hallway' })), ['K7M5']);
  assert.deepEqual(ids(searchThings(catalog, { q: 'grey' })), ['K7M5']);
});

test('substring matching is enough', () => {
  assert.deepEqual(ids(searchThings(catalog, { q: 'espress' })), ['K7M4']);
  assert.deepEqual(ids(searchThings(catalog, { q: 'coat' })), ['K7M5']);
});

test('nothing matches nothing', () => {
  assert.deepEqual(searchThings(catalog, { q: 'zzzz' }), []);
});

test('the unpacked filter finds what still has to be packed', () => {
  assert.deepEqual(ids(searchThings(catalog, { unpacked: true })).sort(), ['CRAT', 'K7M3', 'K7M5', 'K7M6']);
});

test('the unnamed filter is the quick-capture cleanup queue', () => {
  assert.deepEqual(ids(searchThings(catalog, { unnamed: true })), ['K7M6']);
});

test('container filters', () => {
  assert.deepEqual(ids(searchThings(catalog, { containersOnly: true })).sort(), ['BXAA', 'CRAT']);
  assert.deepEqual(ids(searchThings(catalog, { containerKind: 'crate' })), ['CRAT']);
});

test('filters combine with the query', () => {
  assert.deepEqual(ids(searchThings(catalog, { q: 'kitchen', unpacked: true })), ['K7M3']);
  assert.deepEqual(searchThings(catalog, { q: 'kitchen', room: 'Hallway' }), []);
});
