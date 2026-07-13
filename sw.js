// TrinityOne service worker — makes the app boot offline.
// The app SHELL (html/jsx/libs/fonts) is cached here; Bible MODULES live in IndexedDB (engine.js)
// and chat goes over the relay WebSocket — neither is touched by this worker.
const CACHE = 'trinity-shell-v216';   // bump on each app deploy so installed PWAs refresh the shell
// SECURITY-AUDIT-2026-06-25 Critical-1: query-string params that MUST NOT enter the SW cache key.
// The classic case is `?invite=<full 12-word BIP-39 seed>` — even after the React app strips the URL
// via history.replaceState (app.jsx ~L466), the SW fetch handler has already cached the response
// keyed by the FULL request URL. Anyone with DevTools / extension access to Cache Storage then sees
// every cached URL via caches.keys()/match — the seed leaks via cache inspection long after the
// address-bar scrub. Strip these before c.put(req, copy).
const SENSITIVE_QS = ['invite', 'follow', 'relay', 'name', 'adopt', 'church', 'churchkey'];

// Precache the boot-critical core. Everything else same-origin is cached on first fetch, so one
// online visit (to install / join) makes every screen available offline afterwards.
const CORE = [
  './', './index.html',
  './vendor/react.production.min.js', './vendor/react-dom.production.min.js',
  './vendor/fflate.js', './vendor/sqljs/sql-wasm.js', './vendor/sqljs/sql-wasm.wasm',
  './engine.js', './vendor/identity.js', './vendor/fellowship.js', './vendor/mydata.js', './vendor/library/index.js',
  './vendor/fonts/fonts.css',
  './app/data.jsx', './app/icons.jsx', './app/ui.jsx', './app/identity-avatar.jsx', './app/identity.jsx', './app/identity-extras.jsx',
  './app/screens-today.jsx', './app/screens-read.jsx', './app/screens-plans.jsx', './app/screens-library.jsx', './app/screens-bookreader.jsx',
  './app/screens-watch.jsx', './app/screens-search.jsx', './app/screens-concordance.jsx', './app/screens-audio.jsx', './app/screens-extras.jsx', './app/screens-giving.jsx',
  './app/screens-church.jsx', './app/screens-serving.jsx', './app/reminders.jsx', './app/backup.jsx', './app/screens-chat.jsx', './app/screens-onboarding.jsx', './app/help-illustrations.jsx', './app/help-data.jsx',
  './app/screens-help.jsx', './app/screens-help-main.jsx', './app/app.jsx',
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
  // are left alone — NEVER cached. Caching a live-state route froze the desktop control panel: the SW
  // cached /tunnel/state="not running" once and served it forever, so the panel showed "not public" long
  // after the tunnel came up. relay/ (prefix) also covers /relay-app/ (desktop control UI) + /relay-names.
  if (/^\/(relay|modules\/|push\/|config|status|feed|audiofeed|audiozip|tunnel|tailscale|suite-update|local-token|settings|update)/.test(url.pathname)) return;
  // App shell (navigations + HTML/JSX source) is network-first, so a new deploy is picked up on the
  // next load instead of being pinned to the old cached copy; it falls back to cache when offline.
  const isShell = e.request.mode === 'navigate' || url.pathname === '/' || /\.(html|jsx)$/.test(url.pathname);
  // SECURITY-AUDIT-2026-06-25 Critical-1: build a cache-safe Request that strips sensitive query
  // params so the seed (in ?invite=) and the follow/relay/name companions don't end up in the
  // Cache Storage key. The network fetch still uses the original req (so the page logic can read
  // ?invite=); only the cached entry is rewritten.
  const cacheSafeReq = (req) => {
    try {
      const u = new URL(req.url);
      let dirty = false;
      for (const k of SENSITIVE_QS) { if (u.searchParams.has(k)) { u.searchParams.delete(k); dirty = true; } }
      return dirty ? new Request(u.toString(), { method: req.method, headers: req.headers, mode: 'no-cors', credentials: req.credentials }) : req;
    } catch (_) { return req; }
  };
  const fresh = (req) => fetch(req).then((res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(cacheSafeReq(req), copy)); } return res; });
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
  // SECURITY-AUDIT-2026-06-24 L9: only accept same-origin paths. openWindow + cross-origin pushes
  // could phish; reject anything that isn't a single-leading-/ path. (Also rejects '//evil.example'.)
  const raw = (e.notification.data && e.notification.data.url) || '/?serving=1';
  const target = (typeof raw === 'string' && raw.length > 0 && raw[0] === '/' && raw[1] !== '/') ? raw : '/?serving=1';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) { c.navigate(target); return c.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});
