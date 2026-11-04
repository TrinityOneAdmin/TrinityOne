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
import { fnBody } from './test-slice.mjs';

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

test('admitted: paints the last-known allowlist on first open', () => {
  const ls = fakeLS();
  ls.setItem(ADM_KEY('CHURCH_A'), JSON.stringify(['pkA', 'pkB']));
  const { fn } = load('subscribeAdmitted(onList)', 'subscribeAdmitted', { localStorage: ls });
  const paints = [];
  fn((list) => paints.push(list));
  assert.deepEqual(paints[0], ['pkA', 'pkB'], 'first paint must be the cached allowlist');
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

test('admitted: a transient/offline empty EOSE re-delivers the seed and does NOT clobber it', () => {
  const ls = fakeLS();
  ls.setItem(ADM_KEY('CHURCH_A'), JSON.stringify(['pkA', 'pkB']));
  const { fn, subs } = load('subscribeAdmitted(onList)', 'subscribeAdmitted', { localStorage: ls });
  const paints = [];
  fn((list) => paints.push(list));
  subs[0].handlers.oneose();   // relay down — no events this run
  assert.deepEqual(paints[paints.length - 1], ['pkA', 'pkB'], 'an empty EOSE delivered [] instead of re-delivering the seed');
  assert.deepEqual(JSON.parse(ls.getItem(ADM_KEY('CHURCH_A'))), ['pkA', 'pkB'], 'an empty EOSE clobbered the good allowlist');
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
