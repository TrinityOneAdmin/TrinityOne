// THE CONSOLE DRAWS A FINANCE STATEMENT ONLY FROM THE CHURCH. Run:
//   node --test scripts/a-member-cannot-forge-a-church-statement-in-the-console.test.mjs
//
// console-finance-card-trust 2026-11-17, hole 1. Nothing on the relay restricts a ['card'] tag, and the console's
// subscribeGroupChat put ANY author's finance card on the message, so a member could hand-build a kind-1 and show
// the stewards a fake church financial statement - drawn as the church's card, quoted as "Title · period", and
// summarised as "… · Financial statement" in a pin a steward then signs as the church. The member app already
// refuses this (Fellowship.isChurchVoice); the console now applies the same rule in subscribeGroupChat's attach().
//
// Point of use (rules 1 and 3): the SHIPPED subscribeGroupChat is lifted out of vendor/steward.js (bundle names)
// and its output is fed straight into the REAL GroupChatModal + ConsoleCard (compiled from app/*.jsx with the
// build's esbuild) and rendered. Every assertion reads the drawn tree or the published pin; nothing matches source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadComponent, Stub, settle, ROOT } from './console-component-rig.mjs';
import { miniReact, texts } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const CHURCH = 'c'.repeat(64), MEMBER = 'a'.repeat(64), STEW = 'd'.repeat(64);
const ENVELOPE = {
  type: 'finance', title: 'Grace Community Church', periodLabel: 'Q3 2026',
  sections: [{ kind: 'summary', income: 1234500, expenditure: 980000, surplus: 254500 }],
  currency: 'GBP', decimals: 2, generatedAt: '2026-10-30',
};
const BODY = 'FORGED BODY TEXT';
const cardTag = (env = ENVELOPE) => ['card', '1', JSON.stringify(env)];

// The shipped engine, lifted with a minimal scope. `roster` is the live scope object, so a test can make the
// roster arrive mid-session exactly as subscribeStewards does (set the set + the flag, then poke the emitters).
function engine(src = STEWARD) {
  const body = fnBody(src, 'subscribeGroupChat(groupId, onMsgs) {', 'subscribeGroupChat');
  let onevent = null;
  const pool = { subscribeMany: (r, f, h) => { if (f.some(x => x.kinds && x.kinds.includes(1))) onevent = h.onevent; return { close() {} }; } };
  const scope = { pool, relays: () => [], pub: CHURCH, _skeys: {}, decrypt3: () => { throw new Error('no'); },
    _careRoster: new Set(), _careRosterKnown: false, _memberEmitters: new Set(),
    setTimeout: () => 0, clearTimeout() {}, Map, Set, JSON,
    window: { Steward: { subscribeHidden: (cb) => { cb(new Set()); return () => {}; } } } };
  const api = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  const ev = (id, by, content, extra = [], ts = 1) => ({ kind: 1, id, pubkey: by, content, created_at: ts, tags: [['t', 'g1'], ['p', CHURCH], ...extra] });
  return { api, scope, ev, send: (e) => onevent(e),
    rosterArrives: (pks) => { scope._careRoster = new Set(pks); scope._careRosterKnown = true; for (const f of [...scope._memberEmitters]) f(); } };
}

function loadCards(React) {
  const js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [join(ROOT, 'app/stew-cards.jsx'), '--jsx=transform', '--format=cjs', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const m = { exports: {} };
  new Function('React', 'module', 'exports', js + '\nmodule.exports = { ConsoleCard, ConsoleFinanceCard, cardRenderable };')(React, m, m.exports);
  return m.exports;
}

// The real GroupChatModal, subscribed to the lifted engine. Events are sent AFTER it subscribes, then repainted.
async function screen(eng, events, quoteCalls = []) {
  const { React, draw } = miniReact();
  const cards = loadCards(React);
  const win = {
    Steward: { pubkey: CHURCH, stewardLabels: () => ({}),
      subscribeGroupChat: (id, cb) => eng.api.subscribeGroupChat(id, cb),
      subscribeGroupPin: (id, cb) => { cb(null); return () => {}; }, subscribeGroupEvents: (id, cb) => { cb([]); return () => {}; },
      publishPost: () => Promise.resolve({ id: 'e1' }) },
    useStewardMembers: () => [{ pubkey: MEMBER, name: 'Mallory' }], useStewardChurch: () => ({ name: 'Grace Community Church', accent: '#8bd3c7' }),
    useStewardStewards: () => [], dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  };
  const replyKit = { quote: (o) => { quoteCalls.push(o); return null; }, bar: () => null, cue: () => null, style: () => ({}), dotsProps: () => ({}) };
  const mod = await loadComponent('app/stew-dashboard.jsx', ['function GroupChatModal({ group, onClose }) {', 'function groupIcon('], {
    React, window: win, CustomEvent, setTimeout, clearTimeout, document: { addEventListener() {}, removeEventListener() {} },
    TrinityReplyKit: replyKit, Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), useStewDialog: () => ({}),
    ConsoleCard: cards.ConsoleCard, ConsoleFinanceCard: cards.ConsoleFinanceCard, cardRenderable: cards.cardRenderable,
  });
  const props = { group: { id: 'g1', name: 'Whole Church', kind: 'group' }, onClose() {} };
  const paint = () => draw(mod.GroupChatModal, props);
  paint(); await settle();
  for (const e of events) eng.send(e);
  await settle(); paint(); await settle();
  return { seen: () => texts(paint()).join(' | ') };
}
const FIGURE = /£12,345\.00/;   // only the drawn card carries the figures; the body never does

test('a MEMBER-authored finance card is NOT drawn on the console - its plain body shows instead', async () => {
  const eng = engine(); eng.scope._careRoster = new Set([STEW]); eng.scope._careRosterKnown = true;
  const s = await screen(eng, [eng.ev('f1', MEMBER, BODY, [cardTag()])]);
  const seen = s.seen();
  assert.ok(!FIGURE.test(seen), 'a member-authored finance card drew the church statement on the console');
  assert.match(seen, /FORGED BODY TEXT/, 'the forged message must still show - as its plain body');
});

test("the church's own statement, and a roster steward's, still draw as the card", async () => {
  for (const by of [CHURCH, STEW]) {
    const eng = engine(); eng.scope._careRoster = new Set([STEW]); eng.scope._careRosterKnown = true;
    const s = await screen(eng, [eng.ev('f-' + by.slice(0, 2), by, BODY, [cardTag()])]);
    assert.match(s.seen(), FIGURE, 'a church-voice finance card did not draw: ' + by.slice(0, 4));
  }
});

test("before the roster is known a steward's card shows as text; it draws once the roster arrives", async () => {
  const eng = engine();
  const s = await screen(eng, [eng.ev('f1', STEW, BODY, [cardTag()])]);
  assert.ok(!FIGURE.test(s.seen()), 'fails closed: a steward card drew before any roster was read');
  assert.match(s.seen(), /FORGED BODY TEXT/);
  eng.rosterArrives([STEW]);   // what subscribeStewards does: set the roster, then _pokeMemberLists
  await settle();
  assert.match(s.seen(), FIGURE, "the roster arrived but the steward's card was never re-decided");
});

test('a reply quoting a forged card quotes its body, not "Title · period"', async () => {
  const eng = engine(); eng.scope._careRosterKnown = true;
  const quotes = [];
  await screen(eng, [eng.ev('f1', MEMBER, BODY, [cardTag()], 1), eng.ev('r1', CHURCH, 'thanks', [['e', 'f1', '', 'reply']], 2)], quotes);
  const q = quotes.map(c => c.text).filter(Boolean).join(' | ');
  assert.match(q, /FORGED BODY TEXT/, 'the quote did not show the forged message body');
  assert.ok(!/Q3 2026/.test(q), 'the quote presented a forged card as the church statement');
});

// pinPost receives the message GroupChatModal holds (window.Steward.pinPost(group.id, m)), i.e. the engine's output.
function pinOf(msg) {
  const body = fnBody(STEWARD, 'pinPost(groupId, msg) {', 'pinPost');
  let published = null;
  const scope = { sk: new Uint8Array(32), PIN_D: 'pin:', NET: 'n', pub: CHURCH, now: () => 1, feChurch: (e) => e, publish: (e) => { published = e; return Promise.resolve(e); }, Promise, JSON };
  new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope).pinPost('g1', msg);
  return JSON.parse(published.content).text;
}

test('pinning a forged card pins its body - not a church-signed "… · Financial statement"', () => {
  const eng = engine(); eng.scope._careRosterKnown = true;
  let out = []; eng.api.subscribeGroupChat('g1', (m) => { out = m; });
  eng.send(eng.ev('f1', MEMBER, BODY, [cardTag()]));
  eng.send(eng.ev('f2', CHURCH, 'real body', [cardTag()]));
  assert.equal(pinOf(out.find(m => m.id === 'f1')), BODY);
  assert.match(pinOf(out.find(m => m.id === 'f2')), /Financial statement/, 'the church statement must still pin as a summary');
});

// DELETION (rule 1, scoped sabotage): disable ONLY the author check inside subscribeGroupChat, in a copy of the
// bundle, and confirm the forged card reaches the screen again.
test('DELETION: with the author check disabled, the forged statement is drawn on the console', async () => {
  const slice = fnBody(STEWARD, 'subscribeGroupChat(groupId, onMsgs) {', 'subscribeGroupChat');
  const ANCHOR = 'const cardFor = (card, by) =>';
  assert.equal(slice.split(ANCHOR).length - 1, 1, 'the author-check anchor is not unique in subscribeGroupChat - re-scope');
  const sabSlice = slice.replace(ANCHOR, 'const cardFor = (card, by) => card; const _unused = (card, by) =>');
  const sab = STEWARD.replace(slice, sabSlice);
  assert.notEqual(sab, STEWARD, 'the sabotage replaced nothing');
  const eng = engine(sab); eng.scope._careRosterKnown = true;
  const s = await screen(eng, [eng.ev('f1', MEMBER, BODY, [cardTag()])]);
  assert.match(s.seen(), FIGURE, 'with the check gone the forged card must draw - otherwise this file is not pinned to it');
});
