import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  actionsFor,
  assertCan,
  can,
  hasLiveLabel,
  isValidThingId,
  normalizeThingId,
  originalCode,
  retiredCode,
} from '../app/src/core/capabilities.js';
import { normalize } from '../app/src/core/model.js';
import { isValidId } from '../shared/ids.js';

const item = (extra = {}) => normalize({ id: 'K7M3', name: 'Pan', ...extra });
const box = (extra = {}) => normalize({ id: 'BXAA', name: 'Box A', is_container: true, ...extra });
const packed = (parent = 'BXAA') => item({ parent_id: parent, status: 'packed' });
const gone = (extra = {}) => item({ status: 'gone', ...extra });

test('every action has an answer for every thing', () => {
  for (const thing of [item(), box(), packed(), gone(), box({ status: 'gone' })]) {
    const verdicts = actionsFor(thing);
    for (const action of ACTIONS) {
      assert.ok(verdicts[action], `${action} missing for ${thing.id}`);
      assert.equal(typeof verdicts[action].allowed, 'boolean');
      if (!verdicts[action].allowed) {
        assert.ok(verdicts[action].reason, `${action} refused without a reason`);
      }
    }
  }
});

test('nothing is allowed on nothing', () => {
  const verdicts = actionsFor(null);
  for (const action of ACTIONS) assert.equal(verdicts[action].allowed, false);
});

// ── the ghost container, which is what this module exists to prevent ─────────

test('a full container may be marked gone, and says what happens to its contents', () => {
  const verdict = actionsFor(box(), { childCount: 2 }).markGone;
  assert.equal(verdict.allowed, true);
  assert.match(verdict.consequence, /All 2 things inside will come out first/);
});

test('an empty container goes quietly, with nothing to warn about', () => {
  const verdict = actionsFor(box(), { childCount: 0 }).markGone;
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.consequence, undefined);
});

test('the consequence reads correctly for a single thing', () => {
  assert.match(actionsFor(box(), { childCount: 1 }).markGone.consequence, /The thing inside/);
});

// ── gone is a real state, not a soft delete you can pack around ──────────────

test('a gone thing cannot be packed', () => {
  const verdict = actionsFor(gone(), { packingTarget: 'BXAA' }).pack;
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /was marked gone/);
});

test('a gone thing can be restored, and a live one cannot', () => {
  assert.ok(can('restore', gone()));
  assert.ok(!can('restore', item()));
  assert.equal(actionsFor(item()).restore.reason, 'not gone');
});

test('a gone container is not offered as somewhere to pack into', () => {
  assert.ok(!can('packInto', box({ status: 'gone' })));
  assert.ok(can('packInto', box()));
  assert.ok(!can('packInto', item()), 'an item is not a destination');
});

test('marking something gone twice is refused', () => {
  assert.equal(actionsFor(gone()).markGone.reason, 'already gone');
});

// ── packing ─────────────────────────────────────────────────────────────────

test('packing needs an open box', () => {
  assert.equal(actionsFor(item()).pack.reason, 'no box is open');
  assert.ok(can('pack', item(), { packingTarget: 'BXAA' }));
});

test('a container cannot be packed into itself', () => {
  const verdict = actionsFor(box(), { packingTarget: 'BXAA' }).pack;
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /cannot contain itself/);
});

test('a container cannot be packed into something it already contains', () => {
  const verdict = actionsFor(box(), { packingTarget: 'BXBB', wouldCycle: true }).pack;
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /already contains/);
});

test('something already in the open box is not packed again', () => {
  assert.equal(actionsFor(packed('BXAA'), { packingTarget: 'BXAA' }).pack.reason, 'already in this box');
});

test('something in a different box may be moved', () => {
  assert.ok(can('pack', packed('BXCC'), { packingTarget: 'BXAA' }));
});

test('unpack needs it to be in a box', () => {
  assert.ok(can('unpack', packed()));
  assert.equal(actionsFor(item()).unpack.reason, 'not in a box');
});

test('empty needs a container with something in it', () => {
  assert.ok(can('empty', box(), { childCount: 3 }));
  assert.equal(actionsFor(box(), { childCount: 0 }).empty.reason, 'already empty');
  assert.equal(actionsFor(item(), { childCount: 3 }).empty.reason, 'not a container');
});

test('only containers print a manifest', () => {
  assert.ok(can('printManifest', box()));
  assert.ok(!can('printManifest', item()));
});

// ── retired records: what a thing becomes when its label moves on ───────────

test('a live label is a scannable code; a retired one is not', () => {
  assert.ok(hasLiveLabel(item()));
  assert.ok(!hasLiveLabel(item({ id: 'K7M3-1' })));
});

test('a retired record keeps its history but cannot be edited or relabelled', () => {
  const old = item({ id: 'K7M3-1' });
  assert.ok(!can('edit', old));
  assert.ok(!can('photograph', old));
  assert.ok(!can('recode', old));
  assert.match(actionsFor(old).edit.reason, /replaced/);
});

test('a live thing can have its label moved to something else', () => {
  assert.ok(can('recode', item()));
});

test('retired codes are numbered, skipping the ones already taken', () => {
  assert.equal(retiredCode('K7M3'), 'K7M3-1');
  assert.equal(retiredCode('K7M3', ['K7M3-1']), 'K7M3-2');
  assert.equal(retiredCode('K7M3', ['K7M3-1', 'K7M3-2']), 'K7M3-3');
});

test('the original code is recoverable from a retired one', () => {
  assert.equal(originalCode('K7M3-2'), 'K7M3');
  assert.equal(originalCode('K7M3'), 'K7M3');
});

// ── the guard the data layer uses ────────────────────────────────────────────

test('assertCan throws the reason, so a rule cannot be enforced by a button alone', () => {
  assert.throws(() => assertCan('pack', gone(), { packingTarget: 'BXAA' }), /was marked gone/);
  assert.throws(() => assertCan('empty', box(), { childCount: 0 }), /already empty/);
  assert.doesNotThrow(() => assertCan('markGone', box(), { childCount: 2 }));
});

// ── record identity is not the same as a label code ─────────────────────────

test('a retired id survives normalisation', () => {
  // normalizeId strips separators to repair a code read off a scuffed sticker,
  // which turned K7M3-1 into K7M31 and made every retired record unreadable.
  assert.equal(normalizeThingId('K7M3-1'), 'K7M3-1');
  assert.equal(normalizeThingId(' k7m3-2 '), 'K7M3-2');
  assert.equal(normalizeThingId('K7M3'), 'K7M3');
  assert.equal(normalizeThingId('k7-m3'), 'K7M3', 'a live code is still repaired');
});

test('both forms identify a record; only the live one is a label', () => {
  assert.ok(isValidThingId('K7M3'));
  assert.ok(isValidThingId('K7M3-1'));
  assert.ok(!isValidThingId('K7M3-'));
  assert.ok(!isValidThingId('K7M3-abc'));
  assert.ok(!isValidThingId('NOPE-1'));

  // A retired form must never resolve as something scanned.
  assert.ok(!isValidId('K7M3-1'));
});
