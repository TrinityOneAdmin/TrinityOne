// THE POINT OF USE: A PARENT SAYS "WE'RE HERE" AND HOLDS UP A CODE, ON THE REAL RENDERED SCREENS.
// Run: node --test scripts/a-parent-shows-a-code-instead-of-typing.test.mjs
//
// §3b of reference/PLAN-CHECKIN-NO-TYPING-2026-09-11.md. Two screens are driven here, because the feature is
// dead without either:
//   • app/identity.jsx — the settings sheet where a member says they bring children and types the names;
//   • app/screens-today.jsx — the card that offers "We're here" and then the QR.
//
// The engine underneath is scripts/a-parents-children-stay-on-their-own-phone.test.mjs and the WORKER's half
// is scripts/a-worker-scans-instead-of-typing.test.mjs. An engine nobody is required to consult is not a
// feature (CLAUDE.md rule 1), which is why all three exist.
//
// ⚠ THE ENGINE HERE IS THE SHIPPED ONE, lifted out of vendor/fellowship.js over a real in-memory
// localStorage. Stubbing `bringsChildren`/`arrivalSessionNow` would hand the harness the exact decisions
// these tests are named after — "a stub answers the question", which this repo has shipped four times.
//
// ⚠ RULE 3: NOTHING HERE MATCHES TEXT IN app/*.jsx. Every claim is about a RENDERED tree.
// ⚠ reads(), NOT said(), for every claim about wording — said() joins with a space and so cannot see the JSX
//   whitespace bug that shipped "whenever you openthis page" with its assertion passing.
//
// NO RELAY AND NO PORT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';
import { lifetimeWindow, DEFAULT_HELPER_LIFETIME } from './checkin-role-source.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// ── THE TREE READERS. The house versions. ─────────────────────────────────────────────────────────────────
const said = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');
const INLINE = new Set(['b', 'i', 'em', 'strong', 'span', 'code', 'a', 'small', 'Fragment']);
const isInline = (n) => n == null || typeof n !== 'object' || Array.isArray(n)
  || (typeof n.type === 'string' && INLINE.has(n.type)) || n.type === 'Fragment';
function flow(n) {
  if (n == null || n === false) return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(flow).join('');
  const inner = (n.kids || []).map(flow).join('');
  return isInline(n) ? inner : '\n' + inner + '\n';
}
const reads = (tree) => flow(tree).replace(/\s+/g, ' ').trim();
function glued(n, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => glued(c, out)); return out; }
  const kids = (n.kids || []).filter(k => k != null && k !== false && k !== '');
  for (let i = 0; i < kids.length - 1; i++) {
    const a = flow(kids[i]), b = flow(kids[i + 1]);
    if (a && b && /\w$/.test(a) && /^\w/.test(b)) out.push('…' + a.slice(-28) + '][' + b.slice(0, 28) + '…');
  }
  kids.forEach(k => glued(k, out));
  return out;
}
function shown(n, pred, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => shown(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => shown(c, pred, out));
  return out;
}
const shownButton = (tree, label) => shown(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));

// ── THE SHIPPED PARENT-SIDE ENGINE, OUT OF THE BUNDLE, OVER A REAL LITTLE STORAGE ─────────────────────────
const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const ENGINE_SRC = (() => {
  const start = FELLOWSHIP.indexOf('var BRINGKIDS_KEY =');
  assert.notEqual(start, -1, 'the parent-side engine is not in the bundle — did build:fellowship run?');
  return FELLOWSHIP.slice(start, FELLOWSHIP.indexOf('function parseArrivalQR(text) {', start))
    + fnBody(FELLOWSHIP, 'function parseArrivalQR(text) {', 'parseArrivalQR');
})();
const METHODS = ['bringsChildren(churchNpub) {', 'setBringsChildren(churchNpub, on) {',
  'myChildNames(churchNpub) {', 'setMyChildNames(churchNpub, names) {', 'arrivalQR(churchNpub) {'];

const CHURCH = 'c'.repeat(64);
const ME = 'a'.repeat(64);

function store(seed = {}) {
  const v = { ...seed };
  return { v, getItem: (k) => (k in v ? v[k] : null), setItem: (k, x) => { v[k] = String(x); }, removeItem: (k) => { delete v[k]; } };
}
// The real engine, plus the ONE thing a harness may control: what time it is. `now` is threaded through
// arrivalSessionNow's own second parameter, which is the shipped signature — not a Date stub.
function fellowship(ls, clock, keyed = true) {
  const scope = {
    localStorage: ls, _mePub: () => ME, _mayCache: () => keyed, toPub: (x) => String(x || ''),
    lifetimeWindow, DEFAULT_HELPER_LIFETIME,
    window: { dispatchEvent() {}, Fellowship: null },
    Event: function Event(n) { this.type = n; },
    String, Date, Math, JSON, Number, Array, Object, Boolean, RegExp, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped parent-side engine needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) {' + ENGINE_SRC + '\nreturn ({ ' +
    METHODS.map(m => fnBody(FELLOWSHIP, m, m)).join(',\n') + ', arrivalSessionNow, parseArrivalQR }); }')(proxy);
  scope.window.Fellowship = api;
  // The card calls `arrivalSessionNow(services)` with no time, so the harness pins it here — through the
  // shipped function's own parameter rather than by faking the clock.
  // `clock` is a BOX, not a number, so a test can move time under a card that is already mounted — which is
  // the only way to reach "the eleven o'clock button, with nine o'clock's refusal still on screen".
  return { ...api, myPubkey: ME, arrivalSessionNow: (svcs) => api.arrivalSessionNow(svcs, clock.v) };
}

// A Sunday, a service at 09:00, and the window the SHARED module says that service has.
const SERVICE = { id: 'svc-am', date: '2026-09-13', time: '09:00', name: 'Morning' };
const LATE = { id: 'svc-late', date: '2026-09-13', time: '11:00', name: 'Late morning' };
const WIN = lifetimeWindow(DEFAULT_HELPER_LIFETIME, SERVICE);
const IN_WINDOW = WIN.from + 60;
const BEFORE = WIN.from - 60;

// ── THE TODAY SCREEN ──────────────────────────────────────────────────────────────────────────────────────
const DATA = { VOTD_POOL: [{ ref: 'John 3:16', text: 'For God so loved the world…' }], PLANS: [{ id: 'p1', name: 'A plan', days: [{ d: 1, ref: 'Gen 1' }] }], NOTIFICATIONS: [] };
const BIBLE = { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], bookName: () => 'Genesis', bookAbbr: () => 'Gen', maxChapter: () => 50, activeVersion: 'WEB' };

function today({ seed = {}, now = IN_WINDOW, services = [SERVICE], arriveResult = { ok: true, id: 'x' }, qrRenderer = true,
                clockIsWrong = false, clockSkewMins, clockSkewAhead = true } = {}) {
  const { React, draw } = miniReact();
  const ls = store(seed);
  const clock = { v: now };
  const F = fellowship(ls, clock);
  const qrTexts = [];
  const arriveCalls = [];
  const timers = [];
  const win = {
    Fellowship: F,
    TrinityIdentity: qrRenderer ? { qrSVG: (t) => { qrTexts.push(t); return '<svg data-qr="1"></svg>'; } } : {},
    Capacitor: { isNativePlatform: () => false },
    TrinityData: DATA, Bible: BIBLE,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: ls, innerWidth: 390,
  };
  const globals = {
    React, window: win,
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' },
    localStorage: ls,
    // ⚠ NO REAL TIMERS, AND THEY ARE COUNTED. The card re-asks "are we in window" on a minute's interval,
    // which is right on a phone (a service comes into window while the app is open) and fatal in
    // `node --test`: miniReact never runs a cleanup, so ONE live interval keeps the event loop alive and the
    // run never ends. It hung scripts/a-parent-sees-their-own-childs-pickup-code.test.mjs, which renders the
    // whole Today screen, for twelve minutes before it was caught. `timers` is what the test at the foot of
    // this file reads.
    setTimeout, clearTimeout, setInterval: () => { timers.push(1); return 0; }, clearInterval: () => {}, console,
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), ChurchBadge: Stub('ChurchBadge'),
    SafetyBanner: Stub('SafetyBanner'), CareCard: Stub('CareCard'), AskForHelp: Stub('AskForHelp'),
    SectionLabel: function SectionLabel(p) { return React.createElement('h2', {}, p.children); },
    BottomSheet: ({ open, children }) => (open ? children : null),
    Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
    safeCssColor: (c) => c, todayISO: () => '2026-09-13', lsGet: (k, d) => d, lsSet: () => {},
    Math, Date, JSON, Set, Map, Number, String, Array, Promise, Object, isNaN, Boolean, parseInt, parseFloat,
  };
  const mod = loadScreen('app/screens-today.jsx', ['TodayScreen', 'WereHereCard'], globals);
  const ctx = {
    church: { id: 'c1', name: "St Chad's", npub: CHURCH },
    churchServices: services,
    myChildren: { children: [], askAtDesk: 0, settled: true },
    care: { settings: { enabled: false }, needs: [], myPub: 'me' },
    planProgress: {}, loc: null, churchDevos: [], servNext: null, servPending: [], servingSeenTs: 0,
    netUnread: 0, dark: false,
    openServing() {}, openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, openListen() {},
    toggleDark() {}, toast() {}, openShareSheet() {}, openEvent() {}, openHelp() {},
    checkinArrive: async (rec) => { arriveCalls.push(rec); return arriveResult; },
    // The MEASURED clock skew. Already on the real ctx object (app/app.jsx) — see the refusal tests below.
    clockIsWrong, clockSkewMins, clockSkewAhead,
  };
  const api = {
    ls, F, ctx, qrTexts, arriveCalls, timers, clock,
    setNow(t) { clock.v = t; return api.redraw(); },
    card: () => draw(mod.WereHereCard, { ctx }),
    screen: () => draw(mod.TodayScreen, { ctx }),
  };
  api.tree = api.card();
  api.redraw = () => { api.tree = api.card(); return api.tree; };
  api.press = (label) => {
    const b = shownButton(api.tree, label);
    assert.equal(b.length, 1, 'expected one control reading ' + JSON.stringify(label) + ', found ' + b.length);
    b[0].props.onClick();
    return api.redraw();
  };
  api.click = async (label) => {
    const b = shownButton(api.tree, label);
    assert.equal(b.length, 1, 'expected one control reading ' + JSON.stringify(label) + ', found ' + b.length);
    b[0].props.onClick();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    return api.redraw();
  };
  return api;
}

// A phone where the member has already ticked the box and typed two names.
const READY = {
  ['trinityone.bringkids.' + CHURCH + '|' + ME]: '1',
  ['trinityone.mykidnames.' + CHURCH + '|' + ME]: JSON.stringify(['Milo', 'Ivy']),
};

// ══════════════ IT IS ABSENT FOR ALMOST EVERYBODY, ALMOST ALWAYS ═══════════════════════════════════════════
test('a member who has said nothing about children sees NOTHING about check-in', () => {
  // The "no dead ends" finding: a parent persona hunted this app on 2026-09-10 and found no check-in
  // anywhere, and the finding was that the absence is CORRECT. A card greeting the congregation with a
  // children's control they have nothing to do with is exactly the dead end that finding ruled out.
  const t = today();
  assert.equal(reads(t.tree), '', 'the card put words on the screen for a member who brings no children');
  const s = reads(t.screen()).toLowerCase();
  for (const w of ['we’re here', 'children’s worker', 'bringing']) {
    assert.ok(!s.includes(w), 'THE TODAY SCREEN RAISES CHECK-IN WITH SOMEBODY WHO HAS NOTHING TO DO WITH IT ("' + w + '")');
  }
  assert.match(said(t.screen()), /St Chad/, 're-anchor: the Today screen rendered nothing at all, so the absence above is vacuous');
});

test('ticking the box but typing no names shows nothing — an empty code is a dead end at a door', () => {
  const t = today({ seed: { ['trinityone.bringkids.' + CHURCH + '|' + ME]: '1' } });
  assert.equal(reads(t.tree), '', 'a card was offered with no children on it');
});

test('names typed but the box NOT ticked shows nothing', () => {
  const t = today({ seed: { ['trinityone.mykidnames.' + CHURCH + '|' + ME]: JSON.stringify(['Milo']) } });
  assert.equal(reads(t.tree), '', 'the card ignored the member’s own answer');
});

test('OUT OF WINDOW there is no card — on six days out of seven, and before and after the service on the seventh', () => {
  for (const [when, now] of [['before the window opens', BEFORE], ['after it closes', WIN.until + 60]]) {
    const t = today({ seed: READY, now });
    assert.equal(reads(t.tree), '', 'the card was on screen ' + when + ' — the relay would refuse the arrival');
  }
  // …and a church with no services at all never sees it.
  assert.equal(reads(today({ seed: READY, services: [] }).tree), '', 'a church with no service in its calendar was offered a children’s room');
});

// ══════════════ AND IT IS THERE WHEN ALL THREE ARE TRUE ═══════════════════════════════════════════════════
test('THE BUTTON IS ON THE SCREEN, naming the children this phone holds', () => {
  const t = today({ seed: READY });
  const c = reads(t.tree);
  assert.equal(shownButton(t.tree, 'We’re here').length, 1,
    'THERE IS NO WAY TO SAY "WE’RE HERE". Fellowship.writeArrival had no product caller at all before this ' +
    'slice; a writer with no screen is the rule-1 failure verbatim. Screen read: ' + c);
  assert.match(c, /Milo/, 'the card does not name the children, so a parent cannot tell it means them');
  assert.match(c, /Ivy/);
  assert.deepEqual(glued(t.tree), [], 'two pieces of copy run together with no space between them');
  // AND IT IS ON THE TODAY SCREEN, not only in a component nobody renders.
  assert.equal(shownButton(t.screen(), 'We’re here').length, 1,
    'THE CARD IS NOT WIRED INTO TodayScreen — every assertion above is then about a component no member sees.');
});

test('tapping it writes an arrival for the session whose window contains NOW, and nothing else', async () => {
  const t = today({ seed: READY });
  await t.click('We’re here');
  assert.deepEqual(t.arriveCalls, [{ session: 'svc-am' }],
    'the tap did not reach Fellowship.writeArrival with this service’s id and nothing else');
});

test('two services, and the one that has started is the one announced', async () => {
  // Under the `day` lifetime both a 09:00 and an 11:00 service run to local midnight, so after 11:00 BOTH
  // windows contain now. A first-match would announce an eleven-o'clock family at the nine-o'clock room.
  const at11 = Math.floor(new Date(2026, 8, 13, 11, 30, 0, 0).getTime() / 1000);
  const t = today({ seed: READY, now: at11, services: [SERVICE, LATE] });
  await t.click('We’re here');
  assert.deepEqual(t.arriveCalls, [{ session: 'svc-late' }], 'the family was announced at the wrong room');
});

// ══════════════ THE QR ═════════════════════════════════════════════════════════════════════════════════════
test('the code appears only AFTER the arrival is written, and carries the names and the pubkey', async () => {
  const t = today({ seed: READY });
  assert.equal(t.qrTexts.length, 0,
    'THE CODE WAS DRAWN BEFORE THE ARRIVAL WAS WRITTEN. The worker matches it against a live arrival, so a ' +
    'code shown first is one she can only ever report as unknown.');
  await t.click('We’re here');
  assert.equal(t.qrTexts.length >= 1, true, 'no code was drawn after the arrival was written');
  const payload = JSON.parse(t.qrTexts[t.qrTexts.length - 1]);
  assert.deepEqual(Object.keys(payload).sort(), ['c', 'g', 'v'], 'the code carries a field beyond { v, g, c }');
  assert.equal(payload.g, ME, 'the code does not name this phone’s own public key, so the worker matches it to nobody');
  assert.deepEqual(payload.c, ['Milo', 'Ivy']);
  assert.ok(shown(t.tree, n => n.props && n.props.dangerouslySetInnerHTML).length === 1, 'the drawn code is not on the screen');
  assert.match(reads(t.tree), /Show this to the children’s worker/i, 'nothing tells the parent what the square is for');
});

test('a phone that cannot draw a code says so, and still points at the desk', async () => {
  const t = today({ seed: READY, qrRenderer: false });
  await t.click('We’re here');
  assert.match(reads(t.tree), /names/i, 'a phone with no QR renderer showed a parent a blank panel');
  assert.ok(!shown(t.tree, n => n.props && n.props.dangerouslySetInnerHTML).length, 'an empty square was painted');
});

// ══════════════ ALL THREE OUTCOMES ARE SAID IN WORDS ══════════════════════════════════════════════════════
test('REFUSED WITH NO MEASURED CAUSE NAMES NO CAUSE, AND DOES NOT BLAME THE CHURCH', async () => {
  // `_PUB_REFUSED` is /^(error|blocked|invalid|restricted|rate-limited|auth-required)/, so `refused` covers
  // at least four different things: a phone whose clock is more than ten minutes out fails NIP-42 and gets
  // `auth-required`, an unauthenticated or PIN-locked socket gets `restricted`, a member the church has
  // BLOCKED gets `blocked`, and a church with no children's room for this service gets a refusal too. This
  // sentence used to assert the last of those for all of them. Same mistake and same rule as
  // scripts/a-refused-proof-does-not-accuse-the-clock-or-the-member.test.mjs, one document over.
  const t = today({ seed: READY, arriveResult: { ok: false, reason: 'refused' }, clockIsWrong: false });
  await t.click('We’re here');
  const c = reads(t.tree);
  assert.ok(!/hasn’t opened/i.test(c) && !/children’s room for this service/i.test(c),
    'THE CARD BLAMED THE CHURCH FOR A REFUSAL IT HAS NOT DIAGNOSED. A blocked member, a locked socket and a ' +
    'wrong clock all land here. Screen read: ' + c);
  assert.ok(!/clock/i.test(c),
    'the clock was blamed with nothing measured — the half of the precedent that hands a blocked member a ' +
    'number to chase');
  assert.match(c, /desk/i, 'a refused arrival left the parent with nothing to do');
  assert.ok(!shown(t.tree, n => n.props && n.props.dangerouslySetInnerHTML).length,
    'A CODE WAS SHOWN AFTER A REFUSED ARRIVAL. The worker has nothing to match it against; holding it up ' +
    'wastes the one minute a parent has at a door.');
  assert.equal(shownButton(t.tree, 'We’re here').length, 1, 'there is no way to try again');
});

test('…and when the clock IS measured wrong, it says so, with the number and the direction', async () => {
  // The measured skew is the only honest discriminator this client has, and where it exists it is the most
  // useful thing on the screen: it is the one cause a parent can actually do something about.
  const t = today({ seed: READY, arriveResult: { ok: false, reason: 'refused' },
                    clockIsWrong: true, clockSkewMins: 15, clockSkewAhead: true });
  await t.click('We’re here');
  const c = reads(t.tree);
  assert.match(c, /clock/i, 'the measured cause is not stated, so the parent cannot act on it');
  assert.match(c, /15/, 'the measured skew is not shown');
  assert.match(c, /ahead of/, 'the direction is not shown');
  assert.match(c, /desk/i, 'naming the clock replaced the thing that actually gets the child into the room');
  const b = today({ seed: READY, arriveResult: { ok: false, reason: 'refused' },
                    clockIsWrong: true, clockSkewMins: 9, clockSkewAhead: false });
  await b.click('We’re here');
  assert.match(reads(b.tree), /behind/, 'a phone running slow was told it was running fast');
});

test('UNCONFIRMED IS NOT A FAILURE — it may well have landed, and the code stays up', async () => {
  // Device finding F1, reference/DEVICE-VERIFICATION-two-phone-2026-09-11.md: writeArrival reported
  // {ok:false} TWICE on writes that had SUCCEEDED, because _publishAny throws when NOBODY ANSWERS as well as
  // when a relay refuses. A parent sent to the desk to report a failure that did not happen is its own harm.
  const t = today({ seed: READY, arriveResult: { ok: false, reason: 'unconfirmed' } });
  await t.click('We’re here');
  const c = reads(t.tree);
  assert.equal(shown(t.tree, n => n.props && n.props.dangerouslySetInnerHTML).length, 1,
    'THE CODE WAS WITHHELD ON AN UNCONFIRMED ARRIVAL. "Nobody answered" is not "it did not send" — the ' +
    'event is signed, on the wire, and may already be on the worker’s screen.');
  assert.match(c, /couldn’t confirm/i, 'the parent was not told the arrival is unconfirmed');
  assert.ok(!/did ?n[o’']t reach/i.test(c),
    'AN UNCONFIRMED ARRIVAL IS WORDED AS A FAILED SEND. Screen read: ' + c);
  assert.match(c, /desk/i, 'the unconfirmed state does not say what to do if the worker cannot see them');
});

test('a refusal at the NINE o’clock room is not still on screen over the ELEVEN o’clock button', async () => {
  // A church with two services is what makes this visible, and it is the ordinary shape rather than an
  // exotic one. Every one of the three outcomes is pinned to the session it was answered for; without that,
  // a parent who was refused at the morning room reads that refusal as being about the room they are now
  // standing outside, and goes to the desk when they did not need to.
  const at11 = Math.floor(new Date(2026, 8, 13, 11, 30, 0, 0).getTime() / 1000);
  const t = today({ seed: READY, services: [SERVICE, LATE], arriveResult: { ok: false, reason: 'refused' } });
  await t.click('We’re here');
  assert.match(reads(t.tree), /desk/i, 're-anchor: the morning refusal was never worded, so the absence below is vacuous');
  t.setNow(at11);
  const c = reads(t.tree);
  assert.equal(shownButton(t.tree, 'We’re here').length, 1, 'the button did not come back for the second service');
  assert.ok(!/desk/i.test(c),
    'THE MORNING ROOM’S REFUSAL IS STILL ON SCREEN OVER THE LATE-MORNING BUTTON. Screen read: ' + c);
});

test('any other refusal is loud, and never reads as success', async () => {
  for (const reason of ['no-identity', 'unavailable', 'seal-failed', 'threw']) {
    const t = today({ seed: READY, arriveResult: { ok: false, reason } });
    await t.click('We’re here');
    const c = reads(t.tree);
    assert.match(c, /desk/i, reason + ' left the parent with nothing to do');
    assert.ok(!shown(t.tree, n => n.props && n.props.dangerouslySetInnerHTML).length, reason + ' still showed a code');
  }
});

test('and if the app shell has no transport at all, the button still SAYS something', async () => {
  // A control that does nothing and reports nothing is the worst of the three things this card can be, and
  // it is the shape a shell that has not finished loading produces. Driven by removing ctx.checkinArrive
  // outright rather than by making it fail, because those are two different code paths.
  const t = today({ seed: READY });
  delete t.ctx.checkinArrive;
  await t.click('We’re here');
  assert.match(reads(t.tree), /desk/i,
    'THE BUTTON DID NOTHING AND SAID NOTHING. A parent tapping at a door with no response is the silent-blank ' +
    'shape this codebase keeps paying for.');
});

// ══════════════ AND THE SETTINGS SHEET THAT FEEDS IT ══════════════════════════════════════════════════════
// The card above is unreachable unless a member can actually say they bring children and type the names.
// Driven on the RENDERED sheet, over the same shipped engine and the same little storage.
function settings({ seed = {}, keyed = true } = {}) {
  const { React, draw } = miniReact();
  const ls = store(seed);
  const F = fellowship(ls, { v: IN_WINDOW }, keyed);
  const globals = {
    React,
    window: { Fellowship: F, TrinityIdentity: { qrSVG: () => '' }, Capacitor: { isNativePlatform: () => false },
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage: ls, innerWidth: 390,
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '', clipboard: { writeText: async () => {} } },
    localStorage: ls,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console, fetch: async () => ({ ok: false }),
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), UserAvatar: Stub('UserAvatar'), AvatarPicker: Stub('AvatarPicker'),
    QRScanner: Stub('QRScanner'), BackupCard: Stub('BackupCard'), ChurchBadge: Stub('ChurchBadge'),
    Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
    BottomSheet: ({ open, children }) => (open ? children : null),
    // The toggle row itself belongs to app/screens-extras.jsx. A PASSTHROUGH, not a stub: miniReact cannot
    // render the children of a stubbed component, and a stub here would swallow the switch under test.
    NotifToggleRow: function NotifToggleRow(p) {
      return React.createElement('div', {},
        React.createElement('div', {}, p.label),
        React.createElement('div', {}, p.sub || ''),
        React.createElement('button', { role: 'switch', 'aria-checked': !!p.on, 'aria-label': String(p.label) + (p.on ? ' (on)' : ' (off)'), onClick: () => p.onFlip() }, ' '));
    },
    safeCssColor: (c) => c, lsGet: (k, d) => d, lsSet: () => {},
    Math, Date, JSON, Set, Map, Number, String, Array, Promise, Object, isNaN, Boolean, parseInt, parseFloat,
  };
  const mod = loadScreen('app/identity.jsx', ['ChildrenAtChurchSheet'], globals);
  const ctx = { church: { id: 'c1', name: "St Chad's", npub: CHURCH }, safeguard: {}, toast() {}, openHelp() {} };
  const api = { ls, F, ctx };
  api.redraw = () => { api.tree = draw(mod.ChildrenAtChurchSheet, { open: true, onClose() {}, ctx }); return api.tree; };
  api.redraw();
  api.press = (label) => {
    const b = shownButton(api.tree, label);
    assert.equal(b.length, 1, 'expected one control reading ' + JSON.stringify(label) + ', found ' + b.length);
    b[0].props.onClick();
    return api.redraw();
  };
  api.switchOn = (label) => {
    const b = shown(api.tree, n => n.type === 'button' && n.props && String(n.props['aria-label'] || '').startsWith(label));
    assert.equal(b.length, 1, 'expected one switch labelled ' + JSON.stringify(label) + ', found ' + b.length);
    b[0].props.onClick();
    return api.redraw();
  };
  api.type = (label, value) => {
    const i = shown(api.tree, n => n.type === 'input' && n.props && n.props['aria-label'] === label);
    assert.equal(i.length, 1, 'expected one input labelled ' + JSON.stringify(label) + ', found ' + i.length);
    i[0].props.onChange({ target: { value } });
    return api.redraw();
  };
  return api;
}

test('a member can say they bring children and type the names — and it is stored LOCALLY, under their own key', () => {
  const s = settings();
  assert.match(reads(s.tree), /I bring children to church/i, 'there is no way to say you bring children');
  s.switchOn('I bring children to church');
  assert.equal(s.F.bringsChildren(CHURCH), true, 'the switch did not reach the engine');
  s.type('A child’s name', 'Milo');
  s.press('Add');
  s.type('A child’s name', 'Ivy');
  s.press('Add');
  assert.deepEqual(s.F.myChildNames(CHURCH), ['Milo', 'Ivy'], 'the typed names did not reach the engine');
  assert.match(reads(s.tree), /Milo/, 'a saved name is not shown back on the sheet');
  // AND NOTHING ELSE WAS WRITTEN ANYWHERE. The two local slots, named for this church and this member.
  assert.deepEqual(Object.keys(s.ls.v).sort(), ['trinityone.bringkids.' + CHURCH + '|' + ME,
                                                'trinityone.mykidnames.' + CHURCH + '|' + ME].sort(),
    'the sheet wrote somewhere other than the two local slots: ' + JSON.stringify(Object.keys(s.ls.v)));
  assert.deepEqual(glued(s.tree), [], 'two pieces of copy run together with no space between them');
});

test('the sheet says, in words, that the names stay on the phone', () => {
  // A promise the code keeps is worth making; scripts/a-parents-children-stay-on-their-own-phone.test.mjs
  // runs the setters with every publishing path replaced by a proxy that throws, so this sentence is not an
  // overclaim. It is here because a parent typing a child's name deserves to be told where it goes.
  const s = settings({ seed: { ['trinityone.bringkids.' + CHURCH + '|' + ME]: '1' } });
  const t = reads(s.tree);
  assert.match(t, /stay on this phone/i, 'the sheet does not say where a child’s name goes');
  assert.match(t, /never sent/i, 'the sheet does not say the church is not told');
});

test('a name can be taken off again', () => {
  const s = settings({ seed: { ['trinityone.bringkids.' + CHURCH + '|' + ME]: '1',
                               ['trinityone.mykidnames.' + CHURCH + '|' + ME]: JSON.stringify(['Milo', 'Ivy']) } });
  s.press('Remove Milo');
  assert.deepEqual(s.F.myChildNames(CHURCH), ['Ivy'], 'a child could not be taken off the list');
});

test('turning the switch back off leaves the card off the Today screen', () => {
  const s = settings({ seed: { ...READY } });
  s.switchOn('I bring children to church');
  assert.equal(s.F.bringsChildren(CHURCH), false, 'the switch would not turn off');
  // …and the card, over the SAME storage, is gone.
  const t = today({ seed: s.ls.v });
  assert.equal(reads(t.tree), '',
    'THE CARD IGNORED A MEMBER TURNING THE FEATURE OFF. The toggle is the only control they have over it.');
});

test('NO TIMER IS ARMED ON THE PHONE OF A MEMBER WHO BRINGS NO CHILDREN', () => {
  // This card is mounted on Today for EVERY member of every church and returns null for almost all of them.
  // An unconditional interval is therefore a sixty-second wakeup, for ever, on the phone of everybody who
  // has nothing to do with children's work — a battery cost for exactly the audience this product is built
  // for. It is also what hung scripts/a-parent-sees-their-own-childs-pickup-code.test.mjs for twelve minutes:
  // miniReact runs no cleanups, so one live interval keeps `node --test` alive and the run never ends.
  const plain = today();
  plain.screen();
  assert.deepEqual(plain.timers, [],
    'A REPEATING TIMER WAS ARMED FOR A MEMBER WHO HAS NOTHING TO DO WITH CHECK-IN (' + plain.timers.length + ').');
  // …and the parent who DID opt in still gets one, so the line above is a condition and not a deletion.
  const parent = today({ seed: READY });
  assert.ok(parent.timers.length >= 1,
    'the parent who brings children got NO timer either, so a service coming into window while the app is ' +
    'open would never show them the button');
});

test('a PIN-LOCKED phone does not show a name as added when nothing was stored', () => {
  // `setMyChildNames` writes nothing when `_mayCache()` is false — a locked boot keeps PUB_KEY on purpose, so
  // the member is still identifiable while the app is locked. Setting state from that function's RETURN value
  // painted the name as saved AND, in the same breath, an error saying it was already on the list: two
  // contradictory things at once, and the name gone at the next open. What is on screen is now read back off
  // disk. Driven through the SHIPPED `_mayCache` rather than a stubbed setter.
  const s = settings({ seed: { ['trinityone.bringkids.' + CHURCH + '|' + ME]: '1' }, keyed: false });
  s.type('A child’s name', 'Milo');
  s.press('Add');
  const t = reads(s.tree);
  assert.deepEqual(s.F.myChildNames(CHURCH), [], 're-anchor: the locked phone stored the name after all');
  assert.equal(shownButton(s.tree, 'Remove Milo').length, 0,
    'THE NAME WAS SHOWN AS SAVED WHEN NOTHING WAS WRITTEN. It is gone at the next open and the parent has no ' +
    'way to know. Screen read: ' + t);
  assert.match(t, /didn’t save/i,
    'a write that did not happen was reported as a duplicate, or as nothing at all: ' + t);
  assert.ok(!/already on the list/i.test(t),
    'the contradictory pair is still on screen: the name added AND "that name is already on the list"');
});

test('…and on an unlocked phone the same control still says so when the list is full', () => {
  // The other branch of the same three-way answer, so the row above is not just "everything errors now".
  const full = Array.from({ length: 12 }, (_, i) => 'Child ' + i);
  const s = settings({ seed: { ['trinityone.bringkids.' + CHURCH + '|' + ME]: '1',
                               ['trinityone.mykidnames.' + CHURCH + '|' + ME]: JSON.stringify(full) } });
  s.type('A child’s name', 'Milo');
  s.press('Add');
  assert.match(reads(s.tree), /already on the list, or the list is full/i,
    'a thirteenth child vanished with no word said');
});
