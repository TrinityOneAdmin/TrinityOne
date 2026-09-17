// THE OWNER MUST ACTUALLY BE ABLE TO TICK "SEALED ROOMS" — the SCREEN half of the same fix.
// Run: node --test scripts/the-sealed-rooms-tick-reaches-the-owner.test.mjs
//
// CLAUDE.md rule 1: a fix needs a test that fails if the feature is deleted FROM THE SCREEN, not only if the
// engine behind it breaks. The relay half of this work is in scripts/sealing-a-room-is-its-own-job.test.mjs
// and it is a well-tested gate. A gate nobody can open is not a feature: if `sealedrooms` ever falls out of
// the capability list the console renders, every delegated steward is refused every room key for ever and
// the only clue is a relay refusal nobody sees.
//
// RULE 3 IS WHY THIS FILE IS SHAPED THE WAY IT IS. app/*.jsx ships UNBUNDLED, so `false && ` in front of a
// condition leaves every word of it on disk and a text match still passes. So:
//   · the capability list is taken from the SHIPPED BUNDLE (vendor/steward.js) and RUN, not matched — the
//     bundler strips dead code, so a removed entry really is gone from that file;
//   · the owner-facing words are not asserted as prose but EVALUATED as the objects the screen indexes,
//     and the assertion is a coverage one: every capability the engine offers must resolve to a human label
//     and a description. That is the failure that actually reaches an owner — a checkbox reading
//     "sealedrooms" with no sentence under it.
//
// AND ONE HONESTY ROW, which is the other thing a screen owes: a console must not report a room as sealed
// when the relay refused its key. sealGroup is lifted from the shipped bundle and driven.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const GATEWAY = readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8');

// The capability list AS THE SHIPPED CONSOLE HOLDS IT. Read out of the bundle rather than out of the source,
// for the reason at the top: the bundle is what a phone runs, and dead code is not in it.
function shippedCapNames() {
  const m = /STEWARD_CAPS\s*=\s*(\[[^\]]*\])/.exec(VENDOR);
  assert.ok(m, 're-anchor: vendor/steward.js no longer defines STEWARD_CAPS — the capability list has moved');
  const list = JSON.parse(m[1].replace(/'/g, '"'));
  assert.ok(Array.isArray(list) && list.length >= 5, 'the shipped capability list looks wrong: ' + m[1]);
  return list;
}

// The two objects the capability editor indexes for its words. Evaluated, so a typo in a key is a missing
// label here exactly as it is on screen.
function wordsFrom(name) {
  const body = fnBody(DASH, 'const ' + name + ' = {', name);
  const lit = body.slice(body.indexOf('{'));
  // eslint-disable-next-line no-new-func
  return new Function('return (' + lit + ')')();
}

test('CONTROL: the instruments are reading real files with real content', () => {
  // Every assertion below is "X contains Y". An empty or wrong file produces the same shape as a missing
  // feature, and a content check that matched the wrong file reported a shipped fix missing once already.
  assert.ok(VENDOR.length > 200000, 'vendor/steward.js is too small to be the built console: ' + VENDOR.length);
  assert.ok(DASH.includes('const STEW_CAP_LABEL'), 're-anchor: app/stew-dashboard.jsx is not the console dashboard');
  assert.ok(GATEWAY.includes('function accept(e) {'), 're-anchor: scripts/gateway.mjs is not the relay');
  const caps = shippedCapNames();
  for (const known of ['finance', 'care', 'safeguarding', 'members', 'content']) {
    assert.ok(caps.includes(known), 'the control failed: the shipped list has lost "' + known + '", so this file is reading something else');
  }
});

test('the owner can tick Sealed rooms at all — it is in the list the console renders', () => {
  assert.ok(shippedCapNames().includes('sealedrooms'),
    'the console offers no "Sealed rooms" tick, so no church can ever grant it — and the relay now refuses ' +
    'every delegated steward every room key. The gate would be perfect and unreachable: a well-tested engine ' +
    'nobody is required to consult is not a feature.');
});

test('every capability the console offers has words an owner can read', () => {
  const caps = shippedCapNames();
  const label = wordsFrom('CAP_LABEL');       // the editor's own map, in the capability panel
  const chip = wordsFrom('STEW_CAP_LABEL');   // the map the "isn't yours to run" screen uses
  const sub = wordsFrom('CAP_SUB');
  const noLabel = caps.filter(c => !label[c]);
  const noChip = caps.filter(c => !chip[c]);
  const noSub = caps.filter(c => !sub[c]);
  assert.deepEqual(noLabel, [], 'these capabilities render as their raw code name on the tick list: ' + noLabel.join(', '));
  assert.deepEqual(noChip, [], 'these render as their raw code name on the refusal screen: ' + noChip.join(', '));
  assert.deepEqual(noSub, [],
    'these capabilities have a checkbox and NO sentence under it. The owner is not a programmer and is ' +
    'deciding who may see something about a person in their congregation: ' + noSub.join(', '));
});

test('the Sealed rooms sentence says the thing that makes it its own tick', () => {
  // Not a prose match for its own sake: the whole reason this is separate from "Groups & rotas" is that
  // locking a room means HOLDING its key, and holding the key means reading the room. An owner who is not
  // told that cannot tell why there are two boxes, and will tick both.
  const blurb = wordsFrom('CAP_SUB').sealedrooms || '';
  assert.ok(blurb.length > 40, 're-anchor: Sealed rooms has no description in the capability editor');
  assert.match(blurb, /read/i,
    'the Sealed rooms sentence never tells the owner that this person can READ what is said in the room. ' +
    'That is the whole of what the grant does.');
  assert.match(blurb, /Groups & rotas/,
    'the sentence does not say why this is separate from Groups & rotas, so the separation reads as fussiness');
});

test('the console and the relay spell the capability the SAME way', () => {
  // One spelling, or the padlock and the key disagree — which this repo has shipped once (capNeedsExplicitGrant).
  // The relay lower-cases what it reads from a roster, so a console that wrote "SealedRooms" would grant at
  // the relay and mismatch here, or the reverse.
  const caps = shippedCapNames();
  assert.ok(caps.every(c => c === c.toLowerCase()), 'a capability name is not lower case: ' + caps.join(', '));
  assert.ok(GATEWAY.includes("'sealedrooms'"),
    'the relay does not gate on the name the console grants. The tick would be honoured by nobody.');
});

test('the relay asks stewardCan for this one, NOT stewardCanExplicitly — the compatibility decision', () => {
  // The decision, pinned where a future edit would have to change this line on purpose. An explicit-only gate
  // refuses an UNSCOPED steward — and the capability editor collapses "every box ticked" to caps: null,
  // which IS unscoped. So an explicit gate would refuse the steward an owner ticked everything for.
  const i = GATEWAY.indexOf('if (d.startsWith(GROUPKEY_D)) {');
  assert.ok(i > 0, 're-anchor: the groupkey rule is gone from the relay');
  const branch = GATEWAY.slice(i, GATEWAY.indexOf('\n    }\n', i));
  assert.match(branch, /stewardCan\(e\.pubkey, owner, 'sealedrooms'\)/, 'the branch no longer asks the capability at all');
  assert.doesNotMatch(branch, /stewardCanExplicitly/,
    'the sealed-rooms gate became explicit-only. That refuses an unscoped steward — including one whose ' +
    'owner ticked every box, because the editor writes caps: null for that — and takes away sealing from ' +
    'stewards who can do it today.');
});

// ── THE HONESTY ROW. A refused key must never be reported as a sealed room. ──────────────────────────────
test('the console does not report a room as sealed when the relay refused its key', async () => {
  // sealGroup out of the SHIPPED bundle, driven with a key publish that FAILS — which is precisely what a
  // steward without the new capability now gets from the relay. The room's own document must never be
  // flipped to encrypted: a flagged room with no key is a room every member's send is refused in, for ever,
  // while the steward is told it worked.
  const calls = [];
  const scope = new Proxy({
    _isRelayAuthed: () => true,
    window: { Steward: {
      publishGroupKey: (...a) => { calls.push(['key', a[0]]); return Promise.resolve(false); },   // relay refused
      publishGroup: (...a) => { calls.push(['flag', a[0] && a[0].id]); return Promise.resolve({ ts: 123 }); },
    } },
    churchSk: new Uint8Array(32).fill(1),
  }, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      throw new ReferenceError('the lifted sealGroup needs `' + String(k) + '` — add a stub');
    },
  });
  const body = fnBody(VENDOR, 'async sealGroup(group, memberPubs) {', 'sealGroup');
  const sealGroup = new Function('scope', `with (scope) { return ({ ${body} }).sealGroup; }`)(scope);

  const r = await sealGroup({ id: 'g1', name: 'Prayer' }, ['a'.repeat(64)]);
  assert.equal(r.sealed, false, 'the console reported a room sealed when the relay refused its key');
  assert.deepEqual(calls.map(c => c[0]), ['key'],
    'the group document was flipped to encrypted even though the key was refused. Every member\'s send is ' +
    'then refused with "try again in a moment", for ever, nothing decrypts, and the steward saw success.');

  // CONTROL, with a known answer: the same function on the happy path must seal and must flip the flag.
  calls.length = 0;
  scope.window.Steward.publishGroupKey = (...a) => { calls.push(['key', a[0]]); return Promise.resolve(true); };
  const ok = await sealGroup({ id: 'g1', name: 'Prayer' }, ['a'.repeat(64)]);
  assert.equal(ok.sealed, true, 'the control failed: sealGroup refuses even a successful key publish, so the row above proves nothing');
  assert.deepEqual(calls.map(c => c[0]), ['key', 'flag'], 'the control failed: the happy path does not publish both documents');
});

test('nothing in the capability editor hard-codes the old five-item list', () => {
  // Not a behavioural claim (rule 3) — a shape one. The editor maps over what the ENGINE returns; a
  // hand-typed array beside it would silently freeze the list at five and the new tick would never appear.
  const src = stripComments(DASH);
  assert.ok(src.includes('capNames.map('),
    're-anchor: the capability editor no longer renders the engine\'s list, so adding a capability to the ' +
    'engine no longer puts it on the screen');
  assert.ok(src.includes('stewardCapNames'), 're-anchor: the console no longer asks the engine what the capabilities are');
});
