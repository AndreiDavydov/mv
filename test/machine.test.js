import test from 'node:test';
import assert from 'node:assert/strict';
import { SCAN_COOLDOWN_MS, cueFor, decideScan, finishEnroll, isRepeatScan, startPacking, stopPacking } from '../app/src/core/machine.js';
import { DEFAULT_SESSION } from '../app/src/core/model.js';

const item = (id, parent_id = null) => ({ id, name: id, is_container: false, parent_id });
const box = (id, parent_id = null) => ({ id, name: id, is_container: true, parent_id });

const lookup = { ...DEFAULT_SESSION };
const packing = { ...DEFAULT_SESSION, mode: 'PACKING', target_id: 'BXAA' };

test('LOOKUP: a known code shows the thing', () => {
  const { intent, session } = decideScan(lookup, { id: 'K7M3', ts: 1, thing: item('K7M3') });
  assert.deepEqual(intent, { type: 'show', id: 'K7M3' });
  assert.equal(session.mode, 'LOOKUP');
});

test('LOOKUP: an unknown code goes straight to ENROLL', () => {
  const { intent, session } = decideScan(lookup, { id: 'K7M3', ts: 1, thing: null });
  assert.deepEqual(intent, { type: 'enroll', id: 'K7M3', packInto: null });
  assert.equal(session.mode, 'ENROLL');
});

test('a repeat camera frame inside the cooldown is ignored', () => {
  const seen = { ...lookup, last_scan_id: 'K7M3', last_scan_ts: 1000 };
  const { intent, session } = decideScan(seen, {
    id: 'K7M3',
    ts: 1000 + SCAN_COOLDOWN_MS - 1,
    thing: item('K7M3'),
    source: 'camera',
  });
  assert.deepEqual(intent, { type: 'ignore', reason: 'cooldown' });
  assert.equal(session, seen, 'an ignored scan must not touch the session');
});

test('the same code after the cooldown is a real scan again', () => {
  const seen = { ...lookup, last_scan_id: 'K7M3', last_scan_ts: 1000 };
  const { intent } = decideScan(seen, {
    id: 'K7M3',
    ts: 1000 + SCAN_COOLDOWN_MS,
    thing: item('K7M3'),
    source: 'camera',
  });
  assert.equal(intent.type, 'show');
});

test('a different code inside the cooldown window still counts', () => {
  const seen = { ...lookup, last_scan_id: 'K7M3', last_scan_ts: 1000 };
  const { intent } = decideScan(seen, {
    id: 'AAAA', ts: 1001, thing: item('AAAA'), source: 'camera',
  });
  assert.equal(intent.type, 'show');
});

test('only the continuous camera loop is rate-limited', () => {
  // A phone's stock camera opening the label URL, a typed code, and a ring
  // scanner trigger are all deliberate acts. Swallowing one reads as a bug.
  const seen = { ...lookup, last_scan_id: 'K7M3', last_scan_ts: 1000 };
  for (const source of ['link', 'manual', 'hid', 'human', undefined]) {
    const { intent } = decideScan(seen, {
      id: 'K7M3',
      ts: 1001,
      thing: item('K7M3'),
      source,
    });
    assert.equal(intent.type, 'show', `source ${source} was wrongly swallowed`);
  }
});

test('PACKING: a loose item is packed with no confirmation', () => {
  const { intent, session } = decideScan(packing, { id: 'K7M3', ts: 1, thing: item('K7M3') });
  assert.deepEqual(intent, { type: 'pack', id: 'K7M3', into: 'BXAA', from: null });
  assert.equal(session.mode, 'PACKING', 'packing is sticky');
});

test('PACKING: an item already in another box moves silently', () => {
  const { intent } = decideScan(packing, { id: 'K7M3', ts: 1, thing: item('K7M3', 'BXCC') });
  assert.deepEqual(intent, { type: 'pack', id: 'K7M3', into: 'BXAA', from: 'BXCC' });
});

test('PACKING: rescanning something already in the target is a peek, not a rewrite', () => {
  const { intent } = decideScan(packing, { id: 'K7M3', ts: 1, thing: item('K7M3', 'BXAA') });
  assert.deepEqual(intent, { type: 'peek', id: 'K7M3' });
});

test('PACKING: an unknown code enrolls and comes back packed', () => {
  const { intent, session } = decideScan(packing, { id: 'K7M3', ts: 1, thing: null });
  assert.deepEqual(intent, { type: 'enroll', id: 'K7M3', packInto: 'BXAA' });
  assert.equal(session.mode, 'ENROLL');
  assert.equal(finishEnroll(session, { packInto: intent.packInto }).mode, 'PACKING');
  assert.equal(finishEnroll(session, { packInto: intent.packInto }).target_id, 'BXAA');
});

test('PACKING: scanning the target container peeks at its contents', () => {
  const { intent, session } = decideScan(packing, { id: 'BXAA', ts: 1, thing: box('BXAA') });
  assert.deepEqual(intent, { type: 'peek', id: 'BXAA' });
  assert.equal(session.mode, 'PACKING');
});

test('PACKING: a different container is the one case that asks a question', () => {
  const { intent, session } = decideScan(packing, { id: 'BXBB', ts: 1, thing: box('BXBB') });
  assert.deepEqual(intent, { type: 'ask-switch-target', id: 'BXBB' });
  assert.equal(session.mode, 'PACKING', 'nothing changes until the question is answered');
});

test('start/stop packing', () => {
  const on = startPacking(lookup, 'BXAA');
  assert.equal(on.mode, 'PACKING');
  assert.equal(on.target_id, 'BXAA');
  assert.deepEqual(stopPacking(on), { ...lookup, mode: 'LOOKUP', target_id: null });
});

test('changing mode clears the cooldown so a deliberate rescan lands', () => {
  // Enrol K7M3, tap "pack into this", scan K7M3 again — all inside two seconds.
  const afterEnroll = { ...lookup, last_scan_id: 'K7M3', last_scan_ts: 1000 };

  for (const session of [
    startPacking(afterEnroll, 'BXAA'),
    finishEnroll({ ...afterEnroll, mode: 'ENROLL' }, { packInto: 'BXAA' }),
    stopPacking({ ...afterEnroll, mode: 'PACKING', target_id: 'BXAA' }),
  ]) {
    assert.equal(session.last_scan_id, null);
    const { intent } = decideScan(session, { id: 'K7M3', ts: 1100, thing: item('K7M3') });
    assert.notEqual(intent.type, 'ignore', `${session.mode} still swallowed the rescan`);
  }
});

test('enrolling outside packing returns to LOOKUP', () => {
  assert.equal(finishEnroll({ ...lookup, mode: 'ENROLL' }, { packInto: null }).mode, 'LOOKUP');
});

test('every intent has an audible cue except the ignored one', () => {
  assert.equal(cueFor({ type: 'pack' }), 'rising');
  assert.equal(cueFor({ type: 'enroll' }), 'falling');
  assert.equal(cueFor({ type: 'ask-switch-target' }), 'query');
  assert.equal(cueFor({ type: 'ignore' }), null);
  assert.equal(cueFor({ type: 'whatever' }), 'error');
});

// ── the cooldown, asked before the row is fetched ───────────────────────────

test('the cooldown can be asked without a row, which is what makes it usable', () => {
  const session = { ...DEFAULT_SESSION, last_scan_id: 'K7M3', last_scan_ts: 1000 };

  assert.equal(isRepeatScan(session, { id: 'K7M3', ts: 1500, source: 'camera' }), true);
  assert.equal(isRepeatScan(session, { id: 'K7M3', ts: 4000, source: 'camera' }), false);
  assert.equal(isRepeatScan(session, { id: 'ZZ4B', ts: 1500, source: 'camera' }), false);
});

test('only the camera is rate-limited — a deliberate rescan always lands', () => {
  const session = { ...DEFAULT_SESSION, last_scan_id: 'K7M3', last_scan_ts: 1000 };

  for (const source of ['manual', 'hid', 'link', 'human']) {
    assert.equal(
      isRepeatScan(session, { id: 'K7M3', ts: 1001, source }),
      false,
      `${source} must not be swallowed`,
    );
  }
});

test('decideScan and isRepeatScan agree, so the caller cannot stamp twice', () => {
  // app.scan() claims the cooldown synchronously and then hands decideScan the
  // session as it was *before* the stamp. If the two rules ever disagreed, that
  // second call would see its own stamp and ignore every camera scan.
  const session = { ...DEFAULT_SESSION, last_scan_id: 'K7M3', last_scan_ts: 1000 };
  const scan = { id: 'K7M3', ts: 1500, source: 'camera' };

  assert.equal(isRepeatScan(session, scan), true);
  assert.equal(decideScan(session, { ...scan, thing: null }).intent.type, 'ignore');

  const later = { ...scan, ts: 9000 };
  assert.equal(isRepeatScan(session, later), false);
  assert.notEqual(decideScan(session, { ...later, thing: null }).intent.type, 'ignore');
});
