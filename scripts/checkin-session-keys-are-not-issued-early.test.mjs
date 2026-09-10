// THE ISSUER IS WIRED, AND IT MUST NOT FIRE BEFORE THE ENVELOPES HAVE BEEN READ.
//   Run: node --test scripts/checkin-session-keys-are-not-issued-early.test.mjs
//
// Piece 3 of reference/SCOPE-CHECKIN-SEALING-2026-09-10.md. Both halves of the check-in session-key issuer
// had NO product caller until this change: `grep -rl issueCheckinSessionKeys app/` and `grep -rl
// subscribeCheckinSessionKeys app/` both returned nothing, so a steward could clear somebody for children's
// work and no key was ever minted for them, on any Sunday, for ever (CLAUDE.md rule 1).
//
// ⚠ WHAT WIRING IT NAIVELY WOULD HAVE COST, which is why this file exists and is named for the race rather
// than the feature. `issueCheckinSessionKeys` recovers a session's EXISTING key out of the envelope list
// `subscribeCheckinSessionKeys` delivers. Handed a list that is merely empty-so-far, every branch of the
// issuer reads "this Sunday has no envelope", publishes one, and mints a FRESH key — rotating the session's
// key and orphaning everything already sealed under the old one. The register goes on painting normally,
// because the church's own ring copy in `content` is untouched: only the helper's copy dies, and nothing
// anywhere says so. An effect firing on mount, on a reconnect, or on a clearance edit is exactly where that
// lands, and the empty list it passes is indistinguishable at the call site from a church that has none.
//
// TWO HALVES, BOTH DRIVEN:
//   • THE ENGINE — subscribeCheckinSessionKeys, issueCheckinSessionKeys, publishCheckinHelpers and
//     checkinSessionKeysSettled, LIFTED OUT OF vendor/steward.js (the bundle the console loads) and run
//     against one shared scope, so the flag the subscription writes is the flag the issuer reads. The
//     builders and the window/permission maths come from scripts/checkin-role-source.mjs, the module esbuild
//     inlines into that bundle. What is stubbed is the world — the key, the clock, the socket — never a
//     decision a test here is named after (memory: stub-answers-the-question).
//   • THE SCREEN — CheckinSessionKeys, sliced out of app/stew-dashboard.jsx by brace-match and compiled with
//     the same esbuild the packaged build uses, then rendered through miniReact (which runs useEffect with
//     real deps comparison). CLAUDE.md rule 3 forbids asserting any of this by matching text in an
//     app/*.jsx file: those ship unbundled, so `false && ` in front of the gate leaves every word of it in
//     place and a text assertion still passes.
//
// A NOTE ON THE HOUSE SCAFFOLD, because it fails silently. `fnBody()` returns the WHOLE function including
// its signature, and the lift wraps it in an OBJECT LITERAL — `({ <body> }).name`. Nest it inside another
// wrapper and nothing runs while every negative assertion passes vacuously. So every harness here carries a
// `probe` of counters, and the positive tests assert the probe was ENTERED. A negative test whose harness
// never reached the code is not a negative test.
//
// NO FIXED PORTS AND NO RELAY. Nothing here binds a socket, so it cannot collide with the suite's
// hard-coded-port tests (console-publish-honesty.test.mjs and relay-church-scope.test.mjs already collide
// with each other on 8993 — pre-existing, and nothing to do with this file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody, stmt } from './test-slice.mjs';
import { miniReact, texts } from './render-jsx-screen.mjs';
import { buildHelperGrant, helperPolicy, lifetimeWindow, eligibleHelpers, GRANT_SOURCE, KEY_LEAD_SECONDS,
         permittedHelpers, permissionPolicy, permissionWindow, buildCheckinPermission, readCheckinPermission,
         readHelperGrant, PERMISSION_LIFETIMES } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const VENDOR = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const APP = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const CHURCH = 'c'.repeat(64);
const OTHER = '9'.repeat(64);     // a second church, for the switch case
const SGLEAD = 'a'.repeat(64);
const ADA = 'd'.repeat(64);
const BEN = 'f'.repeat(64);
const SERVICE = { date: '2026-09-13', time: '10:30' };
const SERVICE_2 = { date: '2026-09-20', time: '10:30' };
const AT = 1789200000;            // the Saturday before SERVICE — passed explicitly, never taken from a clock
const svc = (id, service) => ({ id, ...service });
// A CLEARANCE, built by the SHIPPED builder and read back through the SHIPPED parser, never restated here —
// so if the two ever stop agreeing with each other these tests go red rather than testing a fiction.
const perm = (who) => readCheckinPermission(JSON.stringify(buildCheckinPermission({
  person: who, source: 'steward', lifetime: 'open', from: 1000, until: null })));
const CLEARED = [perm(ADA)];

function proxyOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      // esbuild RENAMES on collision — `finalizeEvent` is `finalizeEvent2` in this bundle, `nip44e`/`nip44ck`
      // resolve to `encrypt3`/`getConversationKey`. Stub only the src/ spellings and every wrap throws a
      // ReferenceError that buildHelperGrant catches PER RECIPIENT, yielding an envelope with an empty `keys`
      // object — against which "X is not in keys" passes vacuously. Documented at
      // checkin-helper-mint-is-the-shipped-one.test.mjs:120.
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted issuer needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

// ── THE ENGINE HARNESS ────────────────────────────────────────────────────────────────────────────────────
// One console's worth of world, and ONE scope shared by the subscription and the issuer — which is the whole
// point: `_ckKeysSettled` is module state in the console, so a harness giving each lifted function its own
// copy would make the gate untestable by construction.
function engine({ authed = true, publishOk = true, delegated = null } = {}) {
  let keyNonce = 0;
  const published = [];
  const banners = [];
  const subs = [];
  // THE COUNTERS THAT PROVE THIS HARNESS ENTERED THE CODE. See the note at the head of the file.
  const probe = { opened: 0, unwrapped: 0, published: 0, eose: 0 };
  const stubs = {
    sk: new Uint8Array(32).fill(9),
    pub: CHURCH,
    churchPub: delegated || CHURCH,
    churchSkHeld: () => !delegated,
    actingChurch: delegated ? CHURCH : null,
    _stewardCaps: { [SGLEAD]: ['safeguarding'] },
    _stewardNames: {},
    now: () => AT,
    NET: 'trinityone',
    CHECKINHELPER_D: D.CHECKINHELPER,
    // ⚠ THE FLAG UNDER TEST, and it starts EMPTY — a console that has not read anything. Nothing in this file
    // sets it by hand: it is set only by the lifted subscription's own oneose, which is the code the tests
    // are about. A harness that pre-set it would be the test answering its own question.
    _ckKeysSettled: '',
    _isRelayAuthed: () => { return authed; },
    // THE REAL DECISION-MAKERS, out of the module esbuild inlines into the bundle under test.
    buildHelperGrant, helperPolicy, lifetimeWindow, eligibleHelpers, GRANT_SOURCE, KEY_LEAD_SECONDS,
    permittedHelpers, permissionPolicy, permissionWindow, buildCheckinPermission, readCheckinPermission,
    PERMISSION_LIFETIMES,
    // A COUNTER, NOT A CONSTANT — two sessions must get DIFFERENT keys, or "the key was preserved" cannot fail.
    crypto: { getRandomValues: (u8) => { u8.fill(0x5a + (keyNonce++)); return u8; } },
    _hex: (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join(''),
    // NIP-44 stands in for itself: a recipient-labelled wrapper, so "who can open which slot" stays provable
    // without real crypto. It decides nothing about who is in the envelope. Named twice — see proxyOf.
    nip44ck: (_sk, p2) => 'ck:' + p2,
    nip44e: (plaintext, ck) => 'sealed[' + ck + ']' + plaintext,
    getConversationKey: (_sk, p2) => 'ck:' + p2,
    encrypt: (plaintext, ck) => 'sealed[' + ck + ']' + plaintext,
    nip44d: (ct, ck) => { probe.unwrapped++; const pre = 'sealed[' + ck + ']';
      if (String(ct).indexOf(pre) !== 0) throw new Error('wrong key'); return String(ct).slice(pre.length); },
    decrypt: (ct, ck) => stubs.nip44d(ct, ck),
    finalizeEvent: (e) => ({ ...e, id: 'evt' + published.length, pubkey: stubs.pub, sig: 'sig' }),
    _publishToRelays: async (e) => { probe.published++; published.push(e); return publishOk; },
    relays: () => ['wss://relay.test/relay'],
    pool: { subscribeMany: (_relays, filters, handlers) => { probe.opened++; subs.push({ filters, handlers }); return { close() {} }; } },
    _warnUnsealed: () => {},
    _ckRotateWarned: new Set(),
    window: { dispatchEvent: (e) => { banners.push((e && e.detail) || {}); return true; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
  };
  const scope = proxyOf(stubs);
  // CAP_KEYS and _capAllows out of the bundle, with NO harness scope: both are closed over nothing, so
  // handing them one could only let a stub leak into the rule that decides who holds the register's key.
  const lifted = new Function(`${stmt(VENDOR, 'var CAP_KEYS = {', 'CAP_KEYS')} ${stmt(VENDOR, 'var _capAllows = (spec, caps) =>', '_capAllows')} return { CAP_KEYS, _capAllows };`)();
  stubs.CAP_KEYS = lifted.CAP_KEYS;
  stubs._capAllows = lifted._capAllows;
  assert.equal(stubs.CAP_KEYS.checkin.cap, 'safeguarding', 'lifted CAP_KEYS is not the shipped one — re-anchor');
  const liftScoped = (sig, name) => new Function('scope', `with (scope) { return (${stmt(VENDOR, sig, name).replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '')}); }`)(scope);
  stubs._ckIssuerHeld = liftScoped('var _ckIssuerHeld = () =>', '_ckIssuerHeld');
  stubs._warnCheckinKeyRotated = liftScoped('var _warnCheckinKeyRotated = (sessions) =>', '_warnCheckinKeyRotated');
  const lift = (sig, name) => {
    const body = fnBody(VENDOR, sig, name);
    // ⚠ THE OBJECT-LITERAL WRAPPER, NOT A NESTED FUNCTION. fnBody returns the signature too, so
    // `({ <body> }).name` is the only shape that yields a callable. See the head of this file.
    return new Function('scope', `with (scope) { return ({ ${body} }).${name}; }`)(scope);
  };
  const mint = lift('async publishCheckinHelpers(opts) {', 'publishCheckinHelpers');
  const issue = lift('async issueCheckinSessionKeys(opts) {', 'issueCheckinSessionKeys');
  const readKeys = lift('subscribeCheckinSessionKeys(cb) {', 'subscribeCheckinSessionKeys');
  const settledFn = lift('checkinSessionKeysSettled() {', 'checkinSessionKeysSettled');
  const self = { publishCheckinHelpers: (o) => mint.call({}, o) };
  // OPEN THE SHIPPED SUBSCRIPTION and hand back its handlers, so a test can choose to fire EOSE or NOT —
  // which is the difference every test in this file turns on. Nothing here reproduces what the subscription
  // means by an envelope, a stand-down, or an end-of-stored-events.
  const openKeys = () => {
    let rows = null;
    const stop = readKeys.call({}, (r) => { rows = r; });
    const sub = subs[subs.length - 1];
    assert.ok(sub, 'the lifted subscription never opened one — the pool stub was not reached, so this ' +
      'harness is running nothing (see the fnBody note at the head of this file)');
    return {
      deliver(events) { for (const e of events) sub.handlers.onevent(e); return rows; },
      eose() { probe.eose++; sub.handlers.oneose(); return rows; },
      rows: () => rows,
      stop,
    };
  };
  return { stubs, published, banners, subs, probe, openKeys,
    settled: () => settledFn.call({}),
    publishCheckinHelpers: (o) => mint.call({}, o),
    issueCheckinSessionKeys: (o) => issue.call(self, o) };
}

// A REAL ENVELOPE EVENT, produced by the SHIPPED mint and re-signed as the relay would deliver it, so what
// the subscription is fed is what a console would actually receive. Never a hand-typed body: an envelope
// shape only a test can produce proves nothing about a console.
async function envelopeEvent(h, session, service, permissions, existingKeyHex) {
  const before = h.published.length;
  const res = await h.publishCheckinHelpers({ session, service, permissions, stewards: [SGLEAD],
    at: undefined, sessionKeyHex: existingKeyHex });
  assert.ok(res, 'fixture: the shipped mint refused to build the envelope this test needs');
  const ev = h.published[before];
  h.published.length = before;                      // the fixture's own publish is not the pass under test
  h.probe.published = 0;                            // …and neither is its probe count
  return { ...ev, created_at: AT - 3600, pubkey: CHURCH };
}

// ── 1. THE GATE ───────────────────────────────────────────────────────────────────────────────────────────

test('THE ISSUER REFUSES BEFORE EOSE — and the same call, after it, REUSES the key instead of rotating it', async () => {
  const h = engine();
  // A church that already has an envelope for this Sunday, minted the ordinary way.
  const ev = await envelopeEvent(h, 'svc-a', SERVICE, CLEARED);
  const key0 = JSON.parse(ev.content).keys[CHURCH];
  assert.ok(key0, 'fixture: the envelope has no church slot, so there would be nothing to recover');

  const stream = h.openKeys();
  stream.deliver([ev]);                             // the event has ARRIVED…
  // …AND NOTHING HAS EOSE'd. This is the state an effect firing on mount lands in.
  assert.equal(h.settled(), false,
    'a console reported its session-key corpus as READ after one event and no end-of-stored-events. That is ' +
    'the answer that makes the issuer mint a fresh key over a live one');
  const early = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [...CLEARED, perm(BEN)], stewards: [SGLEAD], existing: stream.rows() });
  assert.equal(early.settled, false,
    'THE ISSUER RAN ON AN UNFINISHED READ. It would have re-minted svc-a with a FRESH key, orphaning the ' +
    'helper copy of every record already written into that session, with the register still painting: ' +
    JSON.stringify(early));
  assert.deepEqual(h.published, [],
    'and it reached the wire. Nothing about this failure is visible on any screen: the ring copy in `content` ' +
    'is untouched, so only the helper\'s copy dies');
  assert.equal(h.probe.published, 0, 're-anchor: the publish probe was never reachable in this harness');

  // NOW THE SAME CALL, AFTER EOSE. This is the positive control that stops the assertions above passing
  // vacuously: if the harness ran nothing, this half fails too.
  stream.eose();
  assert.equal(h.settled(), true, 'an AUTHENTICATED end-of-stored-events did not settle the corpus');
  const ok = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [...CLEARED, perm(BEN)], stewards: [SGLEAD], existing: stream.rows() });
  assert.equal(ok.settled, true, 'the issuer still refuses after a settled read');
  assert.equal(ok.issued.length, 1, 'adding a cleared person did not re-issue the envelope');
  assert.equal(ok.issued[0].reused, true,
    'THE RE-ISSUE MINTED A NEW SESSION KEY even though the envelope was in hand. This is the loss the gate ' +
    'exists to prevent, arriving through the other door');
  assert.deepEqual(ok.rotated, [], 'a re-issue that recovered the key was reported as a rotation');
  assert.equal(JSON.parse(h.published[0].content).keys[CHURCH], key0,
    'the church\'s own slot changed, so the key this console can recover next time is not the one already ' +
    'sealing records');
  assert.ok(h.probe.unwrapped > 0, 're-anchor: nothing ever unwrapped, so "it recovered the key" is vacuous');
});

test('AN UNAUTHENTICATED EOSE SETTLES NOTHING — nostr-tools counts a failed CONNECT as one', async () => {
  // THE HALF THAT LOOKS LIKE BELT-AND-BRACES AND IS NOT. A relay that never answers reaches oneose in
  // nostr-tools, and the relay answers an unauthenticated read of this church's documents with nothing at
  // all (its NIP-42 gate). So a plain EOSE can mean "this church has no envelopes" while it holds a year of
  // them — which is precisely the answer that rotates every key. subscribeCapKey has carried this rule since
  // the finance ring; this is the same rule on the same shape of state.
  const h = engine({ authed: false });
  const ev = await envelopeEvent(h, 'svc-a', SERVICE, CLEARED);
  const stream = h.openKeys();
  stream.deliver([ev]);
  stream.eose();
  assert.equal(h.probe.eose, 1, 're-anchor: this test never fired an end-of-stored-events at all');
  assert.equal(h.settled(), false,
    'an UNAUTHENTICATED end-of-stored-events was taken as "this church\'s envelopes have been read". Every ' +
    'session key in the church is one issuer run away from being replaced');
  const out = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [...CLEARED, perm(BEN)], stewards: [SGLEAD], existing: stream.rows() });
  assert.equal(out.settled, false, 'the issuer ran on an unauthenticated read');
  assert.deepEqual(h.published, [], 'and it reached the wire');
});

test('A CHURCH SWITCH UN-SETTLES IT — a stamp, not a boolean', async () => {
  // `_ckKeysSettled` holds WHICH church has been read, because a carried-across boolean answers "already
  // looked" for a church nobody has looked at. That is the same defect the *Checked flags were fixed for
  // twice (see _resetChurchScopedState), and here it re-mints instead of merely reading stale.
  const h = engine();
  const ev = await envelopeEvent(h, 'svc-a', SERVICE, CLEARED);
  const stream = h.openKeys();
  stream.deliver([ev]);
  stream.eose();
  assert.equal(h.settled(), true, 'fixture: this console was supposed to be settled before the switch');
  h.stubs.pub = OTHER;                              // the header toggle / a restore lands here
  assert.equal(h.settled(), false,
    'a console reported the church it just switched TO as read, on the strength of having read a different ' +
    'one. The first issuer run in the new church would re-mint every session it holds');
  const out = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: CLEARED, stewards: [SGLEAD], existing: [] });
  assert.equal(out.settled, false, 'the issuer issued for a church whose envelopes it had never read');
  assert.deepEqual(h.published, [], 'and it reached the wire');
});

test('A MID-STREAM SWITCH DOES NOT STAMP THE CHURCH WE LEFT', async () => {
  // The subscription captures the church it opened for, so an EOSE arriving after the toggle cannot mark the
  // previous church read — the same guard subscribeCapKey applies to _capState, and for the same reason.
  const h = engine();
  const stream = h.openKeys();
  h.stubs.pub = OTHER;
  stream.eose();
  assert.equal(h.stubs._ckKeysSettled, '',
    'an end-of-stored-events for the PREVIOUS church stamped a corpus as read. Switching back would then ' +
    'issue against whatever that stream had managed to deliver');
});

test('A STOOD-DOWN SUNDAY IS STILL NOT RE-STAFFED ONCE THE GATE IS IN — the two rules compose', async () => {
  // The gate must not have quietly re-opened the hole the stand-down fix closed on 2026-09-10. Both live in
  // issueCheckinSessionKeys and both key off `existing`, so this is the composition test rather than a
  // second copy of either.
  const h = engine();
  const ev = await envelopeEvent(h, 'svc-a', SERVICE, CLEARED);
  const tomb = { ...ev, created_at: AT - 60, tags: [['d', D.CHECKINHELPER + 'svc-a'], ['t', 'trinityone'],
    ['church', CHURCH], ['deleted', '1']], content: '' };
  const stream = h.openKeys();
  stream.deliver([ev, tomb]);
  stream.eose();
  assert.equal(h.settled(), true, 'fixture: the corpus was supposed to be settled here');
  const out = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: CLEARED, stewards: [SGLEAD], existing: stream.rows() });
  assert.ok(out.skipped.some(x => x.session === 'svc-a' && /stood down/.test(x.why)),
    'a Sunday the church stood down was re-staffed by the automatic issuer: ' + JSON.stringify(out));
  assert.deepEqual(h.published, [], 'and it published an envelope for it');
});

test('THE FALSE KEEPER WARNING IS GONE FROM THE SHIPPED BUNDLE', () => {
  // Text-matching is legitimate here and only here: vendor/*.js is bundled, so esbuild removes dead code and
  // a `false && ` in front of a condition takes its text with it. (Against app/*.jsx it proves nothing —
  // CLAUDE.md rule 3.)
  //
  // The sentence below shipped in a banner until 2026-09-10 and is a FALSE CLAIM under the owner's
  // double-locking decision: a safeguarding holder reads every record through the ring copy in `content`,
  // which no envelope touches, so being omitted from one costs her a duplicate of a body she can already
  // read — no access at all. It also prescribed re-issuing, which ROTATES keys.
  assert.doesNotMatch(VENDOR, /should be able to read what a helper writes, and cannot/,
    'the keeper warning is back in the bundle, telling a safeguarding steward she has lost access she still ' +
    'has and offering a remedy that rotates session keys (CLAUDE.md rule 4, applied to shipped copy)');
  assert.doesNotMatch(VENDOR, /_checkinKeepersMissing/,
    'the check that fed the false warning is back and has no caller — dead code under a banner nobody raises');
  // …and the re-aimed one IS there, so this test cannot pass by the whole feature having been deleted.
  assert.match(VENDOR, /_warnCheckinKeyRotated/, 're-anchor: the replacement warning is not in the bundle');
});

// ── 2. THE POINT OF USE — the screen a steward actually has ───────────────────────────────────────────────
// CLAUDE.md rule 1: at least one test must fail if the feature is deleted FROM THE SCREEN. Every assertion
// below drives the shipped component; none of them reads app/*.jsx as text.

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
function shown(n, pred, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => shown(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => shown(c, pred, out));
  return out;
}
const btn = (tree, label) => shown(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));
const said = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');

async function screen({ settled = true, held = true, name = 'St Mary\'s', keys = [], perms = CLEARED,
                        services = [svc('svc-a', SERVICE), svc('svc-b', SERVICE_2)], stewards = [SGLEAD],
                        result = { issued: [{ session: 'svc-a' }], skipped: [], failed: [], rotated: [], settled: true } } = {}) {
  const src = fnBody(APP, 'function CheckinSessionKeys() {', 'CheckinSessionKeys');
  const tmp = join(tmpdir(), 'cksk-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { CheckinSessionKeys };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const calls = [];
  const banners = [];
  const globals = {
    React,
    Panel: function Panel(p) { return React.createElement('div', { 'data-panel': p.title }, p.action, p.children); },
    DismissibleNote: function DismissibleNote(p) { return React.createElement('div', { 'data-note': p.id }, p.children); },
    Icon: Stub('Icon'),
    todayISO: () => SERVICE.date,          // "today" is the first of the two services, so both are in horizon
    window: {
      useStewardCheckinSessionKeys: () => keys,
      useStewardCheckinPermissions: () => perms,
      useStewardServices: () => services,
      useStewardStewards: () => stewards,
      useStewardChurch: () => ({ name }),
      useStewardIdv: () => 1,
      useStewardConn: () => 1,
      Steward: {
        // THE TWO READERS THE SCREEN'S GATE IS BUILT ON, both one-line readers of module state in the real
        // console. Stubbed here because this half is about WHETHER THE SCREEN ASKS — the engine half above
        // drives the flag itself, through the shipped subscription's own oneose.
        checkinSessionKeysSettled: () => settled,
        checkinIssuerHeld: () => held,
        stewardCaps: () => ({ [SGLEAD]: ['safeguarding'] }),
        issueCheckinSessionKeys: (o) => { calls.push(o); return Promise.resolve(result); },
      },
      dispatchEvent: (e) => { banners.push((e && e.detail) || {}); return true; },
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
    setTimeout, clearTimeout, console, Math, Date, JSON, Set, Number, String, Array, Promise, Object,
  };
  const key = '__cksk_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { CheckinSessionKeys } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  let tree = draw(CheckinSessionKeys, {});
  return {
    calls, banners,
    tree: () => tree,
    said: () => said(tree),
    redraw() { tree = draw(CheckinSessionKeys, {}); return tree; },
    press(label) {
      const bs = btn(tree, label);
      assert.ok(bs.length, 'no button labelled ' + JSON.stringify(label) + ' on this screen — re-anchor');
      bs[0].props.onClick();
      return bs.length;
    },
  };
}

test('POINT OF USE: opening the Check-in page ISSUES — this is the wiring the feature is', async () => {
  const s = await screen();
  // Awaiting a turn, because the effect's call is a promise the component does not block on.
  await Promise.resolve();
  assert.equal(s.calls.length, 1,
    'THE CONSOLE OPENED AND NO SESSION KEY WAS ISSUED. That is the state this whole change exists to end: ' +
    'a steward clears somebody for children\'s work and nothing ever mints them a key, on any Sunday');
  const o = s.calls[0];
  assert.deepEqual(o.services.map(x => x.id), ['svc-a', 'svc-b'],
    'the effect did not hand the issuer the sessions inside its horizon');
  assert.equal(o.permissions, s.tree() && o.permissions, 're-anchor');
  assert.ok(Array.isArray(o.permissions) && o.permissions.length === 1, 'the clearances were not passed at all');
  assert.deepEqual(o.stewards, [SGLEAD],
    'the steward roster was not passed, so no safeguarding lead is wrapped into any envelope. It is passed ' +
    'RAW (flat hex pubkeys, subscribeStewards\' own shape) because the mint decides who is eligible with ' +
    '_capAllows against CAP_KEYS.checkin — a screen filtering it would be a second copy of that rule');
  assert.ok(o.caps && typeof o.caps === 'object', 'the capability map was not passed, so no steward is a keeper');
  // AND THE COPY MUST NOT PROMISE MORE THAN THE TRIGGER DELIVERS. This component mounts only on the Check-in
  // tab, so "whenever this console is opened" would be a false claim: a church whose owner opens the console
  // weekly and never opens Check-in gets no keys. CLAUDE.md rule 4, applied to copy — the same failure the
  // deleted keeper warning was.
  assert.match(s.said(), /whenever you open this page/,
    'the panel does not say WHEN it issues, or says something wider than it does: ' + s.said());
});

test('POINT OF USE: IT PASSES THE ENVELOPES IT HOLDS AS `existing` — the other half of the race', async () => {
  // The gate stops the issuer running on an unfinished read. It cannot stop a caller that has finished
  // reading and then passes nothing: `existing: []` on a settled console is a rotation the engine has no way
  // to refuse, because it is indistinguishable from a church that genuinely holds no envelopes.
  const env = { session: 'svc-a', source: GRANT_SOURCE, lifetime: 'session', from: AT, until: AT + 7200,
    pubs: [ADA], keys: { [CHURCH]: 'x', [ADA]: 'y' }, ts: AT - 3600 };
  const s = await screen({ keys: [env] });
  await Promise.resolve();
  assert.equal(s.calls.length, 1, 'fixture: the effect was supposed to run once');
  assert.deepEqual(s.calls[0].existing, [env],
    'THE SCREEN ISSUED WITHOUT HANDING THE ISSUER THE ENVELOPES IT ALREADY HOLDS. Every session in the ' +
    'horizon is then re-minted with a FRESH key, which is the exact loss the EOSE gate exists to prevent — ' +
    'arriving through a screen that satisfied the gate and then withheld the answer');
});

test('POINT OF USE: IT DOES NOT ISSUE BEFORE THE ENVELOPES HAVE BEEN READ', async () => {
  const s = await screen({ settled: false });
  await Promise.resolve();
  assert.deepEqual(s.calls, [],
    'THE SCREEN ISSUED ON AN UNFINISHED READ. The engine refuses this too, so nothing is lost today — but a ' +
    'screen that fires early is a screen that will rotate every key the day that refusal is relaxed, and it ' +
    'tells the steward "issued" while the engine says "waiting"');
  assert.match(s.said(), /Still reading this church/,
    'and it does not say which of the two states it is in. "No key yet" and "the keys have not arrived" are ' +
    'different facts and one of them is a steward going looking for a fault that does not exist');
  // AND THE MANUAL CONTROL IS NOT LIVE EITHER, or the gate is one tap from being irrelevant.
  const b = btn(s.tree(), 'Re-issue');
  assert.ok(b.length, 're-anchor: there is no Re-issue control on this screen');
  assert.equal(b[0].props.disabled, true,
    'the manual Re-issue button was live while the corpus was still arriving — one tap re-mints every ' +
    'session in the horizon with a fresh key');
});

test('POINT OF USE: THE MANUAL RE-ISSUE CONTROL EXISTS AND WORKS', async () => {
  // The scope note asks for it by name. It is the answer to "a helper turned up and cannot open the
  // register" without waiting for a clearance edit or a reload.
  const s = await screen();
  await Promise.resolve();
  assert.equal(s.calls.length, 1, 'fixture: the mount effect was supposed to run once');
  s.press('Re-issue');
  await Promise.resolve();
  assert.equal(s.calls.length, 2,
    'the Re-issue button did not reach the issuer. A control that toasts nothing and does nothing is the ' +
    'defect this project has a name for (memory: fix-the-control-not-the-label)');
});

test('POINT OF USE: A DELEGATED CONSOLE SAYS SO IN PLAIN WORDS, AND DOES NOT ISSUE', async () => {
  // reference/SCOPE-CHECKIN-SEALING-2026-09-10.md, piece 3: "Say the real constraint on screen. Not 'a
  // console must open'." A church where only delegated stewards ever open a console gets NO session keys,
  // ever, and its cleared helpers are handed records their phone cannot open. Stated, not designed around —
  // whether a delegate should be able to mint is the owner's decision and has not been taken.
  const s = await screen({ held: false });
  await Promise.resolve();
  assert.deepEqual(s.calls, [],
    'a delegated console attempted to issue. The relay refuses it, and those refusals raise the sticky ' +
    '"this relay is set up for a different church" banner whose remedy destroys a church key (round 7)');
  const words = s.said();
  assert.match(words, /cannot issue session keys/,
    'the screen does not say that this console cannot issue at all: ' + words);
  assert.match(words, /church.{0,40}own console/i,
    'the screen does not say WHOSE console has to open — "a console must open" is the vague version the ' +
    'scope note rules out, because a delegate reads it as "mine will do": ' + words);
  assert.match(words, /cannot open/,
    'the screen does not say what it costs the people already cleared: they are handed records their phone ' +
    'cannot open, which looks nothing like being refused: ' + words);
  assert.equal(btn(s.tree(), 'Re-issue')[0].props.disabled, true, 'the manual control was live on a console that cannot mint');
});

test('POINT OF USE: AN UNNAMED CHURCH DOES NOT ISSUE, and is told why', async () => {
  // The same proxy for "this console's church actually exists" that the capability-key effect uses, and for
  // the same measured reason: a delegated steward viewing their OWN identity has `actingChurch` empty, so
  // without this the console mints envelopes keyed to the delegate's own pubkey — 28 refusals in round 7.
  const s = await screen({ name: '' });
  await Promise.resolve();
  assert.deepEqual(s.calls, [], 'a console with no published church name issued session keys');
  assert.match(s.said(), /has not published its name/, 'and it does not say why nothing is happening: ' + s.said());
});

test('POINT OF USE: A REFUSED SESSION IS SAID, and a stood-down one is not called a fault', async () => {
  const s = await screen({ result: { issued: [], skipped: [], rotated: [], settled: true,
    failed: [{ session: 'svc-a', why: 'the relay or the builder refused it' }] } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(s.banners.length, 1,
    'a session could not be given a register key and nothing was said. Every other write on this page is ' +
    'awaited and answered for the same reason: ' + JSON.stringify(s.banners));
  assert.match(s.banners[0].message, /cleared helper will not be able to open/,
    'the banner does not say what it costs: ' + s.banners[0].message);
  // A STOOD-DOWN SUNDAY IS A DECISION, NOT AN ABSENCE, and must not read as a missing key.
  const s2 = await screen({ keys: [{ session: 'svc-a', standDown: true, ts: AT }] });
  await Promise.resolve();
  assert.match(s2.said(), /Stood down/,
    'a Sunday the church stood down is shown as having no key, which reads as a fault to fix by re-issuing ' +
    '— and re-issuing is the one thing that must not re-staff it: ' + s2.said());
});

test('POINT OF USE: `settled:false` COMING BACK FROM THE ENGINE IS SHOWN AS A WAIT, not a failure', async () => {
  // The engine's refusal has its own shape, and the screen must be able to tell it from a refusal by the
  // relay. Conflating them raises a fault banner for an ordinary two-second wait on every cold start.
  const s = await screen({ result: { issued: [], skipped: [], failed: [], rotated: [], settled: false } });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(s.banners, [],
    'the engine said "still reading" and the screen raised a write-failure banner for it');
  assert.match(s.redraw() && s.said(), /Waiting for this church/, 'and it says nothing at all: ' + s.said());
});

test('POINT OF USE: A ROTATION IS REPORTED ON THE SCREEN, and does not overclaim', async () => {
  const s = await screen({ result: { issued: [{ session: 'svc-a' }], skipped: [], failed: [],
    rotated: ['svc-a'], settled: true } });
  await Promise.resolve();
  await Promise.resolve();
  const words = s.redraw() && s.said();
  assert.match(words, /new.{0,30}key/i,
    'the screen replaced a live session key and said nothing. It is the one consequential act the issuer ' +
    'takes that a steward can neither see nor undo: ' + words);
  // ⚠ AND NOT MORE THAN THAT. Nothing is sealed under a session key yet (piece 1 of the scope note is not
  // built), so copy claiming records were lost would be a false claim in shipped UI. When piece 1 lands this
  // must be inverted deliberately.
  assert.doesNotMatch(words, /lost|unreadable|orphan/i,
    'the screen claims records were lost. Nothing is sealed under a session key yet, so that is untrue today');
});

// ── 3. AND THE PAGE ACTUALLY RENDERS IT ───────────────────────────────────────────────────────────────────
// THE SHARPEST FORM OF CLAUDE.md RULE 1. Everything above drives CheckinSessionKeys directly, so all of it
// would stay green if `<CheckinSessionKeys />` were deleted from DashCheckin — the component would exist,
// fully tested, and no steward would ever see it or issue anything. That is the exact shape of the
// child-safety defect rule 1 was written for.
//
// So DashCheckin is sliced and RENDERED, with its siblings supplied as recording stubs. Its own children are
// stubs rather than the real components because the question here is one thing only: does the Check-in page
// put the issuer on the screen? Rule 3 forbids answering that by matching text in app/stew-dashboard.jsx.
test('THE CHECK-IN PAGE MOUNTS THE ISSUER PANEL — or none of the tests above is about anything a steward sees', async () => {
  const src = fnBody(APP, 'function DashCheckin() {', 'DashCheckin');
  const tmp = join(tmpdir(), 'ckdash-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashCheckin };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const rendered = [];
  const Mark = (n) => { const f = function () { rendered.push(n); return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
  const globals = {
    React,
    Panel: function Panel(p) { return React.createElement('div', { 'data-panel': p.title }, p.action, p.children); },
    DismissibleNote: function DismissibleNote(p) { return React.createElement('div', null, p.children); },
    Icon: Stub('Icon'),
    CheckinPicker: Mark('CheckinPicker'),
    CheckoutModal: Mark('CheckoutModal'),
    CheckinClearances: Mark('CheckinClearances'),
    CheckinSessionKeys: Mark('CheckinSessionKeys'),
    useStewNarrow: () => false,
    todayISO: () => SERVICE.date,
    window: {
      useStewardCheckins: () => [],
      useStewardSafeguard: () => ({ minors: [], approved: [], minorsKnown: true }),
      useStewardGuardians: () => ({}),
      useStewardMembers: () => [],
      useStewardServices: () => [svc('svc-a', SERVICE)],
      useStewardIdv: () => 1,
      useStewardConn: () => 1,
      Steward: { capKeyRing: () => ['k'], subscribeCapKey: () => () => {}, publishCheckin: async () => true },
      dispatchEvent: () => true,
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
    setTimeout, clearTimeout, console, Math, Date, JSON, Set, Number, String, Array, Promise, Object,
  };
  const key = '__ckdash_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { DashCheckin } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  draw(DashCheckin, {});
  assert.ok(rendered.includes('CheckinClearances'), 're-anchor: this render reached none of the page\'s panels');
  assert.ok(rendered.includes('CheckinSessionKeys'),
    'THE CHECK-IN PAGE DOES NOT RENDER THE SESSION-KEY PANEL. Every other test in this file drives that ' +
    'component directly and would stay green: the issuer would be wired, tested, and unreachable — nobody ' +
    'ever opens it, so no key is ever minted and no steward is ever told why. Rendered: ' + JSON.stringify(rendered));
});
