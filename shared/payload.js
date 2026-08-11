import { BASE_URL } from '../config.js';
import { isValidId, normalizeId } from './ids.js';

/**
 * The string encoded into a Format A (URL) QR code.
 * Kept uppercase so the encoder picks alphanumeric mode over byte mode.
 */
export function buildPayload(id, baseUrl = BASE_URL) {
  const norm = normalizeId(id);
  if (!isValidId(norm)) throw new TypeError(`not an id: ${JSON.stringify(id)}`);
  return `${baseUrl.replace(/\/+$/, '')}/#${norm}`;
}

/** Origin + path, lowercased, trailing slashes stripped — for comparing URLs. */
function siteKey(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`.toLowerCase().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Resolve any scanned/typed string to an ID.
 *
 * Format A — a URL under the configured base, ID in the fragment.
 * Format B — a bare 4-character ID (not printed today; three lines to support,
 *            and it makes a smaller sticker a data change rather than a migration).
 *
 * `alsoAccept` lets the running app trust its own origin, so a QR generated for
 * a dev server resolves while a QR for someone else's site still does not.
 *
 * @returns {{ok: true, id: string, format: 'url'|'bare'}
 *          | {ok: false, reason: 'empty'|'foreign-url'|'malformed'}}
 */
export function parseScan(raw, { baseUrl = BASE_URL, alsoAccept = [] } = {}) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: false, reason: 'empty' };

  if (/^[a-z]+:\/\//i.test(text)) {
    const hash = text.slice(text.indexOf('#') + 1);
    const id = text.includes('#') ? normalizeId(hash) : '';
    if (!isValidId(id)) return { ok: false, reason: 'malformed' };

    const key = siteKey(text.split('#')[0]);
    const trusted = [baseUrl, ...alsoAccept].map(siteKey).filter(Boolean);
    if (key === null || !trusted.includes(key)) return { ok: false, reason: 'foreign-url' };

    return { ok: true, id, format: 'url' };
  }

  const id = normalizeId(text);
  return isValidId(id) ? { ok: true, id, format: 'bare' } : { ok: false, reason: 'malformed' };
}
