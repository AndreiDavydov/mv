/**
 * The scan state machine — pure, so the whole interaction model is testable
 * without a camera, a DOM, or a database.
 *
 * `decideScan` answers one question: given the current session and what was
 * just scanned, what should happen? The caller performs the intent and writes
 * the returned session back.
 */

export const MODES = /** @type {const} */ (['LOOKUP', 'ENROLL', 'PACKING']);

/** A continuous decoder fires the same code ~30×/second without this. */
export const SCAN_COOLDOWN_MS = 2000;

/**
 * Where a code came from. Only the continuous camera loop is rate-limited:
 * every other source is a deliberate act — a tap, a typed code, a trigger
 * pull, a phone camera opening the link — and swallowing one of those looks
 * exactly like the app being broken.
 */
export const CONTINUOUS_SOURCE = 'camera';

/**
 * @typedef {{mode: 'LOOKUP'|'ENROLL'|'PACKING', target_id: string|null,
 *            last_scan_id: string|null, last_scan_ts: number}} Session
 * @typedef {{id: string, is_container: boolean, name: string|null,
 *            parent_id: string|null}|null} Thing
 *
 * @typedef {{type: 'ignore', reason: 'cooldown'}
 *         | {type: 'show', id: string}
 *         | {type: 'peek', id: string}
 *         | {type: 'enroll', id: string, packInto: string|null}
 *         | {type: 'pack', id: string, into: string, from: string|null}
 *         | {type: 'ask-switch-target', id: string}} Intent
 */

/**
 * @param {Session} session
 * @param {{id: string, ts: number, thing: Thing,
 *          source?: 'camera'|'hid'|'human'|'manual'|'link'}} scan
 * @returns {{intent: Intent, session: Session}}
 */
export function decideScan(session, { id, ts, thing, source = 'manual' }) {
  const repeat = id === session.last_scan_id && ts - session.last_scan_ts < SCAN_COOLDOWN_MS;
  if (repeat && source === CONTINUOUS_SOURCE) {
    return { intent: { type: 'ignore', reason: 'cooldown' }, session };
  }

  const seen = { ...session, last_scan_id: id, last_scan_ts: ts };
  const known = Boolean(thing);

  if (session.mode === 'PACKING' && session.target_id) {
    // The target itself: a peek at what is already inside. Stay in PACKING.
    if (id === session.target_id) return { intent: { type: 'peek', id }, session: seen };

    if (!known) {
      // Unknown code mid-pack: enroll it, then pack it. The chaining is the
      // reason ENROLL remembers where it came from.
      return {
        intent: { type: 'enroll', id, packInto: session.target_id },
        session: { ...seen, mode: 'ENROLL' },
      };
    }
    // A different container is the one genuinely ambiguous case — ask.
    if (thing.is_container) return { intent: { type: 'ask-switch-target', id }, session: seen };

    if (thing.parent_id === session.target_id) {
      return { intent: { type: 'peek', id }, session: seen };
    }
    return {
      intent: { type: 'pack', id, into: session.target_id, from: thing.parent_id },
      session: seen,
    };
  }

  // LOOKUP (and ENROLL, where a scan means "move on to the next code").
  if (!known) {
    return { intent: { type: 'enroll', id, packInto: null }, session: { ...seen, mode: 'ENROLL' } };
  }
  return { intent: { type: 'show', id }, session: { ...seen, mode: 'LOOKUP' } };
}

/**
 * Changing mode clears the cooldown.
 *
 * The cooldown exists to swallow a decoder firing thirty times a second at one
 * unmoving label. It must not swallow a deliberate second scan: enrol an item,
 * tap "pack into this", scan that same item again — that is one of the most
 * common things to do, and it has to land.
 */
function freshIntent(session) {
  return { ...session, last_scan_id: null, last_scan_ts: 0 };
}

/** Enter PACKING with `targetId` as the container being filled. */
export function startPacking(session, targetId) {
  return freshIntent({ ...session, mode: 'PACKING', target_id: targetId });
}

export function stopPacking(session) {
  return freshIntent({ ...session, mode: 'LOOKUP', target_id: null });
}

/**
 * Where ENROLL returns to once the thing is saved. A thing enrolled during
 * PACKING lands in the target container immediately.
 */
export function finishEnroll(session, { packInto }) {
  return freshIntent(
    packInto
      ? { ...session, mode: 'PACKING', target_id: packInto }
      : { ...session, mode: 'LOOKUP' },
  );
}

/** Sound/haptic cue for an intent — the scan has to be legible without looking. */
export function cueFor(intent) {
  switch (intent.type) {
    case 'pack':
      return 'rising';
    case 'enroll':
      return 'falling';
    case 'show':
    case 'peek':
      return 'neutral';
    case 'ask-switch-target':
      return 'query';
    case 'ignore':
      return null;
    default:
      return 'error';
  }
}
