"use strict";

const SW_VERSION = '5.0.0';
const PRECACHE_NAME = `nexus-precache-v${SW_VERSION}`;
const RUNTIME_CACHE = `nexus-runtime-v${SW_VERSION}`;
const MEDIA_CACHE = `nexus-media-v${SW_VERSION}`;
const CHUNK_CACHE = `nexus-chunks-v${SW_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/main.js',
  '/src/core/App.js',
  '/src/core/EventBus.js',
  '/src/core/StateManager.js',
  '/src/core/VFS.js',
  '/src/core/ChunkStore.js',
  '/src/core/StreamPipeline.js',
  '/src/core/ThemeManager.js',
  '/src/core/PluginRegistry.js',
  '/src/ui/UIManager.js',
  '/src/ui/VFSTree.js',
  '/src/ui/TabManager.js',
  '/src/ui/Inspector.js',
  '/src/ui/Notifications.js',
  '/src/ui/SearchBar.js',
  '/src/ui/SettingsPanel.js',
  '/src/ui/MediaPlayer.js',
  '/src/ui/Timeline.js',
  '/src/ui/StatusBar.js',
  '/src/services/FileService.js',
  '/src/services/ExportService.js',
  '/src/services/WorkerManager.js',
  '/src/services/ImportService.js',
  '/src/services/CodecService.js',
  '/src/services/IndexedDBService.js',
  '/src/services/SettingsStore.js',
  '/src/pwa/ServiceWorker.js',
  '/src/pwa/InstallPrompt.js',
];

const CDN_URLS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.29/dist/zip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js',
];

const CACHE_STRATEGIES = {
  CACHE_FIRST: 'cache-first',
  NETWORK_FIRST: 'network-first',
  STALE_WHILE_REVALIDATE: 'stale-while-revalidate',
  NETWORK_ONLY: 'network-only',
  CACHE_ONLY: 'cache-only',
};

const ROUTE_RULES = [
  { test: /\.(?:html|htm)$/, strategy: CACHE_STRATEGIES.NETWORK_FIRST, cache: RUNTIME_CACHE, maxAge: 86400 },
  { test: /\.(?:js|mjs)$/, strategy: CACHE_STRATEGIES.STALE_WHILE_REVALIDATE, cache: RUNTIME_CACHE, maxAge: 604800 },
  { test: /\.(?:css)$/, strategy: CACHE_STRATEGIES.STALE_WHILE_REVALIDATE, cache: RUNTIME_CACHE, maxAge: 604800 },
  { test: /\.(?:json|xml)$/, strategy: CACHE_STRATEGIES.NETWORK_FIRST, cache: RUNTIME_CACHE, maxAge: 86400 },
  { test: /\.(?:png|jpg|jpeg|gif|webp|svg|ico|avif)$/, strategy: CACHE_STRATEGIES.CACHE_FIRST, cache: MEDIA_CACHE, maxAge: 2592000 },
  { test: /\.(?:woff|woff2|ttf|otf|eot)$/, strategy: CACHE_STRATEGIES.CACHE_FIRST, cache: MEDIA_CACHE, maxAge: 2592000 },
  { test: /\.(?:mp3|wav|ogg|flac|m4a|aac)$/, strategy: CACHE_STRATEGIES.CACHE_FIRST, cache: MEDIA_CACHE, maxAge: 2592000, rangeSupport: true },
  { test: /\.(?:mp4|webm|mov|m4v)$/, strategy: CACHE_STRATEGIES.CACHE_FIRST, cache: MEDIA_CACHE, maxAge: 2592000, rangeSupport: true },
  { test: /\/api\//, strategy: CACHE_STRATEGIES.NETWORK_FIRST, cache: RUNTIME_CACHE, maxAge: 300 },
];

const BACKGROUND_SYNC_TAGS = {
  'nexus-sync': handleNexusSync,
  'nexus-upload': handleNexusUpload,
  'nexus-telemetry': handleNexusTelemetry,
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE_NAME);
    const localResults = await Promise.allSettled(
      PRECACHE_URLS.map((url) =>
        cache.add(url).catch((err) => ({ url, error: err }))
      )
    );
    const cdnResults = await Promise.allSettled(
      CDN_URLS.map((url) =>
        fetch(url, { mode: 'cors', credentials: 'omit' })
          .then((res) => {
            if (res.ok) return cache.put(url, res);
          })
          .catch((err) => ({ url, error: err }))
      )
    );
    const failed = [...localResults, ...cdnResults].filter(
      (r) => r.status === 'rejected' || (r.value && r.value.error)
    );
    if (failed.length) {
      console.warn('[SW] precache partial failures:', failed.length);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const validCaches = [PRECACHE_NAME, RUNTIME_CACHE, MEDIA_CACHE, CHUNK_CACHE];
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith('nexus-') && !validCaches.includes(name))
        .map((name) => caches.delete(name))
    );
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    await self.clients.claim();
    broadcastToClients({ type: 'SW_ACTIVATED', version: SW_VERSION });
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/__nexus_') || url.hostname.includes('chrome-extension')) return;

  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    event.respondWith(handleRangeRequest(request));
    return;
  }

  if (url.pathname === '/share-target' && request.method === 'POST') {
    event.respondWith(handleShareTarget(request));
    return;
  }

  const rule = matchRoute(request);
  if (!rule) {
    if (isSameOrigin(url)) event.respondWith(handleNavigationFallback(request));
    return;
  }

  event.respondWith(executeStrategy(request, rule));
});

async function executeStrategy(request, rule) {
  switch (rule.strategy) {
    case CACHE_STRATEGIES.CACHE_FIRST:
      return cacheFirst(request, rule);
    case CACHE_STRATEGIES.NETWORK_FIRST:
      return networkFirst(request, rule);
    case CACHE_STRATEGIES.STALE_WHILE_REVALIDATE:
      return staleWhileRevalidate(request, rule);
    case CACHE_STRATEGIES.NETWORK_ONLY:
      return fetch(request);
    case CACHE_STRATEGIES.CACHE_ONLY:
      return caches.match(request);
    default:
      return fetch(request);
  }
}

async function cacheFirst(request, rule) {
  const cache = await caches.open(rule.cache);
  const cached = await cache.match(request);
  if (cached && !isExpired(cached, rule.maxAge)) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    if (cached) return cached;
    return offlineFallback(request);
  }
}

async function networkFirst(request, rule) {
  const cache = await caches.open(rule.cache);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const precached = await caches.match(request);
    if (precached) return precached;
    return offlineFallback(request);
  }
}

async function staleWhileRevalidate(request, rule) {
  const cache = await caches.open(rule.cache);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function handleNavigationFallback(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match('/index.html');
    if (cached) return cached;
    return new Response(
      '<!DOCTYPE html><html><head><title>Offline</title><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;background:#050505;color:#00f0ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}h1{font-size:48px;margin:0 0 12px}p{color:#666}</style></head><body><div><h1>⊘</h1><h2>NEXUS Offline</h2><p>This page is not cached yet.</p></div></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html' } }
    );
  }
}

async function handleRangeRequest(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request.url);

  if (cached) {
    const rangeHeader = request.headers.get('range');
    const range = parseRangeHeader(rangeHeader, cached.headers.get('content-length'));
    if (range) {
      try {
        const slicedBlob = await sliceResponse(cached, range.start, range.end);
        return new Response(slicedBlob, {
          status: 206,
          statusText: 'Partial Content',
          headers: buildRangeHeaders(cached.headers, range, slicedBlob.size),
        });
      } catch (err) {
        console.warn('[SW] range slice failed, fetching fresh', err);
      }
    }
  }

  try {
    const response = await fetch(request);
    if (response.ok && response.status === 200) {
      cache.put(request.url, response.clone()).catch(() => {});
    }
    if (response.status === 206) {
      return response;
    }
    if (response.ok && !cached) {
      const blob = await response.clone().blob();
      cache.put(request.url, new Response(blob, { headers: response.headers })).catch(() => {});
    }
    return response;
  } catch {
    if (cached) return cached;
    return new Response(null, { status: 504, statusText: 'Gateway Timeout' });
  }
}

function parseRangeHeader(header, totalSize) {
  if (!header) return null;
  const match = header.match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : (totalSize ? parseInt(totalSize, 10) - 1 : undefined);
  return { start, end };
}

async function sliceResponse(response, start, end) {
  const blob = await response.blob();
  if (end === undefined) return blob.slice(start);
  return blob.slice(start, end + 1);
}

function buildRangeHeaders(originalHeaders, range, sliceSize) {
  const headers = new Headers(originalHeaders);
  const total = originalHeaders.get('content-length') || '*';
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${total}`);
  headers.set('Content-Length', String(sliceSize));
  headers.set('Accept-Ranges', 'bytes');
  return headers;
}

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const url = formData.get('url') || '';
    const files = formData.getAll('file').filter(Boolean);

    const messages = [];
    for (const file of files) {
      messages.push({
        type: 'file-shared',
        file: {
          name: file.name,
          type: file.type,
          size: file.size,
          blob: file,
        },
      });
    }
    if (title || text || url) {
      messages.push({ type: 'text-shared', title, text, url });
    }

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      for (const msg of messages) {
        client.postMessage(msg);
      }
    }

    return Response.redirect('/?shared=1', 303);
  } catch (err) {
    console.error('[SW] share target error', err);
    return Response.redirect('/?share-error=1', 303);
  }
}

function matchRoute(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  for (const rule of ROUTE_RULES) {
    if (rule.test.test(path)) return rule;
  }
  if (isSameOrigin(url) && url.pathname.startsWith('/src/')) {
    return { strategy: CACHE_STRATEGIES.STALE_WHILE_REVALIDATE, cache: RUNTIME_CACHE, maxAge: 604800 };
  }
  return null;
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isExpired(response, maxAge) {
  if (!maxAge) return false;
  const dateHeader = response.headers.get('date');
  if (!dateHeader) return false;
  const fetchedAt = new Date(dateHeader).getTime();
  return Date.now() - fetchedAt > maxAge * 1000;
}

async function offlineFallback(request) {
  if (request.destination === 'document') {
    const cached = await caches.match('/index.html');
    if (cached) return cached;
  }
  if (request.destination === 'image') {
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#1a1a1a"/><text x="100" y="105" font-family="monospace" font-size="14" fill="#666" text-anchor="middle">offline</text></svg>',
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
  return new Response('', { status: 503, statusText: 'Offline' });
}

self.addEventListener('message', (event) => {
  const { id, type, payload } = event.data || {};
  if (!type) return;

  const reply = (result) => {
    if (id && event.source) {
      event.source.postMessage({ id, type: type + '_RESPONSE', payload: result });
    }
  };

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      reply({ skipped: true });
      break;

    case 'PRECACHE':
      (async () => {
        try {
          const cache = await caches.open(PRECACHE_NAME);
          const urls = (payload && payload.urls) || [];
          const results = await Promise.allSettled(urls.map((u) => cache.add(u)));
          const success = results.filter((r) => r.status === 'fulfilled').length;
          reply({ success, total: urls.length });
        } catch (err) {
          reply({ error: err.message });
        }
      })();
      break;

    case 'CLEAR_CACHE':
      (async () => {
        try {
          const name = payload && payload.cacheName;
          if (name) {
            await caches.delete(name);
            reply({ cleared: name });
          } else {
            const names = await caches.keys();
            await Promise.all(names.map((n) => caches.delete(n)));
            reply({ cleared: names });
          }
        } catch (err) {
          reply({ error: err.message });
        }
      })();
      break;

    case 'CACHE_STATS':
      (async () => {
        try {
          const stats = {};
          const names = await caches.keys();
          for (const name of names) {
            if (!name.startsWith('nexus-')) continue;
            const cache = await caches.open(name);
            const keys = await cache.keys();
            let bytes = 0;
            for (const req of keys) {
              const res = await cache.match(req);
              if (res) {
                const blob = await res.clone().blob();
                bytes += blob.size;
              }
            }
            stats[name] = { entries: keys.length, bytes };
          }
          reply({ stats, version: SW_VERSION });
        } catch (err) {
          reply({ error: err.message });
        }
      })();
      break;

    case 'CACHE_URLS':
      (async () => {
        try {
          const cache = await caches.open(RUNTIME_CACHE);
          const urls = (payload && payload.urls) || [];
          const results = await Promise.allSettled(urls.map((u) => cache.add(u)));
          reply({ cached: results.filter((r) => r.status === 'fulfilled').length });
        } catch (err) {
          reply({ error: err.message });
        }
      })();
      break;

    case 'PING':
      reply({ pong: true, version: SW_VERSION, ts: Date.now() });
      break;

    default:
      reply({ error: 'Unknown message type: ' + type });
  }
});

self.addEventListener('sync', (event) => {
  const handler = BACKGROUND_SYNC_TAGS[event.tag];
  if (!handler) return;
  event.waitUntil(handler());
});

async function handleNexusSync() {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'SYNC_START', tag: 'nexus-sync' });
    }
    const cache = await caches.open(RUNTIME_CACHE);
    const queue = await getSyncQueue();
    for (const item of queue) {
      try {
        await fetch(item.url, item.options);
        await removeFromSyncQueue(item.id);
      } catch (err) {
        throw err;
      }
    }
    for (const client of clients) {
      client.postMessage({ type: 'SYNC_COMPLETE', tag: 'nexus-sync' });
    }
  } catch (err) {
    console.error('[SW] sync failed', err);
    throw err;
  }
}

async function handleNexusUpload() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'UPLOAD_SYNC', status: 'started' });
  }
}

async function handleNexusTelemetry() {
  const cache = await caches.open(RUNTIME_CACHE);
  const req = await cache.match('/__telemetry_queue');
  if (!req) return;
  const events = await req.json();
  if (!events.length) return;
  try {
    await fetch('/api/telemetry', {
      method: 'POST',
      body: JSON.stringify(events),
      headers: { 'Content-Type': 'application/json' },
    });
    await cache.delete('/__telemetry_queue');
  } catch {}
}

async function getSyncQueue() {
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    const req = await cache.match('/__sync_queue');
    if (!req) return [];
    return await req.json();
  } catch {
    return [];
  }
}

async function removeFromSyncQueue(id) {
  const cache = await caches.open(RUNTIME_CACHE);
  const queue = await getSyncQueue();
  const filtered = queue.filter((item) => item.id !== id);
  await cache.put(
    '/__sync_queue',
    new Response(JSON.stringify(filtered), {
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'nexus-periodic') {
    event.waitUntil((async () => {
      try {
        await caches.open(RUNTIME_CACHE);
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) {
          client.postMessage({ type: 'PERIODIC_SYNC', ts: Date.now() });
        }
      } catch (err) {
        console.error('[SW] periodic sync failed', err);
      }
    })());
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { title: 'NEXUS', body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'NEXUS EXTRACTOR', {
      body: payload.body || '',
      icon: payload.icon || '/icons/icon-192.png',
      badge: payload.badge || '/icons/badge-72.png',
      tag: payload.tag || 'nexus-general',
      data: payload.data || {},
      vibrate: [50, 30, 50],
      requireInteraction: payload.requireInteraction || false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url === targetUrl && 'focus' in client) {
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});

async function broadcastToClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(message);
  }
}

self.addEventListener('error', (event) => {
  console.error('[SW] unhandled error', event.error || event.message);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] unhandled rejection', event.reason);
});

self.postMessage?.({ type: 'SW_READY', version: SW_VERSION });
