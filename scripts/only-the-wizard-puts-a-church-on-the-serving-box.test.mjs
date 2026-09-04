// THE BOX SERVING THE CONSOLE BECOMES A REGISTRATION TARGET ONLY WHEN A STEWARD DELIBERATELY CREATES A
// CHURCH ON IT — from the setup wizard's name step, and from nowhere else.
// Run: node --test scripts/only-the-wizard-puts-a-church-on-the-serving-box.test.mjs
//
// Owner's decision, 2026-09-04. The previous cut seeded selfRegister's `bases` from _ownOrigin()
// unconditionally, so that a console whose cache said "this box is not ours" could still reach the box that
// served it. The cost: on a COMMUNITY box that accepts self-registration, the boot-time re-announce
// (steward-root's selfRegister('') and the name-resolved effect in stew-dashboard) planted an unsolicited
// row, _refreshBoxHostsUs then answered "yes" at the next unlock, and the console started PUBLISHING to a box
// nobody chose — which defeats the serves-but-does-not-hold check that probe exists for.
//
// So the seed is an opt-in: `selfRegister(name, { createHere: true })`. The wizard passes it. The boot
// calls do not.
//
// TWO HALVES, BOTH EXECUTED (rule 1, rule 3):
//   * the SCREEN: the real `saveName` out of app/stew-dashboard.jsx is sliced and RUN, and what it hands
//     selfRegister is recorded — not text-matched, because that file ships unbundled and `false && ` in
//     front of a condition leaves every word in place;
//   * the ENGINE: the shipped selfRegister (vendor/steward.js), lifted and run in the poisoned state where
//     configBase() names the pool, with and without the flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEW = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const ORIGIN = 'http://127.0.0.1:8000';
const POOL = 'https://app.trinityone.church';

// ── the screen ──────────────────────────────────────────────────────────────────────────────────────────
// Take `saveName`'s arrow function, from its `async (` to the brace that closes it.
function sliceSaveName(src) {
  const at = src.indexOf('const saveName = async () => {');
  assert.notEqual(at, -1, 'saveName is missing — re-anchor this test rather than widening the window');
  const arrow = src.indexOf('async () => {', at);
  const open = src.indexOf('{', arrow);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i < src.length, 'saveName never closes — the brace walk ran off the end');
  const body = src.slice(arrow, i + 1);
  assert.ok(body.length > 200, 'saveName sliced to a stub — re-anchor rather than widening');
  return body;
}

test('THE SCREEN: the wizard\'s name step asks selfRegister to put the church on THIS box', async () => {
  const calls = [];
  const scope = {
    name: 'St Columba, created here',
    church: { name: '', nip05: '' },
    setBusy: () => {},
    next: () => {},
    window: { Steward: {
      selfRegister: async (n, opts) => { calls.push({ n, opts }); return { ok: true }; },
      publishProfile: async () => true,
      ensureJoinPolicy: async () => true,
    } },
  };
  const fn = new Function('scope', `with (scope) { return (${sliceSaveName(STEW)}); }`)(scope);
  await fn();
  assert.equal(calls.length, 1, 'saveName registered ' + calls.length + ' times');
  assert.equal(calls[0].n, 'St Columba, created here');
  assert.equal(calls[0].opts && calls[0].opts.createHere, true,
    'the wizard called selfRegister without `createHere`, so the box the steward is sitting at is not among ' +
    'the relays the church registers with. On a Suite box whose early probe cached "not ours", configBase() ' +
    'names the pool, and the one action that could put the church on its own box is aimed everywhere else. ' +
    'Called with: ' + JSON.stringify(calls[0].opts));
});

// ── the engine ──────────────────────────────────────────────────────────────────────────────────────────
function liftSelfRegister({ configBase }) {
  const posts = [];
  const stubs = {
    churchSk: new Uint8Array(32).fill(7), churchPub: 'PUB', pub: 'PUB', actingChurch: null,
    _regNeedsName: false, _armRegGate: () => {}, _openRegGate: () => {}, _markRegOk: () => {},
    npubEncode: (p) => 'npub_' + p,
    CANONICAL_RELAYS: ['wss://app.trinityone.church/relay'],
    SELFREG_KEY: 'sr',
    finalizeEvent: (e) => ({ ...e, id: 'evt', sig: 'sig', pubkey: 'PUB' }),
    now: () => 1788500000,
    _ownOrigin: () => ORIGIN,
    window: { Steward: { configBase: () => configBase }, dispatchEvent: () => true },
    localStorage: { getItem: () => '{}', setItem: () => {} },
    AbortSignal: { timeout: () => undefined },
    _boxHostsUs: false, lsSet: () => {}, _boxHostsKey: () => 'bh',
    _gate: { refresh: () => Promise.resolve([]) }, relaysRaw: () => [],
    fetch: async (u) => { posts.push(String(u).replace(/\/config$/, '')); return { ok: true, json: async () => ({}) }; },
  };
  const proxy = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted selfRegister needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const body = fnBody(VENDOR, 'async selfRegister(name, opts) {', 'selfRegister');
  const fn = new Function('scope', `with (scope) { return ({ ${body} }).selfRegister; }`)(proxy);
  return { posts, run: (name, opts) => fn.call({}, name, opts) };
}

test('THE ENGINE: without the opt-in, the serving box is NOT a registration target', async () => {
  // The state that matters: the box's probe said "not ours" (or the church simply does not live here), so
  // configBase() names the pool. A boot-time re-announce must go to the pool and leave this box alone.
  const h = liftSelfRegister({ configBase: POOL });
  await h.run('St Columba of the Test');
  assert.ok(!h.posts.includes(ORIGIN),
    'a plain selfRegister — the shape of every boot-time call — registered the church with the box that ' +
    'happens to be serving the console. On a community box that accepts self-registration this plants an ' +
    'unsolicited row, the next unlock\'s probe answers "yes", and the console starts publishing to a box ' +
    'nobody chose. Posted to: ' + JSON.stringify(h.posts));
  assert.ok(h.posts.includes(POOL), 'staging: the pool was still registered with — ' + JSON.stringify(h.posts));
});

test('THE ENGINE: with the opt-in, the serving box IS a registration target, even when configBase() names the pool', async () => {
  const h = liftSelfRegister({ configBase: POOL });
  await h.run('St Columba of the Test', { createHere: true });
  assert.ok(h.posts.includes(ORIGIN),
    'the wizard asked for the church to be put on this box and selfRegister did not ask the box. Posted to: ' + JSON.stringify(h.posts));
});

test('CONTROL: the opt-in changes WHERE, not WHETHER — `force` and `createHere` are separate switches', async () => {
  // `force` re-registers with relays already marked done; it must not have grown a side effect of seeding
  // the origin, and `createHere` must not have grown one of ignoring the done-marks.
  const h = liftSelfRegister({ configBase: POOL });
  await h.run('St Columba of the Test', { force: true });
  assert.ok(!h.posts.includes(ORIGIN), '`force` seeded the serving box — that is `createHere`\'s job. Posted to: ' + JSON.stringify(h.posts));
});
