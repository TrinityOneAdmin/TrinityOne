// "WHO MAY HOLD THE CHECK-IN HELPER KEY" IS ONE QUESTION, ASKED IN ONE PLACE.
// Run: node --test scripts/checkin-role-source.test.mjs
//
// reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md §7, the owner: "Holding the helper key will be a
// rota role, but we may change that to be more specifically a 'safeguarding team' after the pilot." So the
// property under test here is not "the rota works" — it is that the rota is REPLACEABLE, and that replacing it
// is passing a different `source` rather than unpicking the feature.
//
// Everything below executes the shipped module. No mirror of the logic, no restatement of the design: these
// call scripts/checkin-role-source.mjs, which is the same file gateway.mjs imports and the same file esbuild
// bundles into vendor/steward.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HELPER_SOURCES, DEFAULT_HELPER_SOURCE, isDeclaredSource, eligibleHelpers,
  HELPER_LIFETIMES, DEFAULT_HELPER_LIFETIME, isDeclaredLifetime, helperPolicy,
  MAX_SESSION_SECONDS, sessionWindow, lifetimeWindow, windowFault,
  buildHelperGrant, readHelperGrant, grantAdmits, helperKeyFor,
} from './checkin-role-source.mjs';
import { D, DOC_TYPES } from './trinity-doc-types.mjs';

const P = (n) => String(n).padStart(2, '0').repeat(32);   // a distinct, valid 64-hex pubkey per person
const ADA = P(11), BEN = P(22), CHI = P(33), DEE = P(44), EVE = P(55);
const KEY = 'ab'.repeat(32);

// The rota this church actually published: a children's team and a welcome team, on one service.
const rota = () => ({
  service: 'svc-next',
  published: true,
  assign: {
    'kids::lead':    { name: 'Ada Boateng', pub: ADA },
    'kids::helper':  { name: 'Ben Osei', pub: BEN },
    'kids::spare':   { name: 'Nobody With A Phone', pub: '' },   // a real shape: a person the church named, with no app
    'welcome::door': { name: 'Chi Nwosu', pub: CHI },
  },
});

// ── THE SWAP, which is the whole reason this module exists ────────────────────────────────────────────────

test('the rota answers "who may hold this key" — the children\'s team, and nobody else on the rota', () => {
  const got = eligibleHelpers('rota', { rota: rota(), childrenTeams: ['kids'] });
  assert.deepEqual(got.sort(), [ADA, BEN].sort(),
    'the helper set is not exactly the people rostered to the children\'s team for this service');
  assert.ok(!got.includes(CHI),
    'the person on the WELCOME team was handed the children\'s register — being on a rota at all is not the ' +
    'question, being on the children\'s rota is');
});

test('and a named team could answer it instead, with no other change', () => {
  // THIS IS THE TEST THE OWNER'S SENTENCE ASKS FOR. Same function, same signature, same caller; only the
  // source name differs. If moving to a safeguarding team ever required editing anything but this argument,
  // this test is where that would show up as a second call shape.
  const rosters = [{ team: 'sg-team', pubs: [DEE, EVE] }, { team: 'kids', pubs: [ADA] }];
  const got = eligibleHelpers('team', { rosters, teamId: 'sg-team' });
  assert.deepEqual(got.sort(), [DEE, EVE].sort(), 'the named-team source does not resolve its own roster');
  assert.ok(!got.includes(ADA), 'a different team\'s roster leaked into the answer');
});

test('a roster written before names were sealed still resolves — the legacy `people` shape', () => {
  // roster: gained its cleartext `pubs` array on 2026-09-05; a church that has not re-saved a team since then
  // has only `people: [{pub}]`. Without the fallback that church silently staffs nobody, which reads exactly
  // like the feature being broken.
  const rosters = [{ team: 'sg-team', people: [{ id: 'p1', name: 'Dee', pub: DEE }] }];
  assert.deepEqual(eligibleHelpers('team', { rosters, teamId: 'sg-team' }), [DEE]);
});

test('an unknown source resolves to NOBODY, not to everybody', () => {
  // FAIL CLOSED, deliberately against this codebase's other habit. An unknown rota-visibility value falls back
  // to the OPEN setting on purpose (hiding a church's rota over a typo is its own harm). Here the fallback
  // would be handing the children's register to a set nobody chose, so it is the opposite.
  assert.deepEqual(eligibleHelpers('safeguarding-team', { rota: rota(), childrenTeams: ['kids'] }), [],
    'a source name nobody implemented resolved to a non-empty helper set');
  assert.deepEqual(eligibleHelpers(undefined, { rota: rota(), childrenTeams: ['kids'] }), []);
  assert.deepEqual(eligibleHelpers('__proto__', {}), [], 'a prototype key was treated as a declared source');
  assert.equal(isDeclaredSource('__proto__'), false);
  assert.equal(isDeclaredSource(DEFAULT_HELPER_SOURCE), true, 'the default source is not itself declared');
});

// ── WHAT THE ROTA SOURCE MUST REFUSE ──────────────────────────────────────────────────────────────────────

test('a DRAFT rota grants nothing', () => {
  const r = rota(); r.published = false;
  assert.deepEqual(eligibleHelpers('rota', { rota: r, childrenTeams: ['kids'] }), [],
    'an unpublished rota is a steward pencilling names in, and it handed out the children\'s register');
});

test('a church that has named no children\'s team grants nothing', () => {
  assert.deepEqual(eligibleHelpers('rota', { rota: rota(), childrenTeams: [] }), [],
    'with no team named as children\'s work the source guessed, instead of answering "nobody"');
  assert.deepEqual(eligibleHelpers('rota', { rota: rota() }), []);
});

test('a rostered person with no app identity is dropped, not turned into an empty-string helper', () => {
  const got = eligibleHelpers('rota', { rota: rota(), childrenTeams: ['kids'] });
  assert.ok(!got.some(p => !p), 'an empty pub reached the helper list, where it would be wrapped to nothing');
  assert.equal(got.length, 2);
});

test('malformed input produces a shorter list, never a throw', () => {
  // A console mid-edit, a truncated document, a hand-written client. A crash here is a church that cannot
  // staff its creche; a shorter list is a church that staffs it with the people it can prove.
  for (const bad of [null, {}, { published: true }, { published: true, assign: null },
                     { published: true, assign: { 'kids::a': null } },
                     { published: true, assign: { 'kids::a': { pub: 'NOT-HEX' } } },
                     { published: true, assign: { 'kids::a': { pub: ADA.toUpperCase() } } }]) {
    const got = eligibleHelpers('rota', { rota: bad, childrenTeams: ['kids'] });
    assert.ok(Array.isArray(got), 'the source returned something that is not a list for ' + JSON.stringify(bad));
    for (const p of got) assert.match(p, /^[0-9a-f]{64}$/, 'a malformed pubkey survived into the helper list');
  }
  // and an uppercase pubkey is normalised rather than dropped or double-counted
  const dup = { published: true, assign: { 'kids::a': { pub: ADA }, 'kids::b': { pub: ADA } } };
  assert.deepEqual(eligibleHelpers('rota', { rota: dup, childrenTeams: ['kids'] }), [ADA],
    'the same person appeared twice in one grant');
});

// ── THE WINDOW: "access ends when the turn does", made arithmetic ──────────────────────────────────────────

test('a session window is built from the service, and CANNOT be made permanent', () => {
  const w = sessionWindow({ date: '2026-09-13', time: '10:30' }, { before: 45 * 60, after: 3 * 3600 });
  assert.ok(w && w.until > w.from, 'no window was built for an ordinary Sunday service');
  assert.ok(w.until - w.from <= HELPER_LIFETIMES.session.max);
  // asked for a year, given a session
  const greedy = sessionWindow({ date: '2026-09-13', time: '10:30' }, { before: 0, after: 365 * 24 * 3600 });
  assert.equal(greedy.until - greedy.from, HELPER_LIFETIMES.session.max,
    'a caller asked for a year-long "session" and got one — the cap is the entire difference between this ' +
    'capability and a permanent key with a session-shaped name');
});

test('a service the console cannot place produces NO window, never a default one', () => {
  for (const svc of [null, {}, { date: 'next Sunday', time: '10:30' }, { date: '2026-09-13', time: 'morning' }]) {
    for (const life of Object.keys(HELPER_LIFETIMES))
      assert.equal(lifetimeWindow(life, svc, {}), null,
        'a ' + life + ' window was invented for a service nobody can place: ' + JSON.stringify(svc));
  }
});

test('windowFault names every refusal, and says why', () => {
  assert.equal(windowFault(1000, 2000, 'session'), '', 'an ordinary window was refused');
  assert.match(windowFault(2000, 1000, 'session'), /closes before it opens/);
  assert.match(windowFault(1000, 1000, 'session'), /closes before it opens/);
  assert.match(windowFault(1000, 1000 + HELPER_LIFETIMES.session.max + 1, 'session'), /may not exceed/);
  assert.match(windowFault(1000.5, 2000, 'session'), /positive whole unix second/);
  assert.match(windowFault(-5, 2000, 'session'), /positive/);
  assert.match(windowFault(1000, 2000, 'forever'), /unknown lifetime/);
  // AND THE TWO THAT KEEP A LIFETIME FROM BECOMING ANOTHER ONE
  assert.match(windowFault(1000, null, 'session'), /must carry an end/,
    'a session grant with no end was accepted — that is how "access ends when the turn does" becomes permanent');
  assert.match(windowFault(1000, 2000, 'open'), /must not carry an end/,
    'an open-ended grant carrying an end is two policies at once, and nobody can say which one holds');
  assert.equal(windowFault(1000, null, 'open'), '', 'the church\'s own "until a steward ends it" was refused');
  assert.equal(windowFault(1000, 1000 + HELPER_LIFETIMES.day.max, 'day'), '');
  assert.match(windowFault(1000, 1000 + HELPER_LIFETIMES.day.max + 1, 'day'), /may not exceed/);
});

// ── THE GRANT ─────────────────────────────────────────────────────────────────────────────────────────────

const wrap = (p, plaintext) => 'W(' + p.slice(0, 4) + '):' + plaintext;
const unwrapAs = (p) => (ct) => {
  const want = 'W(' + p.slice(0, 4) + '):';
  if (!String(ct).startsWith(want)) throw new Error('not mine');
  return String(ct).slice(want.length);
};

test('the pubkeys the RELAY enforces and the keys that actually OPEN things are built from one list', () => {
  // The defect this shape exists to prevent is named in CAP_KEYS's own comment: "if those two ever disagreed,
  // a rotation would quietly hand the key to someone the mint had excluded". Here the relay compares `pubs`
  // and the crypto uses `keys`, so a divergence is a helper the gate admits and who can open nothing — or,
  // far worse, one who can open everything and whom the gate does not know about.
  const { doc } = buildHelperGrant({ lifetime: 'session', session: 'svc-next', source: 'rota', from: 1000, until: 4000,
    helpers: [ADA, BEN], keepers: [CHI], sessionKeyHex: KEY, wrap });
  assert.deepEqual(doc.pubs.sort(), [ADA, BEN].sort(), 'the enforced list is not the helper list');
  for (const p of doc.pubs) assert.ok(doc.keys[p], 'a helper the relay will admit has no key wrapped to them');
  assert.ok(doc.keys[CHI], 'the church/safeguarding keeper cannot open what a helper writes');
  assert.ok(!doc.pubs.includes(CHI),
    'a KEEPER was written into the enforced helper list — a safeguarding steward\'s authority must come from ' +
    'the steward roster, never from a session grant, or revoking them would leave a grant still admitting them');
});

test('a grant carrying nothing about any child', () => {
  const { doc } = buildHelperGrant({ lifetime: 'session', session: 'svc-next', source: 'rota', from: 1000, until: 4000,
    helpers: [ADA], keepers: [CHI], sessionKeyHex: KEY, wrap });
  // The relay stores this in the clear, and must, because it has to read the window and the list it enforces.
  // So the test that matters is what is NOT in it.
  assert.deepEqual(Object.keys(doc).sort(), ['from', 'keys', 'lifetime', 'pubs', 'session', 'source', 'until'],
    'the cleartext grant grew or lost a field — every one of them is something the relay operator can read');
  // `rev` WAS the eighth field and was removed on 2026-09-09. Named here so that re-adding it has to be a
  // decision somebody makes against this line, rather than a field that quietly reappears: it could not do
  // the same-second job it was added for (event-store.mjs drops that correction before the relay compares
  // anything — 90 of 200 measured), and where it did fire it survived only until the next restart.
  assert.equal(doc.rev, undefined,
    '`rev` is back in the grant. It cannot order two same-second grants — put() rejects the correction by ' +
    'lowest event id before note() runs — and the one case where it fires puts the relay\'s map out of step ' +
    'with its own corpus until a restart resolves it in favour of the STALE grant.');
  assert.doesNotMatch(JSON.stringify(doc), /child|name|room|code|pickup/i,
    'the cleartext grant carries something about a child — it must be a session id, two timestamps, a source ' +
    'name and a set of pubkeys, and nothing else');
});

test('a grant refuses at BUILD time everything the relay refuses at the door', () => {
  const base = { lifetime: 'session', session: 'svc-next', source: 'rota', from: 1000, until: 4000, helpers: [ADA], keepers: [], sessionKeyHex: KEY, wrap };
  assert.throws(() => buildHelperGrant({ ...base, session: '' }), /no session id/);
  assert.throws(() => buildHelperGrant({ ...base, source: 'invented' }), /undeclared helper source/);
  assert.throws(() => buildHelperGrant({ ...base, until: 1000 + MAX_SESSION_SECONDS + 1 }), /may not exceed/);
  assert.throws(() => buildHelperGrant({ ...base, until: 500 }), /closes before it opens/);
  assert.throws(() => buildHelperGrant({ ...base, sessionKeyHex: 'short' }), /32 bytes of hex/);
  assert.throws(() => buildHelperGrant({ ...base, wrap: null }), /wrap must be a function/);
});

test('one damaged recipient does not deny the session to everyone else — but is REPORTED', () => {
  const flaky = (p, pl) => { if (p === BEN) throw new Error('bad key'); return wrap(p, pl); };
  const { doc, failed } = buildHelperGrant({ lifetime: 'session', session: 's', source: 'rota', from: 1, until: 2,
    helpers: [ADA, BEN], keepers: [], sessionKeyHex: KEY, wrap: flaky });
  assert.ok(doc.keys[ADA], 'one damaged steward code denied the whole session');
  assert.deepEqual(failed, [BEN],
    'somebody was silently left out of a grant — they turn up on Sunday to an empty room and no error');
});

test('readHelperGrant refuses anything it cannot vouch for, and NEVER returns an unbounded one', () => {
  const { doc } = buildHelperGrant({ lifetime: 'session', session: 's1', source: 'rota', from: 1000, until: 4000,
    helpers: [ADA], keepers: [], sessionKeyHex: KEY, wrap });
  assert.ok(readHelperGrant(JSON.stringify(doc)), 'a well-formed grant was rejected');
  for (const bad of [
    '', 'not json', '[]', 'null', '"a string"',
    JSON.stringify({ ...doc, source: 'invented' }),
    JSON.stringify({ ...doc, until: doc.from + MAX_SESSION_SECONDS + 1 }),
    JSON.stringify({ ...doc, until: doc.from - 1 }),
    JSON.stringify({ ...doc, session: '' }),
    JSON.stringify({ ...doc, from: 'soon' }),
  ]) {
    assert.equal(readHelperGrant(bad), null, 'a grant this parser cannot vouch for came back as a grant: ' + bad.slice(0, 80));
  }
});

test('the window is compared, not assumed — the boundary is inclusive at both ends and closed outside them', () => {
  const g = readHelperGrant(JSON.stringify(buildHelperGrant({ lifetime: 'session', session: 's1', source: 'rota', from: 1000,
    until: 4000, helpers: [ADA], keepers: [CHI], sessionKeyHex: KEY, wrap }).doc));
  assert.equal(grantAdmits(g, ADA, 1000), true, 'the helper is refused at the exact moment their turn begins');
  assert.equal(grantAdmits(g, ADA, 4000), true, 'the helper is refused at the exact moment their turn ends');
  assert.equal(grantAdmits(g, ADA, 999), false, 'the helper was admitted BEFORE their turn began');
  assert.equal(grantAdmits(g, ADA, 4001), false, 'the helper was admitted AFTER their turn ended — this is the ' +
    'whole appeal of tying the key to the rota, and it is only true if it is enforced');
  assert.equal(grantAdmits(g, CHI, 2000), false, 'a keeper was admitted BY the grant rather than by the steward roster');
  assert.equal(grantAdmits(g, BEN, 2000), false, 'somebody who was never named was admitted');
  assert.equal(grantAdmits(g, ADA, NaN), false);
  assert.equal(grantAdmits(null, ADA, 2000), false, 'no grant read as no limits');
});

test('helperKeyFor hands the session key to its holder and to nobody else', () => {
  const g = readHelperGrant(JSON.stringify(buildHelperGrant({ lifetime: 'session', session: 's1', source: 'rota', from: 1000,
    until: 4000, helpers: [ADA, BEN], keepers: [], sessionKeyHex: KEY, wrap }).doc));
  assert.equal(helperKeyFor(g, ADA, 2000, unwrapAs(ADA)), KEY, 'a helper cannot get their own session key');
  assert.equal(helperKeyFor(g, ADA, 5000, unwrapAs(ADA)), '',
    'the key was still handed over after the turn ended');
  assert.equal(helperKeyFor(g, BEN, 2000, unwrapAs(ADA)), '',
    'a helper unwrapped a slot that was not theirs — every recipient must only be able to open their own');
  assert.equal(helperKeyFor(g, CHI, 2000, unwrapAs(CHI)), '', 'someone not in the grant obtained a session key');
});

test('LAST WEEK\'S KEY DOES NOT OPEN THIS WEEK — the crypto, not the gate', () => {
  // The gate is tested against a real relay in checkin-helper-capability.test.mjs. This asserts the half that
  // survives a broken gate: the session keys are independent, so a helper holding last week's opens nothing
  // this week even if every rule in gateway.mjs were deleted.
  const k1 = '11'.repeat(32), k2 = '22'.repeat(32);
  const last = readHelperGrant(JSON.stringify(buildHelperGrant({ lifetime: 'session', session: 'svc-last', source: 'rota',
    from: 1000, until: 4000, helpers: [ADA], keepers: [], sessionKeyHex: k1, wrap }).doc));
  const now_ = readHelperGrant(JSON.stringify(buildHelperGrant({ lifetime: 'session', session: 'svc-now', source: 'rota',
    from: 9000, until: 12000, helpers: [BEN], keepers: [], sessionKeyHex: k2, wrap }).doc));
  assert.notEqual(k1, k2, 'two sessions were minted the same key');
  assert.equal(helperKeyFor(last, ADA, 2000, unwrapAs(ADA)), k1);
  assert.equal(helperKeyFor(now_, ADA, 10000, unwrapAs(ADA)), '',
    'last week\'s helper is in this week\'s grant, or holds this week\'s key');
});

// ── THE REGISTRY, and the copies of the d-tag ─────────────────────────────────────────────────────────────

test('the d-tag has ONE authority, and the console\'s copy matches it', () => {
  // CHECKED DUPLICATION, the pattern trinity-doc-types.mjs uses on itself: the string is a DOC_TYPES key, a
  // `D` entry, and a literal in src/steward.src.js beside its forty siblings. A typo in the console is not a
  // build error — it is a document the relay gates under one name while the console publishes under another,
  // and nothing fails loudly. This is where it fails loudly.
  assert.equal(D.CHECKINHELPER, 'trinityone/checkinhelper:');
  assert.ok(DOC_TYPES['trinityone/checkinhelper:'], 'the grant is not declared in the document registry');
  assert.equal(DOC_TYPES['trinityone/checkinhelper:'].write, 'church',
    'the registry no longer says the grant is owner-only to write');
  const STEW = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
  assert.match(STEW, /const CHECKINHELPER_D = 'trinityone\/checkinhelper:';/,
    'the console\'s copy of the d-tag has drifted from the registry');
  // and the module that answers "who may hold this key" must NOT define a third copy
  const SRC = readFileSync(new URL('./checkin-role-source.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(SRC, /'trinityone\/checkinhelper:'/,
    'a third definition of the d-tag appeared in the role-source module — that is the exact defect the ' +
    'document registry exists to prevent');
});

test('every declared source is a real implementation, not a label', () => {
  // Guards the guard: a source could be added to HELPER_SOURCES as a name with a stub, and isDeclaredSource
  // would then let the relay store grants claiming a provenance that answers nothing.
  for (const [id, src] of Object.entries(HELPER_SOURCES)) {
    assert.equal(src.id, id, 'source ' + id + ' disagrees with its own key');
    assert.equal(typeof src.resolve, 'function', 'source ' + id + ' has no resolver');
    assert.ok(src.label && src.label.length > 8, 'source ' + id + ' has no label a steward could read');
    assert.ok(Array.isArray(src.resolve({})), 'source ' + id + ' does not return a list for empty input');
  }
  assert.ok(Object.keys(HELPER_SOURCES).length >= 2,
    'only one source is implemented, so nothing proves the rota is actually replaceable');
});

// ── HOW LONG THE KEY LIVES: THE CHURCH'S CHOICE ───────────────────────────────────────────────────────────
// Owner, 2026-09-09: "we need to be able to make it as flexible as possible, giving control over expiry etc
// where possible by a steward." So the tests below are about the SETTING behaving, and about the one thing the
// setting may never reach.

test('THE DEFAULT IS THE TIGHTEST OPTION', () => {
  // Asserted by name, so that a later well-meant "churches keep asking for longer, let's default to the day"
  // fails here rather than shipping. A church that never opens the setting must get the safest behaviour, not
  // the most convenient one.
  assert.equal(DEFAULT_HELPER_LIFETIME, 'session',
    'the default helper lifetime is no longer the rostered session — a church that never opens the setting now ' +
    'gets something looser than the tightest option, which is the wrong direction for this decision to drift');
  const capped = Object.values(HELPER_LIFETIMES).filter(l => l.max != null).map(l => l.max);
  assert.equal(HELPER_LIFETIMES[DEFAULT_HELPER_LIFETIME].max, Math.min(...capped),
    'the default is not the shortest of the expiring lifetimes');
  assert.ok(HELPER_LIFETIMES[DEFAULT_HELPER_LIFETIME].max != null,
    'the default lifetime does not expire at all');
});

test('the church\'s answer to BOTH questions is read in one place, and unknown values fall to the tightest', () => {
  assert.deepEqual(helperPolicy(null), { source: DEFAULT_HELPER_SOURCE, lifetime: DEFAULT_HELPER_LIFETIME });
  assert.deepEqual(helperPolicy({}), { source: DEFAULT_HELPER_SOURCE, lifetime: DEFAULT_HELPER_LIFETIME });
  assert.deepEqual(helperPolicy({ source: 'team', lifetime: 'open' }), { source: 'team', lifetime: 'open' });
  // the direction that matters: garbage must not become "forever"
  assert.equal(helperPolicy({ lifetime: 'forever' }).lifetime, DEFAULT_HELPER_LIFETIME,
    'an unrecognised lifetime resolved to something other than the tightest — the wrong fallback here leaves ' +
    'somebody holding the children\'s register for longer than any church chose');
  assert.equal(helperPolicy({ lifetime: '__proto__' }).lifetime, DEFAULT_HELPER_LIFETIME);
  assert.equal(isDeclaredLifetime('__proto__'), false);
});

test('every lifetime on offer is a real one a steward could read and choose', () => {
  for (const [id, l] of Object.entries(HELPER_LIFETIMES)) {
    assert.equal(l.id, id, 'lifetime ' + id + ' disagrees with its own key');
    assert.equal(typeof l.window, 'function', 'lifetime ' + id + ' has no window');
    assert.ok(l.label && l.label.length > 8, 'lifetime ' + id + ' has no label a steward could read');
    assert.ok(l.describe && /\./.test(l.describe), 'lifetime ' + id + ' does not describe its consequence');
    assert.ok(l.max === null || (Number.isInteger(l.max) && l.max > 0 && l.max <= MAX_SESSION_SECONDS),
      'lifetime ' + id + ' has a cap above the ceiling every expiring grant is held to');
  }
  assert.deepEqual(Object.keys(HELPER_LIFETIMES).sort(), ['day', 'open', 'session'],
    'the set of shapes a church may choose changed — three were offered because they are the three a church ' +
    'would name out loud, and a fourth needs its own decision, not a quiet addition');
  assert.equal(Object.values(HELPER_LIFETIMES).filter(l => l.max == null).length, 1,
    'more than one lifetime never expires — exactly one shape may be open-ended, and only the one whose entire ' +
    'point is "until a steward ends it"');
});

test('EACH lifetime expires when it says — asserted by the refusal after the boundary', () => {
  const svc = { date: '2026-09-13', time: '10:30' };
  const P2 = ADA;
  const mk = (life) => {
    const w = lifetimeWindow(life, svc, {});
    const { doc } = buildHelperGrant({ lifetime: life, session: 's', source: 'rota', from: w.from,
      until: w.until, helpers: [P2], keepers: [], sessionKeyHex: KEY, wrap });
    return { w, g: readHelperGrant(JSON.stringify(doc)) };
  };
  // SESSION: over a few hours after the service, and refused one second later
  const s0 = mk('session');
  assert.equal(grantAdmits(s0.g, P2, s0.w.until), true, 'the session helper is refused at the last second of their turn');
  assert.equal(grantAdmits(s0.g, P2, s0.w.until + 1), false, 'a SESSION grant did not end when the session did');
  assert.ok(s0.w.until - s0.w.from <= HELPER_LIFETIMES.session.max);

  // DAY: still open in the evening of the same day, and refused after local midnight
  const d0 = mk('day');
  assert.ok(d0.w.until > s0.w.until, 'the "whole day" lifetime is no longer than the session lifetime');
  assert.equal(grantAdmits(d0.g, P2, s0.w.until + 3600), true,
    'a DAY grant expired in the afternoon — a church that chose "the whole of that day" got a session');
  assert.equal(grantAdmits(d0.g, P2, d0.w.until), true);
  assert.equal(grantAdmits(d0.g, P2, d0.w.until + 1), false,
    'a DAY grant did not end at the end of the day');
  assert.equal(new Date(d0.w.until * 1000).getDate(), 13, 'the day grant does not end on the day of the service');

  // OPEN: still valid a year later, because only a steward ends it
  const o0 = mk('open');
  assert.equal(o0.w.until, null, 'the open-ended lifetime minted an end date, so it is not open-ended');
  assert.equal(grantAdmits(o0.g, P2, s0.w.until + 365 * 24 * 3600), true,
    'a church that chose "until a steward ends it" had its grant expire on its own');
  assert.equal(grantAdmits(o0.g, P2, o0.w.from - 1), false,
    'an open-ended grant was live BEFORE it opened — open-ended means no end, not no beginning');
});

test('NO LIFETIME CAN BE MADE INTO ANOTHER ONE', () => {
  // The protection that survives a modified client: the cap travels with the lifetime the grant declares, in
  // the enforced record. A `session` grant cannot be handed a week-long window by any caller, and an absent
  // end is refused rather than read as "forever".
  const base2 = { session: 's', source: 'rota', from: 1000, helpers: [ADA], keepers: [], sessionKeyHex: KEY, wrap };
  assert.throws(() => buildHelperGrant({ ...base2, lifetime: 'session', until: 1000 + HELPER_LIFETIMES.session.max + 1 }), /may not exceed/);
  assert.throws(() => buildHelperGrant({ ...base2, lifetime: 'day', until: 1000 + HELPER_LIFETIMES.day.max + 1 }), /may not exceed/);
  assert.throws(() => buildHelperGrant({ ...base2, lifetime: 'session', until: null }), /must carry an end/);
  assert.throws(() => buildHelperGrant({ ...base2, lifetime: 'day', until: undefined }), /must carry an end/);
  assert.throws(() => buildHelperGrant({ ...base2, lifetime: 'open', until: 5000 }), /must not carry an end/);
  assert.throws(() => buildHelperGrant({ ...base2, lifetime: 'forever', until: 5000 }), /undeclared lifetime/);
  assert.throws(() => buildHelperGrant({ ...base2, until: 5000 }), /undeclared lifetime/,
    'a grant with NO lifetime was built — a caller that has not asked the church must not get a default here, ' +
    'or there are two opinions about how long a key to the children\'s register lives');
  // and the parser refuses the same things, so nothing on disk can mean something a builder would not mint
  const good = buildHelperGrant({ ...base2, lifetime: 'session', until: 4000 }).doc;
  for (const bad of [{ ...good, until: null }, { ...good, lifetime: 'open' }, { ...good, lifetime: 'forever' },
                     { ...good, lifetime: undefined },
                     { ...good, lifetime: 'session', until: good.from + HELPER_LIFETIMES.session.max + 1 }]) {
    assert.equal(readHelperGrant(JSON.stringify(bad)), null,
      'the parser vouched for a grant whose lifetime and window disagree: ' + JSON.stringify(bad.lifetime) + '/' + bad.until);
  }
});

test('NO CONFIGURATION CHANGES WHAT THE KEY OPENS — the invariant, across every shape on offer', () => {
  // THE LINE THAT MUST NOT MOVE. Flexibility is WHEN a key is valid and WHO may hold one. If a setting ever
  // reached WHAT it opens, that would be the August failure — granting Finance handed over the children's
  // register — arriving by a different road.
  //
  // Held here structurally, at the point a grant is BUILT: for every source and every lifetime the document has
  // the same field set and the same recipients, and carries no field that could name a scope, a document type,
  // a capability or a permission. The relay half of this invariant is asserted against a live gateway in
  // checkin-helper-capability.test.mjs, over every configuration.
  const svc = { date: '2026-09-13', time: '10:30' };
  const shapes = [];
  for (const source of Object.keys(HELPER_SOURCES)) {
    for (const life of Object.keys(HELPER_LIFETIMES)) {
      const w = lifetimeWindow(life, svc, {});
      const { doc } = buildHelperGrant({ lifetime: life, session: 's', source, from: w.from, until: w.until,
        helpers: [ADA], keepers: [CHI], sessionKeyHex: KEY, wrap });
      shapes.push({ source, life, doc });
    }
  }
  assert.equal(shapes.length, Object.keys(HELPER_SOURCES).length * Object.keys(HELPER_LIFETIMES).length);
  const fields = Object.keys(shapes[0].doc).sort().join(',');
  for (const { source, life, doc } of shapes) {
    assert.equal(Object.keys(doc).sort().join(','), fields,
      `the grant shape differs for source=${source} lifetime=${life} — a configuration is changing the document, ` +
      'and the next thing a document can change is what it grants');
    assert.deepEqual(doc.pubs, [ADA], `source=${source} lifetime=${life} changed WHO the grant admits`);
    assert.deepEqual(Object.keys(doc.keys).sort(), [ADA, CHI].sort(),
      `source=${source} lifetime=${life} changed who can OPEN what a helper writes`);
    assert.doesNotMatch(JSON.stringify(doc), /scope|capab|permission|allow|finance|care|members|minors|guardian/i,
      `source=${source} lifetime=${life} produced a grant carrying something that reads like a permission — ` +
      'this document says WHO and WHEN, and must never acquire a WHAT');
  }
});
