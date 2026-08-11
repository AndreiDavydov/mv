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

/**
 * Your GitHub Pages URL, pointing at the app itself — not the repository root,
 * which serves the README. Host uppercase; path in its real case; no trailing
 * slash. The extra `/app` costs nothing: still QR version 3.
 */
export const BASE_URL = 'HTTPS://ANDREIDAVYDOV.GITHUB.IO/mv/app';

/**
 * True once BASE_URL has been reviewed by a human. The label generator
 * refuses to print full sheets while this is false — a sheet of labels
 * pointing at the wrong host is unrecoverable.
 */
export const BASE_URL_CONFIRMED = true;

/**
 * ── Shared catalog ──────────────────────────────────────────────────────────
 *
 * One database, every device. A scan on a phone shows up on the laptop screen
 * immediately; nothing is stored on the scanning device.
 *
 * Fill these in from Supabase → Project Settings → API, then run
 * `supabase/schema.sql` once in the SQL editor.
 *
 * The anon key is meant to be public — it is the browser key, guarded by the
 * row-level security policies in schema.sql. It is NOT the service_role key;
 * never put that one here, it bypasses every policy.
 */
export const SUPABASE_URL = 'https://sqwbpeltdjyjrclrgejp.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxd2JwZWx0ZGp5anJjbHJnZWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTgyOTUsImV4cCI6MjEwMjAzNDI5NX0.5PJZdSoP71mHQLE0jNZxJF2aWgRT5CjvlJ-0iN2jJt4';

/** Nothing works without a database, so the app says so rather than looking broken. */
export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Crockford-style: no 0/O and no 1/I/L to confuse when typed by hand. */
export const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const ID_LENGTH = 4;

/**
 * Rooms are no longer asked for. Nobody filled the field during an actual pack,
 * so the chips were noise on the fastest screen in the app. The database column
 * stays — dropping it is a migration, restoring the UI is a few lines.
 */
export const ROOMS = [];

/** A shelf is not something you carry, so it is not a container. */
export const CONTAINER_KINDS = ['box', 'suitcase', 'crate', 'bag'];

/** Nag for a fresh export after this many days or events, whichever comes first. */
export const BACKUP_NAG_DAYS = 3;
export const BACKUP_NAG_EVENTS = 50;
