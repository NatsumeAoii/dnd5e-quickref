/* eslint-disable no-console */
/* eslint-disable no-empty */
/* eslint-disable consistent-return */
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

const scopeUrl = new URL(self.registration.scope);
const ROOT_URL = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;
const INDEX_URL = `${ROOT_URL}index.html`;

let cachingAllowed = false;

async function clearCache() {
  console.log('Clearing data cache due to lack of user consent.');
  cachingAllowed = false;
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  const promises = keys.map((request) => {
    const isCore = CORE_ASSETS.some((corePath) => request.url.endsWith(corePath.substring(1)));
    if (!isCore) {
      return cache.delete(request);
    }
    return Promise.resolve();
  });
  await Promise.all(promises);
  console.log('Non-core data cache cleared.');
}

self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SET_CACHING_POLICY') {
    cachingAllowed = event.data.allowed;
    console.log(`Service Worker caching policy set to: ${cachingAllowed}`);
  } else if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(clearCache());
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE_ASSETS.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => (n !== CACHE_NAME ? caches.delete(n) : undefined)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (request.method !== 'GET') {
    event.respondWith(fetch(request).catch(() => Response.error()));
    return;
  }

  const putIfOk = async (cache, req, resp) => {
    if (cachingAllowed && resp && resp.ok) {
      try { await cache.put(req, resp.clone()); } catch {}
    }
  };

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const net = await fetch(request);
        await putIfOk(cache, request, net);
        return net;
      } catch {
        return (await caches.match(request, { ignoreSearch: true }))
          || (await caches.match(ROOT_URL))
          || (await caches.match(INDEX_URL))
          || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });

    const revalidate = fetch(request)
      .then(async (net) => {
        await putIfOk(cache, request, net);
        return net;
      })
      .catch(() => undefined);

    if (cached) {
      revalidate.catch(() => {});
      return cached;
    }
    const net = await revalidate;
    return net || Response.error();
  })());
});
