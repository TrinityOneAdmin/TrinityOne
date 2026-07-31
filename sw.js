// TrinityOne service worker — makes the app boot offline.
// The app SHELL (html/jsx/libs/fonts) is cached here; Bible MODULES live in IndexedDB (engine.js)
// and chat goes over the relay WebSocket — neither is touched by this worker.
const CACHE = 'trinity-shell-v252';   // bump on each app deploy so installed PWAs refresh the shell
// SECURITY-AUDIT-2026-06-25 Critical-1: query-string params that MUST NOT enter the SW cache key.
// The classic case is `?invite=<full 12-word BIP-39 seed>` — even after the React app strips the URL
// via history.replaceState (app.jsx ~L466), the SW fetch handler has already cached the response
// keyed by the FULL request URL. Anyone with DevTools / extension access to Cache Storage then sees
// every cached URL via caches.keys()/match — the seed leaks via cache inspection long after the
// address-bar scrub. Strip these before c.put(req, copy).
const SENSITIVE_QS = ['invite', 'follow', 'relay', 'name', 'adopt', 'church', 'churchkey'];

// PRECACHE, DERIVED FROM THE PAGE ITSELF.
//
// This used to be a hand-maintained list of './app/*.jsx'. The web build transpiles those to .js and rewrites
// index.html to match (scripts/build-pages.sh), so the list silently stopped describing the deployed app:
// measured against the built output, only 9 of the 43 scripts the page loads were in it, and 28 entries were
// .jsx files the build never emits. That matters more than it looks, because the service worker registers on
// `load` — AFTER the page's own scripts have already been fetched without its involvement. So on a FIRST visit
// the precache is the only thing that lands in the cache. With the list wrong, a reload with the server
// unreachable found no shell and rendered the browser's error page instead of the app. Verified in a browser.
//
// So: read index.html at install time and cache exactly what it references. It cannot drift again, and it is
// correct for both the .jsx dev shell and the transpiled build without either knowing about this file.
// AUDIT-2026-07-31 P7. `./vendor/sqljs/sql-wasm.wasm` USED TO BE PRECACHED HERE, correctly noting that no tag
// references it. It is 655 KB — the single largest thing the app would ever download — and at the 20 kB/s
// this product is built for that is roughly THIRTY-THREE SECONDS of a member's first install, before a word
// of Scripture or a single message.
//
// It is only ever needed by engine.js:222, which calls initSqlJs() when opening a Bible module that happens
// to be in SQLite format. Most members will never open one; nobody needs it to read their church's chat.
//
// Safe to drop from the precache because the fetch handler caches successful responses at runtime (see
// `fresh` below), and a SQLite Bible cannot exist offline without a download that required being online —
// the same session in which the wasm is fetched and cached. The trade is one extra request the first time
// someone opens that kind of module, against 655 KB every member pays on install whether they ever do or not.
const EXTRA = [
  './', './index.html',
  './catalog.json', './manifest.json', './web-audio-manifest.json',
];
const sameOrigin = (u) => u && !/^[a-z]+:/i.test(u) && !u.startsWith('//') && !u.startsWith('#');
const norm = (u) => (u.startsWith('./') ? u : './' + u.replace(/^\//, '')).split('#')[0];

async function shellUrls() {
  const out = new Set(EXTRA);
  try {
    const res = await fetch('./index.html', { cache: 'reload' });
    if (res && res.ok) {
      const html = await res.text();
      for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) if (sameOrigin(m[1])) out.add(norm(m[1]));
    }
  } catch (_) {}
  // fonts are referenced from CSS, not from a tag — follow one level so text renders offline too
  for (const css of [...out].filter((u) => u.endsWith('.css'))) {
    try {
      const r = await fetch(css); if (!r || !r.ok) continue;
      const text = await r.text();
      const base = css.slice(0, css.lastIndexOf('/') + 1);
      for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        const u = m[1]; if (!sameOrigin(u)) continue;
        out.add(u.startsWith('.') || u.startsWith('/') ? norm(u) : norm(base.replace('./', '') + u));
      }
    } catch (_) {}
  }
  return [...out];
}

self.addEventListener('install', (e) => {
  // cache each item independently so one 404 can't fail the whole install
  e.waitUntil(shellUrls().then((urls) => caches.open(CACHE).then((c) => Promise.all(
    urls.map((u) => c.add(u).catch((err) => console.warn('[sw] skip', u, err.message)))
  ))).then(() => self.skipWaiting()));
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
    // Network-first so a new deploy is picked up, cache second, and for a NAVIGATION always fall back to the
    // cached shell — never let the browser's "site can't be reached" page win when we hold a working copy.
    // Each fallback must be AWAITED. `caches.match(...)` returns a promise, and a promise is always truthy, so
    // `c || caches.match('./index.html') || caches.match('./')` never reached the last term — and when
    // index.html happened not to be cached (the install loop caches each URL independently and swallows
    // individual failures) the handler resolved `undefined` into respondWith, which the browser renders as
    // "site can't be reached". Precisely the page this branch exists to prevent. AUDIT-2026-07-27.
    e.respondWith(fresh(e.request).catch(async () => (
      (await caches.match(e.request)) || (await caches.match('./index.html')) || (await caches.match('./')) ||
      new Response('<!doctype html><meta charset=utf-8><title>TrinityOne</title><p style="font:16px system-ui;padding:2rem">TrinityOne is offline and this page was never saved to this device. Reconnect once and it will work offline afterwards.', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    )));
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
