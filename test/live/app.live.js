import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, historyOf, launch, openApp, reserved, resetDatabase, session, startServer } from './harness.mjs';
import { buildPayload } from '../../shared/payload.js';

/**
 * What genuinely needs a browser.
 *
 * The rules — the scan state machine, undo selection, search ranking, id
 * handling — are covered deterministically in `npm test`, in milliseconds, with
 * no network. The data layer is covered in `remote.live.js`. What is left, and
 * only testable here, is the wiring: routing, mounting, and the screens
 * agreeing with the address bar while writes are in flight.
 *
 * Each test owns its own ids rather than resetting between tests: the catalog
 * is shared, every reset is a network round trip, and a suite that takes half an
 * hour is a suite nobody runs. Nothing here touches a row it did not create.
 */

const P = 'ZZ4';

let server;
let browser;
let page;

before(async () => {
  server = await startServer();
  browser = await launch();
  page = await openApp(browser);
  await resetDatabase(page, P);
});

after(async () => {
  await resetDatabase(page, P).catch(() => {});
  await browser?.close();
  server?.kill();
});

/** Enrol through the UI and wait for the row, not for a guessed delay. */
async function enrol(id, name, { container = false } = {}) {
  await page.evaluate((code) => globalThis.app.scan(code, { source: 'manual' }), id);
  await page.waitForSelector('.view--enroll');
  if (container) await page.click('.enroll__form .toggle input');
  if (name) await page.type('.enroll__form .field__input', name);
  await page.click('.enroll__actions .btn--primary');
  // The row appears part-way through the save; waiting for it and carrying on
  // fires the next scan while the app is still finishing. Wait for the screen
  // to leave ENROLL — that is what "saved" actually looks like.
  await page.waitForFunction(() => !document.querySelector('.view--enroll'));
  await page.waitForFunction(
    async (code) => Boolean(await globalThis.app.catalog.get(code)),
    { polling: 150 }, id,
  );
}

const goto = async (hash) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.evaluate(() => globalThis.app.refresh());
};

test('the app opens on the scanner with the expected tabs', async () => {
  assert.ok(await page.$('.view--scan'));
  assert.deepEqual(
    await page.$$eval('.tab__label', (n) => n.map((x) => x.textContent)),
    ['Scan', 'Search', 'Catalog', 'Unnamed', 'Backup'],
  );
});

test('an unknown code routes to ENROLL, and the address agrees', async () => {
  await page.evaluate(() => globalThis.app.scan('ZZ42', { source: 'manual' }));
  await page.waitForSelector('.view--enroll');

  assert.equal(await page.$eval('.enroll__id code', (el) => el.textContent), 'ZZ42');
  assert.equal((await session(page)).mode, 'ENROLL');
  // Regression: ENROLL used to be mounted without navigating, so any route that
  // finished afterwards painted the scanner over the code just scanned.
  assert.equal(await page.evaluate(() => location.hash), '#/enroll');
});

test('ENROLL survives a route that lands while it is open', async () => {
  await page.evaluate(() => globalThis.app.scan('ZZ43', { source: 'manual' }));
  await page.waitForSelector('.view--enroll');

  // Exactly the race that used to lose the scan: refreshes in flight while the
  // person is still typing — on a shared catalog, someone else's write causes
  // them.
  await page.evaluate(() => {
    globalThis.app.refresh();
    globalThis.app.refresh();
  });
  await new Promise((r) => setTimeout(r, 1200));

  assert.ok(await page.$('.view--enroll'), 'still on ENROLL');
  assert.equal(await page.$eval('.enroll__id code', (el) => el.textContent), 'ZZ43');
});

test('describing an item writes it, with its event, and shows it', async () => {
  await enrol('ZZ44', 'Cast iron pan ZZ44');
  await page.waitForSelector('.thing__name');

  const [thing] = await reserved(page, 'ZZ44');
  assert.equal(thing.name, 'Cast iron pan ZZ44');
  assert.equal(thing.status, 'unpacked');
  assert.deepEqual(await historyOf(page, 'ZZ44'), ['enrolled']);
});

test('a URL payload, a typed code and a cold #ID all reach the same thing', async () => {
  await enrol('ZZ45', 'Winter coat ZZ45');

  await page.evaluate((text) => globalThis.app.scan(text, { source: 'camera' }), buildPayload('ZZ45'));
  await page.waitForSelector('.thing__name');
  assert.equal(await page.$eval('.thing__name', (el) => el.textContent), 'Winter coat ZZ45');

  await goto('#/scan');
  await page.waitForSelector('.scan__input');
  await page.type('.scan__input', 'zz45');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.thing__name');
  assert.equal(await page.$eval('.thing__name', (el) => el.textContent), 'Winter coat ZZ45');

  // The phone-camera path: a cold load with only the fragment to go on.
  await page.goto(`${BASE}/app/#ZZ45`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.app?.catalog);
  await page.waitForSelector('.thing__name');
  assert.equal(await page.$eval('.thing__name', (el) => el.textContent), 'Winter coat ZZ45');
});

test('a foreign QR is refused rather than looked up', async () => {
  await page.evaluate(() => globalThis.app.scan('https://example.com/#K7M3', { source: 'camera' }));
  await page.waitForSelector('.toast--bad');
  assert.match(await page.$eval('.toast--bad', (el) => el.textContent), /not one of ours/);
});

test('packing: the pick-list packs without a scan, and offers undo for that action', async () => {
  await enrol('ZZ4B', 'Pack box ZZ4B', { container: true });
  await enrol('ZZ46', 'Chopping board ZZ46');

  await page.evaluate(() => globalThis.app.startPacking('ZZ4B'));
  await page.waitForSelector('.pick__list .row');

  await page.evaluate(() => {
    [...document.querySelectorAll('.pick__list .row')]
      .find((r) => r.querySelector('.row__id').textContent === 'ZZ46')
      .click();
  });
  await page.waitForFunction(
    async () => (await globalThis.app.catalog.get('ZZ46'))?.parent_id === 'ZZ4B',
    { polling: 150 },
  );

  assert.deepEqual(await historyOf(page, 'ZZ46'), ['enrolled', 'packed']);
  assert.ok(await page.$('.toast__action'), 'undo offered for the pack just made');
  assert.ok(await page.$('.pick'), 'the list refreshed in place rather than rebuilding the screen');
  assert.ok(await page.$('.view--scan'), 'and the viewfinder stayed put');
});

test('packing: an unknown code enrols straight into the open box', async () => {
  await page.evaluate(() => globalThis.app.startPacking('ZZ4B'));
  await page.waitForSelector('.pick');

  await page.evaluate(() => globalThis.app.scan('ZZ47', { source: 'camera' }));
  await page.waitForSelector('.view--enroll');
  await page.type('.enroll__form .field__input', 'Packed on scan ZZ47');
  await page.click('.enroll__actions .btn--primary');

  await page.waitForFunction(
    async () => (await globalThis.app.catalog.get('ZZ47'))?.parent_id === 'ZZ4B',
    { polling: 150 },
  );
  await page.waitForSelector('.view--scan');
  assert.equal((await session(page)).mode, 'PACKING', 'and packing continues');
});

test('the packing session survives a reload', async () => {
  await page.evaluate(() => globalThis.app.startPacking('ZZ4B'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.app?.catalog);
  await page.waitForSelector('.banner--packing');

  assert.match(await page.$eval('.banner--packing b', (el) => el.textContent), /Pack box ZZ4B/);
  assert.equal((await session(page)).mode, 'PACKING');
});

test('a thing marked gone is tagged, and not offered for packing', async () => {
  await enrol('ZZ48', 'Old lamp ZZ48');
  await page.evaluate(() => globalThis.app.catalog.markGone('ZZ48'));

  await goto('#/tree');
  await page.waitForSelector('.tree');
  assert.ok(await page.$('.tag--gone'), 'gone items are tagged in the catalog');

  await page.evaluate(() => globalThis.app.startPacking('ZZ4B'));
  await page.waitForSelector('.pick');
  const offered = await page.$$eval('.pick__list .row__id', (n) => n.map((x) => x.textContent));
  assert.ok(!offered.includes('ZZ48'));
});

test('losing the network fails loudly instead of pretending to save', async () => {
  await page.evaluate(() => globalThis.app.stopPacking());
  await page.setOfflineMode(true);
  try {
    await page.evaluate(() => globalThis.app.scan('ZZ49', { source: 'manual' })).catch(() => {});
    await page.waitForSelector('.toast--bad, .banner--offline');
  } finally {
    await page.setOfflineMode(false);
    await page.evaluate(() => globalThis.app.checkConnection());
  }
});
