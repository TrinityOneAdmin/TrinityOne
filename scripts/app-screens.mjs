// Load the member app's screens in Node the way the phone loads them, so a test can MOUNT a component.
//
// This is the member-app analogue of console-screens.mjs (see that file's header for the full rationale).
// The member app's composition root is App in app/app.jsx. It wires vendor/fellowship.js's subscriptions
// (safeguarding, check-in, guardian notices) to React state. T-3 of the 2026-09-27 audit found that all
// four wiring points can be deleted with the suite green — the engine tests cover the engine and the screen
// tests take fixtures, but the line joining them is untested. This module closes that gap.
//
// The app's scripts are classic-mode <script type="text/babel"> loaded in index.html order, sharing one
// global scope. esbuild compiles the JSX the same way the APK build does (--jsx=transform → React.createElement).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { fakeReact, fakeBrowser, nodes, texts, BROWSER_GLOBALS } from './console-screens.mjs';

const ROOT = new URL('../', import.meta.url);

export function appScripts() {
  const html = readFileSync(new URL('index.html', ROOT), 'utf8');
  const out = [];
  for (const m of html.matchAll(/<script type="text\/babel" src="(app\/[^"]+\.jsx)"><\/script>/g)) out.push(m[1]);
  if (!out.length) throw new Error('index.html lists no text/babel scripts — re-anchor app-screens.mjs');
  return out;
}

export function fakeFellowship(overrides = {}) {
  const base = { myPubkey: null, ...overrides };
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : (typeof k === 'symbol' || k === 'then') ? undefined : () => undefined),
    has: (t, k) => k in t || typeof k === 'string',
  });
}

export function appBrowser({ Fellowship = fakeFellowship(), TrinityBackup = {} } = {}) {
  const { window, document, localStorage, listeners } = fakeBrowser({ TrinityBackup });
  window.Fellowship = Fellowship;
  // The member app uses window.Capacitor for native checks
  window.Capacitor = { isNativePlatform: () => false, Plugins: {} };
  // The member app reads identity state from localForage / trinityone.* keys
  window.localforage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {}, keys: async () => [] };
  // location for the member app
  window.location = { href: 'https://app.example/', origin: 'https://app.example', host: 'app.example', hostname: 'app.example', protocol: 'https:', pathname: '/', search: '', hash: '', reload() {}, replace() {}, assign() {} };
  return { window, document, localStorage, listeners };
}

export function loadApp({ React, window, expr, files = appScripts(), vendor = [] }) {
  window.React = React;
  const ctx = vm.createContext(window);
  for (const p of vendor) {
    try { vm.runInContext(readFileSync(new URL(p, ROOT), 'utf8'), ctx, { filename: p }); }
    catch (e) { throw new Error(p + ' does not load in the member app scope: ' + (e && e.message)); }
  }
  for (const p of files) {
    const src = readFileSync(new URL(p, ROOT), 'utf8');
    const js = transformSync(src, { loader: 'jsx', jsx: 'transform', sourcefile: p }).code;
    try { vm.runInContext(js, ctx, { filename: p }); }
    catch (e) { throw new Error(p + ' does not load in the member app scope: ' + (e && e.message)); }
  }
  return vm.runInContext('(' + expr + ')', ctx, { filename: 'expr' });
}

export { fakeReact, fakeBrowser, nodes, texts, BROWSER_GLOBALS };
