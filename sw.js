// TrinityOne service worker — makes the app boot offline.
// The app SHELL (html/jsx/libs/fonts) is cached here; Bible MODULES live in IndexedDB (engine.js)
// and chat goes over the relay WebSocket — neither is touched by this worker.
const CACHE = 'trinity-shell-v6';   // bump on each app deploy so installed PWAs refresh the shell

// Precache the boot-critical core. Everything else same-origin is cached on first fetch, so one
// online visit (to install / join) makes every screen available offline afterwards.
const CORE = [
  './', './index.html',
  './vendor/react.development.js', './vendor/react-dom.development.js', './vendor/babel.min.js',
  './vendor/fflate.js', './vendor/sqljs/sql-wasm.js', './vendor/sqljs/sql-wasm.wasm',
  './engine.js', './vendor/identity.js', './vendor/fellowship.js', './vendor/mydata.js', './vendor/library/index.js',
  './vendor/fonts/fonts.css',
  './data.jsx', './icons.jsx', './ui.jsx', './identity-avatar.jsx', './identity.jsx', './identity-extras.jsx',
  './screens-today.jsx', './screens-read.jsx', './screens-plans.jsx', './screens-library.jsx', './screens-bookreader.jsx',
  './screens-watch.jsx', './screens-search.jsx', './screens-concordance.jsx', './screens-extras.jsx', './screens-giving.jsx',
  './screens-church.jsx', './screens-chat.jsx', './screens-onboarding.jsx', './help-illustrations.jsx', './help-data.jsx',
  './screens-help.jsx', './screens-help-main.jsx', './app.jsx',
  './catalog.json', './manifest.json',
];

self.addEventListener('install', (e) => {
  // cache each item independently so one 404 can't fail the whole install
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(
    CORE.map((u) => c.add(u).catch((err) => console.warn('[sw] skip', u, err.message)))
  )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;   // POSTs, cross-origin: pass through
  // the relay (WebSocket upgrade) and the large Bible modules (owned by IndexedDB) are left alone
  if (url.pathname.startsWith('/relay') || url.pathname.startsWith('/modules/')) return;
  // cache-first, then refresh in the background so the next load picks up new deploys
  e.respondWith(caches.match(e.request).then((cached) => {
    const network = fetch(e.request).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
