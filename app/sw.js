/**
 * Tombstone.
 *
 * This app used to cache its shell for offline use. The catalog is shared now —
 * it cannot work without the network — so the cache bought a faster cold start
 * and cost something much worse: a device that opened the site once kept running
 * that build forever, and a fix reached everyone except the person who needed it.
 * That is not a hypothetical; it happened.
 *
 * Deleting sw.js would not have helped: a browser with a registered worker keeps
 * using the one it has. It has to be replaced by a worker that removes itself.
 * This file does that, then reloads the page onto the real, current build.
 *
 * Keep it deployed. Anyone who installed the old version reaches it eventually,
 * and it must still be here when they do.
 */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();

      // Reload every open tab once, now that nothing is intercepting requests.
      // Safe against a loop: the worker is already gone, so the fresh page has
      // nothing to unregister and nothing to reload.
      for (const client of await self.clients.matchAll({ type: 'window' })) {
        client.navigate(client.url).catch(() => {});
      }
    })(),
  );
});

// No fetch handler on purpose: requests go straight to the network.
