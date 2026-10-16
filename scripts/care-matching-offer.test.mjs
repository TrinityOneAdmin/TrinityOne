// CARE MATCHING: a steward OFFERS a ready-to-help member one open day of a care need; the member accepts in one tap.
//   Run: node --test scripts/care-matching-offer.test.mjs
//
// Owner-approved design (2026-10-16). Nothing here needs a relay change: it all rides existing documents.
//   1. AVAILABILITY DATES  - "when I'm free" {from,to} on the sealed careavail doc (CareAvailability -> care.setAvail
//      -> Fellowship.setCareAvail; read back by Fellowship.subscribeCareAvail and StewardMeals.subscribeCareAvail).
//   2. ENVELOPE            - the v:1 DM envelope gains optional co:{n,d}; the sentence in `t` still carries every fact.
//   3. MEMBER ACCEPT       - DMThread draws "Accept this day" under an offer; careOfferVerdict decides, at render.
// The console half (StewReadyToHelp day picker, careOpenNeeds.openDays, careInvite meta) is in
// scripts/care-ready-to-help.test.mjs, beside the tests it extends.
//
// WHAT DRIVES WHAT (CLAUDE.md rules 1 and 3): the engine pieces are lifted from the SHIPPED bundles (vendor/*.js);
// the screens (app/*.jsx ship unbundled) are compiled and RUN through render-jsx-screen.mjs. Nothing here matches
// text in app/*.jsx. Every screen test goes red if its control is removed from the screen (sabotage recorded in
// the commit message).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScreen, miniReact, texts, find, button, reads } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const FEL = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');
const STW = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));
const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };
const ME = 'a'.repeat(64), PEER = 'b'.repeat(64), CHURCH = 'c'.repeat(64);
const TODAY = '2026-10-16';

// ── 1a. ENGINE: the availability doc carries dates only when they are a real window ─────────────────────────
function liftSetCareAvail() {
  const published = [];
  const scope = {
    sk: new Uint8Array(32).fill(3), _nameKeys: new Map([[CHURCH, ['k']]]),
    publishSetFor: () => [], _publishAny: async (_s, evt) => { published.push(evt); }, _pubReason: () => 'x',
    _sealChurchDocMember: (_cp, obj) => JSON.stringify(obj),   // the seal is not under test; the CONTENT is
    CAREAVAIL_D: 'trinityone/careavail:', NET: 'trinityone',
    window: { Fellowship: { churchPub: CHURCH, ready: Promise.resolve() } },
  };
  const body = fnBody(FEL, 'async setCareAvail(tags, note, dates) {', 'setCareAvail');
  scope[(body.match(/\b(finalizeEvent\d*)\(/) || [])[1]] = (t) => t;   // the bundle renames it (finalizeEvent2)
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(String(k) in globalThis), get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('stub ' + String(k)); } });
  const fn = new Function('scope', `with (scope) { return ({ ${body} }).setCareAvail; }`)(proxy);
  return { fn, published, doc: () => JSON.parse(published[published.length - 1].content) };
}
test('ENGINE: setCareAvail writes {dates} only for a real window; a 2-argument call is byte-for-byte the old doc', async () => {
  const w = liftSetCareAvail();
  await w.fn(['meals'], 'note');
  assert.deepEqual(w.doc(), { available: true, tags: ['meals'], note: 'note' }, 'a 2-arg caller must keep writing exactly what it always wrote');
  await w.fn(['meals'], 'note', { from: '2026-10-20', to: '2026-10-25' });
  assert.deepEqual(w.doc().dates, { from: '2026-10-20', to: '2026-10-25' });
  for (const bad of [null, undefined, {}, { from: '2026-10-20' }, { to: '2026-10-25' }, { from: '2026-10-25', to: '2026-10-20' }, { from: 'tomorrow', to: 'later' }, 'x']) {
    await w.fn(['meals'], 'n', bad);
    assert.ok(!('dates' in w.doc()), 'an invalid window was written: ' + JSON.stringify(bad));
  }
  await w.fn([], '', { from: '2026-10-20', to: '2026-10-20' });
  assert.deepEqual(w.doc().dates, { from: '2026-10-20', to: '2026-10-20' }, 'a single day (from == to) is a valid window');
});

// ── 1b. ENGINE: the member-side reader reports dates, null when the doc has none ────────────────────────────
test('ENGINE: Fellowship.subscribeCareAvail rows carry dates; a doc WITHOUT dates reads dates:null (backwards compat)', () => {
  let handlers = null;
  const scope = {
    toPub: (x) => x, CAREAVAIL_D: 'trinityone/careavail:',
    _onChurchDocs: (_pk, h) => { handlers = h; return () => {}; },
    _openChurchDoc: (_pk, c) => JSON.parse(c),
  };
  const body = fnBody(FEL, 'subscribeCareAvail(churchNpub, cb) {', 'subscribeCareAvail');
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(String(k) in globalThis), get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('stub ' + String(k)); } });
  const sub = new Function('scope', `with (scope) { return ({ ${body} }).subscribeCareAvail; }`)(proxy);
  const out = []; sub(CHURCH, (l) => out.push(l));
  const ev = (pubkey, obj, at) => ({ pubkey, created_at: at, tags: [['d', 'trinityone/careavail:' + CHURCH]], content: JSON.stringify(obj) });
  handlers.onevent(ev('p1'.padEnd(64, '1'), { available: true, tags: ['meals'], note: 'x' }, 10), 'trinityone/careavail:' + CHURCH);
  handlers.onevent(ev('p2'.padEnd(64, '2'), { available: true, tags: [], note: '', dates: { from: '2026-10-20', to: '2026-10-25' } }, 11), 'trinityone/careavail:' + CHURCH);
  handlers.onevent(ev('p3'.padEnd(64, '3'), { available: true, tags: [], note: '', dates: { from: '2026-10-25', to: '2026-10-20' } }, 12), 'trinityone/careavail:' + CHURCH);
  handlers.oneose();
  const rows = out[out.length - 1];
  assert.equal(rows.find(r => r.pubkey.startsWith('p1')).dates, null, 'a doc without dates must read dates:null');
  assert.deepEqual(rows.find(r => r.pubkey.startsWith('p2')).dates, { from: '2026-10-20', to: '2026-10-25' });
  assert.equal(rows.find(r => r.pubkey.startsWith('p3')).dates, null, 'a backwards window from a modified build must read as no window');
});

// ── 1c. SCREEN: CareAvailability — the two date inputs, validation, clearing ────────────────────────────────
function availCard({ mine = null, setAvail } = {}) {
  const { React, draw } = miniReact();
  const globals = {
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    ChurchBadge: Stub('ChurchBadge'), SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    lsGet: (k, d) => d, lsSet: () => {}, cx: (...a) => a.filter(Boolean).join(' '),
    useTrinityAudio: () => ({ track: null, playing: false }), todayISO: () => TODAY,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 360, Fellowship: { myPubkey: ME, churchPub: CHURCH },
      TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
      Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) } },
  };
  const { CareAvailability } = loadScreen('app/screens-today.jsx', ['CareAvailability'], globals);
  const calls = [], toasts = [];
  const ctx = { toast: (t) => toasts.push(String(t)), safeguard: { isMinor: false, minors: [] },
    care: { myPub: ME, avail: mine ? [mine] : [], setAvail: setAvail || (async (...a) => { calls.push(a); return { ok: true }; }), clearAvail: async () => ({ ok: true }) } };
  if (setAvail) ctx.care.setAvail = (...a) => { calls.push(a); return setAvail(...a); };
  const props = { ctx, part: 'mine' };
  let tree = draw(CareAvailability, props); tree = draw(CareAvailability, props);
  const redraw = () => (tree = draw(CareAvailability, props));
  const input = (label) => find(redraw(), n => n.type === 'input' && n.props && n.props['aria-label'] === label)[0];
  const type = (label, value) => { input(label).props.onChange({ target: { value } }); };
  const click = (label) => { const b = button(redraw(), label)[0]; assert.ok(b, 'no "' + label + '" button. Screen: ' + reads(redraw())); return b.props.onClick(); };
  return { calls, toasts, input, type, click, read: () => reads(redraw()), redraw };
}
const MINE = { pubkey: ME, tags: ['meals'], note: 'evenings', ts: 5, dates: null };

test('AVAIL SCREEN: the edit form has "Free from" and "Free until" date inputs, and saving passes {from,to} as the 3rd argument', async () => {
  const c = availCard();
  c.click('I’m here to help');
  assert.ok(c.input('Free from') && c.input('Free until'), 'the date inputs are not on the screen');
  c.type('Free from', '2026-10-20'); c.type('Free until', '2026-10-25');
  await c.click('I’m available'); await tick();
  assert.equal(c.calls.length, 1);
  assert.deepEqual(c.calls[0][2], { from: '2026-10-20', to: '2026-10-25' });
  assert.deepEqual(c.calls[0][0], []); assert.equal(c.calls[0][1], '');
});
test('AVAIL SCREEN: leaving both blank saves with dates null (the old behaviour)', async () => {
  const c = availCard();
  c.click('I’m here to help'); await c.click('I’m available'); await tick();
  assert.equal(c.calls.length, 1); assert.equal(c.calls[0][2], null);
});
test('AVAIL SCREEN: an invalid range (from after to) or a half-filled one is NOT written, and the member is told', async () => {
  for (const [f, t] of [['2026-10-25', '2026-10-20'], ['2026-10-20', ''], ['', '2026-10-20']]) {
    const c = availCard();
    c.click('I’m here to help'); c.type('Free from', f); c.type('Free until', t);
    await c.click('I’m available'); await tick();
    assert.equal(c.calls.length, 0, 'wrote an invalid window: ' + f + ' / ' + t);
    assert.ok(c.toasts.some(x => /Check your dates/.test(x)), 'no explanation was given');
    assert.ok(c.input('Free from'), 'the form closed over a rejected save');
  }
});
test('AVAIL SCREEN: an existing window seeds the inputs, shows on the card, and "Clear dates" saves null', async () => {
  const c = availCard({ mine: { ...MINE, dates: { from: '2026-10-20', to: '2026-10-25' } } });
  assert.match(c.read(), /free 20–25 Oct/, 'the listed card does not show when the member is free');
  c.click('Edit');
  assert.equal(c.input('Free from').props.value, '2026-10-20'); assert.equal(c.input('Free until').props.value, '2026-10-25');
  c.click('Clear dates');
  assert.equal(c.input('Free from').props.value, ''); assert.equal(c.input('Free until').props.value, '');
  await c.click('Save'); await tick();
  assert.equal(c.calls[0][2], null, 'clearing the dates did not clear them');
});

// ── 2. ENVELOPE: co round-trips through BOTH shipped engines, and an old reader still gets the words ────────
const felWrap = fnBody(FEL, '_dmWrap(text, replyTo, meta) {', '_dmWrap');
const felUnwrap = fnBody(FEL, '_dmUnwrap(body) {', '_dmUnwrap');
const fel = new Function(`return ({ ${felWrap}, ${felUnwrap} });`)();
const stw = new Function(`${fnBody(STW, 'var _dmWrap = (text, replyTo, meta) => {', '_dmWrap')}\n${fnBody(STW, 'var _dmUnwrap = (body) => {', '_dmUnwrap')}\nreturn { _dmWrap, _dmUnwrap };`)();
const oldUnwrap = (body) => {   // the member build installed BEFORE this feature
  if (typeof body !== 'string' || body[0] !== '{') return { text: body, replyTo: null };
  try { const o = JSON.parse(body); if (o && o.v === 1 && typeof o.t === 'string') return { text: o.t, replyTo: o.r || null }; } catch (e) {}
  return { text: body, replyTo: null };
};
for (const [who, e] of [['member app', fel], ['console', stw]]) {
  test(`ENVELOPE (${who}): careOffer survives wrap -> unwrap; invalid offers are dropped; absent stays absent`, () => {
    const body = e._dmWrap('Could you help on Tue 20 Oct?', null, { careOffer: { needId: 'need-1', isoDate: '2026-10-20' } });
    assert.deepEqual(JSON.parse(body).co, { n: 'need-1', d: '2026-10-20' }, 'the wire form is co:{n,d}');
    const un = e._dmUnwrap(body);
    assert.deepEqual(un.careOffer, { needId: 'need-1', isoDate: '2026-10-20' });
    assert.equal(un.text, 'Could you help on Tue 20 Oct?');
    for (const bad of [{ needId: '', isoDate: '2026-10-20' }, { needId: 'n', isoDate: 'soon' }, { needId: 'n' }, {}, null, 'x']) {
      assert.equal(e._dmWrap('hi', null, { careOffer: bad }), 'hi', 'an invalid offer changed the message: ' + JSON.stringify(bad));
    }
    assert.equal(e._dmUnwrap('plain').careOffer, null);
    assert.equal(e._dmUnwrap(JSON.stringify({ v: 1, t: 'x', co: { n: 'n', d: 'junk' } })).careOffer, null, 'a junk co on the wire must read as no offer');
    assert.equal(e._dmWrap('hi', { id: 'r1' }), JSON.stringify({ v: 1, t: 'hi', r: 'r1' }), 'a reply with no offer is byte-identical to before');
    const both = e._dmUnwrap(e._dmWrap('hi', { id: 'r1' }, { noReply: true, eventId: 'ev', careOffer: { needId: 'n', isoDate: '2026-10-20' } }));
    assert.equal(both.replyTo, 'r1'); assert.equal(both.noReply, true); assert.equal(both.eventId, 'ev'); assert.equal(both.careOffer.needId, 'n');
  });
}
test('ENVELOPE: an OLD build reading an offer envelope still shows the full sentence', () => {
  const sentence = 'Hi Sam, could you help with Verity (Rides) on Tue 20 Oct? Tap “Accept this day” below.';
  for (const e of [fel, stw]) assert.equal(oldUnwrap(e._dmWrap(sentence, null, { careOffer: { needId: 'n1', isoDate: '2026-10-20' } })).text, sentence);
});
test('ENVELOPE: both engines write the same bytes for the same offer (kept in step)', () => {
  const m = { careOffer: { needId: 'n1', isoDate: '2026-10-20' } };
  assert.equal(fel._dmWrap('t', null, m), stw._dmWrap('t', null, m));
  assert.equal(fel._dmWrap('t', { id: 'r' }, { ...m, noReply: true }), stw._dmWrap('t', { id: 'r' }, { ...m, noReply: true }));
});
test('ENGINE: Steward.sendDM puts the offer INSIDE the encrypted body (4th argument)', async () => {
  const sendSrc = fnBody(STW, 'async sendDM(peerHex, content, replyTo, meta) {', 'sendDM');
  const fin = (sendSrc.match(/\b(finalizeEvent\d*)\(/) || [])[1];
  let sealed = null; const published = [];
  const scope = { sk: new Uint8Array(32).fill(7), pub: 'p'.repeat(64), NET: 'n', now: () => 5, _monotonic: (t) => t, _sOutLoad() {}, _sOutSave() {},
    _sOutbox: [], _sOutPlain: new Map(), _dmEncrypt: (_sk, _p, body) => { sealed = body; return 'ct'; }, _dmWrap: stw._dmWrap,
    publish: async (e) => { published.push(e); return true; }, [fin]: (t) => ({ ...t, id: 'id' + published.length, sig: 's' }) };
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(k in globalThis), get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined; throw new ReferenceError('stub ' + String(k)); }, set: (t, k, v) => { t[k] = v; return true; } });
  const send = new Function('scope', `with (scope) { return ({ ${sendSrc} }).sendDM; }`)(proxy);
  await send(PEER, 'Could you help?', null, { careOffer: { needId: 'n1', isoDate: '2026-10-20' } });
  assert.deepEqual(stw._dmUnwrap(sealed).careOffer, { needId: 'n1', isoDate: '2026-10-20' });
  await send(PEER, 'plain');
  assert.equal(sealed, 'plain');
});
test('ENGINE: the REAL subscribeThread delivers m.careOffer (and null for an ordinary message)', async () => {
  let handler;
  const pool = { subscribeMany: (_u, _f, h) => { handler = h; return { close() {} }; } };
  const W = { Fellowship: { relays: [] } };
  const subSrc = fnBody(FEL, 'subscribeThread(peerPub, onMsg) {', 'subscribeThread');
  const lib = new Function('pool', 'window', 'pub', 'sk', '_dmDecrypt', '_netRelays', `return ({ ${felUnwrap}, ${subSrc} });`)(pool, W, ME, new Uint8Array(32), async (_s, _p, ct) => ct, (u) => u);
  W.Fellowship._dmUnwrap = lib._dmUnwrap;
  const got = []; lib.subscribeThread(CHURCH, (m) => got.push(m));
  await handler.onevent({ id: 'o1', kind: 4, pubkey: CHURCH, tags: [], created_at: 1, content: fel._dmWrap('offer', null, { careOffer: { needId: 'n1', isoDate: '2026-10-20' } }) });
  await handler.onevent({ id: 'o2', kind: 4, pubkey: CHURCH, tags: [], created_at: 2, content: 'just words' });
  await tick();
  assert.deepEqual(got.find(m => m.id === 'o1').careOffer, { needId: 'n1', isoDate: '2026-10-20' });
  assert.equal(got.find(m => m.id === 'o2').careOffer, null);
});

// ── 3. MEMBER: DMThread draws "Accept this day" only for a live, valid offer ────────────────────────────────
const NEED = { id: 'n1', type: 'meals', displayLabel: 'Verity — meals', startDate: '2026-10-20', endDate: '2026-10-22' };
function loadToday() {
  const { React } = miniReact();
  const globals = {
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Icon: () => null, ChurchBadge: Stub('x'), SectionLabel: Stub('x'), Halo: Stub('x'), Sheet: Stub('x'), IconBtn: Stub('x'),
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null }, navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, lsGet: (k, d) => d, lsSet: () => {}, cx: () => '',
    useTrinityAudio: () => ({}), todayISO: () => TODAY, fetch: async () => ({}),
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 360, Fellowship: {}, TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
      Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({}) } },
  };
  return loadScreen('app/screens-today.jsx', ['careNeedDays'], globals);
}
const { careNeedDays } = loadToday();

function memberDM({ offer = { needId: 'n1', isoDate: '2026-10-21' }, care = {}, fill, safeguard = { isMinor: false, minors: [] }, minorState = 'adult', mineMsg = false, today = TODAY } = {}) {
  const { React, draw } = miniReact();
  const fills = [];
  const F = {
    myPubkey: ME, relays: ['wss://r'], ready: Promise.resolve(),
    subscribeThread: (_p, add) => { add({ id: 'm1', mine: mineMsg, pubkey: mineMsg ? ME : CHURCH, ts: 1760000000, content: 'Hi Sam, could you help with Verity on Wed 21 Oct? Tap “Accept this day” below.', careOffer: offer }); return () => {}; },
    outboxForPeer: () => [], onOutbox: () => () => {}, dmPlaintextOf: () => '',
    displayFor: () => ({ handle: 'Church', av: { kind: 'symbol', color: '#5E8C6A', symbol: 'halo' } }),
    requestProfiles: () => {}, reactDM: () => {}, sendDM: async () => ({}), requeue: () => true, dropQueued: () => {},
  };
  const mod = loadScreen('app/screens-chat.jsx', ['DMThread', 'careOfferVerdict'], {
    React, window: { matchMedia: () => ({ matches: true }), Fellowship: F, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => today, careNeedDays,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ children }) => children, ScreenScroll: ({ children }) => children,
    ChurchPill: () => null, UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c, relTime: () => 'now', D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = { toast() {}, canDMPeer: () => true, connTick: 0, openDM() {}, safeguard, minorState,
    care: { settings: { enabled: true }, needs: [NEED], slots: [], skips: [], avail: [], myPub: ME,
      fill: fill || (async (...a) => { fills.push(a); return { ok: true, evt: {} }; }), ...care } };
  if (fill) ctx.care.fill = (...a) => { fills.push(a); return fill(...a); };
  const props = { peer: CHURCH, open: true, onClose() {}, ctx, docked: false };
  draw(mod.DMThread, props); draw(mod.DMThread, props);
  const redraw = () => draw(mod.DMThread, props);
  const accept = () => button(redraw(), 'Accept this day')[0];
  return { fills, redraw, accept, read: () => reads(redraw()), mod, ctx };
}

test('MEMBER ACCEPT: a live offer draws "Accept this day"; tapping it claims the day\'s open meal via care.fill and says so', async () => {
  const d = memberDM();
  assert.ok(d.accept(), 'no Accept button for a valid offer. Screen: ' + d.read());
  await d.accept().props.onClick(); await tick();
  // NEED has no per-meal breakdown -> one '' unit, so one fill with meal=''.
  assert.deepEqual(d.fills, [['n1', '2026-10-21', '', '']]);
  assert.match(d.read(), /You’re signed up for that day/);
});

test('MEMBER ACCEPT: on a meals day with one meal already taken, accept claims only the OPEN meal — never a whole-day slot that would double-book', async () => {
  const mealsNeed = { id: 'n1', type: 'meals', displayLabel: 'Verity — meals', dates: ['2026-10-20', '2026-10-21', '2026-10-22'], meals: ['lunch', 'dinner'] };
  const lunchTaken = { needId: 'n1', isoDate: '2026-10-21', pubkey: 'z'.repeat(64), meal: 'lunch' };
  const d = memberDM({ care: { needs: [mealsNeed], slots: [lunchTaken] } });
  assert.ok(d.accept(), 'Dinner is open, so the day should still offer Accept. Screen: ' + d.read());
  await d.accept().props.onClick(); await tick();
  assert.deepEqual(d.fills, [['n1', '2026-10-21', '', 'dinner']],
    'accept must claim ONLY the open Dinner (meal="dinner"), never a legacy whole-day slot that covers the taken Lunch. Got: ' + JSON.stringify(d.fills));
});
test('MEMBER ACCEPT: an ordinary message, and an offer I SENT myself, get no button', () => {
  assert.equal(memberDM({ offer: null }).accept(), undefined, 'a plain message grew an Accept button');
  assert.equal(memberDM({ mineMsg: true }).accept(), undefined, 'my own outgoing offer is accepted by nobody');
});
test('MEMBER ACCEPT: NO button when the need is missing, sealed, closed/past, or the day is not one of its days', () => {
  assert.equal(memberDM({ offer: { needId: 'nope', isoDate: '2026-10-21' } }).accept(), undefined, 'an offer naming a need that does not exist');
  assert.equal(memberDM({ care: { needs: [{ ...NEED, _sealed: true }] } }).accept(), undefined, 'sealed need');
  assert.equal(memberDM({ care: { needs: [{ ...NEED, endDate: '2026-10-15', startDate: '2026-10-14' }] }, offer: { needId: 'n1', isoDate: '2026-10-14' } }).accept(), undefined, 'a need that has ended');
  assert.equal(memberDM({ offer: { needId: 'n1', isoDate: '2026-10-29' } }).accept(), undefined, 'a date that is not one of the need\'s days');
  assert.equal(memberDM({ care: { needs: [] } }).accept(), undefined, 'a need that has been removed');
  assert.equal(memberDM({ care: { settings: { enabled: false } } }).accept(), undefined, 'care switched off');
});
test('MEMBER ACCEPT: NO button when the day is taken (by anyone) or skipped', () => {
  assert.equal(memberDM({ care: { slots: [{ needId: 'n1', isoDate: '2026-10-21', pubkey: PEER }] } }).accept(), undefined, 'taken by someone else');
  assert.equal(memberDM({ care: { slots: [{ needId: 'n1', isoDate: '2026-10-21', pubkey: ME }] } }).accept(), undefined, 'already mine');
  assert.equal(memberDM({ care: { skips: [{ needId: 'n1', isoDate: '2026-10-21' }] } }).accept(), undefined, 'skipped by the care team');
  assert.ok(memberDM({ care: { slots: [{ needId: 'n1', isoDate: '2026-10-20', pubkey: PEER }] } }).accept(), 'CONTROL: a DIFFERENT day being taken must not hide this one');
});
test('MEMBER ACCEPT (expiry): no button once the offered day has passed, or my own free window has ended; computed at render', () => {
  assert.equal(memberDM({ today: '2026-10-22' }).accept(), undefined, 'the day (21 Oct) is in the past on 22 Oct');
  assert.ok(memberDM({ today: '2026-10-21' }).accept(), 'CONTROL: the offered day itself is still acceptable');
  const over = { pubkey: ME, tags: [], note: '', dates: { from: '2026-10-10', to: '2026-10-15' } };
  assert.equal(memberDM({ care: { avail: [over] } }).accept(), undefined, 'my availability window ended 15 Oct');
  assert.ok(memberDM({ care: { avail: [{ ...over, dates: { from: '2026-10-10', to: '2026-10-21' } }] } }).accept(), 'CONTROL: a window still running');
  assert.ok(memberDM({ care: { avail: [{ ...over, dates: null }] } }).accept(), 'CONTROL: an availability with no window never expires the offer');
});
test('MEMBER ACCEPT: a known child is never offered the button (and the engine backstop is the second line)', () => {
  assert.equal(memberDM({ minorState: 'minor', safeguard: { isMinor: true, minors: [ME] } }).accept(), undefined);
});
test('MEMBER ACCEPT: a child still LOADING (minorState "maybe", safeguard.isMinor STILL false) gets NO button — fail closed through the window', () => {
  // safeguard.isMinor is false for the whole ~1.2s clearance-loading window; gating on it would flash the button at a child.
  assert.equal(memberDM({ minorState: 'maybe', safeguard: { isMinor: false, minors: [] } }).accept(), undefined, 'a loading child was shown Accept while isMinor was still false');
  assert.ok(memberDM({ minorState: 'adult' }).accept(), 'CONTROL: a resolved adult is still offered the button');
});
test('MEMBER ACCEPT: the RETURNED object decides the wording, not its truthiness', async () => {
  const cases = [
    [{ ok: true, evt: {} }, /You’re signed up for that day/],
    [{ ok: false, reason: 'unconfirmed' }, /Waiting.*couldn’t confirm/],
    [{ ok: true, _queued: true }, /Waiting/],
    [{ ok: false, reason: 'minor' }, /can’t sign up for care days/],
    [{ ok: false, reason: 'timeout' }, /NOT signed up/],
    [null, /NOT signed up/],
  ];
  for (const [ret, re] of cases) {
    const d = memberDM({ fill: async () => ret });
    await d.accept().props.onClick(); await tick();
    const said = d.read();
    assert.match(said, re, JSON.stringify(ret) + ' -> ' + said);
    if (!(ret && ret.ok && !ret._queued)) assert.doesNotMatch(said, /You’re signed up for that day/, 'claimed a sign-up over ' + JSON.stringify(ret));
  }
});
test('MEMBER ACCEPT: a failed accept leaves the button so the member can try again; a thrown fill is a failure, not a crash', async () => {
  const d = memberDM({ fill: async () => ({ ok: false, reason: 'timeout' }) });
  await d.accept().props.onClick(); await tick();
  assert.ok(d.accept(), 'the retry button vanished after a failure');
  const t = memberDM({ fill: async () => { throw new Error('boom'); } });
  await t.accept().props.onClick(); await tick();
  assert.match(t.read(), /NOT signed up/);
});
test('MEMBER ACCEPT: if the day is taken between draw and tap, nothing is written and the member is told', async () => {
  const d = memberDM();
  const btn = d.accept();                    // drawn while the day was open
  d.ctx.care.slots = [{ needId: 'n1', isoDate: '2026-10-21', pubkey: PEER }];   // someone else takes it
  await btn.props.onClick(); await tick();
  assert.equal(d.fills.length, 0, 'wrote a sign-up over a day somebody else had just taken');
  assert.match(d.read(), /just been taken/);
});
test('MEMBER ACCEPT: a second tap while one is in flight does not double-submit', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const d = memberDM({ fill: async () => { await gate; return { ok: true }; } });
  const b = d.accept();
  const p1 = b.props.onClick();
  const again = button(d.redraw(), 'Signing up')[0];   // the label changes while in flight, so it is the same button under a new name
  assert.ok(again, 'the button did not show it was busy');
  const p2 = again.props.onClick();
  release(); await p1; await p2; await tick();
  assert.equal(d.fills.length, 1);
});

// ── 4. PURE: the expiry rule on its own ─────────────────────────────────────────────────────────────────────
test('PURE careOfferVerdict: every reason, in the order the rules read', () => {
  const { mod } = memberDM();
  const v = mod.careOfferVerdict;
  const care = { settings: { enabled: true }, needs: [NEED], slots: [], skips: [], avail: [], myPub: ME };
  const O = { needId: 'n1', isoDate: '2026-10-21' };
  assert.deepEqual(v(O, care, TODAY, 'adult'), { show: true, reason: '' });
  const why = (o, c, t = TODAY, m = 'adult') => v(o, c, t, m).reason;
  assert.equal(why(null, care), 'none'); assert.equal(why({ needId: 'n1' }, care), 'none');
  assert.equal(why(O, care, TODAY, 'minor'), 'minor');
  assert.equal(why(O, care, TODAY, 'maybe'), 'minor');   // loading window = fail closed
  assert.equal(why(O, { ...care, settings: {} }), 'care-off');
  assert.equal(why(O, care, '2026-10-22'), 'day-past');
  assert.equal(why({ needId: 'zz', isoDate: '2026-10-21' }, care), 'need-gone');
  assert.equal(why(O, { ...care, needs: [{ ...NEED, endDate: '2026-10-20' }] }, '2026-10-17'), 'not-a-day', 'a day outside the need is not a day (the need ended before it)');
  assert.equal(why({ needId: 'n1', isoDate: '2026-10-20' }, { ...care, needs: [{ ...NEED, endDate: '2026-10-19', startDate: '2026-10-18' }] }, '2026-10-20'), 'need-past');
  assert.equal(why(O, { ...care, slots: [{ needId: 'n1', isoDate: '2026-10-21' }] }), 'day-taken');
  assert.equal(why(O, { ...care, skips: [{ needId: 'n1', isoDate: '2026-10-21' }] }), 'day-taken');
  assert.equal(why(O, { ...care, avail: [{ pubkey: ME, dates: { from: '2026-10-01', to: '2026-10-15' } }] }), 'my-window-over');
  assert.equal(why(O, { ...care, avail: [{ pubkey: PEER, dates: { from: '2026-10-01', to: '2026-10-15' } }] }), '', 'somebody ELSE\'s window must not expire mine');
});

// ── 5. WIRING: care.setAvail (app/app.jsx) hands the dates on to the engine ─────────────────────────────────
test('WIRING: care.setAvail(tags, note, dates) calls Fellowship.setCareAvail with all three; a 2-argument call still works', async () => {
  const APP = readFileSync(join(ROOT, 'app/app.jsx'), 'utf8');
  const line = APP.split('\n').find(l => /^\s*setAvail:\s*\(/.test(l));
  assert.ok(line, 're-anchor: care.setAvail has moved');
  const seen = []; const toasts = [];
  const window = { Fellowship: { setCareAvail: async (...a) => { seen.push(a); return { ok: true }; } } };
  const care = new Function('window', 'toast', `return ({ ${line.trim().replace(/,\s*$/, '')} });`)(window, (t) => toasts.push(t));
  await care.setAvail(['meals'], 'n', { from: '2026-10-20', to: '2026-10-25' });
  assert.deepEqual(seen[0], [['meals'], 'n', { from: '2026-10-20', to: '2026-10-25' }], 'the dates were dropped on the way to the engine');
  await care.setAvail(['meals'], 'n');
  assert.equal(seen[1][2], undefined);
});
