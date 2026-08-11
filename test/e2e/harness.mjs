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
  const out = join(root, 'test/e2e/.media', `${name}.y4m`);
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
  page.on('pageerror', (error) => console.error('[page error]', error.message));
  page.on('console', (msg) => msg.type() === 'error' && console.error('[console]', msg.text()));

  await page.goto(`${BASE}/app/${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.app?.catalog, { timeout: 15_000 });
  return page;
}

export async function resetDatabase(page) {
  await page.evaluate(async () => {
    const db = globalThis.app.catalog.raw;
    const tx = db.transaction(['things', 'events', 'session', 'meta'], 'readwrite');
    await Promise.all([
      tx.objectStore('things').clear(),
      tx.objectStore('events').clear(),
      tx.objectStore('session').clear(),
      tx.objectStore('meta').clear(),
    ]);
    await tx.done;
    location.hash = '#/scan';
    await globalThis.app.refresh();
  });
}

/** Feed a code through the same pipeline the camera uses. */
export async function scan(page, text) {
  await page.evaluate((value) => globalThis.app.scan(value), text);
  await settle(page);
}

export async function state(page) {
  return page.evaluate(async () => {
    const { catalog } = globalThis.app;
    const [things, events, session] = await Promise.all([
      catalog.all(),
      catalog.events(),
      catalog.session(),
    ]);
    return {
      things: things.map(({ photo, thumb, ...rest }) => ({ ...rest, has_photo: Boolean(photo) })),
      events: events.map(({ payload, ...rest }) => ({ ...rest, group: payload?.group ?? null })),
      session,
      hash: location.hash,
    };
  });
}

export const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 60)));
export const text = (page, selector) => page.$eval(selector, (el) => el.textContent.trim());
