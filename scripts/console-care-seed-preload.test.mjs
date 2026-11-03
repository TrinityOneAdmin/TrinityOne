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
  assert.equal(JSON.parse(localStorage.getItem(needsKey(churchPub)))[0].id, 'a1', 'church A\'s seed was overwritten by church B');
  assert.ok(JSON.parse(localStorage.getItem(needsKey(otherChurch))).some(r => r.id === 'b1'), 'church B\'s need was not seeded under B\'s own key');
});

// ── 4. LOCK GATE (m4) ────────────────────────────────────────────────────────────────────────────────────
test('a locked / keyless console does NOT write the sensitive care seed', async () => {
  const { api, published, subs, localStorage } = loadMeals({ hasKey: false, locked: true });
  await api.publishNeed({ id: 'c7', type: 'meals', dates: ['2026-08-01'], ...SENSITIVE });
  api.subscribeNeeds(() => {});
  subs[subs.length - 1].onevent(finalizeEvent(published[0], churchSk));
  assert.equal(localStorage.getItem(needsKey(churchPub)), null, 'a locked console persisted care data to disk — the lock gate is not holding');
});

test('an unlocked, keyed console DOES write the seed (the lock gate is not stuck closed)', async () => {
  const { api, published, subs, localStorage } = loadMeals({ hasKey: true, locked: false });
  await api.publishNeed({ id: 'c8', type: 'meals', dates: ['2026-08-01'], ...SENSITIVE });
  api.subscribeNeeds(() => {});
  subs[subs.length - 1].onevent(finalizeEvent(published[0], churchSk));
  assert.ok(localStorage.getItem(needsKey(churchPub)), 'control: an unlocked console must seed, or test 4 proves nothing');
});
