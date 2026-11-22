// A NEWLY CONNECTED RELAY HOLDS THE CHILD GATE BEFORE MEMBERS ARE ROUTED TO IT — against REAL relays.
// Run: node --test scripts/a-new-relay-holds-the-child-gate-before-members-are-routed-to-it.test.mjs
//
// PLAN-FIX-BACKFILL-AND-REMOVE-DOORS-2026-11-22, Part A (A2/A3); INTEGRATION-AUDIT-2026-11-22 findings H1/H2.
// The scripted file (an-adopted-relay-gets-the-safeguarding-documents.test.mjs) decides every branch; this one asks
// the question no scripted relay can answer: WHAT DOES A REAL gateway.mjs SAY, and does a real child's DM stop?
//
// Two real gateways on ephemeral ports. OLD holds the church and its documents. NEW is a box the church has just
// connected: it runs our software (so it PROVES), it enforces (another church lives on it), and it has never heard of
// this church — which is the ordinary state of a relay on the day it is added, and the state in which the first
// version of the backfill was refused, discarded the refusal, and signed the box anyway.
//
// The console is the SHIPPED code, lifted from vendor/steward.js and run: the real relay gate over the real identity
// proof, the real _oneComplete over a real SimplePool logged in through the shipped signer glue, the real
// _backfillSafeguardTo, _adoptRelay, owed-marker store, retry and Steward.signRelay. ONE collaborator is a spy:
// enrolRelayNet, the step that signs the box into the church's relay-net document and so sends members to it. The
// spy does not answer the question — it ASKS it: at the instant the box would become a routing target, a real
// child's DM is sent to the real NEW relay, and what that relay says is recorded.
//
// In a worktree: needs node_modules hard-linked in; uses no fixed port (relay-network-harness freePort).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import { npubEncode } from 'nostr-tools/nip19';
import { fnBody, stmt } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const OWED_KEY = 'trinityone.steward.backfill-owed';
const MEMBER_D = 'trinityone/member:';

const LIFT = [
  // the identity proof and the gate — real, against each relay's real /relay-identity
  ['fn', 'function relayIdentityNonce'], ['fn', 'function relayHttpBase'], ['fn', 'function relayAddrKey'],
  ['fn', 'async function verifyRelayIdentityDetailed'], ['fn', 'async function verifyRelayIdentity(wssUrl) {'],
  ['fn', 'function _relayKey'], ['st', 'var _isHex64 = '], ['fn', 'function canonicalPinsFor'], ['fn', 'function isSharedAddress'],
  ['fn', 'function sharedRelayKeys'], ['fn', 'function _originKey'], ['fn', 'function sameOriginRelay'], ['fn', 'async function proveRelay'],
  ['st', 'var VERIFIED_KEY = '], ['st', 'var VERIFIED_TTL_SEC = '], ['st', 'var VERIFIED_REFRESH_SEC = '], ['st', 'var VERIFY_RETRY_SEC = '],
  ['fn', 'function readVerified'], ['fn', 'function writeVerified'], ['fn', 'function admitCached'], ['fn', 'function _scopesOf'],
  ['fn', 'function _admittingScope'], ['fn', 'function rememberVerified'], ['fn', 'function createRelayGate'],
  ['st', 'var _gate = createRelayGate('], ['fn', 'async function admitRemoteRelay'],
  // the read, and the login the console's pool makes
  ['st', 'pool.automaticallyAuth = (url) => async (authEvent) => {'],
  ['fn', 'function _oneComplete(filters, ms = 6e3, privateDoc = false) {'],
  // the engine and the choke
  ['st', 'var BACKFILL_SEND_MS = '], ['st', 'var MINORS_D = '], ['st', 'var APPROVED_D = '], ['st', 'var GUARDIANS_D = '], ['st', 'var BLOCKED_D = '], ['st', 'var NOPHOTO_D = '],
  ['fn', 'function _readCovers'], ['fn', 'function _unprovedDroppable(provedUrls) {'], ['fn', 'async function _backfillSafeguardTo(target) {'],
  ['fn', 'function lsGet(k) {'], ['fn', 'function lsSet(k, v) {'], ['st', 'var _enrolQueue = '], ['fn', 'function enrolSerial'],
  ['st', 'var BACKFILL_OWED_LS = '], ['fn', 'function _owedBackfills() {'], ['fn', 'function _setOwedBackfill(cp, url, on) {'],
  ['fn', 'async function _adoptRelay(u) {'], ['fn', 'function _signedIn(r, u) {'], ['st', 'var BACKFILL_RETRY_MS = '], ['st', 'var _owedRetrying = '], ['st', 'var _owedRetryLastAt = '], ['fn', 'async function retryOwedBackfills(opts) {'],
].map(([k, a]) => (k === 'fn' ? fnBody(STEWARD, a, a) : stmt(STEWARD, a, a))).join('\n');

let church, other, child, adult, OLD, NEW;
const pools = [];
before(async () => {
  church = H.key(); other = H.key(); child = H.key(); adult = H.key();
  [OLD, NEW] = await Promise.all([
    H.startRelay({ name: 'old', churches: [church.pub] }),
    H.startRelay({ name: 'new', churches: [other.pub] }),   // enforcing, and it does not know this church
  ]);
});
after(() => { for (const p of pools) { try { p.destroy ? p.destroy() : p.close([OLD.wsUrl, NEW.wsUrl]); } catch {} } H.stopAll(); });

const memberDoc = (who) => finalizeEvent({ kind: 30078, created_at: H.now(), tags: [['d', MEMBER_D + church.pub]], content: JSON.stringify({ joined: H.now() }) }, who.sk);
const dm = (from, toPub, body) => finalizeEvent({ kind: 4, created_at: H.now(), tags: [['p', toPub]], content: body }, from.sk);
async function say(relay, ev) { const w = await H.connect(relay); try { return await H.publish(w, ev); } finally { try { w.close(); } catch {} } }

// The owner's console: lists OLD (the box it is served from) and NEW (just typed in).
function makeConsole(onEnrol) {
  const pool = new SimplePool(); pools.push(pool);
  const mem = new Map();
  const enrols = [];
  const scope = {
    sk: church.sk, pub: church.pub, actingChurch: '', _viewingNetwork: () => false,
    pool, normalizeURL, normalizeURL2: normalizeURL, finalizeEvent, finalizeEvent2: finalizeEvent, verifyEvent, verifyEvent2: verifyEvent,
    fetch: globalThis.fetch, AbortController, AbortSignal, URL, setTimeout, clearTimeout, console,
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } },
    window: { dispatchEvent: () => true }, CustomEvent: function (n) { this.type = n; },
    CANONICAL_RELAY_PUBS: Object.freeze({}), CANONICAL_RELAYS: [],
    relayNetEntries: async () => [], _ownOrigin: () => OLD.base, location: undefined,
    relayNetCandidates: () => [OLD.wsUrl], relaysRaw: () => [OLD.wsUrl, NEW.wsUrl], extraRelays: () => [NEW.wsUrl],
    normRelay: (u) => String(u || '').trim(),
    _authAccepted: new Map(), _authedRelays: new Map(), _authFailed: new Map(), _runKeyReadAuthWaiters: () => {},
    _writeTombstone: async () => ({ wrote: false }), autoSyncHeal: async () => ({}),
    // THE SPY THAT ASKS: this is the moment the box would be signed into the church's list.
    enrolRelayNet: async (o) => { enrols.push(o); const probe = onEnrol ? await onEnrol() : null;
      return { published: true, full: true, proven: [{ url: NEW.wsUrl, pubkey: NEW.relayPub }], entries: [{ pubkey: NEW.relayPub, url: NEW.wsUrl }], probe }; },
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, ''); if (base in t) return t[base];
      throw new ReferenceError('the lifted console needs `' + String(k) + '` — add a stub'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const api = new Function('scope', 'with (scope) {' + LIFT +
    '\nconst _st = { ' + fnBody(STEWARD, '  signRelay(url) {', 'signRelay') + ' };' +
    '\nwindow.Steward = { signRelay: (u) => _st.signRelay(u), publishRelayList: () => Promise.resolve(null) };' +
    '\nreturn { signRelay: (u) => _st.signRelay(u), retryOwedBackfills, _backfillSafeguardTo, admitRemoteRelay }; }')(proxy);
  return { api, enrols, owed: () => JSON.parse(mem.get(OWED_KEY) || '[]') };
}

test('a relay that has not accepted the church is NOT signed; once it accepts, the child gate holds on it BEFORE it is signed', async () => {
  // ── the church, on its own box: one child, one ban, two members ─────────────────────────────────────────
  await H.publishAll(OLD, [
    H.churchDoc(church, 'trinityone/minors:' + church.pub, { pubkeys: [child.pub] }),
    H.churchDoc(church, 'trinityone/blocked:' + church.pub, { pubkeys: [] }),
    memberDoc(child), memberDoc(adult),
  ]);
  const [refusedAtHome, whyHome] = await say(OLD, dm(child, adult.pub, 'on the church\'s own box'));
  assert.equal(refusedAtHome, false, 're-anchor: the church\'s OWN box does not refuse a child\'s DM to an uncleared adult, so there is no gate to carry over');
  assert.match(whyHome, /not a member or not permitted/);

  // ── 1. THE STEWARD CONNECTS NEW. It proves; it has never heard of this church. ──────────────────────────
  let atSigning = null;
  const con = makeConsole(async () => { atSigning = await say(NEW, dm(child, adult.pub, 'at the moment the box is signed')); return atSigning; });
  assert.equal(await con.api.admitRemoteRelay(NEW.wsUrl), true, 're-anchor: the real gate does not admit the new box, so nothing below reaches the backfill');
  const first = await con.api.signRelay(NEW.wsUrl);
  assert.equal(first && first.pending, true,
    'A REAL RELAY REFUSED THE CHURCH\'S CHILD LIST AND THE CONSOLE DID NOT NOTICE: ' + JSON.stringify(first));
  assert.match(String(first.backfill && first.backfill.minors), /^refused: /, 're-anchor: the outcome is not the relay\'s own refusal: ' + JSON.stringify(first.backfill));
  assert.equal(con.enrols.length, 0,
    'THE BOX WAS SIGNED INTO THE CHURCH\'S RELAY LIST WHILE IT HELD NO CHILD LIST — members would be routed to it (audit H2, reproduced against a real gateway)');
  assert.deepEqual(con.owed(), [{ churchPub: church.pub, url: NEW.wsUrl }], 'nothing will try again: the box was not marked as owed');
  const held = await H.corpus(NEW, other).catch(() => []);
  assert.ok(!held.some(e => e.pubkey === church.pub), 're-anchor: NEW stored something of this church\'s while refusing it');

  // ── 2. NEW REGISTERS THE CHURCH. Members' own documents can now land there — and with no child list, so can a child's DM. ──
  const reg = await fetch(NEW.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + NEW.adminToken },
    body: JSON.stringify({ addChurch: { npub: npubEncode(church.pub), name: 'St Aidan' } }) });
  assert.equal(reg.ok, true, 'staging fault: NEW would not register the church (' + reg.status + ')');
  await H.publishAll(NEW, [memberDoc(child), memberDoc(adult)]);
  const [openBefore, whyBefore] = await say(NEW, dm(child, adult.pub, 'before the child list lands'));
  assert.equal(openBefore, true,
    'RE-ANCHOR: the new box already refuses a child\'s DM before the backfill, so this test is not measuring the gap the backfill closes (' + whyBefore + ')');

  // ── 3. THE RETRY (what the console runs on focus / a relay returning). The documents land, THEN the box is signed. ──
  const out = await con.api.retryOwedBackfills();
  assert.equal(con.enrols.length, 1, 'the retry did not sign the box once the relay accepted the church: ' + JSON.stringify(out));
  assert.ok(atSigning, 're-anchor: the probe at the moment of signing never ran');
  assert.equal(atSigning[0], false,
    'AT THE MOMENT THE BOX BECAME A ROUTING TARGET IT STILL ACCEPTED A CHILD\'S DM TO AN UNCLEARED ADULT — it was signed before the child list landed');
  assert.match(atSigning[1], /not a member or not permitted/);
  assert.deepEqual(con.owed(), [], 'the owed marker was not cleared once the box was signed');
  const onNew = await H.corpus(NEW, church);
  assert.ok(onNew.some(e => e.pubkey === church.pub && (e.tags.find(t => t[0] === 'd') || [])[1] === 'trinityone/minors:' + church.pub),
    'the church\'s minors: document is not actually stored on the new box');
  const [afterOk] = await say(NEW, dm(child, adult.pub, 'after'));
  assert.equal(afterOk, false, 'the new box does not hold the child gate after the backfill');
});

test('an address that does not prove it is a relay of ours gets NOTHING from the real console, and is never signed or owed', async () => {
  const fake = await H.startFakeRelay({ name: 'not-ours' });
  const url = fake.wsUrl;   // it accepts every EVENT it is sent and records it — and cannot answer /relay-identity
  const con = makeConsole();
  const r = await con.api._backfillSafeguardTo(url);
  assert.equal(r.landed, false);
  assert.equal(r.why, 'unproven', 'the real gate admitted a relay that is not ours: ' + JSON.stringify(r));
  const s = await con.api.signRelay(url);
  assert.equal(con.enrols.length, 0, 'an unproved address reached the signing step');
  assert.deepEqual(con.owed(), [], 'an unproved address was marked as owed');
  assert.ok(!(s && s.pending), JSON.stringify(s));
  assert.deepEqual(fake.received.map(e => (e.tags.find(t => t[0] === 'd') || [])[1] || ('kind ' + e.kind)), [],
    'THE CHURCH\'S DOCUMENTS REACHED A RELAY THAT IS NOT OURS (audit H1)');
});
