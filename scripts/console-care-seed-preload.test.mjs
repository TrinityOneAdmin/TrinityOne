// Preload warming — Layer 1 console CARE seeds (2026-11-03). Run: node --test scripts/console-care-seed-preload.test.mjs
//
// The console's Care streams (needs/slots/skips/avail) kept NO on-disk copy, so Care opened BLANK on
// first-ever open until the relay answered over the tunnel. This adds cache-first localStorage seeds that
// paint last-known rows instantly, then refresh. These tests DRIVE THE SHIPPED bundle (vendor/steward-meals.js
// — what ships), so a source-only change that was never built, or a regression that drops the seed, fails
// here. They cover the four house-rule guards:
//   1. the seed paints on first open (cache-first),
//   2. NO DECRYPTED/FREE-TEXT CONTENT reaches disk (the load-bearing S-7 guard),
//   3. church isolation (a delegated/acting console cannot paint another church's seed),
//   4. the lock gate (a PIN-locked / keyless console does not write the sensitive seed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = readFileSync(ROOT + 'vendor/steward-meals.js', 'utf8');
const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));

const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);
const memberSk = generateSecretKey(), memberPub = getPublicKey(memberSk);

const SENSITIVE = { displayLabel: 'The Okonkwo family', notes: 'Chemo Tuesdays — 14 Elm St, side door.', recipient: memberPub, dietary: ['coeliac'] };
const LEAKS = ['Okonkwo', 'Elm St', 'Chemo', 'coeliac', memberPub];

// A localStorage shim we can inspect — the seeds write through bare `localStorage`, like the existing console seeds.
function fakeLS() {
  const m = new Map();
  return { store: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear() };
}

// Load the SHIPPED bundle with a minimal browser shim. `opts` sets the key/lock state and the acting church.
function loadMeals(opts = {}) {
  const careKeyHex = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const published = [];
  const subs = [];
  const nameKeyCbs = [];
  const localStorage = opts.localStorage || fakeLS();
  const steward = {
    publishSigned: async (tmpl) => { published.push(tmpl); return finalizeEvent(tmpl, churchSk); },
    careSeal: (obj) => { try { return nip44.encrypt(JSON.stringify(obj), unhex(careKeyHex)); } catch { return null; } },
    careOpen: (ct) => { try { return JSON.parse(nip44.decrypt(ct, unhex(careKeyHex))); } catch { return null; } },
    careSealTo: (to, obj) => nip44.encrypt(JSON.stringify(obj), nip44.utils.getConversationKey(churchSk, to)),
    careKeyChecked: () => true,
    churchPub,
    actingChurch: ('actingChurch' in opts) ? opts.actingChurch : '',
    hasKey: ('hasKey' in opts) ? opts.hasKey : true,
    locked: ('locked' in opts) ? opts.locked : false,
    subscribeMany: (filters, handlers) => { subs.push(handlers); return { close() {} }; },
    // avail opens a sealed doc; shim it so the decrypted `note` is real and we can prove it never hits disk
    openChurchDoc: (ct) => { try { return JSON.parse(ct); } catch { return null; } },
    onNameKeyRing: (fn) => { nameKeyCbs.push(fn); return () => {}; },
  };
  const win = { Steward: steward };
  win.window = win;
  const fn = new Function('window', 'crypto', 'console', 'TextEncoder', 'localStorage',
    SRC + '\n;return window.StewardMeals;');
  const api = fn(win, webcrypto, console, TextEncoder, localStorage);
  return { api, published, subs, careKeyHex, localStorage, steward, nameKeyCbs };
}

const needsKey = (cp) => 'trinityone.steward.care.needs.' + cp;
const slotsKey = (cp) => 'trinityone.steward.care.slots.' + cp;
const availKey = (cp) => 'trinityone.steward.care.avail.' + cp;

// ── 1. SEED PAINTS on first open ─────────────────────────────────────────────────────────────────────────
test('subscribeNeeds paints the warm seed on FIRST open (not the empty state)', () => {
  const ls = fakeLS();
  const seed = [{ id: 's1', _by: churchPub, type: 'meals', dates: ['2026-08-01'], meals: ['dinner'], startDate: '2026-08-01', endDate: '2026-08-01', ts: 1, _sealed: true }];
  ls.setItem(needsKey(churchPub), JSON.stringify(seed));
  const { api } = loadMeals({ localStorage: ls });
  const paints = [];
  api.subscribeNeeds((list) => paints.push(list));
  assert.ok(paints.length >= 1, 'the cache-first read did not paint — subscribeNeeds stayed blank until the relay');
  assert.equal(paints[0][0].id, 's1', 'first paint must be the cached row, not the empty state');
  assert.equal(paints[0][0]._sealed, true);
});

test('subscribeSlots paints the warm seed on FIRST open', () => {
  const ls = fakeLS();
  ls.setItem(slotsKey(churchPub), JSON.stringify([{ needId: 'n1', isoDate: '2026-08-01', meal: 'dinner', pubkey: memberPub, ts: 2 }]));
  const { api } = loadMeals({ localStorage: ls });
  const paints = [];
  api.subscribeSlots((list) => paints.push(list));
  assert.ok(paints.length >= 1 && paints[0][0] && paints[0][0].needId === 'n1', 'the slot grid did not paint from cache on first open');
});

// ── 2. NO DECRYPTED / FREE-TEXT CONTENT ON DISK (the load-bearing guard) ─────────────────────────────────
test('a delivered need persists ONLY the public subset — no recipient / notes / dietary / label on disk', async () => {
  const { api, published, subs, localStorage } = loadMeals();
  await api.publishNeed({ id: 'c1', type: 'meals', dates: ['2026-08-01', '2026-08-03'], meals: ['dinner'], ...SENSITIVE });
  let emitted = [];
  api.subscribeNeeds((list) => { emitted = list; });
  subs[subs.length - 1].onevent(finalizeEvent(published[0], churchSk));
  subs[subs.length - 1].oneose();   // stream settles → seed persisted (not per replay event)
  // the live callback (screen) DOES get the decrypted need — this is a keyed console
  assert.equal(emitted.find(n => n.id === 'c1').displayLabel, SENSITIVE.displayLabel, 'control: the keyed console must still SHOW the decrypted need');
  // but what landed on DISK is the subset only
  const onDisk = localStorage.getItem(needsKey(churchPub));
  assert.ok(onDisk, 'nothing was seeded — the write line is missing');
  for (const leak of LEAKS) assert.equal(onDisk.includes(leak), false, `"${leak}" reached disk — the subset projection is not covering it`);
  const row = JSON.parse(onDisk).find(r => r.id === 'c1');
  assert.ok(row, 'the need must be in the seed');
  for (const k of ['displayLabel', 'notes', 'recipient', 'dietary']) assert.equal(k in row, false, `${k} must NOT be persisted`);
  for (const k of ['id', 'type', 'dates', 'startDate', 'endDate', 'ts']) assert.ok(k in row, `${k} must be persisted (the public half)`);
  assert.equal(row._sealed, true, 'the seed row must be marked _sealed so the UI says "details hidden"');
});

test('a delivered avail listing persists who-offered + tags + window, but NOT the sealed free-text note', () => {
  const { api, subs, localStorage, nameKeyCbs } = loadMeals();
  let emitted = [];
  api.subscribeCareAvail((list) => { emitted = list; });
  const h = subs[subs.length - 1];
  // a member's sealed "I'm here to help" doc; openChurchDoc (shimmed) returns this object
  const doc = { available: true, tags: ['meals', 'lifts'], note: 'Okonkwo — call my mobile, 14 Elm St', dates: { from: '2026-08-01', to: '2026-08-07' } };
  const evt = finalizeEvent({ kind: 30078, created_at: 10, tags: [['d', 'trinityone/careavail:' + churchPub], ['church', churchPub], ['t', 'trinityone']], content: JSON.stringify(doc) }, memberSk);
  h.onevent(evt);
  h.oneose();
  assert.equal(emitted.find(a => a.pubkey === memberPub).note, doc.note, 'control: the live screen still sees the decrypted note');
  const onDisk = localStorage.getItem(availKey(churchPub));
  assert.ok(onDisk, 'avail seed was not written');
  // the offerer's OWN pubkey (memberPub) is the public who-offered half and is kept; the free-text NOTE is what must not leak
  for (const leak of ['Okonkwo', 'Elm St', 'call my mobile']) assert.equal(onDisk.includes(leak), false, `"${leak}" (from the sealed note) reached disk`);
  const row = JSON.parse(onDisk).find(r => r.pubkey === memberPub);
  assert.equal('note' in row, false, 'the decrypted note must NOT be persisted');
  assert.deepEqual(row.tags, ['meals', 'lifts'], 'the public help tags are kept');
  assert.deepEqual(row.dates, { from: '2026-08-01', to: '2026-08-07' }, 'the availability window is kept');
});

test('avail help-tags are capped (<=40 chars, <=8) so a crafted client cannot smuggle free text onto disk', () => {
  const { api, subs, localStorage } = loadMeals();
  api.subscribeCareAvail(() => {});
  const h = subs[subs.length - 1];
  const blob = 'SECRET: Okonkwo chemo Tuesdays at 14 Elm Street, side door, call my mobile — ' + 'x'.repeat(200);
  const many = Array.from({ length: 20 }, (_, i) => 'tag' + i);
  const doc = { available: true, tags: [blob, ...many, 12345, { not: 'a string' }], dates: { from: '2026-08-01', to: '2026-08-07' } };
  const evt = finalizeEvent({ kind: 30078, created_at: 11, tags: [['d', 'trinityone/careavail:' + churchPub], ['church', churchPub], ['t', 'trinityone']], content: JSON.stringify(doc) }, memberSk);
  h.onevent(evt); h.oneose();
  const onDisk = localStorage.getItem(availKey(churchPub));
  assert.ok(onDisk, 'avail seed was not written');
  assert.equal(onDisk.includes('Elm Street'), false, 'the free-text blob smuggled through a tag reached disk in full');
  const row = JSON.parse(onDisk).find(r => r.pubkey === memberPub);
  assert.ok(row.tags.length <= 8, `tags must be capped at 8, got ${row.tags.length}`);
  for (const t of row.tags) { assert.equal(typeof t, 'string', 'only string tags may persist'); assert.ok(t.length <= 40, `each tag must be <=40 chars, got ${t.length}`); }
  assert.equal(row.tags.includes(12345), false, 'a non-string tag must be dropped');
});

test('a delivered slot persists the grid identity but NOT the member free-text note', () => {
  const { api, subs, localStorage } = loadMeals();
  let emitted = [];
  api.subscribeSlots((list) => { emitted = list; });
  const h = subs[subs.length - 1];
  const evt = finalizeEvent({ kind: 30078, created_at: 20, tags: [['d', 'trinityone/careslot:n1:2026-08-01:dinner'], ['church', churchPub], ['t', 'trinityone']], content: JSON.stringify({ note: 'Okonkwo allergy note' }) }, memberSk);
  h.onevent(evt);
  h.oneose();   // stream settles → seed persisted (not per replay event)
  assert.equal(emitted[0].note, 'Okonkwo allergy note', 'control: the live screen still sees the note');
  const onDisk = localStorage.getItem(slotsKey(churchPub));
  assert.ok(onDisk, 'slot seed not written');
  assert.equal(onDisk.includes('Okonkwo'), false, 'the member free-text note reached disk');
  const row = JSON.parse(onDisk)[0];
  assert.equal('note' in row, false, 'slot note must not be persisted');
  assert.equal(row.pubkey, memberPub);
  assert.equal(row.isoDate, '2026-08-01');
});

// ── 3. CHURCH ISOLATION ──────────────────────────────────────────────────────────────────────────────────
test('an acting console does not paint, and does not overwrite, another church\'s seed', async () => {
  const ls = fakeLS();
  // church A already has a seed on this device
  const aSeed = [{ id: 'a1', _by: churchPub, type: 'meals', dates: ['2026-08-01'], meals: ['dinner'], startDate: '2026-08-01', endDate: '2026-08-01', ts: 1, _sealed: true }];
  ls.setItem(needsKey(churchPub), JSON.stringify(aSeed));
  // now act as church B (delegated) — activeChurch() = actingChurch
  const otherChurch = getPublicKey(generateSecretKey());
  const { api, published, subs, localStorage } = loadMeals({ localStorage: ls, actingChurch: otherChurch });
  const paints = [];
  api.subscribeNeeds((list) => paints.push(list));
  assert.ok(!paints.some(p => p.some(r => r.id === 'a1')), 'church B painted church A\'s cached need — isolation broken');
  // deliver a need while acting as B → it must seed under B's key, leaving A untouched
  await api.publishNeed({ id: 'b1', type: 'rides', dates: ['2026-09-01'] });
  subs[subs.length - 1].onevent(finalizeEvent(published[0], churchSk));
  subs[subs.length - 1].oneose();   // stream settles → seed persisted (not per replay event)
  assert.equal(JSON.parse(localStorage.getItem(needsKey(churchPub)))[0].id, 'a1', 'church A\'s seed was overwritten by church B');
  assert.ok(JSON.parse(localStorage.getItem(needsKey(otherChurch))).some(r => r.id === 'b1'), 'church B\'s need was not seeded under B\'s own key');
});

// ── 4. LOCK GATE (m4) ────────────────────────────────────────────────────────────────────────────────────
test('a locked / keyless console does NOT write the sensitive care seed', async () => {
  const { api, published, subs, localStorage } = loadMeals({ hasKey: false, locked: true });
  await api.publishNeed({ id: 'c7', type: 'meals', dates: ['2026-08-01'], ...SENSITIVE });
  api.subscribeNeeds(() => {});
  subs[subs.length - 1].onevent(finalizeEvent(published[0], churchSk));
  subs[subs.length - 1].oneose();   // settle: with eosed true, null now proves the LOCK gate blocked the write (not a missing settle)
  assert.equal(localStorage.getItem(needsKey(churchPub)), null, 'a locked console persisted care data to disk — the lock gate is not holding');
});

test('an unlocked, keyed console DOES write the seed (the lock gate is not stuck closed)', async () => {
  const { api, published, subs, localStorage } = loadMeals({ hasKey: true, locked: false });
  await api.publishNeed({ id: 'c8', type: 'meals', dates: ['2026-08-01'], ...SENSITIVE });
  api.subscribeNeeds(() => {});
  subs[subs.length - 1].onevent(finalizeEvent(published[0], churchSk));
  subs[subs.length - 1].oneose();   // stream settles → seed persisted (not per replay event)
  assert.ok(localStorage.getItem(needsKey(churchPub)), 'control: an unlocked console must seed, or test 4 proves nothing');
});

// ── 5. TRANSIENT-EMPTY GUARD (a slow/offline relay must not blank a good seed) ───────────────────────────
test('a transient / offline empty EOSE does NOT clobber a non-empty needs seed', () => {
  const ls = fakeLS();
  const seed = [{ id: 'keep1', _by: churchPub, type: 'meals', dates: ['2026-08-01'], meals: ['dinner'], startDate: '2026-08-01', endDate: '2026-08-01', ts: 1, _sealed: true }];
  ls.setItem(needsKey(churchPub), JSON.stringify(seed));
  const { api, subs } = loadMeals({ localStorage: ls });
  api.subscribeNeeds(() => {});
  subs[subs.length - 1].oneose();   // the relay settles having delivered NO need events (offline / still connecting)
  const onDisk = JSON.parse(ls.getItem(needsKey(churchPub)));
  assert.equal(onDisk.length, 1, 'the good seed was clobbered to [] by an empty EOSE — the device would open blank');
  assert.equal(onDisk[0].id, 'keep1', 'the preserved seed must be the original row');
});

test('a GENUINE empty (a need was seen then retracted) DOES clear the needs seed', async () => {
  const ls = fakeLS();
  ls.setItem(needsKey(churchPub), JSON.stringify([{ id: 'stale', _by: churchPub, type: 'meals', dates: ['2026-08-01'], startDate: '2026-08-01', endDate: '2026-08-01', ts: 1, _sealed: true }]));
  const { api, published, subs } = loadMeals({ localStorage: ls });
  api.subscribeNeeds(() => {});
  const h = subs[subs.length - 1];
  await api.publishNeed({ id: 'n9', type: 'meals', dates: ['2026-08-01'] });
  h.onevent(finalizeEvent(published[0], churchSk));                 // the need arrives
  const dtag = published[0].tags.find(t => t[0] === 'd')[1];
  h.onevent(finalizeEvent({ kind: 30078, created_at: 30, tags: [['d', dtag], ['t', 'trinityone'], ['deleted', '1']], content: '' }, churchSk));  // church retracts it
  h.oneose();
  assert.deepEqual(JSON.parse(ls.getItem(needsKey(churchPub))), [], 'a genuinely emptied need list must clear the seed, not keep stale rows');
});

test('a transient / offline empty EOSE does NOT clobber a non-empty slots seed', () => {
  const ls = fakeLS();
  ls.setItem(slotsKey(churchPub), JSON.stringify([{ needId: 'n1', isoDate: '2026-08-01', meal: 'dinner', pubkey: memberPub, ts: 2 }]));
  const { api, subs } = loadMeals({ localStorage: ls });
  api.subscribeSlots(() => {});
  subs[subs.length - 1].oneose();   // relay settles having delivered no slot events (offline / still connecting)
  const onDisk = JSON.parse(ls.getItem(slotsKey(churchPub)));
  assert.equal(onDisk.length, 1, 'the good slots seed was clobbered to [] by an empty EOSE');
  assert.equal(onDisk[0].needId, 'n1', 'the preserved slots seed must be the original row');
});

// ── 6. FINDING 4 — the sealed-state copy must tell a still-loading seed from a dead-key need ───────────────
// The console used to show a care-key holder "Can't be opened — recreate this need" for EVERY sealed row while
// the warm seed was painting — including healthy needs whose real (openable) event simply had not arrived yet.
// Following that advice recreates a live meal train under a new id and orphans its sign-ups. careSealState is the
// SHIPPED decision the console JSX renders from, so these drive the exact distinction (rule 1/3), not JSX text.
test('careSealState: a _seed placeholder is "syncing", a delivered dead-key need is "unrecoverable" (finding 4)', () => {
  const { api } = loadMeals();
  // the misleading screen: a keyed console, a seed row → MUST NOT be unrecoverable
  assert.equal(api.careSealState({ _sealed: true, _seed: true }, true), 'syncing', 'a seed row on a keyed console must read as still-loading, NOT "recreate this need"');
  assert.equal(api.careSealState({ _sealed: true, _seed: true }, false), 'syncing', 'a seed row is still-loading regardless of whether the key is here');
  // the genuinely unrecoverable case still earns the recreate advice
  assert.equal(api.careSealState({ _sealed: true }, true), 'unrecoverable', 'a delivered sealed need a keyed device still cannot open IS unrecoverable');
  assert.equal(api.careSealState({ _sealed: true }, false), 'needs-key', 'a sealed need with no key on this device is a self-healing sync problem');
  assert.equal(api.careSealState({ _sealed: false }, true), 'open');
  assert.equal(api.careSealState(null, true), 'open');
});

test('a delivered need\'s seed row carries _seed, so a keyed console classifies it "syncing" not "recreate" (finding 4)', async () => {
  const { api, published, subs, localStorage } = loadMeals();   // keyed, unlocked console
  await api.publishNeed({ id: 'c1', type: 'meals', dates: ['2026-08-01'], ...SENSITIVE });
  api.subscribeNeeds(() => {});
  subs[subs.length - 1].onevent(finalizeEvent(published[0], churchSk));
  subs[subs.length - 1].oneose();
  const row = JSON.parse(localStorage.getItem(needsKey(churchPub))).find(r => r.id === 'c1');
  assert.equal(row._seed, true, 'the on-disk seed row must be marked _seed (it is a public subset, not a decrypt failure)');
  assert.equal(api.careSealState(row, true), 'syncing', 'the finding-4 bug: a keyed console must NOT be told to recreate a healthy warm-seed need');
});

test('a delivered need a keyed console cannot decrypt is _sealed WITHOUT _seed → "unrecoverable" (finding 4 control)', () => {
  const { api, subs } = loadMeals();   // keyed console
  let emitted = [];
  api.subscribeNeeds((list) => { emitted = list; });
  const h = subs[subs.length - 1];
  // a sealed body encrypted under a key this device does NOT hold → careOpen returns null → _sealed, never _seed
  const evt = finalizeEvent({ kind: 30078, created_at: 50, tags: [['d', api.NEED_D + 'u1'], ['t', 'trinityone']], content: JSON.stringify({ type: 'meals', dates: ['2026-08-01'], meals: ['dinner'], enc: 'not-a-decryptable-ciphertext' }) }, churchSk);
  h.onevent(evt); h.oneose();
  const row = emitted.find(n => n.id === 'u1');
  assert.ok(row && row._sealed === true && !row._seed, 'a delivered unopenable need must be _sealed and NOT a _seed placeholder');
  assert.equal(api.careSealState(row, true), 'unrecoverable', 'this — and only this — state earns the recreate advice');
});

// ── 7. FINDING 10 — over the cap the seed must keep the CURRENT rows, not the oldest ─────────────────────────
// _writeSeed keeps the first SEED_ROW_CAP (500) rows. The needs list paints ascending by startDate (oldest first),
// so before the fix slice(0,500) kept the 500 oldest needs and silently dropped the current/upcoming meal trains.
test('over the 500-row cap the needs seed keeps the CURRENT needs and drops the OLDEST (finding 10)', () => {
  const { api, subs, localStorage } = loadMeals();   // keyed, unlocked → the seed is written
  api.subscribeNeeds(() => {});
  const h = subs[subs.length - 1];
  const iso = (i) => { const d = new Date(Date.UTC(2020, 0, 1)); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); };
  const N = 520;   // > SEED_ROW_CAP (500); n0 = oldest startDate, n519 = newest
  for (let i = 0; i < N; i++) h.onevent(finalizeEvent({ kind: 30078, created_at: 1000 + i, tags: [['d', api.NEED_D + 'n' + i], ['t', 'trinityone']], content: JSON.stringify({ type: 'meals', dates: [iso(i)], meals: ['dinner'] }) }, churchSk));
  h.oneose();
  const onDisk = JSON.parse(localStorage.getItem(needsKey(churchPub)));
  assert.equal(onDisk.length, 500, 'the seed must be capped at 500 rows');
  const ids = new Set(onDisk.map(r => r.id));
  assert.ok(ids.has('n' + (N - 1)), 'the NEWEST need (current meal train) must survive the cap');
  assert.ok(ids.has('n' + (N - 500)), 'the 500th-newest need must survive');
  assert.ok(!ids.has('n0'), 'the OLDEST need must be dropped, not a current one (the finding-10 bug kept this and dropped the newest)');
  assert.ok(!ids.has('n' + (N - 501)), 'every need older than the newest 500 must be dropped');
});

test('the slots seed is written most-recent-first so the cap keeps current sign-ups (finding 10)', () => {
  const { api, subs, localStorage } = loadMeals();
  api.subscribeSlots(() => {});
  const h = subs[subs.length - 1];
  const mk = (needId, ts, date) => finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/careslot:' + needId + ':' + date + ':dinner'], ['church', churchPub], ['t', 'trinityone']], content: JSON.stringify({}) }, memberSk);
  h.onevent(mk('old', 2, '2026-01-01'));
  h.onevent(mk('new', 9, '2026-09-01'));
  h.oneose();
  const onDisk = JSON.parse(localStorage.getItem(slotsKey(churchPub)));
  assert.equal(onDisk.length, 2, 'both sign-ups seeded');
  assert.equal(onDisk[0].ts, 9, 'the newest sign-up must be written FIRST so it survives the cap');
  assert.equal(onDisk[onDisk.length - 1].ts, 2, 'the oldest sign-up must be last (dropped first at the cap)');
});
