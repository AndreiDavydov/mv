/**
 * The mock scan test, driveable by hand.
 *
 *   npm run demo            opens a real Chrome window whose camera is a video
 *                           of the K7M3 label. The scan happens on its own; you
 *                           type what the thing is and press Save.
 *   npm run demo -- --auto  headless, types the description too, and prints the
 *                           resulting database rows.
 *
 * To scan with your own webcam or phone instead, run `npm run serve` and open
 * http://localhost:8087/app/ — it is the same code path, no fake device.
 */
import { join } from 'node:path';
import { fakeCameraFile, launch, openApp, root, startServer } from '../test/live/harness.mjs';

const auto = process.argv.includes('--auto');
const label = process.argv.find((a) => a.startsWith('--label='))?.split('=')[1] ?? 'label-on-box.png';
const description =
  process.argv.find((a) => a.startsWith('--desc='))?.split('=')[1] ?? 'Cast iron pan';

const server = await startServer();
const camera = await fakeCameraFile(join(root, 'proofs', label), label.replace(/\.\w+$/, ''));
const browser = await launch({ cameraFile: camera, headless: auto });
const page = await openApp(browser);

await page.evaluate(async () => {
  const db = globalThis.app.catalog.raw;
  const tx = db.transaction(['things', 'events', 'session'], 'readwrite');
  await Promise.all([
    tx.objectStore('things').clear(),
    tx.objectStore('events').clear(),
    tx.objectStore('session').clear(),
  ]);
  await tx.done;
  location.hash = '#/scan';
  await globalThis.app.refresh();
});

console.log(`\n  Camera is playing proofs/${label}\n`);

if (!auto) {
  console.log('  Watch it decode, type what the thing is, press Save.');
  console.log('  Ctrl-C here when you are done.\n');
  process.on('SIGINT', async () => {
    await dump();
    await browser.close().catch(() => {});
    server.kill();
    process.exit(0);
  });
} else {
  await page.waitForSelector('.view--enroll', { timeout: 30_000 });
  const id = await page.$eval('.enroll__id code', (el) => el.textContent);
  console.log(`  scanned     ${id}  — unknown code, ENROLL opened by itself`);

  await page.type('.enroll__form .field__input', description);
  await page.click('.enroll__actions .btn--primary');
  await page.waitForFunction(() => location.hash.length > 1);
  console.log(`  described   "${description}"\n`);

  await dump();
  await browser.close();
  server.kill();
}

async function dump() {
  const rows = await page.evaluate(async () => {
    const { catalog } = globalThis.app;
    const things = (await catalog.all()).map(
      ({ photo, thumb, name_lc, container_flag, created_at, updated_at, ...rest }) => ({
        ...rest,
        photo: photo ? `${Math.round(photo.size / 1024)} kB` : null,
        thumb: thumb ? `${Math.round(thumb.size / 1024)} kB` : null,
        updated_at: new Date(updated_at).toISOString().slice(11, 19),
      }),
    );
    const events = (await catalog.events()).map(({ payload, ts, ...rest }) => ({
      ...rest,
      ts: new Date(ts).toISOString().slice(11, 19),
    }));
    return { things, events };
  });

  console.log('  things ------------------------------------------------------');
  console.table(rows.things);
  console.log('  events ------------------------------------------------------');
  console.table(rows.events);
}
