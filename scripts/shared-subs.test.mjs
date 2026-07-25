// One relay subscription, many callers. Drives the REAL _shared() out of the shipped bundle.
// Run: node --test scripts/shared-subs.test.mjs
//
// PERF (AUDIT-2026-07-24): several streams were opened TWICE because two screens each wanted them — sermons
// (Watch + Extras), the safety check and care requests (two panels each on Today, filtered differently from
// the same data). Every duplicate is a second REQ on the socket and a second full download of identical
// events: real money on a metered connection, and two slots against the relay's 64-subscriptions-per-connection
// cap — the cap that blanked every member's name once before.
//
// _shared() is pure (no relay, no DOM), so this executes the shipped implementation against a fake opener
// rather than modelling it. The properties that matter are all failure modes that would be invisible in the UI:
// a late joiner that never paints, a stream closed while someone is still listening, or one that never closes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

function realShared() {
  // esbuild rewrites the declaration (`const x = new Map()` -> `var x = /* @__PURE__ */ new Map()`), so match the
  // name rather than the source line. Each call gets a FRESH registry so the tests can't leak state into each other.
  assert.match(BUNDLE, /_sharedSubs\s*=\s*\/\* @__PURE__ \*\/ ?new Map\(\)|_sharedSubs = new Map\(\)/,
    '_sharedSubs missing from the shipped bundle — subscription sharing was removed');
  const fnAt = BUNDLE.indexOf('function _shared(');
  assert.notEqual(fnAt, -1, '_shared missing from the shipped bundle');
  let depth = 0, end = -1;
  for (let i = BUNDLE.indexOf('{', fnAt); i < BUNDLE.length; i++) {
    const c = BUNDLE[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.notEqual(end, -1);
  return new Function('console', 'const _sharedSubs = new Map();\n' + BUNDLE.slice(fnAt, end) + '; return _shared;')(console);
}

// a fake stream: records how many times it was opened and closed, and lets the test push values
function fakeStream() {
  const st = { opens: 0, closes: 0, emit: null };
  return [st, (emit) => { st.opens++; st.emit = emit; return () => { st.closes++; }; }];
}

test('two callers on the same key open ONE underlying stream', () => {
  const _shared = realShared();
  const [st, open] = fakeStream();
  const a = [], b = [];
  const off1 = _shared('k1', open)(v => a.push(v));
  const off2 = _shared('k1', open)(v => b.push(v));
  assert.equal(st.opens, 1, 'the second caller must reuse the first stream, not open another REQ');
  st.emit(['x']);
  assert.deepEqual(a, [['x']], 'first caller fed');
  assert.deepEqual(b, [['x']], 'second caller fed from the SAME stream');
  off1(); off2();
});

test('a late joiner paints immediately from the shared buffer', () => {
  const _shared = realShared();
  const [st, open] = fakeStream();
  const sub = _shared('k2', open);
  const first = [];
  const off1 = sub(v => first.push(v));
  st.emit(['already', 'here']);
  const late = [];
  const off2 = sub(v => late.push(v));   // joins AFTER the data arrived
  assert.deepEqual(late, [['already', 'here']],
    'a late joiner got nothing — its screen would sit empty until the next event, which may never come');
  off1(); off2();
});

test('the stream stays open while ANYONE is listening, and closes when the last one leaves', () => {
  const _shared = realShared();
  const [st, open] = fakeStream();
  const sub = _shared('k3', open);
  const off1 = sub(() => {});
  const off2 = sub(() => {});
  off1();
  assert.equal(st.closes, 0, 'closing on the first unsubscribe would kill a stream another screen is still using');
  off2();
  assert.equal(st.closes, 1, 'the stream must close when the last caller leaves, or it leaks a REQ forever');
});

test('unsubscribing twice is harmless, and a later caller gets a FRESH stream', () => {
  const _shared = realShared();
  const [st, open] = fakeStream();
  const off = _shared('k4', open)(() => {});
  off(); off();
  assert.equal(st.closes, 1, 'a double unsubscribe must not close twice');
  const got = [];
  const off2 = _shared('k4', open)(v => got.push(v));
  assert.equal(st.opens, 2, 'after full teardown the next caller must open a new stream, not reuse a dead one');
  st.emit(['fresh']);
  assert.deepEqual(got, [['fresh']]);
  off2();
});

test('different keys stay independent', () => {
  const _shared = realShared();
  const [stA, openA] = fakeStream();
  const [stB, openB] = fakeStream();
  const a = [], b = [];
  const offA = _shared('sermons|church1', openA)(v => a.push(v));
  const offB = _shared('sermons|church2', openB)(v => b.push(v));
  assert.equal(stA.opens, 1); assert.equal(stB.opens, 1);
  stA.emit(['one']);
  assert.deepEqual(a, [['one']]);
  assert.deepEqual(b, [], 'a different church must not receive another church’s stream');
  offA(); offB();
});

test('one caller throwing does not starve the others', () => {
  const _shared = realShared();
  const [st, open] = fakeStream();
  const sub = _shared('k5', open);
  const good = [];
  const off1 = sub(() => { throw new Error('screen blew up'); });
  const off2 = sub(v => good.push(v));
  st.emit(['still delivered']);
  assert.deepEqual(good, [['still delivered']], 'a throwing subscriber must not stop the rest of the app updating');
  off1(); off2();
});

test('two callers passing the SAME function reference do not collapse', () => {
  // A Set of callbacks silently merged them, so the first unsubscribe closed the stream under a screen that was
  // still mounted — a silent empty list. Screens do pass stable setState identities, so this is reachable.
  const _shared = realShared();
  const [st, open] = fakeStream();
  const sub = _shared('k6', open);
  const seen = [];
  const cb = v => seen.push(v);
  const off1 = sub(cb);
  const off2 = sub(cb);          // same reference
  off1();
  assert.equal(st.closes, 0, 'the stream must stay open for the second caller');
  st.emit(['still live']);
  assert.ok(seen.some(v => v[0] === 'still live'), 'the surviving caller must still receive events');
  off2();
  assert.equal(st.closes, 1);
});

test('a stream that fails to open does not poison the key', () => {
  const _shared = realShared();
  let attempts = 0;
  const boom = () => { attempts++; throw new Error('relay unreachable'); };
  assert.throws(() => _shared('k7', boom)(() => {}), /relay unreachable/);
  // a later caller must get a FRESH attempt, not an entry with no stream behind it
  const [st, ok] = fakeStream();
  const got = [];
  const off = _shared('k7', ok)(v => got.push(v));
  assert.equal(st.opens, 1, 'the retry must actually open a stream');
  st.emit(['recovered']);
  assert.deepEqual(got, [['recovered']]);
  off();
});
