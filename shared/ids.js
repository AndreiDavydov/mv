import { ID_ALPHABET, ID_LENGTH } from '../config.js';

export const ID_SPACE = ID_ALPHABET.length ** ID_LENGTH;

const ID_RE = new RegExp(`^[${ID_ALPHABET}]{${ID_LENGTH}}$`);

/**
 * Glyphs that cannot appear in an ID but that a human reading a scuffed label
 * will type anyway. `L` is in the alphabet while `1` and `I` are not, so any
 * `1`/`I` is unambiguously a misread `L`. `0`/`O` have no unique target — both
 * are excluded from the alphabet — so they are left to fail validation.
 */
const TYPO_FIXES = { 1: 'L', I: 'L' };

/** Uppercase, strip separators, repair unambiguous misreads. Never throws. */
export function normalizeId(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/[1I]/g, (c) => TYPO_FIXES[c]);
}

export function isValidId(raw) {
  return ID_RE.test(raw);
}

/** Sequential encoding: index 0 → '2222', so sheets advance predictably. */
export function idFromIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= ID_SPACE) {
    throw new RangeError(`index ${index} outside 0..${ID_SPACE - 1}`);
  }
  let n = index;
  let out = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    out = ID_ALPHABET[n % ID_ALPHABET.length] + out;
    n = Math.floor(n / ID_ALPHABET.length);
  }
  return out;
}

export function indexFromId(id) {
  const norm = normalizeId(id);
  if (!isValidId(norm)) throw new TypeError(`not an id: ${JSON.stringify(id)}`);
  return [...norm].reduce((acc, c) => acc * ID_ALPHABET.length + ID_ALPHABET.indexOf(c), 0);
}

export function nextId(id) {
  return idFromIndex(indexFromId(id) + 1);
}

/** `count` consecutive IDs starting at `startId`, inclusive. */
export function idRange(startId, count) {
  const start = indexFromId(startId);
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`bad count ${count}`);
  if (start + count > ID_SPACE) throw new RangeError('id range overflows the 4-character space');
  return Array.from({ length: count }, (_, i) => idFromIndex(start + i));
}
