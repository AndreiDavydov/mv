import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, launch, openApp, resetDatabase, startServer, state } from './harness.mjs';
import { buildPayload } from '../../shared/payload.js';

let server;
let browser;
let page;

before(async () => {
  server = await startServer();
  browser = await launch();
  page = await openApp(browser);
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test('the app boots straight into the scanner', async () => {
  await resetDatabase(page);
  assert.ok(await page.$('.view--scan'), 'the scan view should be the home screen');
  assert.ok(await page.$('#tabbar .tab'), 'the tab bar should render');
});

test('the database is real IndexedDB with the expected shape', async () => {
  const stores = await page.evaluate(() => [...globalThis.app.catalog.raw.objectStoreNames]);
  assert.deepEqual(stores.sort(), ['events', 'meta', 'session', 'things']);
});

test('an unknown code opens ENROLL with the code already claimed', async () => {
  await resetDatabase(page);
  await page.evaluate(() => globalThis.app.scan('K7M3'));
  await page.waitForSelector('.view--enroll');

  assert.equal(await page.$eval('.enroll__id code', (el) => el.textContent), 'K7M3');
  assert.equal((await state(page)).session.mode, 'ENROLL');
});

test('a name typed into ENROLL is written to the database with an event', async () => {
  await resetDatabase(page);
  await page.evaluate(() => globalThis.app.scan('K7M3'));
  await page.waitForSelector('.view--enroll');

  await page.type('.enroll__form .field__input', 'Cast iron pan');
  await page.click('.enroll__actions .btn--primary');
  await page.waitForFunction(() => location.hash === '#K7M3');

  const { things, events } = await state(page);
  assert.equal(things.length, 1);
  assert.equal(things[0].id, 'K7M3');
  assert.equal(things[0].name, 'Cast iron pan');
  assert.equal(things[0].status, 'unpacked');
  assert.deepEqual(events.map((e) => e.type), ['enrolled']);
});

test('a scanned URL payload resolves to the same thing as the bare code', async () => {
  await resetDatabase(page);
  await page.evaluate(() => globalThis.app.catalog.enroll({ id: 'K7M3', name: 'Pan' }));

  // Built from the live config, so changing BASE_URL cannot leave this passing
  // against a URL no longer printed on anything.
  const payload = buildPayload('K7M3');
  assert.match(payload, /#K7M3$/);

  await page.evaluate((text) => globalThis.app.scan(text), payload);
  await page.waitForFunction(() => location.hash === '#K7M3');
  assert.equal(await page.$eval('.thing__name', (el) => el.textContent), 'Pan');
});

test('typing a code by hand lands in the same place as scanning it', async () => {
  await resetDatabase(page);
  await page.evaluate(() => globalThis.app.catalog.enroll({ id: 'K7M3', name: 'Pan' }));
  await page.evaluate(() => globalThis.app.refresh());

  await page.type('.scan__input', 'k7m3');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.hash === '#K7M3');
  assert.equal(await page.$eval('.thing__name', (el) => el.textContent), 'Pan');
});

/**
 * The stock-camera path: the phone opens the URL cold, with only the fragment
 * to go on. No in-app scanner is involved, so this has to work on its own.
 */
test('opening #ID cold on an unknown code lands on ENROLL', async () => {
  await resetDatabase(page);
  await page.goto(`${BASE}/app/#K7M3`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.app?.catalog);

  await page.waitForSelector('.view--enroll');
  assert.equal(await page.$eval('.enroll__id code', (el) => el.textContent), 'K7M3');
});

test('opening #ID cold on a known code shows the thing', async () => {
  await resetDatabase(page);
  await page.evaluate(() => globalThis.app.catalog.enroll({ id: 'K7M3', name: 'Cast iron pan' }));

  await page.goto(`${BASE}/app/#K7M3`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.app?.catalog);

  await page.waitForSelector('.thing__name');
  assert.equal(await page.$eval('.thing__name', (el) => el.textContent), 'Cast iron pan');
});

test('a lowercase fragment resolves — a QR may be scanned from any casing', async () => {
  await resetDatabase(page);
  await page.evaluate(() => globalThis.app.catalog.enroll({ id: 'K7M3', name: 'Cast iron pan' }));

  await page.goto(`${BASE}/app/#k7m3`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.app?.catalog);

  await page.waitForSelector('.thing__name');
  assert.equal(await page.$eval('.thing__name', (el) => el.textContent), 'Cast iron pan');
});

test('a foreign QR is refused rather than looked up', async () => {
  await resetDatabase(page);
  await page.evaluate(() => globalThis.app.scan('https://example.com/#K7M3'));
  await page.waitForSelector('.toast--bad');
  assert.match(await page.$eval('.toast--bad', (el) => el.textContent), /not one of ours/);
  assert.equal((await state(page)).things.length, 0);
});
