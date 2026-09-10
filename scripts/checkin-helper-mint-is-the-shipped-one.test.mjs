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
// `delegated` runs this console AS one of the stewards in `stewardCaps`, the way setActiveIdentity leaves it:
// `actingChurch` and `pub` are the CHURCH, `churchPub` is this console's OWN key, and `churchSkHeld()` is
// false. That naming is historical and it is the trap in every test of delegated mode — see myStewardCaps.
function harness({ stewardCaps = { [SGLEAD]: ['safeguarding'], [TREASURER]: ['finance'] }, publishOk = true,
                   delegated = null } = {}) {
  let keyNonce = 0;
  const published = [];
  const warnings = [];
  const subs = [];
  // EVERY BANNER THIS CONSOLE RAISES, captured. `steward-write-blocked` is the one channel the console uses
  // to tell a steward that something did not happen, and the keeper warning added on 2026-09-10 goes down it
  // — so it has to be READ here, not stubbed away. `window: { dispatchEvent: () => true }` was silently
  // swallowing it, which is how a warning ships and warns nobody.
  const banners = [];
  const stubs = {
    sk: new Uint8Array(32).fill(9),
    pub: CHURCH,
    churchPub: delegated || CHURCH,
    churchSkHeld: () => !delegated,
    actingChurch: delegated ? CHURCH : null,
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
    window: { dispatchEvent: (e) => { banners.push((e && e.detail) || {}); return true; } },
    // A FRESH ONE PER HARNESS. `_ckRotateWarned` is module state in the console — "say it once per console
    // session" — so sharing one across tests would let the first test's warning silence the second's.
    _ckRotateWarned: new Set(),
    // ⚠ A SETTLED CONSOLE, STATED RATHER THAN INHERITED. `_ckKeysSettled` is the church whose
    // `checkinhelper:` corpus has been read to an AUTHENTICATED EOSE, and issueCheckinSessionKeys refuses
    // outright when it does not match — because issuing on an unfinished read mints a FRESH key over a live
    // one. Every test in THIS file hands the issuer an explicit `existing` list, i.e. models a console that
    // has finished reading, so that is what this stub says. The gate itself is driven from
    // scripts/checkin-session-keys-are-not-issued-early.test.mjs, which sets it through the shipped
    // subscription's own oneose instead of asserting it here.
    _ckKeysSettled: CHURCH,
    // AND AN AUTHENTICATED SOCKET, because the settle above happens only on an authenticated
    // end-of-stored-events — see the oneose in subscribeCheckinSessionKeys.
    _isRelayAuthed: () => true,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
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
  // AND THE HELPERS THAT CLOSE OVER MODULE STATE, OUT OF THE SAME BUNDLE rather than reimplemented here:
  // each is a decision one of these tests is NAMED after, so a test-local copy would be the test answering
  // its own question. They close over _capAllows, CAP_KEYS, _stewardCaps, sk and actingChurch, so unlike
  // CAP_KEYS and _capAllows above they need the harness scope.
  const liftScoped = (sig, name) => new Function('scope', `with (scope) { return (${stmt(VENDOR, sig, name).replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '')}); }`)(scope);
  // AND THE CONSOLE'S OWN GATE ON CLEARING SOMEBODY, out of the same bundle. It is what decides whether a
  // delegated safeguarding steward's console will even attempt the write the relay now admits, so a
  // test-local copy of it would prove nothing about the shipped console.
  const capsOfSrc = fnBody(VENDOR, 'function _capsOf(by) {', '_capsOf');
  stubs._capsOf = new Function('scope', `with (scope) { ${capsOfSrc} return _capsOf; }`)(scope);
  stubs._mayClearForCheckin = liftScoped('var _mayClearForCheckin = () =>', '_mayClearForCheckin');
  // _checkinKeepersMissing + _warnCheckinKeeperLeftOut WERE LIFTED HERE UNTIL 2026-09-10 and are GONE from
  // the bundle: under the owner's double-locking decision their message ("they hold Safeguarding, so they
  // should be able to read what a helper writes, and cannot") became a false claim, because a safeguarding
  // holder reads every record through the ring copy in `content` and loses nothing by being off an envelope.
  // The warning is re-aimed at the one thing a keeper slot really buys — the CHURCH'S own slot, which is what
  // lets the issuer reuse a session's key instead of rotating it. Three tests over the old warning were
  // removed with it and are named in the commit; the "said once" test below was re-aimed with it.
  stubs._warnCheckinKeyRotated = liftScoped('var _warnCheckinKeyRotated = (sessions) =>', '_warnCheckinKeyRotated');
  // AND THE OWNER TEST THE ISSUER NOW SHARES WITH THE SCREEN. One copy in the bundle, read by
  // issueCheckinSessionKeys and by Steward.checkinIssuerHeld(), so the console's copy of "can this console
  // mint?" cannot drift from the refusal itself. Lifted, because `noKey`/`delegated` below mutate `sk` and
  // `actingChurch` AFTER the lift and this must read them live.
  stubs._ckIssuerHeld = liftScoped('var _ckIssuerHeld = () =>', '_ckIssuerHeld');
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
  // AND THE CLEARANCE READ-BACK, which stopped being _subAddr on 2026-09-10 and became a bespoke
  // subscription with the relay's own authorship rule in it. That rule is the only thing between a co-tenant
  // church and this console's list of cleared adults, so it is lifted and driven rather than described.
  const readPerms = lift('subscribeCheckinPermissions(cb) {', 'subscribeCheckinPermissions');
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
  // Feed events to the SHIPPED clearance subscription in order, then EOSE, exactly as a relay would.
  const permsFrom = (events) => {
    let last = null;
    const stop = readPerms.call({}, (rows) => { last = rows; });
    const sub = subs[subs.length - 1];
    assert.ok(sub, 'the lifted clearance subscription never opened one — the pool stub was not reached');
    for (const e of events) sub.handlers.onevent(e);
    sub.handlers.oneose();
    stop();
    assert.ok(Array.isArray(last), 'the shipped subscription emitted nothing at all, not even an empty list');
    return last;
  };
  return { stubs, published, warnings, banners, subs, sessionKeysFrom, permsFrom,
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
  // herself. `keepers = [cp]` is the CORRECT grant for her, and a church that cannot mint a grant cannot
  // staff its creche.
  //
  // ONE SENTENCE THAT STOOD HERE UNTIL 2026-09-10 WAS WRONG, and is corrected rather than softened
  // (CLAUDE.md rule 4). It said: "from inside this function an omitted roster and an empty roster are
  // INDISTINGUISHABLE in their result, so refusing one would refuse her too… the guard belongs at the
  // screen." The first half is false and the conclusion it carried — that this function cannot tell — kept
  // the warning unwritten for a day. `CAP_KEYS.checkin.explicit === true`, so a keeper must hold an explicit
  // 'safeguarding' tick, so every eligible pubkey is a KEY OF THE CAPS MAP — which the line above already
  // reads. The two cases are therefore distinguishable, and the three tests below drive the difference.
  //
  // What survives is the DECISION: it warns, it does not refuse. See _checkinKeepersMissing.
  const h = harness();
  await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, permissions: [perm(ADA)] });   // no `stewards`
  const { raw } = grantOf(h);
  assert.deepEqual(Object.keys(raw.keys).sort(), [ADA, CHURCH].sort(),
    'a mint called without the steward roster produced keepers other than [church]. If that is now a ' +
    'refusal or a default, this test is the record that it used to be silent — update it deliberately.');
  assert.equal(raw.keys[SGLEAD], undefined,
    're-anchor: the lead got a key with no roster passed, so this test no longer describes the shipped path');
});

// ── THE WARNING THIS SECTION HELD IS GONE, AND ONE OF ITS FOUR TESTS IS RE-AIMED WITH IT ──────────────────
//
// UNTIL 2026-09-10 four tests here pinned `_warnCheckinKeeperLeftOut`: "the safeguarding lead was left off
// the envelope, and it says so". reference/SCOPE-CHECKIN-SEALING-2026-09-10.md establishes that its message
// was FALSE, and false in the worst direction — the owner's decision double-locks every record, one copy
// under the safeguarding ring in `content` and one under the session key, so a safeguarding holder reads
// every record through the ring copy whatever any envelope says. Omitted from an envelope she loses a
// DUPLICATE of a body she can already read. The banner told her she had lost access she still had, and told
// her to fix it by re-issuing, which rotates keys.
//
// THREE OF THE FOUR WERE DELETED with the code they pinned, and they are named here rather than vanishing
// (CLAUDE.md rule 8):
//
//   1. 'A LEAD LEFT OFF THE ENVELOPE IS NAMED IN A WARNING — not left to find out on Sunday'
//      — pinned the false claim itself. What it also asserted (the lead is absent from an envelope minted
//        with no `stewards` argument) is still asserted, by the test immediately above this block.
//   2. '…AND A CHURCH WITH NO SAFEGUARDING STEWARD IS NOT WARNED AT ALL'
//   3. '…AND THE FINANCE-ONLY STEWARD BEING ABSENT IS NOT A WARNING'
//      — both asserted the ABSENCE of a banner that can no longer be raised by anything, so both passed
//        vacuously the moment the code went. A test that cannot fail is worse than no test.
//
// THE FOURTH IS RE-AIMED, not deleted, because its subject — "say it once for the whole horizon pass, not
// once per Sunday" — is a property of the replacement warning too, and the replacement is raised from the
// ISSUER's loop, which is exactly where a per-Sunday repeat comes from.

test('THE ONE THING A KEEPER SLOT REALLY BUYS: a key this console cannot recover is REPLACED, and said once', async () => {
  // WHAT THE RE-AIMED WARNING IS ABOUT. The church wraps a slot to ITSELF on every envelope so the issuer can
  // unwrap the key a session already has and re-issue to a changed set of people WITHOUT rotating it. When
  // that recovery fails — an envelope written by another device, a key restored from a backup, a corrupt slot
  // — the issuer re-mints on purpose rather than leaving the session unstaffable for ever, and the cost is a
  // NEW key for that session. That is the consequential, reachable event a steward can neither see nor undo.
  //
  // TWO SESSIONS, ONE PASS, ONE BANNER. The issuer mints every service inside a fortnight in one loop, so a
  // church whose whole corpus is unrecoverable is the case that would otherwise say this three times.
  const h = harness();
  // AN ENVELOPE THIS CONSOLE CANNOT OPEN. The harness's nip44d throws unless the ciphertext carries the
  // recipient's own prefix, so a church slot sealed to somebody else is exactly the unrecoverable case —
  // built the same way the shipped wrapper builds a real one, so it is not a shape only a test can produce.
  const unopenable = (session) => ({ session, source: GRANT_SOURCE, lifetime: 'session', from: AT - 60,
    until: AT + 7200, pubs: [ADA], keys: { [CHURCH]: 'sealed[ck:' + ADA + ']' + 'a'.repeat(64), [ADA]: 'sealed[ck:' + ADA + ']' + 'a'.repeat(64) } });
  const out = await h.issueCheckinSessionKeys({ at: AT, permissions: CLEARED, stewards: [SGLEAD],
    services: [svc('svc-a', SERVICE), svc('svc-b', SERVICE_2)],
    existing: [unopenable('svc-a'), unopenable('svc-b')] });
  assert.equal(out.issued.length, 2, 'fixture: the issuer was supposed to re-mint both unrecoverable envelopes');
  assert.deepEqual(out.rotated.sort(), ['svc-a', 'svc-b'],
    'THE ISSUER REPLACED TWO LIVE SESSION KEYS AND DID NOT REPORT IT. `rotated` is the only thing the screen ' +
    'has to go on, and a rotation is the one consequential act in this function that a steward cannot see: ' +
    'out was ' + JSON.stringify(out));
  assert.equal(h.banners.length, 1,
    'the replacement was reported ' + h.banners.length + ' times for one pass. A banner that repeats per ' +
    'Sunday is one a steward learns to dismiss without reading, which is how the next real one gets missed: ' +
    JSON.stringify(h.banners));
  assert.equal(h.banners[0].what, 'check-in session key', 're-anchor: the warning went down a different channel');
  assert.match(h.banners[0].message, /NEW register key/,
    'the warning does not say a key was REPLACED, which is the whole of what happened: ' + h.banners[0].message);
  // ⚠ AND IT MUST NOT OVERCLAIM. Nothing seals anything under a session key yet — piece 1 of the scope note
  // (the `ck` tag) is not built — so a rotation today loses no readable data, and copy saying otherwise is
  // rule 4's territory. When piece 1 lands this assertion must be INVERTED and the message must gain that
  // sentence; it is here so that lands as a deliberate edit rather than a silent one.
  assert.doesNotMatch(h.banners[0].message, /lost|cannot be opened|unreadable|orphan/i,
    'the rotation warning claims records were lost. Nothing is sealed under a session key yet, so today that ' +
    'is a false claim in shipped UI copy — see _warnCheckinKeyRotated');

  // A SECOND PASS OVER THE SAME SUNDAYS SAYS NOTHING NEW. Keyed on the sessions, so this is not "once ever".
  await h.issueCheckinSessionKeys({ at: AT, permissions: CLEARED, stewards: [SGLEAD],
    services: [svc('svc-a', SERVICE)], existing: [unopenable('svc-a')] });
  assert.equal(h.banners.length, 1, 'the same session\'s replacement was reported twice');
  // …BUT A DIFFERENT SUNDAY STILL GETS SAID.
  const third = await h.issueCheckinSessionKeys({ at: AT, permissions: CLEARED, stewards: [SGLEAD],
    services: [svc('svc-c', SERVICE_2)], existing: [unopenable('svc-c')] });
  assert.deepEqual(third.rotated, ['svc-c'], 'fixture: the third pass was supposed to rotate svc-c');
  assert.equal(h.banners.length, 2,
    'a DIFFERENT session\'s key was replaced and nothing was said — the dedupe is per console rather than ' +
    'per session, so only the first loss in a console\'s life is ever reported');
});

test('AND A FIRST ISSUE IS NOT A ROTATION — or the warning above fires on every new church', async () => {
  // The negative that stops the assertion above passing on any mint at all. A church with no envelopes yet
  // has nothing to recover and nothing to lose, and a banner here would greet every new church with a
  // warning about data it has never had.
  const h = harness();
  const out = await h.issueCheckinSessionKeys({ at: AT, permissions: CLEARED, stewards: [SGLEAD],
    services: [svc('svc-a', SERVICE)] });
  assert.equal(out.issued.length, 1, 'fixture: the first issue was supposed to mint one envelope');
  assert.deepEqual(out.rotated, [], 'a FIRST issue was reported as a rotation');
  assert.deepEqual(h.banners, [],
    'a church issuing its first ever session key was warned that a key had been replaced');
  // …and neither is a re-issue whose key IS recoverable, which is the ordinary weekly path.
  const held = { session: 'svc-a', ...JSON.parse(h.published[0].content) };
  const again = await h.issueCheckinSessionKeys({ at: AT, permissions: [...CLEARED, perm(BEN)],
    stewards: [SGLEAD], services: [svc('svc-a', SERVICE)], existing: [held] });
  assert.equal(again.issued.length, 1, 'fixture: adding a cleared person was supposed to re-issue');
  assert.equal(again.issued[0].reused, true, 'fixture: that re-issue was supposed to reuse the key');
  assert.deepEqual(again.rotated, [], 'a re-issue that REUSED the session key was reported as a rotation');
  assert.deepEqual(h.banners, [], 'the ordinary weekly re-issue raised the key-replaced warning');
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

// REWRITTEN 2026-09-10, AND THE OLD VERSION IS NAMED RATHER THAN QUIETLY REPLACED (CLAUDE.md rules 4 and 8).
//
// It was called "ONLY THE OWNER CLEARS ANYBODY — and a delegated steward console does not even try", and its
// third case asserted that a delegated steward's console publishes nothing, with the message: *"Widening this
// is a separate, already-scoped decision; it must not arrive as a side effect."*
//
// THAT DECISION HAS NOW BEEN TAKEN, on purpose, by the owner, in its own commit and wanting its own audit —
// so the assertion is inverted deliberately and the delegated case moves to the block above, where it is
// driven for a safeguarding steward, a finance-only steward and an unscoped one separately. It did NOT
// "arrive as a side effect", which is what that sentence was guarding against, and this note is the record.
//
// WHAT SURVIVES UNCHANGED are the two refusals that have nothing to do with capabilities: a console holding
// no key at all, and one that neither holds the church key nor is acting for a church (its own empty shell,
// or a network key). Those are the cases where there is nothing to sign as.
test('A CONSOLE WITH NO AUTHORITY TO ACT FOR A CHURCH CLEARS NOBODY', async () => {
  const noKey = harness(); noKey.stubs.sk = null;
  assert.equal(await noKey.grantCheckinPermission({ person: ADA, lifetime: 'open', from: AT }), null,
    'a console with no key cleared somebody for the children\'s register');
  // Not the church, and not acting for one: this is the empty church "Help run a church" makes, or a network
  // key stepped sideways into. There is no church here to clear anybody FOR.
  const orphan = harness(); orphan.stubs.churchSkHeld = () => false; orphan.stubs.actingChurch = null;
  assert.equal(await orphan.grantCheckinPermission({ person: ADA, lifetime: 'open', from: AT }), null,
    'a console that is neither the church nor acting for one cleared somebody');
  for (const h of [noKey, orphan]) {
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

// ── AND WHOSE CLEARANCES THIS CONSOLE WILL BELIEVE ────────────────────────────────────────────────────────
// subscribeCheckinPermissions stopped using _subAddr on 2026-09-10, when the mint widened and this document
// gained a second possible author. Its own comment says why; these tests are the refusals that matter, and
// they are the SAME CLASS as the co-tenant stand-down below — a document another congregation on the same
// box can store, tagged to us, which this console asks the relay for by `{'#church':[pub]}`.
//
// A clearance believed from the wrong author is not cosmetic: the screen tells a steward that somebody is
// cleared for children's work, and a church renewing its list in January renews from that screen.
const permDoc = (by, person, at = 1789000000) => ({
  pubkey: by, created_at: at,
  tags: [['d', D.CHECKINPERM + person], ['t', 'trinityone'], ['church', CHURCH], ['person', person]],
  content: JSON.stringify(buildCheckinPermission({ person, source: 'steward', lifetime: 'open', from: 1000, until: null })),
});
const permTomb = (by, person, at = 1789100000) => ({
  pubkey: by, created_at: at, content: '',
  tags: [['d', D.CHECKINPERM + person], ['t', 'trinityone'], ['church', CHURCH], ['deleted', '1']],
});

test('THE CHURCH\'S OWN CLEARANCE IS BELIEVED, and read through the relay\'s own parser', async () => {
  const h = harness();
  const rows = h.permsFrom([permDoc(CHURCH, ADA)]);
  assert.equal(rows.length, 1, 'the console shows none of the church\'s own clearances: ' + JSON.stringify(rows));
  assert.equal(rows[0].person, ADA);
  assert.equal(rows[0].lifetime, 'open', 'the row does not carry what the relay would enforce');
  assert.equal(rows[0].id, ADA, 're-anchor: the row id is not the person, so a screen keying on it breaks');
});

test('A SAFEGUARDING STEWARD\'S CLEARANCE IS BELIEVED — or the widening shows on nobody\'s screen', async () => {
  const h = harness();
  const rows = h.permsFrom([permDoc(SGLEAD, ADA)]);
  assert.equal(rows.length, 1,
    'a clearance the safeguarding steward published — which the relay now stores and enforces — is invisible ' +
    'on the console. The lead clears somebody and the screen says nobody is cleared.');
});

test('A CO-TENANT CHURCH\'S CLEARANCE, TAGGED TO US, IS NOT BELIEVED', async () => {
  const h = harness();
  const rows = h.permsFrom([permDoc(COTENANT, ADA)]);
  assert.deepEqual(rows, [],
    'ANOTHER CONGREGATION ON THIS BOX PUT A NAME ON OUR CLEARED LIST. The relay files their document under ' +
    'THEIR church, so it clears nobody here — but this console asks for everything tagged to us, and would ' +
    'have shown a steward a cleared adult the relay refuses.');
});

test('…AND NEITHER IS AN ORDINARY MEMBER\'S, NOR A FINANCE-ONLY STEWARD\'S', async () => {
  const h = harness();
  assert.deepEqual(h.permsFrom([permDoc(MEMBER, ADA)]), [], 'a member\'s own clearance was displayed');
  assert.deepEqual(h.permsFrom([permDoc(TREASURER, ADA)]), [],
    'a steward ticked for FINANCE ONLY was believed about who may open the children\'s register');
});

test('A WITHDRAWAL IS BELIEVED FROM EITHER AUTHOR, and does not depend on arrival order', async () => {
  // The console half of the order-independence the relay needed in the same change. With two authors the
  // grant and the tombstone are two documents that coexist for ever, and a reader that dropped the row on a
  // tombstone would put it back the moment the older grant was re-delivered — which every reconnect does.
  const h = harness();
  const grantThenTomb = h.permsFrom([permDoc(CHURCH, ADA, 1789000000), permTomb(SGLEAD, ADA, 1789100000)]);
  assert.deepEqual(grantThenTomb, [],
    'the steward\'s withdrawal left the person on the console\'s cleared list');
  const tombThenGrant = h.permsFrom([permTomb(SGLEAD, ADA, 1789100000), permDoc(CHURCH, ADA, 1789000000)]);
  assert.deepEqual(tombThenGrant, [],
    'A WITHDRAWN CLEARANCE CAME BACK because the older grant arrived after the tombstone. Every reconnect ' +
    're-delivers the corpus in whatever order the relay sends it.');
  // AND A LATER GRANT STILL CLEARS THEM — the positive control, so a reader that simply never re-admits
  // anybody could not pass the two above.
  const regranted = h.permsFrom([permTomb(SGLEAD, ADA, 1789100000), permDoc(CHURCH, ADA, 1789200000)]);
  assert.equal(regranted.length, 1, 'somebody once withdrawn can never be shown as cleared again');
});

test('A CO-TENANT\'S TOMBSTONE DOES NOT REMOVE SOMEBODY FROM OUR CLEARED LIST', async () => {
  const h = harness();
  const rows = h.permsFrom([permDoc(CHURCH, ADA), permTomb(COTENANT, ADA)]);
  assert.equal(rows.length, 1,
    'another congregation took a name OFF our cleared list. Harmless-looking, and it is the same hole in the ' +
    'other direction: the screen stops showing a clearance the relay is still enforcing, so a steward ' +
    'clears somebody twice or believes their withdrawal worked when it did nothing.');
});

test('a clearance the relay\'s parser refuses arrives marked, not as a clearance', async () => {
  const h = harness();
  const bad = { pubkey: CHURCH, created_at: 1789000000,
    tags: [['d', D.CHECKINPERM + ADA], ['t', 'trinityone'], ['church', CHURCH]],
    content: JSON.stringify({ person: ADA, source: 'rota', lifetime: 'dated', from: 1000, until: null }) };
  const rows = h.permsFrom([bad]);
  assert.equal(rows.length, 1, 're-anchor: an unparseable clearance is now dropped entirely rather than marked');
  assert.equal(rows[0]._invalid, true,
    'a document readCheckinPermission REFUSES was handed to the screen as an ordinary clearance. A `dated` ' +
    'permission with no end is exactly the shape that must never read as unbounded.');
});

// ── WHO THIS CONSOLE WILL LET CLEAR SOMEBODY ──────────────────────────────────────────────────────────────
// The console half of the mint widening (2026-09-10). The RELAY is the protection — every refusal is
// asserted against a live gateway in scripts/checkin-permission-mint-widening.test.mjs — and this is the
// console agreeing with it, which matters in the CLOSED direction: a guard that is stricter than the relay
// leaves a safeguarding lead silently unable to do the job the change was made for.
//
// These drive the SHIPPED grantCheckinPermission and revokeCheckinPermission out of vendor/steward.js, with
// _mayClearForCheckin and _capsOf lifted from the same bundle, so nothing between the decision and the
// document is a copy.

test('THE OWNER CONSOLE STILL CLEARS PEOPLE', async () => {
  const h = harness();
  const out = await h.grantCheckinPermission({ person: ADA, source: 'steward', lifetime: 'open', from: 1000 });
  assert.ok(out, 'the church key can no longer clear anybody');
  assert.equal(out.person, ADA);
});

test('A DELEGATED SAFEGUARDING STEWARD\'S CONSOLE CLEARS PEOPLE — the point of the widening', async () => {
  const h = harness({ delegated: SGLEAD });
  const out = await h.grantCheckinPermission({ person: ADA, source: 'steward', lifetime: 'open', from: 1000 });
  assert.ok(out,
    'THE SAFEGUARDING LEAD\'S CONSOLE REFUSED TO EVEN TRY. The relay admits this write now, so a console ' +
    'that still refuses it is the whole change delivering nothing — and it fails silently, because ' +
    'grantCheckinPermission returns null for every kind of refusal.');
  const ev = h.published[h.published.length - 1];
  assert.deepEqual((ev.tags.find(t => t[0] === 'church') || []), ['church', CHURCH],
    'the steward\'s clearance does not name the church, so the relay cannot resolve the grantor and refuses it');
  assert.equal((ev.tags.find(t => t[0] === 'd') || [])[1], D.CHECKINPERM + ADA, 're-anchor: the d-tag moved');
});

test('…AND MAY WITHDRAW ONE', async () => {
  const h = harness({ delegated: SGLEAD });
  const out = await h.revokeCheckinPermission(ADA);
  assert.ok(out !== null, 'the steward who may clear somebody cannot un-clear them');
  const ev = h.published[h.published.length - 1];
  assert.ok(ev.tags.some(t => t[0] === 'deleted'), 're-anchor: the withdrawal is not a tombstone');
});

test('A FINANCE-ONLY STEWARD\'S CONSOLE WILL NOT TRY', async () => {
  const h = harness({ delegated: TREASURER });
  assert.equal(await h.grantCheckinPermission({ person: ADA, source: 'steward', lifetime: 'open', from: 1000 }), null,
    'a treasurer\'s console attempted to clear somebody for the children\'s register');
  assert.equal(await h.revokeCheckinPermission(ADA), null, 'and to withdraw a clearance');
  assert.deepEqual(h.published, [], 'and it published something');
});

test('AN UNSCOPED STEWARD\'S CONSOLE WILL NOT EITHER — this capability is not part of "everything"', async () => {
  // The relay refuses this too (stewardCanExplicitly), and the Check-in tab is already closed to an unscoped
  // steward by stewCapState. Asserted here so the three layers cannot drift apart.
  const h = harness({ stewardCaps: {}, delegated: 'a1'.repeat(32) });
  assert.equal(await h.grantCheckinPermission({ person: ADA, source: 'steward', lifetime: 'open', from: 1000 }), null,
    'a steward with NO capability list cleared somebody. Every church that appointed stewards before ' +
    'capabilities existed has one, and none of them was asked about the children\'s register.');
  assert.deepEqual(h.published, []);
});

test('AND THE SESSION KEYS ARE STILL OWNER-ONLY ON THIS CONSOLE', async () => {
  // The widening stopped at the permission. A steward's console cannot mint an envelope, because the session
  // key is wrapped with the CHURCH key — so an envelope it produced would be one the readers cannot open.
  const h = harness({ delegated: SGLEAD });
  assert.equal(await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, permissions: CLEARED, stewards: [SGLEAD] }), null,
    'a delegated steward\'s console minted a session key envelope');
  assert.equal(await h.issueCheckinSessionKeys({ at: AT, services: [svc('s1', SERVICE)], permissions: CLEARED }), null,
    'a delegated steward\'s console ran the issuer');
  assert.deepEqual(h.published, []);
});

// ── THE GUARD NOTHING PROVED: A CO-TENANT CHURCH CANNOT UNSTAFF OUR CRECHE ────────────────────────────────
// Item 3 of reference/SCOPE-CHECKIN-SURFACES-2026-09-09.md:
//
//     "src/steward.src.js `if (e.pubkey !== pub) return;` refuses a stand-down tombstone from anyone but the
//      church key. It is CORRECT (an auditor lifted it and fed it eight attacks, all refused) but deleting
//      the line leaves the suite 25/25 green, because the harness stamps the church pubkey on every fixture.
//      Write the test."
//
// WHY THE CASE IS REAL and not a hypothetical about a modified console. This relay is multi-tenant: one box
// can hold several congregations. accept()'s CHECKINHELPER_D rule asks only `CHURCH_PUBS.has(e.pubkey)` and
// then that the d-tag's session id is well formed — it does NOT require the author to be the church the
// ['church'] tag names, because note() keys the grant by the AUTHOR, so a co-tenant's document cannot touch
// OUR map at the relay. Nothing there is broken.
//
// The CONSOLE is where it lands. subscribeCheckinSessionKeys subscribes with two filters, and the second is
// `{ kinds:[30078], '#church':[pub] }` — "anything tagged to us, whoever wrote it". So a co-tenant church key
// on the same box can store `checkinhelper:<our session>` carrying `['church', <us>]` and `['deleted','1']`,
// and our console will be SERVED it (the church reads everything tagged to itself).
//
// WHAT IT WOULD COST: the console believes that Sunday was stood down, issueCheckinSessionKeys skips it
// ("a steward's decision outranks the schedule"), and the creche is unstaffed with a correct-looking reason
// on a screen nobody reads. One other congregation, one document, and a children's session quietly has no key.
//
// THESE EVENTS ARE HAND-BUILT AND THAT IS THE POINT: the harness's finalizeEvent stamps `pubkey: CHURCH` on
// everything it signs, which is exactly why no existing fixture could reach this line. The document under
// test is the one a co-tenant would write, so it has to be written here.
const COTENANT = '9'.repeat(64);        // another church configured on the same box
const MEMBER = '8'.repeat(64);          // an ordinary member of ours
const foreignTomb = (by, session, at = 1789300000) => ({
  pubkey: by, created_at: at, content: '',
  tags: [['d', D.CHECKINHELPER + session], ['t', 'trinityone'], ['church', CHURCH], ['deleted', '1']],
});

test('A CO-TENANT CHURCH\'S TOMBSTONE DOES NOT STAND OUR SESSION DOWN', async () => {
  const h = harness();
  await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)], permissions: CLEARED, stewards: [SGLEAD] });
  const envelope = h.published[0];
  assert.equal(envelope.pubkey, CHURCH, 're-anchor: the envelope under test is not ours');

  const rows = h.sessionKeysFrom([envelope, foreignTomb(COTENANT, 'svc-a')]);
  const a = rows.find(r => r.session === 'svc-a');
  assert.ok(a, 'our own envelope vanished from the console\'s list when a foreign tombstone arrived');
  assert.notEqual(a.standDown, true,
    'ANOTHER CONGREGATION ON THIS BOX STOOD OUR CRECHE DOWN. accept() only asks that the author be SOME ' +
    'configured church, and this console asks the relay for everything tagged to us — so `e.pubkey !== pub` ' +
    'is the only thing between a co-tenant and an unstaffed children\'s session.');
  assert.ok(a.keys && a.keys[CHURCH],
    'the row survived as a shell with no key material, which the issuer would treat as an envelope it cannot ' +
    'recover and re-mint over — orphaning every record already sealed under the real key');
});

test('…AND THE ISSUER GOES ON STAFFING IT — the refusal is measured where it matters', async () => {
  // The row above is the console's list; THIS is the consequence. Without the guard the issuer sees
  // `standDown: true` and skips, which is the defect in its finished form.
  const h = harness();
  await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)], permissions: CLEARED, stewards: [SGLEAD] });
  const envelope = h.published[0];
  const rows = h.sessionKeysFrom([envelope, foreignTomb(COTENANT, 'svc-a')]);
  // Somebody new is cleared, so there is real work for the issuer to do and "skipped: unchanged" cannot be
  // mistaken for "skipped: stood down".
  const again = await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)],
    permissions: [...CLEARED, perm(BEN)], stewards: [SGLEAD], existing: rows });
  assert.deepEqual(again.skipped, [],
    'the issuer skipped a session on the strength of a foreign tombstone: ' + JSON.stringify(again.skipped));
  assert.equal(again.issued.length, 1, 'the session was not re-staffed at all: ' + JSON.stringify(again));
  assert.ok(again.issued[0].pubs.includes(BEN), 'the newly cleared helper was not added');
  assert.equal(again.issued[0].reused, true,
    're-anchor: the re-issue minted a fresh key, so this test is no longer about the stand-down path');
});

test('…AND NEITHER DOES AN ORDINARY MEMBER\'S', async () => {
  // A member cannot get one past accept() today (the write rule is owner-only), so this is belt over the
  // braces — and belt is what the relay's own comment asks for, because a document already on disk replays
  // through note() on every boot with accept() nowhere in the path. The console must not believe it either.
  const h = harness();
  await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)], permissions: CLEARED, stewards: [SGLEAD] });
  const rows = h.sessionKeysFrom([h.published[0], foreignTomb(MEMBER, 'svc-a')]);
  assert.notEqual((rows.find(r => r.session === 'svc-a') || {}).standDown, true,
    'one member of this congregation published a ["church"]-tagged tombstone and unstaffed a children\'s session');
});

test('…AND OUR OWN STAND-DOWN STILL WORKS, or the three tests above prove nothing', async () => {
  // The positive control. A guard that refused EVERY tombstone would pass all three refusals above and break
  // the feature, which is the shape a mis-aimed fix takes.
  const h = harness();
  await h.issueCheckinSessionKeys({ at: AT, services: [svc('svc-a', SERVICE)], permissions: CLEARED, stewards: [SGLEAD] });
  const envelope = h.published[0];
  await h.revokeCheckinHelpers('svc-a');
  const ours = h.published[h.published.length - 1];
  assert.equal(ours.pubkey, CHURCH, 're-anchor: our own tombstone is not authored by the church key');
  const rows = h.sessionKeysFrom([envelope, ours]);
  assert.equal((rows.find(r => r.session === 'svc-a') || {}).standDown, true,
    'the church\'s OWN stand-down was refused, so the guard is now refusing everything and the refusals ' +
    'above are vacuous');
});

// AND THE ONE I GOT WRONG, LEFT AS A NOTE RATHER THAN AS A TEST. A third guard was written here on
// 2026-09-10 — "never publish over an envelope whose session key this console cannot recover", on the
// grounds that doing so rotates the key and orphans that session's register. It is a real cost and the
// guard was still wrong: 'NOTHING IS RE-PUBLISHED WHEN NOTHING CHANGED' above already pins the opposite,
// with the reason, and it caught the guard immediately. A session nobody can re-key would be UNSTAFFABLE
// FOR EVER, and design §10 says a missing key must not block a session — the desk is the fallback, a
// permanent lock-out is not. The trade-off (a staffable session versus a readable history) is recorded for
// slice 2 in reference/SCOPE-CHECKIN-SURFACES-2026-09-09.md rather than decided here.
