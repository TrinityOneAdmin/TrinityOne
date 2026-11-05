// A PENDING JOINER IS NAMED — "Name not set yet", never "Anonymous", and read from the CHURCH'S OWN relay.
//   Run: node --test scripts/a-pending-joiner-is-named-not-anonymous.test.mjs
//
// Two defects, one symptom (DOMAIN.md 2026-10-13: the same member showed as "Oppo Tester" on one console and
// "Anonymous" on another console of the SAME church):
//
//   PART A — the console fell back to the literal "Anonymous" / "Anon · <pubkey>" for a member who has not set a
//   name. The owner removed pseudonyms, so the honest label is "Name not set yet". It is centralised in
//   app/stew-schedule.jsx (window.StewNames.memPending / isNamed) because other console code KEYED on the exact
//   old string (the attendance sort; the initials builders in stew-dashboard). CLAUDE.md rule 3: app/*.jsx ships
//   UNBUNDLED, so a text match proves nothing — the helper is LIFTED and RUN here, and sabotaged below.
//
//   PART B — the member published their sealed name to the church's relay set, but the console's member/name
//   subscription read a DIFFERENT set, so it never saw the name. The sealed-name read (openReseat, inside
//   Steward.subscribeMembers) now RE-OPENS when the church's relay set changes (steward-relays), the same way the
//   member-doc read already did — so a name that lives only on a relay the console ADOPTS on unlock
//   (adoptNetDocAddresses, from the church's own signed relay-net doc) is read. relays() is the same proof-gated
//   set as always: this widens no admission (CLAUDE.md rule 10 / RELAY-ADMISSION "the invariant").
//
// POINT OF USE (CLAUDE.md rule 1): test 3 drives the shipped Steward.subscribeMembers out of vendor/steward.js and
// fails if the re-open regresses; test 1 pins the crypto path openMemberName depends on; test 2 lifts and runs the
// label helper the console screens route through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody, liftKeyRead, stmt } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const SCHEDULE = readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const unhex = (h) => Uint8Array.from(String(h).match(/../g).map(b => parseInt(b, 16)));

// A permissive proxy so a lifted function body can resolve its free variables against the harness scope,
// falling through to the real globals for Math/Date/JSON/etc. (the shared pattern in the console tests).
const scoped = (scope) => new Proxy(scope, {
  has: (t, k) => (k in t) || !(String(k) in globalThis),
  get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; if (String(k) in globalThis) return globalThis[String(k)]; return undefined; },
  set: (t, k, v) => { t[k] = v; return true; },
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// TEST 1 — the crypto path: a pending author's sealed name opens to the real name; an absent doc opens to ''.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('openMemberName opens a pending joiner\'s church-sealed name, and yields "" when the doc is absent', () => {
  const church = generateSecretKey(); const churchPub = getPublicKey(church);
  const member = generateSecretKey(); const memberPub = getPublicKey(member);

  // The member, not yet approved, holds NO congregation key, so they seal their name to the CHURCH key alone —
  // the nip44 conversation key between the member and the church. (The relay lets a pending member write exactly
  // this doc so the steward has a name to approve.)
  const convo = nip44.utils.getConversationKey(member, churchPub);
  const sealed = nip44.encrypt(JSON.stringify({ name: 'Grace Okafor' }), convo);

  const body = fnBody(STEWARD, 'openMemberName(content, authorPub) {', 'openMemberName');
  const openMemberName = new Function('scope', `with (scope) { return ({ ${body} }).openMemberName; }`)(scoped({
    _nameKeyRing: [],                 // no congregation key yet — forces the pending-author fallback path
    _unhex: unhex,
    decrypt3: nip44.decrypt,          // esbuild's name for the nip44 decrypt import in the bundle
    getConversationKey: nip44.utils.getConversationKey,
    churchSk: church,
    toPubHex: (x) => x,
    JSON, String,
  }));

  // a bare-string copy (pre-Stage-2 shape) and the { c } envelope both resolve to the real name
  assert.equal(openMemberName(sealed, memberPub), 'Grace Okafor', 'the console could not open a pending joiner\'s sealed name');
  assert.equal(openMemberName(JSON.stringify({ c: sealed }), memberPub), 'Grace Okafor', 'the { c } envelope shape did not open');
  // absent / empty / junk → '' (the console then falls back to the honest label, it does not invent a name)
  assert.equal(openMemberName('', memberPub), '', 'an absent name doc should open to the empty string');
  assert.equal(openMemberName(undefined, memberPub), '', 'a missing name doc should open to the empty string');
  assert.equal(openMemberName('not-ciphertext', memberPub), '', 'undecryptable content should open to the empty string');
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// TEST 2 — the label helper (PART A), lifted and run out of the UNBUNDLED app/stew-schedule.jsx.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
function labelHelpers() {
  return new Function('window', [
    stmt(SCHEDULE, "const PENDING_UNNAMED = 'Name not set yet';", 'PENDING_UNNAMED'),
    fnBody(SCHEDULE, 'function isNamed(m) {', 'isNamed'),
    fnBody(SCHEDULE, 'function memPending(m) {', 'memPending'),
    'return { PENDING_UNNAMED, isNamed, memPending };',
  ].join('\n'))({});
}

test('memPending: an un-named member yields "Name not set yet"; a named member yields the name', () => {
  const { PENDING_UNNAMED, isNamed, memPending } = labelHelpers();
  assert.equal(PENDING_UNNAMED, 'Name not set yet', 'owner-approved wording changed — update the screens too');

  // named
  assert.equal(memPending({ name: 'Grace Okafor', pubkey: 'ab'.repeat(32) }), 'Grace Okafor');
  assert.equal(isNamed({ name: 'Grace Okafor' }), true);

  // un-named, in every shape the console hands it — and NOT a synthesised pseudonym
  for (const m of [{ name: '' }, { name: '   ' }, { name: null }, { pubkey: 'cd'.repeat(32), npub: 'npub1xyz' }, null, undefined]) {
    assert.equal(memPending(m), 'Name not set yet', 'an un-named member must read as the honest label, not a pseudonym');
    assert.equal(isNamed(m), false);
  }
  // the old pseudonym must be gone — no "Anon"/"Anonymous" anywhere in the output
  assert.doesNotMatch(memPending({ pubkey: 'ef'.repeat(32), npub: 'npub1abc' }), /Anon/i, 'the removed pseudonym leaked back into the label');
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// TEST 3 — PART B, point of use: drive Steward.subscribeMembers from the bundle against a two-relay buffer where
// the sealed NAME doc sits ONLY on the church's own relay (not the console's default set). The emitted pending
// member must carry .name once that relay is adopted. Fails if the read-candidate re-open regresses.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────
const CHURCH = 'church'.padEnd(64, '0');
const MEMBER = 'member'.padEnd(64, '0');
const DEFAULT_RELAY = 'wss://default.example/relay';
const CHURCH_RELAY = 'wss://church-own-box.example/relay';
const NAME_D = 'trinityone/name:', MEMBER_D = 'trinityone/member:', NET = 'trinityone';

// a minimal nostr filter matcher, so a relay serves a sub only the docs that sub actually asked for
function matchFilter(filter, ev) {
  if (filter.kinds && !filter.kinds.includes(ev.kind)) return false;
  if (filter.authors && !filter.authors.includes(ev.pubkey)) return false;
  for (const k of Object.keys(filter)) {
    if (k[0] !== '#') continue;
    const tag = k.slice(1), want = filter[k];
    const have = (ev.tags || []).filter(t => t[0] === tag).map(t => t[1]);
    if (!want.some(w => have.includes(w))) return false;
  }
  return true;
}
const subMatches = (filters, ev) => (filters || []).some(f => matchFilter(f, ev));

function runSubscribeMembers() {
  let currentRelays = [DEFAULT_RELAY];        // the console's default set until it adopts the church's own box
  const relayDocs = {                         // what each relay is actually holding
    [DEFAULT_RELAY]: [
      // the pending member's JOIN document (makes the row appear) — on the default set
      { kind: 30078, id: 'join1', pubkey: MEMBER, created_at: 1000, tags: [['d', MEMBER_D + CHURCH], ['p', CHURCH]], content: JSON.stringify({ joined: 1000 }) },
    ],
    // the SEALED NAME lives ONLY on the church's own box, which the console is not yet dialling
    [CHURCH_RELAY]: [
      { kind: 30078, id: 'name1', pubkey: MEMBER, created_at: 1001, tags: [['d', NAME_D + CHURCH], ['t', NET], ['church', CHURCH]], content: 'CIPHER-GRACE' },
    ],
  };
  const subs = [];
  const pool = {
    subscribeMany(urls, filters, h) {
      const sub = { urls: urls.slice(), filters, h, closed: false };
      subs.push(sub);
      // the relay replays its matching stored history to any new subscription
      for (const u of sub.urls) for (const ev of (relayDocs[u] || [])) if (subMatches(filters, ev)) { try { h.onevent(ev); } catch (e) {} }
      return { close() { sub.closed = true; } };
    },
  };

  const relayListeners = [];
  const win = {
    addEventListener: (ev, fn) => { if (ev === 'steward-relays') relayListeners.push(fn); },
    removeEventListener: (ev, fn) => { const i = relayListeners.indexOf(fn); if (i >= 0) relayListeners.splice(i, 1); },
    Steward: { openMemberName: (ct) => (ct === 'CIPHER-GRACE' ? 'Grace Okafor' : '') },
  };
  const storage = {};
  const scope = {
    pool,
    relays: () => currentRelays.slice(),
    pub: CHURCH, NET, NAME_D, RESEAT_D: 'trinityone/reseat:',
    JSON, Math, Date, console, String, Number, Map, Set, Array, Infinity, setTimeout, clearTimeout, queueMicrotask, Promise,
    npubEncode: (x) => x,
    _careRoster: new Set(), _memberEmitters: new Set(), _exStewardSet: () => new Set(),
    localStorage: { getItem: (k) => storage[k] || null, setItem: (k, v) => { storage[k] = v; } },
    window: win,
  };
  const body = fnBody(STEWARD, 'subscribeMembers(onMembers', 'subscribeMembers');
  const subscribe = new Function('scope', `with (scope) { ${liftKeyRead(STEWARD)}\n return ({ ${body} }).subscribeMembers; }`)(scoped(scope));

  let members = [];
  const stop = subscribe((list) => { members = list.slice(); });
  return {
    stop,
    get member() { return members.find(m => m.pubkey === MEMBER); },
    adoptChurchRelay() { currentRelays = [DEFAULT_RELAY, CHURCH_RELAY]; relayListeners.slice().forEach(fn => { try { fn(); } catch (e) {} }); },
  };
}

test('a pending joiner\'s name is read from the church\'s OWN relay once it is adopted (not left "Name not set yet")', async () => {
  const run = runSubscribeMembers();
  await sleep(260);

  // the row is present from the join doc on the default set, but the SEALED NAME is on the church's own box only,
  // which the console is not yet dialling — so before adoption the member carries no name
  assert.ok(run.member, 'the pending joiner\'s row never appeared at all');
  assert.ok(!run.member.name, 'precondition: the name doc is NOT on the default relay set, so the row starts un-named');

  // the console unlocks and adopts the church's own box from its signed relay-net doc (adoptNetDocAddresses →
  // steward-relays). The name/re-seat read must RE-OPEN against the new, still proof-gated, set.
  run.adoptChurchRelay();
  await sleep(260);

  assert.equal(run.member.name, 'Grace Okafor',
    'THE NAME ON THE CHURCH\'S OWN RELAY WAS NEVER READ — the sealed-name subscription did not re-open when the ' +
    'relay set changed, so the member stays "Name not set yet" on this console though another console shows them. ' +
    'This is the two-console Anonymous bug (DOMAIN.md 2026-10-13).');
  run.stop();
});
