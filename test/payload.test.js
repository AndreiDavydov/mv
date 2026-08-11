import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL } from '../config.js';
import { buildPayload, parseScan } from '../shared/payload.js';

test('the scheme and host are uppercase so the QR uses alphanumeric mode', () => {
  const payload = buildPayload('k7m3');
  assert.equal(payload, `${BASE_URL}/#K7M3`);

  // `new URL()` lowercases scheme and host, so check the raw string.
  const [, origin] = /^([a-z]+:\/\/[^/]+)/i.exec(payload);
  assert.equal(origin, origin.toUpperCase(), 'scheme and host must be uppercase');
  assert.equal(payload.slice(-5), '#K7M3', 'the id is always uppercased');
});

test('the configured path is never uppercased — Pages paths are case-sensitive', () => {
  const path = new URL(BASE_URL).pathname;
  assert.ok(buildPayload('K7M3').includes(path), `payload must contain ${path} verbatim`);
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

test('the payload keeps the path exactly as configured', () => {
  // Hostnames are case-insensitive; paths are not. Uppercasing the whole URL
  // for QR density 404s every label when the repository is lowercase.
  const payload = buildPayload('K7M3', 'HTTPS://EXAMPLE.GITHUB.IO/mv');
  assert.equal(payload, 'HTTPS://EXAMPLE.GITHUB.IO/mv/#K7M3');
  assert.ok(payload.includes('/mv/'), 'the path must not be uppercased');
});

test('a scan resolves regardless of how the host is cased', () => {
  const base = 'HTTPS://EXAMPLE.GITHUB.IO/mv';
  for (const text of [
    'HTTPS://EXAMPLE.GITHUB.IO/mv/#K7M3',
    'https://example.github.io/mv/#k7m3',
    'https://Example.GitHub.io/mv/#K7M3',
  ]) {
    assert.deepEqual(parseScan(text, { baseUrl: base }), { ok: true, id: 'K7M3', format: 'url' });
  }
});
