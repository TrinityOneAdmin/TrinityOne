// Run the SHIPPED vendor/fellowship.js in a vm, whole, with no network. NOT a test file.
//
// Why a whole-bundle load rather than lifting one function: displayFor() and its neighbours lean on module state
// (profiles, the church roster, the church's own name) that a lifted slice would have to re-invent, and a
// re-invented copy is how a test ends up asserting about something that is not the code (CLAUDE.md rule 3 and
// the "tests must drive shipped code" note). The bundle is an IIFE that ends by hanging itself on window.Fellowship,
// and it loads cleanly given a window-shaped object, a localStorage and a socket that never connects.
//
// `expose` names top-level bundle variables (esbuild keeps the source names for `var`s) to hand back, by
// splicing `window.__x = <name>;` in directly after the line that declares them. The anchor must match EXACTLY
// ONCE or this throws — a renamed variable is a loud failure here, never a silently-missing hook.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export function loadFellowship({ expose = [], storage = {} } = {}) {
  let src = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
  for (const name of expose) {
    const re = new RegExp('^( {2}var ' + name + ' = [^\\n]*;)$', 'gm');
    const hits = src.match(re) || [];
    if (hits.length !== 1) throw new Error(`fellowship-vm: expected exactly one declaration of ${name} in the bundle, found ${hits.length}`);
    src = src.replace(re, `$1 window.__x_${name} = ${name};`);
  }
  const store = { ...storage };
  const events = [];
  const win = {
    addEventListener() {}, removeEventListener() {}, dispatchEvent(e) { events.push(e); return true; },
    location: { search: '', href: 'http://localhost/', hostname: 'localhost', protocol: 'http:', origin: 'http://localhost' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    navigator: { onLine: true }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    // unref'd, so a timer the bundle starts at load can never keep the test process alive after the tests end
    setTimeout: (f, ms, ...a) => { const t = setTimeout(f, ms, ...a); if (t && t.unref) t.unref(); return t; }, clearTimeout, setInterval() { return 0; }, clearInterval() {},
  };
  const ctx = vm.createContext({
    ...win, console, crypto: globalThis.crypto, TextEncoder, TextDecoder, URL, Uint8Array, Date, Math, JSON, queueMicrotask,
    atob, btoa, AbortController, Promise,
    fetch: async () => { throw new Error('no network in this harness'); },
    WebSocket: class { constructor() { setTimeout(() => { try { this.onerror && this.onerror({}); this.onclose && this.onclose({}); } catch (e) {} }, 0); } close() {} send() {} },
    document: { addEventListener() {}, visibilityState: 'visible' },
  });
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.runInContext(src, ctx);
  const exposed = {};
  for (const name of expose) exposed[name] = ctx['__x_' + name];
  return { F: ctx.Fellowship, win: ctx, exposed, store, events };
}
