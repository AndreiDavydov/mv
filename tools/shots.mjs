/**
 * Visual pass over every screen. Not a test — a way to look at the app on a
 * phone-sized viewport without picking up a phone.
 *
 *   npm run shots [-- outdir]
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, openApp, resetDatabase, root, startServer } from '../test/e2e/harness.mjs';

const out = process.argv[2] ?? join(root, 'proofs/screens');
await mkdir(out, { recursive: true });

const server = await startServer();
const browser = await launch();
const page = await openApp(browser);

await resetDatabase(page);

// A small catalog to photograph.
await page.evaluate(async () => {
  const { catalog } = globalThis.app;
  await catalog.enroll({ id: 'CRAT', name: 'Crate 0042', is_container: true, container_kind: 'crate', room: 'Cellar' });
  await catalog.enroll({ id: 'BXAA', name: 'Kitchen Box A', is_container: true, container_kind: 'box', room: 'Kitchen' });
  await catalog.enroll({ id: 'K7M3', name: 'Cast iron pan', room: 'Kitchen', tags: ['heavy'] });
  await catalog.enroll({ id: 'K7M4', name: 'Espresso pot', room: 'Kitchen' });
  await catalog.enroll({ id: 'K7M5', name: 'Chopping board', room: 'Kitchen' });
  await catalog.enroll({ id: 'K7M6' });
  await catalog.enroll({ id: 'K7M7', name: 'Winter coat', room: 'Hallway', notes: 'The grey one' });
  await catalog.packInto('BXAA', 'CRAT');
  for (const id of ['K7M3', 'K7M4', 'K7M5']) await catalog.packInto(id, 'BXAA');
  await globalThis.app.refresh();
});

const shot = async (name, hash, prepare) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.evaluate(() => globalThis.app.refresh());
  await prepare?.(page);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`${name}.png`);
};

await shot('01-scan', '#/scan');
await shot('02-container', '#BXAA');
await shot('03-item', '#K7M3');
await shot('04-tree', '#/tree');
await shot('05-search', '#/search', async (p) => {
  await p.type('.search__input', 'kitchen');
});
await shot('06-unnamed', '#/unnamed');
await shot('07-backup', '#/backup');
await shot('08-manifest', '#/manifest/BXAA');

// Packing mode, then an enrolment inside it.
await page.evaluate(() => globalThis.app.startPacking('BXAA'));
await shot('09-packing', '#/scan');
await page.evaluate(() => globalThis.app.scan('K7MP'));
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: join(out, '10-enroll.png') });
console.log('10-enroll.png');

await browser.close();
server.kill();
