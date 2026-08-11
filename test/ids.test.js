import test from 'node:test';
import assert from 'node:assert/strict';
import { ID_ALPHABET, ID_LENGTH } from '../config.js';
import {
  ID_SPACE,
  idFromIndex,
  idRange,
  indexFromId,
  isValidId,
  nextId,
  normalizeId,
} from '../shared/ids.js';

test('alphabet is exactly 32 unambiguous characters', () => {
  assert.equal(ID_ALPHABET.length, 32);
  assert.equal(new Set(ID_ALPHABET).size, 32);
  for (const c of '01IO') assert.ok(!ID_ALPHABET.includes(c), `${c} must be excluded`);
});

test('id space is 32^4', () => {
  assert.equal(ID_SPACE, 32 ** ID_LENGTH);
});

test('indexing round-trips across the whole space', () => {
  for (const i of [0, 1, 31, 32, 1023, 1024, 555_555, ID_SPACE - 1]) {
    const id = idFromIndex(i);
    assert.equal(id.length, ID_LENGTH);
    assert.equal(indexFromId(id), i);
  }
});

test('ids are sequential, not random', () => {
  assert.equal(idFromIndex(0), '2222');
  assert.equal(nextId('2222'), '2223');
  assert.equal(nextId('2229'), '222A');
  assert.equal(nextId('222Z'), '2232');
  assert.equal(idFromIndex(ID_SPACE - 1), 'ZZZZ');
});

test('out-of-range indexes are refused rather than wrapping', () => {
  assert.throws(() => idFromIndex(-1), RangeError);
  assert.throws(() => idFromIndex(ID_SPACE), RangeError);
  assert.throws(() => idRange('ZZZY', 5), /overflows/);
});

test('idRange returns consecutive ids', () => {
  assert.deepEqual(idRange('K7M3', 3), ['K7M3', 'K7M4', 'K7M5']);
  assert.deepEqual(idRange('K7M3', 0), []);
});

test('normalizeId repairs how a human types a scuffed label', () => {
  assert.equal(normalizeId('  k7m3 '), 'K7M3');
  assert.equal(normalizeId('k7-m3'), 'K7M3');
  // 1 and I are not in the alphabet, so both can only be a misread L.
  assert.equal(normalizeId('k7m1'), 'K7ML');
  assert.equal(normalizeId('iiii'), 'LLLL');
  assert.equal(normalizeId(null), '');
});

test('0 and O stay invalid — neither is in the alphabet, so there is no fix', () => {
  assert.ok(!isValidId(normalizeId('K7M0')));
  assert.ok(!isValidId(normalizeId('K7MO')));
});

test('isValidId rejects wrong length and stray characters', () => {
  assert.ok(isValidId('K7M3'));
  assert.ok(!isValidId('K7M'));
  assert.ok(!isValidId('K7M33'));
  assert.ok(!isValidId('k7m3'), 'validation is on normalized input only');
  assert.ok(!isValidId(''));
});
