// Lifts the REAL relaySyncStates / relaySyncState / _nip98 out of the SHIPPED bundle (vendor/steward.js) under their
// bundle names, so a test runs what the console runs. Not a test file. Used by sync-failure-display-on-screen and the
// no-bleed test in sync-status-endpoint.
import { readFileSync } from 'node:fs';
import { finalizeEvent } from 'nostr-tools/pure';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
function scopeOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('the lifted code needs `' + String(k) + '` - add a stub'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
// opts: { sk, pub, relays: () => [...], fetch, viewingNetwork: () => bool, now: () => seconds }
export function liftSteward(opts) {
  const o = { viewingNetwork: () => false, now: () => Math.floor(Date.now() / 1000), ...opts };
  const stubs = {
    sk: o.sk, pub: o.pub, relays: o.relays, fetch: o.fetch, _viewingNetwork: o.viewingNetwork,
    _credNow: o.now, finalizeEvent, finalizeEvent2: finalizeEvent, btoa, JSON, Number, String, Promise, encodeURIComponent, Math, Date,
    window: { Steward: {} },
  };
  const nip98Src = fnBody(BUNDLE, 'function _nip98(url, method) {', '_nip98');
  stubs._nip98 = new Function('scope', 'with (scope) { return (' + nip98Src + '); }')(scopeOf(stubs));
  const st = fnBody(BUNDLE, '    relaySyncState(sync, church) {', 'relaySyncState');
  const sts = fnBody(BUNDLE, '    async relaySyncStates(onEach) {', 'relaySyncStates');
  const obj = new Function('scope', 'with (scope) { return ({ ' + st + ',\n' + sts + ' }); }')(scopeOf(stubs));
  stubs.window.Steward = obj;
  return { Steward: obj, stubs };
}
