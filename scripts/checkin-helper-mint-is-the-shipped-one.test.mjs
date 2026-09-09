// THE GRANT THE CONSOLE ACTUALLY MINTS, EXECUTED — not a test-local rebuild of what it ought to produce.
// Run: node --test scripts/checkin-helper-mint-is-the-shipped-one.test.mjs
//
// WHY THIS FILE EXISTS. reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md §6 lists five shipped
// safeguarding failures and names the pattern in all of them: **the gate was correct and the screen did not
// consult it, or the test drove something that was not the shipped path.** The check-in helper slice shipped
// with 53 tests and this defect, which is that pattern with the parts swapped:
//
//   • `grep -rl` over scripts/ for publishCheckinHelpers / revokeCheckinHelpers / checkinLifetimes returned
//     NOTHING. Fifty-three tests, and not one of them ran the console.
//   • the relay tests build their grants with a test-local `keepers: [church.pub, sgLead.pub]`, written out by
//     hand in the test file.
//   • the SHIPPED mint derives that list instead, at src/steward.src.js:
//         const allowed = _capAllows(CAP_KEYS.checkin, o.caps || _stewardCaps);
//         const keepers = [cp, ...(Array.isArray(o.stewards) ? o.stewards : []).filter(allowed)];
//     so a caller that omits `o.stewards` produces `keepers = [cp]` and THE SAFEGUARDING LEAD IS GIVEN NO
//     SESSION KEY — while the relay test named "the safeguarding lead is given each session's key" goes on
//     passing, because it never asked the console for a grant.
//
// A safeguarding lead with no session key cannot open what a helper wrote. A check-in that only the volunteer
// who typed it can ever read is not a safeguarding record; the register looks staffed and is unreadable by
// the one steward accountable for it.
//
// SO THIS FILE RUNS THE REAL FUNCTION. publishCheckinHelpers is lifted out of vendor/steward.js — the bundle
// the console actually loads — with the fnBody + `with (scope)` proxy scaffold this repo already uses (see
// an-accepted-registration-tells-the-console-its-box-holds-it.test.mjs). The three things that decide the
// answer are the REAL ones and are not stubbed:
//   • buildHelperGrant / helperPolicy / lifetimeWindow, imported from scripts/checkin-role-source.mjs, which
//     is the module esbuild inlines into that bundle;
//   • _capAllows and CAP_KEYS, LIFTED OUT OF THE BUNDLE, because those live in steward.src.js and could drift
//     from anything a test restated.
// What is stubbed is the world — the key, the clock, the network — never the decision. (memory:
// stub-answers-the-question: "running real code proves nothing if a stub supplies the decision the test is
// NAMED after".)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';
import { readHelperGrant, HELPER_LIFETIMES, DEFAULT_HELPER_LIFETIME, MAX_SESSION_SECONDS,
         buildHelperGrant, helperPolicy, lifetimeWindow, eligibleHelpers, GRANT_SOURCE,
         permittedHelpers, permissionPolicy, permissionWindow, buildCheckinPermission, readCheckinPermission,
         PERMISSION_LIFETIMES, DEFAULT_PERMISSION_LIFETIME, KEY_LEAD_SECONDS } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const CHURCH = 'c'.repeat(64);
const SGLEAD = 'a'.repeat(64);
const TREASURER = 'b'.repeat(64);
const ADA = 'd'.repeat(64);
const DAN = 'e'.repeat(64);
const BEN = 'f'.repeat(64);   // cleared for a fortnight, so his clearance lapses between two Sundays

function proxyOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      // esbuild RENAMES on collision: `finalizeEvent` is `finalizeEvent2` in the bundle, because the same
      // name arrives from two modules. Strip a trailing digit and try again, exactly as the scaffold in
      // an-accepted-registration-tells-the-console-its-box-holds-it.test.mjs does — otherwise every lift out
      // of this bundle fails on a name that is only different because it was bundled.
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted mint needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

// One console's worth of world. The church key is held, this is the owner console (not a delegated steward
// acting for the church), and every publish is captured rather than sent.
function harness({ stewardCaps = { [SGLEAD]: ['safeguarding'], [TREASURER]: ['finance'] }, publishOk = true } = {}) {
  let keyNonce = 0;
  const published = [];
  const warnings = [];
  const subs = [];
  const stubs = {
    sk: new Uint8Array(32).fill(9),
    pub: CHURCH,
    churchSkHeld: () => true,
    actingChurch: null,
    _stewardCaps: stewardCaps,
    _stewardNames: {},
    now: () => 1788500000,
    NET: 'trinityone',
    CHECKINHELPER_D: D.CHECKINHELPER,
    CHECKINPERM_D: D.CHECKINPERM,
    // THE REAL DECISION-MAKERS, from the module esbuild inlines into the bundle under test. The permission
    // half is here for the same reason the grant half is: who a session key is wrapped to is now decided by
    // permittedHelpers over the church's own clearances, and a stub of that would be the test answering the
    // question it is named after.
    buildHelperGrant, helperPolicy, lifetimeWindow, eligibleHelpers, GRANT_SOURCE, KEY_LEAD_SECONDS,
    permittedHelpers, permissionPolicy, permissionWindow, buildCheckinPermission, readCheckinPermission,
    PERMISSION_LIFETIMES,
    // the world, stubbed — never the decision
    // A COUNTER, NOT A CONSTANT. This filled every byte with 0x5a, so two sessions minted the SAME key and
    // the test that two Sundays get different keys could not fail. Deterministic per call, so an assertion
    // can still name the exact ciphertext it expects; different per call, so "one key per session" is a
    // claim this harness can actually refute.
    crypto: { getRandomValues: (u8) => { u8.fill(0x5a + (keyNonce++)); return u8; } },
    _hex: (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join(''),
    // NIP-44 stands in for itself: a recipient-labelled wrapper, so "who can open which slot" stays visible
    // and provable without dragging real crypto in. It is the ONLY thing here that touches the key material,
    // and it decides nothing about who is in the envelope.
    //
    // NAMED TWICE, AND THAT IS NOT BELT-AND-BRACES. src/steward.src.js calls these `nip44ck` and `nip44e`;
    // esbuild resolves both aliases away, so in vendor/steward.js the lifted function reads
    // `encrypt3(plaintext, getConversationKey(sk, p2))`. Stubbing only the source names left every `wrap`
    // call throwing a ReferenceError — which buildHelperGrant CATCHES per recipient and records in `failed`.
    // The result was an envelope with an EMPTY `keys` object, and "the treasurer is not in keys" passed
    // vacuously against it. That is the stub-answers-the-question failure with the answer being nothing at
    // all, so grantOf() below now refuses to let any test read a grant that had a wrap failure.
    nip44ck: (_sk, p2) => 'ck:' + p2,
    nip44e: (plaintext, ck) => 'sealed[' + ck + ']' + plaintext,
    getConversationKey: (_sk, p2) => 'ck:' + p2,
    encrypt: (plaintext, ck) => 'sealed[' + ck + ']' + plaintext,
    // AND THE UNWRAP, which the ISSUER needs and the mint does not: re-issuing a session's envelope to a
    // changed set of people must REUSE the key that session already has, or every record already sealed under
    // the old one is orphaned. The church wraps a slot to itself on every envelope so it can always recover
    // its own; this stub is the inverse of the wrapper above and decides nothing.
    nip44d: (ct, ck) => { const pre = 'sealed[' + ck + ']'; if (String(ct).indexOf(pre) !== 0) throw new Error('wrong key'); return String(ct).slice(pre.length); },
    decrypt: (ct, ck) => { const pre = 'sealed[' + ck + ']'; if (String(ct).indexOf(pre) !== 0) throw new Error('wrong key'); return String(ct).slice(pre.length); },
    finalizeEvent: (e) => ({ ...e, id: 'evt', pubkey: CHURCH, sig: 'sig' }),
    _publishToRelays: async (e) => { published.push(e); return publishOk; },
    // THE RELAY POOL, captured rather than dialled — so the SHIPPED read-back can be driven with events the
    // SHIPPED writers really produced. It records the subscription's handlers and nothing else; every decision
    // about what an envelope or a tombstone MEANS stays inside the lifted function.
    relays: () => ['wss://relay.test/relay'],
    pool: { subscribeMany: (_relays, filters, handlers) => { subs.push({ filters, handlers }); return { close() {} }; } },
    _warnUnsealed: (cap, failed) => { warnings.push({ cap, failed: [...failed] }); },
    window: { dispatchEvent: () => true },
  };
  const scope = proxyOf(stubs);
  // _capAllows and CAP_KEYS come OUT OF THE BUNDLE. They live in steward.src.js, so restating them here would
  // be the test asserting against its own copy of the rule that decides who holds the register's key.
  // Evaluated with NO `with (scope)` around them, deliberately: both are closed over nothing (an object
  // literal, and an arrow reading only its own arguments), so giving them the harness's scope could only let
  // a stub of mine leak into the rule under test.
  const capKeysSrc = stmt(VENDOR, 'var CAP_KEYS = {', 'CAP_KEYS');
  const capAllowsSrc = stmt(VENDOR, 'var _capAllows = (spec, caps) =>', '_capAllows');
  const lifted = new Function(`${capKeysSrc} ${capAllowsSrc} return { CAP_KEYS, _capAllows };`)();
  stubs.CAP_KEYS = lifted.CAP_KEYS;
  stubs._capAllows = lifted._capAllows;
  assert.equal(stubs.CAP_KEYS.checkin.cap, 'safeguarding', 'lifted CAP_KEYS is not the shipped one — re-anchor');
  assert.equal(stubs.CAP_KEYS.checkin.explicit, true,
    'the register key stopped being an EXPLICIT capability, so an unscoped steward now gets it by default');

  // FOUR FUNCTIONS LIFTED, not one. The mint is no longer the whole console side: since 2026-09-09 a steward
  // grants a PERMISSION and machinery issues the session keys, so the issuer is the part that can go wrong and
  // has to be executed. All four come out of vendor/steward.js — the bundle the console actually loads.
  const lift = (sig, name) => {
    const body = fnBody(VENDOR, sig, name);
    return new Function('scope', `with (scope) { return ({ ${body} }).${name}; }`)(scope);
  };
  const mint = lift('async publishCheckinHelpers(opts) {', 'publishCheckinHelpers');
  const grantPerm = lift('async grantCheckinPermission(opts) {', 'grantCheckinPermission');
  const revokePerm = lift('revokeCheckinPermission(person) {', 'revokeCheckinPermission');
  const issue = lift('async issueCheckinSessionKeys(opts) {', 'issueCheckinSessionKeys');
  // TWO MORE, ADDED 2026-09-10 with the stand-down fix. The pair that decides whether automatic issuance can
  // reverse a steward's decision is revokeCheckinHelpers -> subscribeCheckinSessionKeys -> issueCheckinSessionKeys,
  // and all three are lifted, so nothing between the stand-down and the issuer's answer is a test's own copy.
  const standDown = lift('revokeCheckinHelpers(session) {', 'revokeCheckinHelpers');
  const readKeys = lift('subscribeCheckinSessionKeys(cb) {', 'subscribeCheckinSessionKeys');
  // `this` for the issuer is the object it lives on in the console, and the one method it reaches for is the
  // mint — the REAL one, lifted above. Nothing is stubbed between the issuer's decision and the document.
  const self = { publishCheckinHelpers: (o) => mint.call({}, o) };
  // READ THE ENVELOPES BACK THROUGH THE SHIPPED SUBSCRIPTION. `events` is fed to the real onevent handler in
  // order and then EOSE is fired, exactly as a relay would — so what comes out is what the console would
  // actually hold, including whether a stood-down session is a row or an absence. That distinction is the whole
  // subject: it decided, silently, whether the issuer re-staffed a Sunday the church had emptied.
  const sessionKeysFrom = (events) => {
    let last = null;
    const stop = readKeys.call({}, (rows) => { last = rows; });
    const sub = subs[subs.length - 1];
    assert.ok(sub, 'the lifted subscription never opened one — the pool stub was not reached');
    for (const e of events) sub.handlers.onevent(e);
    sub.handlers.oneose();
    stop();
    assert.ok(Array.isArray(last), 'the shipped subscription emitted nothing at all, not even an empty list');
    return last;
  };
  return { stubs, published, warnings, subs, sessionKeysFrom,
    publishCheckinHelpers: (o) => mint.call({}, o),
    grantCheckinPermission: (o) => grantPerm.call({}, o),
    revokeCheckinPermission: (who) => revokePerm.call({}, who),
    revokeCheckinHelpers: (sid) => standDown.call({}, sid),
    issueCheckinSessionKeys: (o) => issue.call(self, o) };
}

// The service the console is minting for: a Sunday morning, in the church's own shape.
const SERVICE = { date: '2026-09-13', time: '10:30' };
const SERVICE_2 = { date: '2026-09-20', time: '10:30' };     // the Sunday after
const SERVICE_FAR = { date: '2026-12-13', time: '10:30' };   // a service three months out
// A CLEARANCE, built by the SHIPPED builder and read back through the SHIPPED parser — never restated here. If
// buildCheckinPermission and readCheckinPermission ever stopped agreeing with each other, or with what the
// relay enforces, these tests would go red rather than testing a copy of the design.
//
// `open` by default so a fixture's window is never the thing that decides a test about WHO. The tests that are
// about windows say so and pass their own.
const perm = (who, opts = {}) => readCheckinPermission(JSON.stringify(buildCheckinPermission({
  person: who, source: opts.source || 'steward', lifetime: opts.lifetime || 'open',
  from: opts.from != null ? opts.from : 1000, until: opts.until !== undefined ? opts.until : null })));
const CLEARED = [perm(ADA), perm(DAN)];
// The instant the ISSUER is asked to act at, passed explicitly rather than taken from the harness clock, so a
// test about horizons is not silently a test about what `now()` happened to be. It is the Saturday before
// SERVICE: ~1 day to the first Sunday, ~8 to the second, ~91 to the far one.
const AT = 1789200000;
const SERVICE_PAST = { date: '2026-08-30', time: '10:30' };
const svc = (id, service) => ({ id, ...service });
// READ THE MINTED GRANT — and refuse to hand it to a test if the harness itself was broken.
//
// The `warnings` check is the important line. buildHelperGrant catches a failing `wrap` PER RECIPIENT and
// reports it in `failed` rather than refusing the whole grant (right for the product: one damaged pubkey must
// not deny the session to everyone else). In a test that means a mis-stubbed crypto call produces an envelope
// with NO keys in it at all, and every "so-and-so is not in keys" assertion below then passes over nothing.
// That happened while this file was being written, on the esbuild rename described above.
const grantOf = (h) => {
  assert.deepEqual(h.warnings, [],
    'the mint could not wrap the session key to somebody, so `keys` is short or empty and every assertion ' +
    'about who is NOT in it would pass vacuously: ' + JSON.stringify(h.warnings));
  assert.equal(h.published.length, 1, 'the mint published ' + h.published.length + ' documents, not one');
  const g = readHelperGrant(h.published[0].content);
  assert.ok(g, 'the relay\'s own parser rejects what the console minted — readHelperGrant returned null');
  const raw = JSON.parse(h.published[0].content);
  assert.ok(Object.keys(raw.keys).length > 0, 'the envelope carries no wrapped keys at all');
  return { ev: h.published[0], g, raw };
};

// ── THE DEFECT THE RELAY TESTS COULD NOT SEE ──────────────────────────────────────────────────────────────

test('THE SAFEGUARDING LEAD IS GIVEN THE SESSION KEY BY THE SHIPPED MINT, not by a list a test wrote', async () => {
  const h = harness();
  const out = await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE,
    permissions: CLEARED, stewards: [SGLEAD, TREASURER] });
  assert.ok(out, 'the shipped mint refused to publish at all');
  const { raw } = grantOf(h);

  assert.ok(raw.keys[SGLEAD],
    'the safeguarding lead was given no copy of the session key BY THE REAL MINT. A helper\'s check-in is ' +
    'then openable only by the volunteer who typed it, which is not a safeguarding record. The relay test ' +
    'named for this passes regardless, because it builds its own keeper list.');
  assert.ok(raw.keys[CHURCH], 'the church itself was given no copy of the session key');
  assert.equal(raw.keys[SGLEAD], 'sealed[ck:' + SGLEAD + ']' + '5a'.repeat(32),   // the FIRST key this harness mints
    're-anchor: the lead\'s slot is not this session\'s key wrapped to the lead');
});

test('…AND THE FINANCE-ONLY STEWARD IS NOT — the August leak, asserted as a refusal', async () => {
  // In August, granting a steward Finance handed over the children's register. The capability tick is what
  // separates them, and `checkin` is an EXPLICIT capability so an unscoped steward does not get it either.
  const h = harness();
  await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, permissions: [perm(ADA)], stewards: [SGLEAD, TREASURER] });
  const { raw } = grantOf(h);
  assert.equal(raw.keys[TREASURER], undefined,
    'a steward ticked for FINANCE ONLY was handed the key to a session of the children\'s register');
  assert.ok(!raw.pubs.includes(TREASURER), 'and named in the enforced helper list');
});

test('an UNSCOPED steward gets no session key either, because the register is an EXPLICIT capability', async () => {
  // `caps` absent for a pubkey normally means "unscoped — every capability". CAP_KEYS.checkin.explicit turns
  // that off for this one document, and it is the reason a church can hand somebody the run of the place
  // without handing them the children. Driven through the real _capAllows, lifted from the bundle.
  const h = harness({ stewardCaps: {} });
  await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, permissions: [perm(ADA)], stewards: [SGLEAD, TREASURER] });
  const { raw } = grantOf(h);
  assert.equal(raw.keys[SGLEAD], undefined,
    'an UNSCOPED steward was given the children\'s register key. The register is an explicit capability ' +
    'precisely so that "steward of everything by default" cannot reach it.');
  assert.equal(raw.keys[TREASURER], undefined, 'and the other one too');
  assert.ok(raw.keys[CHURCH], 'the church lost its own copy — nobody can open the register at all');
});

test('A CALLER THAT FORGETS THE ROSTER MINTS A GRANT ONLY THE CHURCH CAN OPEN — measured, not assumed', async () => {
  // THE POINT OF FINDING 3, stated as behaviour rather than as a worry. `stewards` is passed IN (the roster
  // lives in a React hook in the console, not in this module), so a screen that does not pass it produces a
  // grant with one keeper: the church. There is no screen yet — this slice is a security boundary with no UI
  // — so nothing is broken TODAY. What is asserted here is the shape the first screen will meet, so that when
  // it lands this file says what it must supply rather than a comment saying it.
  //
  // NOT MADE INTO A REFUSAL, deliberately, and this is a judgement worth writing down: a church with NO
  // safeguarding-ticked steward is legitimate and common — the small church where the owner does safeguarding
  // herself. `keepers = [cp]` is the CORRECT grant for her. From inside this function an omitted roster and an
  // empty roster are indistinguishable in their result, so refusing one would refuse her too, and a church
  // that cannot mint a grant cannot staff its creche. The guard belongs at the screen, and this is the test
  // that will tell whoever writes it.
  const h = harness();
  await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, permissions: [perm(ADA)] });   // no `stewards`
  const { raw } = grantOf(h);
  assert.deepEqual(Object.keys(raw.keys).sort(), [ADA, CHURCH].sort(),
    'a mint called without the steward roster produced keepers other than [church]. If that is now a ' +
    'refusal or a default, this test is the record that it used to be silent — update it deliberately.');
  assert.equal(raw.keys[SGLEAD], undefined,
    're-anchor: the lead got a key with no roster passed, so this test no longer describes the shipped path');
});

// ── WHAT THE MINT PUTS ON THE WIRE, AND WHAT THE RELAY WILL MAKE OF IT ────────────────────────────────────

test('the document the console publishes is the one the relay gates — d-tag, tags and parser agree', async () => {
  // The registry is the one authority for the d-tag (scripts/trinity-doc-types.mjs); the console names it as
  // a literal beside its forty siblings. This is the assertion that the two spellings are the same one, run
  // against the built bundle rather than against the source both were written in.
  const h = harness();
  await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, permissions: CLEARED, stewards: [SGLEAD] });
  const { ev, g } = grantOf(h);
  const tag = (k) => (ev.tags.find(t => t[0] === k) || [])[1];
  assert.equal(ev.kind, 30078);
  assert.equal(tag('d'), D.CHECKINHELPER + 'svc-sun',
    'the console publishes the grant under a d-tag the relay does not gate — the exact defect the document ' +
    'registry exists to prevent');
  assert.equal(tag('church'), CHURCH, 'the grant does not name its church');
  assert.equal(tag('session'), 'svc-sun');
  assert.equal(g.session, 'svc-sun', 'the d-tag and the content disagree about which session this is for');
  assert.deepEqual(g.pubs.sort(), [ADA, DAN].sort(), 'the enforced helper list is not the people passed in');
  assert.ok(!g.pubs.includes(SGLEAD),
    'the safeguarding lead was written into the ENFORCED list. Their authority must come from the steward ' +
    'roster, or removing them from it would leave a grant still admitting them.');
});

test('THE DEFAULTS THE MINT APPLIES ARE THE TIGHTEST ONES, and it says so in the enforced record', async () => {
  // Owner, 2026-09-09: ship the gates, never the policy — and let the default be the safe one, because a
  // church that never opens the setting must not be the one that gets the loosest grant.
  const h = harness();
  const out = await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, permissions: [perm(ADA)] });
  const { g } = grantOf(h);
  assert.equal(g.lifetime, DEFAULT_HELPER_LIFETIME, 'the mint stopped defaulting to the tightest lifetime');
  assert.equal(g.lifetime, 'session', 're-anchor: the default lifetime moved and this test was not updated');
  assert.equal(g.source, GRANT_SOURCE,
    'the envelope no longer declares the pinned source. It is issued from the church\'s PERMISSIONS and ' +
    'from nothing else; an envelope citing a rota is the pre-2026-09-09 model, where a service\'s rota ' +
    'decided who held a key.');
  assert.ok(g.until != null, 'a default grant has no end — it is a standing key to the children\'s register');
  assert.ok(g.until - g.from <= HELPER_LIFETIMES.session.max,
    'the default grant is longer than the lifetime it declares, so the relay will refuse it at the door');
  assert.equal(out.lifetime, 'session', 'the mint reports a different lifetime from the one it published');
});

test('a grant the relay would refuse is never published — the console refuses it first', async () => {
  // Same rules, both ends. A service with no placeable date yields NO grant rather than a guessed one, for
  // the same reason _sealChurchDocReady refuses to write a gathering in the clear rather than guessing a key.
  const h = harness();
  assert.equal(await h.publishCheckinHelpers({ session: 'svc-sun', service: {}, permissions: [perm(ADA)] }), null,
    'the console minted a grant for a service it could not place in time');
  assert.equal(await h.publishCheckinHelpers({ session: '', service: SERVICE, permissions: [perm(ADA)] }), null,
    'the console minted a grant with no session id');
  assert.equal(await h.publishCheckinHelpers({ session: 'svc-sun', service: { date: 'not-a-date' }, permissions: [perm(ADA)] }), null,
    'the console minted a grant from a date it could not read — a window guessed around an unparseable ' +
    'service is a key whose expiry nobody chose');
  assert.deepEqual(h.published, [], 'one of the refusals above still put a document on the wire');
});

test('GARBAGE BECOMES THE TIGHTEST OPTION, never a looser one — and never a refusal', async () => {
  // WRITTEN AGAINST AN ASSUMPTION THAT WAS WRONG, and corrected rather than built around. This started life
  // asserting that an undeclared `source` or `lifetime` makes the console publish nothing. It does not, and
  // it should not: helperPolicy() falls back to DEFAULT_HELPER_SOURCE / DEFAULT_HELPER_LIFETIME, which are the
  // rota and the single rostered session — the TIGHTEST shapes on offer.
  //
  // That is the right behaviour and the direction matters. Refusing outright would leave a church with a typo
  // in a settings document unable to staff its creche at all — a silent blank screen on a Sunday morning,
  // which reference/DOMAIN.md and §8 of the design both rate worse than the thing being guarded against. What
  // must never happen is the other direction: garbage widening into "until a steward ends it".
  const h = harness();
  await h.publishCheckinHelpers({ session: 'svc-a', service: SERVICE, permissions: [perm(ADA)], lifetime: 'forever' });
  const { g } = grantOf(h);
  assert.equal(g.lifetime, DEFAULT_HELPER_LIFETIME,
    'an unrecognised lifetime did not fall back to the tightest one');
  assert.equal(g.source, GRANT_SOURCE,
    'the envelope\'s source is not pinned. No setting can move it, which is the point: an envelope ' +
    'derived from anything but the church\'s own clearances is the shape this restructure removed.');
  assert.ok(g.until != null && g.until - g.from <= HELPER_LIFETIMES.session.max,
    'a grant naming a lifetime nothing implements ended up unbounded, or longer than the shape it fell back ' +
    'to — which is garbage widening into a standing key to the children\'s register');
  assert.notEqual(g.lifetime, 'open',
    'an undeclared lifetime became the open-ended one. `open` is not even a session lifetime any more — it ' +
    'moved to the permission on 2026-09-09 — so reaching it here would mean the two tables have been merged.');
  assert.ok(Object.values(HELPER_LIFETIMES).every(l => l.max != null),
    're-anchor: a session lifetime with no cap exists again, so "never a looser one" has nothing to bite on');
});

test('ONLY THE OWNER MINTS. A delegated steward console publishes nothing at all', async () => {
  // The relay refuses this too (gateway.mjs, the CHECKINHELPER_D branch of accept(), and there is a live test
  // for it). This is the other half: the console does not even try, so a delegated steward is not shown a
  // success over a write the relay threw away. memory: fix-the-control-not-the-label.
  const noKey = harness(); noKey.stubs.sk = null;
  assert.equal(await noKey.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, permissions: [perm(ADA)] }), null,
    'a console with no key minted a grant');
  const notHeld = harness(); notHeld.stubs.churchSkHeld = () => false;
  assert.equal(await notHeld.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, permissions: [perm(ADA)] }), null,
    'a console that is not holding the church key minted a grant to the children\'s register');
  const delegated = harness(); delegated.stubs.actingChurch = CHURCH;
  assert.equal(await delegated.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, permissions: [perm(ADA)] }), null,
    'a DELEGATED steward console minted a helper grant. A safeguarding steward can already read the register; ' +
    'being able to hand it to a third party is an escalation they do not have.');
  for (const h of [noKey, notHeld, delegated]) assert.deepEqual(h.published, [], 'and it reached the wire');
});

test('a publish the relays refused is reported as a failure, not as a staffed session', async () => {
  // memory: fix-the-control-not-the-label — six serving controls toasted success over a send that never
  // happened. A steward told the creche is staffed when no relay took the grant is the same defect, in the
  // one place where the consequence is a volunteer standing in a room with no register.
  const h = harness({ publishOk: false });
  assert.equal(await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, permissions: [perm(ADA)], stewards: [SGLEAD] }), null,
    'the console reported a staffed session over a grant no relay accepted');
});


// ══ THE PERMISSION: A STEWARD CLEARS A PERSON, ONCE ═══════════════════════════════════════════════════════
// reference/FINDING-CHECKIN-GRANTS-SHOULD-BE-PER-PERSON-2026-09-09.md, the DECIDED block. Everything below runs
// the SHIPPED functions out of vendor/steward.js, for the reason this whole file exists: a console nothing runs
// is where the last defect in this feature lived.

test('A STEWARD CLEARS A PERSON, and the document that says so CARRIES NO KEY', async () => {
  const h = harness();
  const out = await h.grantCheckinPermission({ person: ADA, source: 'steward', lifetime: 'dated', until: '2027-01-31', from: AT });
  assert.ok(out, 'the shipped console refused to clear anybody at all');
  assert.equal(h.published.length, 1, 'clearing one person published ' + h.published.length + ' documents');
  const ev = h.published[0];
  const tag = (k) => (ev.tags.find(t => t[0] === k) || [])[1];
  assert.equal(ev.kind, 30078);
  assert.equal(tag('d'), D.CHECKINPERM + ADA,
    'the console publishes a clearance under a d-tag the relay does not gate — the exact defect the document ' +
    'registry exists to prevent');
  assert.equal(tag('church'), CHURCH, 'the clearance does not name its church');
  assert.equal(tag('person'), ADA);
  const pm = readCheckinPermission(ev.content);
  assert.ok(pm, 'the relay\'s own parser rejects the clearance the console minted');
  assert.equal(pm.person, ADA, 'the d-tag and the body disagree about who is cleared');
  // THE ASSERTION THIS FILE EXISTS FOR. The rejected design was a person-scoped document wrapping a
  // longer-lived register key — simpler, and a lost phone would then expose the whole year's register rather
  // than one Sunday. The owner refused that trade knowingly. A `keys` object appearing here is that property
  // being spent, and it would look exactly like a convenience.
  const raw = JSON.parse(ev.content);
  assert.equal(raw.keys, undefined,
    'the console put key material in a clearance. That is the collapse back to the design the owner refused: ' +
    'one long-lived key per person, and a lost phone exposing the year instead of the Sunday.');
  assert.deepEqual(Object.keys(raw).sort(), ['from', 'lifetime', 'person', 'source', 'until'],
    'the clearance the console publishes has grown a field beyond who / how long');
  assert.doesNotMatch(ev.content, /[0-9a-f]{64}[\s\S]*[0-9a-f]{64}/,
    'the published clearance carries a second 64-hex value beside the person it names');
});

test('ONLY THE OWNER CLEARS ANYBODY — and a delegated steward console does not even try', async () => {
  // THE SHARPER OF THE TWO MINTS. A safeguarding steward can already READ the register; what they must not gain
  // is the power to say who ELSE may, and since 2026-09-09 this document is the only thing that says it. The
  // relay refuses it too (gateway.mjs, the CHECKINPERM_D branch of accept()); this is the console half, so a
  // delegated steward is not shown a success over a write the box threw away.
  const noKey = harness(); noKey.stubs.sk = null;
  assert.equal(await noKey.grantCheckinPermission({ person: ADA, lifetime: 'open', from: AT }), null,
    'a console with no key cleared somebody for the children\'s register');
  const notHeld = harness(); notHeld.stubs.churchSkHeld = () => false;
  assert.equal(await notHeld.grantCheckinPermission({ person: ADA, lifetime: 'open', from: AT }), null,
    'a console not holding the church key cleared somebody');
  const delegated = harness(); delegated.stubs.actingChurch = CHURCH;
  assert.equal(await delegated.grantCheckinPermission({ person: ADA, lifetime: 'open', from: AT }), null,
    'a DELEGATED steward console cleared somebody for the children\'s register. Widening this is a separate, ' +
    'already-scoped decision; it must not arrive as a side effect.');
  for (const h of [noKey, notHeld, delegated]) {
    assert.deepEqual(h.published, [], 'and it reached the wire');
    assert.equal(await h.revokeCheckinPermission(ADA), null, 'and it could revoke one');
  }
});

test('a clearance the relay would refuse is never published, and garbage becomes the TIGHTEST shape', async () => {
  const h = harness();
  assert.equal(await h.grantCheckinPermission({ person: 'not-a-pubkey', lifetime: 'open', from: AT }), null,
    'the console cleared something that is not a pubkey');
  assert.equal(await h.grantCheckinPermission({ person: '', lifetime: 'open', from: AT }), null);
  assert.equal(await h.grantCheckinPermission({ person: ADA, lifetime: 'dated', from: AT }), null,
    'a DATED clearance with no date was published — a clearance whose end nobody chose');
  assert.equal(await h.grantCheckinPermission({ person: ADA, lifetime: 'dated', until: 'whenever', from: AT }), null);
  assert.equal(await h.grantCheckinPermission({ person: ADA, lifetime: 'dated', until: '2099-01-31', from: AT }), null,
    'a clearance reaching past the cap was silently shortened and published instead of refused');
  assert.deepEqual(h.published, [], 'one of the refusals above still put a document on the wire');
  // AND THE OTHER DIRECTION: garbage must not widen. An unrecognised lifetime falls to the tightest shape, and
  // the tightest shape is one day — never "until a steward ends it", which is the only one that never expires.
  const h2 = harness();
  await h2.grantCheckinPermission({ person: ADA, lifetime: 'forever', date: '2026-09-13' });
  const pm = readCheckinPermission(h2.published[0].content);
  assert.equal(pm.lifetime, DEFAULT_PERMISSION_LIFETIME, 'an unrecognised clearance length did not fall to the tightest');
  assert.equal(pm.lifetime, 'day', 're-anchor: the default clearance length moved and this test was not updated');
  assert.ok(pm.until != null, 'garbage widened into a clearance that never expires');
  assert.notEqual(pm.lifetime, 'open',
    'an undeclared lifetime became the open-ended clearance — the one shape a typo must never reach');
});

test('WITHDRAWING A CLEARANCE IS A TOMBSTONE ON THE PERSON, not one per Sunday', async () => {
  // The whole reason "who is cleared" moved out of the per-service document: a steward acts ONCE. If this ever
  // becomes a loop over services, the chore the restructure deleted is back.
  const h = harness();
  const ok = await h.revokeCheckinPermission(ADA);
  assert.notEqual(ok, null, 'the church cannot withdraw a clearance it granted');
  assert.equal(h.published.length, 1, 'withdrawing one person\'s clearance published ' + h.published.length +
    ' documents. One person, one document — a tombstone per service is the model this replaced.');
  const ev = h.published[0];
  assert.equal((ev.tags.find(t => t[0] === 'd') || [])[1], D.CHECKINPERM + ADA);
  assert.ok(ev.tags.some(t => t[0] === 'deleted'), 'the withdrawal is not a tombstone, so the relay keeps the clearance');
  assert.equal(ev.content, '', 'a tombstone carrying content is not a tombstone');
  assert.equal(await h.revokeCheckinPermission('not-a-pubkey'), null, 'a malformed pubkey produced a tombstone');
});

// ══ THE ISSUER: THE WEEKLY ACT, WITH NO STEWARD IN IT ═════════════════════════════════════════════════════
// THE NEW MACHINERY, AND THE PART THAT CAN GO WRONG. The owner's decision was that a session key is "issued to
// whoever the permission admits, without a steward doing anything weekly". These drive the shipped issuer.

test('ONE CLEARANCE, KEYS FOR EVERY SUNDAY IN THE HORIZON — the steward acts once', async () => {
  const h = harness();
  const out = await h.issueCheckinSessionKeys({ at: AT,
    services: [svc('svc-a', SERVICE), svc('svc-b', SERVICE_2)],
    permissions: [perm(ADA)], stewards: [SGLEAD, TREASURER] });
  assert.ok(out, 'the issuer refused to act at all');
  assert.deepEqual(out.failed, [], 'the issuer failed on an ordinary service: ' + JSON.stringify(out.failed));
  assert.equal(out.issued.length, 2,
    'one clearance did not produce a key for each Sunday in the horizon. If a steward has to act per service, ' +
    'the chore this restructure deleted is back: ' + JSON.stringify(out));
  assert.equal(h.published.length, 2);
  for (const ev of h.published) {
    const g = readHelperGrant(ev.content);
    assert.ok(g, 'the relay\'s own parser rejects what the issuer minted');
    assert.deepEqual(g.pubs, [ADA], 'the issuer wrapped the session key to somebody other than the cleared person');
    assert.equal(g.source, GRANT_SOURCE, 'the issuer minted an envelope that does not declare the pinned source');
    assert.ok(g.until != null && g.until - g.from <= MAX_SESSION_SECONDS,
      'the issuer minted a key that outlives the ceiling — automatic issuance of an unbounded key is a standing ' +
      'key to the children\'s register that nobody clicked');
    const raw = JSON.parse(ev.content);
    assert.ok(raw.keys[SGLEAD], 'the safeguarding lead cannot open what a helper writes on a session it issued');
    assert.ok(raw.keys[CHURCH], 'the church has no copy of a key its own machinery minted');
    assert.equal(raw.keys[TREASURER], undefined, 'the Finance-only steward was handed a session of the register');
  }
  // TWO SESSIONS, TWO KEYS. If the issuer reused one key across services, "last Sunday's helper holds last
  // Sunday's key" would be false and the blast radius the owner paid for would be gone.
  const keys = h.published.map(ev => JSON.parse(ev.content).keys[ADA]);
  assert.notEqual(keys[0], keys[1],
    'two different Sundays were issued the SAME session key. The crypto is what makes "access ends when the ' +
    'turn does" true rather than asserted, and one key across sessions removes it.');
});

test('A LAPSED OR NOT-YET-OPEN CLEARANCE PUTS NOBODY ON AN ENVELOPE — asserted as the refusal', async () => {
  const h = harness();
  const out = await h.issueCheckinSessionKeys({ at: AT,
    services: [svc('svc-a', SERVICE), svc('svc-b', SERVICE_2)],
    permissions: [
      perm(ADA),                                                          // cleared open-endedly
      perm(BEN, { lifetime: 'dated', from: AT - 86400, until: 1789400000 }),  // lapses between the two Sundays
      perm(DAN, { lifetime: 'dated', from: 1789500000, until: 1790500000 }),  // not cleared until after the first
    ],
    stewards: [SGLEAD] });
  assert.equal(out.issued.length, 2, 're-anchor: not both Sundays were issued, so the comparison proves nothing');
  const bySession = new Map(h.published.map(ev => [readHelperGrant(ev.content).session, readHelperGrant(ev.content)]));
  assert.deepEqual(bySession.get('svc-a').pubs.sort(), [ADA, BEN].sort(),
    'the first Sunday\'s envelope is not exactly the people cleared at the moment it opens');
  assert.deepEqual(bySession.get('svc-b').pubs.sort(), [ADA, DAN].sort(),
    'the second Sunday\'s envelope is not exactly the people cleared at the moment IT opens — a clearance that ' +
    'lapsed in between was still wrapped a key, or one that had not started yet was not');
  assert.ok(!bySession.get('svc-b').pubs.includes(BEN),
    'a clearance that lapsed before the service still put its holder on that service\'s envelope. Expiry that ' +
    'only applies to the first document it is checked against is not expiry.');
  assert.ok(!bySession.get('svc-a').pubs.includes(DAN),
    'somebody not yet cleared was wrapped a key for a session that opens before their clearance does');
  const raw = JSON.parse(h.published.find(ev => readHelperGrant(ev.content).session === 'svc-b').content);
  assert.equal(raw.keys[BEN], undefined, 'and the key itself was wrapped to them anyway');
});

test('A CLEARANCE THE PARSER CANNOT VOUCH FOR IS DROPPED, never read as an unbounded one', async () => {
  const h = harness();
  const out = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [
      { _invalid: true },                                    // what subscribeCheckinPermissions delivers for a doc it cannot read
      { person: BEN },                                       // no window at all
      { person: DAN, from: 1, until: null, lifetime: 'open' },   // no declared source
      perm(ADA),
    ], stewards: [SGLEAD] });
  assert.equal(out.issued.length, 1);
  const g = readHelperGrant(h.published[0].content);
  assert.deepEqual(g.pubs, [ADA],
    'a permission this console could not vouch for was treated as a clearance. The direction that matters: an ' +
    'unreadable clearance must clear NOBODY, and it must never become an unbounded one.');
});

test('RE-ISSUING KEEPS THE SESSION\'S OWN KEY — or every record already sealed under it is orphaned', async () => {
  // THE TRAP IN AUTOMATIC ISSUANCE, and it is a data-loss shape rather than a security one. The envelope is
  // re-published whenever the cleared set changes; if that minted a FRESH key, every check-in already written
  // for that session would become unreadable to the helper who wrote it AND to the safeguarding lead. Same rule
  // as the media key-ring's "rotation must never drop a key that has already sealed something".
  const h = harness();
  const first = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [perm(ADA)], stewards: [SGLEAD] });
  assert.equal(first.issued.length, 1);
  const key1 = first.issued[0].key;
  assert.equal(first.issued[0].reused, false, 're-anchor: the first issue claims to have reused a key that did not exist');
  const held = { session: 'svc-a', ...JSON.parse(h.published[0].content) };
  h.published.length = 0;

  // now BEN is cleared too, so the set changed and the envelope must be re-issued
  const second = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [perm(ADA), perm(BEN)], stewards: [SGLEAD], existing: [held] });
  assert.equal(second.issued.length, 1, 'the issuer did not re-issue after the cleared set changed');
  assert.equal(second.issued[0].key, key1,
    'a re-issue minted a NEW session key. Every check-in already written for that session is now unopenable by ' +
    'the helper who wrote it and by the safeguarding lead — the register looks staffed and is unreadable.');
  assert.equal(second.issued[0].reused, true, 'the issuer does not report that it reused the session\'s key');
  const g = readHelperGrant(h.published[0].content);
  assert.deepEqual(g.pubs.sort(), [ADA, BEN].sort(), 'the newly cleared person is not on the re-issued envelope');
  assert.equal(JSON.parse(h.published[0].content).keys[ADA], JSON.parse(JSON.stringify(held.keys))[ADA],
    'the existing helper\'s slot changed on a re-issue, so the key they already hold no longer matches the ' +
    'envelope and everything sealed under the old one is orphaned');
});

test('A WITHDRAWN CLEARANCE DROPS OFF THE NEXT ENVELOPE, and the key is still preserved', async () => {
  const h = harness();
  await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [perm(ADA), perm(BEN)], stewards: [SGLEAD] });
  const held = { session: 'svc-a', ...JSON.parse(h.published[0].content) };
  const key1 = JSON.parse(h.published[0].content).keys[ADA];
  h.published.length = 0;
  // BEN's clearance is gone from the list — the shape subscribeCheckinPermissions delivers after a tombstone
  const out = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [perm(ADA)], stewards: [SGLEAD], existing: [held] });
  assert.equal(out.issued.length, 1, 'withdrawing a clearance did not re-issue the envelope');
  const raw = JSON.parse(h.published[0].content);
  assert.deepEqual(raw.pubs, [ADA], 'the withdrawn person is still in the enforced helper list');
  assert.equal(raw.keys[BEN], undefined, 'the withdrawn person is still wrapped this session\'s key');
  assert.equal(raw.keys[ADA], key1, 'the remaining helper\'s key changed, so what they already wrote is orphaned');
});

test('NOTHING IS RE-PUBLISHED WHEN NOTHING CHANGED — the issuer is idempotent', async () => {
  // It runs whenever a console opens. A re-publish that changed nothing would still mint a new event, and — if
  // the key were not preserved — would rotate a live session's key for no reason. Skipping is the correct
  // behaviour and the test that proves it is the one that would catch a loop.
  const h = harness();
  await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [perm(ADA)], stewards: [SGLEAD] });
  const held = { session: 'svc-a', ...JSON.parse(h.published[0].content) };
  h.published.length = 0;
  const again = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [perm(ADA)], stewards: [SGLEAD], existing: [held] });
  assert.deepEqual(again.issued, [], 'the issuer re-published an envelope that had not changed');
  assert.deepEqual(again.skipped, [{ session: 'svc-a', why: 'unchanged' }]);
  assert.deepEqual(h.published, [], 'and it put the document on the wire');
  // A KEY THIS CONSOLE CANNOT RECOVER IS RE-MINTED RATHER THAN LEFT ALONE. Otherwise a session whose envelope
  // was written by another device would be stuck for ever with a key nobody here can wrap to a new helper.
  const opaque = { ...held, keys: { ...held.keys, [CHURCH]: 'sealed[ck:somebody-else]deadbeef' } };
  const forced = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [perm(ADA)], stewards: [SGLEAD], existing: [opaque] });
  assert.equal(forced.issued.length, 1,
    'an envelope whose key this console cannot unwrap was left alone. Nothing could ever add a helper to that ' +
    'session again, and the failure would look like an empty room.');
  assert.equal(forced.issued[0].reused, false);
});

test('THE ISSUER DOES NOT REACH PAST ITS HORIZON, and the horizon is CAPPED at the relay\'s own lead', async () => {
  // THE BLAST RADIUS. Issuing a year ahead would put a year of session keys within reach of one cleared phone —
  // the whole-year exposure the owner refused, arriving through the back door of an automatic issuer. The relay
  // independently refuses to SERVE an envelope more than KEY_LEAD_SECONDS before it opens
  // (checkin-helper-capability.test.mjs drives that), so this is the belt and that is the braces.
  const h = harness();
  const out = await h.issueCheckinSessionKeys({ at: AT,
    services: [svc('svc-a', SERVICE), svc('svc-far', SERVICE_FAR), svc('svc-old', SERVICE_PAST)],
    permissions: [perm(ADA)], stewards: [SGLEAD] });
  assert.equal(out.issued.length, 1, 'the issuer minted keys for something outside the horizon: ' + JSON.stringify(out));
  assert.equal(out.issued[0].session, 'svc-a');
  assert.deepEqual(out.skipped.map(x => x.session).sort(), ['svc-far', 'svc-old'].sort());
  assert.ok(out.skipped.some(x => x.session === 'svc-far' && /horizon/.test(x.why)),
    'a service three months out was not skipped for being beyond the horizon');
  assert.ok(out.skipped.some(x => x.session === 'svc-old' && /over/.test(x.why)),
    'the issuer minted a key for a session that has already finished — nobody can use it and it is one more ' +
    'envelope a compromised phone could ask for');

  // ASKING FOR MORE DOES NOT GET MORE. A caller passing ninety days is clamped to the relay's lead rather than
  // honoured, so the limit cannot be turned off from a screen.
  const h2 = harness();
  //
  // THE NUMBER MATTERS AND IT WAS WRONG ONCE. This asked for a NINETY-day horizon, and SERVICE_FAR is about
  // ninety-one days out — so deleting the clamp altogether still produced no envelope, and the assertion could
  // not fail. Measured by sabotage on 2026-09-09: with `Math.min(days * 86400, KEY_LEAD_SECONDS)` replaced by
  // `days * 86400`, all 23 tests in this file stayed green. A year is now asked for, which is comfortably past
  // any service in the fixture, so the clamp is the only thing that can be producing the refusal.
  const wide = await h2.issueCheckinSessionKeys({ at: AT, horizonDays: 365,
    services: [svc('svc-far', SERVICE_FAR)], permissions: [perm(ADA)], stewards: [SGLEAD] });
  assert.deepEqual(wide.issued, [],
    'a caller asking for a YEAR-long horizon got one. It must be clamped to KEY_LEAD_SECONDS, or a screen ' +
    'could hand a cleared phone the whole year\'s session keys — the exposure the owner refused.');
  assert.ok(wide.skipped.some(x => x.session === 'svc-far' && /horizon/.test(x.why)),
    'the far service was skipped for some reason other than the horizon, so the clamp is not what refused it');
  assert.ok(KEY_LEAD_SECONDS < 90 * 86400, 're-anchor: the relay\'s lead is now over ninety days, so this proves nothing');
  assert.deepEqual(h2.published, []);
});

test('ONLY THE OWNER ISSUES, and a service the console cannot place is reported rather than guessed', async () => {
  const noKey = harness(); noKey.stubs.sk = null;
  assert.equal(await noKey.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)], permissions: [perm(ADA)] }), null,
    'a console with no key issued session keys to the children\'s register');
  const delegated = harness(); delegated.stubs.actingChurch = CHURCH;
  assert.equal(await delegated.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)], permissions: [perm(ADA)] }), null,
    'a DELEGATED steward console issued session keys');
  for (const h of [noKey, delegated]) assert.deepEqual(h.published, [], 'and it reached the wire');

  const h = harness();
  const out = await h.issueCheckinSessionKeys({ at: AT,
    services: [{ id: 'svc-nodate' }, { date: '2026-09-13', time: '10:30' }],
    permissions: [perm(ADA)], stewards: [SGLEAD] });
  assert.deepEqual(out.issued, [], 'the issuer minted a key for a service it could not place, or for one with no id');
  assert.equal(out.failed.length, 2, 'a service the issuer could not use was silently dropped instead of reported: ' +
    JSON.stringify(out));
  assert.deepEqual(h.published, [], 'and a guessed window reached the wire');
});

test('NOBODY IS CLEARED, SO NOBODY IS WRAPPED A KEY — and the church still is', async () => {
  // The state of every church before a steward has cleared anyone, and the state of a church that has withdrawn
  // everybody. It must not be a failure, and it must not be a key for nobody either: the envelope still carries
  // the church and its safeguarding lead, because the register they already hold is not this slice's to narrow.
  const h = harness();
  const out = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [], stewards: [SGLEAD] });
  assert.equal(out.issued.length, 1, 'a church with nobody cleared could not issue at all');
  const raw = JSON.parse(h.published[0].content);
  assert.deepEqual(raw.pubs, [], 'somebody was admitted by an envelope for a church that has cleared nobody');
  assert.deepEqual(Object.keys(raw.keys).sort(), [CHURCH, SGLEAD].sort(),
    'the church and its safeguarding lead lost the session key when nobody was cleared — that is the register ' +
    'they already hold, and this slice narrows nothing');
});

// ── STANDING A SESSION DOWN, AND WHAT AUTOMATIC ISSUANCE DOES ABOUT IT ────────────────────────────────────
//
// Found 2026-09-10 by running these three functions in the order a church would: mint the Sunday, stand it
// down, then let the issuer run again over the same service list. Under the shipped code it RE-STAFFED the
// session and minted a FRESH key — the second half of the "restaffing a Sunday" claim revokeCheckinHelpers
// used to make about itself, and the first half of a data loss, because every record already sealed under the
// old key would have been orphaned. The whole chain is lifted out of vendor/steward.js; nothing between the
// stand-down and the issuer's answer is a copy this file wrote.

test('THE STAND-DOWN IS A ROW, NOT AN ABSENCE — or the issuer cannot see it at all', async () => {
  // The measurement that explains the defect rather than only its symptom. subscribeCheckinSessionKeys is the
  // issuer's entire input; it used to delegate to _subAddr, which FORGETS a tombstoned id (right for a
  // calendar, wrong for a decision). So "the church stood this session down" and "no envelope has ever been
  // published for this session" arrived identically, and the issuer cannot distinguish two things it must
  // treat oppositely.
  const h = harness();
  await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE), svc('svc-b', SERVICE_2)],
    permissions: CLEARED, stewards: [SGLEAD] });
  assert.equal(h.published.length, 2, 're-anchor: the issuer did not mint both Sundays');
  const envelopes = [...h.published];
  const stood = await h.revokeCheckinHelpers('svc-a');
  assert.notEqual(stood, null, 'the owner console refused to stand a session down at all');
  const tomb = h.published[h.published.length - 1];
  assert.ok(tomb.tags.some(t => t[0] === 'deleted'), 're-anchor: the stand-down published no tombstone');
  assert.equal((tomb.tags.find(t => t[0] === 'd') || [])[1], D.CHECKINHELPER + 'svc-a',
    're-anchor: the tombstone is not at the envelope\'s own d-tag, so nothing below is about that session');

  const rows = h.sessionKeysFrom([...envelopes, tomb]);
  const a = rows.find(r => r.session === 'svc-a');
  assert.ok(a, 'the session the church stood down disappeared from the console\'s own list, so the issuer ' +
    'cannot tell it from a Sunday nobody has staffed yet — which is precisely how it came to re-staff one');
  assert.equal(a.standDown, true, 'the stood-down session is reported as an ordinary envelope');
  assert.equal(a.keys, undefined, 'a stood-down session still carries wrapped key material in the console\'s list');
  // AND THE UNTOUCHED SUNDAY IS STILL A REAL ENVELOPE, or "standDown" would be what this list says about
  // everything and the assertion above would be about nothing.
  const b = rows.find(r => r.session === 'svc-b');
  assert.ok(b && !b.standDown, 're-anchor: every session reads as stood down, so the row above proves nothing');
  assert.deepEqual(b.pubs.slice().sort(), [ADA, DAN].sort(), 're-anchor: the untouched envelope lost its helpers');
  assert.ok(b.keys[CHURCH], 're-anchor: the untouched envelope carries no key for the church');
});

test('AND THE ISSUER LEAVES IT ALONE — it does not re-staff it, and it does not mint a new key over it', async () => {
  const h = harness();
  await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)], permissions: CLEARED, stewards: [SGLEAD] });
  const envelope = h.published[0];
  const firstKey = JSON.parse(h.published[0].content).keys[CHURCH];
  await h.revokeCheckinHelpers('svc-a');
  const tomb = h.published[h.published.length - 1];
  const rows = h.sessionKeysFrom([envelope, tomb]);
  const before = h.published.length;

  // THE SUNDAY IS STILL ON THE ROTA and the people are still cleared, which is the whole trap: nothing about
  // the service or the clearances says "do not staff this", only the church's own act does.
  const again = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: CLEARED, stewards: [SGLEAD], existing: rows });
  assert.deepEqual(again.issued, [],
    'automatic issuance re-staffed a session the church had deliberately stood down. A steward acted; ' +
    'machinery reversed it, with nobody watching and nothing on any screen to say so.');
  assert.equal(h.published.length, before,
    'the issuer published over a stood-down session — and with a FRESH session key, because the tombstone ' +
    'replaced the only envelope the old key was wrapped in. Every record already sealed under it would be ' +
    'unreadable: the "rotation must never drop a key that has already sealed something" rule this same file ' +
    'states for the media key-ring.');
  assert.deepEqual(again.skipped, [{ session: 'svc-a', why: 'stood down' }],
    'the session was skipped for some other reason, so this test would keep passing if the stand-down check ' +
    'were deleted: ' + JSON.stringify(again));
  assert.equal(firstKey, JSON.parse(envelope.content).keys[CHURCH], 're-anchor: the key read back is not the minted one');
});

// AND THE ONE I GOT WRONG, LEFT AS A NOTE RATHER THAN AS A TEST. A third guard was written here on
// 2026-09-10 — "never publish over an envelope whose session key this console cannot recover", on the
// grounds that doing so rotates the key and orphans that session's register. It is a real cost and the
// guard was still wrong: 'NOTHING IS RE-PUBLISHED WHEN NOTHING CHANGED' above already pins the opposite,
// with the reason, and it caught the guard immediately. A session nobody can re-key would be UNSTAFFABLE
// FOR EVER, and design §10 says a missing key must not block a session — the desk is the fallback, a
// permanent lock-out is not. The trade-off (a staffable session versus a readable history) is recorded for
// slice 2 in reference/SCOPE-CHECKIN-SURFACES-2026-09-09.md rather than decided here.
