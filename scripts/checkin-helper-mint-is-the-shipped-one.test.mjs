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
import { readHelperGrant, HELPER_LIFETIMES, DEFAULT_HELPER_LIFETIME,
         buildHelperGrant, helperPolicy, lifetimeWindow, eligibleHelpers } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const CHURCH = 'c'.repeat(64);
const SGLEAD = 'a'.repeat(64);
const TREASURER = 'b'.repeat(64);
const ADA = 'd'.repeat(64);
const DAN = 'e'.repeat(64);

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
  const published = [];
  const warnings = [];
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
    // THE REAL DECISION-MAKERS, from the module esbuild inlines into the bundle under test.
    buildHelperGrant, helperPolicy, lifetimeWindow, eligibleHelpers,
    // the world, stubbed — never the decision
    crypto: { getRandomValues: (u8) => { u8.fill(0x5a); return u8; } },
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
    finalizeEvent: (e) => ({ ...e, id: 'evt', pubkey: CHURCH, sig: 'sig' }),
    _publishToRelays: async (e) => { published.push(e); return publishOk; },
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

  const body = fnBody(VENDOR, 'async publishCheckinHelpers(opts) {', 'publishCheckinHelpers');
  const fn = new Function('scope', `with (scope) { return ({ ${body} }).publishCheckinHelpers; }`)(scope);
  return { stubs, published, warnings, publishCheckinHelpers: (o) => fn.call({}, o) };
}

// The service the console is minting for: a Sunday morning, in the church's own shape.
const SERVICE = { date: '2026-09-13', time: '10:30' };
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
    helpers: [ADA, DAN], stewards: [SGLEAD, TREASURER] });
  assert.ok(out, 'the shipped mint refused to publish at all');
  const { raw } = grantOf(h);

  assert.ok(raw.keys[SGLEAD],
    'the safeguarding lead was given no copy of the session key BY THE REAL MINT. A helper\'s check-in is ' +
    'then openable only by the volunteer who typed it, which is not a safeguarding record. The relay test ' +
    'named for this passes regardless, because it builds its own keeper list.');
  assert.ok(raw.keys[CHURCH], 'the church itself was given no copy of the session key');
  assert.equal(raw.keys[SGLEAD], 'sealed[ck:' + SGLEAD + ']' + '5a'.repeat(32),
    're-anchor: the lead\'s slot is not this session\'s key wrapped to the lead');
});

test('…AND THE FINANCE-ONLY STEWARD IS NOT — the August leak, asserted as a refusal', async () => {
  // In August, granting a steward Finance handed over the children's register. The capability tick is what
  // separates them, and `checkin` is an EXPLICIT capability so an unscoped steward does not get it either.
  const h = harness();
  await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, helpers: [ADA], stewards: [SGLEAD, TREASURER] });
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
  await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, helpers: [ADA], stewards: [SGLEAD, TREASURER] });
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
  await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, helpers: [ADA] });   // no `stewards`
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
  await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, helpers: [ADA, DAN], stewards: [SGLEAD] });
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
  const out = await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, helpers: [ADA] });
  const { g } = grantOf(h);
  assert.equal(g.lifetime, DEFAULT_HELPER_LIFETIME, 'the mint stopped defaulting to the tightest lifetime');
  assert.equal(g.lifetime, 'session', 're-anchor: the default lifetime moved and this test was not updated');
  assert.equal(g.source, 'rota', 'the mint stopped defaulting to the rota as the source of the role');
  assert.ok(g.until != null, 'a default grant has no end — it is a standing key to the children\'s register');
  assert.ok(g.until - g.from <= HELPER_LIFETIMES.session.max,
    'the default grant is longer than the lifetime it declares, so the relay will refuse it at the door');
  assert.equal(out.lifetime, 'session', 'the mint reports a different lifetime from the one it published');
});

test('a grant the relay would refuse is never published — the console refuses it first', async () => {
  // Same rules, both ends. A service with no placeable date yields NO grant rather than a guessed one, for
  // the same reason _sealChurchDocReady refuses to write a gathering in the clear rather than guessing a key.
  const h = harness();
  assert.equal(await h.publishCheckinHelpers({ session: 'svc-sun', service: {}, helpers: [ADA] }), null,
    'the console minted a grant for a service it could not place in time');
  assert.equal(await h.publishCheckinHelpers({ session: '', service: SERVICE, helpers: [ADA] }), null,
    'the console minted a grant with no session id');
  assert.equal(await h.publishCheckinHelpers({ session: 'svc-sun', service: { date: 'not-a-date' }, helpers: [ADA] }), null,
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
  await h.publishCheckinHelpers({ session: 'svc-a', service: SERVICE, helpers: [ADA], source: 'invented', lifetime: 'forever' });
  const { g } = grantOf(h);
  assert.equal(g.lifetime, DEFAULT_HELPER_LIFETIME,
    'an unrecognised lifetime did not fall back to the tightest one');
  assert.equal(g.source, 'rota', 'an unrecognised source did not fall back to the rota');
  assert.ok(g.until != null && g.until - g.from <= HELPER_LIFETIMES.session.max,
    'a grant naming a lifetime nothing implements ended up unbounded, or longer than the shape it fell back ' +
    'to — which is garbage widening into a standing key to the children\'s register');
  assert.notEqual(g.lifetime, 'open',
    'an undeclared lifetime became the open-ended one. That is the only shape that never expires, and it is ' +
    'the one a typo must never reach.');
});

test('ONLY THE OWNER MINTS. A delegated steward console publishes nothing at all', async () => {
  // The relay refuses this too (gateway.mjs, the CHECKINHELPER_D branch of accept(), and there is a live test
  // for it). This is the other half: the console does not even try, so a delegated steward is not shown a
  // success over a write the relay threw away. memory: fix-the-control-not-the-label.
  const noKey = harness(); noKey.stubs.sk = null;
  assert.equal(await noKey.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, helpers: [ADA] }), null,
    'a console with no key minted a grant');
  const notHeld = harness(); notHeld.stubs.churchSkHeld = () => false;
  assert.equal(await notHeld.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, helpers: [ADA] }), null,
    'a console that is not holding the church key minted a grant to the children\'s register');
  const delegated = harness(); delegated.stubs.actingChurch = CHURCH;
  assert.equal(await delegated.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, helpers: [ADA] }), null,
    'a DELEGATED steward console minted a helper grant. A safeguarding steward can already read the register; ' +
    'being able to hand it to a third party is an escalation they do not have.');
  for (const h of [noKey, notHeld, delegated]) assert.deepEqual(h.published, [], 'and it reached the wire');
});

test('a publish the relays refused is reported as a failure, not as a staffed session', async () => {
  // memory: fix-the-control-not-the-label — six serving controls toasted success over a send that never
  // happened. A steward told the creche is staffed when no relay took the grant is the same defect, in the
  // one place where the consequence is a volunteer standing in a room with no register.
  const h = harness({ publishOk: false });
  assert.equal(await h.publishCheckinHelpers({ session: 'svc-sun', service: SERVICE, helpers: [ADA], stewards: [SGLEAD] }), null,
    'the console reported a staffed session over a grant no relay accepted');
});
