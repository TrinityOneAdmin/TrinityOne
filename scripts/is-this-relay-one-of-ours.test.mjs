// IS THIS RELAY ONE OF OURS? Run: node --test scripts/is-this-relay-one-of-ours.test.mjs
//
// The question the closed-network plan turns on, and the four ways answering it goes wrong. Every one of
// those four is a test below, because each has already been argued about on paper and paper is not evidence.
//
//   1. THE DEADLOCK. Enrolment must enumerate RAW candidate sources — location, the relay panel's own
//      entries — and never the filtered relay list or the cached "does this box host us" answer. A census
//      built from the filtered list cannot see the box it exists to enrol, so a self-hosting church would be
//      permanently orphaned from its own machine: excluded by the gate, therefore never enumerated,
//      therefore never signed in. This is the finding that made an earlier version of the plan a no-go.
//   2. PUBKEY ONLY, NEVER URL. A church's relay behind a free tunnel gets a new address on every restart.
//      Matching membership on address drops that church's own relay every time it reboots.
//   3. A NEW DOCUMENT. `trinityone/relay-net`, not `trinityone/relays` — that one means "sync is on",
//      refuses to be written below two boxes, and is emptied to turn mirroring off.
//   4. THE CANONICAL POOL HAS NO CHURCH SIGNATURE, so it is admitted against a pubkey LIST baked in beside
//      the URL. A list, because this project has rotated a relay key under incident and a single pin makes
//      a rotation a fleet-wide outage.
//
// WHAT IS REAL HERE.
//   • Every relay is a real `node scripts/gateway.mjs` on a bound port with its own data directory and its
//     own identity key. IN and OUT are the same software, the same health and the same church: the ONLY
//     thing that differs between them is whether the church signed for their key.
//   • Every assertion about what a church published is read back OFF THE RELAY — the stored event, over
//     /sync as the church key — never from the return value of the call that wrote it.
//   • The predicate and the enrolment code are LIFTED OUT OF THE SHIPPED BUNDLES and executed. Both bundles
//     are lifted separately: the member app and the console are built independently and have drifted before.
//
// NOTHING CONSUMES THE PREDICATE, and these tests assert nothing about which relays anything talks to. No
// relay list is filtered on this answer anywhere in either bundle; that is plan C4, and it lands separately
// with an audit between, because the moment a client requires membership, a fleet relay that cannot answer
// the C2 proof drops out of its own church's network on the day it merges.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { WebSocketServer } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { verifyEvent, finalizeEvent } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, stmt } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

const RELAY_NET_D = 'trinityone/relay-net';
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ── the predicate, out of the bundles that actually ship ────────────────────────────────────────────────
// esbuild renames an import when the name is already taken in the bundle, and which suffix a name lands on
// is a build detail — so both spellings are bound to the same real library function rather than one being
// pinned. The libraries ARE injected and that is not a stub: they are nostr-tools' own, identical to the
// ones the bundle would have used. Everything the tests are NAMED after — the proof, the pin lookup, the
// same-origin comparison, the pubkey match — is lifted and run.
function liftCore(file) {
  const src = read(file);
  const body = [
    // RELAY_PROOF_WINDOW_SEC is no longer sliced: verifyRelayIdentity stopped consulting a clock
    // (audit 2026-09-02 #1 — a phone 5 min out could admit no relay at all), so esbuild tree-shakes
    // the constant out of the bundles entirely. Slicing a name that is no longer there makes the
    // lift THROW, and a test that dies prints no failure — it reads like a pass. See CLAUDE.md.
    fnBody(src, 'function relayIdentityNonce', 'relayIdentityNonce'),
    fnBody(src, 'function relayHttpBase', 'relayHttpBase'),
    fnBody(src, 'function relayAddrKey', 'relayAddrKey'),
    fnBody(src, 'async function verifyRelayIdentityDetailed', 'verifyRelayIdentityDetailed'),
    fnBody(src, 'async function verifyRelayIdentity(wssUrl) {', 'verifyRelayIdentity'),
    stmt(src, 'var RELAY_NET_D = ', 'RELAY_NET_D'),
    stmt(src, 'var SHARED_RELAY_KEYS = ', 'SHARED_RELAY_KEYS'),
    stmt(src, 'var SHARED_RELAY_HINTS = ', 'SHARED_RELAY_HINTS'),
    stmt(src, 'var CANONICAL_RELAY_PUBS = ', 'CANONICAL_RELAY_PUBS'),
    fnBody(src, 'function isSharedAddress', 'isSharedAddress'),
    fnBody(src, 'function sharedRelayKeys', 'sharedRelayKeys'),
    fnBody(src, 'function _relayKey', '_relayKey'),
    stmt(src, 'var _isHex64 = ', '_isHex64'),
    fnBody(src, 'function canonicalPinsFor', 'canonicalPinsFor'),
    fnBody(src, 'function parseRelayNet', 'parseRelayNet'),
    fnBody(src, 'function _originKey', '_originKey'),
    fnBody(src, 'function sameOriginRelay', 'sameOriginRelay'),
    // proveRelay is where the three roots now live; isNetworkRelay is its one-line boolean reading. Both are
    // lifted, and the guards below still read the same lines — they simply sit in the function that answers
    // WHICH root, because the C4 gate has to know that to scope what it caches (a canonical pin is a fact
    // about the product, a church signature is a fact about one congregation).
    fnBody(src, 'async function proveRelay', 'proveRelay'),
    fnBody(src, 'async function isNetworkRelay', 'isNetworkRelay'),
  ].join('\n');
  // Guards on the lift itself. A slice that quietly stopped containing the load-bearing line would leave
  // every assertion below passing over nothing.
  assert.match(body, /verify \|\| verifyRelayIdentity/,
    `${file}: the predicate no longer runs the C2 possession proof at all`);
  assert.match(body, /canonicalPinsFor\(url, d\.pins\)/, `${file}: the canonical pin root is gone`);
  assert.match(body, /sameOriginRelay\(url, d\.origin\)/, `${file}: the same-origin root is gone`);
  return { body, src };
}
function coreApi(file) {
  const { body } = liftCore(file);
  return new Function('verifyEvent', 'verifyEvent2', 'normalizeURL', 'normalizeURL2', 'fetch',
    body + '\nreturn { isNetworkRelay, parseRelayNet, canonicalPinsFor, sameOriginRelay, verifyRelayIdentity, CANONICAL_RELAY_PUBS, RELAY_NET_D };'
  )(verifyEvent, verifyEvent, normalizeURL, normalizeURL, globalThis.fetch);
}
const BUNDLES = ['vendor/fellowship.js', 'vendor/steward.js'];
const cores = BUNDLES.map(f => [f, coreApi(f)]);

// ── the console's enrolment half, out of vendor/steward.js ──────────────────────────────────────────────
// Everything the console needs from the world is a parameter, so a test can put the console on a chosen
// origin, hand it a chosen relay list, and watch what it enumerates. `window` is passed undefined so the
// Capacitor branch reads as "not native" — the console in a browser, which is where it runs.
//
// `relays`, `ownRelay` and `_boxHostsUs` are supplied even though the shipped census touches none of them.
// That is the point: the deadlock test needs a console whose FILTERED view of the world disagrees with its
// origin, and the sabotage that makes the census read that view has to have something to read.
function consoleWith(deps) {
  const { body } = liftCore('vendor/steward.js');
  const src = read('vendor/steward.js');
  const more = [
    fnBody(src, 'function _ownOrigin', '_ownOrigin'),
    fnBody(src, 'function relayNetCandidates', 'relayNetCandidates'),
    fnBody(src, 'function relayNetDoc', 'relayNetDoc'),
    // Round 6: the one rule both enrolment and removal now consult.
    fnBody(src, 'function _readCovers', '_readCovers'),
    fnBody(src, 'async function relayNetEntries', 'relayNetEntries'),
    fnBody(src, 'async function enrolRelayNet', 'enrolRelayNet'),
    fnBody(src, 'async function unenrolRelayNet', 'unenrolRelayNet'),
    fnBody(src, 'function normRelay(input) {', 'normRelay'),
    fnBody(src, 'function isNetworkRelay2', 'isNetworkRelay2'),
    // Self-hosting P1 (2026-10-21): the loopback test and the name shape enrolRelayNet now consults.
    stmt(src, 'var _isLoopbackRelay = ', '_isLoopbackRelay'),
    stmt(src, 'var _RELAY_NAME_RE = ', '_RELAY_NAME_RE'),
    stmt(src, 'var RELAYNET_SEEN = ', 'RELAYNET_SEEN'),
  ].join('\n');
  assert.match(more, /const entries = mine \? parseRelayNet\(mine\.content\) : \[\]/,
    'enrolRelayNet no longer starts from what the church already signed — it would drop offline boxes');
  const f = new Function('verifyEvent', 'verifyEvent2', 'normalizeURL', 'normalizeURL2', 'fetch',
    'location', 'window', 'extraRelays', '_oneComplete', 'publish', 'sk', 'pub', 'now',
    'finalizeEvent', 'finalizeEvent2', 'relays', 'ownRelay', '_boxHostsUs', '_monotonic',
    'actingChurch', '_viewingNetwork', 'selfRelayName', 'selfPublicRelay', 'pool', 'lsGet', 'lsSet', '__shared',
    body + '\n' + more +
    // Third audit (2026-10-21, finding 1): a row can make a test box's key count as a SHARED relay's, which is
    // the only way to stand up "the box that served this page is the shared relay" against real relays.
    '\nif (__shared && __shared.length) CANONICAL_RELAY_PUBS = Object.assign({}, CANONICAL_RELAY_PUBS, { "wss://test-shared.invalid/relay": __shared });' +
    '\nreturn { enrolRelayNet, unenrolRelayNet, relayNetCandidates, relayNetEntries, isNetworkRelay: isNetworkRelay2, _ownOrigin };');
  return f(verifyEvent, verifyEvent, normalizeURL, normalizeURL, globalThis.fetch,
    deps.location, undefined, deps.extraRelays || (() => []), deps.one, deps.publish, deps.sk, deps.pub,
    () => Math.floor(Date.now() / 1000), finalizeEvent, finalizeEvent,
    deps.relays || (() => []), deps.ownRelay || (() => ''), deps.boxHostsUs,
    // Stage 3 (SCOPE-RELAY-CORRECTED-TIME-2026-09-26) put enrolRelayNet's write through _monotonic().
    // Identity here: the shipped one returns the template unchanged for a first write, so every row in
    // this file measures what it measured before.
    (t) => t,
    // Self-hosting P1: B1's guard reads actingChurch/_viewingNetwork; the own box's name and public address
    // come from selfRelayName/selfPublicRelay; B3 delivers over pool.publish. Defaults are "this church's own
    // console, nameless, no public address, delivering nowhere" so every older row measures what it did.
    deps.actingChurch || '', (typeof deps.viewingNetwork === 'function') ? deps.viewingNetwork : () => !!deps.viewingNetwork,
    () => deps.selfName || '', () => deps.selfPublic || '',
    deps.pool || { publish: () => [] },
    // The console's own localStorage (finding 2's "has this console seen a list?"), fresh per console unless shared.
    (k) => { const m = deps.store || (deps.store = new Map()); return m.has(k) ? m.get(k) : null; },
    (k, v) => { const m = deps.store || (deps.store = new Map()); m.set(k, String(v)); },
    deps.shared || []);
}

// ── reading the relay, not the client ───────────────────────────────────────────────────────────────────
// The church's own relay-net document as the BOX holds it. `corpus()` reads over /sync as the church key,
// so this is the stored event, not an echo of what the client thought it wrote.
async function storedRelayNet(relay, church) {
  const evs = await H.corpus(relay, church);
  const mine = evs.filter(e => e.kind === 30078 && e.pubkey === church.pub
    && (e.tags.find(t => t[0] === 'd') || [])[1] === RELAY_NET_D);
  mine.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return mine;
}
// The membership entries a client would read off a given box — parsed with the SHIPPED parser.
const netFrom = (relay, church, api) => async (cp) => {
  const docs = await storedRelayNet(relay, church);
  return (docs[0] && cp === church.pub) ? api.parseRelayNet(docs[0].content) : [];
};
// A one-shot read shaped like the console's _oneComplete(): { ev, complete }, off a real relay. `complete`
// is the half that matters — it is what stops "I stopped waiting" being read as "the church signed nothing".
const oneFrom = (relay, church) => async (filters) => {
  const evs = await H.readAs(relay, church, filters[0]);
  let best = null;
  for (const e of evs) if (!best || (e.created_at || 0) > (best.created_at || 0)) best = e;
  // `answered`/`asked` (2026-10-21, audit finding 2): one real relay, and it answered.
  // `askedUrls` (round 6): the console's rule is stated by address, so a full answer names who was asked.
  return { ev: best, complete: true, answered: 1, asked: 1, askedUrls: [relay.wsUrl], answeredUrls: [relay.wsUrl] };
};
// ── REAL READS (round 6) ──────────────────────────────────────────────────────────────────────────────
// The fifth audit's root finding: rows that hand the console a ready-made answer cannot see what the reader
// really reports when a relay is down. `realRead(urls)` is the SHIPPED `_oneComplete`, lifted out of
// vendor/steward.js and run over a real SimplePool against the given addresses — `urls` is what the console's
// relaysRaw() would hold (the input), never the answer. relay-net is a public document, so no login is needed.
const SHIPPED_STEWARD = read('vendor/steward.js');
const _realPools = [];
function realRead(urls) {
  const pool = new SimplePool();
  _realPools.push([pool, urls]);
  const scope = { pool, relaysRaw: () => urls, normalizeURL, normalizeURL2: normalizeURL, _authAccepted: new Map(),
    setTimeout, clearTimeout, Promise, Math, console };
  return new Function('scope', 'with (scope) {' +
    // ⚠ `6e3`: the bundle's spelling of the source's 6000 (see a-failed-read-is-not-an-empty-church).
    fnBody(SHIPPED_STEWARD, 'function _oneComplete(filters, ms = 6e3, privateDoc = false) {', '_oneComplete') +
    '\nreturn _oneComplete; }')(new Proxy(scope, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
        throw new ReferenceError('the shipped reader needs a stub for ' + String(k)); },
    }));
}
// A relay that is switched off: a port that was bound by the OS a moment ago and is now closed. Port 0, so no
// fixed port can collide with another file (test-ports.test.mjs).
async function deadRelay() {
  const srv = createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise(r => srv.close(r));
  return 'ws://127.0.0.1:' + port + '/';
}
// An ordinary Nostr relay that is not TrinityOne: it answers every REQ with an empty EOSE and has no /status, so
// it answers the read and proves no key.
const _junk = [];
async function junkRelay() {
  const w = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(r => w.on('listening', r));
  w.on('connection', (sock) => sock.on('message', (d) => { try { const m = JSON.parse(d); if (m[0] === 'REQ') sock.send(JSON.stringify(['EOSE', m[1]])); } catch {} }));
  _junk.push(w);
  return 'ws://127.0.0.1:' + w.address().port + '/';
}
after(() => {
  for (const [p, u] of _realPools) { try { p.close(u); } catch {} }
  for (const w of _junk) { try { w.close(); } catch {} }
});

// …and the same read on a link where ONE of the two documents never comes back: that filter answers nothing
// and never reaches the end, the other answers normally.
//
// Per-document, not a blanket timeout, and that is the point. enrolRelayNet has TWO places where an
// unfinished read must stop it — the membership document and the one-time seed — and a scenario where BOTH
// reads fail is satisfied by either guard, so it cannot say which one is doing the work. One of them could
// then be deleted with nothing going red, which is exactly what happened the first time this was written:
// the sabotage that removed the first guard left the test green, because the second one caught it.
const oneWhere = (relay, church, incompleteD) => async (filters) => {
  const d = (filters[0] && filters[0]['#d'] && filters[0]['#d'][0]) || '';
  if (d === incompleteD) return { ev: null, complete: false };
  return oneFrom(relay, church)(filters);
};
// A publish that really lands on the given boxes, so the assertions afterwards can read the store.
const publishTo = (...relays) => async (ev) => { for (const r of relays) await H.publishAll(r, [ev]); return ev; };

let church, IN, OUT, SELF;
before(async () => {
  church = H.key();
  // Same software, same church, same health. The ONLY difference is the church's signature.
  [IN, OUT, SELF] = await Promise.all([
    H.startRelay({ name: 'IN', churches: [church.pub] }),
    H.startRelay({ name: 'OUT', churches: [church.pub] }),
    H.startRelay({ name: 'SELF', churches: [church.pub] }),
  ]);
  assert.notEqual(IN.relayPub, OUT.relayPub, 'IN and OUT must be separate boxes or nothing below means anything');
});
after(() => H.stopAll());

// ── 1. the church's signature is the whole difference ───────────────────────────────────────────────────
test('a church signs a relay in, and the console reads that document back off a real relay', async () => {
  // The console signs IN in, driving the SHIPPED enrolment code, and publishes to BOTH boxes — so OUT ends
  // up holding every byte of evidence there is and is still refused. That is the point: the refusal comes
  // from what the church signed, not from what a box happens to have seen.
  const con = consoleWith({
    location: { protocol: 'https:', host: 'app.example.church' },   // a HOSTED console: not IN's origin
    extraRelays: () => [IN.wsUrl],
    one: oneFrom(IN, church), publish: publishTo(IN, OUT), sk: church.sk, pub: church.pub,
  });
  // B4 (2026-10-21): a typed relay is signed only on the steward's consent — signRelay(url), which is
  // enrolRelayNet({ extra: [url] }). The bare call now signs the serving box alone (see test 11).
  const out = await con.enrolRelayNet({ extra: [IN.wsUrl] });
  assert.equal(out.published, true, 'the console did not publish the membership document');

  for (const box of [IN, OUT]) {
    const docs = await storedRelayNet(box, church);
    assert.equal(docs.length, 1, `${box.name} holds ${docs.length} relay-net documents, expected exactly 1`);
    const entries = cores[0][1].parseRelayNet(docs[0].content);
    assert.deepEqual(entries.map(e => e.pubkey), [IN.relayPub],
      `${box.name}'s stored copy of the church's document names the wrong boxes`);
    assert.equal(entries[0].alwaysOn, true, 'alwaysOn must default to true for a newly enrolled box');
  }
  // The CONSOLE's own two-argument predicate, end to end: it reads the document back off a real relay
  // through its own reader before deciding. Nothing about the answer is handed to it here.
  assert.equal(await con.isNetworkRelay(church.pub, IN.wsUrl), true,
    'the console refused the relay its own church had just signed for');
  // REMOVED 2026-09-02, one assertion, accounted for here (rule 8). It required the console to REFUSE a
  // relay its church had never signed for. That is the property the owner's decision of that date removes:
  // admission is now "does it prove it runs TrinityOne software", and OUT is a real gateway, so it is
  // admitted. Nothing weaker replaces it, because the church signature is no longer consulted on this path.
  //
  // What the case still proves, and why it is kept rather than deleted: the console's own two-argument
  // predicate reads the document back off a real relay through its own reader and admits IN — so the
  // enrolment write, the read, and the predicate are all still exercised end to end. The line below is the
  // positive control that stops the assertion above passing against a predicate that admits nothing.
  assert.equal(await con.isNetworkRelay(church.pub, OUT.wsUrl), true,
    'a real relay that proves it runs our software was refused, so this predicate now admits nothing at all');

  // …and OUT, holding that document, is still not a member of this church's network.
  for (const [file, api] of cores) {
    const deps = { netEntries: netFrom(OUT, church, api), origin: 'https://app.example.church', pins: {} };
    assert.equal(await api.isNetworkRelay(church.pub, IN.wsUrl, deps), true,
      `${file}: the relay this church signed for was refused`);
    // INVERTED 2026-09-02, same reason as above and recorded here too because it is a second assertion, not
    // a repeat: it required that a healthy relay HOLDING the church's own membership document, but whose key
    // the church never signed, was still refused. That was the sharpest statement in this file that
    // membership came from the signature rather than from what a box happened to have seen. The signature is
    // no longer consulted, so it is admitted on its proof.
    assert.equal(await api.isNetworkRelay(church.pub, OUT.wsUrl, deps), true,
      `${file}: a real relay was refused even though it proves it runs our software`);
  }
});

// ── 2. finding 3: a tunnel restart must not un-admit a church's own box ─────────────────────────────────
test('a relay that changed address keeps its membership, because membership is the key and not the URL', async () => {
  const before2 = await storedRelayNet(IN, church);
  assert.equal(before2.length, 1, 'precondition: the church has signed exactly one document');
  const signedUrl = cores[0][1].parseRelayNet(before2[0].content)[0].url;
  // CHANGED 2026-10-21 (self-hosting P1, rule 8 — same assertion count): the harness relays listen on
  // 127.0.0.1, and enrolment no longer writes a loopback address into the church's document (it names the
  // steward's own computer, which no phone can reach). So the hint recorded here is now '' rather than
  // IN.wsUrl. What this case proves is unchanged: membership survives the move because it is the key.
  assert.equal(signedUrl, '', 'precondition: a loopback address was written into the church\'s document as a hint');

  const moved = await H.moveRelay(IN);          // same box, same key, new port — a tunnel restart in miniature
  IN = moved;
  assert.notEqual(moved.wsUrl, signedUrl, 'the box did not actually move');

  for (const [file, api] of cores) {
    // The church's document is UNCHANGED and still records the OLD address. Nothing re-signed anything.
    const deps = { netEntries: netFrom(moved, church, api), origin: '', pins: {} };
    assert.equal(await api.isNetworkRelay(church.pub, moved.wsUrl, deps), true,
      `${file}: a church's own relay lost its membership by rebooting behind a tunnel — this is a client ` +
      'matching on the address instead of on the key it proved');
  }
  const after2 = await storedRelayNet(moved, church);
  assert.equal(after2.length, 1, 'the document must not have been rewritten');
  assert.equal(after2[0].id, before2[0].id, 'the church re-signed its membership over a mere address change');
  assert.equal(cores[0][1].parseRelayNet(after2[0].content)[0].url, signedUrl,
    'the stale url hint is expected to survive — it is advisory, and it must not have been what decided this');
});

// ── 3. the same-origin root, and the fact that it does not skip the proof ───────────────────────────────
test('a console served by a box admits that box with no document at all, and still only on a proof', async () => {
  const origin = SELF.base;   // http://127.0.0.1:<port> — the Suite's first run, and the general rule
  for (const [file, api] of cores) {
    assert.equal(await api.isNetworkRelay(church.pub, SELF.wsUrl, { netEntries: async () => [], origin, pins: {} }), true,
      `${file}: the relay serving this very page was refused, with no church document anywhere. That is the ` +
      'Suite bricked on first run, which is the most likely way this work breaks something real');
    // INVERTED 2026-09-02. This used to require that a DIFFERENT box was not admitted by somebody else's
    // origin — true while admission needed a root. Under the owner's decision a box is admitted when it
    // proves it runs TrinityOne software, and OUT is a real gateway, so it is admitted and the origin root is
    // simply not what decided it. The assertion is kept, pointing the other way, so that if admission ever
    // starts refusing a provable box this case says so rather than going quiet.
    assert.equal(await api.isNetworkRelay(church.pub, OUT.wsUrl, { netEntries: async () => [], origin, pins: {} }), true,
      `${file}: a box that proves it runs our software was refused`);
    // And the origin is not a shortcut past the proof: a host on the console's own origin that cannot prove
    // a key is refused. Staged with a real HTTP host that serves the relay's /status verbatim — a complete
    // impersonation at the level of evidence that existed before C2 — and no /relay-identity.
    const st = await SELF.status();
    const fake = await H.startImpostor({
      name: 'origin-impostor',
      handler: (req, res) => req.url.startsWith('/status') ? H.sendJson(res, st) : H.sendJson(res, { error: 'no' }, 404),
    });
    assert.equal(await api.isNetworkRelay(church.pub, fake.base + '/relay', { netEntries: async () => [], origin: fake.base, pins: {} }), false,
      `${file}: a host on the page's own origin was admitted without proving it holds a key — same-origin ` +
      'is a reason not to ask a second question, not a reason to skip the first');
  }
});

// ── 4. the canonical pool: a pin LIST, not one value ────────────────────────────────────────────────────
test('a canonical relay is admitted against the pubkey list baked beside its URL, and only that list', async () => {
  const other = OUT.relayPub;
  for (const [file, api] of cores) {
    const none = { netEntries: async () => [], origin: '', pins: {} };
    // INVERTED 2026-09-02: unpinned, unsigned and not the origin is now ADMITTED, because SELF is a real
    // gateway and proving that is the whole rule. The precondition still earns its place — it fixes the
    // starting state so the two assertions below isolate the PIN and nothing else.
    assert.equal(await api.isNetworkRelay(church.pub, SELF.wsUrl, none), true,
      `${file}: precondition — a real relay, unpinned and unsigned, should be admitted on its proof alone`);

    assert.equal(await api.isNetworkRelay(church.pub, SELF.wsUrl,
      { ...none, pins: { [SELF.wsUrl]: [SELF.relayPub] } }), true, `${file}: the pinned key was refused`);
    assert.equal(await api.isNetworkRelay(church.pub, SELF.wsUrl,
      { ...none, pins: { [SELF.wsUrl]: [other] } }), false,
      `${file}: a relay serving a DIFFERENT key at a canonical URL was admitted — the pin is not being checked`);
    // The rotation shape: old pin and new pin ship together for one release.
    assert.equal(await api.isNetworkRelay(church.pub, SELF.wsUrl,
      { ...none, pins: { [SELF.wsUrl]: [other, SELF.relayPub] } }), true,
      `${file}: a two-entry pin list did not admit the second entry — a planned key rotation would be a ` +
      'fleet-wide outage');
    // Keyed the way the connection pool keys relays, so a trailing slash is not a silent miss.
    assert.equal(await api.isNetworkRelay(church.pub, SELF.wsUrl,
      { ...none, pins: { [SELF.wsUrl + '/']: [SELF.relayPub] } }), true,
      `${file}: the pin lookup missed on a trailing slash — the relay-url normalisation trap, again`);
  }
});

// ── 5. the shipped pin table must cover the shipped canonical URLs (the C8 drift guard) ─────────────────
test('every canonical relay URL in both engines has a baked pin, and every pin is a list', () => {
  const pins = cores[0][1].CANONICAL_RELAY_PUBS;
  assert.deepEqual(cores[0][1].CANONICAL_RELAY_PUBS, cores[1][1].CANONICAL_RELAY_PUBS,
    'the member app and the console ship DIFFERENT canonical pins — one of them would refuse a box the ' +
    'other accepts, which is the drift that shared code exists to stop');
  const keys = Object.keys(pins).map(normalizeURL);
  for (const file of ['src/fellowship.src.js', 'src/steward.src.js']) {
    const src = read(file);
    const block = stmt(src, 'const CANONICAL_RELAYS = ', file + ' CANONICAL_RELAYS');
    const urls = [...block.matchAll(/'(wss?:\/\/[^']+)'/g)].map(m => m[1]);
    assert.ok(urls.length > 0, file + ': could not read any canonical URL — re-anchor this test');
    for (const u of urls) {
      assert.ok(keys.includes(normalizeURL(u)),
        `${file} ships canonical relay ${u} with NO expected relayPub pin. Under the closed-network gate a ` +
        'canonical relay is admitted only against a pin baked beside its URL, so an unpinned one can never ' +
        'be admitted at all — add it to CANONICAL_RELAY_PUBS in src/relay-net.src.js (plan C8).');
    }
  }
  for (const [u, list] of Object.entries(pins)) {
    assert.ok(Array.isArray(list) && list.length >= 1, `${u}: the pin must be a LIST, so a key rotation can ship old+new`);
    for (const p of list) assert.match(p, /^[0-9a-f]{64}$/, `${u}: ${p} is not a 64-hex pubkey`);
  }
});

// ── 6. THE DEADLOCK, executable ─────────────────────────────────────────────────────────────────────────
test('enrolment enumerates the box that the filtered relay list cannot see', async () => {
  // The state that traps a self-hosting church for ever: this box has been recorded as NOT hosting us, so
  // ownRelay() answers with the canonical URL and relays() no longer names the box at all. A census built
  // from either would never see the machine it exists to enrol, and the box could never be signed in — so
  // it would stay outside the network permanently, for the churches that most need it inside.
  const CANON = 'wss://app.trinityone.church/relay';
  const con = consoleWith({
    location: { protocol: 'http:', host: SELF.base.replace(/^https?:\/\//, '') },
    extraRelays: () => [],
    relays: () => [CANON],       // the filtered/assembled list: the box is NOT in it
    ownRelay: () => CANON,       // …because _boxHostsUs said no
    boxHostsUs: false,
    one: oneFrom(SELF, church), publish: publishTo(SELF), sk: church.sk, pub: church.pub,
  });
  const cands = con.relayNetCandidates();
  assert.ok(cands.includes(SELF.wsUrl),
    'the enrolment census did not include the box on the console\'s own origin, while relays() and ownRelay() ' +
    'both point elsewhere. That is the bootstrap deadlock: the only code that could sign this box in cannot ' +
    'see it, so a self-hosting church is orphaned from its own machine and no retry ever helps.\n' +
    '    candidates: ' + JSON.stringify(cands));
  assert.ok(!cands.includes(CANON), 'the census enumerated the canonical pool — it is reading the filtered list');

  // …and it is not merely enumerated: the church really signs it, and the box really holds the document.
  const res = await con.enrolRelayNet();
  assert.equal(res.published, true, 'nothing was published for the box the filtered list could not see');
  const docs = await storedRelayNet(SELF, church);
  assert.equal(docs.length, 1, 'SELF holds ' + docs.length + ' relay-net documents, expected 1');
  const entries = cores[1][1].parseRelayNet(docs[0].content);
  assert.ok(entries.some(e => e.pubkey === SELF.relayPub),
    'the published document does not name the box that served the console');
});

// ── 7. what enrolment must never do, and the one-time seed ──────────────────────────────────────────────
test('enrolment never drops a box that is merely unreachable, and seeds once from the old sync list', async () => {
  // (a) A church whose document already names a box that is switched off today. Enrolling from a console
  // that can prove a DIFFERENT box must ADD, never replace: "my relay was down for an hour" must not become
  // "my church un-admitted its own relay".
  const offline = 'f'.repeat(64);
  await H.publishAll(OUT, [H.churchDoc(church, RELAY_NET_D, [{ pubkey: offline, alwaysOn: false, url: 'wss://parish.example/relay' }])]);
  const con = consoleWith({
    location: { protocol: 'https:', host: 'app.example.church' },
    extraRelays: () => [OUT.wsUrl],
    one: oneFrom(OUT, church), publish: publishTo(OUT), sk: church.sk, pub: church.pub,
  });
  const res = await con.enrolRelayNet({ extra: [OUT.wsUrl] });   // B4: the consent path
  assert.equal(res.published, true, 'nothing was published');
  const entries = cores[1][1].parseRelayNet((await storedRelayNet(OUT, church))[0].content);
  const byPub = new Map(entries.map(e => [e.pubkey, e]));
  assert.ok(byPub.has(offline), 'a box the church had already signed for was dropped because it did not answer today');
  assert.equal(byPub.get(offline).alwaysOn, false, 'the church\'s own alwaysOn answer was overwritten by the writer');
  assert.ok(byPub.has(OUT.relayPub), 'the box this console proved was not added');

  // (b) A church that has only the OLD sync document seeds its membership from it once — and the old
  // document is left exactly as it was, because it still means "sync is on" and nothing else.
  const other = H.key();
  const seedRelay = await H.startRelay({ name: 'SEED', churches: [other.pub] });
  await H.publishAll(seedRelay, [H.relaysDoc(other, [seedRelay, OUT])]);
  const con2 = consoleWith({
    location: { protocol: 'https:', host: 'app.example.church' },
    extraRelays: () => [],
    one: oneFrom(seedRelay, other), publish: publishTo(seedRelay), sk: other.sk, pub: other.pub,
  });
  const res2 = await con2.enrolRelayNet();
  assert.equal(res2.seeded, 2, 'the one-time seed took ' + res2.seeded + ' entries from trinityone/relays, expected 2');
  const seeded = cores[1][1].parseRelayNet((await storedRelayNet(seedRelay, other))[0].content);
  assert.deepEqual(new Set(seeded.map(e => e.pubkey)), new Set([seedRelay.relayPub, OUT.relayPub]),
    'the seed did not carry the boxes the church had already trusted for sync');
  const syncDocs = (await H.corpus(seedRelay, other)).filter(e => (e.tags.find(t => t[0] === 'd') || [])[1] === 'trinityone/relays');
  assert.equal(syncDocs.length, 1, 'the old sync document must be untouched — add, never repurpose');

  // …and running it again changes nothing, so a console that opens twice does not rewrite the church's
  // membership for no reason.
  const again = await con2.enrolRelayNet();
  assert.equal(again.published, false, 'a second enrolment republished an unchanged document');
});

// ── 8. what an un-upgraded relay means for the merge schedule ──────────────────────────────────────────
test('an older relay stores the church\'s document, but the console will not enrol a box that cannot prove its key', async () => {
  // Two halves, and the second is the one that decides the deployment order.
  //
  // The document-writer half of this work merges BEFORE any client gate, and every self-hosted box in the
  // fleet is running an older build. So: does an older relay, which has no rule for this d-tag at all, still
  // STORE a church-signed copy? And does the console enrol a box it cannot get a possession proof from?
  assert.ok(H.gatewayDiffersFrom(H.DEFAULT_OLD_REV),
    'the old build is byte-identical to the working tree, so this proves nothing about an un-upgraded relay');
  const flock = H.key();
  const OLD = await H.startOldRelay({ name: 'OLD', churches: [flock.pub] });

  // (a) the church signs a membership document by hand and the older relay keeps it — the new d-tag is not
  //     refused by a build that has never heard of it, so a church can publish before its box is upgraded.
  const doc = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000),
    tags: [['d', RELAY_NET_D]], content: JSON.stringify([{ pubkey: OLD.relayPub, alwaysOn: true, url: OLD.wsUrl }]) }, flock.sk);
  await H.publishAll(OLD, [doc]);
  const docs = await storedRelayNet(OLD, flock);
  assert.equal(docs.length, 1, 'a relay on the previous build refused the church its own membership document');
  assert.deepEqual(cores[1][1].parseRelayNet(docs[0].content).map(e => e.pubkey), [OLD.relayPub]);

  // (b) but the CONSOLE cannot enrol that box, because a relay older than C2 cannot answer the nonce. This
  //     is not a defect: it is the reason merge-schedule step 3 (upgrade every relay and read versionShort
  //     off each one) comes before step 4 (open each console once and verify the document on the relay). It
  //     is asserted here so nobody plans the rollout the other way round on the strength of (a).
  const con = consoleWith({
    location: { protocol: 'https:', host: 'app.example.church' },
    extraRelays: () => [OLD.wsUrl],
    one: oneFrom(OLD, flock), publish: publishTo(OLD), sk: flock.sk, pub: flock.pub,
  });
  const res = await con.enrolRelayNet({ extra: [OLD.wsUrl] });   // B4: the consent path
  assert.deepEqual(res.proven, [], 'a relay with no /relay-identity endpoint somehow produced a possession proof');
  assert.ok(res.unproven.includes(OLD.wsUrl), 'the un-upgraded box was not reported as unproven: ' + JSON.stringify(res.unproven));
  assert.equal(res.published, false, 'the console re-signed the church\'s membership over a box it could not prove');
  assert.equal((await storedRelayNet(OLD, flock))[0].id, docs[0].id, 'the church\'s document was rewritten');
});

// ── 9. a read that did not finish is not a church with no relays ───────────────────────────────────────
test('an unfinished read publishes nothing, rather than a smaller document over a real membership', async () => {
  // If "empty" and "I don't know yet" are treated as the same fact, a console on a bad link builds a
  // membership document from scratch, publishes it with a newer timestamp, and un-admits every box the
  // church had signed for. On the connections this product is positioned for — "does this work over a thin
  // pipe in Tehran" — that is not an edge case, and the church would have no way to tell it had happened.
  //
  // Two scenarios, because there are two reads and each needs its own guard. In each, exactly ONE of the two
  // documents fails to come back; the other answers normally.

  // (a) THE MEMBERSHIP READ times out. OUT is holding the church's real document from test 7 — two boxes,
  //     one of them switched off — and it must be untouched afterwards.
  const was = await storedRelayNet(OUT, church);
  assert.equal(was.length, 1, 'precondition: the church has a real membership document on OUT');
  assert.ok(cores[1][1].parseRelayNet(was[0].content).length >= 2, 'precondition: it names more than one box');
  const conA = consoleWith({
    location: { protocol: 'https:', host: 'app.example.church' },
    extraRelays: () => [OUT.wsUrl],
    one: oneWhere(OUT, church, RELAY_NET_D), publish: publishTo(OUT), sk: church.sk, pub: church.pub,
  });
  const resA = await conA.enrolRelayNet({ extra: [OUT.wsUrl] });   // B4: the consent path
  assert.equal(resA.published, false, 'a console that could not read the church\'s document published one anyway');
  assert.equal(resA.unknown, true, 'the caller was not told the answer is unknown');
  const now2 = await storedRelayNet(OUT, church);
  assert.equal(now2.length, 1, 'the relay now holds ' + now2.length + ' membership documents');
  assert.equal(now2[0].id, was[0].id,
    'the church\'s membership was rewritten from a read that never finished — every box in the old document ' +
    'that this console could not prove today has just been un-admitted');

  // (b) THE ONE-TIME SEED READ times out, for a church that has no membership document yet. The seed happens
  //     ONCE, so it gets exactly one chance to read the old sync list correctly: seeding 0 here would look
  //     like success and the church's existing trusted boxes would never be carried across.
  const flock = H.key();
  const FRESH = await H.startRelay({ name: 'FRESH', churches: [flock.pub] });
  await H.publishAll(FRESH, [H.relaysDoc(flock, [FRESH, OUT])]);
  const conB = consoleWith({
    location: { protocol: 'https:', host: 'app.example.church' },
    extraRelays: () => [FRESH.wsUrl],
    one: oneWhere(FRESH, flock, 'trinityone/relays'), publish: publishTo(FRESH), sk: flock.sk, pub: flock.pub,
  });
  const resB = await conB.enrolRelayNet({ extra: [FRESH.wsUrl] });   // B4: the consent path
  assert.equal(resB.published, false, 'the seed read never finished and a membership document was published anyway');
  assert.equal(resB.unknown, true, 'the caller was not told the seed answer is unknown');
  assert.deepEqual(await storedRelayNet(FRESH, flock), [],
    'a membership document was written for a church whose existing trusted-relay list could not be read — ' +
    'the one-time seed has now been spent, and those boxes will never be carried across');
});

// ── 11-14. SELF-HOSTING PHASE 1 (2026-10-21): what the console signs, and where it sends it ────────────────
// A console served by its own box, for a fresh church, with two real relays: BOX (the serving box) and TYPED
// (an address the steward has in the relay panel). Fresh per test so no row leans on another's leftovers.
async function selfHostedChurch(tag) {
  const flock = H.key();
  const [BOX, TYPED] = await Promise.all([
    H.startRelay({ name: tag + '-BOX', churches: [flock.pub] }),
    H.startRelay({ name: tag + '-TYPED', churches: [flock.pub] }),
  ]);
  return { flock, BOX, TYPED, location: { protocol: 'http:', host: BOX.base.replace(/^https?:\/\//, '') } };
}
// pool.publish, as the console's pool answers it: one promise per address, landing the event on that box.
const poolTo = (...boxes) => ({
  sent: [],
  publish(urls, ev) {
    this.sent.push(...urls);
    return urls.map(async (u) => { const b = boxes.find(x => x.wsUrl === u); if (!b) throw new Error('connection failure'); await H.publishAll(b, [ev]); return ''; });
  },
});

test('B4: the automatic enrolment signs the box that served the console, and never a relay a steward typed', async () => {
  const { flock, BOX, TYPED, location } = await selfHostedChurch('B4');
  const con = consoleWith({
    location, extraRelays: () => [TYPED.wsUrl],      // typed into the panel, never consented to
    one: oneFrom(BOX, flock), publish: publishTo(BOX), sk: flock.sk, pub: flock.pub,
  });
  assert.deepEqual(con.relayNetCandidates(), [BOX.wsUrl],
    'the automatic census enumerates more than the serving box: ' + JSON.stringify(con.relayNetCandidates()));
  const res = await con.enrolRelayNet();             // what autoEnrolRelayNet calls: no `extra`
  assert.equal(res.published, true, 'the console did not sign its own box');
  const signed = cores[1][1].parseRelayNet((await storedRelayNet(BOX, flock))[0].content).map(e => e.pubkey);
  assert.ok(signed.includes(BOX.relayPub), 'the serving box is not in the church\'s signed list');
  assert.ok(!signed.includes(TYPED.relayPub),
    'A RELAY THE STEWARD MERELY TYPED WAS SIGNED AUTOMATICALLY — one paste and every member phone trusts it (B4)');
  // …and the consent path does sign it.
  const res2 = await con.enrolRelayNet({ extra: [TYPED.wsUrl] });
  assert.equal(res2.published, true, 'the consented relay was not signed');
  const signed2 = cores[1][1].parseRelayNet((await storedRelayNet(BOX, flock)).sort((a, b) => b.created_at - a.created_at)[0].content).map(e => e.pubkey);
  assert.ok(signed2.includes(TYPED.relayPub), 'signRelay\'s path did not add the consented relay');
});

test('the serving box is recorded by its NAME and PUBLIC address — never localhost — and a name is never blanked', async () => {
  const { flock, BOX, location } = await selfHostedChurch('NAME');
  const PUBLIC = 'wss://quiet-dove-45.example/relay';
  const first = consoleWith({
    location, selfName: 'quiet-dove-45', selfPublic: PUBLIC,
    one: oneFrom(BOX, flock), publish: publishTo(BOX), sk: flock.sk, pub: flock.pub,
  });
  assert.equal((await first.enrolRelayNet()).published, true, 'nothing was signed');
  const docs = await storedRelayNet(BOX, flock);
  for (const [file, api] of cores) {
    const e = api.parseRelayNet(docs[0].content).find(x => x.pubkey === BOX.relayPub);
    assert.ok(e, `${file}: the box is not in the list`);
    assert.equal(e.name, 'quiet-dove-45', `${file}: the box's stable name was not kept — a phone cannot follow it when its tunnel moves`);
    assert.equal(e.url, PUBLIC, `${file}: the entry does not carry the box's public address`);
  }
  assert.doesNotMatch(docs[0].content, /localhost|127\.0\.0\.1/,
    'a loopback address went into the church\'s signed list — it names the steward\'s own computer, which no phone can reach');

  // The tunnel goes down: selfRelayName/selfPublicRelay are wiped locally. The console re-enrols on unlock.
  const later = consoleWith({
    location, selfName: '', selfPublic: '',
    one: oneFrom(BOX, flock), publish: publishTo(BOX), sk: flock.sk, pub: flock.pub,
  });
  const res = await later.enrolRelayNet();
  assert.equal(res.published, false, 'an unchanged list was re-signed');
  const after = (await storedRelayNet(BOX, flock));
  assert.equal(after.length, 1, 'the church\'s document was rewritten');
  const e2 = cores[0][1].parseRelayNet(after[0].content).find(x => x.pubkey === BOX.relayPub);
  assert.equal(e2.name, 'quiet-dove-45', 'THE NAME WAS BLANKED because the tunnel happened to be down at unlock');
  assert.equal(e2.url, PUBLIC, 'the public address was blanked because the tunnel happened to be down at unlock');
});

test('B3: the signed list reaches the box that just proved itself, even when the gated publish lands nowhere', async () => {
  const { flock, BOX, TYPED, location } = await selfHostedChurch('B3');
  // (a) The gated publish set holds nothing yet (publish lands nowhere). The box that answered the proof
  //     must still end up holding the document that admits it.
  const pool = poolTo(BOX);
  const con = consoleWith({
    location, pool,
    one: oneFrom(BOX, flock), publish: async () => false, sk: flock.sk, pub: flock.pub,
  });
  const res = await con.enrolRelayNet();
  assert.deepEqual(res.delivered, [BOX.wsUrl], 'the document was not sent to the proven box: ' + JSON.stringify(res));
  const held = await storedRelayNet(BOX, flock);
  assert.equal(held.length, 1, 'THE CHURCH\'S OWN RELAY DOES NOT HOLD THE DOCUMENT THAT ADMITS IT (B3)');

  // (b) Unchanged list, and a box that missed it: the EXISTING signed event is re-sent byte for byte, never
  //     re-signed — so it cannot clobber anything newer and costs no new timestamp.
  const pool2 = poolTo(TYPED);
  const con2 = consoleWith({
    location: { protocol: 'https:', host: 'app.example.church' }, pool: pool2,
    // Since the fourth audit (finding 1) the unchanged list also goes over publish() — verbatim. Anything else
    // reaching publish here would be a re-signed copy.
    one: oneFrom(BOX, flock), publish: async (ev) => { sentB.push(ev); return ev; },
    sk: flock.sk, pub: flock.pub,
  });
  const sentB = [];
  // Put TYPED in the list first (by hand, signed by the church) so the run below finds nothing to change.
  const doc = finalizeEvent({ kind: 30078, created_at: held[0].created_at + 1, tags: [['d', RELAY_NET_D]],
    content: JSON.stringify([...cores[0][1].parseRelayNet(held[0].content), { pubkey: TYPED.relayPub, alwaysOn: true, url: '' }]) }, flock.sk);
  await H.publishAll(BOX, [doc]);
  const res2 = await con2.enrolRelayNet({ extra: [TYPED.wsUrl] });
  assert.equal(res2.published, false, 'an unchanged list was re-signed');
  assert.deepEqual(sentB.map(e => e.id), [doc.id], 'an unchanged list was re-signed, or not re-sent verbatim');
  assert.deepEqual(res2.delivered, [TYPED.wsUrl], 'the unchanged document was not re-sent to the proven box');
  const onTyped = await storedRelayNet(TYPED, flock);
  assert.equal(onTyped.length, 1, 'TYPED does not hold the church\'s document');
  assert.equal(onTyped[0].id, doc.id, 'the box was handed a re-signed copy instead of the church\'s own event');
});

test('B1: a console helping another church, or viewing a network, signs nothing and sends nothing', async () => {
  const { flock, BOX, location } = await selfHostedChurch('B1');
  for (const who of [{ actingChurch: H.key().pub }, { viewingNetwork: true }]) {
    let published = 0, reads = 0;
    const pool = poolTo(BOX);
    const one = oneFrom(BOX, flock);
    const con = consoleWith({
      location, pool, ...who,
      one: async (f) => { reads++; return one(f); }, publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub,
    });
    const res = await con.enrolRelayNet();
    // The guard at the top, not only the re-check before signing: a console that is not this church's own must
    // not even READ the list under the wrong identity (B1's own words: "before anything else").
    assert.equal(reads, 0, 'a delegated/network console read the church\'s relay list before refusing: ' + JSON.stringify(who));
    assert.equal(res.published, false, 'a delegated/network console signed a relay list: ' + JSON.stringify(who));
    assert.ok(res.skipped, 'the caller was not told why nothing happened');
    assert.equal(published + pool.sent.length, 0,
      'A CONSOLE THAT IS NOT THIS CHURCH\'S OWN WROTE A RELAY LIST — in delegated mode that is the helper\'s key ' +
      'signing over their own church\'s list (B1): ' + JSON.stringify(who));
  }
  assert.deepEqual(await storedRelayNet(BOX, flock), [], 'something reached the box');
});

// ── 15-16. the second audit round (2026-10-21) ───────────────────────────────────────────────────────────
test('a list is never rebuilt from scratch unless EVERY relay asked said "nothing here" (audit finding 2)', async () => {
  const { flock, BOX, location } = await selfHostedChurch('F2');
  let published = 0;
  const pool = poolTo(BOX);
  // One relay answered empty; the other (the one that holds the church's real list) is down.
  const con = consoleWith({
    location, pool,
    // Only the relay-net read is half-answered. The one-time seed read answers in full, so nothing but the rule
    // under test can stop the from-scratch rebuild (a first version half-answered both, and the seed's own guard
    // hid a sabotage of this one).
    one: async (f) => ((f[0]['#d'] || [])[0] === RELAY_NET_D
      ? { ev: null, complete: true, answered: 1, asked: 2, askedUrls: ['wss://somewhere-else.example/relay', 'wss://holds-the-list.example/relay'], answeredUrls: ['wss://somewhere-else.example/relay'] }
      : { ev: null, complete: true, answered: 2, asked: 2, askedUrls: ['wss://somewhere-else.example/relay', 'wss://holds-the-list.example/relay'], answeredUrls: ['wss://somewhere-else.example/relay', 'wss://holds-the-list.example/relay'] }),
    publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub,
  });
  const res = await con.enrolRelayNet();
  assert.equal(res.unknown, true, 'one empty answer out of two was taken as "this church has signed nothing"');
  assert.equal(published + pool.sent.length, 0,
    'A LIST WAS BUILT FROM SCRATCH WHILE A RELAY THAT MAY HOLD THE REAL ONE WAS DOWN — every box it named is dropped');
  // …and when both answered, the first list is written.
  const con2 = consoleWith({
    location, pool: poolTo(BOX),
    one: async () => ({ ev: null, complete: true, answered: 2, asked: 2, askedUrls: ['wss://somewhere-else.example/relay', 'wss://holds-the-list.example/relay'], answeredUrls: ['wss://somewhere-else.example/relay', 'wss://holds-the-list.example/relay'] }),
    publish: publishTo(BOX), sk: flock.sk, pub: flock.pub,
  });
  assert.equal((await con2.enrolRelayNet()).published, true, 'every relay answered and still nothing was signed');
});

test('with the shared relays unreachable, the church\'s OWN box saying "nothing here" starts the list — once (finding 2, refined)', async () => {
  // The threat model: the shared community relays are blocked or seized. "Every relay must answer" would then
  // keep a self-hosting church's own box unsigned for ever (measured in a real browser, 2026-10-21). The own
  // box's own "nothing here" is enough — but only for a console that has never seen this church's list, so a
  // reinstalled box answering empty while the relays holding the list are down is still refused.
  const { flock, BOX, location } = await selfHostedChurch('F2b');
  // Both reads (the list, and the one-time seed) get the same answer: only the own box replied, empty.
  const ownOnly = async () => ({ ev: null, complete: false, answered: 1, asked: 3, askedUrls: [BOX.wsUrl, 'wss://shared.example/relay', 'wss://holds-the-list.example/relay'], answeredUrls: [BOX.wsUrl] });
  // The automatic pass, on a box this church's registration says holds it (third audit, finding 1).
  const fresh = consoleWith({ location, boxHostsUs: true, one: ownOnly, publish: publishTo(BOX), pool: poolTo(BOX), sk: flock.sk, pub: flock.pub });
  const res = await fresh.enrolRelayNet({ auto: true });
  assert.equal(res.published, true,
    'A SELF-HOSTING CHURCH WHOSE SHARED RELAYS ARE UNREACHABLE COULD NOT SIGN ITS OWN BOX: ' + JSON.stringify(res));

  // A console that HAS seen a list for this church: the same answer is not enough.
  const store = new Map([['trinityone.steward.relaynet-seen.' + flock.pub, '1']]);
  let published = 0;
  const seen = consoleWith({ location, store, boxHostsUs: true, one: ownOnly, publish: async () => { published++; return true; }, pool: poolTo(), sk: flock.sk, pub: flock.pub });
  const res2 = await seen.enrolRelayNet({ auto: true });
  assert.equal(res2.unknown, true, 'a console that has seen this church\'s list started a new one from one box\'s "nothing here"');
  assert.equal(published, 0, 'A LIST WAS STARTED OVER ONE THIS CONSOLE HAD ALREADY SEEN — the reinstalled-box wipe');

  // And a relay that is not the church's own box saying "nothing here" is never enough on its own.
  let published3 = 0;
  const other = consoleWith({ location, boxHostsUs: true,
    one: async () => ({ ev: null, complete: false, answered: 1, asked: 3, askedUrls: [BOX.wsUrl, 'wss://somewhere-else.example/relay', 'wss://holds-the-list.example/relay'], answeredUrls: ['wss://somewhere-else.example/relay'] }),
    publish: async () => { published3++; return true; }, pool: poolTo(), sk: flock.sk, pub: flock.pub });
  assert.equal((await other.enrolRelayNet({ auto: true })).unknown, true, 'another relay\'s "nothing here" started the list');
  assert.equal(published3, 0);
});

test('a console remembers having seen its church\'s list, so a later empty answer is never taken as "no list"', async () => {
  const { flock, BOX, location } = await selfHostedChurch('SEEN');
  const store = new Map();
  const con = consoleWith({ location, store, one: oneFrom(BOX, flock), publish: publishTo(BOX), pool: poolTo(BOX), sk: flock.sk, pub: flock.pub });
  assert.equal((await con.enrolRelayNet()).published, true, 'precondition: the first list was signed');
  assert.equal(store.get('trinityone.steward.relaynet-seen.' + flock.pub), '1',
    'the console did not remember signing a list — after a reinstall its own box\'s empty answer would wipe it');
});

// ── the own-box exception belongs to the automatic pass on the church's own box (third audit, finding 1) ──
// The wipe the audit verified: the hosted console in a new browser, the box that served it answering "nothing
// here", the church's real box unreachable — and a steward's Connect rebuilt the list as [typed], dropping the
// church's own box. Each row stands up "only the serving box answered, empty" and must start NO list.
test('only the automatic pass, on a box that holds this church and is not a shared relay, may start a list on its own answer (third audit, finding 1)', async () => {
  const { flock, BOX, TYPED, location } = await selfHostedChurch('F1');
  const ownOnly = async () => ({ ev: null, complete: false, answered: 1, asked: 3, askedUrls: [BOX.wsUrl, 'wss://shared.example/relay', 'wss://holds-the-list.example/relay'], answeredUrls: [BOX.wsUrl] });
  // The one-time seed read finds an old sync list naming another box: a list started here WOULD have something
  // to sign even when the serving box itself is skipped, so the shared-key row cannot pass by accident.
  const oldSync = H.relaysDoc(flock, [TYPED]);
  const ownOnlyWithSeed = async (f) => ((f[0]['#d'] || [])[0] === RELAY_NET_D ? ownOnly() : { ev: oldSync, complete: false, answered: 1, asked: 3, askedUrls: [BOX.wsUrl, 'wss://shared.example/relay', 'wss://holds-the-list.example/relay'], answeredUrls: [BOX.wsUrl] });
  for (const [why, deps, opts] of [
    ['a steward\'s Connect (the consent path)', { boxHostsUs: true }, { extra: [TYPED.wsUrl] }],
    ['the consent path, even if it claims to be automatic', { boxHostsUs: true }, { auto: true, extra: [TYPED.wsUrl] }],
    ['a bare call (neither automatic nor consented)', { boxHostsUs: true }, undefined],
    ['the automatic pass on a box not yet known to hold this church', { boxHostsUs: null }, { auto: true }],
    ['the automatic pass on a box that holds a different church', { boxHostsUs: false }, { auto: true }],
    ['the automatic pass on a box serving the SHARED relay\'s key', { boxHostsUs: true, shared: [BOX.relayPub] }, { auto: true }],
  ]) {
    let published = 0;
    const pool = poolTo(BOX, TYPED);
    const con = consoleWith({ location, ...deps, pool, one: ownOnlyWithSeed, publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub });
    const res = await con.enrolRelayNet(opts);
    assert.equal(res.unknown, true, why + ': one box\'s "nothing here" was taken as "this church has no list": ' + JSON.stringify(res));
    assert.equal(published + pool.sent.length, 0, why + ': A LIST WAS STARTED FROM ONE BOX\'S EMPTY ANSWER — the real list, on a box that did not answer, is replaced');
  }
  assert.deepEqual(await storedRelayNet(BOX, flock), [], 'something reached the box');
  assert.deepEqual(await storedRelayNet(TYPED, flock), [], 'something reached the typed relay');
});

test('a console that READS its church\'s list remembers it, so the own box\'s later empty answer starts nothing (third audit, finding 7)', async () => {
  const { flock, BOX, location } = await selfHostedChurch('F7SEEN');
  // The church's list already names its box exactly as this console would write it, so nothing is signed: the
  // only thing that can remember the list is the read itself.
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }])]);
  const store = new Map();
  const stored = (await storedRelayNet(BOX, flock))[0];
  const sent = [];   // since the fourth audit an unchanged list is re-sent over publish — verbatim, never re-signed
  const con = consoleWith({ location, store, boxHostsUs: true, one: oneFrom(BOX, flock), publish: async (ev) => { sent.push(ev.id); return true; }, pool: poolTo(BOX), sk: flock.sk, pub: flock.pub });
  const res = await con.enrolRelayNet({ auto: true });
  assert.equal(res.published, false, 'precondition: an unchanged list was re-signed');
  assert.ok(sent.every(id => id === stored.id), 'precondition: an unchanged list was re-signed');
  assert.equal(store.get('trinityone.steward.relaynet-seen.' + flock.pub), '1',
    'A CONSOLE THAT READ ITS CHURCH\'S LIST DID NOT REMEMBER IT — after a reinstall its own box\'s empty answer would restart the list');
  // …and that memory is what refuses the same console later, when only its own box answers, empty.
  let published2 = 0;
  const later = consoleWith({ location, store, boxHostsUs: true, pool: poolTo(),
    one: async () => ({ ev: null, complete: false, answered: 1, asked: 3, askedUrls: [BOX.wsUrl, 'wss://shared.example/relay', 'wss://holds-the-list.example/relay'], answeredUrls: [BOX.wsUrl] }),
    publish: async () => { published2++; return true; }, sk: flock.sk, pub: flock.pub });
  assert.equal((await later.enrolRelayNet({ auto: true })).unknown, true, 'a console that had read the list started a new one');
  assert.equal(published2, 0);
});

// ── the one-time seed read, at the point of use (second audit, findings 4 and 5) ────────────────────────
// `one` sees the third argument enrolRelayNet passes — privateDoc — and answers the seed read the way the real
// reader does: an empty answer from a relay still waiting on our login does not count.
function seedWorld(BOX, seedAnswer) {
  return async (f, ms, privateDoc) => {
    if ((f[0]['#d'] || [])[0] === RELAY_NET_D) return { ev: null, complete: true, answered: 1, asked: 1, askedUrls: [BOX.wsUrl], answeredUrls: [BOX.wsUrl] };
    return seedAnswer(privateDoc);
  };
}
test('the seed read is asked as PRIVATE, so an answer given while our login is pending never counts (finding 4)', async () => {
  const { flock, BOX, location } = await selfHostedChurch('SEEDP');
  let published = 0;
  const con = consoleWith({ location, pool: poolTo(),
    // The old sync list exists but is withheld: the relay answered empty while our login was still pending.
    one: seedWorld(BOX, (privateDoc) => privateDoc
      ? { ev: null, complete: true, answered: 0, asked: 1, askedUrls: [BOX.wsUrl], answeredUrls: [] }
      : { ev: null, complete: true, answered: 1, asked: 1, askedUrls: [BOX.wsUrl], answeredUrls: [BOX.wsUrl] }),
    publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub });
  const res = await con.enrolRelayNet();
  assert.equal(res.unknown, true, 'the seed read was not asked as private, so a withheld list read as "none"');
  assert.equal(published, 0, 'A LIST WAS STARTED WITHOUT THE CHURCH\'S OLD SYNC BOXES — the one-time seed is spent for good');
});
test('the seed read must be answered in full, or by the church\'s own box — not by one other relay (finding 5)', async () => {
  const { flock, BOX, location } = await selfHostedChurch('SEEDF');
  let published = 0;
  const con = consoleWith({ location, pool: poolTo(),
    one: seedWorld(BOX, () => ({ ev: null, complete: true, answered: 1, asked: 2, askedUrls: [BOX.wsUrl, 'wss://somewhere-else.example/relay'], answeredUrls: ['wss://somewhere-else.example/relay'] })),
    publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub });
  assert.equal((await con.enrolRelayNet()).unknown, true, 'one other relay\'s empty answer was taken as "no old sync list"');
  assert.equal(published, 0);
});
test('a refused login on a SHARED relay does not block the seed: the church\'s own box answering is enough (finding 9)', async () => {
  // A socket keeps its last login challenge; if the shared relay refused our login, its answers never count.
  // The own-box rule means that cannot keep a self-hosting church from signing its box.
  const { flock, BOX, location } = await selfHostedChurch('SEEDS');
  const con = consoleWith({ location, pool: poolTo(BOX), boxHostsUs: true,
    one: seedWorld(BOX, () => ({ ev: null, complete: true, answered: 1, asked: 2, askedUrls: [BOX.wsUrl, 'wss://shared.example/relay'], answeredUrls: [BOX.wsUrl] })),
    publish: publishTo(BOX), sk: flock.sk, pub: flock.pub });
  assert.equal((await con.enrolRelayNet({ auto: true })).published, true, 'a refused login on another relay kept the church\'s own box unsigned');
});

// ── Remove un-signs (owner decision B, 2026-10-21) ──────────────────────────────────────────────────────
test('removing a relay takes it out of the church\'s signed list — and only that relay', async () => {
  const { flock, BOX, TYPED, location } = await selfHostedChurch('UNSIGN');
  const con = consoleWith({ location, one: oneFrom(BOX, flock), publish: publishTo(BOX), pool: poolTo(BOX, TYPED), sk: flock.sk, pub: flock.pub });
  await con.enrolRelayNet();
  await con.enrolRelayNet({ extra: [TYPED.wsUrl] });
  const latest = async () => { const d = (await storedRelayNet(BOX, flock)).sort((a, b) => b.created_at - a.created_at); return cores[0][1].parseRelayNet(d[0].content).map(e => e.pubkey); };
  assert.deepEqual(new Set(await latest()), new Set([BOX.relayPub, TYPED.relayPub]), 'precondition: both are signed');
  await new Promise(r => setTimeout(r, 1100));   // a newer second, so newest-wins can see the change
  const res = await con.unenrolRelayNet(TYPED.wsUrl);
  assert.equal(res.removed, true, 'the relay was not removed: ' + JSON.stringify(res));
  assert.deepEqual(await latest(), [BOX.relayPub],
    'REMOVE LEFT THE RELAY IN THE CHURCH\'S SIGNED LIST, or took another with it');
});
test('a relay that is offline is removed by the address the list recorded for it', async () => {
  const { flock, BOX, location } = await selfHostedChurch('UNSIGN2');
  const gone = 'e'.repeat(64);
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }, { pubkey: gone, alwaysOn: true, url: 'wss://gone.example/relay' }])]);
  await new Promise(r => setTimeout(r, 1100));
  const con = consoleWith({ location, one: oneFrom(BOX, flock), publish: publishTo(BOX), sk: flock.sk, pub: flock.pub });
  assert.equal((await con.unenrolRelayNet('wss://gone.example/relay')).removed, true, 'an offline relay could not be removed');
  const d = (await storedRelayNet(BOX, flock)).sort((a, b) => b.created_at - a.created_at);
  assert.deepEqual(cores[0][1].parseRelayNet(d[0].content).map(e => e.pubkey), [BOX.relayPub]);
});
test('removing writes nothing when the list could not be read in full, or from a console that is not this church\'s own', async () => {
  const { flock, BOX, location } = await selfHostedChurch('UNSIGN3');
  for (const [why, deps] of [
    ['an unfinished read', { one: async () => ({ ev: null, complete: false, answered: 0, asked: 2, askedUrls: ['wss://somewhere-else.example/relay', 'wss://holds-the-list.example/relay'], answeredUrls: [] }) }],
    ['a delegated console', { actingChurch: H.key().pub, one: oneFrom(BOX, flock), mustNotRead: true }],
    ['a network view', { viewingNetwork: true, one: oneFrom(BOX, flock), mustNotRead: true }],
  ]) {
    let published = 0, reads = 0;
    const one = deps.one;
    const con = consoleWith({ location, ...deps, one: async (...a) => { reads++; return one(...a); }, publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub });
    const res = await con.unenrolRelayNet('wss://anything.example/relay');
    assert.equal(res.removed, false, why + ': something was removed');
    assert.equal(published, 0, why + ': A RELAY LIST WAS WRITTEN');
    // The guard at the top, not only the re-check before signing: the wrong identity must not even read the list.
    if (deps.mustNotRead) assert.equal(reads, 0, why + ': the church\'s relay list was read under the wrong identity');
  }
});

test('removing changes nothing unless EVERY relay asked answered — a stale copy is never re-signed (third audit, finding 6)', async () => {
  const { flock, BOX, TYPED, location } = await selfHostedChurch('F6UN');
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }, { pubkey: TYPED.relayPub, alwaysOn: true, url: TYPED.wsUrl }])]);
  const before = await storedRelayNet(BOX, flock);
  let published = 0;
  // The list came back — but from one of two relays. The other may hold a newer list. A REAL read (round 6): the
  // box answers, the other relay is switched off.
  const half = realRead([BOX.wsUrl, await deadRelay()]);
  const con = consoleWith({ location, one: half, publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub });
  const res = await con.unenrolRelayNet(TYPED.wsUrl);
  assert.equal(res.removed, false, 'a relay was removed from a list only one of two relays answered with');
  assert.equal(res.unknown, true, 'the card was not told the answer is unknown, so it cannot warn');
  assert.equal(published, 0, 'A POSSIBLY STALE LIST WAS EDITED AND RE-SIGNED — it now replaces whatever the silent relay held');
  assert.equal((await storedRelayNet(BOX, flock))[0].id, before[0].id);
});

test('removing never takes out the box this console runs on, under any address (third audit, finding 5)', async () => {
  const { flock, BOX, TYPED, location } = await selfHostedChurch('F5');
  const sharedPub = 'd'.repeat(64);
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [
    { pubkey: BOX.relayPub, alwaysOn: true, url: '' },
    { pubkey: TYPED.relayPub, alwaysOn: true, url: TYPED.wsUrl },
    { pubkey: sharedPub, alwaysOn: true, url: 'wss://shared-seed.example/relay' },
  ])]);
  // The own box a second time, under another address: same box, same key, an address nothing in the list records.
  const alias = BOX.wsUrl.replace('127.0.0.1', 'localhost');
  assert.notEqual(alias, BOX.wsUrl, 're-anchor: the box\'s address has no 127.0.0.1 to alias');
  // A console whose own box is OFFLINE, and whose list recorded that box's address: matched by the address alone.
  const deadOwn = 'ws://127.0.0.1:1/relay';
  await new Promise(r => setTimeout(r, 1100));
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [
    { pubkey: BOX.relayPub, alwaysOn: true, url: '' },
    { pubkey: TYPED.relayPub, alwaysOn: true, url: TYPED.wsUrl },
    { pubkey: sharedPub, alwaysOn: true, url: 'wss://shared-seed.example/relay' },
    { pubkey: 'c'.repeat(64), alwaysOn: true, url: deadOwn },
  ])]);
  // CHANGED round 6: a REAL read of two relays — the box, and one more that answers (TYPED holds no list), as a real
  // console always asks its own box AND the shared relays. With only the box asked, removing the box's own address
  // now leaves nothing else to have answered (the relay being removed need not answer), and that is refused as
  // unknown — fail closed — before the own-box check is reached. The card offers no Remove on the own box's row.
  const both = () => realRead([BOX.wsUrl, TYPED.wsUrl]);
  for (const [why, url, flag, at] of [
    ['the own box under another address (matched by the key it proves)', alias, 'ownBox', location],
    ['the own box\'s own address', BOX.wsUrl, 'ownBox', location],
    ['the own box\'s own address while that box is offline (matched by address)', deadOwn, 'ownBox', { protocol: 'http:', host: '127.0.0.1:1' }],
  ]) {
    let published = 0;
    const con = consoleWith({ location: at, shared: [sharedPub], one: both(), publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub });
    const res = await con.unenrolRelayNet(url);
    assert.equal(res[flag], true, why + ': not refused as ' + flag + ': ' + JSON.stringify(res));
    assert.equal(published, 0, why + ': THE LIST WAS RE-SIGNED WITHOUT IT');
  }
  // …and an ordinary typed relay is still removed by the same console, so the refusal is not a blanket one.
  await new Promise(r => setTimeout(r, 1100));
  const con = consoleWith({ location, shared: [sharedPub], one: oneFrom(BOX, flock), publish: publishTo(BOX), sk: flock.sk, pub: flock.pub });
  assert.equal((await con.unenrolRelayNet(TYPED.wsUrl)).removed, true, 'the refusal blocked an ordinary relay too');
  // A shared relay the old sync list seeded in is taken out like any other (fourth audit, finding 4): Remove used
  // to refuse it and the card said nothing, so the list went on naming it after a steward was told it was gone.
  await new Promise(r => setTimeout(r, 1100));
  const con2 = consoleWith({ location, shared: [sharedPub], one: oneFrom(BOX, flock), publish: publishTo(BOX), sk: flock.sk, pub: flock.pub });
  assert.equal((await con2.unenrolRelayNet('wss://shared-seed.example/relay')).removed, true, 'a seeded shared relay could not be removed');
  const d = (await storedRelayNet(BOX, flock)).sort((a, b) => b.created_at - a.created_at);
  assert.ok(!cores[0][1].parseRelayNet(d[0].content).some(e => e.pubkey === sharedPub), 'the list still names the shared relay');
});

// ── the fourth audit round (2026-10-21) ────────────────────────────────────────────────────────────────
test('the church\'s list goes to the shared relays too, verbatim, even when nothing changed (fourth audit, finding 1)', async () => {
  // A list first signed while the shared relays were unreachable reached only the church's own box. A new browser
  // asks only relays it knows — never that box — so every one said "nothing here" and Connect rebuilt the list.
  const { flock, BOX, location } = await selfHostedChurch('F1R');
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }])]);
  const stored = (await storedRelayNet(BOX, flock))[0];
  const sent = [];
  const con = consoleWith({ location, boxHostsUs: true, one: oneFrom(BOX, flock), pool: poolTo(BOX),
    publish: async (ev, opts) => { sent.push([ev, opts]); return ev; }, sk: flock.sk, pub: flock.pub });
  const res = await con.enrolRelayNet({ auto: true });
  assert.equal(res.published, false, 'precondition: an unchanged list was re-signed');
  assert.equal(sent.length, 1, 'THE CHURCH\'S LIST WAS NOT SENT OVER THE PUBLISH SET — the shared relays never get it, and a new browser finds "nothing here"');
  assert.equal(sent[0][0].id, stored.id, 'what was sent is not the church\'s own event, byte for byte');
});

test('a list found on a partial read is passed on, never re-signed — a stale copy cannot undo a Remove (fourth audit, finding 6)', async () => {
  const { flock, BOX, TYPED, location } = await selfHostedChurch('F6R');
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }])]);
  const stored = (await storedRelayNet(BOX, flock))[0];
  const sent = [];
  // A REAL read (round 6): the box and the typed relay answer, a third relay is switched off.
  const half = realRead([BOX.wsUrl, await deadRelay(), TYPED.wsUrl]);
  const pool = poolTo(BOX, TYPED);
  const con = consoleWith({ location, one: half, pool, publish: async (ev) => { sent.push(ev); return ev; }, sk: flock.sk, pub: flock.pub });
  const res = await con.enrolRelayNet({ extra: [TYPED.wsUrl] });
  assert.equal(res.unknown, true, 'the card was not told the answer is unknown: ' + JSON.stringify(res));
  assert.equal(res.published, false);
  assert.deepEqual(sent.map(e => e.id), [stored.id], 'A LIST READ FROM ONE OF TWO RELAYS WAS RE-SIGNED — a copy that missed a Remove would put the relay back');
  const now = await storedRelayNet(BOX, flock);
  assert.equal(now.length, 1); assert.equal(now[0].id, stored.id, 'the box holds a re-signed list');
  assert.deepEqual(await storedRelayNet(TYPED, flock).then(d => d.map(e => e.id)), [stored.id], 'the list found was not passed on to the box that proved itself');
});

test('removing refuses when the console\'s own box cannot say which key is its own (fourth audit, finding 3)', async () => {
  // The removed address proves a key; the console's own box does not answer, so nothing can rule out that the
  // address is the own box's alias. Unknown — never removed.
  const { flock, BOX } = await selfHostedChurch('F3R');
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }, { pubkey: 'e'.repeat(64), alwaysOn: true, url: 'wss://other.example/relay' }])]);
  let published = 0;
  const con = consoleWith({ location: { protocol: 'http:', host: '127.0.0.1:1' }, one: oneFrom(BOX, flock),
    publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub });
  const res = await con.unenrolRelayNet(BOX.wsUrl.replace('127.0.0.1', 'localhost'));
  assert.equal(res.removed, false, 'a relay was removed while the console could not tell its own box\'s key: ' + JSON.stringify(res));
  assert.equal(res.unknown, true, 'the card was not told to try again');
  assert.equal(published, 0, 'THE LIST WAS RE-SIGNED WITHOUT A BOX THAT MAY BE THE CHURCH\'S OWN');
});

test('a typed SHARED relay is reported as shared, so the card can say it needs no signing (third audit, finding 8)', async () => {
  const { flock, BOX, TYPED, location } = await selfHostedChurch('F8SH');
  const con = consoleWith({ location, shared: [TYPED.relayPub], one: oneFrom(BOX, flock), publish: publishTo(BOX), pool: poolTo(BOX), sk: flock.sk, pub: flock.pub });
  const res = await con.enrolRelayNet({ extra: [TYPED.wsUrl] });
  const p = (res.proven || []).find(x => x.url === TYPED.wsUrl);
  assert.ok(p, 'precondition: the typed relay proved its key: ' + JSON.stringify(res));
  assert.equal(p.shared, true, 'A SHARED RELAY WAS NOT MARKED SHARED — the steward is told "try again" over a relay that can never be signed');
  assert.ok(!(res.entries || []).some(e => e.pubkey === TYPED.relayPub), 'the shared relay was signed into the church\'s list');
  assert.ok(!(res.proven || []).find(x => x.url === BOX.wsUrl).shared, 'the church\'s own box was marked shared');
});

test('a console that switches to a network view mid-removal signs nothing (third audit, finding 7)', async () => {
  const { flock, BOX, TYPED, location } = await selfHostedChurch('F7UN');
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }, { pubkey: TYPED.relayPub, alwaysOn: true, url: TYPED.wsUrl }])]);
  let calls = 0, published = 0;
  const con = consoleWith({
    location,
    viewingNetwork: () => (calls++ > 0),            // our own church at the guard, a network view by the time we sign
    one: oneFrom(BOX, flock), publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub,
  });
  const res = await con.unenrolRelayNet(TYPED.wsUrl);
  assert.ok(calls >= 2, 're-anchor: the identity was only checked once');
  assert.equal(res.removed, false);
  assert.equal(res.unknown, true, 'the card was not told the removal did not happen');
  assert.equal(published, 0, 'THE CONSOLE RE-SIGNED THE LIST AFTER IT HAD SWITCHED AWAY — church A\'s list under another key');
});

test('a console that switches to a network view mid-enrolment signs nothing (audit finding 6)', async () => {
  const { flock, BOX, location } = await selfHostedChurch('F6');
  let calls = 0, published = 0;
  const pool = poolTo(BOX);
  const con = consoleWith({
    location, pool,
    viewingNetwork: () => (calls++ > 0),            // our own church at the guard, a network view by the time we sign
    one: oneFrom(BOX, flock), publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub,
  });
  const res = await con.enrolRelayNet();
  assert.ok(calls >= 2, 're-anchor: the identity was only checked once');
  assert.equal(res.unknown, true, 'the caller was not told to try again');
  assert.equal(published + pool.sent.length, 0,
    'THE CONSOLE SIGNED AFTER IT HAD SWITCHED AWAY — church A\'s list under another key');
  assert.deepEqual(await storedRelayNet(BOX, flock), [], 'something reached the box');
});

// ── the fifth audit round (2026-10-21), every row over REAL reads ──────────────────────────────────────────
test('an offline relay the list names is removed, though it cannot answer (round 6, fifth audit finding 1)', async () => {
  const { flock, BOX, location } = await selfHostedChurch('R6N1');
  const DEAD = await deadRelay();
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }, { pubkey: 'e'.repeat(64), alwaysOn: true, url: DEAD }])]);
  await new Promise(r => setTimeout(r, 1100));   // a newer second, so newest-wins can see the change
  // Re-anchor: the read really is partial — the relay being removed did not answer.
  const probe = await realRead([BOX.wsUrl, DEAD])([{ kinds: [30078], authors: [flock.pub], '#d': [RELAY_NET_D] }]);
  assert.ok(probe.ev, 're-anchor: the box did not return the church\'s list');
  // (`complete` is true here — it means "everyone finished and someone answered" — so the count is the anchor.)
  assert.equal(probe.answered, 1, 're-anchor: a switched-off relay was counted as answering');
  assert.equal(probe.asked, 2, 're-anchor: the read did not ask both relays');
  const con = consoleWith({ location, one: realRead([BOX.wsUrl, DEAD]), publish: publishTo(BOX), sk: flock.sk, pub: flock.pub });
  const res = await con.unenrolRelayNet(DEAD);
  assert.equal(res.removed, true, 'AN OFFLINE RELAY COULD NOT BE REMOVED — it waits for an answer from the relay being taken out, which never comes: ' + JSON.stringify(res));
  const d = (await storedRelayNet(BOX, flock)).sort((a, b) => b.created_at - a.created_at);
  assert.deepEqual(cores[0][1].parseRelayNet(d[0].content).map(e => e.pubkey), [BOX.relayPub], 'the church\'s list still names the removed relay');
});

test('…but not while ANOTHER relay is silent (round 6)', async () => {
  const { flock, BOX, location } = await selfHostedChurch('R6N2');
  const DEAD = await deadRelay(), DEAD2 = await deadRelay();
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }, { pubkey: 'e'.repeat(64), alwaysOn: true, url: DEAD }])]);
  const before = await storedRelayNet(BOX, flock);
  await new Promise(r => setTimeout(r, 1100));
  let published = 0;
  const con = consoleWith({ location, one: realRead([BOX.wsUrl, DEAD, DEAD2]), publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub });
  const res = await con.unenrolRelayNet(DEAD);
  assert.equal(res.unknown, true, 'a removal went ahead while a relay that may hold a newer list was silent: ' + JSON.stringify(res));
  assert.equal(published, 0, 'A POSSIBLY STALE LIST WAS RE-SIGNED — the exception for the relay being removed covered another silent relay too');
  assert.equal((await storedRelayNet(BOX, flock))[0].id, before[0].id);
});

test('a relay that answers but proves no key, and the list doesn\'t name, comes back notListed (round 6, fifth audit finding 2)', async () => {
  const { flock, BOX, location } = await selfHostedChurch('R6N3');
  const JUNK = await junkRelay();
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }])]);
  let published = 0;
  const con = consoleWith({ location, one: realRead([BOX.wsUrl, JUNK]), publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub });
  const res = await con.unenrolRelayNet(JUNK);
  assert.equal(res.notListed, true, 'a relay the church\'s list never named was not reported as such: ' + JSON.stringify(res));
  assert.equal(res.proven, false, 'a relay with no /status was reported as having proved a key');
  assert.equal(published, 0, 'something was signed for a relay the list never named');
});

test('re-Connect on a read with a silent relay signs nothing and says the read was partial (round 6, fifth audit finding 3)', async () => {
  const { flock, BOX, TYPED, location } = await selfHostedChurch('R6N4');
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }, { pubkey: TYPED.relayPub, alwaysOn: true, url: TYPED.wsUrl }])]);
  const stored = (await storedRelayNet(BOX, flock))[0];
  const sent = [];
  const con = consoleWith({ location, one: realRead([BOX.wsUrl, await deadRelay(), TYPED.wsUrl]), pool: poolTo(BOX, TYPED),
    publish: async (ev) => { sent.push(ev.id); return ev; }, sk: flock.sk, pub: flock.pub });
  const res = await con.enrolRelayNet({ extra: [TYPED.wsUrl] });
  assert.ok((res.entries || []).some(e => e.pubkey === TYPED.relayPub), 're-anchor: the list found does not name the typed relay: ' + JSON.stringify(res));
  assert.equal(res.published, false, 'a list was signed on a partial read');
  assert.ok(sent.every(id => id === stored.id), 'a list read from a partial answer was re-signed');
  assert.equal(res.full, false, 'THE CARD WAS NOT TOLD THE READ WAS PARTIAL — it says "✓ Added" from what may be a stale copy: ' + JSON.stringify(res));
  // …and when every relay answers, the same call says the read was full, so the flag is not a blanket "false".
  const con2 = consoleWith({ location, one: realRead([BOX.wsUrl, TYPED.wsUrl]), pool: poolTo(BOX, TYPED),
    publish: async (ev) => ev, sk: flock.sk, pub: flock.pub });
  assert.equal((await con2.enrolRelayNet({ extra: [TYPED.wsUrl] })).full, true, 'a read every relay answered was reported as partial');
});

test('removing a SHARED relay\'s address never skips waiting for it, however it is spelled (round 7, sixth audit finding 2)', async () => {
  // The shared relays are where every console finds the church's list. If a Remove could treat one as "the relay
  // being removed", the console would sign its edit without hearing from the relay most likely to hold the newest
  // list. `shared` makes test-shared.invalid a shared address; it does not resolve, so it never answers.
  const { flock, BOX, location } = await selfHostedChurch('R7SH');
  const SHARED = 'wss://test-shared.invalid/relay';
  const ODD = 'wss://TEST-SHARED.invalid:443/relay/';   // the same address, spelled differently
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }, { pubkey: 'e'.repeat(64), alwaysOn: true, url: ODD }])]);
  const before = await storedRelayNet(BOX, flock);
  await new Promise(r => setTimeout(r, 1100));
  for (const leaving of [SHARED, ODD]) {
    let published = 0;
    const con = consoleWith({ location, shared: ['f'.repeat(64)], one: realRead([BOX.wsUrl, SHARED]), publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub });
    const res = await con.unenrolRelayNet(leaving);
    assert.equal(res.unknown, true, leaving + ': a Remove went ahead without an answer from a SHARED relay: ' + JSON.stringify(res));
    assert.equal(published, 0, leaving + ': THE LIST WAS RE-SIGNED WITHOUT HEARING FROM THE SHARED RELAY');
  }
  assert.equal((await storedRelayNet(BOX, flock))[0].id, before[0].id);
});

test('a dead relay at a CAPITALISED PATH of a shared address can be removed, and then the list is no longer frozen (round 8, eighth audit finding 1)', async () => {
  // relayAddrKey keeps path case, so .../Relay is NOT the shared relay: it is a typo that never answers. While it is
  // in the panel every change to the list waits for it; removing it must work, or the list is frozen for ever.
  const { flock, BOX, TYPED, location } = await selfHostedChurch('R8TYPO');
  const TYPO = 'wss://test-shared.invalid/Relay';   // test-shared.invalid/relay is the shared address here
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }, { pubkey: 'e'.repeat(64), alwaysOn: true, url: TYPO }])]);
  await new Promise(r => setTimeout(r, 1100));
  const deps = { location, shared: ['f'.repeat(64)], pool: poolTo(BOX, TYPED), publish: publishTo(BOX), sk: flock.sk, pub: flock.pub };
  // Re-anchor: with the typo in the panel, a Connect is held (the typo never answers).
  const held = await consoleWith({ ...deps, one: realRead([BOX.wsUrl, TYPO]) }).enrolRelayNet({ extra: [TYPED.wsUrl] });
  assert.equal(held.unknown, true, 're-anchor: a relay that never answers did not hold the list: ' + JSON.stringify(held));
  // Remove the typo: it is the relay being removed and is not shared, so it need not answer.
  const res = await consoleWith({ ...deps, one: realRead([BOX.wsUrl, TYPO]) }).unenrolRelayNet(TYPO);
  assert.equal(res.removed, true, 'A DEAD /Relay TYPO COULD NOT BE REMOVED — it was treated as the shared relay, and the list stays frozen: ' + JSON.stringify(res));
  await new Promise(r => setTimeout(r, 1100));
  // …and with it gone from the panel, the same Connect goes through.
  const after = await consoleWith({ ...deps, one: realRead([BOX.wsUrl]) }).enrolRelayNet({ extra: [TYPED.wsUrl] });
  assert.equal(after.published, true, 'the list was still frozen after the typo was removed: ' + JSON.stringify(after));
  const d = (await storedRelayNet(BOX, flock)).sort((a, b) => b.created_at - a.created_at);
  assert.deepEqual(new Set(cores[0][1].parseRelayNet(d[0].content).map(e => e.pubkey)), new Set([BOX.relayPub, TYPED.relayPub]));
});

test('a dead ws:// spelling of a shared address can be removed, and then the list is no longer frozen (round 9, ninth audit finding 1)', async () => {
  // relayAddrKey ignores the scheme and calls ws://… shared, but the read dials it as its own address — a dead one
  // (the real server answers 302). Waiting for it as "a shared relay" froze every change to the list.
  const { flock, BOX, TYPED, location } = await selfHostedChurch('R9WS');
  const WS = 'ws://test-shared.invalid/relay';   // wss://test-shared.invalid/relay is the shared address here
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }, { pubkey: 'e'.repeat(64), alwaysOn: true, url: WS }])]);
  await new Promise(r => setTimeout(r, 1100));
  const deps = { location, shared: ['f'.repeat(64)], pool: poolTo(BOX, TYPED), publish: publishTo(BOX), sk: flock.sk, pub: flock.pub };
  const held = await consoleWith({ ...deps, one: realRead([BOX.wsUrl, WS]) }).enrolRelayNet({ extra: [TYPED.wsUrl] });
  assert.equal(held.unknown, true, 're-anchor: a relay that never answers did not hold the list: ' + JSON.stringify(held));
  const res = await consoleWith({ ...deps, one: realRead([BOX.wsUrl, WS]) }).unenrolRelayNet(WS);
  assert.equal(res.removed, true, 'A DEAD ws:// SPELLING COULD NOT BE REMOVED — the read waited for it as if it were the shared relay: ' + JSON.stringify(res));
  await new Promise(r => setTimeout(r, 1100));
  const after = await consoleWith({ ...deps, one: realRead([BOX.wsUrl]) }).enrolRelayNet({ extra: [TYPED.wsUrl] });
  assert.equal(after.published, true, 'the list was still frozen after the dead spelling was removed: ' + JSON.stringify(after));
});

test('removing a //relay spelling still waits for the REAL shared relay it normalises onto (round 9, ninth audit finding 2)', async () => {
  // normalizeURL — what the read and the pool use — collapses …//relay onto …/relay, the shared relay itself. If the
  // removal skipped "the relay being removed", it would skip the shared relay, and sign without hearing from it.
  const { flock, BOX, location } = await selfHostedChurch('R9DS');
  const DS = 'wss://test-shared.invalid//relay';
  await H.publishAll(BOX, [H.churchDoc(flock, RELAY_NET_D, [{ pubkey: BOX.relayPub, alwaysOn: true, url: '' }, { pubkey: 'e'.repeat(64), alwaysOn: true, url: DS }])]);
  const before = await storedRelayNet(BOX, flock);
  await new Promise(r => setTimeout(r, 1100));
  let published = 0;
  const con = consoleWith({ location, shared: ['f'.repeat(64)], one: realRead([BOX.wsUrl, DS]), publish: async () => { published++; return true; }, sk: flock.sk, pub: flock.pub });
  const res = await con.unenrolRelayNet(DS);
  assert.equal(res.unknown, true, 'A REMOVE SKIPPED THE SHARED RELAY — the //relay spelling normalises onto it: ' + JSON.stringify(res));
  assert.equal(published, 0, 'THE LIST WAS RE-SIGNED WITHOUT HEARING FROM THE SHARED RELAY');
  assert.equal((await storedRelayNet(BOX, flock))[0].id, before[0].id);
});

// ── 10. teardown, asserted rather than trusted ──────────────────────────────────────────────────────────
test('every relay and every temp directory this file created is gone', () => {
  H.stopAll();
  const left = H.leftovers();
  assert.deepEqual(left, { processes: [], dirs: [], impostors: [] },
    'this file left something running: ' + JSON.stringify(left));
});
