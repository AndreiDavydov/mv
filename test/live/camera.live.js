import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fakeCameraFile, historyOf, launch, openApp, reserved, resetDatabase, root, session, settle, startServer } from './harness.mjs';

/**
 * The whole system, with nothing stubbed: a rendered label is played into the
 * browser as a real camera device, the app's own decode loop finds it, and
 * describing the item writes it to the shared database.
 *
 * The label carries a reserved id (`ZZ52`) rather than the one on
 * `label-on-box.png` — that one is a real catalogued box, and a test must not
 * touch somebody's move. Regenerate with:
 *   npm run proofs -- --no-sheet --crop=ZZ52 --out=label-test-ZZ52
 */

const P = 'ZZ5';
const ID = 'ZZ52';

let server;
let browser;
let page;

before(async () => {
  server = await startServer();
  const camera = await fakeCameraFile(join(root, 'proofs/label-test-ZZ52.png'), 'label-ZZ52');
  browser = await launch({ cameraFile: camera });
  page = await openApp(browser);
  await resetDatabase(page, P);
});

after(async () => {
  await resetDatabase(page, P).catch(() => {});
  await browser?.close();
  server?.kill();
});

test('the camera decodes a printed label and opens ENROLL', async () => {
  await page.evaluate(() => globalThis.app.go('#/scan'));
  await page.waitForSelector('.viewfinder');
  await page.waitForSelector('.view--enroll', { timeout: 30_000 });

  assert.equal(await page.$eval('.enroll__id code', (el) => el.textContent), ID);
  assert.equal((await session(page)).last_scan_id, ID, 'the scan came from the camera, not a stub');
});

test('describing it writes the thing and its event to the shared database', async () => {
  await page.type('.enroll__form .field__input', 'Cast iron pan');
  await page.click('.enroll__actions .btn--primary');
  await page.waitForFunction((id) => location.hash === `#${id}`, {}, ID);

  const [thing] = await reserved(page, ID);
  assert.equal(thing.name, 'Cast iron pan');
  assert.equal(thing.status, 'unpacked');
  assert.deepEqual(await historyOf(page, ID), ['enrolled']);
});

test('scanning the same label again looks it up instead of enrolling twice', async () => {
  await page.evaluate(() => globalThis.app.go('#/tree'));
  await settle(page);
  await page.evaluate(() => globalThis.app.go('#/scan'));

  await page.waitForFunction((id) => location.hash === `#${id}`, { timeout: 30_000 }, ID);
  await page.waitForSelector('.thing__name');
  assert.equal(await page.$eval('.thing__name', (el) => el.textContent), 'Cast iron pan');
  assert.equal((await reserved(page, ID)).length, 1, 'no duplicate row');
});

test('the same label packs itself into an open container', async () => {
  await page.evaluate(async () => {
    await globalThis.app.catalog.enroll({ id: 'ZZ5A', name: 'Kitchen Box A', is_container: true });
    await globalThis.app.startPacking('ZZ5A');
  });
  await page.waitForSelector('.banner--packing');

  await page.waitForFunction(
    async (id) => (await globalThis.app.catalog.get(id))?.parent_id === 'ZZ5A',
    { timeout: 30_000, polling: 250 }, ID,
  );

  const [thing] = await reserved(page, ID);
  assert.equal(thing.status, 'packed');
  assert.deepEqual(await historyOf(page, ID), ['enrolled', 'packed']);
});
