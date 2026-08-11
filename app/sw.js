/**
 * Caches the app shell so a cold open is instant and a flaky connection still
 * renders something.
 *
 * NETWORK-FIRST, deliberately. The catalog is shared and lives on a server, so
 * the app can no longer work offline anyway — and a cache-first shell means a
 * phone that opened the site once keeps running that build forever, which is
 * exactly how a fix reaches everyone except the person who needs it. The cache
 * is the fallback, not the source of truth.
 *
 * Bump CACHE whenever a shell file changes; old caches are deleted on activate.
 */
const CACHE = 'catalog-v2';

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

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          (await caches.open(CACHE)).put(request, response.clone());
        }
        return response;
      } catch {
        // Offline or the server is down: show the last good build rather than
        // a browser error page, so the connection banner can explain itself.
        return (
          (await caches.match(request, { ignoreSearch: true })) ??
          (await caches.match('./index.html')) ??
          Response.error()
        );
      }
    })(),
  );
});
