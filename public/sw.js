const CACHE_VERSION = '1.3.0';
const CACHE_NAME = `dnd5e-quickref-cache-v${CACHE_VERSION}`;
const STAGING_CACHE_NAME = `${CACHE_NAME}-staging`;
const METADATA_URL = './__cache_metadata__';
const CACHE_PREFIX = 'dnd5e-quickref-cache-';
const SUPPORTED_LOCALES = new Set(['en_US', 'id_ID', 'fr_FR']);
const SUPPORTED_RULESETS = new Set(['2014', '2024']);
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
let activeCacheContext = null;
let lastSuccessfulCacheAt = null;
let cacheSizeBytes = 0;

function reportStatus(status, extra = {}) {
  if (!self.clients || typeof self.clients.matchAll !== 'function') return;
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => client.postMessage({ type: 'CACHE_STATUS', status, lastSuccessfulCacheAt, totalBytes: cacheSizeBytes, ...extra }));
  }).catch(() => undefined);
}

async function saveMetadata(cache, metadata) {
  await cache.put(METADATA_URL, new Response(JSON.stringify(metadata), { headers: { 'content-type': 'application/json' } }));
}

async function loadMetadata() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(METADATA_URL);
    const metadata = response ? await response.json() : {};
    lastSuccessfulCacheAt = typeof metadata.lastSuccessfulCacheAt === 'string' ? metadata.lastSuccessfulCacheAt : null;
    cacheSizeBytes = Number.isFinite(metadata.totalBytes) ? metadata.totalBytes : 0;
  } catch { /* metadata is optional */ }
}

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

async function clearDataCache(requestId = null) {
  cachingAllowed = false;
  lastSuccessfulCacheAt = null;
  cacheSizeBytes = 0;
  reportStatus('disabled', { requestId });
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const deletions = keys.map((request) => {
      const url = new URL(request.url);
      return !isCoreAsset(url.pathname) ? cache.delete(request) : Promise.resolve();
    });
    await Promise.all(deletions);
    await cache.delete(METADATA_URL);
  } catch (error) {
    console.error('[SW] Failed to clear cache:', error);
    reportStatus('error', { errorCode: 'CACHE_CLEAR_FAILED', requestId });
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

// #3: Precache only the user's active locale and ruleset first for faster offline readiness
async function precacheForLocale(locale, ruleset, requestId = null) {
  activeCacheContext = { locale, ruleset };
  reportStatus('starting', { ...activeCacheContext, requestId });
  /** @type {Array<[Request, Response | undefined]>} */
  let previousEntries = [];
  try {
    await caches.delete(STAGING_CACHE_NAME);
    const freshStaging = await caches.open(STAGING_CACHE_NAME);
    const coreResults = await Promise.allSettled(CORE_ASSETS.map((url) => freshStaging.add(url)));
    if (coreResults.some((result) => result.status === 'rejected')) throw new Error('core precache failed');

    const dataFiles = ['movement', 'action', 'bonus_action', 'reaction', 'condition', 'environment'];
    const prefix = ruleset === '2024' ? '2024_' : '';
    const urls = [`./data/${locale}/menu.json`, './themes/themes.json'];
    for (const file of dataFiles) {
      urls.push(`./data/${locale}/rules/${prefix}data_${file}.json`);
    }
    let completed = 0;
    let totalBytes = 0;
    const results = [];
    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Number(response.headers.get('content-length')) || 0;
        await freshStaging.put(url, response.clone());
        totalBytes += bytes;
        results.push({ status: 'fulfilled' });
        completed += 1;
        reportStatus('refreshing', { ...activeCacheContext, requestId, file: url, fileIndex: completed, cachedCount: completed, totalCount: urls.length, totalBytes });
      } catch (error) {
        results.push({ status: 'rejected', reason: error });
      }
    }
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      await caches.delete(STAGING_CACHE_NAME);
      reportStatus('error', { ...activeCacheContext, requestId, errorCode: 'PRECACHE_FAILED', cachedCount: completed, totalCount: urls.length, totalBytes });
      return;
    }
    const live = await caches.open(CACHE_NAME);
    previousEntries = await Promise.all((await live.keys()).map(async (request) => [request, await live.match(request)]));
    for (const request of await freshStaging.keys()) {
      const response = await freshStaging.match(request);
      if (!response) throw new Error('staging response missing');
      await live.put(request, response.clone());
    }
    lastSuccessfulCacheAt = new Date().toISOString();
    await saveMetadata(live, { locale, ruleset, totalBytes, lastSuccessfulCacheAt });
    cacheSizeBytes = totalBytes;
    await caches.delete(STAGING_CACHE_NAME);
    reportStatus('ready', { ...activeCacheContext, requestId, cachedCount: urls.length, totalCount: urls.length, totalBytes });
    // Background: lazily cache remaining locales/rulesets
    await precacheAllContent();
  } catch (error) {
    console.error('[SW] Locale pre-caching failed:', error);
    try {
      const live = await caches.open(CACHE_NAME);
      const staging = await caches.open(STAGING_CACHE_NAME);
      const stagedKeys = await staging.keys();
      await Promise.all(stagedKeys.map((request) => live.delete(request)));
      // Restore entries that were present before staging was copied into the live cache.
      // CacheStorage has no rename/transaction primitive, so this is the safest equivalent.
      await Promise.all(previousEntries.map(([request, response]) => response ? live.put(request, response) : Promise.resolve()));
    } catch (rollbackError) {
      console.error('[SW] Cache replacement rollback failed:', rollbackError);
    }
    await caches.delete(STAGING_CACHE_NAME);
    reportStatus('error', { ...activeCacheContext, requestId, errorCode: 'PRECACHE_FAILED' });
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
      keys.map((key) => (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME ? caches.delete(key) : Promise.resolve())),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return;
  const { type } = message;

  switch (type) {
    case 'SET_CACHING_POLICY':
      if (typeof message.allowed !== 'boolean') return;
      if (!message.allowed) {
        cachingAllowed = false;
        reportStatus('disabled');
        return;
      }
      if (typeof message.locale !== 'string' || !SUPPORTED_LOCALES.has(message.locale)) return;
      if (typeof message.ruleset !== 'string' || !SUPPORTED_RULESETS.has(message.ruleset)) return;
      cachingAllowed = message.allowed;
      if (cachingAllowed) {
        // #3: Precache active locale/ruleset first, then lazy-cache others on access
        event.waitUntil(precacheForLocale(message.locale, message.ruleset, typeof message.requestId === 'string' ? message.requestId : null));
      }
      break;
    case 'REFRESH_CACHE':
      if (!SUPPORTED_LOCALES.has(message.locale) || !SUPPORTED_RULESETS.has(message.ruleset)) return;
      if (!cachingAllowed) { reportStatus('disabled'); return; }
      event.waitUntil(precacheForLocale(message.locale, message.ruleset, typeof message.requestId === 'string' ? message.requestId : null));
      break;
    case 'GET_CACHE_STATUS':
      event.waitUntil(loadMetadata().then(() => reportStatus(cachingAllowed ? 'ready' : 'disabled', activeCacheContext || {})));
      break;
    case 'CLEAR_CACHE':
      event.waitUntil(clearDataCache(typeof message.requestId === 'string' ? message.requestId : null));
      break;
    case 'CLAIM':
      event.waitUntil(self.clients.claim());
      break;
    case 'SKIP_WAITING':
      event.waitUntil(self.skipWaiting());
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
