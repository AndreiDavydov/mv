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
  const crew = await browser.createBrowserContext();
  const { page, context } = await stranger();
  try {
    const insert = await askAnon(page, 'things', {
      method: 'POST',
      body: JSON.stringify({ id: `${P}9`, name: 'intruder' }),
    });
    assert.ok(insert.status >= 400, `anon insert was accepted (${insert.status})`);

    // A DELETE is not refused — RLS filters the rows it may touch, finds none,
    // and PostgREST honestly reports that it deleted nothing: 204. So the
    // status says nothing useful, and the only question worth asking is
    // whether the row is still there afterwards.
    const inside = await openApp(crew);
    await inside.evaluate(() => globalThis.app.catalog.enroll({ id: 'ZZ78', name: 'Bait' }));

    const wipe = await askAnon(page, 'things?id=neq.none', { method: 'DELETE' });
    const survived = await inside.evaluate(() => globalThis.app.catalog.get('ZZ78'));

    assert.ok(survived, `anon deleted a row (DELETE returned ${wipe.status})`);
    await inside.evaluate(() => globalThis.app.catalog.raw.from('things').delete().like('id', 'ZZ7%'));
  } finally {
    await context.close();
    await crew.close();
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

    // The scan that brought the browser here is picked up where it was left:
    // ZZ72 is not in the catalog, so the app does what it does for any unknown
    // code and opens ENROLL on it. The address moves; the code does not.
    await page.waitForSelector('.view--enroll');
    assert.equal(await page.$eval('.enroll__id code', (el) => el.textContent), 'ZZ72');
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

    // The log refuses to be rewritten or thinned out. Like the anon DELETE
    // above, neither call is *refused* — RLS finds no rows it may touch and
    // reports having changed nothing — so the check is a before-and-after on
    // the log itself. Reserved ids get reused across runs and the log is
    // append-only, so ZZ73 also carries events from months ago; comparing the
    // whole picture is what makes "nothing moved" mean nothing at all moved.
    const before = await page.evaluate(() =>
      globalThis.app.catalog.raw.from('events').select('id,actor').eq('thing_id', 'ZZ73')
        .order('id').then((r) => r.data));

    await page.evaluate(async () => {
      const db = globalThis.app.catalog.raw;
      await db.from('events').update({ actor: 'nobody' }).eq('thing_id', 'ZZ73');
      await db.from('events').delete().eq('thing_id', 'ZZ73');
    });

    const after = await page.evaluate(() =>
      globalThis.app.catalog.raw.from('events').select('id,actor').eq('thing_id', 'ZZ73')
        .order('id').then((r) => r.data));

    assert.deepEqual(after, before, 'a signed-in client changed the history');

    await page.evaluate(() => globalThis.app.catalog.raw.from('things').delete().like('id', 'ZZ7%'));
  } finally {
    await context.close();
  }
});
