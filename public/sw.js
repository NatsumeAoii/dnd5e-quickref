const CACHE_VERSION = '1.1.7';
const CACHE_NAME = `dnd5e-quickref-cache-v${CACHE_VERSION}`;
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
const CORE_ASSET_PATHS = new Set(CORE_ASSETS.map((asset) => new URL(asset, scopeUrl).pathname));

let cachingAllowed = false;

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
  return CORE_ASSET_PATHS.has(pathname)
    || pathname === ROOT_URL
    || pathname === INDEX_URL
    || (pathname.startsWith(ROOT_URL) && pathname.includes('/assets/'));
}

async function clearDataCache() {
  cachingAllowed = false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const deletions = keys.map((request) => {
      const url = new URL(request.url);
      return !isCoreAsset(url.pathname) ? cache.delete(request) : Promise.resolve();
    });
    await Promise.all(deletions);
  } catch (error) {
    console.error('[SW] Failed to clear cache:', error);
  }
}

async function tryCachePut(request, response) {
  if (!response || !response.ok) return;

  const url = new URL(request.url);
  const { pathname } = url;
  const isCore = isCoreAsset(pathname);

  if (!isCore && !cachingAllowed) return;
  if (!isCore && !isStaticAsset(pathname)) return;

  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (error) {
    console.error('[SW] Failed to cache resource:', error);
  }
}

async function precacheAllContent() {
  try {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url)));

    const dataFiles = ['movement', 'action', 'bonus_action', 'reaction', 'condition', 'environment'];
    const locales = ['en_US', 'id_ID', 'fr_FR'];
    const prefixes = ['', '2024_'];
    const dataPromises = [];
    for (const locale of locales) {
      dataPromises.push(cache.add(`./data/${locale}/menu.json`));
      for (const prefix of prefixes) {
        for (const file of dataFiles) {
          dataPromises.push(cache.add(`./data/${locale}/rules/${prefix}data_${file}.json`));
        }
      }
    }
    dataPromises.push(cache.add('./themes/themes.json'));
    await Promise.allSettled(dataPromises);
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
      if (cachingAllowed) event.waitUntil(precacheAllContent());
      break;
    case 'CLEAR_CACHE':
      event.waitUntil(clearDataCache());
      break;
    case 'CLAIM':
      event.waitUntil(self.clients.claim());
      break;
  }
});

function isImmutableAsset(pathname) {
  return pathname.includes('/img/') || (pathname.includes('/themes/') && pathname.endsWith('.css'));
}

function getCacheMatchOptions(pathname) {
  return { ignoreSearch: isImmutableAsset(pathname) };
}

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

  // Cache-first for immutable static assets (images, theme CSS) — no background revalidation
  if (isImmutableAsset(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, getCacheMatchOptions(url.pathname));
      if (cached) return cached;
      try {
        const response = await fetch(request);
        await tryCachePut(request, response);
        return response;
      } catch {
        return Response.error();
      }
    })());
    return;
  }

  // Stale-while-revalidate for everything else (JS, CSS bundles, JSON data)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request, getCacheMatchOptions(url.pathname));

    const networkFetch = fetch(request).then(async (response) => {
      await tryCachePut(request, response);
      return response;
    // A failed background refresh should not replace a valid cached response.
    }).catch(() => undefined);

    if (cachedResponse) {
      return cachedResponse;
    }

    const response = await networkFetch;
    return response || Response.error();
  })());
});
