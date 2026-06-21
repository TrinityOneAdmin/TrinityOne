// TrinityOne service worker — makes the app boot offline.
// The app SHELL (html/jsx/libs/fonts) is cached here; Bible MODULES live in IndexedDB (engine.js)
// and chat goes over the relay WebSocket — neither is touched by this worker.
const CACHE = 'trinity-shell-v195';   // bump on each app deploy so installed PWAs refresh the shell

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
  './screens-watch.jsx', './screens-search.jsx', './screens-concordance.jsx', './screens-audio.jsx', './screens-extras.jsx', './screens-giving.jsx',
  './screens-church.jsx', './screens-serving.jsx', './reminders.jsx', './backup.jsx', './screens-chat.jsx', './screens-onboarding.jsx', './help-illustrations.jsx', './help-data.jsx',
  './screens-help.jsx', './screens-help-main.jsx', './app.jsx',
  './catalog.json', './manifest.json', './web-audio-manifest.json',
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
  // the relay (WebSocket), the large Bible modules (owned by IndexedDB) and the dynamic API endpoints
  // are left alone — never cached
  if (/^\/(relay|modules\/|push\/|config|status|feed|audiofeed|audiozip)/.test(url.pathname)) return;
  // App shell (navigations + HTML/JSX source) is network-first, so a new deploy is picked up on the
  // next load instead of being pinned to the old cached copy; it falls back to cache when offline.
  const isShell = e.request.mode === 'navigate' || url.pathname === '/' || /\.(html|jsx)$/.test(url.pathname);
  const fresh = (req) => fetch(req).then((res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; });
  if (isShell) {
    e.respondWith(fresh(e.request).catch(() => caches.match(e.request).then((c) => c || caches.match('./index.html'))));
    return;
  }
  // everything else (big immutable libs, fonts, wasm): cache-first, refresh in the background
  e.respondWith(caches.match(e.request).then((cached) => cached || fresh(e.request).catch(() => cached)));
});

// ---- web push: show serving requests even when the app isn't open (PWA) ----
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch {}
  const title = d.title || 'TrinityOne';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', tag: d.tag || 'trinityone', data: { url: d.url || '/?serving=1' },
    icon: './icons/icon-192.png', badge: './icons/icon-192.png',
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/?serving=1';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) { c.navigate(target); return c.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});
