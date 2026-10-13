// A TEAM THIS CONSOLE CANNOT READ YET IS NEVER WRITTEN OVER — AND OPENS WHEN THE KEY LANDS.
// Run: node --test scripts/a-locked-roster-is-never-written-over.test.mjs
//
// THE BUG (HIGH, data loss, found 2026-10-12). A console that opens before the church name key arrives holds every
// sealed calendar document (roster:, rota:, runsheet:, service:, room:, booking:) as a LOCKED copy `{ id, _locked }`.
//   1. Nothing re-read it when the key arrived, so it stayed locked all session.
//   2. `_absorbById` let a locked copy at the SAME second replace an opened one (a re-delivery, or a cache paint).
//   3. A locked roster had no `team`, so every screen drew an EMPTY team where it was —
//   4. — and any save published that emptiness over the real roster. The relay keeps only the newest copy: gone.
//   5. The care panel's effect republished the care list from the empty roster, sealing asks for help to nobody.
//   6. A co-steward's save in the same second was refused by the relay and reported as "your key hasn't arrived".
//   7. Block skipped a locked team silently.
//
// HOW THIS FILE ASSERTS (CLAUDE.md rules 1, 3). Every engine function is LIFTED out of the SHIPPED bundles
// (vendor/steward.js, vendor/steward-meals.js) and run; the relay's decision is the REAL one (scripts/event-store.mjs
// put()); the key arrives as a real NIP-44 seal. The screens are the real components, rendered (DashRota,
// RosterModal, DashMembers' Block, DashMealsPanel). Nothing here matches text in app/*.jsx. The real-browser
// point-of-use test is scripts/a-console-opened-before-its-key-keeps-its-teams.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { openStore } from './event-store.mjs';
import { fnBody, stmt } from './test-slice.mjs';
import { miniReact, loadScreen, find, texts } from './render-jsx-screen.mjs';
import { compiled, membersGlobals, press, reads, SCH } from './dash-render-kit.mjs';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward } from './console-screens.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const MEALS = readFileSync(new URL('../vendor/steward-meals.js', import.meta.url), 'utf8');

const churchSk = generateSecretKey(), CP = getPublicKey(churchSk);
const NAMEKEY = generateSecretKey();
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const NET = 'trinityone', ROSTER_D = 'trinityone/roster:', ROTA_D = 'trinityone/rota:';
const T = Math.floor(Date.now() / 1000) - 10_000;   // in the past, so the store's future-date guard is never involved
const RUTH = { id: 'p1', name: 'Ruth Carver', pub: 'a'.repeat(64) };
const ROSTER = { roles: [{ id: 'r1', name: 'Greeter' }], people: [RUTH], pods: [] };

function once(src, anchor, file) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `${anchor} is missing from ${file} — re-anchor this test`);
  assert.equal(src.indexOf(anchor, at + 1), -1, `${anchor} appears twice in ${file}`);
  return at;
}
const fn = (anchor) => fnBody(STEWARD, once(STEWARD, anchor, 'steward.js'), anchor);
const st = (anchor) => { once(STEWARD, anchor, 'steward.js'); return stmt(STEWARD, anchor); };

// A roster document as the relay holds it: pubkeys in the clear, the rest sealed under the church name key.
const rosterEvent = (team, doc = ROSTER, at = T) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', ROSTER_D + team], ['t', NET]],
  content: JSON.stringify({ pubs: doc.people.map(p => p.pub).filter(Boolean), e: nip44.encrypt(JSON.stringify(doc), NAMEKEY) }) }, churchSk);
const rotaEvent = (svc, at = T) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', ROTA_D + svc], ['t', NET]],
  content: JSON.stringify({ e: nip44.encrypt(JSON.stringify({ service: svc, published: true, assign: { 'welcome::r1': RUTH } }), NAMEKEY) }) }, churchSk);

// ── The console engine: the shipped store, the shipped stamp, the shipped readers and publishers ─────────────────
function console_({ ring = [], store = openStore(':memory:'), clock = { s: T }, kv = new Map() } = {}) {
  const subs = [], sent = [];
  const world = {
    pub: CP, sk: churchSk, NET, actingChurch: '',
    ROSTER_D, ROTA_D, SERVICE_D: 'trinityone/service:', RUNSHEET_D: 'trinityone/runsheet:', ROOM_D: 'trinityone/room:', BOOKING_D: 'trinityone/booking:',
    _nameKeyRing: ring, _unhex: unhex, encrypt2: nip44.encrypt, decrypt3: nip44.decrypt, NAME_KEY_WAIT_MS: 0,
    _localBlocked: new Set(), _consoleDisplay: () => true, _consoleChurchVoice: () => true,
    localStorage: { getItem: (k) => (kv.has(k) ? kv.get(k) : null), setItem: (k, v) => kv.set(k, String(v)) },
    relays: () => ['wss://r'],
    pool: { subscribeMany: (_r, _f, h) => { subs.push(h); return { close() {} }; } },
    now: () => clock.s, Date: { now: () => clock.s * 1000 },
    _skewShift: () => 0, STAMP_CAP_SEC: 600, SKEW_CAP_SEC: 900,
    finalizeEvent,
    // THE RELAY IS THE REAL ONE: event-store put(). A refusal comes back the way publish() reports it — false, with the
    // relay's own words in opts.reason (the gateway's text for 'have-newer').
    publish: async (evt, opts) => {
      sent.push(evt);
      const r = store.put(evt);
      if (r === 'stored' || r === 'duplicate') return evt;
      if (opts) { opts.reason = 'invalid: a newer version of this is already stored'; opts.refused = true; }
      return false;
    },
  };
  const names = Object.keys(world);
  const body = `
    ${fn('function _pickWinner(vers, trusted)')}
    ${fn('function _reduceVersions(vers, byId, id, trusted)')}
    ${fn('function _seedFromCache(versions, byId, items, trusted)')}
    ${fn('function _absorbById(versions, byId, id, rec, trusted)')}
    ${fn('function _tombstoneTargets(e)')}
    ${fn('function _forgetById(versions, byId, id, by, ts, trusted, opts)')}
    ${st('var _lastStamp = ')}
    ${st('var _lockedAddr = ')}
    ${fn('function _addrLocked(d)')}
    ${st('var _lastSaveFail = ')}
    ${fn('function _saveFailed(why)')}
    ${fn('function _noteSeenStamp(d, ts)')}
    ${fn('function _monotonic(tmpl)')}
    ${st('var _nameKeyListeners = ')}
    ${fn('function _onNameKeyRing(fn)')}
    ${fn('function _nameKeyRingChanged()')}
    ${fn('function _sealChurchDoc(obj)')}
    ${fn('function _sealChurchDocReady(obj)')}
    ${fn('function _openChurchDoc(content)')}
    let _svcSeq = 0;
    function feChurch(t) { return finalizeEvent(_monotonic(t), sk); }
    const S = { ${fn('_subAddr(prefix, map, onItems, lockedShape)')},
                ${fn('subscribeRosters(onRosters)')}, ${fn('subscribeRotas(onRotas)')},
                ${fn('async publishRoster(teamId, roster)')}, ${fn('async publishRota(rota)')},
                ${fn('async publishService(svc)')}, ${fn('async publishRunsheet(serviceId, items)')},
                ${fn('async publishRoom(room)')}, ${fn('async publishBooking(b)')},
                ${fn('rosterLocked(teamId)')}, ${fn('lastSaveFailure()')} };
    return { S, ringChanged: _nameKeyRingChanged, lastStamp: _lastStamp, absorb: _absorbById };`;
  const api = new Function(...names, body)(...names.map(n => world[n]));
  return { ...api, subs, sent, store, ring, clock, landKey: () => { ring.push(hex(NAMEKEY)); api.ringChanged(); } };
}

// ── 1. THE KEY LANDS, THE TEAM OPENS ─────────────────────────────────────────────────────────────────────────
test('a roster that arrived before the name key is held LOCKED, keeps its team, and OPENS when the key lands (fix 1)', () => {
  const c = console_();
  let rosters = [];
  c.S.subscribeRosters((r) => { rosters = r; });
  c.subs[0].onevent(rosterEvent('welcome'));
  assert.equal(rosters.length, 1);
  assert.equal(rosters[0]._locked, true, 'CONTROL: with an empty ring the shipped reader must mark it locked');
  assert.equal(rosters[0].team, 'welcome', 'a locked roster lost its team, so every screen draws an empty team where it is');
  assert.equal(c.S.rosterLocked('welcome'), true, 'the engine does not know this roster is locked');
  c.landKey();
  assert.equal(rosters[0]._locked, undefined, 'THE DEFECT: the roster stayed locked after the key landed — the screen shows an empty team all session');
  assert.deepEqual(rosters[0].people.map(p => p.name), ['Ruth Carver']);
  assert.equal(c.S.rosterLocked('welcome'), false, 'the engine still refuses to save a roster that has opened');
});

// ── 2. A LOCKED COPY NEVER REPLACES AN OPENED ONE ───────────────────────────────────────────────────────────
test('a locked copy at the same second never replaces an opened one; a NEWER locked copy still does (fix 2)', () => {
  const c = console_();
  const versions = new Map(), byId = new Map();
  c.absorb(versions, byId, 'welcome', { id: 'welcome', team: 'welcome', ...ROSTER, ts: T, _by: CP });
  c.absorb(versions, byId, 'welcome', { id: 'welcome', team: 'welcome', roles: [], people: [], _locked: true, ts: T, _by: CP });
  assert.equal(byId.get('welcome')._locked, undefined, 'THE DEFECT: a same-second locked re-delivery turned the opened team into an empty one');
  assert.deepEqual(byId.get('welcome').people.map(p => p.name), ['Ruth Carver']);
  c.absorb(versions, byId, 'welcome', { id: 'welcome', team: 'welcome', roles: [], people: [], _locked: true, ts: T + 1, _by: CP });
  assert.equal(byId.get('welcome')._locked, true, 'a genuinely NEWER copy must win even locked — the opened one is stale and must not be edited');
});

test('through the reader: a console reopened before its key keeps the team it painted from cache (fix 2)', () => {
  const kv = new Map();
  const before = console_({ ring: [hex(NAMEKEY)], kv });         // yesterday's session: the key was there
  before.S.subscribeRosters(() => {});
  before.subs[0].onevent(rosterEvent('welcome'));
  const boot = console_({ kv });                                 // today: reopened, the key has not arrived yet
  let shown = [];
  boot.S.subscribeRosters((r) => { shown = r; });
  assert.deepEqual(shown[0].people.map(p => p.name), ['Ruth Carver'], 'CONTROL: the cache paints the team');
  boot.subs[0].onevent(rosterEvent('welcome'));                  // the relay re-delivers the same version, unopenable
  assert.equal(shown[0]._locked, undefined, 'THE DEFECT: the live locked copy of the version on screen blanked the team');
  assert.deepEqual(shown[0].people.map(p => p.name), ['Ruth Carver']);
});

// ── 4. THE ENGINE REFUSES TO WRITE OVER A LOCKED DOCUMENT ───────────────────────────────────────────────────
test('publishRoster refuses to write over a locked roster — nothing reaches the relay, and the relay copy survives (fix 4)', async () => {
  const c = console_();
  c.store.put(rosterEvent('welcome', ROSTER, T - 5));           // the real team, on the relay
  c.subs.length || c.S.subscribeRosters(() => {});
  c.subs[0].onevent(rosterEvent('welcome', ROSTER, T - 5));     // ...arrives before the key: locked
  c.ring.push(hex(NAMEKEY));                                    // the key is now in the ring but the ring listener has not fired
  // (the window the wipe happened in: the key could seal, the screen still showed the empty locked team)
  const r = await c.S.publishRoster('welcome', { roles: [], people: [], pods: [] });
  assert.equal(r, null, 'THE DEFECT: an empty roster was published over a team this console could not read');
  assert.equal(c.S.lastSaveFailure(), 'locked');
  assert.equal(c.sent.length, 0, 'the empty roster reached the relay');
  // CONTROL: once the reader re-opens it, the same save goes through
  c.ringChanged();
  const ok = await c.S.publishRoster('welcome', ROSTER);
  assert.ok(ok, 'CONTROL: an opened roster must still save — the guard must not refuse every roster');
  assert.equal(c.sent.length, 1);
});

test('the same refusal guards a rota — no empty rota and therefore no "can you serve?" over a locked one (fix 4)', async () => {
  const c = console_();
  let rotas = [];
  c.S.subscribeRotas((r) => { rotas = r; });
  c.subs[0].onevent(rotaEvent('svc1'));
  assert.equal(rotas[0]._locked, true, 'CONTROL: locked with no key');
  c.ring.push(hex(NAMEKEY));
  assert.equal(await c.S.publishRota({ service: 'svc1', published: true, assign: {} }), null, 'an empty rota was published over a locked one');
  assert.equal(c.S.lastSaveFailure(), 'locked');
  assert.equal(c.sent.length, 0);
  assert.ok(await c.S.publishRota({ service: 'svc2', published: true, assign: {} }), 'CONTROL: an unrelated rota still saves');
});

test('every calendar publisher consults the lock: service, run sheet, room, booking (fix 4)', async () => {
  const c = console_({ ring: [hex(NAMEKEY)] });
  // Locked as the reader would mark them. Driven through the shipped reader with a document sealed under a key
  // this console has never held — the "unreadable" case, which locks exactly like the "not yet" case.
  const other = generateSecretKey();
  const sealedOther = (d) => finalizeEvent({ kind: 30078, created_at: T, tags: [['d', d], ['t', NET]], content: JSON.stringify({ e: nip44.encrypt('{}', other) }) }, churchSk);
  const seen = {};
  for (const d of ['trinityone/service:s1', 'trinityone/runsheet:s1', 'trinityone/room:rm1', 'trinityone/booking:bk1']) {
    const prefix = d.slice(0, d.indexOf(':') + 1);
    c.S._subAddr(prefix, () => ({}), (x) => { seen[prefix] = x; });
    c.subs[c.subs.length - 1].onevent(sealedOther(d));
    assert.equal(seen[prefix][0]._locked, true, 'CONTROL: ' + d + ' is locked');
  }
  assert.equal(await c.S.publishService({ id: 's1', date: '2099-01-01', name: 'x' }), null, 'publishService wrote over a locked service');
  assert.equal(await c.S.publishRunsheet('s1', []), null, 'publishRunsheet wrote over a locked run sheet');
  assert.equal(await c.S.publishRoom({ id: 'rm1', name: 'Hall' }), null, 'publishRoom wrote over a locked room');
  assert.equal(await c.S.publishBooking({ id: 'bk1', roomId: 'rm1' }), null, 'publishBooking wrote over a locked booking');
  assert.equal(c.sent.length, 0, 'something reached the relay');
  assert.ok(await c.S.publishService({ date: '2099-01-01', name: 'new' }), 'CONTROL: a NEW service (no id yet) still saves');
});

// ── 5. THE CARE LIST IS NEVER REWRITTEN FROM A LOCKED ROSTER ────────────────────────────────────────────────
function liftCareTeam(S) {
  const body = fnBody(MEALS, once(MEALS, 'async function publishCareTeam(memberPubs, opts) {', 'steward-meals.js'), 'publishCareTeam');
  let pc = null;
  pc = new Function('S', 'now', 'CARETEAM_D', 'NET', '_careTeamWait', '_careTeamSeen', 'setTimeout', 'publishCareTeam', 'return ' + body + ';')(
    () => S, () => T, 'trinityone/careteam:', NET, { pubs: null, cp: '', tries: 0, timer: 0 }, 'care', () => 0, (...a) => pc(...a));
  return pc;
}
test('publishCareTeam refuses while the care team’s roster is locked, and publishes once it opens (fix 5)', async () => {
  let locked = true;
  const sent = [];
  const S = { churchPub: CP, actingChurch: '', blockedHere: () => [], readMinors: async () => ({ known: true, list: [] }),
    rosterLocked: (team) => team === 'care' && locked, publishSigned: async (t) => { sent.push(t); return true; } };
  const pc = liftCareTeam(S);
  assert.equal(await pc([], { team: 'care' }), false, 'THE DEFECT: the care list was rewritten from a roster this console cannot read');
  assert.equal(await pc([]), false, 'with no team named, the care team last read from the settings must be the one checked');
  assert.equal(sent.length, 0, 'a care list reached the relay');
  assert.ok(await pc([RUTH.pub], { fromList: true }), 'a list read from careteam: itself (taking a child off) is not a roster and must still publish');
  locked = false;
  assert.ok(await pc([RUTH.pub], { team: 'care' }), 'CONTROL: once the roster opens the care list publishes');
  assert.equal(sent.length, 2);
});

test('the care panel never asks to publish the care list from a locked roster (fix 5, point of use)', async () => {
  // The panel keeps careteam: in step with the care team's roster. The wipe needs the panel to have published the
  // real list first and THEN be handed the roster as locked (a newer copy sealed under a key not here yet): its
  // empty people differ from what it last published, and the effect fires.
  const settings = { kind: 30078, pubkey: CP, created_at: T, tags: [['d', 'trinityone/meals-settings'], ['t', NET]],
    content: JSON.stringify({ enabled: true, visibility: 'all', openedBy: 'steward', adminGroupId: 'care' }) };
  let roster = { team: 'care', roles: [], people: [RUTH], pods: [], ts: T };
  let push = null;
  const asked = [];
  const Steward = fakeSteward({ churchPub: CP, pub: CP, activePub: CP, actingChurch: '',
    subscribeMany: (filters, h) => { if (filters.some(f => !f['#d'])) h.onevent(settings); h.oneose && h.oneose(); return { close() {} }; },
    subscribeRosters: (cb) => { push = cb; cb([roster]); return () => {}; },
    rosterLocked: () => !!roster._locked, readMinors: async () => ({ known: true, list: [] }), publishSigned: async () => true });
  const { React, reset, flush, unmount } = fakeReact();
  const { window } = fakeBrowser({ Steward });
  const mods = loadConsole({ React, window, vendor: ['vendor/steward-meals.js'], expr: '{ DashMealsPanel }' });
  const real = window.StewardMeals.publishCareTeam;
  window.StewardMeals.publishCareTeam = (...a) => { asked.push(a[0]); return real(...a); };
  const draw = () => { reset(); mods.DashMealsPanel({ church: {} }); flush(); };
  draw(); draw();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(asked.length === 1 && asked[0].includes(RUTH.pub), 'CONTROL: with the roster open the panel publishes the care list: ' + JSON.stringify(asked));
  roster = { team: 'care', roles: [], people: [], pods: [], _locked: true, ts: T + 1 };
  push([roster]);
  draw(); draw();
  await new Promise(r => setTimeout(r, 20));
  unmount();
  assert.equal(asked.length, 1, 'THE DEFECT: the panel asked to publish the care list from a roster it cannot read: ' + JSON.stringify(asked));
});

// ── 6. A CO-STEWARD'S CLASH IS NOT "YOUR KEY HASN'T ARRIVED" ─────────────────────────────────────────────────
const SCHED = readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8');
const schNoKey = (Steward) => new Function('window', `${stmt(SCHED, 'const SCH_NO_KEY =')}\n${fnBody(SCHED, once(SCHED, 'function schNoKey()', 'stew-schedule.jsx'), 'schNoKey')}\nreturn schNoKey();`)({ Steward });

test('a roster refused because a co-steward saved it a moment before says so — not "your key hasn’t arrived" (fix 6)', async () => {
  const c = console_({ ring: [hex(NAMEKEY)] });
  c.store.put(rosterEvent('welcome', ROSTER, T + 3));          // the other console's save, newer, NOT yet seen here
  const r = await c.S.publishRoster('welcome', ROSTER);
  assert.equal(r, null, 'CONTROL: the real store refuses the older write');
  assert.equal(c.S.lastSaveFailure(), 'clash');
  const msg = schNoKey(c.S);
  assert.match(msg, /someone saved this a moment ago/, 'the form misnames a co-steward’s save: ' + msg);
  assert.doesNotMatch(msg, /key hasn/, 'a clash was reported as a missing key');
  // and a genuinely missing key still says so
  const nokey = console_({ ring: [] });
  assert.equal(await nokey.S.publishRoster('welcome', ROSTER), null);
  assert.equal(nokey.S.lastSaveFailure(), 'nokey');
  assert.match(schNoKey({ ...nokey.S, nameKeyReady: () => false }), /key hasn’t arrived/, 'CONTROL: a missing key is still called a missing key');
});

test('a version received from another console is a stamp to beat, so two consoles do not tie on created_at (fix 6)', async () => {
  const c = console_({ ring: [hex(NAMEKEY)] });
  c.S.subscribeRosters(() => {});
  const theirs = rosterEvent('welcome', ROSTER, T);              // the co-steward's save, this very second
  c.store.put(theirs);
  c.subs[0].onevent(theirs);                                     // ...and this console has seen it
  const mine = await c.S.publishRoster('welcome', { ...ROSTER, people: [...ROSTER.people, { id: 'p2', name: 'Sam', pub: 'b'.repeat(64) }] });
  assert.ok(mine, 'THE DEFECT: the save tied with the version this console had already received and the relay refused it');
  assert.ok(c.sent.at(-1).created_at > T, 'the write was stamped at the second it had already seen: ' + c.sent.at(-1).created_at);
});

// ── 3. THE SCREEN: DashRota and RosterModal ─────────────────────────────────────────────────────────────────
function rota(roster) {
  const { React, draw } = miniReact();
  const win = new Proxy({
    useStewardGroups: () => [{ id: 'welcome', kind: 'team', name: 'Welcome', accent: 'var(--clay)' }],
    useStewardRosters: () => [roster],
    useStewardServices: () => [{ id: 'svcF', date: '2999-01-05', time: '10:30', name: 'Sunday' }],
    useStewardRotas: () => [], useStewardMembers: () => [], useStewardBlocked: () => [],
    Steward: { publishRota: async () => ({ id: 'x' }), publishService: async () => ({ id: 'y' }) },
  }, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && k.startsWith('useSteward')) return () => []; return undefined; }, has: () => true });
  const mod = loadScreen('app/stew-schedule.jsx', ['DashRota'], {
    React, Icon: () => null, SchModal: (p) => (p && p.children) || null, useStewDialog: () => ({ current: null }), todayISO: () => '2026-10-02',
    window: win, document: { addEventListener() {}, removeEventListener() {} }, console,
  });
  return () => draw(mod.DashRota, { onNewTeam() {} });
}
const rosterButton = (tree) => find(tree, n => n && n.type === 'button' && n.props && /Roster/.test(texts(n).join(' ')) && !/New team/.test(texts(n).join(' ')))[0];

test('THE ROTA: a locked team says "Can’t read this team yet" and its Roster button opens nothing (fix 3)', async () => {
  const drawOpen = rota({ team: 'welcome', ...ROSTER, ts: T });
  const t0 = drawOpen();
  assert.doesNotMatch(texts(t0).join(' '), /Can’t read this team yet/, 'CONTROL: an opened team must not say it cannot be read');
  assert.equal(rosterButton(t0).props.disabled, false, 'CONTROL: an opened team’s Roster button works');
  const draw = rota({ team: 'welcome', roles: [], people: [], pods: [], _locked: true, ts: T });
  let tree = draw();
  assert.match(texts(tree).join(' '), /Can’t read this team yet/, 'THE DEFECT: a locked team is drawn as an empty team: ' + texts(tree).join(' ').slice(0, 200));
  const b = rosterButton(tree);
  assert.equal(b.props.disabled, true, 'the Roster button of a locked team is live');
  b.props.onClick();
  tree = draw();
  assert.equal(find(tree, n => n && n.props && typeof n.props['aria-label'] === 'string' && /Add this person/.test(n.props['aria-label'])).length, 0,
    'pressing Roster on a locked team opened the roster form — whose Save would publish an empty team');
});

test('THE ROSTER FORM: opened on a locked team it offers no Save, and fills in by itself when the team opens (fix 3)', async () => {
  const { React, draw } = miniReact();
  const calls = [];
  const win = { Steward: { publishRoster: async (...a) => { calls.push(a); return { id: 'welcome' }; } }, useMealsSettings: () => ({ adminGroupId: '' }), useStewardBlocked: () => [] };
  const mod = loadScreen('app/stew-schedule.jsx', ['RosterModal'], {
    React, Icon: () => null, SchModal: (p) => (p && p.children) || null, useStewDialog: () => ({ current: null }),
    window: win, document: { addEventListener() {}, removeEventListener() {} }, console,
  });
  let roster = { team: 'welcome', roles: [], people: [], pods: [], _locked: true, ts: T };
  const props = () => ({ team: { id: 'welcome', name: 'Welcome' }, roster, members: [], onClose() {} });
  let tree = draw(mod.RosterModal, props());
  assert.match(texts(tree).join(' '), /Can’t read this team yet/, 'the form does not say the team cannot be read');
  const save = find(tree, n => n && n.type === 'button' && /Save roster/.test(texts(n).join(' ')))[0];
  assert.equal(save.props.disabled, true, 'THE DEFECT: Save is live on a form built from nothing');
  await save.props.onClick();
  assert.equal(calls.length, 0, 'Save published the empty form over the team');
  roster = { team: 'welcome', ...ROSTER, ts: T };               // the key landed: the same version, now open
  draw(mod.RosterModal, props());
  tree = draw(mod.RosterModal, props());
  assert.match(texts(tree).join(' '), /Ruth Carver/, 'the form stayed empty after the team opened — a Save now would still wipe it');
  assert.doesNotMatch(texts(tree).join(' '), /Can’t read this team yet/);
});

// ── 7. BLOCK SAYS WHICH TEAMS IT COULD NOT CHECK ────────────────────────────────────────────────────────────
test('Block with a locked team says "Couldn’t remove them from 1 team — try again shortly", and writes nothing to it (fix 7)', async () => {
  const BRAM = 'd'.repeat(64);
  const members = [{ pubkey: BRAM, npub: 'npub1aa', name: 'Bram Whitlock', count: 2, lastTs: T, joined: T - 86400 }];
  const run = async (rosters) => {
    const calls = [];
    const steward = { actingChurch: '', setBlocked: () => Promise.resolve(true), rotateCareKey: () => Promise.resolve(true), rotateMediaKey: () => Promise.resolve(true),
      ensureNameKeyForMembers: () => Promise.resolve({ rotated: true }), publishGroupKey: () => Promise.resolve({}), publishGroup: () => Promise.resolve(true),
      publishRoster: (team, doc) => { calls.push(team); return Promise.resolve({ id: team }); }, publishRota: () => Promise.resolve({ id: 'x' }) };
    const g = membersGlobals({ steward, members, extraWindow: { useStewardRosters: () => rosters, useStewardRotas: () => [], useStewardServices: () => [],
      useMealsSettings: () => ({ adminGroupId: '' }), StewardMeals: { publishCareTeam: () => Promise.resolve(true) }, todayISO: () => '2026-10-02' } });
    const { C, draw } = await compiled('DashMembers', g, ['rotateChurchKeys', 'takeOffEveryTeam', { src: SCH, name: 'publishCareTeamFor' }]);
    let tree = draw(C, {});
    await press(tree, /Remove \/ block this member/, { which: 0 });
    tree = draw(C, {});
    await press(tree, /Confirm — bans them/);
    await new Promise(r => setTimeout(r, 20));
    return { said: reads(draw(C, {})), calls };
  };
  const clean = await run([{ team: 'welcome', roles: [], people: [{ id: 'p1', name: 'Bram Whitlock', pub: BRAM }], pods: [] }]);
  assert.doesNotMatch(clean.said, /Couldn’t remove them from/, 'CONTROL: nothing locked, nothing to report');
  const r = await run([{ team: 'welcome', roles: [], people: [{ id: 'p1', name: 'Bram Whitlock', pub: BRAM }], pods: [] },
    { team: 'kids', roles: [], people: [], pods: [], _locked: true }]);
  assert.match(r.said, /Couldn’t remove them from 1 team — try again shortly/, 'THE DEFECT: a team Block could not check was skipped in silence: ' + r.said.slice(0, 400));
  assert.deepEqual(r.calls, ['welcome'], 'Block wrote to a locked team (or missed the readable one)');
});
