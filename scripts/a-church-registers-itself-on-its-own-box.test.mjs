// A CHURCH CREATED ON A SUITE BOX REGISTERS ITSELF THERE — chunk 3 of
// reference/SCOPE-SUITE-AUTOREGISTER-2026-09-12.md.
// Run: node --test scripts/a-church-registers-itself-on-its-own-box.test.mjs
//
// Owner 2026-09-04: "a suite box should auto register". Owner 2026-09-12: "I really want to make sure the
// 'adding a church' isn't something that a steward has to do manually."
//
// ⚠ THE FUNCTION UNDER TEST IS LIFTED OUT OF vendor/steward.js — the bundle esbuild actually ships — and
// executed. Nothing here matches source text.
// NO RELAY AND NO PORT: `fetch` is a stub that records what was sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const PUB = 'a'.repeat(64);
const NPUB = 'npub1theonechurch';

// The shipped function, over a scope where every collaborator is named rather than assumed.
function box({ origin = 'http://127.0.0.1:8795', token = 'tok-123', already = null,
               acting = null, pub = PUB, ok = true, status = 200, alwaysOn = undefined } = {}) {
  const store = {};
  if (alwaysOn !== undefined) store['to_relay_always_on'] = alwaysOn;
  if (already) store['trinityone.steward.autoreg.' + pub + '|' + origin] = already;
  const sent = [];
  const events = [];
  const said = [];
  const scope = {
    pub, actingChurch: acting,
    _ownOrigin: () => origin,
    localAdminToken: async () => token,
    _authHdr: (t) => (t ? { Authorization: 'Bearer ' + t } : {}),
    npubEncode: () => NPUB,
    lsGet: (k) => (k in store ? store[k] : ''),
    lsSet: (k, v) => { store[k] = String(v); },
    fetch: async (url, opts) => { sent.push({ url, opts }); return { ok, status, json: async () => ({}) }; },
    window: { dispatchEvent: (e) => { events.push(e && e.type); said.push((e && e.detail && e.detail.message) || ''); } },
    CustomEvent: function CustomEvent(t, d) { this.type = t; this.detail = d && d.detail; },
    String, JSON, Object, Promise, console,
  };
  const src = fnBody(SHIP, 'function _autoRegKey(origin) {', '_autoRegKey')
    + '\n' + fnBody(SHIP, 'async function _registerOnOwnBox(name) {', '_registerOnOwnBox');
  const fn = new Function('scope', 'with (scope) {' + src + '\nreturn _registerOnOwnBox; }')(
    new Proxy(scope, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
        throw new ReferenceError('the shipped registrar needs a stub for ' + String(k)); },
    }));
  return { run: (n) => fn(n), sent, events, said, store, origin, pub };
}

test('NAMING A CHURCH ON ITS OWN BOX REGISTERS IT THERE — no npub pasted, no token typed', async () => {
  const b = box();
  await b.run("St Chad's");
  assert.equal(b.sent.length, 1,
    'THE CHURCH DID NOT REGISTER ITSELF. Until it does, the only route is the relay wizard telling a ' +
    'steward to paste an npub they cannot have yet on a fresh box.');
  assert.match(b.sent[0].url, /\/config$/);
  assert.equal(b.sent[0].opts.method, 'POST');
  assert.equal(b.sent[0].opts.headers.Authorization, 'Bearer tok-123');
  assert.deepEqual(JSON.parse(b.sent[0].opts.body), { addChurch: { npub: NPUB, name: "St Chad's" } },
    'the registration did not carry this church and this name');
});

test('…ONCE. A second naming does not register again', async () => {
  // H4: registration is a SETUP step, not a heartbeat. Firing per mount left 19 permanent tenants on the
  // shared box, and nothing ever removes a row.
  const b = box();
  await b.run("St Chad's");
  await b.run("St Chad's, Falgate");        // a rename, later the same day
  assert.equal(b.sent.length, 1, 'the church re-registered on a rename — that is the H4 heartbeat bug');
  assert.equal(b.store['trinityone.steward.autoreg.' + b.pub + '|' + b.origin], '1', 'nothing was remembered');
});

test('a church already registered on this box is never re-sent', async () => {
  const b = box({ already: '1' });
  await b.run("St Chad's");
  assert.deepEqual(b.sent, [], 'a remembered registration was repeated on the next console load');
});

test('NOTHING HAPPENS OFF LOOPBACK — a hosted console gains no authority whatsoever', async () => {
  // THE SECURITY BOUNDARY, and it is not new: localAdminToken() is gated on _originIsLoopback(), so a
  // console at app.trinityone.church — same-origin with the SHARED POOL — is handed no token at all. This
  // asserts the registrar respects an empty token rather than proceeding without one.
  const b = box({ token: '' });
  await b.run("St Chad's");
  assert.deepEqual(b.sent, [], 'A CONSOLE WITH NO LOCAL ADMIN TOKEN REGISTERED A CHURCH ANYWAY.');
  assert.deepEqual(b.store, {}, 'it also remembered a registration that never happened');
});

test('a NAMELESS church is never registered, and that restraint is ours, not the relay’s', async () => {
  // The relay's own name check sits inside `if (!isAdmin)`, and we hold the admin token — so the relay
  // WOULD accept this. The name is the readiness signal that a church exists at all; nameless rows are
  // exactly what H4 is about.
  for (const n of ['', '   ', null, undefined]) {
    const b = box();
    await b.run(n);
    assert.deepEqual(b.sent, [], 'a church with no name (' + JSON.stringify(n) + ') was registered');
  }
});

test('a DELEGATED steward never registers somebody else’s church on their own box', async () => {
  // `actingChurch` means this console is acting for a church whose key it does not hold. publishProfile
  // already refuses for them; the registrar must not be the way round that.
  const b = box({ acting: 'b'.repeat(64) });
  await b.run("Someone else's church");
  assert.deepEqual(b.sent, [], 'A DELEGATED STEWARD REGISTERED ANOTHER CHURCH ONTO THIS BOX.');
});

test('a refused registration is NOT remembered, so it can be retried', async () => {
  const b = box({ ok: false });
  await b.run("St Chad's");
  assert.equal(b.sent.length, 1, 're-anchor: nothing was attempted at all');
  assert.deepEqual(b.store, {}, 'A FAILED REGISTRATION WAS RECORDED AS DONE. It can now never be retried, ' +
    'and the church is left pointing at the pool with nothing on screen saying so.');
});

test('it announces itself, so a screen can say what happened', async () => {
  const b = box();
  await b.run("St Chad's");
  assert.deepEqual(b.events, ['steward-box-registered'], 'nothing is dispatched, so chunk 5 has nothing to render');
});

test('a page with no origin (a native shell) does nothing', async () => {
  const b = box({ origin: '' });
  await b.run("St Chad's");
  assert.deepEqual(b.sent, [], 'the registrar POSTed from a shell with no origin to register against');
});

test('AND publishProfile ACTUALLY CALLS IT — the engine is not left with no caller', () => {
  // ⚠ MEASURED, AND NOT WHAT I EXPECTED. I wrote this expecting the nine tests above to stay green with the
  // call deleted from publishProfile — the rule-1 "engine with no caller" shape. They do not: esbuild
  // TREE-SHAKES an uncalled function straight out of vendor/steward.js, so the slice finds nothing and all
  // ten fail at once. The bundler is doing the rule-1 check for us here, which is worth knowing.
  // This assertion still earns its place for what tree-shaking canNOT catch: the call surviving but moving
  // to the wrong place, or a second screen registering on its own instead of through publishProfile.
  //
  // ⚠ AND IT MATCHES THE BUNDLE, NOT THE SOURCE, WHICH IS WHY IT IS SOUND. Rule 3 forbids asserting
  // behaviour by matching app/*.jsx because those ship unbundled and `false && ` leaves the text in place.
  // vendor/steward.js is the opposite case the rule names: esbuild removes dead code, so if the call were
  // disabled the text would be GONE and this assertion would fail. That is the one place text-matching
  // proves something.
  const body = fnBody(SHIP, 'publishProfile(meta) {', 'publishProfile');
  assert.match(body, /_registerOnOwnBox/,
    'publishProfile NO LONGER REGISTERS THE CHURCH ON ITS OWN BOX. Naming a church on a Suite box leaves ' +
    'it pointing at the hosted pool, and the only remedy is the relay wizard asking a steward to paste an ' +
    'npub — the manual step this work exists to remove.');
  // …and it is the ONE place it is wired, so a fourth naming screen cannot forget it.
  const calls = (SHIP.match(/_registerOnOwnBox\(/g) || []).length;
  assert.equal(calls, 2, 'expected exactly one definition and one call site, found ' + calls +
    ' — a second caller means a screen is registering on its own rather than through publishProfile');
});

test('A STEWARD WHO SAID THE MACHINE GETS SWITCHED OFF IS NOT OVERRULED', () => {
  // Owner, 2026-09-12: "if the can't leave it on, their relay mustn't be the primary one, their church
  // should default to a public relay." Registering their church here anyway is the app contradicting the
  // answer it just asked for.
  const b = box({ alwaysOn: '0' });
  return b.run("St Chad's").then(() => {
    assert.deepEqual(b.sent, [],
      'THE CHURCH WAS BOUND TO A BOX ITS OWNER JUST SAID THEY CANNOT KEEP RUNNING.');
    assert.deepEqual(b.store['trinityone.steward.autoreg.' + b.pub + '|' + b.origin], undefined,
      'it also recorded a registration that never happened, so a later "yes" could never take effect');
  });
});

test('…but SILENCE is not a no — a box that never saw the question still registers', async () => {
  // A wizard that was skipped, or a relay that predates the question. Treating an absent answer as refusal
  // would quietly switch self-hosting off for everybody who never saw the screen.
  for (const v of [undefined, '', '1']) {
    const b = box({ alwaysOn: v });
    await b.run("St Chad's");
    assert.equal(b.sent.length, 1, 'an answer of ' + JSON.stringify(v) + ' was treated as a refusal');
  }
});

test('A REGISTRATION THAT FAILED SAYS SO — and says what DID work', async () => {
  // The church has just been created and named; only the binding to this box failed. Silence here leaves a
  // steward believing they self-host while their congregation is served by the public relays.
  const b = box({ ok: false, status: 500 });
  await b.run("St Chad's");
  assert.deepEqual(b.events, ['steward-write-blocked'],
    'A FAILED REGISTRATION SAID NOTHING AT ALL. Nothing else on any screen reports this.');
  const m = b.said.join(' ');
  assert.match(m, /was created/i, 'it does not say the church itself succeeded — a steward may re-create it');
  assert.match(m, /NOT been added to this computer/i, 'it does not say what actually failed');
  assert.match(m, /relays for now/i, 'it does not say where the church is meanwhile, so nothing looks recoverable');
});

test('…and a relay that is FULL says that, rather than a generic shrug', async () => {
  // /config caps self-registration (CHURCH_REPLACE_CAP) and answers 429. "Didn't answer properly" would
  // send a steward chasing a network fault that is not there.
  const b = box({ ok: false, status: 429 });
  await b.run("St Chad's");
  assert.match(b.said.join(' '), /limit of churches/i, 'a 429 was reported as a generic failure');
});

test('a SUCCESS is announced too, so chunk 5 has something to render', async () => {
  const b = box();
  await b.run("St Chad's");
  assert.deepEqual(b.events, ['steward-box-registered'], 'success dispatched nothing, or dispatched a failure');
});
