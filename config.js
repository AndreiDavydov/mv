/**
 * Shared configuration for the label generator and the catalog app.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ BASE_URL IS PERMANENT.                                                  │
 * │ It is baked into every Format A QR code that is ever printed. Changing  │
 * │ it after the first sheet is printed kills every label already stuck to  │
 * │ a box. Set it once, before printing, and never touch it again.          │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The scheme and host are uppercase on purpose: an uppercase run is encoded in
 * the QR alphanumeric mode instead of byte mode (~40% denser), and hostnames
 * are case-insensitive so the link still resolves.
 *
 * The PATH IS NOT. GitHub Pages serves `/mv/` and 404s on `/MV/`. The path must
 * match the repository name exactly, character for character — and here it
 * costs nothing: the payload is QR version 3 either way.
 */

/** Your GitHub Pages URL. Host uppercase; path in its real case; no trailing slash. */
export const BASE_URL = 'HTTPS://ANDREIDAVYDOV.GITHUB.IO/mv';

/**
 * True once BASE_URL has been reviewed by a human. The label generator
 * refuses to print full sheets while this is false — a sheet of labels
 * pointing at the wrong host is unrecoverable.
 */
export const BASE_URL_CONFIRMED = true;

/** Crockford-style: no 0/O and no 1/I/L to confuse when typed by hand. */
export const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const ID_LENGTH = 4;

/**
 * Rooms offered as chips. A fixed vocabulary keeps the same place spelled the
 * same way; the edit screen's "Other…" chip adds a one-off when the move turns
 * up somewhere this list did not anticipate.
 */
export const ROOMS = [
  'Kitchen',
  'Living room',
  'Bedroom',
  'Office',
  'Bathroom',
  'Hallway',
  'Cellar',
  'Balcony',
];

export const CONTAINER_KINDS = ['box', 'suitcase', 'crate', 'bag', 'shelf'];

/** Nag for a fresh export after this many days or events, whichever comes first. */
export const BACKUP_NAG_DAYS = 3;
export const BACKUP_NAG_EVENTS = 50;
