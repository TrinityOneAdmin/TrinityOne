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
  HELPER_SOURCES, DEFAULT_HELPER_SOURCE, isDeclaredSource, eligibleHelpers, HELPER_LIFETIMES,
  DEFAULT_HELPER_LIFETIME, isDeclaredLifetime, helperPolicy, MAX_SESSION_SECONDS, sessionWindow, lifetimeWindow,
  windowFault, buildHelperGrant, readHelperGrant, grantAdmits, helperKeyFor, GRANT_SOURCE, isPermissionSource,
  permittedHelpers, permissionPolicy, permissionWindow, permissionFault, buildCheckinPermission,
  readCheckinPermission, permissionAdmits, PERMISSION_LIFETIMES, DEFAULT_PERMISSION_LIFETIME,
  isDeclaredPermissionLifetime, MAX_PERMISSION_SECONDS, KEY_LEAD_SECONDS
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
  // AND `open` IS NO LONGER A SESSION LIFETIME AT ALL — it moved to the permission on 2026-09-09. A session key
  // with no end would be a standing key to the children's register, and it is now minted by machinery rather
  // than by a steward's weekly click, which makes it worse than it was.
  assert.match(windowFault(1000, null, 'open'), /unknown lifetime/,
    'a session key declared the open-ended lifetime and was not refused — the open-ended shape belongs to the ' +
    'PERMISSION, which carries no key material, and nowhere else');
  assert.match(windowFault(1000, null, 'day'), /must carry an end/,
    'a DAY session key with no end was accepted — that is a standing key with a day-shaped name');
  assert.equal(Object.values(HELPER_LIFETIMES).filter(l => l.max == null).length, 0,
    'a session lifetime with no cap is back. Every key this product mints must expire; only a clearance may not.');
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
  const { doc } = buildHelperGrant({ lifetime: 'session', session: 'svc-next', source: 'permission', from: 1000, until: 4000,
    helpers: [ADA, BEN], keepers: [CHI], sessionKeyHex: KEY, wrap });
  assert.deepEqual(doc.pubs.sort(), [ADA, BEN].sort(), 'the enforced list is not the helper list');
  for (const p of doc.pubs) assert.ok(doc.keys[p], 'a helper the relay will admit has no key wrapped to them');
  assert.ok(doc.keys[CHI], 'the church/safeguarding keeper cannot open what a helper writes');
  assert.ok(!doc.pubs.includes(CHI),
    'a KEEPER was written into the enforced helper list — a safeguarding steward\'s authority must come from ' +
    'the steward roster, never from a session grant, or revoking them would leave a grant still admitting them');
});

test('a grant carrying nothing about any child', () => {
  const { doc } = buildHelperGrant({ lifetime: 'session', session: 'svc-next', source: 'permission', from: 1000, until: 4000,
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
  const base = { lifetime: 'session', session: 'svc-next', source: 'permission', from: 1000, until: 4000, helpers: [ADA], keepers: [], sessionKeyHex: KEY, wrap };
  assert.throws(() => buildHelperGrant({ ...base, session: '' }), /no session id/);
  assert.throws(() => buildHelperGrant({ ...base, source: 'invented' }), /must declare source/);
  // AND EVERY DECLARED SOURCE THAT IS NOT THE PINNED ONE, which is the regression that would look like
  // working software: an envelope built from a rota is the pre-2026-09-09 model, where a service's rota
  // decided who held a key instead of the church's own clearances.
  for (const src of Object.keys(HELPER_SOURCES).filter(k => k !== GRANT_SOURCE)) {
    assert.throws(() => buildHelperGrant({ ...base, source: src }), /must declare source/,
      'an envelope was built declaring source=' + src + ' — who may hold a key is a PERMISSION now, and an ' +
      'envelope that cites a rota is the shape this restructure exists to remove');
  }
  assert.throws(() => buildHelperGrant({ ...base, until: 1000 + MAX_SESSION_SECONDS + 1 }), /may not exceed/);
  assert.throws(() => buildHelperGrant({ ...base, until: 500 }), /closes before it opens/);
  assert.throws(() => buildHelperGrant({ ...base, sessionKeyHex: 'short' }), /32 bytes of hex/);
  assert.throws(() => buildHelperGrant({ ...base, wrap: null }), /wrap must be a function/);
});

test('one damaged recipient does not deny the session to everyone else — but is REPORTED', () => {
  const flaky = (p, pl) => { if (p === BEN) throw new Error('bad key'); return wrap(p, pl); };
  const { doc, failed } = buildHelperGrant({ lifetime: 'session', session: 's', source: 'permission', from: 1, until: 2,
    helpers: [ADA, BEN], keepers: [], sessionKeyHex: KEY, wrap: flaky });
  assert.ok(doc.keys[ADA], 'one damaged steward code denied the whole session');
  assert.deepEqual(failed, [BEN],
    'somebody was silently left out of a grant — they turn up on Sunday to an empty room and no error');
});

test('readHelperGrant refuses anything it cannot vouch for, and NEVER returns an unbounded one', () => {
  const { doc } = buildHelperGrant({ lifetime: 'session', session: 's1', source: 'permission', from: 1000, until: 4000,
    helpers: [ADA], keepers: [], sessionKeyHex: KEY, wrap });
  assert.ok(readHelperGrant(JSON.stringify(doc)), 'a well-formed grant was rejected');
  for (const bad of [
    '', 'not json', '[]', 'null', '"a string"',
    JSON.stringify({ ...doc, source: 'invented' }),
    JSON.stringify({ ...doc, source: 'rota' }),
    JSON.stringify({ ...doc, source: 'team' }),
    JSON.stringify({ ...doc, source: 'steward' }),
    JSON.stringify({ ...doc, source: undefined }),
    JSON.stringify({ ...doc, until: doc.from + MAX_SESSION_SECONDS + 1 }),
    JSON.stringify({ ...doc, until: doc.from - 1 }),
    JSON.stringify({ ...doc, session: '' }),
    JSON.stringify({ ...doc, from: 'soon' }),
  ]) {
    assert.equal(readHelperGrant(bad), null, 'a grant this parser cannot vouch for came back as a grant: ' + bad.slice(0, 80));
  }
});

test('the window is compared, not assumed — the boundary is inclusive at both ends and closed outside them', () => {
  const g = readHelperGrant(JSON.stringify(buildHelperGrant({ lifetime: 'session', session: 's1', source: 'permission', from: 1000,
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
  const g = readHelperGrant(JSON.stringify(buildHelperGrant({ lifetime: 'session', session: 's1', source: 'permission', from: 1000,
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
  const last = readHelperGrant(JSON.stringify(buildHelperGrant({ lifetime: 'session', session: 'svc-last', source: 'permission',
    from: 1000, until: 4000, helpers: [ADA], keepers: [], sessionKeyHex: k1, wrap }).doc));
  const now_ = readHelperGrant(JSON.stringify(buildHelperGrant({ lifetime: 'session', session: 'svc-now', source: 'permission',
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
  assert.deepEqual(helperPolicy({ source: 'team', lifetime: 'day' }), { source: 'team', lifetime: 'day' });
  // A CHURCH THAT STORED 'open' BEFORE 2026-09-09 FALLS TO THE TIGHTEST, not to a shape that no longer
  // exists and not to something looser. The safe direction, and the one this function commits to.
  assert.equal(helperPolicy({ lifetime: 'open' }).lifetime, DEFAULT_HELPER_LIFETIME,
    'a stored session lifetime of "open" survived the restructure as something other than the tightest');
  // AND THE SOURCE IS NARROWED TO A PERMISSION SOURCE: this field decides which list a steward is SHOWN
  // when choosing who to clear, and "clear whoever is already cleared" is not an answer.
  assert.equal(helperPolicy({ source: GRANT_SOURCE }).source, DEFAULT_HELPER_SOURCE,
    'the pinned envelope source was honoured as a suggestion source, which is circular');
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
  assert.deepEqual(Object.keys(HELPER_LIFETIMES).sort(), ['day', 'session'],
    'the set of shapes a SESSION KEY may take changed. There were three until 2026-09-09; `open` moved to the ' +
    'permission, because a key with no end is a standing key and these are now issued by machinery rather than ' +
    'by a steward. A fourth needs its own decision, not a quiet addition.');
  assert.equal(Object.values(HELPER_LIFETIMES).filter(l => l.max == null).length, 0,
    'a session key may be open-ended again. That is the one shape this restructure removed on purpose: the ' +
    'church\'s "until a steward ends it" now lives on a document that carries no key.');
});

test('EACH lifetime expires when it says — asserted by the refusal after the boundary', () => {
  const svc = { date: '2026-09-13', time: '10:30' };
  const P2 = ADA;
  const mk = (life) => {
    const w = lifetimeWindow(life, svc, {});
    const { doc } = buildHelperGrant({ lifetime: life, session: 's', source: 'permission', from: w.from,
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

  // AND THERE IS NO THIRD SHAPE. `open` was one until 2026-09-09; asking for it now produces no window at all,
  // which is the fail-closed direction — a caller that wanted a permanent key gets nothing, not a default one.
  assert.equal(lifetimeWindow('open', svc, {}), null,
    'the open-ended session lifetime is back, or lifetimeWindow silently substituted another shape for it');
  for (const life of Object.keys(HELPER_LIFETIMES)) {
    const w = lifetimeWindow(life, svc, {});
    assert.ok(Number.isInteger(w.until), 'session lifetime ' + life + ' minted a key with no end');
    assert.ok(w.until - w.from <= MAX_SESSION_SECONDS,
      'session lifetime ' + life + ' outlives the ceiling every key is held to');
  }
});

test('NO LIFETIME CAN BE MADE INTO ANOTHER ONE', () => {
  // The protection that survives a modified client: the cap travels with the lifetime the grant declares, in
  // the enforced record. A `session` grant cannot be handed a week-long window by any caller, and an absent
  // end is refused rather than read as "forever".
  const base2 = { session: 's', source: 'permission', from: 1000, helpers: [ADA], keepers: [], sessionKeyHex: KEY, wrap };
  assert.throws(() => buildHelperGrant({ ...base2, lifetime: 'session', until: 1000 + HELPER_LIFETIMES.session.max + 1 }), /may not exceed/);
  assert.throws(() => buildHelperGrant({ ...base2, lifetime: 'day', until: 1000 + HELPER_LIFETIMES.day.max + 1 }), /may not exceed/);
  assert.throws(() => buildHelperGrant({ ...base2, lifetime: 'session', until: null }), /must carry an end/);
  assert.throws(() => buildHelperGrant({ ...base2, lifetime: 'day', until: undefined }), /must carry an end/);
  assert.throws(() => buildHelperGrant({ ...base2, lifetime: 'open', until: 5000 }), /undeclared lifetime/);
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
  // THE ENVELOPE'S SOURCE IS PINNED SINCE 2026-09-09, so the matrix is every LIFETIME rather than every
  // source × lifetime. The sources have not gone away — they moved to the permission, and the matrix over them
  // is in the permission section below.
  for (const life of Object.keys(HELPER_LIFETIMES)) {
    const w = lifetimeWindow(life, svc, {});
    const { doc } = buildHelperGrant({ lifetime: life, session: 's', source: GRANT_SOURCE, from: w.from, until: w.until,
      helpers: [ADA], keepers: [CHI], sessionKeyHex: KEY, wrap });
    shapes.push({ source: GRANT_SOURCE, life, doc });
  }
  assert.equal(shapes.length, Object.keys(HELPER_LIFETIMES).length);
  const fields = Object.keys(shapes[0].doc).sort().join(',');
  for (const { source, life, doc } of shapes) {
    assert.equal(Object.keys(doc).sort().join(','), fields,
      `the grant shape differs for source=${source} lifetime=${life} — a configuration is changing the document, ` +
      'and the next thing a document can change is what it grants');
    assert.deepEqual(doc.pubs, [ADA], `source=${source} lifetime=${life} changed WHO the grant admits`);
    assert.deepEqual(Object.keys(doc.keys).sort(), [ADA, CHI].sort(),
      `source=${source} lifetime=${life} changed who can OPEN what a helper writes`);
    // `source` is EXCLUDED from this scan and the pin is asserted separately, because its only legal value is
    // now the word "permission" and the scan reads for exactly that word. Everything else in the document is
    // still held to it: a grant says WHO and WHEN and must never acquire a WHAT.
    const { source: _src, ...rest } = doc;
    assert.equal(_src, GRANT_SOURCE, `lifetime=${life} produced an envelope whose source is not the pinned one`);
    assert.doesNotMatch(JSON.stringify(rest), /scope|capab|permission|allow|finance|care|members|minors|guardian/i,
      `source=${source} lifetime=${life} produced a grant carrying something that reads like a permission — ` +
      'this document says WHO and WHEN, and must never acquire a WHAT');
  }
});

// ══ THE PERMISSION: A PERSON IS CLEARED ═══════════════════════════════════════════════════════════════════
// reference/FINDING-CHECKIN-GRANTS-SHOULD-BE-PER-PERSON-2026-09-09.md, the DECIDED block. Churches clear
// safeguarding volunteers ANNUALLY AND CHURCH-WIDE, so the document that says a person is cleared is scoped to
// the person and lasts until the church ends it. The key stays per session.
//
// NEGATIVE TESTS FIRST, throughout. In August a permission test passed while granting Finance handed over the
// children's register, and the missing test was the refusal.

test('a permission is scoped to a PERSON and carries NO KEY — the design the owner chose over the simpler one', () => {
  const doc = buildCheckinPermission({ person: ADA, source: 'steward', lifetime: 'open', from: 1000, until: null });
  assert.deepEqual(Object.keys(doc).sort(), ['from', 'lifetime', 'person', 'source', 'until'],
    'the permission grew a field. It says WHO is cleared and FOR HOW LONG, and nothing else.');
  assert.equal(doc.person, ADA, 'the permission does not name the person it clears');
  // THE ONE THAT MATTERS. The rejected design was a person-scoped document wrapping a longer-lived register
  // key: simpler, and a lost phone would then expose the whole year's register rather than one Sunday. The
  // owner refused that trade knowingly. If a `keys` object ever appears here, that property has been spent.
  assert.equal(doc.keys, undefined,
    'a permission carries key material. That is the collapse back to "a person-scoped grant wrapping a ' +
    'longer-lived register key" — the design the owner refused because a lost phone would then expose the ' +
    'whole year\'s register instead of one Sunday.');
  assert.doesNotMatch(JSON.stringify(doc), /[0-9a-f]{64}.*[0-9a-f]{64}/,
    'the permission carries a second 64-hex value beside the person — the only hex it may hold is a pubkey');
  assert.doesNotMatch(JSON.stringify(doc), /child|name|room|code|pickup|session/i,
    'the permission carries something about a child or a session — it is about a person and a period');
});

test('a permission REFUSES at build time everything the relay refuses at the door', () => {
  const base = { person: ADA, source: 'steward', lifetime: 'dated', from: 1000, until: 1000 + 300 * 86400 };
  assert.throws(() => buildCheckinPermission({ ...base, person: '' }), /64-hex/);
  assert.throws(() => buildCheckinPermission({ ...base, person: 'nope' }), /64-hex/);
  assert.throws(() => buildCheckinPermission({ ...base, source: 'invented' }), /undeclared permission source/);
  // A PERMISSION MAY NOT CITE ITSELF. 'permission' is a declared source — it is the one an ENVELOPE must
  // declare — and a clearance whose provenance is "the clearances" is a loop in a safeguarding record.
  assert.throws(() => buildCheckinPermission({ ...base, source: GRANT_SOURCE }), /undeclared permission source/,
    'a permission cited the permissions as its own provenance');
  assert.throws(() => buildCheckinPermission({ ...base, lifetime: 'forever' }), /undeclared lifetime/);
  assert.throws(() => buildCheckinPermission({ ...base, lifetime: 'session' }), /undeclared lifetime/,
    'a SESSION KEY lifetime was accepted for a clearance — the two tables answer different questions');
  assert.throws(() => buildCheckinPermission({ ...base, until: null }), /must carry an end/);
  assert.throws(() => buildCheckinPermission({ ...base, until: 500 }), /closes before it opens/);
  assert.throws(() => buildCheckinPermission({ ...base, until: 1000 + MAX_PERMISSION_SECONDS + 1 }), /may not exceed/);
  assert.throws(() => buildCheckinPermission({ ...base, lifetime: 'open', until: 5000 }), /must not carry an end/);
  assert.throws(() => buildCheckinPermission({ ...base, lifetime: 'day', until: 1000 + 27 * 3600 }), /may not exceed/);
});

test('readCheckinPermission NEVER returns an unbounded clearance, and null is not "no limits"', () => {
  const doc = buildCheckinPermission({ person: ADA, source: 'steward', lifetime: 'day', from: 1000, until: 1000 + 3600 });
  assert.ok(readCheckinPermission(JSON.stringify(doc)), 'a well-formed permission was rejected');
  for (const bad of [
    '', 'not json', '[]', 'null', '"a string"', '{}',
    JSON.stringify({ ...doc, person: 'nope' }),
    JSON.stringify({ ...doc, person: undefined }),
    JSON.stringify({ ...doc, source: 'invented' }),
    JSON.stringify({ ...doc, source: GRANT_SOURCE }),
    JSON.stringify({ ...doc, lifetime: undefined }),
    JSON.stringify({ ...doc, lifetime: 'session' }),
    JSON.stringify({ ...doc, until: null }),
    JSON.stringify({ ...doc, until: doc.from - 1 }),
    JSON.stringify({ ...doc, until: doc.from + MAX_PERMISSION_SECONDS + 1 }),
    JSON.stringify({ ...doc, from: 'soon' }),
    JSON.stringify({ ...doc, keys: { [ADA]: 'a-wrapped-register-key' }, until: null }),
  ]) {
    assert.equal(readCheckinPermission(bad), null,
      'a permission this parser cannot vouch for came back as a permission: ' + bad.slice(0, 90));
  }
  // AND A LIFETIME WITH NO END IS ONLY LEGAL FOR THE ONE WHOSE POINT THAT IS
  const openDoc = buildCheckinPermission({ person: ADA, source: 'steward', lifetime: 'open', from: 1000, until: null });
  assert.equal(readCheckinPermission(JSON.stringify(openDoc)).until, null,
    'the church\'s own "until a steward ends it" was refused by the parser');
});

test('a permission that has not OPENED yet admits NOBODY, and one that has lapsed admits nobody either', () => {
  // Granting a January clearance in December is an ordinary thing for a church to do, and must be safe.
  const pm = readCheckinPermission(JSON.stringify(buildCheckinPermission({
    person: ADA, source: 'steward', lifetime: 'dated', from: 5000, until: 9000 })));
  assert.equal(permissionAdmits(pm, 5000), true, 'the clearance is refused at the exact moment it begins');
  assert.equal(permissionAdmits(pm, 9000), true, 'the clearance is refused at the exact moment it ends');
  assert.equal(permissionAdmits(pm, 4999), false,
    'a clearance granted for NEXT month cleared somebody THIS month — minting ahead is only safe if it is enforced');
  assert.equal(permissionAdmits(pm, 9001), false, 'a clearance kept working after the date the church set');
  assert.equal(permissionAdmits(pm, NaN), false);
  assert.equal(permissionAdmits(null, 6000), false, 'no permission read as no limits');
  assert.equal(permissionAdmits({ ...pm, person: 'nope' }, 6000), false,
    'a permission naming no real pubkey cleared somebody');
  // and permittedHelpers is the same answer, since it is the ONE question the issuer asks
  assert.deepEqual(permittedHelpers([pm], 6000), [ADA]);
  assert.deepEqual(permittedHelpers([pm], 4999), [], 'the issuer would have wrapped a key to a not-yet-cleared person');
  assert.deepEqual(permittedHelpers([pm], 9001), [], 'the issuer would have wrapped a key to a lapsed clearance');
  assert.deepEqual(permittedHelpers([], 6000), []);
  assert.deepEqual(permittedHelpers(null, 6000), [], 'no permissions at all resolved to somebody');
  assert.deepEqual(permittedHelpers([null, {}, { person: 'nope', from: 1, until: null }], 6000), [],
    'malformed permissions cleared somebody — an unknown shape must clear nobody, never everybody');
});

test('the window a church means: "just that day", "until this date", "until we say otherwise"', () => {
  // LOCAL TIME, because a church saying "cleared to the 31st of December" means their own 31st of December.
  const d = permissionWindow('day', { date: '2026-09-13' });
  assert.equal(new Date(d.from * 1000).getDate(), 13, 'a one-day clearance does not start on the day named');
  assert.equal(new Date(d.until * 1000).getDate(), 13, 'a one-day clearance does not end on the day named');
  assert.ok(d.until - d.from <= PERMISSION_LIFETIMES.day.max);
  assert.equal(permissionWindow('day', {}), null, 'a day clearance with no date produced a window anyway');
  assert.equal(permissionWindow('day', { date: 'sometime' }), null);

  const t = 1788000000;
  const y = permissionWindow('dated', { until: '2027-01-31', from: t });
  assert.equal(y.from, t);
  assert.equal(new Date(y.until * 1000).getMonth(), 0, 'a dated clearance does not end in the month named');
  assert.equal(permissionWindow('dated', { until: '2099-01-31', from: t }), null,
    'a clearance reaching past the cap was silently SHORTENED instead of refused — a church that typed 2099 ' +
    'must see that it was not accepted, not quietly get 2027');
  assert.equal(permissionWindow('dated', { until: '2020-01-31', from: t }), null,
    'a clearance ending before it began was accepted');
  assert.equal(permissionWindow('dated', {}), null);

  const o = permissionWindow('open', { from: t });
  assert.equal(o.until, null, 'the open-ended clearance minted an end date, so it is not open-ended');
  assert.equal(o.from, t);
  assert.equal(permissionWindow('forever', { from: t }), null, 'an unknown lifetime produced a window');
  assert.equal(permissionWindow(null, { from: t }), null);
});

test('THE PERMISSION DEFAULT IS THE TIGHTEST, and unknown values fall to it rather than to the status quo', () => {
  assert.equal(DEFAULT_PERMISSION_LIFETIME, 'day',
    'the default clearance is no longer the tightest shape on offer. A church that never opens the screen must ' +
    'get the safest behaviour, not the most convenient one.');
  assert.equal(PERMISSION_LIFETIMES[DEFAULT_PERMISSION_LIFETIME].max,
    Math.min(...Object.values(PERMISSION_LIFETIMES).filter(l => l.max != null).map(l => l.max)),
    'the default is not the shortest capped lifetime on offer');
  assert.deepEqual(permissionPolicy(null), { source: DEFAULT_HELPER_SOURCE, lifetime: DEFAULT_PERMISSION_LIFETIME });
  assert.deepEqual(permissionPolicy({}), { source: DEFAULT_HELPER_SOURCE, lifetime: DEFAULT_PERMISSION_LIFETIME });
  assert.equal(permissionPolicy({ lifetime: 'forever' }).lifetime, DEFAULT_PERMISSION_LIFETIME,
    'an unrecognised clearance length resolved to something other than the tightest');
  assert.equal(permissionPolicy({ lifetime: '__proto__' }).lifetime, DEFAULT_PERMISSION_LIFETIME);
  assert.equal(permissionPolicy({ lifetime: 'session' }).lifetime, DEFAULT_PERMISSION_LIFETIME,
    'a session-key lifetime was honoured as a clearance length');
  assert.equal(permissionPolicy({ source: GRANT_SOURCE }).source, DEFAULT_HELPER_SOURCE,
    'a permission may cite the permissions as its own provenance');
  assert.deepEqual(permissionPolicy({ source: 'team', lifetime: 'open' }), { source: 'team', lifetime: 'open' });
  assert.equal(isDeclaredPermissionLifetime('__proto__'), false);
});

test('every clearance shape is a real one a steward could read and choose, and exactly one never expires', () => {
  for (const [id, l] of Object.entries(PERMISSION_LIFETIMES)) {
    assert.equal(l.id, id, 'clearance ' + id + ' disagrees with its own key');
    assert.ok(l.label && l.label.length > 8, 'clearance ' + id + ' has no label a steward could read');
    assert.ok(l.describe && /\./.test(l.describe), 'clearance ' + id + ' does not describe its consequence');
    assert.ok(l.max === null || (Number.isInteger(l.max) && l.max > 0 && l.max <= MAX_PERMISSION_SECONDS),
      'clearance ' + id + ' has a cap above the ceiling every expiring clearance is held to');
  }
  assert.deepEqual(Object.keys(PERMISSION_LIFETIMES).sort(), ['dated', 'day', 'open'],
    'the set of clearance shapes changed — three were offered because they are the three a safeguarding lead ' +
    'would say out loud, and a fourth needs its own decision');
  assert.equal(Object.values(PERMISSION_LIFETIMES).filter(l => l.max == null).length, 1,
    'more than one clearance shape never expires, or none does. Exactly one may be open-ended, and only the ' +
    'one whose entire point is "until a steward ends it".');
});

test('EVERY PROVENANCE IS DECLARED, and the envelope\'s pinned one is not one of them', () => {
  // The swap point the owner asked for: "we may change that to be more specifically a safeguarding team after
  // the pilot". Each of these is a real implementation with the same signature, which is the only proof the
  // abstraction was not shaped around its first caller.
  for (const src of Object.keys(HELPER_SOURCES)) {
    assert.equal(typeof HELPER_SOURCES[src].resolve, 'function', 'source ' + src + ' is a label, not an answer');
    assert.equal(isDeclaredSource(src), true);
  }
  assert.deepEqual(Object.keys(HELPER_SOURCES).filter(isPermissionSource).sort(), ['rota', 'steward', 'team'],
    'the set of things that may say a person is cleared changed');
  assert.equal(isPermissionSource(GRANT_SOURCE), false,
    'the envelope\'s pinned source is also accepted as a clearance provenance, which is circular');
  assert.equal(isPermissionSource('invented'), false);
  assert.equal(isPermissionSource('__proto__'), false);
  // NO CLEARANCE SHAPE CHANGES WHAT A KEY OPENS. The matrix that used to run over sources × session lifetimes
  // runs here over sources × clearance lifetimes, and the document must not vary beyond its own five fields.
  let n = 0;
  const fields = ['from', 'lifetime', 'person', 'source', 'until'].join(',');
  for (const src of Object.keys(HELPER_SOURCES).filter(isPermissionSource)) {
    for (const life of Object.keys(PERMISSION_LIFETIMES)) {
      const w = permissionWindow(life, { date: '2026-09-13', until: '2027-01-31', from: 1788000000, at: 1788000000 });
      const doc = buildCheckinPermission({ person: ADA, source: src, lifetime: life, from: w.from, until: w.until });
      assert.equal(Object.keys(doc).sort().join(','), fields,
        `the clearance shape differs for source=${src} lifetime=${life} — a configuration is changing the document`);
      assert.equal(doc.keys, undefined, `source=${src} lifetime=${life} put key material in a clearance`);
      assert.equal(doc.person, ADA, `source=${src} lifetime=${life} changed WHO is cleared`);
      n++;
    }
  }
  assert.equal(n, 3 * 3, 're-anchor: not every clearance configuration was exercised');
});

test('A HELPER CANNOT REACH BACK: the fetch lead is a bounded number, not a console\'s judgement', () => {
  // The property the owner paid machinery for. Session keys are now issued automatically and ahead of time, so
  // without a lead limit a helper cleared for the YEAR could collect every envelope a console had run ahead and
  // minted — the whole-year exposure he refused, arriving through the back door of the issuer.
  //
  // The relay enforces it (checkin-helper-capability.test.mjs drives that against a live gateway). What is
  // asserted here is that the number exists, is short, and is shared rather than typed into two files.
  assert.ok(Number.isInteger(KEY_LEAD_SECONDS) && KEY_LEAD_SECONDS > 0, 'the fetch lead is not a whole number of seconds');
  assert.ok(KEY_LEAD_SECONDS <= 30 * 86400,
    'the lead on fetching a session key is over a month. A cleared phone can now hoover up that much of the ' +
    'register\'s keys in one REQ, which is most of the way back to the whole-year exposure the owner refused.');
  assert.ok(KEY_LEAD_SECONDS >= 86400,
    'the lead is under a day, so a church whose console opens weekly leaves its helpers with no key at all');
  assert.ok(KEY_LEAD_SECONDS > MAX_SESSION_SECONDS,
    'the lead is shorter than a session key\'s own life, so no key could ever be fetched before it opened');
});
