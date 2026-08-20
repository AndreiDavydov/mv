import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp, requireCrewPassword, startServer } from './harness.mjs';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../config.js';

/**
 * The lock, tested from the outside.
 *
 * The point of these is that the gate is not a screen. A locked page that hid
 * a readable database would be worth nothing — anyone can open devtools, and
 * the anon key is printed in a file served from the same site. So the tests
 * that matter here talk to PostgREST directly, with the public key, from a
 * browser that has never signed in, and check that it comes back empty.
 *
 * Its own id block, ZZ7, though it should never manage to write a row.
 */

const P = 'ZZ7';

let server;
let browser;

before(async () => {
  requireCrewPassword();
  server = await startServer();
  browser = await launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

/** A browser that has never signed in — a stranger who scanned a box. */
async function stranger({ hash = '' } = {}) {
  const context = await browser.createBrowserContext();
  const page = await openApp(context, { hash, signedIn: false });
  return { page, context };
}

/** Ask the database directly, with the key that ships in the public site. */
function askAnon(page, path, init = {}) {
  return page.evaluate(async (url, key, p, options) => {
    const response = await fetch(`${url}/rest/v1/${p}`, {
      ...options,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    });
    return { status: response.status, body: await response.text() };
  }, SUPABASE_URL, SUPABASE_ANON_KEY, path, init);
}

test('a stranger who scans a box gets the locked page and no catalog', async () => {
  const { page, context } = await stranger({ hash: '#ZZ72' });
  try {
    await page.waitForSelector('.gate');
    assert.equal(await page.$('#tabbar .tab'), null, 'no tabs before signing in');
    assert.match(await page.$eval('.gate', (el) => el.textContent), /Private catalog/);

    // The scanned code is acknowledged but not resolved — naming the thing
    // would leak exactly what the lock is for.
    const shown = await page.$eval('.gate__head', (el) => el.textContent);
    assert.match(shown, /ZZ72/);
  } finally {
    await context.close();
  }
});

test('the public key reads nothing at all, which is what makes the page honest', async () => {
  const { page, context } = await stranger();
  try {
    const things = await askAnon(page, 'things?select=id&limit=5');
    assert.equal(things.status, 200, 'RLS filters rather than rejecting a select');
    assert.equal(things.body.trim(), '[]', `anon could read things: ${things.body}`);

    const events = await askAnon(page, 'events?select=id&limit=5');
    assert.equal(events.body.trim(), '[]', `anon could read the history: ${events.body}`);
  } finally {
    await context.close();
  }
});

test('the public key cannot write, so nobody can vandalise the move', async () => {
  const { page, context } = await stranger();
  try {
    const insert = await askAnon(page, 'things', {
      method: 'POST',
      body: JSON.stringify({ id: `${P}9`, name: 'intruder' }),
    });
    assert.ok(insert.status >= 400, `anon insert was accepted (${insert.status})`);

    const wipe = await askAnon(page, 'things?id=neq.none', { method: 'DELETE' });
    assert.ok(wipe.status >= 400, `anon delete was accepted (${wipe.status})`);
  } finally {
    await context.close();
  }
});

test('a stranger cannot mint their own account and walk in', async () => {
  // The one thing in this arrangement that is a dashboard checkbox rather than
  // a line of SQL: signups off. With them on, every policy above is decoration
  // — anyone with the public key calls signUp() and becomes `authenticated`.
  const { page, context } = await stranger();
  try {
    const result = await page.evaluate(async () => {
      const { data, error } = await globalThis.app.catalog.raw.auth.signUp({
        email: 'gate-test@moving.invalid',
        password: 'not-the-crew-password',
      });
      return { session: Boolean(data?.session), error: error?.message ?? null };
    });
    assert.equal(
      result.session,
      false,
      'signUp handed out a working session — turn OFF "Allow new users to sign up" ' +
        'in Authentication → Sign In / Providers → Email, and delete the user it just made',
    );
  } finally {
    await context.close();
  }
});

test('the wrong password says so and the page stays locked', async () => {
  const { page, context } = await stranger();
  try {
    await page.waitForSelector('.gate');
    await page.type('.gate__form .field__input', 'Mallory');
    await page.type('.gate__form input[type=password]', 'definitely-not-it');
    await page.click('.gate__form button[type=submit]');

    await page.waitForFunction(() => document.querySelector('.gate__problem')?.textContent.trim());
    assert.match(await page.$eval('.gate__problem', (el) => el.textContent), /not right/);
    assert.ok(await page.$('.gate'), 'still locked');
  } finally {
    await context.close();
  }
});

test('the right password opens it, on the thing that was scanned', async () => {
  const { page, context } = await stranger({ hash: '#ZZ72' });
  try {
    await page.waitForSelector('.gate');
    await page.type('.gate__form .field__input', 'Andrey');
    await page.type('.gate__form input[type=password]', requireCrewPassword());
    await page.click('.gate__form button[type=submit]');

    await page.waitForFunction(() => !document.querySelector('.gate'), { timeout: 30_000 });
    await page.waitForSelector('#tabbar .tab');

    // The scan that brought the browser here is still the address it lands on.
    assert.equal(await page.evaluate(() => location.hash), '#ZZ72');
    assert.equal(await page.evaluate(() => globalThis.app.helper), 'Andrey');

    // And the session is what survives, not the password.
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    assert.ok(!stored.includes(requireCrewPassword()), 'the password must not be stored');
  } finally {
    await context.close();
  }
});

test('signing out puts the lock back', async () => {
  const context = await browser.createBrowserContext();
  try {
    const page = await openApp(context, { hash: '#/backup' });
    await page.waitForSelector('#tabbar .tab');
    await page.evaluate(() => globalThis.app.catalog.raw.auth.signOut());

    const after = await openApp(context, { signedIn: false });
    await after.waitForSelector('.gate');
  } finally {
    await context.close();
  }
});

test('what a helper does is stamped with their name, and cannot be unstamped', async () => {
  const context = await browser.createBrowserContext();
  try {
    const page = await openApp(context);
    await page.evaluate(() => globalThis.app.catalog.raw.from('things').delete().like('id', 'ZZ7%'));
    await page.evaluate(() => globalThis.app.catalog.enroll({ id: 'ZZ73', name: 'Stamped' }));

    const events = await page.evaluate(() =>
      globalThis.app.catalog.events({ thingId: 'ZZ73' }));
    assert.ok(events.length > 0);
    assert.equal(events.at(-1).actor, 'test runner');

    // The log refuses to be rewritten or thinned out — no policy allows it,
    // so this is Postgres saying no, not the app declining to offer a button.
    const edited = await page.evaluate(async () => {
      const db = globalThis.app.catalog.raw;
      const { error: u } = await db.from('events').update({ actor: 'nobody' }).eq('thing_id', 'ZZ73');
      const { error: d } = await db.from('events').delete().eq('thing_id', 'ZZ73');
      const { data } = await db.from('events').select('actor').eq('thing_id', 'ZZ73');
      return { update: u?.message ?? null, delete: d?.message ?? null, left: data };
    });
    assert.ok(edited.left.length > 0, 'the history survived a signed-in delete');
    assert.ok(edited.left.every((e) => e.actor === 'test runner'), 'and was not rewritten');

    await page.evaluate(() => globalThis.app.catalog.raw.from('things').delete().like('id', 'ZZ7%'));
  } finally {
    await context.close();
  }
});
