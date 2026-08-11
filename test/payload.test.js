import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL } from '../config.js';
import { buildPayload, parseScan } from '../shared/payload.js';

test('payload is uppercase so the QR uses alphanumeric mode', () => {
  const payload = buildPayload('k7m3');
  assert.equal(payload, `${BASE_URL}/#K7M3`);
  assert.equal(payload, payload.toUpperCase());
});

test('buildPayload refuses anything that is not an id', () => {
  assert.throws(() => buildPayload('K7M'), TypeError);
});

test('format A — a url under the base resolves to its fragment', () => {
  assert.deepEqual(parseScan(buildPayload('K7M3')), { ok: true, id: 'K7M3', format: 'url' });
});

test('format A — host and path are case-insensitive, the fragment is uppercased', () => {
  assert.deepEqual(parseScan(`${BASE_URL.toLowerCase()}/#k7m3`), {
    ok: true,
    id: 'K7M3',
    format: 'url',
  });
});

test('format B — a bare id resolves the same way', () => {
  assert.deepEqual(parseScan('K7M3'), { ok: true, id: 'K7M3', format: 'bare' });
  assert.deepEqual(parseScan(' k7m3\n'), { ok: true, id: 'K7M3', format: 'bare' });
});

test('a url for someone else’s site is rejected, not silently looked up', () => {
  assert.deepEqual(parseScan('https://example.com/#K7M3'), { ok: false, reason: 'foreign-url' });
});

test('alsoAccept lets the running app trust its own origin', () => {
  const result = parseScan('http://localhost:8080/app/#K7M3', {
    alsoAccept: ['http://localhost:8080/app/'],
  });
  assert.deepEqual(result, { ok: true, id: 'K7M3', format: 'url' });
});

test('junk is rejected with a reason', () => {
  assert.equal(parseScan('').reason, 'empty');
  assert.equal(parseScan('hello world').reason, 'malformed');
  assert.equal(parseScan(`${BASE_URL}/#NOPE!`).reason, 'malformed');
  assert.equal(parseScan(`${BASE_URL}/`).reason, 'malformed');
});
