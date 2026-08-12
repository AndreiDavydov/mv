import { isValidId } from '../../../shared/ids.js';

/**
 * What a thing can do, in one place.
 *
 * Every screen asks this what to offer, and every write asks it whether it is
 * allowed. Before this existed the answer lived in three places that disagreed:
 * the buttons on the item page, the methods in the data layer, and the database.
 * That is how a container could be marked gone while still holding things, and
 * how packing could quietly bring a gone item back from the dead.
 *
 * Pure: a thing, a little context, and an answer. No network, no DOM.
 *
 * Every answer carries a reason when it is `false`, because a hidden button and
 * a disabled one with an explanation are very different things, and the caller
 * — not this module — decides which to show.
 */

/**
 * @typedef {{allowed: boolean, reason?: string, consequence?: string}} Verdict
 *
 * `consequence` is for actions that are allowed but do more than they say — the
 * confirmation shows it. Refusing is a last resort: telling someone to go and
 * empty a box by hand before they may throw it away is a chore, not a safeguard.
 */

const YES = { allowed: true };
const no = (reason) => ({ allowed: false, reason });

export const ACTIONS = /** @type {const} */ ([
  'edit',
  'photograph',
  'pack',
  'unpack',
  'empty',
  'packInto',
  'markGone',
  'restore',
  'recode',
  'printManifest',
]);

/**
 * @param {object|null} thing
 * @param {{childCount?: number, packingTarget?: string|null,
 *          targetIsSelf?: boolean, wouldCycle?: boolean}} [context]
 * @returns {Record<typeof ACTIONS[number], Verdict>}
 */
export function actionsFor(thing, context = {}) {
  const { childCount = 0, packingTarget = null, wouldCycle = false } = context;

  if (!thing) {
    return Object.fromEntries(ACTIONS.map((a) => [a, no('nothing is selected')]));
  }

  const gone = thing.status === 'gone';
  const packed = Boolean(thing.parent_id);
  const container = Boolean(thing.is_container);
  const retired = !hasLiveLabel(thing);

  return {
    // Retired things are historical records. Editing one rewrites the past.
    edit: retired ? no('this record has been replaced') : YES,
    photograph: retired ? no('this record has been replaced') : YES,

    /** Can this thing be put into the container currently being packed? */
    pack: !packingTarget
      ? no('no box is open')
      : gone
        ? no(`${label(thing)} was marked gone`)
        : thing.id === packingTarget
          ? no('a container cannot contain itself')
          : wouldCycle
            ? no(`${label(thing)} already contains that box`)
            : thing.parent_id === packingTarget
              ? no('already in this box')
              : YES,

    unpack: packed ? YES : no('not in a box'),

    /** Take everything out of this container in one go. */
    empty: !container
      ? no('not a container')
      : childCount === 0
        ? no('already empty')
        : YES,

    /** Offer this thing as somewhere to pack into. */
    packInto: !container
      ? no('not a container')
      : gone
        ? no('this box was marked gone')
        : YES,

    /**
     * Allowed even when the box is full — but everything inside comes out first
     * and stays in the catalog, loose. A box marked gone while it still holds
     * things would leave those things pointing at something that no longer
     * exists, which is the ghost this module is here to prevent. Releasing is
     * one undoable action; refusing would just be a chore.
     */
    markGone: gone
      ? no('already gone')
      : container && childCount > 0
        ? {
            allowed: true,
            consequence:
              `${childCount === 1 ? 'The thing' : `All ${childCount} things`} inside will come out ` +
              'first and stay in the catalog, loose.',
          }
        : YES,

    restore: gone ? YES : no('not gone'),

    /** Put this label on something else. */
    recode: retired ? no('this record has no label') : YES,

    printManifest: container ? YES : no('not a container'),
  };
}

/** Shorthand: is this one action allowed? */
export function can(action, thing, context) {
  return actionsFor(thing, context)[action]?.allowed === true;
}

/**
 * Throw unless the action is allowed. The data layer calls this so a rule can
 * never be enforced only by whether a button was rendered.
 */
export function assertCan(action, thing, context) {
  const verdict = actionsFor(thing, context)[action];
  if (!verdict?.allowed) {
    throw new Error(verdict?.reason ?? `${action} is not allowed here`);
  }
}

/**
 * A live label is a code you can scan. A retired one — `K7M3-1` — is what a
 * thing keeps after its label has been moved to something else: the record
 * stays whole and searchable, it simply is not on anything any more.
 */
export function hasLiveLabel(thing) {
  return isValidId(thing?.id ?? '');
}

/** `K7M3-1` → `K7M3`. The label this record used to carry. */
export function originalCode(id) {
  return String(id ?? '').split('-')[0];
}

/** The next free retired form of a code, given the ones already taken. */
export function retiredCode(code, taken = []) {
  const used = new Set(taken);
  for (let n = 1; n < 1000; n++) {
    const candidate = `${code}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`${code} has been reassigned too many times`);
}

function label(thing) {
  return thing.name || thing.id;
}
