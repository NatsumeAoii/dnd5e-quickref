/* eslint-disable no-console */
const CACHE_NAME = 'dnd5e-quickref-cache-v9';
const CORE_ASSETS = [
  './',
  './index.html',
  './404.html',
  './manifest.json',
  './favicon.ico',
  './themes/themes.json',
];

const scopeUrl = new URL(self.registration.scope);
const ROOT_URL = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;
const INDEX_URL = `${ROOT_URL}index.html`;

let cachingAllowed = true;

function isStaticAsset(pathname) {
  return pathname.endsWith('.html')
    || pathname.endsWith('.css')
    || pathname.endsWith('.js')
    || pathname.endsWith('.json')
    || pathname.endsWith('.webp')
    || pathname.endsWith('.png')
    || pathname.endsWith('.svg')
    || pathname.endsWith('.ico')
    || pathname.endsWith('.woff2');
}

function isCoreAsset(pathname) {
  return CORE_ASSETS.some((path) => pathname.endsWith(path.substring(path.startsWith('./') ? 2 : 0)))
    || pathname.includes('/assets/');
}

async function clearDataCache() {
  console.log('[SW] Clearing data cache (consent revoked).');
  cachingAllowed = false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const deletions = keys.map((request) => {
      const url = new URL(request.url);
      return !isCoreAsset(url.pathname) ? cache.delete(request) : Promise.resolve();
    });
    await Promise.all(deletions);
    console.log('[SW] Non-core cache cleared.');
  } catch (error) {
    console.error('[SW] Failed to clear cache:', error);
  }
}

async function tryCachePut(request, response) {
  if (!response || !response.ok) return;

  const url = new URL(request.url);
  const { pathname } = url;

  if (!isCoreAsset(pathname) && !cachingAllowed) return;
  if (!isStaticAsset(pathname) && !isCoreAsset(pathname) && !cachingAllowed) return;

  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (error) {
    console.error('[SW] Failed to cache resource:', error);
  }
}

async function precacheAllContent() {
  console.log('[SW] Pre-caching all content for offline access...');
  try {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url)));

    const dataFiles = ['movement', 'action', 'bonus_action', 'reaction', 'condition', 'environment'];
    const prefixes = ['', '2024_'];
    const dataPromises = [];
    for (const prefix of prefixes) {
      for (const file of dataFiles) {
        dataPromises.push(cache.add(`./js/data/${prefix}data_${file}.json`).catch(() => { }));
      }
    }
    dataPromises.push(cache.add('./themes/themes.json').catch(() => { }));
    await Promise.allSettled(dataPromises);
    console.log('[SW] Pre-caching complete.');
  } catch (error) {
    console.error('[SW] Pre-caching failed:', error);
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
      if (cachingAllowed) event.waitUntil(precacheAllContent());
      break;
    case 'CLEAR_CACHE':
      event.waitUntil(clearDataCache());
      break;
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (!url.protocol.startsWith('http') || request.method !== 'GET') {
    return;
  }

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

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request, { ignoreSearch: true });

    const networkFetch = fetch(request).then(async (response) => {
      await tryCachePut(request, response);
      return response;
    }).catch(() => undefined);

    if (cachedResponse) {
      networkFetch.catch(() => { });
      return cachedResponse;
    }

    const response = await networkFetch;
    return response || Response.error();
  })());
});
