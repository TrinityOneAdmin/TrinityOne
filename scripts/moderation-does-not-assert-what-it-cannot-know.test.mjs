// "IT'S STILL VISIBLE TO THE GROUP" AND "YOU'RE STILL A MEMBER THERE" ARE CLAIMS ABOUT THE WORLD.
// Run: node --test scripts/moderation-does-not-assert-what-it-cannot-know.test.mjs
//
// Five writers, one shape: `evt` on success, a single flat `null` on every failure. The publish behind them
// rejects when a relay REFUSED and when nobody acknowledged inside the ack window, and the second is not a
// verdict — the event is signed, on the wire, and usually lands a moment later. Every one of these five then
// turned that one `null` into a sentence asserting a state nobody had measured:
//
//   · pinPost / unpin / hideMessage — "Couldn't remove that — IT'S STILL VISIBLE TO THE GROUP." A leader who
//     has just hidden a child's phone number is told the whole group can still see it. He leaves it up, or
//     removes it a second time and cannot tell that the second attempt was a no-op.
//   · unhideMessage — no caller in app/ (app/stew-dashboard.jsx calls window.Steward's own implementation),
//     changed with its three siblings so the next caller written does not inherit the lie.
//   · leaveMembership — "you're still a member there", said to someone whose church has already dropped them.
//     False in the one direction that matters, on the one screen where being wrong about it is the point.
//
// All five write ONE REPLACEABLE DOCUMENT at a fixed d-tag, so doing it twice is a no-op — proved below. That
// makes this a WORDING fix and nothing more: nothing here retries, and nothing should. A shared "retry when
// unconfirmed" helper wrapped round every writer in that file would be wrong, because four writers there are
// NOT idempotent and setEventRsvp is a TOGGLE whose retry publishes the opposite of what the member asked
// for (see an-rsvp-must-not-be-reversed-by-a-slow-relay.test.mjs). `_pubReason` is the shared piece, and it
// already existed; the SENTENCE stays with each writer, because what to say depends on what the doc means.
//
// The rendered point-of-use half lives in moderation-shows-its-work.test.mjs, where the ChatRoom harness is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// ── the four moderation writers, lifted from the shipped bundle and run ─────────────────────────────────
// ⚠ EACH IS SLICED BY ITS OWN FULL SIGNATURE. They are four near-identical siblings — this repo's house
// style, and the reason CLAUDE.md has a section about mis-aimed slices. `hideMessage` alone would also match
// inside `unhideMessage`'s name, so the anchors carry their parameter lists.
const MOD = {
  pinPost: ['async pinPost(churchNpub, groupId, msg)', ['npub1c', 'g1', { id: 'm1', text: 'hi' }]],
  unpin: ['async unpin(churchNpub, groupId)', ['npub1c', 'g1']],
  hideMessage: ['async hideMessage(churchNpub, groupId, msgId)', ['npub1c', 'g1', 'm1']],
  unhideMessage: ['async unhideMessage(churchNpub, groupId, msgId)', ['npub1c', 'g1', 'm1']],
};

function modWriter(name, mode) {
  const [sig] = MOD[name];
  const published = [];
  const scope = {
    sk: 'a'.repeat(64),
    window: { Fellowship: { ready: Promise.resolve(), relays: ['wss://x/relay'] } },
    toPub: (x) => (x ? 'c'.repeat(64) : null),
    NET: 'trinityone',
    _monotonicF: (e) => e,
    finalizeEvent2: (t) => ({ ...t, id: 'evt-' + published.length, sig: 'sig' }),
    _publishBounded: async (_r, e) => {
      published.push(e);
      if (mode === 'ok') return true;
      const err = new Error(mode === 'refused' ? 'blocked: not a leader' : 'no relay acknowledged');
      if (mode === 'refused') err.refused = true;
      if (mode === 'not-sent') err.unsent = true;
      throw err;
    },
    _pubReason: new Function(fnBody(SHIP, 'function _pubReason(e)', '_pubReason') + '\nreturn _pubReason;')(),
    String, JSON, Date, Math, Number, Array, Object, Boolean, console, Promise,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped ' + name + ' needs a stub for ' + String(k)); },
  });
  const fn = new Function('scope', 'with (scope) { return ({ ' + fnBody(SHIP, sig, name) + ' }); }')(proxy)[name];
  return { run: () => fn(...MOD[name][1]), published };
}

for (const name of Object.keys(MOD)) {
  test(name + ': a slow relay is reported as unconfirmed, not as "nothing happened"', async () => {
    for (const [mode, reason] of [['unconfirmed', 'unconfirmed'], ['refused', 'refused'], ['not-sent', 'not-sent']]) {
      const r = await modWriter(name, mode).run();
      assert.equal(r.ok, false, name + '/' + mode + ': a publish nobody confirmed was reported as done');
      assert.equal(r.reason, reason,
        name + '/' + mode + ': the room cannot tell a refusal from a slow relay, so it must use one sentence ' +
        'for both — and the one it used asserts a state only a refusal proves. Got: ' + JSON.stringify(r));
      assert.equal(r.evt, undefined, name + ': the event came back on a failure, which reads as a send');
    }
  });

  test('CONTROL: ' + name + ' still reports success, and still hands back its event', async () => {
    const w = modWriter(name, 'ok');
    const r = await w.run();
    assert.equal(r.ok, true, 're-anchor: ' + name + ' no longer reports a successful publish as one');
    assert.equal(r.evt.kind, 30078, 're-anchor: ' + name + ' no longer returns its event');
    assert.equal(w.published.length, 1, name + ' did not publish anything at all');
  });

  test(name + ' is IDEMPOTENT, which is why this fix adds no retry and needs none', async () => {
    const w = modWriter(name, 'ok');
    await w.run(); await w.run();
    const ds = w.published.map(e => (e.tags.find(t => t[0] === 'd') || [])[1]);
    assert.equal(ds.length, 2);
    assert.equal(ds[0], ds[1],
      name + ' no longer writes a FIXED d-tag, so doing it twice would leave two documents rather than ' +
      'replacing one — and every "you can do it again" sentence in the room would become unsafe');
    assert.ok(ds[0], name + ' writes no d-tag at all — the doc is not replaceable');
  });
}

// ── leaveMembership ─────────────────────────────────────────────────────────────────────────────────────
function leaveWriter(mode, { locked = false, intent = false } = {}) {
  const published = [];
  const scope = {
    sk: locked ? null : 'a'.repeat(64),
    window: { Fellowship: { ready: Promise.resolve(), relays: ['wss://x/relay'] } },
    toPub: (x) => (x ? 'c'.repeat(64) : null),
    NET: 'trinityone',
    finalizeEvent2: (t) => ({ ...t, id: 'evt-' + published.length, sig: 'sig' }),
    _joinSent: {},
    _joinIntents: intent ? [{ cp: 'c'.repeat(64), forPub: 'p', at: 1 }] : [],
    _dropJoinIntent: () => {},
    _clearJoinSent: () => {},
    _publishAny: async (_r, e) => {
      published.push(e);
      if (mode === 'ok') return true;
      const err = new Error(mode === 'refused' ? 'blocked: not a member' : 'no relay acknowledged');
      if (mode === 'refused') err.refused = true;
      if (mode === 'not-sent') err.unsent = true;
      throw err;
    },
    _pubReason: new Function(fnBody(SHIP, 'function _pubReason(e)', '_pubReason') + '\nreturn _pubReason;')(),
    String, JSON, Date, Math, Number, Array, Object, Boolean, console, Promise,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped leaveMembership needs a stub for ' + String(k)); },
  });
  const fn = new Function('scope', 'with (scope) { return ({ ' +
    fnBody(SHIP, 'async leaveMembership(npubOrHex)', 'leaveMembership') + ' }); }')(proxy).leaveMembership;
  return { run: () => fn('npub1church'), published };
}

test('leaveMembership says WHICH failure — the church may already have dropped them', async () => {
  for (const [mode, reason] of [['unconfirmed', 'unconfirmed'], ['refused', 'refused'], ['not-sent', 'not-sent']]) {
    const r = await leaveWriter(mode).run();
    assert.equal(r.ok, false, mode + ': a leave nobody confirmed was reported as done');
    assert.equal(r.reason, reason,
      mode + ': every failure looked the same, so the screen said "you\'re still a member there" over a ' +
      'tombstone the church had already honoured. Got: ' + JSON.stringify(r));
  }
});

test('CONTROL: a leave a relay accepted still reports success and its event', async () => {
  const r = await leaveWriter('ok').run();
  assert.equal(r.ok, true, 're-anchor: a leave that landed no longer reports success');
  assert.equal(r.evt.kind, 30078);
});

test('EVERY return is an object — a bare `return;` here would read as a failure with no reason', async () => {
  // Both keyless paths used to answer `undefined`, and leaveChurch's `if (!told)` made that the plain
  // "you're still a member there" sentence. Keeping them objects means the caller has exactly one contract.
  const noKey = await leaveWriter('ok', { locked: true }).run();
  assert.equal(noKey.ok, false, 'a PIN-locked phone cannot tombstone anything, and said it had');
  assert.equal(noKey.reason, 'not-sent', 'got: ' + JSON.stringify(noKey));
  // …except the one case where there is nothing at the church to leave: an intent that was never sent.
  const onlyIntent = await leaveWriter('ok', { locked: true, intent: true }).run();
  assert.equal(onlyIntent.ok, true,
    'leaveChurch would refuse ("still a member there") over a join request that was never sent — the phone ' +
    'was locked when they asked, so no relay has ever heard of them');
  assert.equal(onlyIntent.local, true, 'the local-only marker is gone; join-while-locked.test.mjs reads it');
});

test('the tombstone is a replaceable doc at a fixed d-tag, so leaving twice is a no-op', async () => {
  const w = leaveWriter('ok');
  await w.run(); await w.run();
  const ds = w.published.map(e => (e.tags.find(t => t[0] === 'd') || [])[1]);
  assert.equal(ds[0], ds[1]);
  assert.match(ds[0], /^trinityone\/member:/,
    'the leave no longer replaces the membership doc — "try again in a moment" would stop being safe');
});

// ── THE POINT OF USE: leaveChurch, LIFTED OUT OF app/app.jsx AND RUN ────────────────────────────────────
// CLAUDE.md rules 1 and 3. app/*.jsx ships unbundled, so no text match on this file can tell a live branch
// from a dead one. The function is lifted and driven, and the assertions read what it did.
function leaveScreen(result) {
  const toasts = [];
  const scope = {
    churches: [{ id: 'npub1church', npub: 'npub1church' }, { id: 'npub1other', npub: 'npub1other' }],
    activeChurch: 'npub1church',
    setChurches: (v) => { scope.churches = v; },
    setActiveChurch: () => {},
    lsSet: () => {},
    toast: (m, o) => toasts.push(String(m)),
    window: { Fellowship: { leaveMembership: async () => { if (result instanceof Error) throw result; return result; } } },
    String, JSON, Date, Math, Number, Array, Object, Boolean, console, Promise,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped leaveChurch needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const fn = new Function('scope', 'with (scope) { ' +
    fnBody(APP, 'const leaveChurch = async (npub) =>', 'leaveChurch') + '\nreturn leaveChurch; }')(proxy);
  return { run: () => fn('npub1church'), toasts, scope };
}

test('leaveChurch: an unconfirmed leave does not tell them they are still a member', async () => {
  const s = leaveScreen({ ok: false, reason: 'unconfirmed' });
  const out = await s.run();
  assert.equal(out, false, 're-anchor: an unconfirmed leave was treated as a completed one');
  assert.equal(s.toasts.length, 1, 'they were told nothing');
  assert.ok(!/still a member there/.test(s.toasts[0]),
    'SOMEONE WHOSE CHURCH HAS ALREADY DROPPED THEM IS TOLD THEY ARE STILL IN IT. The tombstone is signed and ' +
    'on the wire; only the acknowledgement was late. Shown: ' + s.toasts[0]);
  assert.match(s.toasts[0], /couldn’t confirm/i, 'nothing says what happened: ' + s.toasts[0]);
  assert.equal(s.scope.churches.length, 2,
    'the church was dropped from the phone over a leave nobody confirmed — the optimism audit #6 removed');
});

test('leaveChurch: a REFUSED or unsent leave still says "you’re still a member there", plainly', async () => {
  for (const res of [{ ok: false, reason: 'refused' }, { ok: false, reason: 'not-sent' }, null, new Error('boom')]) {
    const s = leaveScreen(res);
    assert.equal(await s.run(), false, JSON.stringify(res) + ': a failure was treated as a completed leave');
    assert.match(s.toasts[0], /still a member there/,
      'a settled failure was softened into "it may well have been" — nobody has this tombstone. Shown: ' + s.toasts[0]);
  }
});

test('leaveChurch: a leave that LANDED still drops the church and says so', async () => {
  const s = leaveScreen({ ok: true, evt: { kind: 30078 } });
  assert.equal(await s.run(), true, 're-anchor: a successful leave no longer reports success');
  assert.deepEqual(s.scope.churches.map(c => c.id), ['npub1other'],
    'they left and the church is still on the phone');
  assert.ok(s.toasts.some(t => /left the church/i.test(t)), 'nothing confirmed the leave: ' + JSON.stringify(s.toasts));
});

test('leaveChurch: a FAILURE OBJECT is not mistaken for a success', async () => {
  // The inversion this shape exists to prevent. leaveMembership answers with an object now and every object
  // is truthy, so a caller that kept `if (!told)` would drop the church from the phone on every failure —
  // exactly the optimism audit #6 removed, reintroduced by a change meant to improve the wording.
  const s = leaveScreen({ ok: false, reason: 'unconfirmed' });
  await s.run();
  assert.equal(s.scope.churches.length, 2,
    'leaveChurch TRUTH-TESTS the result. The member believes they have left while the church\'s records, its ' +
    'rota and its directory still have them, and nothing on either side will ever correct it.');
});

// ── THE CALLERS (CLAUDE.md rule 2), enumerated rather than trusted ──────────────────────────────────────
// A text scan, which rule 3 forbids for asserting BEHAVIOUR — and this is not that. It counts CALL SITES and
// checks none truth-tests the result, which is a property of the source text. A dead `false && …` call would
// still be counted, which is the safe direction: it fails this test rather than passing it.
test('the moderation writers have exactly the callers this fix looked at', () => {
  const CHAT = stripComments(readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8'));
  const ALL = ['app/app.jsx', 'app/screens-chat.jsx', 'app/screens-church.jsx', 'app/screens-serving.jsx',
               'app/screens-today.jsx', 'app/identity.jsx', 'app/stew-dashboard.jsx', 'app/ui.jsx']
    .map(f => { try { return readFileSync(new URL('../' + f, import.meta.url), 'utf8'); } catch { return ''; } })
    .join('\n');
  for (const [name, n] of [['pinPost', 1], ['unpin', 1], ['hideMessage', 1], ['unhideMessage', 0]]) {
    const hits = [...stripComments(ALL).matchAll(new RegExp('Fellowship\\.' + name + '\\(', 'g'))].length;
    assert.equal(hits, n,
      'window.Fellowship.' + name + ' has ' + hits + ' call sites in app/, not ' + n + '. Every one must read ' +
      '`.ok`: the result is an object and always truthy, so a new caller that truth-tests it announces ' +
      'success over a publish that failed. (The console\'s pin/unpin/hide are window.Steward\'s own ' +
      'implementations in src/steward.src.js and do not come through here.)');
  }
  assert.match(CHAT, /_moderated\(/, 'the moderation controls no longer go through _moderated — re-anchor');
  assert.ok(!/\.then\(evt => finish\(evt \?/.test(CHAT),
    '_moderated truth-tests the result again. Every failure is an object, every object is truthy, so the ' +
    'leader is told an abusive post was removed when it was not.');
});

test('leaveMembership has exactly one caller, and it reads .ok', () => {
  const src = stripComments(APP);
  const hits = [...src.matchAll(/(\w+)\s*=\s*await F\.leaveMembership\(/g)].map(m => m[1]);
  assert.equal(hits.length, 1, 'the number of leaveMembership call sites changed (' + hits.length + ')');
  const body = stripComments(fnBody(APP, 'const leaveChurch = async (npub) =>', 'leaveChurch'));
  assert.ok(!new RegExp('if\\s*\\(\\s*!?\\s*' + hits[0] + '\\s*\\)').test(body),
    'leaveChurch truth-tests the leaveMembership result. It is an object and always truthy, so a failure ' +
    'would take the success arm and the church would be dropped from the phone over nothing.');
  assert.ok(new RegExp(hits[0] + '\\s*&&\\s*' + hits[0] + '\\.ok').test(body),
    'leaveChurch does not check `.ok` — the leave is never actually confirmed');
});
