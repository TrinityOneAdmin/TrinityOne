// Load the steward console's screens in Node the way the phone loads them, so a test can MOUNT a component.
//
// WHY THIS EXISTS. On 2026-08-23 (8537ba2) the Cancel button of StewBackupModal was pointed at `guardedClose`,
// a const that exists only inside the sibling SermonEditModal. `app/*.jsx` are classic scripts sharing one
// global scope, so the reference is a free identifier: nothing fails at load, and the modal throws
// `ReferenceError: guardedClose is not defined` the first time it RENDERS. Settings → Church key → Back up to
// a file showed the error boundary on every build for 27 days. No test mounted the modal, so no test saw it.
//
// The mount tests that existed (removing-a-relay-asks-first.test.mjs and its kin) slice ONE function out of a
// file with fnBody() and compile it alone. That cannot tell a free identifier that is a bug from one that is
// a helper defined elsewhere — both are absent from the slice. This module instead does what steward.html
// and scripts/build-steward-apk.sh do:
//   • every `<script type="text/babel" src="app/*.jsx">` in steward.html, in that order, steward-root.jsx
//     included (its ReactDOM mount is a no-op here; the hooks it installs on window are real);
//   • each compiled by esbuild with `jsx: 'transform'` — the same transform build-steward-apk.sh runs as
//     `esbuild --jsx=transform` for the steward APK (React.createElement, no automatic runtime);
//   • run in ONE `vm` context whose global object IS the fake `window`. That is the browser's model exactly:
//     a top-level `const` in one file is visible to the next, `window.todayISO = …` (recur.jsx) makes a bare
//     `todayISO` resolve, and a name nobody defined throws ReferenceError at the line that reads it.
// So after load, an identifier that is free in a component is free on the phone too. The only things this
// module supplies are browser builtins (document, localStorage…) and the vendor globals that come from
// bundles, not from these files (window.Steward, window.TrinityBackup is then REPLACED by backup.jsx's real
// one, ReactDOM).
//
// WHAT THE FAKE React IS AND IS NOT. There is no react-dom in node_modules and no DOM. React here is a hook
// store plus a createElement that returns plain `{ type, props, kids }` trees. Rendering a component means
// calling it: its hooks run, its JSX becomes a tree, and every expression in that JSX — including a
// `onClick={guardedClose}` — is evaluated. Effects run once after the first draw and again only when their
// deps change, as React would; that is how useStewDialog registers its Escape entry. Child COMPONENTS are not
// called (their `type` is the function, left in the tree), so this renders exactly one component's own body.
// That is the scope of every claim a test built on this can make.
//
// ⚠ REALMS. Code inside the context has its own Error/Array/Promise. Test `e.name === 'ReferenceError'`, not
// `instanceof`; Array.isArray and typeof are realm-safe and are what the tree helpers below use.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const ROOT = new URL('../', import.meta.url);

// The console's script list, read from steward.html so the harness follows the page rather than restating it.
export function consoleScripts() {
  const html = readFileSync(new URL('steward.html', ROOT), 'utf8');
  const out = [];
  for (const m of html.matchAll(/<script type="text\/babel" src="(app\/[^"]+\.jsx)"><\/script>/g)) out.push(m[1]);
  if (!out.length) throw new Error('steward.html lists no text/babel scripts — re-anchor console-screens.mjs');
  return out;
}

const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, n) => Object.is(v, b[n]));

// One hook store. A test draws ONE component at a time and re-draws it in place, so a flat slot index is the
// right shape: `reset()` before each draw, `flush()` after it, `fresh()` before drawing a DIFFERENT component.
export function fakeReact() {
  let slots = [], effDeps = [], queued = [], cleanups = [];
  let i = 0, ei = 0;
  const React = {
    useState(init) {
      const k = i++;
      if (!(k in slots)) slots[k] = typeof init === 'function' ? init() : init;
      return [slots[k], (v) => { slots[k] = typeof v === 'function' ? v(slots[k]) : v; }];
    },
    useRef(init) { const k = i++; if (!(k in slots)) slots[k] = { current: init === undefined ? null : init }; return slots[k]; },
    useMemo(f, deps) { const k = i++; if (!(k in slots) || !same(slots[k].deps, deps)) slots[k] = { deps, v: f() }; return slots[k].v; },
    useCallback(f, deps) { return React.useMemo(() => f, deps); },
    useEffect(fn, deps) { const k = ei++; if (!(k in effDeps) || !same(effDeps[k], deps)) { effDeps[k] = deps; queued.push(fn); } },
    useLayoutEffect(fn, deps) { return React.useEffect(fn, deps); },
    useContext() { return undefined; },
    createElement(type, props, ...kids) { return { type, props: props || {}, kids: kids.flat(Infinity) }; },
    Fragment: 'Fragment',
    Component: class Component { constructor(p) { this.props = p; this.state = {}; } setState() {} },
  };
  const flush = () => { const r = queued; queued = []; for (const f of r) { const c = f(); if (typeof c === 'function') cleanups.push(c); } };
  const unmount = () => { cleanups.splice(0).forEach(c => { try { c(); } catch (e) {} }); };
  const reset = () => { i = 0; ei = 0; };
  const fresh = () => { unmount(); slots = []; effDeps = []; queued = []; reset(); };
  return { React, get slots() { return slots; }, reset, flush, unmount, fresh };
}

// window.Steward with every method present and doing nothing, and no key loaded. Context, not a decision: a
// screen that needs a real answer from it fails with a TypeError, which a test must record as "could not
// render", never as a pass. `hasKey` is a property on the real object, so it is one here.
export function fakeSteward(overrides = {}) {
  const base = { hasKey: false, ...overrides };
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : (typeof k === 'symbol' || k === 'then') ? undefined : () => undefined),
    has: (t, k) => k in t || typeof k === 'string',
  });
}

// Minimal browser: enough for the console's top-level statements and for useStewDialog's document listener.
// Returns the object that becomes the context's global — so every key on it is a bare identifier to the
// scripts, exactly as on `window` in a browser.
export function fakeBrowser({ Steward = fakeSteward(), TrinityBackup = {} } = {}) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), key: (n) => [...store.keys()][n] ?? null, get length() { return store.size; }, clear: () => store.clear(),
  };
  const listeners = { document: {}, window: {} };
  const on = (bag) => (type, fn) => { (bag[type] = bag[type] || []).push(fn); };
  const off = (bag) => (type, fn) => { bag[type] = (bag[type] || []).filter(f => f !== fn); };
  const fire = (bag) => (type, ev) => { (bag[type] || []).slice().forEach(fn => fn(ev)); };
  const el = () => ({ focus() {}, blur() {}, contains: () => false, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, appendChild(c) { return c; }, removeChild(c) { return c; }, remove() {}, setAttribute() {}, getAttribute: () => null, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, tagName: 'DIV', getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }), getContext: () => null, click() {}, scrollIntoView() {} });
  const document = {
    addEventListener: on(listeners.document), removeEventListener: off(listeners.document), dispatch: fire(listeners.document),
    activeElement: null, body: el(), documentElement: el(), head: el(),
    createElement: () => el(), createElementNS: () => el(), createTextNode: (t) => ({ textContent: t }), getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [],
    visibilityState: 'visible', hidden: false, title: '', cookie: '', fonts: { ready: Promise.resolve() },
  };
  const location = { href: 'https://console.example/steward.html', origin: 'https://console.example', host: 'console.example', hostname: 'console.example', protocol: 'https:', pathname: '/steward.html', search: '', hash: '', reload() {}, replace() {}, assign() {} };
  // Timers that never hold the process open: the console arms a 90 s reconnect poll on load.
  const unref = (t) => { if (t && typeof t.unref === 'function') t.unref(); return t; };
  const window = {
    Steward, TrinityBackup, localStorage, sessionStorage: localStorage, document, location,
    isSecureContext: true, innerWidth: 390, innerHeight: 800, devicePixelRatio: 2,
    addEventListener: on(listeners.window), removeEventListener: off(listeners.window), dispatch: fire(listeners.window), dispatchEvent() { return true; },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    setTimeout: (f, ms, ...a) => unref(setTimeout(f, ms, ...a)), clearTimeout, setInterval: (f, ms, ...a) => unref(setInterval(f, ms, ...a)), clearInterval,
    requestAnimationFrame: (f) => unref(setTimeout(f, 0)), cancelAnimationFrame: clearTimeout, queueMicrotask,
    navigator: { userAgent: 'node', clipboard: { writeText: async () => {} }, share: undefined, onLine: true, language: 'en-GB', languages: ['en-GB'] },
    history: { pushState() {}, replaceState() {}, back() {}, state: null }, screen: { width: 390, height: 800 },
    scrollTo() {}, scroll() {}, open() { return null; }, print() {}, getComputedStyle: () => ({ getPropertyValue: () => '' }), getSelection: () => null,
    alert() {}, confirm: () => false, prompt: () => null,
    // Node builtins the scripts reach by bare name; a vm context starts with only the ECMAScript ones.
    console, crypto: globalThis.crypto, TextEncoder, TextDecoder, URL, URLSearchParams, btoa, atob, Blob, File: globalThis.File, FormData, Headers, Request, Response,
    AbortController, structuredClone, performance, Intl, fetch: async () => { throw new Error('no network in the test harness'); },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Event: class Event { constructor(type) { this.type = type; } preventDefault() {} stopPropagation() {} },
    KeyboardEvent: class KeyboardEvent { constructor(type, init) { Object.assign(this, { type }, init || {}); } preventDefault() {} },
    HTMLElement: class {}, Element: class {}, Node: class {}, Image: class { constructor() { this.src = ''; } },
    FileReader: class { readAsText() {} readAsDataURL() {} readAsArrayBuffer() {} }, XMLHttpRequest: class { open() {} send() {} },
    MutationObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} disconnect() {} }, IntersectionObserver: class { observe() {} disconnect() {} },
    DOMParser: class { parseFromString() { return document; } }, Notification: { permission: 'default' },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }), render() {} },   // steward-root.jsx mounts into #root; here that is a no-op
  };
  window.window = window; window.self = window; window.top = window; window.parent = window; window.globalThis = window;
  return { window, document, localStorage, listeners };
}

// Names a browser defines and this harness may not — used only to WORD a failure: a ReferenceError naming one
// of these is a hole in fakeBrowser(), any other name is a free identifier in the console's own code.
export const BROWSER_GLOBALS = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'location', 'navigator', 'history', 'screen', 'alert', 'confirm', 'prompt', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'HTMLElement', 'Element', 'Node', 'Image', 'FileReader', 'XMLHttpRequest', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getComputedStyle', 'getSelection', 'scrollTo', 'open', 'print', 'self', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'ReactDOM', 'Capacitor', 'indexedDB', 'caches', 'Notification', 'speechSynthesis', 'ImageData', 'OffscreenCanvas', 'DOMParser', 'XMLSerializer', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'console', 'crypto', 'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'btoa', 'atob', 'Blob', 'File', 'FormData', 'Headers', 'Request', 'Response', 'AbortController', 'structuredClone', 'performance', 'fetch', 'WebSocket', 'Worker', 'AudioContext', 'MediaRecorder', 'HTMLCanvasElement', 'HTMLInputElement', 'DataTransfer', 'ClipboardItem']);

// Compile each console script the way build-steward-apk.sh does and run them all in one context whose global
// is `window`. Returns the value of `expr` evaluated in that context afterwards — e.g. '({ StewBackupModal })'.
// `vendor` lists plain (non-jsx) bundles to run first, as steward.html does — only ones that need no DOM and no
// network. vendor/finance-ledger.js is such a bundle; vendor/steward.js is not (sockets, storage, timers).
export function loadConsole({ React, window, expr, files = consoleScripts(), vendor = [] }) {
  window.React = React;
  const ctx = vm.createContext(window);
  for (const p of vendor) {
    try { vm.runInContext(readFileSync(new URL(p, ROOT), 'utf8'), ctx, { filename: p }); }
    catch (e) { throw new Error(p + ' does not load in the console’s shared scope: ' + (e && e.message)); }
  }
  for (const p of files) {
    const src = readFileSync(new URL(p, ROOT), 'utf8');
    // `--jsx=transform` on the CLI is `jsx: 'transform'` here: classic React.createElement output.
    const js = transformSync(src, { loader: 'jsx', jsx: 'transform', sourcefile: p }).code;
    try { vm.runInContext(js, ctx, { filename: p }); }
    catch (e) { throw new Error(p + ' does not load in the console’s shared scope (what a page of classic scripts is): ' + (e && e.message)); }
  }
  return vm.runInContext('(' + expr + ')', ctx, { filename: 'expr' });
}

// Tree helpers for tests: every node, and the strings in it.
export const nodes = (n, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => nodes(c, out)); return out; }
  out.push(n); (n.kids || []).forEach(c => nodes(c, out));
  if (n.props) for (const v of Object.values(n.props)) if (v && typeof v === 'object' && (v.kids || Array.isArray(v))) nodes(v, out);
  return out;
};
export const texts = (n) => nodes(n).flatMap(x => (x.kids || []).filter(k => typeof k === 'string' || typeof k === 'number').map(String));
