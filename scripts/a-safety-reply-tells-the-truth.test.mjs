// A MEMBER WHO ANSWERED A SAFETY ROLL-CALL MUST NOT BE TOLD NOBODY KNOWS.
// Run: node --test scripts/a-safety-reply-tells-the-truth.test.mjs
//
// `markSafe` is the writer behind "I'm safe" / "I need help". It answered `false | true | 'narrow'`, and
// EVERY failure was the same `false` — so when `_publishAny` threw because nobody acknowledged inside
// WEDGE_ACK_MS (not because anyone refused), a member who had just tapped "I need help" read "Couldn't send
// — try again" while their church already had it. The same defect the three check-in writers were fixed for
// after a Pixel measured it (device finding F1, 2026-09-11); this is the safety surface getting the same
// treatment, and it is the worst screen in the app to be wrong on.
//
// ⚠ AND THE RETURN SHAPE IS THE DANGEROUS PART, WHICH IS WHY THE LAST TEST HERE EXISTS.
// Both callers branch on `if (ok)`. ANY truthy failure value — an object, or a string like 'unconfirmed' —
// makes a FAILURE take the SUCCESS arm: `safetyAck` fires and the member is recorded as having answered
// when nothing was confirmed. That is strictly worse than the bug being fixed. An object was chosen over a
// truthy string precisely because it forces every caller to change, and the caller test below fails if a
// future one truth-tests it instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const APP_DIR = new URL('../app/', import.meta.url).pathname;

const SHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');

// The shipped writer, lifted and run, with _publishAny throwing the ways it really throws.
function lift({ mode }) {
  const scope = {
    sk: 'a'.repeat(64),
    window: { Fellowship: { churchPub: 'c'.repeat(64), ready: Promise.resolve(), relays: ['wss://x/relay'] } },
    churchRelays: () => ['wss://x/relay'],
    _fetchCareTeam: async () => ['r'.repeat(64)],
    _churchRoster: new Map([['c'.repeat(64), new Set(['r'.repeat(64)])]]),
    _safeReaders: () => ({ readers: ['r'.repeat(64)], narrowed: mode === 'narrow' }),
    _dmEncrypt: () => 'ct',
    NET: 'safe:',
    SAFE_D: 'safe:',
    finalizeEvent2: (t) => ({ ...t, id: 'e' }),
    _publishAny: async () => {
      if (mode === 'ok' || mode === 'narrow') return true;
      const e = new Error(mode === 'refused' ? 'blocked: not a member' : 'no relay acknowledged');
      if (mode === 'refused') e.refused = true;
      if (mode === 'not-sent') e.unsent = true;
      throw e;
    },
    _pubReason: new Function(fnBody(SHIP, 'function _pubReason(e)', '_pubReason') + '\nreturn _pubReason;')(),
    String, JSON, Date, Math, Number, Array, Object, Boolean, RegExp, console, Promise, Set, Map, setTimeout,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped markSafe needs a stub for ' + String(k)); },
  });
  const fn = new Function('scope', 'with (scope) { return ({ ' + fnBody(SHIP, 'async markSafe(check, status, note)', 'markSafe') + ' }); }')(proxy).markSafe;
  return () => fn({ id: 'chk1', by: 'b'.repeat(64), audience: 'stewards' }, 'help', '');
}

test('a reply nobody acknowledged is UNCONFIRMED, not a failure to send', async () => {
  const r = await lift({ mode: 'unconfirmed' })();
  assert.equal(r.ok, false, 're-anchor: an unacknowledged reply was reported as delivered');
  assert.equal(r.reason, 'unconfirmed',
    'A SAFETY REPLY THAT MAY HAVE LANDED IS REPORTED AS A FLAT FAILURE. Someone who tapped "I need help" is ' +
    'told nobody knows, while their church already has it. Got: ' + JSON.stringify(r));
});

test('…and a relay that REFUSED it still says so plainly', async () => {
  const r = await lift({ mode: 'refused' })();
  assert.equal(r.reason, 'refused',
    'a settled refusal was softened into "it may well have arrived" — nobody has this reply and nobody is coming');
});

test('…and a reply that never left the phone says THAT', async () => {
  const r = await lift({ mode: 'not-sent' })();
  assert.equal(r.reason, 'not-sent', 'no socket was opened and the member was told it may have been received');
});

test('a delivered reply still reports delivery, and still reports a NARROW one', async () => {
  const ok = await lift({ mode: 'ok' })();
  assert.equal(ok.ok, true, 're-anchor: a delivered safety reply no longer reports success');
  assert.equal(ok.narrowed, false, 'a full delivery was reported as narrowed');
  const nar = await lift({ mode: 'narrow' })();
  assert.equal(nar.ok, true, 'a narrowed delivery is still a delivery');
  assert.equal(nar.narrowed, true,
    'THE NARROW CASE IS LOST. It reached the church leader but not the team it was addressed to, and saying ' +
    'so is the whole point — what this replaced reported a full delivery that never happened.');
});

// ── THE CALLERS, AND THE INVERSION THIS SHAPE EXISTS TO PREVENT ─────────────────────────────────────────
// CLAUDE.md rule 2. This is a text scan of app/*.jsx, which rule 3 forbids for asserting BEHAVIOUR — and it
// is not doing that. It is enumerating CALL SITES and checking none of them truth-tests the result, which is
// a property of the source text itself. A disabled `false && markSafe(...)` would still be counted, which is
// the safe direction: it would fail this test, not pass it.
test('every caller reads .ok — truth-testing the result would mark a member safe over a failed send', () => {
  // ⚠ SCAN EVERY SCREEN, NOT JUST THIS ONE. The first version read app/screens-today.jsx alone, so the
  // auditor added a third caller to app/screens-serving.jsx — which renders <SafetyBanner persistent /> —
  // that recorded a member as having answered over a FAILED send, and all 16 tests stayed green. That is the
  // exact inversion the object shape exists to prevent, invisible to the guard written to prevent it.
  const FILES = readdirSync(APP_DIR).filter(f => f.endsWith('.jsx'));
  const sites = [];
  for (const f of FILES) {
    const src = stripComments(readFileSync(APP_DIR + f, 'utf8'));
    for (const m of src.matchAll(/(\w+)\s*=\s*await window\.Fellowship\.markSafe\(/g)) sites.push({ f, v: m[1], src });
    // …and the shape that dodges an assignment entirely.
    assert.ok(!/\(\s*await\s+window\.Fellowship\.markSafe\([^)]*\)\s*\)\s*\./.test(src),
      f + ' calls markSafe inline and reads a property off it — assign it, so the caller scan below can see it');
  }
  assert.equal(sites.length, 2,
    'the number of markSafe call sites changed (' + sites.length + '). Every one must read `.ok`; a new one ' +
    'that says `if (res)` records a member as having answered when nothing was confirmed.');
  for (const { f, v, src } of sites) {
    assert.ok(!new RegExp('if\\s*\\(\\s*' + v + '\\s*\\)').test(src),
      f + ': a caller truth-tests the markSafe result (`if (' + v + ')`). The result is an OBJECT and always ' +
      'truthy, so a failed send would take the success arm: safetyAck fires and the member is recorded as ' +
      'having answered. That is worse than the bug this shape was introduced to fix.');
    assert.ok(new RegExp(v + '\\s*&&\\s*' + v + '\\.ok').test(src),
      f + ': a caller does not check `' + v + '.ok` — it must, or delivery is never actually confirmed');
  }
});

// ── THE POINT OF USE: what the member is actually TOLD ──────────────────────────────────────────────────
// CLAUDE.md rule 1. The engine tests above prove markSafe answers four ways; this proves the two screens act
// on it. Delete either branch and every engine test stays green — which is exactly what happened on the
// first sabotage run of this fix ("the dock drops the unconfirmed wording" came back BLIND).
//
// ⚠ TWO `const respond = async (s) => {` EXIST IN THIS FILE, so each component is sliced FIRST and its
// handler taken from inside — the mis-aimed-slice trap CLAUDE.md names, which has bitten this repo four times.
function respondOf(component) {
  const comp = fnBody(TODAY, 'function ' + component + '(', component);
  assert.equal((comp.match(/const respond = async \(s\) => \{/g) || []).length, 1,
    component + ' no longer has exactly one respond handler — re-anchor rather than guessing');
  const seen = { err: '', answered: null, acked: [], narrow: false, status: null, collapsed: null };
  const scope = {
    sending: false, setSending: () => {},
    setErr: (m) => { seen.err = String(m || ''); },
    setAnswered: (v) => { seen.answered = v; },
    setStatus: (v) => { seen.status = v; },
    setCollapsed: (v) => { seen.collapsed = v; },
    setNarrow: (v) => { seen.narrow = !!v; },
    safetyAck: (id, s) => seen.acked.push([id, s]),
    check: { id: 'chk1', by: 'b'.repeat(64) }, note: '',
    window: { Fellowship: { markSafe: async () => scope.__res } },
    __res: null,
    String, JSON, Date, Math, Number, Array, Object, Boolean, RegExp, console, Promise,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError(component + '.respond needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const fn = new Function('scope', 'with (scope) { ' + fnBody(comp, 'const respond = async (s) => {', component + '.respond') + '\nreturn respond; }')(proxy);
  return async (res) => { scope.__res = res; seen.err = ''; await fn('help'); return seen; };
}

for (const component of ['SafetyDock', 'SafetyBanner']) {
  test(component + ': an UNCONFIRMED reply is not reported as a failure to send', async () => {
    const seen = await respondOf(component)({ ok: false, narrowed: false, reason: 'unconfirmed' });
    assert.ok(!/Couldn’t send/i.test(seen.err),
      'A MEMBER WHO MAY ALREADY HAVE REACHED THEIR CHURCH IS TOLD THE SEND FAILED. On "I need help" that is ' +
      'the worst this screen can be wrong. Shown: ' + seen.err);
    assert.match(seen.err, /couldn’t confirm/i, 'nothing on screen says what actually happened: ' + seen.err);
    assert.deepEqual(seen.acked, [],
      'the reply was recorded as answered over a send nobody confirmed — the member would never be asked again');
  });

  test(component + ': a REFUSED reply still says it failed, plainly', async () => {
    const seen = await respondOf(component)({ ok: false, narrowed: false, reason: 'refused' });
    assert.match(seen.err, /Couldn’t send/i,
      'a settled refusal was softened into "it may well have arrived". Nobody has this reply. Shown: ' + seen.err);
    assert.deepEqual(seen.acked, [], 'a refused reply was recorded as answered');
  });

  test(component + ': a delivered reply is recorded, and a NARROW one says so', async () => {
    const ok = await respondOf(component)({ ok: true, narrowed: false, reason: '' });
    assert.equal(ok.err, '', 're-anchor: a delivered reply showed an error');
    assert.equal(ok.acked.length, 1, 're-anchor: a delivered reply was not recorded');
    assert.equal(ok.narrow, false, 'a full delivery was reported as narrowed');
    const nar = await respondOf(component)({ ok: true, narrowed: true, reason: '' });
    assert.equal(nar.narrow, true,
      'THE NARROW CASE IS NOT SHOWN. It reached the church leader but not the team it was addressed to, and ' +
      'what this replaced reported a full delivery that never happened.');
  });
}

// ── ⚠ THE POINT-OF-USE GAP THAT IS STILL OPEN ──────────────────────────────────────────────────────────
// Audit of bcf1b67, 2026-09-15, and it is NOT closed. The tests above lift `respond` and assert `setErr`
// was CALLED. That is the handler, not the screen. The auditor proved the difference by deleting the dock's
// ENTIRE error display — `{err ? <div…>{err}</div> : null}` → `{null}` — and running the suite:
//
//     114 tests across 12 files GREEN, including all 11 in this file.
//
// A member would get no feedback on any failed safety reply, of any kind, and nothing goes red. That is a
// rule-1 failure in the file whose subject is rule 1.
//
// IT ALSO HID A REAL DEFECT FOR TWO COMMITS, now fixed in app/screens-today.jsx: `SafetyBanner` returns
// early once `status` is set, and `err` was rendered only BELOW that return — so a member who had said
// "I'm safe" and then tapped "I need help instead" over a failed send saw NOTHING, while the screen still
// read "You told your church you're safe." Both answered arms render `err` now.
//
// WHAT IS NEEDED: a test that DRAWS the tree through scripts/render-jsx-screen.mjs and asserts the wording
// is in it. The acceptance criterion is exactly the auditor's sabotage above — it must go red.
// I attempted this and could not stand the fixture up in the time available: SafetyBanner takes its check
// from `subscribeSafetyCheck` (a subscription, not a prop) and its effect body is wrapped in try/catch, so
// a single missing global leaves `check` null and the component renders nothing — silently. The auditor DID
// get it to render, so it is a missing stub, not a limitation. Start from the probe in
// scripts/a-care-action-that-failed-says-so-on-screen.test.mjs, which drives this same screen file.
