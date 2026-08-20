/**
 * Who is allowed in, and who is doing the work.
 *
 * One account, shared. Everyone helping with the move signs in with the same
 * password, and the account itself is the gate — `anon` was stripped of every
 * privilege in migration 005, so an unauthenticated browser gets nothing from
 * the database, not a hidden version of the app.
 *
 * The name is a separate thing and does not authenticate anybody. It exists so
 * the event log can say who packed a box: the log is append-only in Postgres,
 * so a name written into it is a name that stays. Shared password, unerasable
 * history, individual names — that combination is what makes "who did this?"
 * answerable without giving four people four accounts to manage.
 */
import { CREW_EMAIL } from '../../../config.js';

const NAME_KEY = 'app.helper';

/** Long enough for "Andrey", short enough not to wreck a table cell. */
export const NAME_MAX = 32;

/**
 * Tidy a typed name into what gets stamped on events.
 * @returns {string} '' if there is nothing usable in it
 */
export function cleanName(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

/**
 * Supabase's auth errors are written for developers. These are the two a
 * helper standing in a hallway can actually act on.
 */
export function explain(error) {
  const message = error?.message ?? String(error ?? 'unknown error');
  if (/invalid login credentials/i.test(message)) return 'That password is not right.';
  if (/email logins are disabled|signups not allowed/i.test(message)) {
    return 'The crew account is not set up yet — see supabase/migration-005-auth.sql.';
  }
  if (/failed to fetch|network/i.test(message)) return 'No connection. Try again in a moment.';
  return message;
}

/** The name this device last signed in with, or '' if it never has. */
export function rememberedName() {
  try {
    return cleanName(localStorage.getItem(NAME_KEY));
  } catch {
    return '';
  }
}

function remember(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private browsing. The session still works; the name just gets asked for again.
  }
}

/**
 * The signed-in helper's name, or null if this browser is not signed in.
 *
 * Trusts the stored session rather than a round trip — supabase-js has already
 * validated and refreshed it, and the database has the final say on every
 * request regardless of what this returns.
 */
export async function currentHelper(client) {
  const { data } = await client.auth.getSession();
  if (!data?.session) return null;
  return rememberedName() || 'someone';
}

/**
 * @throws {Error} with a message meant for a human, on a wrong password or no
 *   connection. The name is required: an unattributed log is the thing this
 *   whole arrangement exists to avoid.
 */
export async function signIn(client, { name, password }) {
  const who = cleanName(name);
  if (!who) throw new Error('Put your name in — every change gets stamped with it.');
  if (!password) throw new Error('The password is missing.');

  const { error } = await client.auth.signInWithPassword({
    email: CREW_EMAIL,
    password: String(password),
  });
  if (error) throw new Error(explain(error));

  remember(who);
  return who;
}

/** Ends the session on this device only. Everyone else stays signed in. */
export async function signOut(client) {
  await client.auth.signOut();
}
