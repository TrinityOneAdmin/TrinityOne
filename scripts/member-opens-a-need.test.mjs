// A MEMBER MAY OPEN A CARE NEED — AND A CHILD MAY NEVER.
// Run: node --test scripts/member-opens-a-need.test.mjs
//
// SWEEP DEFECT 1. The church setting `openedBy: 'member'` did nothing. Everything behind it was already
// built — the relay accepts a non-minor member's `care:` write when the church allows it (gateway.mjs, the
// NEED_D branch: "children never open needs"), and the care key reaches every member for exactly this
// purpose — but no control ever called it, so a church could switch the setting on and no member could tell.
//
// The dangerous half is not the publishing, it is WHO. A request is private to the care team; a NEED is
// public to the church, or to the care team, depending on the church's own visibility setting. So the
// safeguarding question publishCareRequest asks is asked again here, read the same way, and never taken from
// the screen — a screen is not a boundary. Three answers, and the third is not the second:
//
//   · a child                  — never opens a need, at all
//   · an adult                 — opens one
//   · WE HAVE NOT HEARD YET    — is not "adult". Refuse, and let the caller send a private request instead.
//
// This runs the shipped function. It does not read it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// Brace-matched and quote/comment aware, so a string containing a brace cannot cut the body in half.
function grabMethod(src, sig) {
  const at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test, do not delete it');
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

const BODY = grabMethod(SRC, 'async publishCareNeed(fields)');
// The safeguarding guard lives at module scope and is lifted WITH the publisher, so these tests drive the
// real decision rather than a stub of it — that decision is the entire reason this file exists.
const GUARD = (() => {
  const m = /\n  async function _careNeedRefusal\(cp\)[\s\S]*?\n  \}/.exec(SRC);
  assert.ok(m, 'could not lift _careNeedRefusal — re-anchor this test, do not delete it');
  return m[0];
})();
// esbuild renumbers the nostr-tools import. Bind whatever the body actually calls, so a rebuild that renames
// it fails loudly here rather than silently testing nothing.
const FE = (BODY.match(/\bfinalizeEvent\d*\b/) || [])[0];
assert.ok(FE, 'publishCareNeed no longer signs an event — re-anchor this test');

const CHURCH = 'c'.repeat(64);
const ME = 'a'.repeat(64);

// `cleared` is what the church's cleared-adults list answers: [] = this church does not use safeguarding,
// a non-empty list = it does, null = we could not even ask.
function member({ isMinor = false, known = true, cpKnown = true, cleared = [], careKey = true } = {}) {
  const state = { published: [], sealed: null };
  const scope = {
    sk: 'my-key', pub: ME,
    profiles: { [ME]: { name: 'Verity' } },
    _sgSelf: { cp: cpKnown ? CHURCH : 'other-church', isMinor, known },
    _fetchChildCareAudience: async () => cleared,
    _carekeys: careKey ? { [CHURCH]: [new Uint8Array(32)] } : {},
    _careSeal: (cp, body) => { state.sealed = { cp, body }; return 'SEALED-BLOB'; },
    _hex: (b) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''),
    _publishAny: async (_relays, evt) => { state.published.push(evt); },
    churchRelays: () => ['wss://test.invalid'],
    CARE_D: 'trinityone/care:', NET: 'trinityone',
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 7 + 3) & 255; return a; } },
    [FE]: (tmpl) => ({ ...tmpl, pubkey: ME, id: 'evt' }),
    console: { warn() {} },
    window: { Fellowship: { churchPub: CHURCH, ready: Promise.resolve() } },
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, `${GUARD}\nreturn ({ ${BODY} }).publishCareNeed;`)(...args.map(k => scope[k]));
  return { call: (f) => fn(f), state };
}

const ADULT = { types: ['meals'], forSelf: true, note: 'Baby arrived early', dates: ['2026-09-01', '2026-09-03'] };
const tag = (e, k) => (e.tags.find(t => t[0] === k) || [])[1];

test('a child never opens a need, whatever the screen sent', () => {
  const m = member({ isMinor: true });
  return m.call(ADULT).then(r => {
    assert.equal(r.error, 'minor-cannot-open');
    assert.deepEqual(m.state.published, [], 'a child’s situation was published to the church');
  });
});

test('"we have not heard yet" is not "adult" when the church uses safeguarding', () => {
  // The church has cleared somebody, so safeguarding is in use here and this member's status is unknown.
  const m = member({ known: false, cleared: ['someone-cleared'] });
  return m.call(ADULT).then(r => {
    assert.equal(r.error, 'unknown-clearance');
    assert.deepEqual(m.state.published, [], 'a need was opened for someone we could not confirm is an adult');
  });
});

test('…and a member of another church is exactly that case', () => {
  // _sgSelf names a DIFFERENT church, which is the gap the request path had to close: it guarded only the
  // case where the cache already named THIS church, so anyone in two congregations walked straight past.
  const m = member({ cpKnown: false, cleared: ['someone-cleared'] });
  return m.call(ADULT).then(r => assert.equal(r.error, 'unknown-clearance'));
});

test('a church that has cleared nobody is not blocked from opening needs', () => {
  // Refusing on an absent clearance alone would stop every adult in every church that has never used
  // safeguarding — a far larger harm than the one being prevented.
  const m = member({ known: false, cleared: [] });
  return m.call(ADULT).then(r => {
    assert.ok(r && r.need, 'an ordinary adult was refused: ' + JSON.stringify(r));
    assert.equal(m.state.published.length, 1);
  });
});

test('an adult opens a need, and it is a real care document', () => {
  const m = member();
  return m.call(ADULT).then(r => {
    assert.ok(r.need && r.id, 'no need came back');
    const e = m.state.published[0];
    assert.equal(e.kind, 30078);
    assert.ok(tag(e, 'd').startsWith('trinityone/care:'), 'not filed as a care need');
    assert.equal(tag(e, 'church'), CHURCH, 'the church is not named, so the relay cannot resolve the owner');
    assert.equal(tag(e, 'enc'), 'care1', 'not marked as sealed');
    const body = JSON.parse(e.content);
    assert.deepEqual(body.dates, ['2026-09-01', '2026-09-03']);
    assert.equal(body.startDate, '2026-09-01');
    assert.equal(body.endDate, '2026-09-03');
  });
});

test('the id carries no owner prefix, which the relay would refuse', () => {
  // gateway.mjs idOwnerOk reads `<hex8-64>-` as "this church owns it". The author here is a MEMBER and the
  // named church is the church, so an asker-prefixed id — the shape carereq: uses — would be rejected.
  const m = member();
  return m.call(ADULT).then(() => {
    const id = tag(m.state.published[0], 'd').slice('trinityone/care:'.length);
    assert.ok(!/^[0-9a-f]{8,64}-/.test(id), 'the id names an owner, so the relay will refuse this need: ' + id);
  });
});

test('what the member typed is sealed, never published in the clear', () => {
  const m = member();
  return m.call(ADULT).then(() => {
    const raw = m.state.published[0].content;
    assert.ok(!raw.includes('Baby arrived early'), 'the note went out in cleartext');
    assert.ok(!raw.includes('Verity'), 'the name went out in cleartext');
    assert.equal(m.state.sealed.body.notes, 'Baby arrived early');
    assert.equal(m.state.sealed.body.displayLabel, 'Verity');
    assert.equal(m.state.sealed.cp, CHURCH);
  });
});

test('opening one for someone else names them, and does not claim it is for me', () => {
  const m = member();
  return m.call({ ...ADULT, forSelf: false, forName: 'Margaret' }).then(() => {
    assert.equal(m.state.sealed.body.displayLabel, 'Margaret');
    assert.equal(m.state.sealed.body.recipient, '',
      'a need opened for someone else claimed the opener as its recipient — they would get the skip controls');
  });
});

test('a need with no days is refused — nobody could sign up to it', () => {
  const m = member();
  return m.call({ ...ADULT, dates: [] }).then(r => {
    assert.equal(r.error, 'no-dates');
    assert.deepEqual(m.state.published, []);
  });
});

test('dietary and meals are carried for meals, and dropped for anything else', () => {
  const m = member();
  return m.call({ ...ADULT, meals: ['lunch'], dietary: ['Nut-free'] }).then(() => {
    assert.deepEqual(JSON.parse(m.state.published[0].content).meals, ['lunch']);
    assert.deepEqual(m.state.sealed.body.dietary, ['Nut-free']);
    const m2 = member();
    return m2.call({ ...ADULT, types: ['rides'], meals: ['lunch'], dietary: ['Nut-free'] }).then(() => {
      assert.deepEqual(JSON.parse(m2.state.published[0].content).meals, [], 'a lift carried a meal list');
      assert.deepEqual(m2.state.sealed.body.dietary, [], 'a lift carried dietary needs');
    });
  });
});

test('without the church’s care key it refuses rather than publishing something unreadable', () => {
  const m = member({ careKey: false });
  return m.call(ADULT).then(r => {
    assert.equal(r.error, 'no-care-key');
    assert.deepEqual(m.state.published, []);
  });
});

// ── the screen half: it must ask for a need only when the church allows it, and never instead of asking ──
// The sheet's own submit(), lifted and RUN. A test that greps for `publishCareNeed` passes against a call
// that is never reached — and the case that matters most here is the one where it is reached and REFUSES.
const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');

function grabArrow(src, sig) {
  const at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' has moved — re-anchor this test, do not delete it');
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}
// SCOPED TO THE SHEET. There are two `const submit = async () => {` in this file and the other one comes
// first, so an unscoped grab silently tested a different component — it only surfaced here because that one
// happens to reference a name we do not stub. Anchor from AskForHelpForm's own declaration.
const FORM_AT = TODAY.indexOf('function AskForHelpForm({ ctx, onClose, onSent })');
assert.ok(FORM_AT > 0, 'AskForHelpForm has moved — re-anchor this test');
const SUBMIT = grabArrow(TODAY.slice(FORM_AT), 'const submit = async () => {');

// The sheet decides this once, at the top, and everything below reads it. Lifted so the four combinations
// are checked against the real expression rather than a restatement of it.
// The church-level half. The engine's half is asked asynchronously and tested through the engine itself;
// what matters here is that the screen still refuses a child and still honours the setting.
const OPENS = /const _churchAllowsNeeds = ([^;]+);/.exec(TODAY);
assert.ok(OPENS, '_churchAllowsNeeds has moved — re-anchor this test');

function opensNeed(ctx, isMinor) {
  return new Function('ctx', '_isMinor', `const _care = ctx.care || {}; return ${OPENS[1]};`)(ctx, isMinor);
}
const settings = (openedBy, visibility = 'all') => ({ care: { settings: { enabled: true, openedBy, visibility } } });

test('the screen never decides on its own — the engine has to agree', () => {
  // The screen used to BE the rule (`!_isMinor && openedBy === 'member'`), which is how a child saw the
  // public-need wording during the boot window. It must now start closed and wait to be told.
  assert.match(TODAY, /const _opensNeed = _churchAllowsNeeds && _engineAllows;/,
    'the sheet decides for itself again, so it can promise what the engine will refuse');
  assert.match(TODAY, /React\.useState\(false\)[\s\S]{0,400}?canOpenCareNeed/,
    'the sheet does not start from the private wording, so it over-promises until the answer arrives');
});

test('the sheet opens a need only when the church says members may, and never for a child', () => {
  assert.equal(opensNeed(settings('member'), false), true, 'the church allows it and an adult still cannot');
  assert.equal(opensNeed(settings('steward'), false), false, 'a need was opened while the church said stewards only');
  assert.equal(opensNeed(settings('member'), true), false, 'A CHILD WAS OFFERED THE PUBLIC NEED PATH');
  assert.equal(opensNeed({}, false), false, 'a church with no care settings at all offered it');
});

function sheet({ opensNeed = true, dates = ['2026-09-01'], needAnswer, teamOnly = false }) {
  const calls = [];
  const scope = {
    types: ['meals'], _opensNeed: opensNeed, dates, _teamOnly: teamOnly,
    forSelf: true, forName: '', when: '', urgency: '', note: 'a note',
    meals: ['dinner'], diet: [],
    // submit() clears the error before it starts; only a REAL message is an event worth recording.
    setErr: (e) => { if (e) calls.push(['err', e]); }, setBusy: () => {},
    onSent: (r) => { calls.push(['sent', r]); },
    CARE_SEND_REFUSAL: {},
    window: { Fellowship: {
      publishCareNeed: async (f) => { calls.push(['need', f]); return needAnswer; },
      publishCareRequest: async (f) => { calls.push(['request', f]); return { id: 'req1', teamCount: 2 }; },
    } },
    console,
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, SUBMIT + '\nreturn submit;')(...args.map(k => scope[k]));
  return { run: () => fn(), calls, kinds: () => calls.map(c => c[0]) };
}

test('when the church allows it, the sheet opens a need and does not also send a request', async () => {
  const s = sheet({ needAnswer: { id: 'care1', need: true } });
  await s.run();
  assert.deepEqual(s.kinds(), ['need', 'sent']);
  const sent = s.calls.find(c => c[0] === 'sent')[1];
  assert.ok(sent.need, 'the confirmation will not say a need was opened');
});

test('a refusal falls back to the private request — it never leaves the member with nothing', async () => {
  // publishCareNeed refuses when it cannot confirm this member is an adult. The member still asked for help;
  // the ask must still arrive, by the route that was always safe.
  for (const why of ['minor-cannot-open', 'unknown-clearance', 'no-care-key']) {
    const s = sheet({ needAnswer: { error: why } });
    await s.run();
    assert.deepEqual(s.kinds(), ['need', 'request', 'sent'], `no fallback after ${why}`);
  }
});

test('with the setting off, the need path is never even attempted', async () => {
  const s = sheet({ opensNeed: false });
  await s.run();
  assert.deepEqual(s.kinds(), ['request', 'sent']);
});

test('opening a need needs a day, and says so instead of quietly sending a request', async () => {
  const s = sheet({ dates: [], needAnswer: { id: 'care1', need: true } });
  await s.run();
  assert.deepEqual(s.kinds(), ['err'], 'it published something despite having no day to sign up to');
  assert.match(s.calls[0][1], /day/i);
});

test('the confirmation tells the member how public this is', async () => {
  const s = sheet({ needAnswer: { id: 'care1', need: true }, teamOnly: true });
  await s.run();
  assert.equal(s.calls.find(c => c[0] === 'sent')[1].teamOnly, true,
    'a need the whole church can read would be described as care-team-only, or the reverse');
});

// ── AUDIT 2026-08-29 ─────────────────────────────────────────────────────────────────────────────────────
// Two findings the tests above could not see, both confirmed against the shipped bundle by the auditor.

test('a nut allergy survives whichever chip the member tapped first', () => {
  // The sheet asks about meals whenever Meals is AMONG the kinds; the engine kept the answers only when
  // Meals was uniq[0] — the kind tapped first. So Rides-then-Meals discarded a declared allergy while the
  // member watched themselves enter it, and volunteers cooked with nuts.
  const first = member(), second = member();
  return Promise.all([
    first.call({ ...ADULT, types: ['meals', 'rides'], meals: ['lunch'], dietary: ['Nut-free'] }),
    second.call({ ...ADULT, types: ['rides', 'meals'], meals: ['lunch'], dietary: ['Nut-free'] }),
  ]).then(() => {
    for (const [who, m] of [['Meals first', first], ['Rides first', second]]) {
      assert.deepEqual(JSON.parse(m.state.published[0].content).meals, ['lunch'], `${who}: meals dropped`);
      assert.deepEqual(m.state.sealed.body.dietary, ['Nut-free'], `${who}: THE ALLERGY WAS DROPPED`);
    }
  });
});

test('every kind the member picked is published, not just the first', () => {
  const m = member();
  return m.call({ ...ADULT, types: ['meals', 'rides', 'visits'] }).then(() => {
    const body = JSON.parse(m.state.published[0].content);
    assert.deepEqual(body.types, ['meals', 'rides', 'visits'],
      'the need remembers one kind of help, so "Pick as many as you need" was a lie');
    assert.equal(body.type, 'meals', 'the first kind must STAY first — every older reader keys off `type`');
  });
});

test('the console’s own normaliser carries the kinds through', () => {
  // Both need re-maps build a NEW object from an explicit field list, so anything not named is dropped.
  // This one is self-contained, so it can be lifted and run rather than grepped.
  const MEALS_BUNDLE = readFileSync(new URL('../vendor/steward-meals.js', import.meta.url), 'utf8');
  // Brace-matched, not regex-matched: a non-greedy /\n\s*\}/ stops at the first inner closure and hands you
  // half a function, which fails as a syntax error and reads like a broken test.
  const body = grabMethod(MEALS_BUNDLE, 'function _normNeed(n)');
  const norm = new Function(`${body}\nreturn _normNeed;`)();
  const out = norm({ displayLabel: 'The Okonkwos', type: 'meals', types: ['meals', 'rides'], dates: ['2026-09-01'] });
  assert.deepEqual(out.types, ['meals', 'rides'], 'the console re-map drops the kinds on every edit');
  assert.equal(out.type, 'meals');
  const legacy = norm({ displayLabel: 'x', type: 'rides', dates: ['2026-09-01'] });
  assert.deepEqual(legacy.types, ['rides'], 'a need written before `types` existed must still read as its kind');
});
