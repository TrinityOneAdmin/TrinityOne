// RED TEAM PROBE — the CONSOLE half of the same question. Does the steward console still list a
// person as CLEARED after the steward who withdrew their clearance loses the safeguarding tick?
//
// The function under test is the SHIPPED subscribeCheckinPermissions, lifted out of vendor/steward.js
// (not re-implemented, not read). A counter proves the harness entered it.
// Run: node scripts/zz-redteam-console.probe.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fnBody } from './test-slice.mjs';
import { readCheckinPermission, buildCheckinPermission } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CHURCH = 'aa'.repeat(32);
const SGLEAD = 'bb'.repeat(32);
const ADA    = 'cc'.repeat(32);

let entered = 0;                     // ← proves the lifted code ran at all
let stewardCaps = { [SGLEAD]: ['safeguarding'] };

const subs = [];
const stubs = {
  pub: CHURCH,
  NET: 'trinityone',
  CHECKINPERM_D: D.CHECKINPERM,
  readCheckinPermission: (c) => { entered++; return readCheckinPermission(c); },
  _stewardCaps: {},                  // replaced below by the lifted _capsOf's own source
  relays: () => ['wss://relay.test/relay'],
  pool: { subscribeMany: (_r, filters, handlers) => { subs.push({ filters, handlers }); return { close() {} }; } },
};
// _capsOf comes OUT OF THE BUNDLE, so the console's own notion of "has this steward the tick" is the
// thing under test rather than my copy of it.
const proxyOf = (t) => new Proxy(t, {
  has: () => true,
  get: (o, k) => {
    if (k === Symbol.unscopables) return undefined;
    if (k in o) return o[k];
    const base = String(k).replace(/\d+$/, '');
    if (base in o) return o[base];
    if (k in globalThis) return globalThis[k];      // Map, JSON, Array, String…
    throw new ReferenceError('the lifted reader needs `' + String(k) + '` — add a stub');
  },
  set: (o, k, v) => { o[k] = v; return true; },
});
const scope = proxyOf(stubs);
stubs._stewardCaps = new Proxy({}, { get: (_t, k) => stewardCaps[k] });
const capsOfSrc = fnBody(VENDOR, 'function _capsOf(by) {', '_capsOf');
stubs._capsOf = new Function('scope', `with (scope) { ${capsOfSrc} return _capsOf; }`)(scope);

const body = fnBody(VENDOR, 'subscribeCheckinPermissions(cb) {', 'subscribeCheckinPermissions');
assert.ok(body.length > 400, 'the slice is a stub, not the function: ' + body.length + ' chars');
const subscribeCheckinPermissions =
  new Function('scope', `with (scope) { return ({ ${body} }).subscribeCheckinPermissions; }`)(scope);

let last = null;
subscribeCheckinPermissions((rows) => { last = rows; });
assert.equal(subs.length, 1, 'the lifted function never opened a subscription');
const deliver = (e) => subs[0].handlers.onevent(e);

const ev = (by, tags, content, at) => ({ pubkey: by, created_at: at, content, tags });
const permTags = [['d', D.CHECKINPERM + ADA], ['t', 'trinityone'], ['church', CHURCH], ['person', ADA]];
const tombTags = [['d', D.CHECKINPERM + ADA], ['t', 'trinityone'], ['church', CHURCH], ['deleted', '1']];
const permBody = JSON.stringify(buildCheckinPermission({
  person: ADA, source: 'steward', lifetime: 'open', from: 1788400000, until: null }));

// A. the CHURCH clears Ada
deliver(ev(CHURCH, permTags, permBody, 1788500000));
assert.ok(entered > 0, 'HARNESS NEVER ENTERED THE LIFTED CODE — every row below would be vacuous');
const A = last.length;

// B. the SAFEGUARDING STEWARD withdraws it
deliver(ev(SGLEAD, tombTags, '', 1788500100));
const B = last.length;

// C. the church takes safeguarding off that steward. Nothing is re-delivered; the console re-reduces
//    on the next event on this stream, which is exactly what a reconnect or any other clearance does.
stewardCaps = { [SGLEAD]: ['members'] };
deliver(ev(CHURCH, permTags, permBody, 1788500000));      // a replay of the church's own copy
const C = last.length;

console.log('entered readCheckinPermission %d time(s)', entered);
console.log('A. church cleared Ada                          -> rows =', A, '(baseline, expect 1)');
console.log('B. safeguarding steward withdrew it            -> rows =', B, '(expect 0)');
console.log('C. steward de-capped, stream re-reduces        -> rows =', C, '(expect 0)');
if (C === 1) console.log('\n>>> THE CONSOLE LISTS ADA AS CLEARED AGAIN. The withdrawal is gone from the screen.');
