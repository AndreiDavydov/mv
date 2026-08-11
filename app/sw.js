/**
 * Precaches the whole app shell so the enrol → pack loop works in a cellar with
 * no signal. Nothing in the core loop touches the network at runtime, so the
 * only network-dependent thing here is picking up a new version.
 *
 * Bump CACHE whenever a shell file changes; the old cache is deleted on activate.
 */
const CACHE = 'catalog-v1';

const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './icon.svg',
  './src/ui/app.js',
  './src/ui/dom.js',
  './src/ui/components.js',
  './src/ui/views/scan.js',
  './src/ui/views/enroll.js',
  './src/ui/views/thing.js',
  './src/ui/views/browse.js',
  './src/ui/views/manifest.js',
  './src/ui/views/backup.js',
  './src/core/model.js',
  './src/core/remote.js',
  './src/core/machine.js',
  './src/core/search.js',
  './src/core/backup.js',
  './src/platform/scanner.js',
  './src/platform/feedback.js',
  './src/platform/images.js',
  './src/platform/files.js',
  '../config.js',
  '../shared/ids.js',
  '../shared/payload.js',
  '../shared/qr-svg.js',
  '../vendor/idb.js',
  '../vendor/jsqr.js',
  '../vendor/qrcode.js',
  '../vendor/fflate.js',
  '../vendor/supabase.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll fails the whole install if any single URL 404s; add individually
      // so one stale path cannot leave the app with no cache at all.
      await Promise.all(
        SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  // Cache-first: the shell is versioned by CACHE, and an offline-first app must
  // never wait on a dead network before it can decode a label.
  event.respondWith(
    (async () => {
      const hit = await caches.match(request, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          (await caches.open(CACHE)).put(request, response.clone());
        }
        return response;
      } catch {
        return (await caches.match('./index.html')) ?? Response.error();
      }
    })(),
  );
});
