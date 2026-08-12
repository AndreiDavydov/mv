import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const run = promisify(execFile);
export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.E2E_PORT ?? 8123);
export const BASE = `http://localhost:${PORT}`;

/**
 * Chrome can be handed a Y4M file as its camera. Pointing that at a rendered
 * label means the scan path under test is the real one — getUserMedia, the
 * decode loop, the cooldown — rather than a function called directly.
 */
export async function fakeCameraFile(png, name) {
  const out = join(root, 'test/live/.media', `${name}.y4m`);
  await mkdir(dirname(out), { recursive: true });

  // Regenerating takes a second, so the file is cached — but only while it is
  // newer than the label it was made from. A stale video silently tests the
  // previous BASE_URL, which is exactly the bug this cache once hid.
  try {
    const [video, source] = await Promise.all([stat(out), stat(png)]);
    if (video.mtimeMs > source.mtimeMs) return out;
  } catch {
    /* missing or unreadable — regenerate */
  }
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-loop', '1', '-i', png,
    '-t', '2',
    // Fill the frame height with the label: the decoder downsamples to 480px,
    // so a label floating in a big frame leaves under two pixels per module.
    '-vf', 'scale=-2:720:flags=lanczos,pad=1280:720:(ow-iw)/2:0:white',
    '-pix_fmt', 'yuv420p',
    '-r', '10',
    out,
  ]);
  return out;
}

export async function startServer() {
  const child = spawn(process.execPath, [join(root, 'tools/serve.mjs'), String(PORT)], {
    stdio: 'ignore',
    detached: false,
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${BASE}/app/`);
      if (response.ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('dev server did not start');
}

export async function launch({ cameraFile, headless = true } = {}) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      ...(cameraFile ? [`--use-file-for-fake-video-capture=${cameraFile}`] : []),
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
    defaultViewport: { width: 430, height: 860, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
}

/** A page with the app booted and a clean database. */
export async function openApp(browser, { hash = '' } = {}) {
  const page = await browser.newPage();
  // Every wait is a network round trip against a hosted database; puppeteer's
  // 30s default is impatience, not a signal.
  page.setDefaultTimeout(60_000);
  page.on('pageerror', (error) => console.error('[page error]', error.message));
  page.on('console', (msg) => msg.type() === 'error' && console.error('[console]', msg.text()));

  await page.goto(`${BASE}/app/${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.app?.catalog, { timeout: 15_000 });
  return page;
}

/**
 * The catalog is shared and live, so tests can never wipe it. Each file owns a
 * block of reserved ids at the end of the space and clears only those, plus the
 * device-local session.
 */
export async function resetDatabase(page, prefix) {
  if (!prefix) throw new Error('resetDatabase needs a reserved id prefix, e.g. ZZ4');

  // The history is append-only and shared — it cannot be wiped, and reusing a
  // reserved id means yesterday's events are still attached to it. Remember
  // where the log had reached so assertions can ignore everything before.
  page.__watermark = await page.evaluate(async () => {
    const { data } = await globalThis.app.catalog.raw
      .from('events').select('id').order('id', { ascending: false }).limit(1);
    return data?.[0]?.id ?? 0;
  });

  await page.evaluate(async (p) => {
    const db = globalThis.app.catalog.raw;
    await db.from('things').update({ parent_id: null }).like('id', `${p}%`);
    await db.from('things').delete().like('id', `${p}%`);
    localStorage.removeItem('catalog.session');
    location.hash = '#/scan';
    await globalThis.app.refresh();
  }, prefix);
}

/** Only the rows this test owns — the catalog has other people's work in it. */
export async function reserved(page, prefix) {
  return page.evaluate(async (p) => {
    const all = await globalThis.app.catalog.all();
    return all.filter((t) => t.id.startsWith(p))
      .map(({ photo, thumb, ...rest }) => ({ ...rest, has_photo: Boolean(photo) }));
  }, prefix);
}

/** Event types this test produced for one thing, oldest first. */
export async function historyOf(page, id) {
  return page.evaluate(async (thingId, since) => {
    const events = await globalThis.app.catalog.events({ thingId });
    return events.filter((e) => e.id > since).map((e) => e.type);
  }, id, page.__watermark ?? 0);
}

/** Feed a code through the same pipeline the camera uses. */
export async function scan(page, text) {
  await page.evaluate((value) => globalThis.app.scan(value), text);
  await settle(page);
}

export async function session(page) {
  return page.evaluate(() => globalThis.app.session);
}

export const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 60)));
export const text = (page, selector) => page.$eval(selector, (el) => el.textContent.trim());
