// Preload warming — Layer 1 (Overview) console seeds (2026-11-04).
// Run: node --test scripts/console-overview-seed-preload.test.mjs
//
// The steward console's Overview page is a composite of ~15 relay streams; several opened BLANK on first-ever
// open (no on-disk seed) until the relay answered over the tunnel. This file adds cache-first localStorage seeds
// to those streams, following the pattern proven for Care/DM (Layer 1). Each test LIFTS the REAL subscribe method
// out of the SHIPPED bundle (vendor/steward.js) and runs it against a fake pool, so a source-only change that was
// never built, or a regression that drops the seed, fails here.
//
// A synchronous setTimeout is injected so the methods' 120ms coalesced emit() runs deterministically in-test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, deps } from './test-slice.mjs';
import { Buffer } from 'node:buffer';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function fakeLS() {
  const m = new Map();
  return { store: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k) };
}
const SYNC_TIMEOUT = (fn) => { try { fn(); } catch (e) {} return 0; };

// Lift a shipped method and run it with the module-scoped names it closes over provided as locals.
function load(signature, name, opts = {}) {
  const body = fnBody(BUNDLE, signature);
  const subs = [];
  const pool = { subscribeMany: (relaysArg, filters, handlers) => { subs.push({ filters, handlers }); return { close() {} }; } };
  const ls = opts.localStorage || fakeLS();
  const fresh = [];   // captured _freshDocRead calls; a test fires .onDone() to simulate a GENUINE settle
  const ctx = {
    pool,
    relays: () => [],
    pub: ('pub' in opts) ? opts.pub : 'CHURCH_A',
    actingChurch: ('actingChurch' in opts) ? opts.actingChurch : '',
    lsGet: (k) => ls.getItem(k),
    lsSet: (k, v) => ls.setItem(k, v),
    setTimeout: SYNC_TIMEOUT,
    clearTimeout: () => {},
    GROUP_D: 'trinityone/group:',
    GROUPKEY_D: 'trinityone/groupkey:',
    FUND_D: 'trinityone/fund:',
    NET: 'trinityone',
    JOINPOLICY_D: 'trinityone/joinpolicy:',
    ADMITTED_D: 'trinityone/admitted:',
    STEWARDS_D: 'trinityone/stewards:',
    STEWARDREQ_D: 'trinityone/stewardreq:',
    VERSE_PROMPT_D: 'trinityone/verseprompt',
    nip44d: (ct) => ct,
    nip44ck: () => 'k',
    sk: 'SK',
    npubEncode: (h) => 'npub-' + String(h).slice(0, 8),
    localStorage: ls,
    // stubs for the shared console plumbing these methods close over (identity/no-op where behaviour is unrelated)
    _freshDocRead: (cp, filters, onEvent, onDone) => { fresh.push({ cp, filters, onEvent, onDone }); return () => {}; },
    _freshTok: () => ({}),
    _listTag: () => ({}),
    _stampFor: (list) => list,
    _authFuture: () => false,
    _byChurchOrSteward: () => true,
    _byChurch: () => true,
    _keysReadSignal: () => {},
    _joinPolicyStates: new Set(),
    _memberEmitters: new Set(),
    _lastAdmitted: null,
  };
  const make = new Function(...Object.keys(ctx), 'function ' + body + '\n;return ' + name + ';');
  const fn = make(...Object.values(ctx));
  return { fn, subs, localStorage: ls, fresh };
}

// ───────────────────────── STATS (footprint counts) ─────────────────────────
const STATS_KEY = (cp) => 'trinityone.steward.stats.' + cp;

test('stats: paints last-known counts on first open (not 0/0)', () => {
  const ls = fakeLS();
  ls.setItem(STATS_KEY('CHURCH_A'), JSON.stringify({ events: 42, announcements: 7 }));
  const { fn } = load('subscribeStats(onStats)', 'subscribeStats', { localStorage: ls });
  const paints = [];
  fn((v) => paints.push(v));
  assert.ok(paints.length >= 1, 'subscribeStats never painted the cached counts');
  assert.deepEqual(paints[0], { events: 42, announcements: 7 }, 'first paint must be the cached counts');
});

test('stats: writes the seed on SETTLE (oneose), not per replay event', () => {
  const { fn, subs, localStorage } = load('subscribeStats(onStats)', 'subscribeStats');
  fn(() => {});
  subs[0].handlers.onevent({ id: 'e1', kind: 1, pubkey: 'CHURCH_A', tags: [] });
  assert.equal(localStorage.getItem(STATS_KEY('CHURCH_A')), null, 'the seed was written during the replay burst — must wait for EOSE');
  subs[0].handlers.oneose();
  const onDisk = JSON.parse(localStorage.getItem(STATS_KEY('CHURCH_A')) || 'null');
  assert.ok(onDisk && onDisk.events === 1 && onDisk.announcements === 1, 'the seed must be written on settle');
});

test('stats: a transient/offline empty EOSE does NOT clobber good counts with 0', () => {
  const ls = fakeLS();
  ls.setItem(STATS_KEY('CHURCH_A'), JSON.stringify({ events: 42, announcements: 7 }));
  const { fn, subs } = load('subscribeStats(onStats)', 'subscribeStats', { localStorage: ls });
  fn(() => {});
  subs[0].handlers.oneose();   // relay timed out — no events this run
  assert.deepEqual(JSON.parse(ls.getItem(STATS_KEY('CHURCH_A'))), { events: 42, announcements: 7 }, 'an empty EOSE wrote 0 over good counts');
});

// ───────────────────────── ACTIVITY (recent-events feed, BODY-FREE) ─────────────────────────
const ACT_KEY = (cp) => 'trinityone.steward.activity.' + cp;

test('activity: paints the last-known feed on first open (not empty)', () => {
  const ls = fakeLS();
  ls.setItem(ACT_KEY('CHURCH_A'), JSON.stringify([{ id: 'a1', ts: 100, ic: 'chat', tint: 'sage', text: 'Group “X” updated', gid: 'g1' }]));
  const { fn } = load('subscribeActivity(onActivity, max2 = 12)', 'subscribeActivity', { localStorage: ls });
  const paints = [];
  fn((list) => paints.push(list));
  assert.ok(paints.length >= 1 && paints[0][0] && paints[0][0].id === 'a1', 'first paint must be the cached activity feed');
});

test('activity: the seed is BODY-FREE — a message event never puts content on disk', () => {
  const { fn, subs, localStorage } = load('subscribeActivity(onActivity, max2 = 12)', 'subscribeActivity');
  fn(() => {});
  // an inbound kind-1 group message whose content is a secret — the feed must derive a fixed label, not the text
  subs[0].handlers.onevent({ id: 'm1', kind: 1, pubkey: 'memberhex', created_at: 200, content: 'SECRET-MESSAGE-BODY', tags: [['t', 'g1']] });
  subs[0].handlers.oneose();
  const onDisk = localStorage.getItem(ACT_KEY('CHURCH_A'));
  assert.ok(onDisk, 'nothing was seeded');
  assert.equal(onDisk.includes('SECRET-MESSAGE-BODY'), false, 'message content reached the activity seed');
  assert.ok(onDisk.includes('New message in a group'), 'the derived body-free label must be what is stored');
});

test('activity: writes on settle, not per replay event', () => {
  const { fn, subs, localStorage } = load('subscribeActivity(onActivity, max2 = 12)', 'subscribeActivity');
  fn(() => {});
  subs[0].handlers.onevent({ id: 'm1', kind: 1, pubkey: 'memberhex', created_at: 200, content: 'x', tags: [['t', 'g1']] });
  assert.equal(localStorage.getItem(ACT_KEY('CHURCH_A')), null, 'wrote during the replay burst — must wait for EOSE');
  subs[0].handlers.oneose();
  assert.ok(localStorage.getItem(ACT_KEY('CHURCH_A')), 'nothing seeded on settle');
});

test('activity: a transient/offline empty EOSE does NOT clobber a non-empty seed', () => {
  const ls = fakeLS();
  ls.setItem(ACT_KEY('CHURCH_A'), JSON.stringify([{ id: 'a1', ts: 100, ic: 'chat', tint: 'sage', text: 'Group “X” updated', gid: 'g1' }]));
  const { fn, subs } = load('subscribeActivity(onActivity, max2 = 12)', 'subscribeActivity', { localStorage: ls });
  fn(() => {});
  subs[0].handlers.oneose();   // relay down — no items seen this run
  const onDisk = JSON.parse(ls.getItem(ACT_KEY('CHURCH_A')));
  assert.ok(onDisk.length === 1 && onDisk[0].id === 'a1', 'an empty EOSE clobbered the good activity seed');
});

// ───────────────────────── church isolation (both) ─────────────────────────
test('church isolation: church B never paints or overwrites church A', () => {
  const ls = fakeLS();
  ls.setItem(STATS_KEY('CHURCH_A'), JSON.stringify({ events: 42, announcements: 7 }));
  ls.setItem(ACT_KEY('CHURCH_A'), JSON.stringify([{ id: 'a1', ts: 100, ic: 'chat', tint: 'sage', text: 'x', gid: 'g1' }]));
  const s = load('subscribeStats(onStats)', 'subscribeStats', { localStorage: ls, pub: 'CHURCH_B' });
  const paintsS = []; s.fn((v) => paintsS.push(v));
  assert.ok(!paintsS.some(v => v.events === 42), 'church B painted church A stats');
  s.subs[0].handlers.onevent({ id: 'e1', kind: 1, pubkey: 'CHURCH_B', tags: [] });
  s.subs[0].handlers.oneose();
  assert.deepEqual(JSON.parse(ls.getItem(STATS_KEY('CHURCH_A'))), { events: 42, announcements: 7 }, 'church A stats overwritten');
  assert.ok(ls.getItem(STATS_KEY('CHURCH_B')), 'church B stats must be under its own key');
});

// ───────────────────────── LEAKS: nothing that must not be on disk ─────────────────────────
test('LEAKS: no message/body content lands on disk from any overview seed', () => {
  const { fn, subs, localStorage } = load('subscribeActivity(onActivity, max2 = 12)', 'subscribeActivity');
  fn(() => {});
  subs[0].handlers.onevent({ id: 'm1', kind: 1, pubkey: 'memberhex', created_at: 200, content: 'PRIVATE-PLEA-TEXT', tags: [['t', 'g1']] });
  subs[0].handlers.oneose();
  for (const [, v] of localStorage.store) assert.equal(String(v).includes('PRIVATE-PLEA-TEXT'), false, 'plaintext body content found on disk: ' + v);
});

// ───────────────────────── JOIN POLICY (approval boolean) ─────────────────────────
const JP_KEY = (cp) => 'trinityone.steward.joinpolicy.' + cp;
const jpEvent = (cp, approval, ts = 100) => ({ tags: [['d', 'trinityone/joinpolicy:' + cp]], created_at: ts, pubkey: cp, content: JSON.stringify({ approval }) });

test('joinPolicy: paints the last-known flag on first open', () => {
  const ls = fakeLS();
  ls.setItem(JP_KEY('CHURCH_A'), '1');
  const { fn } = load('subscribeJoinPolicy(onPolicy)', 'subscribeJoinPolicy', { localStorage: ls });
  const paints = [];
  fn((b) => paints.push(b));
  assert.equal(paints[0], true, 'first paint must be the cached approval flag (true)');
});

test('joinPolicy: writes the seed only on a GENUINE settle, not on a bare EOSE', () => {
  const { fn, subs, fresh, localStorage } = load('subscribeJoinPolicy(onPolicy)', 'subscribeJoinPolicy');
  fn(() => {});
  subs[0].handlers.onevent(jpEvent('CHURCH_A', true));
  subs[0].handlers.oneose();   // bare EOSE — can be a client timeout; must NOT write
  assert.equal(localStorage.getItem(JP_KEY('CHURCH_A')), null, 'wrote on a bare EOSE — must wait for the genuine read');
  fresh[0].onDone();           // the _freshDocRead genuine completion
  assert.equal(localStorage.getItem(JP_KEY('CHURCH_A')), '1', 'the flag must be written once the genuine read settles');
});

test('joinPolicy: a bare/offline EOSE does NOT flip the shown flag or clobber the seed', () => {
  const ls = fakeLS();
  ls.setItem(JP_KEY('CHURCH_A'), '1');
  const { fn, subs } = load('subscribeJoinPolicy(onPolicy)', 'subscribeJoinPolicy', { localStorage: ls });
  const paints = [];
  fn((b) => paints.push(b));
  subs[0].handlers.oneose();   // relay down — nothing delivered this run
  assert.ok(!paints.includes(false), 'a bare EOSE flipped the painted flag to false');
  assert.equal(ls.getItem(JP_KEY('CHURCH_A')), '1', 'a bare EOSE clobbered the stored flag');
});

// ───────────────────────── ADMITTED (allowlist pubkeys) ─────────────────────────
const ADM_KEY = (cp) => 'trinityone.steward.admitted.' + cp;
const admEvent = (cp, pubkeys, ts = 100) => ({ tags: [['d', 'trinityone/admitted:' + cp]], created_at: ts, pubkey: cp, content: JSON.stringify({ pubkeys }) });

test('admitted: the on-disk seed is DISPLAY-ONLY — never painted through the authoritative onList', () => {
  // CHANGED 2026-11-05 (fix/seed-authority). The admitted allowlist is the KEY-DISTRIBUTION gate
  // (stewKeyRecipients / _lastAdmitted), so a stale on-disk seed must NEVER reach it. It used to be painted
  // straight through onList, which — on a genuine-empty relay — was then stamped fresh and keyed people the
  // church had dropped. The seed is now read ONLY by the pending-join COUNT, via Steward.admittedSeed(); the
  // subscribe stream delivers the relay-folded list and nothing else. (The security chain is proven end-to-end
  // in seed-stays-out-of-key-distribution.test.mjs.)
  const ls = fakeLS();
  ls.setItem(ADM_KEY('CHURCH_A'), JSON.stringify(['pkA', 'pkB']));
  const { fn } = load('subscribeAdmitted(onList)', 'subscribeAdmitted', { localStorage: ls });
  const paints = [];
  fn((list) => paints.push(list));
  assert.ok(!paints.some(p => Array.isArray(p) && (p.includes('pkA') || p.includes('pkB'))),
    'the stale seed was painted through onList — it must be display-only (Steward.admittedSeed), never the authoritative list');
});

test('admitted: the display-only seed getter DOES return the last-known allowlist off disk', () => {
  const ls = fakeLS();
  ls.setItem(ADM_KEY('CHURCH_A'), JSON.stringify(['pkA', 'pkB']));
  const { fn } = load('admittedSeed(cp)', 'admittedSeed', { localStorage: ls });
  assert.deepEqual(fn('CHURCH_A'), ['pkA', 'pkB'], 'admittedSeed() must read the cached allowlist for the pending-join count');
  assert.deepEqual(fn('CHURCH_B'), [], 'admittedSeed() for a church with no seed must be []');
});

test('admitted: writes the seed only on a GENUINE settle, not on a bare EOSE', () => {
  const { fn, subs, fresh, localStorage } = load('subscribeAdmitted(onList)', 'subscribeAdmitted');
  fn(() => {});
  subs[0].handlers.onevent(admEvent('CHURCH_A', ['pk1', 'pk2']));
  subs[0].handlers.oneose();
  assert.equal(localStorage.getItem(ADM_KEY('CHURCH_A')), null, 'wrote on a bare EOSE — must wait for the genuine read');
  fresh[0].onDone();
  assert.deepEqual(JSON.parse(localStorage.getItem(ADM_KEY('CHURCH_A'))), ['pk1', 'pk2'], 'the allowlist must be written once the genuine read settles');
});

test('admitted: a transient/offline empty EOSE delivers [] but does NOT clobber the on-disk seed', () => {
  // CHANGED 2026-11-05 (fix/seed-authority). The authoritative list is relay-folded (empty here), so a bare EOSE
  // delivers [] — NOT the seed, which is display-only now. The settled-gate still means a bare EOSE must not
  // WRITE, so the last-known seed on disk survives for the display getter and a GENUINE later answer can clear it.
  const ls = fakeLS();
  ls.setItem(ADM_KEY('CHURCH_A'), JSON.stringify(['pkA', 'pkB']));
  const { fn, subs } = load('subscribeAdmitted(onList)', 'subscribeAdmitted', { localStorage: ls });
  const paints = [];
  fn((list) => paints.push(list));
  subs[0].handlers.oneose();   // relay down — no events this run; a bare EOSE is not a genuine settle
  assert.deepEqual(paints[paints.length - 1], [], 'a bare EOSE must deliver the relay-folded [] (never the seed) to the authoritative path');
  assert.deepEqual(JSON.parse(ls.getItem(ADM_KEY('CHURCH_A'))), ['pkA', 'pkB'], 'a bare EOSE wrote over the good on-disk seed');
});

test('admitted: church isolation — church B never paints or overwrites church A', () => {
  const ls = fakeLS();
  ls.setItem(ADM_KEY('CHURCH_A'), JSON.stringify(['pkA']));
  const { fn, subs, fresh } = load('subscribeAdmitted(onList)', 'subscribeAdmitted', { localStorage: ls, pub: 'CHURCH_B' });
  const paints = [];
  fn((list) => paints.push(list));
  assert.ok(!paints.some(p => p.includes('pkA')), 'church B painted church A allowlist');
  subs[0].handlers.onevent(admEvent('CHURCH_B', ['pkB1']));
  fresh[0].onDone();
  assert.deepEqual(JSON.parse(ls.getItem(ADM_KEY('CHURCH_A'))), ['pkA'], 'church A allowlist overwritten');
  assert.ok(ls.getItem(ADM_KEY('CHURCH_B')), 'church B allowlist must be under its own key');
});

// ───────────────────────── STEWARD REQUESTS (name-free) ─────────────────────────
const REQ_KEY = (cp) => 'trinityone.steward.stewardreqs.' + cp;
const reqEvent = (cp, pubkey, name, ts = 100) => ({ tags: [['d', 'trinityone/stewardreq:' + cp]], created_at: ts, pubkey, content: JSON.stringify({ name }) });

test('stewardReqs: paints last-known requests on first open', () => {
  const ls = fakeLS();
  ls.setItem(REQ_KEY('CHURCH_A'), JSON.stringify([{ pubkey: 'reqpk', npub: 'npub-reqpk', ts: 50 }]));
  const { fn } = load('subscribeStewardRequests(onReqs)', 'subscribeStewardRequests', { localStorage: ls });
  const paints = [];
  fn((list) => paints.push(list));
  assert.ok(paints.length >= 1 && paints[0][0] && paints[0][0].pubkey === 'reqpk', 'first paint must be the cached requests');
});

test('stewardReqs: the seed is NAME-FREE — a request name never reaches disk', () => {
  const { fn, subs, localStorage } = load('subscribeStewardRequests(onReqs)', 'subscribeStewardRequests');
  fn(() => {});
  subs[0].handlers.onevent(reqEvent('CHURCH_A', 'reqpk', 'Jane Secret-Surname'));
  subs[0].handlers.oneose();
  const onDisk = localStorage.getItem(REQ_KEY('CHURCH_A'));
  assert.ok(onDisk, 'nothing was seeded on settle');
  assert.equal(onDisk.includes('Jane'), false, 'the request NAME reached the seed — must be name-free');
  const row = JSON.parse(onDisk)[0];
  assert.deepEqual(Object.keys(row).sort(), ['npub', 'pubkey', 'ts'], 'the seed row must carry ONLY pubkey/npub/ts');
});

test('stewardReqs: writes on settle, not per replay event', () => {
  const { fn, subs, localStorage } = load('subscribeStewardRequests(onReqs)', 'subscribeStewardRequests');
  fn(() => {});
  subs[0].handlers.onevent(reqEvent('CHURCH_A', 'reqpk', 'Jane'));
  assert.equal(localStorage.getItem(REQ_KEY('CHURCH_A')), null, 'wrote during the replay burst — must wait for EOSE');
  subs[0].handlers.oneose();
  assert.ok(localStorage.getItem(REQ_KEY('CHURCH_A')), 'nothing seeded on settle');
});

test('stewardReqs: a transient/offline empty EOSE does NOT clobber the seed', () => {
  const ls = fakeLS();
  ls.setItem(REQ_KEY('CHURCH_A'), JSON.stringify([{ pubkey: 'reqpk', npub: 'npub-reqpk', ts: 50 }]));
  const { fn, subs } = load('subscribeStewardRequests(onReqs)', 'subscribeStewardRequests', { localStorage: ls });
  fn(() => {});
  subs[0].handlers.oneose();   // relay down — no request events this run
  assert.deepEqual(JSON.parse(ls.getItem(REQ_KEY('CHURCH_A')))[0].pubkey, 'reqpk', 'an empty EOSE clobbered the seed');
});

test('stewardReqs: a GENUINE resolved-empty (a request withdrawn) DOES clear the seed', () => {
  const ls = fakeLS();
  ls.setItem(REQ_KEY('CHURCH_A'), JSON.stringify([{ pubkey: 'reqpk', npub: 'npub-reqpk', ts: 50 }]));
  const { fn, subs } = load('subscribeStewardRequests(onReqs)', 'subscribeStewardRequests', { localStorage: ls });
  fn(() => {});
  // the one request is withdrawn (a deletion event) → sawReq set, byPub emptied → genuine empty
  subs[0].handlers.onevent({ tags: [['d', 'trinityone/stewardreq:CHURCH_A'], ['deleted', '1']], created_at: 200, pubkey: 'reqpk', content: '' });
  subs[0].handlers.oneose();
  assert.deepEqual(JSON.parse(ls.getItem(REQ_KEY('CHURCH_A'))), [], 'a genuine withdrawal must clear the seed to []');
});

// ───────────────────────── VERSE PROMPT (ref/schedule, note dropped) ─────────────────────────
const VP_KEY = (cp) => 'trinityone.steward.versebanner.' + cp;
const vpEvent = (ref, note, ts = 100, id = 'v1') => ({ id, tags: [['d', 'trinityone/verseprompt']], created_at: ts, content: JSON.stringify({ ref, note, schedule: [{ at: ts, ref }] }) });

test('versePrompt: paints the last-known prompt on first open', () => {
  const ls = fakeLS();
  ls.setItem(VP_KEY('CHURCH_A'), JSON.stringify({ ref: 'John 3:16', schedule: [], ts: 50, id: 'v0' }));
  const { fn } = load('subscribeVersePrompt(cb)', 'subscribeVersePrompt', { localStorage: ls });
  const paints = [];
  fn((v) => paints.push(v));
  assert.ok(paints[0] && paints[0].ref === 'John 3:16', 'first paint must be the cached prompt');
});

test('versePrompt: the seed DROPS the steward note', () => {
  const { fn, subs, localStorage } = load('subscribeVersePrompt(cb)', 'subscribeVersePrompt');
  fn(() => {});
  subs[0].handlers.onevent(vpEvent('Psalm 23', 'A private pastoral note nobody else should read'));
  subs[0].handlers.oneose();
  const onDisk = localStorage.getItem(VP_KEY('CHURCH_A'));
  assert.ok(onDisk && onDisk.includes('Psalm 23'), 'the ref must be seeded');
  assert.equal(onDisk.includes('private pastoral note'), false, 'the steward note reached the seed — must be dropped');
  assert.ok(!('note' in JSON.parse(onDisk)), 'the seed row must not carry a note field');
});

test('versePrompt: a bare/offline EOSE re-delivers the seed and does NOT clear it', () => {
  const ls = fakeLS();
  ls.setItem(VP_KEY('CHURCH_A'), JSON.stringify({ ref: 'John 3:16', schedule: [], ts: 50, id: 'v0' }));
  const { fn, subs } = load('subscribeVersePrompt(cb)', 'subscribeVersePrompt', { localStorage: ls });
  const paints = [];
  fn((v) => paints.push(v));
  subs[0].handlers.oneose();   // relay down — no prompt event this run
  assert.ok(paints[paints.length - 1] && paints[paints.length - 1].ref === 'John 3:16', 'a bare EOSE cleared the banner');
  assert.ok(ls.getItem(VP_KEY('CHURCH_A')), 'a bare EOSE removed the good seed');
});

test('versePrompt: a GENUINE delete clears the seed', () => {
  const ls = fakeLS();
  ls.setItem(VP_KEY('CHURCH_A'), JSON.stringify({ ref: 'John 3:16', schedule: [], ts: 50, id: 'v0' }));
  const { fn, subs } = load('subscribeVersePrompt(cb)', 'subscribeVersePrompt', { localStorage: ls });
  fn(() => {});
  subs[0].handlers.onevent({ id: 'del', tags: [['d', 'trinityone/verseprompt'], ['deleted', '1']], created_at: 300, content: '' });
  subs[0].handlers.oneose();
  assert.equal(ls.getItem(VP_KEY('CHURCH_A')), null, 'a genuine delete must remove the seed');
});

test('LEAKS: no request name or steward note lands on disk', () => {
  const r = load('subscribeStewardRequests(onReqs)', 'subscribeStewardRequests');
  r.fn(() => {});
  r.subs[0].handlers.onevent(reqEvent('CHURCH_A', 'reqpk', 'LEAK-NAME'));
  r.subs[0].handlers.oneose();
  for (const [, v] of r.localStorage.store) assert.equal(String(v).includes('LEAK-NAME'), false, 'request name on disk: ' + v);
  const v = load('subscribeVersePrompt(cb)', 'subscribeVersePrompt');
  v.fn(() => {});
  v.subs[0].handlers.onevent(vpEvent('Psalm 1', 'LEAK-NOTE'));
  v.subs[0].handlers.oneose();
  for (const [, val] of v.localStorage.store) assert.equal(String(val).includes('LEAK-NOTE'), false, 'steward note on disk: ' + val);
});

// ───────────────────────── SAFEGUARD CLEARANCE (SEALED) ─────────────────────────
// The clearance record (which adults are cleared + expiry dates) names the congregation's youth workers, so its
// Overview seed is NIP-44-SEALED under the church key, exactly like the minors list. These tests lift the REAL
// subscribeSafeguard AND the REAL _sgClearGet/_sgClearSet seal helpers (via deps) from the shipped bundle, with a
// fake-but-invertible nip44 so "no plaintext on disk" is a genuine assertion. churchSk:null simulates a locked key.
const SG_KEY = (cp) => 'trinityone.steward.sgclear.' + cp;
const apprEvent = (cp, pubkeys, expiry, ts = 100) => ({ tags: [['d', 'trinityone/approved:' + cp]], created_at: ts, pubkey: cp, content: JSON.stringify({ pubkeys, expiry }) });
const minorsEvent = (cp, pubkeys, ts = 90) => ({ tags: [['d', 'trinityone/minors:' + cp]], created_at: ts, pubkey: cp, content: JSON.stringify({ pubkeys }) });

function loadSafeguard(opts = {}) {
  const body = fnBody(BUNDLE, 'subscribeSafeguard(onLists)');
  const subs = [];
  const ls = opts.localStorage || fakeLS();
  const ctx = {
    pool: { subscribeMany: (r, f, h) => { subs.push({ filters: f, handlers: h }); return { close() {} }; } },
    relays: () => [],
    pub: opts.pub || 'CHURCH_A',
    churchSk: ('churchSk' in opts) ? opts.churchSk : 'SK',           // null → the console's key is locked/absent
    // the seal helpers call the BUNDLED crypto names (nip44e/nip44d are bundled as encrypt2/decrypt3); provide
    // fake-but-invertible versions so deps() does NOT lift the real crypto stack, and "no plaintext on disk" is real.
    encrypt2: (pt) => 'SEAL:' + Buffer.from(String(pt), 'utf8').toString('base64'),
    decrypt3: (ct) => Buffer.from(String(ct).replace(/^SEAL:/, ''), 'base64').toString('utf8'),
    lsGet: (k) => ls.getItem(k), lsSet: (k, v) => ls.setItem(k, v), localStorage: ls,
    SGCLEAR_LAST_LS: 'trinityone.steward.sgclear.',
    MINORS_D: 'trinityone/minors:', APPROVED_D: 'trinityone/approved:', NOPHOTO_D: 'trinityone/nophoto:', GUARDIANS_D: 'trinityone/guardians:',
    NET: 'trinityone',
    _authFuture: () => false, _byChurch: () => true, _byChurchOrSteward: () => true, _applyNoPhotoList: () => {},
    _isRelayAuthed: () => (opts.authed !== false),
  };
  const depsCode = deps(BUNDLE, body, Object.keys(ctx));
  // deps() already lifts the bundle's own `_clearedTrail` declaration, so we must NOT declare it again here.
  const make = new Function(...Object.keys(ctx),
    depsCode + 'function ' + body + '\nreturn { subscribeSafeguard, getCT: () => _clearedTrail };');
  const api = make(...Object.values(ctx));
  return { ...api, subs, localStorage: ls };
}

// write a sealed seed the way the engine would, for the "paints on open" / "locked" tests
function seedSafeguard(cp, approved, expiry) {
  const ls = fakeLS();
  const w = loadSafeguard({ localStorage: ls, pub: cp });
  w.subscribeSafeguard(() => {});
  w.subs[0].handlers.onevent(apprEvent(cp, approved, expiry));
  w.subs[0].handlers.oneose();
  return ls;
}

test('safeguard: the clearance seed on disk is SEALED — no cleared-adult pubkey or date in cleartext', () => {
  const { subscribeSafeguard, subs, localStorage } = loadSafeguard();
  subscribeSafeguard(() => {});
  subs[0].handlers.onevent(apprEvent('CHURCH_A', ['ADULT-CLEARED-PK'], { 'ADULT-CLEARED-PK': 1893456000 }));
  subs[0].handlers.oneose();
  const onDisk = localStorage.getItem(SG_KEY('CHURCH_A'));
  assert.ok(onDisk, 'the clearance seed was not written on a genuine approved doc');
  assert.equal(onDisk.includes('ADULT-CLEARED-PK'), false, 'a cleared-adult pubkey is in CLEARTEXT on disk — must be sealed');
  assert.equal(onDisk.includes('1893456000'), false, 'a clearance date is in CLEARTEXT on disk — must be sealed');
  assert.ok(onDisk.includes('SEAL:'), 'the seed must be the sealed shape');
});

test('safeguard: the seed paints via approvedSeed/expirySeed and leaves sg.approved FAIL-CLOSED', () => {
  const ls = seedSafeguard('CHURCH_A', ['ADULT-CLEARED-PK'], { 'ADULT-CLEARED-PK': 1893456000 });
  const { subscribeSafeguard, getCT } = loadSafeguard({ localStorage: ls });
  const paints = [];
  subscribeSafeguard((p) => paints.push(p));
  assert.ok(paints.length >= 1, 'never painted the cached clearance');
  // THE CRUCIAL REGRESSION GUARD: sg.approved/sg.expiry (read by the Members toggles + the clearance back-fill)
  // must stay relay-truth (empty) — a seed must never turn a fail-closed cold start into fail-open stale data.
  assert.deepEqual(paints[0].approved, [], 'sg.approved was populated from the seed — the toggles/back-fill would act on stale data');
  assert.deepEqual(paints[0].expiry, {}, 'sg.expiry was populated from the seed');
  // the banner-only fields carry the cached clearance
  assert.deepEqual(paints[0].approvedSeed, ['ADULT-CLEARED-PK'], 'approvedSeed must carry the cached approved list');
  assert.equal(paints[0].expirySeed['ADULT-CLEARED-PK'], 1893456000, 'expirySeed must carry the cached expiry');
  assert.equal(paints[0].loaded, false, 'the seed paint must NOT claim the relay has answered (loaded)');
  assert.equal(paints[0].clearedKnown, false, 'the seed paint must NOT claim clearedKnown');
  // _clearedTrail starts as a {loaded:false} default in the bundle; the carry-forward into a genuine publish is
  // gated on _clearedTrail.loaded (setApproved), so the invariant is that the seed paint never flips loaded true.
  assert.ok(!getCT() || getCT().loaded !== true, 'the seed paint must NOT set _clearedTrail to a loaded (carry-forward) state');
});

test('safeguard: a LOCKED key (no churchSk) reads the seed as ABSENT — the banner waits', () => {
  const ls = seedSafeguard('CHURCH_A', ['ADULT-CLEARED-PK'], { 'ADULT-CLEARED-PK': 1893456000 });
  const { subscribeSafeguard } = loadSafeguard({ localStorage: ls, churchSk: null });
  const paints = [];
  subscribeSafeguard((p) => paints.push(p));
  assert.ok(!paints.some(p => (p.approvedSeed || []).includes('ADULT-CLEARED-PK')), 'a locked console read the sealed clearance');
});

test('safeguard: a genuine relay doc populates sg.approved and flips clearedKnown; the seed stays banner-only', () => {
  const ls = seedSafeguard('CHURCH_A', ['OLD-ADULT'], { 'OLD-ADULT': 111 });
  const { subscribeSafeguard, subs } = loadSafeguard({ localStorage: ls, authed: true });
  const paints = [];
  subscribeSafeguard((p) => paints.push(p));
  assert.deepEqual(paints[0].approved, [], 'sg.approved must be fail-closed before a genuine doc');
  assert.deepEqual(paints[0].approvedSeed, ['OLD-ADULT'], 'the seed is exposed only via approvedSeed');
  subs[0].handlers.onevent(apprEvent('CHURCH_A', ['NEW-ADULT'], { 'NEW-ADULT': 222 }, 500));
  const last = paints[paints.length - 1];
  assert.deepEqual(last.approved, ['NEW-ADULT'], 'a genuine relay list must populate sg.approved');
  assert.equal(last.clearedKnown, true, 'clearedKnown must be true once a genuine approved doc has landed');
});

test('safeguard: write is gated on a genuine approved doc, not a bare EOSE', () => {
  const { subscribeSafeguard, subs, localStorage } = loadSafeguard({ authed: true });
  subscribeSafeguard(() => {});
  subs[0].handlers.onevent(minorsEvent('CHURCH_A', ['CHILD-PK']));   // minors arrive, but NO approved doc
  subs[0].handlers.oneose();
  assert.equal(localStorage.getItem(SG_KEY('CHURCH_A')), null, 'wrote a clearance seed with no genuine approved doc');
});

test('safeguard: a transient/OFFLINE EOSE keeps the seed; a genuine authed-empty EOSE clears it', () => {
  // offline: not authed, no approved doc → the last-known seed must survive
  const lsOff = seedSafeguard('CHURCH_A', ['ADULT-CLEARED-PK'], { 'ADULT-CLEARED-PK': 1893456000 });
  const off = loadSafeguard({ localStorage: lsOff, authed: false });
  off.subscribeSafeguard(() => {});
  off.subs[0].handlers.oneose();
  assert.ok(lsOff.getItem(SG_KEY('CHURCH_A')), 'an offline EOSE wrongly cleared the last-known clearance seed');
  // genuine: authed, EOSE, no approved doc → the church has no clearance record now → drop the stale seed
  const lsOn = seedSafeguard('CHURCH_A', ['ADULT-CLEARED-PK'], { 'ADULT-CLEARED-PK': 1893456000 });
  const on = loadSafeguard({ localStorage: lsOn, authed: true });
  on.subscribeSafeguard(() => {});
  on.subs[0].handlers.oneose();
  assert.equal(lsOn.getItem(SG_KEY('CHURCH_A')), null, 'a genuine authed-empty EOSE must drop the stale clearance seed');
});

test('safeguard LEAKS: a cleared-adult pubkey never appears in cleartext anywhere on disk', () => {
  const { subscribeSafeguard, subs, localStorage } = loadSafeguard({ authed: true });
  subscribeSafeguard(() => {});
  subs[0].handlers.onevent(apprEvent('CHURCH_A', ['LEAK-ADULT-PK'], { 'LEAK-ADULT-PK': 1893456000 }));
  subs[0].handlers.oneose();
  for (const [, v] of localStorage.store) assert.equal(String(v).includes('LEAK-ADULT-PK'), false, 'cleared-adult pubkey in cleartext on disk: ' + v);
});
