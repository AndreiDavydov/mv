import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, launch, openCatalog, signIn, startServer } from './harness.mjs';

/**
 * The requirement, tested the way it will actually be used: two browsers open
 * on the same catalog. One of them scans; the other must show it without being
 * touched.
 *
 * "Phone" and "laptop" here are two independent browser contexts — separate
 * storage, separate sockets, no shared memory. The only thing joining them is
 * the database.
 */

let server;
let browser;
let phone;
let laptop;
let catalog;

before(async () => {
  server = await startServer();
  browser = await launch();
  catalog = await openCatalog();

  // Separate browser contexts, so neither can read the other's storage. The
  // only thing joining these two screens is the database.
  phone = await openIsolated();
  laptop = await openIsolated();
});

async function openIsolated() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on('pageerror', (error) => console.error('[page error]', error.message));
  await page.goto(`${BASE}/app/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.app?.catalog, { timeout: 20_000 });
  await signIn(page);
  return page;
}

after(async () => {
  await wipe();
  catalog?.close();
  await browser?.close();
  server?.kill();
});

beforeEach(() => wipe());

/** Each live file owns a block of reserved ids, so two files cannot collide. */
async function wipe() {
  const db = catalog.raw;
  await db.from('things').update({ parent_id: null, status: 'unpacked' }).like('id', 'ZZ3%');
  await db.from('things').delete().like('id', 'ZZ3%');
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

test('a scan on one device appears on the other without a reload', async () => {
  await laptop.evaluate(() => (location.hash = '#/tree'));
  await laptop.evaluate(() => globalThis.app.refresh());
  await settle(300);

  // The phone enrols, exactly as the stock-camera deep link does.
  await phone.evaluate(() => (location.hash = '#ZZ32'));
  await phone.waitForSelector('.view--enroll', { timeout: 15_000 });
  await phone.type('.enroll__form .field__input', 'Phone wrote this');
  await phone.click('.enroll__actions .btn--primary');
  await phone.waitForFunction(() => location.hash === '#ZZ32', { timeout: 15_000 });

  // Nobody touches the laptop. Realtime has to do the work.
  await laptop.waitForFunction(
    () => document.body.textContent.includes('Phone wrote this'),
    { timeout: 20_000, polling: 300 },
  );

  const shown = await laptop.$$eval('.tree__id', (nodes) => nodes.map((n) => n.textContent));
  assert.ok(shown.includes('ZZ32'), `laptop tree showed ${JSON.stringify(shown)}`);
});

test('no catalog is kept on the scanning device — only the sign-in', async () => {
  await phone.evaluate(() => (location.hash = '#ZZ33'));
  await phone.waitForSelector('.view--enroll', { timeout: 15_000 });
  await phone.type('.enroll__form .field__input', 'Kettle');
  await phone.click('.enroll__actions .btn--primary');
  await phone.waitForFunction(() => location.hash === '#ZZ33', { timeout: 15_000 });

  const local = await phone.evaluate(async () => ({
    databases: (await indexedDB.databases?.())?.map((d) => d.name) ?? [],
    localStorage: Object.keys(localStorage),
    stored: JSON.stringify(localStorage),
  }));

  assert.deepEqual(local.databases, [], 'the phone must not keep a local catalog');

  // Four things may live here and no more: which box this person is packing
  // into, their name, the mute setting, and the session that gets them past
  // the locked page. None of them is catalog data, and none is the password.
  const allowed = /^(catalog\.session|app\.helper|app\.muted|sb-.*-auth-token)$/;
  assert.ok(
    local.localStorage.every((k) => allowed.test(k)),
    `unexpected local storage: ${JSON.stringify(local.localStorage)}`,
  );
  assert.ok(!local.stored.includes('Kettle'), 'no catalog contents on the device');

  // And the row really is on the server.
  assert.equal((await catalog.get('ZZ33'))?.name, 'Kettle');
});

test('a pack on the phone updates the box open on the laptop', async () => {
  await catalog.enroll({ id: 'ZZ3A', name: 'Box A', is_container: true });
  await catalog.enroll({ id: 'ZZ34', name: 'Frying pan' });

  await laptop.evaluate(() => (location.hash = '#ZZ3A'));
  await laptop.evaluate(() => globalThis.app.refresh());
  await laptop.waitForSelector('.contents', { timeout: 15_000 });
  assert.equal((await laptop.$$('.contents .card')).length, 0, 'box starts empty on screen');

  await phone.evaluate(async () => {
    await globalThis.app.startPacking('ZZ3A');
    await globalThis.app.scan('ZZ34', { source: 'camera' });
  });

  await laptop.waitForFunction(
    () => document.querySelectorAll('.contents .card').length === 1,
    { timeout: 20_000, polling: 300 },
  );
  const name = await laptop.$eval('.contents .card__name', (n) => n.textContent);
  assert.equal(name, 'Frying pan');
});

test('an already-described item shows its details instead of prompting', async () => {
  await catalog.enroll({ id: 'ZZ35', name: 'Winter coat', room: 'Hallway' });

  await phone.evaluate(() => (location.hash = '#ZZ35'));
  await phone.waitForSelector('.thing__name', { timeout: 15_000 });

  assert.equal(await phone.$eval('.thing__name', (n) => n.textContent), 'Winter coat');
  assert.equal(await phone.$('.view--enroll'), null, 'a named item must not ask again');
});
