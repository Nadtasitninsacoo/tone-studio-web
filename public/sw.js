/*
 * Service worker — offline shell, and the second half of installability.
 *
 * ---------------------------------------------------------------------------
 * Network first, cache only as a fallback. Deliberately, and it is the whole design.
 *
 * The obvious service worker precaches the app and serves it from the cache. Do that
 * to a Next.js build and you get the worst bug in the class: a cached HTML document
 * referencing hashed JS chunks that the next deploy replaced, so the page loads,
 * fails to hydrate, and no amount of reloading fixes it because the reload is served
 * from the same cache. The user's only way out is clearing site data — which on this
 * app also throws away their editor draft.
 *
 * So nothing is precached and the network always wins when it answers. The cache is
 * written on the way past and read only when the network fails. The cost is that the
 * first offline load after an install needs one prior online visit to each page; the
 * benefit is that a stale bundle is impossible while there is a connection.
 *
 * What is deliberately never cached:
 *
 * - **`/api/*`** — the tone route is a POST to a model. Caching a non-idempotent
 *   request would be wrong even if it were a GET.
 * - **Anything that is not a GET.** `cache.put` throws on a POST, and swallowing that
 *   would hide a real mistake.
 * - **Range requests** (`Range:` header). Media elements ask for byte ranges, and a
 *   cached 206 partial response replayed as if it were the whole file is how audio
 *   playback breaks in a way that looks like a decoder bug.
 * - **Anything cross-origin.** The recordings API lives on another origin and owns its
 *   own caching; opaque responses cannot be inspected, so caching them means caching
 *   errors as if they were content.
 *
 * The worklets under `/worklets/` are the one thing worth being sure of: they are
 * fetched by `audioWorklet.addModule`, and without them there is no recording, no
 * gate and no limiter. They cache like everything else here — but because they never
 * change name between deploys, a stale one is possible in principle. They are small,
 * versioned with the cache, and dropped whenever `VERSION` moves.
 * ---------------------------------------------------------------------------
 */

/**
 * Bump this on any change to this file, or to fix a bad cached asset in the field.
 * `activate` deletes every cache that is not this one.
 */
const VERSION = 'gr-v1';
const CACHE = `tone-studio-${VERSION}`;

self.addEventListener('install', () => {
  // Nothing to precache, so take over immediately rather than waiting for every tab
  // to close. Safe here precisely because this worker holds no stale copies.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** Requests this worker must not touch. See the header. */
function isCacheable(request) {
  if (request.method !== 'GET') return false;
  if (request.headers.has('range')) return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // A fetch handler has to exist for the app to count as installable, so
  // non-cacheable requests are passed through explicitly rather than by omission.
  if (!isCacheable(request)) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        // Only a real, complete, same-origin success is worth keeping. A 404 cached
        // as a fallback would serve that 404 forever while offline.
        if (response.ok && response.type === 'basic' && response.status === 200) {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;

        // Offline with nothing cached for this URL. For a navigation, fall back to
        // any cached page so the shell still opens — the app's own routing takes
        // over from there. Anything else has to fail, and failing loudly is better
        // than a synthesised empty body a decoder will choke on.
        if (request.mode === 'navigate') {
          const shell = await caches.match('/');
          if (shell) return shell;
        }
        throw error;
      }
    })(),
  );
});
