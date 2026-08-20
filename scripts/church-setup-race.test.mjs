// A CHURCH'S FIRST NINETY SECONDS MUST NOT LOOK LIKE A CONFLICT.
// Run: node --test scripts/church-setup-race.test.mjs
//
// Measured on a fresh church, one console, nobody else editing (R5-5, 2026-08-19). Two separate faults, both
// visible to the steward as a red sticky banner reading "Someone else saved a newer version of this while you
// were editing. Reload the page and make your change again — trying again as-is won't help."
//
// 1. THE RELAY DID NOT YET KNOW THE CHURCH EXISTED. seedNewChurch() calls selfRegister() without awaiting it
//    and starts publishing immediately, so the founding documents raced an HTTP round-trip. From
//    relay/rejected.log, one church, one console:
//
//      13:40:27  trinityone/namekey:8165a004…     -> not a member or not permitted for this group
//      13:40:27  trinityone/carekey:8165a004…     -> not a member or not permitted for this group
//      13:40:33  trinityone/joinpolicy:8165a004…  -> not a member or not permitted for this group
//      13:40:50  (church registered)
//
// 2. TWO WRITES OF ONE DOCUMENT IN THE SAME SECOND ARE A COIN FLIP. A replaceable event is ordered by
//    created_at and NIP-01 breaks a tie on event id, so the second write within one second is refused about
//    half the time — deterministically, but on a value nobody controls. The relay is right to refuse it. The
//    console's sentence about it is what is wrong, and the cure is not to create the tie.
//
// This drives the SHIPPED console bundle (vendor/steward.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// Lift a function out of the bundle and give it a scope. Names are resolved through a proxy so a bundler
// rename raises a loud ReferenceError instead of a silent undefined (this cost an hour once already).
function lift(anchor, name, stubs) {
  const body = fnBody(VENDOR, anchor, name);
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub');
    },
  });
  return new Function('scope', `with (scope) { return (${body}); }`)(scope);
}

test('two writes of one document in the same second get different timestamps', () => {
  const now = 1787149000;
  const _monotonic = lift('function _monotonic(tmpl) {', '_monotonic', {
    _lastStamp: new Map(), Date: { now: () => now * 1000 },
  });
  const doc = (at) => ({ kind: 30078, created_at: at, tags: [['d', 'trinityone/joinpolicy:abc']] });
  const a = _monotonic(doc(now));
  const b = _monotonic(doc(now));
  const c = _monotonic(doc(now));
  assert.ok(b.created_at > a.created_at,
    'the second write of a document carries the same created_at as the first, so which one survives is ' +
    'decided by comparing event ids — a coin flip the steward then reads as "someone else saved a newer version"');
  assert.ok(c.created_at > b.created_at, 'the third write ties with the second');
});

test('a normal write, seconds later, keeps its real timestamp', () => {
  let clock = 1787149000;
  const _monotonic = lift('function _monotonic(tmpl) {', '_monotonic', {
    _lastStamp: new Map(), Date: { now: () => clock * 1000 },
  });
  const doc = () => ({ kind: 30078, created_at: clock, tags: [['d', 'trinityone/joinpolicy:abc']] });
  _monotonic(doc());
  clock += 30;
  assert.equal(_monotonic(doc()).created_at, clock,
    'an ordinary edit half a minute later is being pushed off the real clock, which would drift a document ' +
    'into the future over a long session');
});

test('separate documents do not push each other forward', () => {
  const now = 1787149000;
  const _monotonic = lift('function _monotonic(tmpl) {', '_monotonic', {
    _lastStamp: new Map(), Date: { now: () => now * 1000 },
  });
  _monotonic({ kind: 30078, created_at: now, tags: [['d', 'a']] });
  assert.equal(_monotonic({ kind: 30078, created_at: now, tags: [['d', 'b']] }).created_at, now,
    'the stamp is global rather than per document, so unrelated documents inflate each other');
});

test('the gate holds a write until registration lands, then lets it go', async () => {
  let opened;
  const gate = new Promise((r) => { opened = r; });
  let regGate = gate;
  const waitFor = lift('async function _waitForRegistration() {', '_waitForRegistration', {
    get _regGate() { return regGate; }, set _regGate(v) { regGate = v; },
    REG_GATE_MS: 8000,
  });
  let through = false;
  const p = waitFor().then(() => { through = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(through, false,
    'the founding documents go out while the church is still registering, and the relay refuses them as ' +
    '"not a member or not permitted for this group"');
  opened();
  await p;
  assert.equal(through, true, 'the write never resumed after registration completed');
});

test('a relay that never answers registration does NOT stop the church publishing', async () => {
  let regGate = new Promise(() => {});
  const waitFor = lift('async function _waitForRegistration() {', '_waitForRegistration', {
    get _regGate() { return regGate; }, set _regGate(v) { regGate = v; },
    REG_GATE_MS: 30,
  });
  await waitFor();
  assert.equal(regGate, null,
    'a silent relay holds the gate shut for ever. It must open after the bound AND latch, so the cost is ' +
    'paid once rather than on every write for the rest of the session.');
});

test('BOTH publishers wait — not just the one that got fixed first', () => {
  // publish() was guarded first and the five seeded groups were refused anyway, because they travel by
  // _publishToRelays(). Measured, twice, before this test existed.
  for (const fn of ['async function publish(evt) {', 'async function _publishToRelays(evt, urls) {']) {
    const body = stripComments(fnBody(VENDOR, fn, fn));
    assert.match(body, /_waitForRegistration\(\)/,
      fn.split('(')[0] + ' publishes without waiting for the church to exist on the relay');
  }
});

test('every church document is stamped where it is SIGNED, not on one path', () => {
  const fe = stripComments(fnBody(VENDOR, 'function feChurch(tmpl, signer) {', 'feChurch'));
  assert.match(fe, /_monotonic\(/,
    'the stamp has moved off the signing path again. Forty-two call sites publish through feChurch and only ' +
    'one through _publishSigned, so guarding anything else guards almost nothing.');
});

test('selfRegister opens the gate on every exit path', () => {
  const body = stripComments(fnBody(VENDOR, 'async selfRegister(name, opts) {', 'selfRegister'));
  assert.match(body, /_armRegGate\(\)/, 'selfRegister no longer holds the publish gate');
  assert.match(body, /finally\s*\{[\s\S]{0,220}?_openRegGate\(\)/,
    'the gate is opened somewhere other than a finally, so an early return or a throw leaves every ' +
    'subsequent publish waiting out the bound');
  assert.match(body, /_regNeedsName/,
    'a refusal of "name your church first" is treated as a verdict. It is a not-yet: the wizard names the ' +
    'church seconds later and re-registers, and the founding documents should wait for that.');
});

test('the gate is armed when the church key is born, not when registration starts', () => {
  // The first cut armed it inside selfRegister — and the same change had just removed the selfRegister call
  // at creation (it passed an empty name and could only ever 400). So at the moment the founding documents
  // went out there was no gate at all, and the measurement showed all ten writes refused exactly as before.
  const ck = stripComments(fnBody(VENDOR, 'createKey() {', 'createKey'));
  assert.match(ck, /_armRegGate\(\)/,
    'a brand-new church key exists on no relay, and nothing holds its first writes back');
});

test('the relay records a have-newer refusal like every other refusal', () => {
  const GW = stripComments(readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8'));
  const line = (GW.match(/if \(putRes === 'have-newer'\).*/) || [''])[0];
  assert.match(line, /rejectLog\(/,
    'a have-newer refusal is the one that raises the alarming banner, and it is the only refusal the relay ' +
    'does not write to rejected.log — so diagnosing it needs a screenshot of somebody\'s phone');
});

test('a console helping run SOMEBODY ELSE\'s church never registers itself as one', () => {
  // Measured on 2026-08-19: four rows in one relay's church list, all named "St Aidan's, Ferrymead", three of
  // them delegated stewards. selfRegister registers `churchPub`, which in delegated mode is the STEWARD'S own
  // key, and the console fired it whenever a church name was in view — so each helper registered themselves
  // under the name of the church they were helping.
  //
  // It was not merely untidy. A registered key is a church at the relay, and being a church skipped the
  // capability checks entirely, so scoping a steward to Finance stopped meaning anything the moment their own
  // console did this. The relay half is guarded in relay-church-scope.test.mjs; this is the other half.
  const body = stripComments(fnBody(VENDOR, 'async selfRegister(name, opts) {', 'selfRegister'));
  assert.match(body, /if \(actingChurch\) return/,
    'a delegated console still registers its own key as a church, which puts a junk row in the operator\'s ' +
    'church list and hands that steward church-level authority at the relay');
  const at = body.indexOf('if (actingChurch) return');
  const fetchAt = body.indexOf('fetch(');
  assert.ok(at > 0 && (fetchAt < 0 || at < fetchAt),
    'the check runs after the registration request has already gone out');
});

test('and the screen that fires it asks the same question first', () => {
  const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const src = stripComments(DASH);
  const i = src.indexOf('selfRegister(church.name)');
  assert.ok(i > 0, 're-anchor: the dashboard no longer self-registers on the church name');
  const before = src.slice(Math.max(0, i - 400), i);
  assert.match(before, /S\.actingChurch/,
    'the dashboard fires self-registration for any console showing a church name, including a delegate ' +
    'viewing the church they help with — which is how the junk rows were created in the first place');
});
