import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fakeCameraFile, launch, openApp, resetDatabase, root, settle, startServer, state } from './harness.mjs';

/**
 * The whole point of the system, tested end to end with nothing stubbed:
 * a rendered label is played into the browser as a real camera device, the
 * app's own decode loop finds it, and describing the item writes it to the
 * database with its event.
 *
 * Requires the proofs to exist — `npm run proofs`.
 */

let server;
let browser;
let page;

before(async () => {
  server = await startServer();
  const camera = await fakeCameraFile(join(root, 'proofs/label-on-box.png'), 'label-K7M3');
  browser = await launch({ cameraFile: camera });
  page = await openApp(browser);
  await resetDatabase(page);
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test('the camera decodes a printed label and lands on ENROLL', async () => {
  await page.evaluate(() => globalThis.app.go('#/scan'));
  await page.waitForSelector('.viewfinder');

  await page.waitForSelector('.view--enroll', { timeout: 30_000 });
  assert.equal(await page.$eval('.enroll__id code', (el) => el.textContent), 'K7M3');

  const { session } = await state(page);
  assert.equal(session.mode, 'ENROLL');
  assert.equal(session.last_scan_id, 'K7M3', 'the scan came from the camera, not a stub');
});

test('describing it writes the thing and its event to the database', async () => {
  await page.type('.enroll__form .field__input', 'Cast iron pan');
  await page.click('.enroll__actions .btn--primary');
  await page.waitForFunction(() => location.hash === '#K7M3');

  const { things, events } = await state(page);
  assert.equal(things.length, 1);
  assert.deepEqual(
    { id: things[0].id, name: things[0].name, status: things[0].status },
    { id: 'K7M3', name: 'Cast iron pan', status: 'unpacked' },
  );
  assert.deepEqual(events.map((e) => e.type), ['enrolled']);
  assert.equal(events[0].thing_id, 'K7M3');
});

test('scanning the same label again looks it up instead of enrolling twice', async () => {
  await page.evaluate(() => globalThis.app.go('#/tree'));
  await settle(page);
  await page.evaluate(() => globalThis.app.go('#/scan'));

  await page.waitForFunction(() => location.hash === '#K7M3', { timeout: 30_000 });
  assert.equal(await page.$eval('.thing__name', (el) => el.textContent), 'Cast iron pan');
  assert.equal((await state(page)).things.length, 1, 'no duplicate row');
});

test('the same label packs itself into an open container', async () => {
  await page.evaluate(async () => {
    await globalThis.app.catalog.enroll({ id: 'BXAA', name: 'Kitchen Box A', is_container: true });
    await globalThis.app.startPacking('BXAA');
  });
  await page.waitForSelector('.banner--packing');

  await page.waitForFunction(
    async () => (await globalThis.app.catalog.get('K7M3'))?.parent_id === 'BXAA',
    { timeout: 30_000, polling: 250 },
  );

  const { things, events } = await state(page);
  assert.equal(things.find((t) => t.id === 'K7M3').status, 'packed');
  assert.deepEqual(
    events.filter((e) => e.thing_id === 'K7M3').map((e) => e.type),
    ['enrolled', 'packed'],
  );
});
