// A RELAY ROW THAT IS ITSELF UNREACHABLE CAN BE REMOVED — EVEN WHILE OTHER ROWS ARE ALSO DEAD.
// Run: node --test scripts/a-dead-relay-row-can-be-removed.test.mjs
//
// SPEC-relay-self-healing-2026-11-03 §4 (audit-corrected item 3). The delete button is wired and removeRelay
// is correct; the blocker was the all-relays-must-answer gate. `unenrolRelayNet` refused to touch the
// church's signed list unless every relay asked answered (`_readCovers`), so one dead row froze every
// removal — and with TWO dead rows the console's own advice ("remove the other one first") was circular and
// nothing could ever leave the list again. The fix lets a church-added row that is itself unreachable be
// removed while KEEPING the all-answer guard for the shared pool and the console's own box (the relays that
// hold the authoritative list), so a stale copy can never be re-signed over the real one.
//
// POINT OF USE (CLAUDE.md rule 1): this lifts the REAL `_readCovers` and the REAL `unenrolRelayNet` out of
// src/steward.src.js and RUNS them, and the REAL `dropOutcome` out of app/stew-dashboard.jsx (lifted and run,
// not text-matched — rule 3). Revert the droppable relaxation and the "two dead rows" case goes back to
// `unknown`/`drop:false` and these go red. It binds no port and spawns nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeURL } from 'nostr-tools/utils';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { parseRelayNet } from '../src/relay-net.src.js';
import { fnBody, stmt } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'src/steward.src.js'), 'utf8');
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

// ── the real gate, lifted and run. It reads only normalizeURL + CANONICAL_RELAY_PUBS. ───────────────────
const _readCovers = new Function('normalizeURL', 'CANONICAL_RELAY_PUBS',
  fnBody(SRC, 'function _readCovers(', '_readCovers') + '\nreturn _readCovers;')(normalizeURL, {});
const normRelay = new Function(fnBody(SRC, 'function normRelay(', 'normRelay') + '\nreturn normRelay;')();
const dropOutcome = new Function(fnBody(DASH, 'function dropOutcome(r, url) {', 'dropOutcome') + '\nreturn dropOutcome;')();

const OWN = 'wss://app.trinityone.church/relay';   // the shared/own box — authoritative, answered
const DEAD_A = 'wss://dead-a.example/relay';        // a church-added box, now unreachable (being removed)
const DEAD_B = 'wss://dead-b.example/relay';        // another church-added box, also unreachable
const k = (u) => normalizeURL(u);

// ── 1. THE GATE'S LOGIC, in isolation (the sabotage-resistant core) ─────────────────────────────────────

test('baseline: with NO droppable set, a single silent OTHER row blocks the removal — the old wedge', () => {
  const read = { askedUrls: [OWN, DEAD_A, DEAD_B], answeredUrls: [OWN] };
  assert.equal(_readCovers(read, DEAD_A), false,
    'a dead OTHER row (DEAD_B) must block when nothing is droppable — that was the documented jam');
});

test('with the dead church-added rows droppable, removing a self-unreachable row is covered', () => {
  const read = { askedUrls: [OWN, DEAD_A, DEAD_B], answeredUrls: [OWN] };
  const droppable = new Set([DEAD_A, DEAD_B].map(k));
  assert.equal(_readCovers(read, DEAD_A, droppable), true,
    'removing DEAD_A is still blocked by the also-dead DEAD_B — the circular wedge is NOT cleared');
});

test('the all-answer guard is KEPT for the shared pool: a silent NON-droppable relay still blocks', () => {
  // OWN (the shared/authoritative relay) is silent and is NOT in the droppable set. It must still block, or a
  // stale copy of the church's list could be re-signed over the real one (the data-loss case the guard exists
  // for). Only the dead church-added rows are exempt.
  const read = { askedUrls: [OWN, DEAD_A, DEAD_B], answeredUrls: [] };
  const droppable = new Set([DEAD_A, DEAD_B].map(k));
  assert.equal(_readCovers(read, DEAD_A, droppable), false,
    'the shared pool went silent and the read was treated as complete anyway — the guard is gone');
});

test('a droppable row that DID answer still counts (exemption only applies to the unreachable)', () => {
  const read = { askedUrls: [OWN, DEAD_A, DEAD_B], answeredUrls: [OWN, DEAD_B] };
  const droppable = new Set([DEAD_A, DEAD_B].map(k));
  assert.equal(_readCovers(read, DEAD_A, droppable), true, 'DEAD_B answered and OWN answered → covered');
});

// ── 2. THE WHOLE REMOVAL, driven end to end through the real unenrolRelayNet ─────────────────────────────

function runUnenrol({ removingUnreachable = true } = {}) {
  const sk = generateSecretKey();
  const pub = getPublicKey(sk);
  const KEY_A = 'a'.repeat(64);     // DEAD_A's signed key (its box is off, so it is never proved this pass)
  const KEY_OWN = 'b'.repeat(64);   // the shared/own box's key
  const KEY_B = 'c'.repeat(64);     // DEAD_B's signed key

  const entries = [
    { pubkey: KEY_OWN, alwaysOn: true, url: OWN },
    { pubkey: KEY_A, alwaysOn: true, url: DEAD_A },
    { pubkey: KEY_B, alwaysOn: true, url: DEAD_B },
  ];
  const docEv = (list) => ({ pubkey: pub, content: JSON.stringify(list), created_at: 1000 });
  // read 1 = the pre-edit list; read 2 = the read-back after the Remove was published (DEAD_A gone).
  const reads = [
    { ev: docEv(entries), askedUrls: [OWN, DEAD_A, DEAD_B], answeredUrls: [OWN] },
    { ev: docEv(entries.filter(e => e.url !== DEAD_A)), askedUrls: [OWN, DEAD_A, DEAD_B], answeredUrls: [OWN] },
  ];
  let nRead = 0;
  const published = [];
  const ls = new Map();   // the console's localStorage, for the pending-tombstone set

  const scope = {
    sk, pub,
    RELAY_NET_D: 'trinityone/relay-net',
    actingChurch: false,
    _viewingNetwork: () => false,
    normRelay,
    normalizeURL,
    extraRelays: () => [DEAD_A, DEAD_B],        // the church-added rows (the droppable set is built from this)
    relayNetDoc: async () => reads[Math.min(nRead++, reads.length - 1)],
    _readCovers,
    parseRelayNet,
    // DEAD_A/DEAD_B are unreachable → their proof throws; the shared/own box proves its key.
    verifyRelayIdentity: async (u) => {
      if (k(u) === k(OWN)) return { relayPub: KEY_OWN };
      throw new Error('unreachable');
    },
    relayNetCandidates: () => [OWN],            // the console's own box = the shared/authoritative relay
    publish: async (ev) => { published.push(ev); return ev; },
    finalizeEvent,
    _monotonic: (tmpl) => tmpl,
    now: () => 2000,
    // A2 (977fbaea + 2dc4e053): the removal path now runs the REAL _closeSyncTrust, which reads the church's
    // trinityone/relays sync doc. This church never granted sync trust (no sync doc), so a covering read with
    // no event is honest for that doc. B0 (2026-11-22): a sync-off church's Remove now DOES write a
    // trinityone/relays-removed tombstone, and _writeTombstone reads it back — so this read answers with the
    // newest event PUBLISHED under the d-tag asked for (a constant "no event" would make the read-back look like
    // a lost write and the removal read partial). lsGet/lsSet back the real _pendingTomb/_setPendingTomb.
    _oneComplete: async (filters) => {
      const d = ((filters && filters[0] && filters[0]['#d']) || [])[0];
      const mine = published.filter(e => ((e.tags || []).find(t => t[0] === 'd') || [])[1] === d);
      return { ev: mine.length ? mine[mine.length - 1] : null, askedUrls: [OWN], answeredUrls: [OWN] };
    },
    lsGet: (key) => (ls.has(key) ? ls.get(key) : null),
    lsSet: (key, v) => { ls.set(key, String(v)); },
    _readRelayPrefs: async () => ({ prefs: null, complete: true }),   // BF1 (2026-11-22): the Remove looks its address up in relayprefs `chosen`; this church has no prefs doc
    sharedRelayKeys: () => [],   // this fixture ships no shared pin: KEY_OWN is the console's own box, excluded as such
  };
  const names = Object.keys(scope);
  // A2 transitive chain the real unenrolRelayNet now calls, lifted from source alongside it so the removal
  // runs the shipped sync-trust close rather than a stub: _closeSyncTrust -> _writeTombstone ->
  // _pendingTomb/_setPendingTomb, plus the sync-url key helpers and the two consts they read.
  const A2 = [
    fnBody(SRC, 'function _syncRelayBase(u) {', '_syncRelayBase'),
    stmt(SRC, 'const _syncRelayKey = ', '_syncRelayKey'),
    stmt(SRC, 'const RELAYS_REMOVED_D = ', 'RELAYS_REMOVED_D'),
    stmt(SRC, 'const TOMB_PENDING_LS = ', 'TOMB_PENDING_LS'),
    fnBody(SRC, 'function _pendingTomb() {', '_pendingTomb'),
    fnBody(SRC, 'function _setPendingTomb(keys) {', '_setPendingTomb'),
    fnBody(SRC, 'function _tombable(keys, never) {', '_tombable'),
    fnBody(SRC, 'async function _writeTombstone(opts) {', '_writeTombstone'),
    fnBody(SRC, 'async function _closeSyncTrust(opts) {', '_closeSyncTrust'),
  ].join('\n');
  const fn = new Function(...names, A2 + '\n' + fnBody(SRC, 'async function unenrolRelayNet(', 'unenrolRelayNet') + '\nreturn unenrolRelayNet;')(...names.map(n => scope[n]));
  return { fn, published, removing: removingUnreachable ? DEAD_A : OWN };
}

test('removing a self-unreachable row succeeds although another row is also dead (the jam is cleared)', async () => {
  const { fn, published, removing } = runUnenrol();
  const r = await fn(removing);
  assert.equal(r.removed, true,
    'unenrolRelayNet still refuses a dead row while a sibling dead row exists — the circular wedge stands');
  assert.equal(published.length >= 1, true, 'the Remove was never published to the church list');
  assert.equal(parseRelayNet(published[0].content).some(e => normalizeURL(e.url) === k(DEAD_A)), false,
    'the published list still names the removed relay');
});

test('and the screen then drops the row: dropOutcome({removed:true}) === drop:true', () => {
  const out = dropOutcome({ removed: true }, DEAD_A);
  assert.equal(out.drop, true, 'a successful un-sign did not tell the row to leave the screen');
});

test('an un-resolvable gate still means drop:false — dropOutcome({unknown:true}) keeps the row', () => {
  // The guard is not blanket-defeated: when the shared pool genuinely cannot be read, unenrolRelayNet returns
  // unknown and the row must stay (the steward is told to try again). dropOutcome must not drop on unknown.
  const out = dropOutcome({ removed: false, unknown: true }, OWN);
  assert.equal(out.drop, false, 'an unknown read dropped the row anyway — the guard would be meaningless');
});
