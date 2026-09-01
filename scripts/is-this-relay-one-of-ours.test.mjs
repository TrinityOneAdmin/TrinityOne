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
    stmt(src, 'var RELAY_PROOF_WINDOW_SEC = ', 'RELAY_PROOF_WINDOW_SEC'),
    fnBody(src, 'function relayIdentityNonce', 'relayIdentityNonce'),
    fnBody(src, 'function relayHttpBase', 'relayHttpBase'),
    fnBody(src, 'async function verifyRelayIdentity', 'verifyRelayIdentity'),
    stmt(src, 'var RELAY_NET_D = ', 'RELAY_NET_D'),
    stmt(src, 'var CANONICAL_RELAY_PUBS = ', 'CANONICAL_RELAY_PUBS'),
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
    fnBody(src, 'async function relayNetEntries', 'relayNetEntries'),
    fnBody(src, 'async function enrolRelayNet', 'enrolRelayNet'),
    fnBody(src, 'function isNetworkRelay2', 'isNetworkRelay2'),
  ].join('\n');
  assert.match(more, /const entries = mine \? parseRelayNet\(mine\.content\) : \[\]/,
    'enrolRelayNet no longer starts from what the church already signed — it would drop offline boxes');
  const f = new Function('verifyEvent', 'verifyEvent2', 'normalizeURL', 'normalizeURL2', 'fetch',
    'location', 'window', 'extraRelays', '_oneComplete', 'publish', 'sk', 'pub', 'now',
    'finalizeEvent', 'finalizeEvent2', 'relays', 'ownRelay', '_boxHostsUs',
    body + '\n' + more +
    '\nreturn { enrolRelayNet, relayNetCandidates, relayNetEntries, isNetworkRelay: isNetworkRelay2, _ownOrigin };');
  return f(verifyEvent, verifyEvent, normalizeURL, normalizeURL, globalThis.fetch,
    deps.location, undefined, deps.extraRelays || (() => []), deps.one, deps.publish, deps.sk, deps.pub,
    () => Math.floor(Date.now() / 1000), finalizeEvent, finalizeEvent,
    deps.relays || (() => []), deps.ownRelay || (() => ''), deps.boxHostsUs);
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
  return { ev: best, complete: true };
};
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
test('a church admits the relay it signed for, and refuses the identical relay it did not', async () => {
  // The console signs IN in, driving the SHIPPED enrolment code, and publishes to BOTH boxes — so OUT ends
  // up holding every byte of evidence there is and is still refused. That is the point: the refusal comes
  // from what the church signed, not from what a box happens to have seen.
  const con = consoleWith({
    location: { protocol: 'https:', host: 'app.example.church' },   // a HOSTED console: not IN's origin
    extraRelays: () => [IN.wsUrl],
    one: oneFrom(IN, church), publish: publishTo(IN, OUT), sk: church.sk, pub: church.pub,
  });
  const out = await con.enrolRelayNet();
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
  assert.equal(await con.isNetworkRelay(church.pub, OUT.wsUrl), false,
    'the console admitted a relay its church never signed for');

  // …and OUT, holding that document, is still not a member of this church's network.
  for (const [file, api] of cores) {
    const deps = { netEntries: netFrom(OUT, church, api), origin: 'https://app.example.church', pins: {} };
    assert.equal(await api.isNetworkRelay(church.pub, IN.wsUrl, deps), true,
      `${file}: the relay this church signed for was refused`);
    assert.equal(await api.isNetworkRelay(church.pub, OUT.wsUrl, deps), false,
      `${file}: a healthy relay holding the church's own membership document, whose key the church never ` +
      'signed, was admitted anyway');
  }
});

// ── 2. finding 3: a tunnel restart must not un-admit a church's own box ─────────────────────────────────
test('a relay that changed address keeps its membership, because membership is the key and not the URL', async () => {
  const before2 = await storedRelayNet(IN, church);
  assert.equal(before2.length, 1, 'precondition: the church has signed exactly one document');
  const signedUrl = cores[0][1].parseRelayNet(before2[0].content)[0].url;
  assert.equal(signedUrl, IN.wsUrl, 'precondition: the document records the address the box had when signed');

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
    // A DIFFERENT box, at that same moment, is not admitted by somebody else's origin.
    assert.equal(await api.isNetworkRelay(church.pub, OUT.wsUrl, { netEntries: async () => [], origin, pins: {} }), false,
      `${file}: same-origin admitted a relay that is not the origin`);
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
    assert.equal(await api.isNetworkRelay(church.pub, SELF.wsUrl, none), false, `${file}: precondition — unpinned, unsigned, not the origin`);

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
  const res = await con.enrolRelayNet();
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
  const res = await con.enrolRelayNet();
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
  const resA = await conA.enrolRelayNet();
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
  const resB = await conB.enrolRelayNet();
  assert.equal(resB.published, false, 'the seed read never finished and a membership document was published anyway');
  assert.equal(resB.unknown, true, 'the caller was not told the seed answer is unknown');
  assert.deepEqual(await storedRelayNet(FRESH, flock), [],
    'a membership document was written for a church whose existing trusted-relay list could not be read — ' +
    'the one-time seed has now been spent, and those boxes will never be carried across');
});

// ── 10. teardown, asserted rather than trusted ──────────────────────────────────────────────────────────
test('every relay and every temp directory this file created is gone', () => {
  H.stopAll();
  const left = H.leftovers();
  assert.deepEqual(left, { processes: [], dirs: [], impostors: [] },
    'this file left something running: ' + JSON.stringify(left));
});
