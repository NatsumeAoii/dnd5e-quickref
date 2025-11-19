/* eslint-disable default-case */
/* eslint-disable no-console */
const CACHE_NAME = 'dnd5e-quickref-cache-v7';
const CORE_ASSETS = [
  './',
  './index.html',
  './404.html',
  './manifest.json',
  './favicon.ico',
  './css/quickref.css',
  './css/icons.css',
  './js/quickref.js',
  './themes/themes.json',
];

// Normalize scope and root URLs for consistent matching
const scopeUrl = new URL(self.registration.scope);
const ROOT_URL = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;
const INDEX_URL = `${ROOT_URL}index.html`;

let cachingAllowed = false;

/**
 * Clears non-core assets from the cache if user consent is revoked.
 */
async function clearDataCache() {
  console.log('[SW] Clearing data cache (consent revoked).');
  cachingAllowed = false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const deletions = keys.map((request) => {
      const isCore = CORE_ASSETS.some((path) => request.url.endsWith(path.substring(1)));
      return !isCore ? cache.delete(request) : Promise.resolve();
    });
    await Promise.all(deletions);
    console.log('[SW] Non-core cache cleared.');
  } catch (error) {
    console.error('[SW] Failed to clear cache:', error);
  }
}

/**
 * Helper to safely cache a response if allowed.
 */
async function tryCachePut(request, response) {
  if (!cachingAllowed || !response || !response.ok) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (error) {
    // Quota exceeded or storage error; suppress to prevent app breakage
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve())),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (!event.data) return;

  switch (event.data.type) {
    case 'SET_CACHING_POLICY':
      cachingAllowed = !!event.data.allowed;
      console.log(`[SW] Caching policy: ${cachingAllowed}`);
      break;
    case 'CLEAR_CACHE':
      event.waitUntil(clearDataCache());
      break;
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle HTTP/HTTPS GET requests
  if (!url.protocol.startsWith('http') || request.method !== 'GET') {
    return;
  }

  // Strategy: Network First for navigation (HTML), falling back to cache
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request);
        await tryCachePut(request, networkResponse);
        return networkResponse;
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(request))
          || (await cache.match(INDEX_URL))
          || (await cache.match(ROOT_URL))
          || Response.error();
      }
    })());
    return;
  }

  // Strategy: Stale-While-Revalidate for assets/data
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request, { ignoreSearch: true });

    const networkFetch = fetch(request).then(async (response) => {
      await tryCachePut(request, response);
      return response;
    }).catch(() => undefined);

    if (cachedResponse) {
      // Trigger network update in background, return cache immediately
      networkFetch.catch(() => {});
      return cachedResponse;
    }

    const response = await networkFetch;
    return response || Response.error();
  })());
});
