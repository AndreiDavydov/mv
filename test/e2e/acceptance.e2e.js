import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp, resetDatabase, scan, settle, startServer, state } from './harness.mjs';

/**
 * The acceptance list from the handover, run against a real browser: real
 * IndexedDB, real service worker, real hash routing.
 */

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

beforeEach(() => resetDatabase(page));

/** Enrol via the UI, the way a person does it. */
async function enrol(id, name, { container = false } = {}) {
  await page.evaluate((code) => globalThis.app.scan(code), id);
  await page.waitForSelector('.view--enroll');
  if (container) await page.click('.enroll__form .toggle input');
  if (name) await page.type('.enroll__form .field__input', name);
  await page.click('.enroll__actions .btn--primary');
  await settle(page);
}

test('enrol ten unknown items, one after another', async () => {
  const ids = ['2222', '2223', '2224', '2225', '2226', '2227', '2228', '2229', '222A', '222B'];
  for (const [index, id] of ids.entries()) await enrol(id, `Thing ${index}`);

  const { things, events } = await state(page);
  assert.equal(things.length, 10);
  assert.equal(events.filter((e) => e.type === 'enrolled').length, 10);
  assert.deepEqual(things.map((t) => t.id).sort(), [...ids].sort());
});

test('enter PACKING on a box, scan five items, scan the box — all five are inside', async () => {
  await enrol('BXAA', 'Kitchen Box A', { container: true });
  await page.evaluate(() => (location.hash = '#BXAA'));
  await page.waitForSelector('.thing__actions');
  await page.click('.thing__actions .btn--primary'); // Pack into this
  await settle(page);

  assert.equal((await state(page)).session.mode, 'PACKING');

  const items = ['K7M3', 'K7M4', 'K7M5', 'K7M6', 'K7M7'];
  for (const [index, id] of items.entries()) {
    await page.evaluate((code) => globalThis.app.scan(code), id);
    await page.waitForSelector('.view--enroll');
    await page.type('.enroll__form .field__input', `Item ${index}`);
    await page.click('.enroll__actions .btn--primary');
    await settle(page);
    // Enrolling inside PACKING must come straight back to the viewfinder.
    await page.waitForSelector('.view--scan');
  }

  await scan(page, 'BXAA');
  await page.waitForFunction(() => location.hash === '#BXAA');

  const contents = await page.$$eval('.contents .card__id', (nodes) => nodes.map((n) => n.textContent));
  assert.deepEqual(contents.sort(), [...items].sort());
  assert.equal((await state(page)).session.mode, 'PACKING', 'peeking at the target stays in PACKING');
});

test('scanning an item already in box A while packing box B moves it silently', async () => {
  await enrol('BXAA', 'Box A', { container: true });
  await enrol('BXBB', 'Box B', { container: true });
  await enrol('K7M3', 'Pan');

  await page.evaluate(() => globalThis.app.startPacking('BXAA'));
  await scan(page, 'K7M3');
  await page.evaluate(() => globalThis.app.startPacking('BXBB'));
  await scan(page, 'K7M3');

  const { things, events } = await state(page);
  assert.equal(things.find((t) => t.id === 'K7M3').parent_id, 'BXBB');
  assert.deepEqual(
    events.filter((e) => e.thing_id === 'K7M3').map((e) => e.type),
    ['enrolled', 'packed', 'unpacked', 'packed'],
  );
  assert.equal(await page.$('.sheet-backdrop'), null, 'no dialog may appear for a move');
});

test('scanning a different container is the one case that asks', async () => {
  await enrol('BXAA', 'Box A', { container: true });
  await enrol('BXBB', 'Box B', { container: true });
  await page.evaluate(() => globalThis.app.startPacking('BXAA'));

  await scan(page, 'BXBB');
  await page.waitForSelector('.sheet-backdrop');
  assert.match(await page.$eval('.sheet__title', (el) => el.textContent), /Switch to packing into Box B/);

  await page.click('.sheet .btn--primary');
  await settle(page);
  assert.equal((await state(page)).session.target_id, 'BXBB');
});

test('undo reverses the last pack', async () => {
  await enrol('BXAA', 'Box A', { container: true });
  await enrol('K7M3', 'Pan');
  await page.evaluate(() => globalThis.app.startPacking('BXAA'));
  await scan(page, 'K7M3');

  assert.equal((await state(page)).things.find((t) => t.id === 'K7M3').parent_id, 'BXAA');

  await page.click('.tab--undo');
  await settle(page);

  const { things } = await state(page);
  assert.equal(things.find((t) => t.id === 'K7M3').parent_id, null);
  assert.equal(things.find((t) => t.id === 'K7M3').status, 'unpacked');
});

test('the session survives a reload — dropping the phone mid-pack costs nothing', async () => {
  await enrol('BXAA', 'Kitchen Box A', { container: true });
  await page.evaluate(() => globalThis.app.startPacking('BXAA'));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.app?.catalog);
  await page.waitForSelector('.banner--packing');

  const banner = await page.$eval('.banner--packing b', (el) => el.textContent);
  assert.match(banner, /Kitchen Box A/);
  assert.equal((await state(page)).session.mode, 'PACKING');
});

test('losing the network fails loudly instead of pretending to save', async () => {
  // The catalog is shared, so there is no offline mode. The one thing that
  // must never happen is a scan that looks saved and is not.
  await page.setOfflineMode(true);
  try {
    await page.evaluate(() => globalThis.app.scan('K7M3', { source: 'manual' })).catch(() => {});
    await page.waitForSelector('.toast--bad, .banner--offline', { timeout: 15_000 });
  } finally {
    await page.setOfflineMode(false);
  }
});

test('export then wipe then import restores the catalog intact', async () => {
  await enrol('BXAA', 'Box A', { container: true });
  await enrol('K7M3', 'Pan');
  await page.evaluate(() => globalThis.app.catalog.packInto('K7M3', 'BXAA'));

  const restored = await page.evaluate(async () => {
    const { buildBundle, readBundle, restore } = await import('./src/platform/files.js');
    const { derivePhotos } = await import('./src/platform/images.js');
    const { catalog } = globalThis.app;

    const bundle = await buildBundle(catalog);
    const file = new File([bundle.blob], bundle.filename, { type: 'application/zip' });

    // Wipe exactly the way clearing site data would.
    const tx = catalog.raw.transaction(['things', 'events'], 'readwrite');
    await Promise.all([tx.objectStore('things').clear(), tx.objectStore('events').clear()]);
    await tx.done;

    await restore(catalog, await readBundle(file), { derivePhotos });
    return {
      filename: bundle.filename,
      things: await catalog.all(),
      events: await catalog.events(),
    };
  });

  assert.match(restored.filename, /^catalog-\d{8}-\d{4}\.zip$/);
  assert.equal(restored.things.length, 2);
  assert.equal(restored.events.length, 3);
  assert.equal(restored.things.find((t) => t.id === 'K7M3').parent_id, 'BXAA');
  assert.equal(restored.things.find((t) => t.id === 'BXAA').is_container, true);
});

test('a repeat read inside the cooldown does not double-pack', async () => {
  await enrol('BXAA', 'Box A', { container: true });
  await enrol('K7M3', 'Pan');
  await page.evaluate(() => globalThis.app.startPacking('BXAA'));

  await page.evaluate(async () => {
    for (let i = 0; i < 30; i++) await globalThis.app.scan('K7M3');
  });
  await settle(page);

  const { events } = await state(page);
  assert.equal(events.filter((e) => e.thing_id === 'K7M3' && e.type === 'packed').length, 1);
});
