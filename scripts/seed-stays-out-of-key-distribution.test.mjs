// A STALE PRELOAD SEED MUST NEVER REACH KEY DISTRIBUTION — fix/seed-authority, 2026-11-05.
// Run: node --test scripts/seed-stays-out-of-key-distribution.test.mjs
//
// Two ultrareview findings, verified against the code and fixed here:
//
//  #1 (serious): subscribeAdmitted / subscribeJoinPolicy painted their on-disk seed into the AUTHORITATIVE value.
//     On a genuine-empty relay (reset / wipe / fresh self-host box) the stale allowlist was then stamped FRESH and
//     handed to the key distributor, so room/care/name keys could reach people the church had dropped. The admitted
//     list is the key-distribution boundary (CLAUDE.md rule 10), so this is fail-OPEN. The fix keeps the seed
//     DISPLAY-ONLY (mirroring subscribeSafeguard's approvedSeed/expirySeed discipline): `cur` is relay-folded and
//     folds to [] on a genuine-empty answer (fail-CLOSED), and join-policy's authoritative `approval` stays relay-truth.
//
//  #3: subscribeDMConvos keyed its seed on `actingChurch || churchPub`, which in an owned-network view resolves to
//     the CHURCH while the subscription fetches the NETWORK's DMs — mixing the two lists into one stored key. The fix
//     keys it on the active identity `pub` (what the subscription actually fetches).
//
// Each test LIFTS the REAL code from the SHIPPED artefacts — subscribeAdmitted / subscribeJoinPolicy / subscribeDMConvos
// out of vendor/steward.js, and stewKeyRecipients out of app/stew-dashboard.jsx (rule 3: lifted and EXECUTED, never
// matched as text) — and runs them against a fake pool, so a source-only change that was never built, or a regression,
// fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

function fakeLS() {
  const m = new Map();
  return { store: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k) };
}
const SYNC_TIMEOUT = (fn) => { try { fn(); } catch (e) {} return 0; };

// Lift a shipped steward method and run it with the module-scoped names it closes over provided as locals.
// `fresh` captures _freshDocRead calls; a test fires .onDone() to simulate a GENUINE settle. `joinPolicyStates`
// is the real Set the method registers its state in, so a test can read back the AUTHORITATIVE approval flag.
function load(signature, name, opts = {}) {
  const body = fnBody(BUNDLE, signature);
  const subs = [];
  const pool = { subscribeMany: (relaysArg, filters, handlers) => { subs.push({ filters, handlers }); return { close() {} }; } };
  const ls = opts.localStorage || fakeLS();
  const fresh = [];
  const joinPolicyStates = opts.joinPolicyStates || new Set();
  const ctx = {
    pool,
    relays: () => [],
    pub: ('pub' in opts) ? opts.pub : 'CHURCH_A',
    actingChurch: ('actingChurch' in opts) ? opts.actingChurch : '',
    churchPub: ('churchPub' in opts) ? opts.churchPub : (('pub' in opts) ? opts.pub : 'CHURCH_A'),
    lsGet: (k) => ls.getItem(k),
    lsSet: (k, v) => ls.setItem(k, v),
    setTimeout: SYNC_TIMEOUT,
    clearTimeout: () => {},
    NET: 'trinityone',
    JOINPOLICY_D: 'trinityone/joinpolicy:',
    ADMITTED_D: 'trinityone/admitted:',
    npubEncode: (h) => 'npub-' + String(h).slice(0, 8),
    nip44d: (ct) => ct,
    localStorage: ls,
    _freshDocRead: (cp, filters, onEvent, onDone) => { fresh.push({ cp, filters, onEvent, onDone }); return () => {}; },
    _freshTok: () => ({}),
    _listTag: () => ({}),
    _stampFor: (list) => list,
    _authFuture: () => false,
    _byChurchOrSteward: () => true,
    _byChurch: () => true,
    _keysReadSignal: () => {},
    _joinPolicyStates: joinPolicyStates,
    _memberEmitters: new Set(),
    _lastAdmitted: null,
  };
  const make = new Function(...Object.keys(ctx), 'function ' + body + '\n;return ' + name + ';');
  const fn = make(...Object.values(ctx));
  return { fn, subs, localStorage: ls, fresh, joinPolicyStates };
}

// The REAL key-recipient gate, lifted from app/stew-dashboard.jsx and bound to a given window stub. It returns null
// (= "cannot tell, key nobody new") unless the lists are fresh; with approval ON it keys only members on the
// admitted list. Lifted and executed — a text match on app/*.jsx is worthless (CLAUDE.md rule 3).
function makeRecipients(windowStub) {
  const body = fnBody(DASH, 'function stewKeyRecipients(pubs, blockedList, admittedList) {', 'stewKeyRecipients');
  return new Function('window', body + '\nreturn stewKeyRecipients;')(windowStub);
}

const admEvent = (cp, pubkeys, ts = 100) => ({ tags: [['d', 'trinityone/admitted:' + cp]], created_at: ts, pubkey: cp, content: JSON.stringify({ pubkeys }) });
const ADM_KEY = (cp) => 'trinityone.steward.admitted.' + cp;
const JP_KEY = (cp) => 'trinityone.steward.joinpolicy.' + cp;

// ───────────────────────── #1 the security chain: stale seed + empty relay ⇒ NOBODY keyed ─────────────────────────

test('SECURITY: a stale admitted seed + a GENUINE-EMPTY relay keys NOBODY (fail-closed)', () => {
  // The audit scenario: the phone holds a saved allowlist, but the relay now serves NO admitted doc (reset / wiped /
  // fresh self-host box). The stale seed must not be served to the key distributor as if it were current.
  const ls = fakeLS();
  ls.setItem(ADM_KEY('CHURCH_A'), JSON.stringify(['REMOVED-PERSON', 'KEPT-PERSON']));
  const { fn, fresh } = load('subscribeAdmitted(onList)', 'subscribeAdmitted', { localStorage: ls });
  let admittedOut = null;
  fn((list) => { admittedOut = list; });
  // the relay answers with NO admitted events, then the narrow read settles GENUINELY (a real empty answer)
  assert.ok(fresh[0], 'subscribeAdmitted did not open a narrow fresh read');
  fresh[0].onDone();
  assert.deepEqual(admittedOut, [], 'a genuine-empty relay must fold the authoritative admitted list to [] — the stale seed was served as current');
  // the genuine-empty answer must also CLEAR the stale disk seed, not re-persist it
  assert.deepEqual(JSON.parse(ls.getItem(ADM_KEY('CHURCH_A'))), [], 'a genuine-empty settle must clear the stale on-disk seed');

  // feed the engine's output into the REAL key-recipient gate: approval ON, every list fresh
  const recipients = makeRecipients({ Steward: { listIsFresh: () => true, joinPolicyFresh: () => true } })(
    ['REMOVED-PERSON', 'KEPT-PERSON', 'SOMEONE-ELSE'], [], admittedOut);
  assert.deepEqual(recipients, [], 'with an empty admitted list and approval ON, key distribution must reach NOBODY');
  assert.ok(!recipients.includes('REMOVED-PERSON'), 'the removed person was keyed from a stale seed — the exact leak this fixes');
});

test('normal path intact: a GENUINE non-empty relay list is served, and its members still get keys', () => {
  const ls = fakeLS();
  ls.setItem(ADM_KEY('CHURCH_A'), JSON.stringify(['STALE-ONLY']));   // a stale seed that must be replaced, not merged
  const { fn, subs, fresh } = load('subscribeAdmitted(onList)', 'subscribeAdmitted', { localStorage: ls });
  let admittedOut = null;
  fn((list) => { admittedOut = list; });
  subs[0].handlers.onevent(admEvent('CHURCH_A', ['ALICE', 'BOB']));
  fresh[0].onDone();
  assert.deepEqual([...admittedOut].sort(), ['ALICE', 'BOB'], 'a real relay list must be served; the stale entry must be gone');
  const recip = makeRecipients({ Steward: { listIsFresh: () => true, joinPolicyFresh: () => true } });
  assert.deepEqual(recip(['ALICE', 'BOB', 'CAROL'], [], admittedOut).sort(), ['ALICE', 'BOB'],
    'admitted members must still receive keys (the fix must not fail-closed the normal path)');
});

test('SECURITY: join-policy authoritative flag stays relay-truth on a genuine-empty relay, despite a stale "on" seed', () => {
  const ls = fakeLS();
  ls.setItem(JP_KEY('CHURCH_A'), '1');   // last-known: approval ON
  const states = new Set();
  const { fn, subs, fresh } = load('subscribeJoinPolicy(onPolicy)', 'subscribeJoinPolicy', { localStorage: ls, joinPolicyStates: states });
  const paints = [];
  fn((b) => paints.push(b));
  assert.equal(paints[0], true, 'the DISPLAY must paint the last-known flag (on) instantly');
  subs[0].handlers.oneose();   // bare EOSE — must not flip the displayed flag back
  assert.ok(!paints.includes(false), 'a bare EOSE flipped the displayed flag before a genuine answer');
  fresh[0].onDone();           // genuine settle over an EMPTY relay (no joinpolicy doc)
  const st = [...states][0];
  assert.ok(st, 'the join-policy state was never registered with _joinPolicyStates');
  assert.equal(st.approval, false,
    'the AUTHORITATIVE approval was hydrated from the stale seed — a wiped church would read as approval-ON over a stale admitted list');
});

// ───────────────────────── #3 DM list: church vs owned network do not collide ─────────────────────────

function loadDM(opts) {
  const body = fnBody(BUNDLE, 'subscribeDMConvos(onConvos)');
  const subs = [];
  const ctx = {
    pool: { subscribeMany: (r, f, h) => { subs.push({ filters: f, handlers: h }); return { close() {} }; } },
    relays: () => [],
    npubEncode: (h) => 'npub-' + String(h).slice(0, 8),
    pub: opts.pub,
    actingChurch: ('actingChurch' in opts) ? opts.actingChurch : '',
    churchPub: ('churchPub' in opts) ? opts.churchPub : opts.pub,
    localStorage: opts.localStorage || fakeLS(),
  };
  const make = new Function(...Object.keys(ctx), 'function ' + body + '\n;return subscribeDMConvos;');
  return { fn: make(...Object.values(ctx)), subs, localStorage: ctx.localStorage };
}
const DM_KEY = (cp) => 'trinityone.steward.dmconvos.' + cp;

test('privacy: church and owned-network DM lists are stored under DISTINCT keys (no collision)', () => {
  const ls = fakeLS();   // ONE device, ONE localStorage, two identities
  // 1) church view — pub == churchPub, actingChurch empty
  const church = loadDM({ localStorage: ls, pub: 'CHURCH_A', churchPub: 'CHURCH_A', actingChurch: '' });
  church.fn(() => {});
  church.subs[0].handlers.onevent({ kind: 4, pubkey: 'churchPeer', tags: [['p', 'CHURCH_A']], created_at: 100, content: 'x' });
  church.subs[0].handlers.oneose();
  // 2) owned-network view — setActiveIdentity sets pub = the NETWORK key with actingChurch '' (so the OLD
  //    key, actingChurch||churchPub, would resolve to the CHURCH and collide the two lists).
  const net = loadDM({ localStorage: ls, pub: 'NETWORK_X', churchPub: 'CHURCH_A', actingChurch: '' });
  const netPaints = [];
  net.fn((list) => netPaints.push(list));
  assert.ok(!netPaints.some(p => p.some(r => r.peer === 'churchPeer')),
    'network view painted the CHURCH\'s DM conversations — the lists collided under one key');
  net.subs[0].handlers.onevent({ kind: 4, pubkey: 'netPeer', tags: [['p', 'NETWORK_X']], created_at: 200, content: 'y' });
  net.subs[0].handlers.oneose();

  assert.ok(ls.getItem(DM_KEY('NETWORK_X')), 'the network DM list must be stored under the NETWORK key');
  const netStored = JSON.parse(ls.getItem(DM_KEY('NETWORK_X')));
  assert.ok(netStored.some(r => r.peer === 'netPeer') && !netStored.some(r => r.peer === 'churchPeer'),
    'the network key must hold only network conversations');
  const churchStored = JSON.parse(ls.getItem(DM_KEY('CHURCH_A')));
  assert.ok(churchStored.some(r => r.peer === 'churchPeer') && !churchStored.some(r => r.peer === 'netPeer'),
    'the church key was contaminated with network conversations');
});
