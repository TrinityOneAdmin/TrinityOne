// THE SHARED-CARD AUDIT FIXES (Opus audit of 50a00d23, 2026-11-17). Run:
//   node --test scripts/a-shared-card-follows-its-audit.test.mjs
//
//   M1  a received commentary card shared OUT of the app (the real message menu → ctx.shareText) carries the FULL
//       notice, never the short in-app credit; a verse card's menu share carries no thoughts.
//   M2  a DM card whose words are not its body's draws the plain body, no card (the group half is in
//       a-shared-verse-arrives-as-a-card.test.mjs).
//   L3  the share sheet's preview shows what a GROUP gets (the short credit), says a DM gets none, and the
//       outside-the-app row says it adds the full licence.
//   L5  a roster steward's finance card read BEFORE the roster arrived becomes the card when the engine fires
//       'trinity-church-trust' - without the room re-rendering.
//   N7  the credit is >= 11px in a token with AA contrast in light and dark; bidi controls and zero-width characters
//       are stripped from card fields by the real chatShareCard, _chatCardClean, _dmWrap and _dmUnwrap.
// Real components through the mini React, real engine functions lifted from the BUILT bundle. No source-text
// assertions on app/*.jsx (CLAUDE.md rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';
import { settle } from './console-component-rig.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const READ = readFileSync(join(ROOT, 'app/screens-read.jsx'), 'utf8');
const FEL = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');
const ME = 'a'.repeat(64), ANNA = 'b'.repeat(64), CHURCH = 'c'.repeat(64), STEWARD = 'd'.repeat(64);
const FULL = 'Aquifer Open Study Notes © Mission Mutual · CC BY-SA 4.0 · an adaptation of Tyndale Open Study Notes © 2023 Tyndale House Publishers, also CC BY-SA 4.0';
const SHORT = '— Aquifer Open Study Notes © Mission Mutual, adapted from Tyndale Open Study Notes · CC BY-SA 4.0';

// the REAL commentaryFullCredit (and its table), out of app/screens-read.jsx - in the app it shares the global scope
const realRead = new Function(fnBody(READ, 'const COMMENTARY_INAPP_CREDITS = {', 'COMMENTARY_INAPP_CREDITS') + ';\n'
  + fnBody(READ, 'function commentaryFullCredit(credit) {', 'commentaryFullCredit') + '\n'
  + fnBody(READ, 'function commentaryInAppCredit(abbr, license, imported) {', 'commentaryInAppCredit') + '\nreturn { commentaryFullCredit, commentaryInAppCredit };')();

function winWithEvents() {
  const ls = {};
  return { ls, addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); }, removeEventListener(t, f) { ls[t] = (ls[t] || []).filter(x => x !== f); },
    fire(t) { (ls[t] || []).slice().forEach(f => f()); } };
}
function screen(names, F, extra = {}, counter = null) {
  const { React, draw } = miniReact();
  if (counter) {
    // Count the state SETS of the card bubble (each one is a re-render in real React), installed before the file binds
    // useState. ChatCardBubble's kind is the one state in a Bubble tree made with a LAZY initializer, which is how
    // it is told apart: useIdentity (Row's avatar, pre-existing) also re-renders on every profile event and is not
    // what this measures. `counter.states` proves the instrument saw the bubbles' state at all.
    const orig = React.useState;
    React.useState = (init) => {
      const [v, set] = orig(init);
      if (typeof init !== 'function') return [v, set];
      counter.states++;
      return [v, (x) => { counter.sets++; set(x); }];
    };
  }
  const win = Object.assign(winWithEvents(), { Fellowship: F, matchMedia: () => ({ matches: true }) });
  const mod = loadScreen('app/screens-chat.jsx', names, {
    React, window: win,
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }), UserAvatar: () => null,
    safeCssColor: (c, f) => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : (f || 'var(--clay)')),
    safeImgUrl: (v) => (typeof v === 'string' && /^data:image\//.test(v) ? v : ''),
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    commentaryFullCredit: realRead.commentaryFullCredit,
    ...extra,
  });
  return { React, draw, mod, win };
}
const ev = (card, content, by = ANNA) => ({ id: 'e1', pubkey: by, created_at: 1, tags: [['t', 'g1'], ['p', CHURCH], ['card', '1', JSON.stringify(card)]], content });
// Long-press-to-share was REMOVED (4ec93e91); onContextMenu is now only preventDefault. Sharing out of the app goes
// through VerseShareSheet ("Share outside the app" -> ctx.shareText) and a verse card's tap -> ctx.openShare.
const sheetShare = (payload, label) => {
  const F = { myPubkey: ME, publishMessage: async () => ({}), sendDM: async () => ({}),
    subscribeChurchGroups: (_c, cb) => { cb([]); return () => {}; }, subscribeChurchMembers: (_c, cb) => { cb([]); return () => {}; }, displayFor: () => ({ handle: 'x' }) };
  const s = screen(['VerseShareSheet'], F, { BottomSheet: ({ open, children }) => (open ? children : null), IconBtn: () => null, lsGet: (_k, d) => d, lsSet: () => {} });
  const shared = [];
  const props = { payload, open: true, onClose() {}, ctx: { toast() {}, church: { npub: 'n' }, canDMPeer: () => true, shareText: (...a) => shared.push(a[0]), openShare() {} } };
  s.draw(s.mod.VerseShareSheet, props);
  const tree = s.draw(s.mod.VerseShareSheet, props);
  const btn = find(tree, n => n.props && typeof n.props.onClick === 'function' && texts(n).join(' ').includes(label));
  assert.ok(btn.length >= 1, 'the share sheet has no "' + label + '" control');
  btn[btn.length - 1].props.onClick({ stopPropagation() {} });
  return shared;
};

// ── M1 ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('M1 POINT OF USE: the real share sheet Share outside the app for a commentary card goes out with the FULL notice', () => {
  const card = { type: 'commentary', ref: '2 John 1:1', source: 'Aquifer Open Study Notes', text: 'The elder.', credit: SHORT };
  // the sheet is opened with the card's short credit AND the module's full licence, as the reader supplies them
  const shared = sheetShare({ type: 'commentary', ref: card.ref, source: card.source, text: card.text, license: FULL, credit: SHORT }, 'Share outside the app');
  assert.equal(shared.length, 1);
  assert.ok(shared[0].includes(FULL), 'the outside share lacks the full notice: ' + shared[0]);
  assert.ok(!shared[0].includes(SHORT), 'the outside share still carries the short in-app credit');
  assert.ok(shared[0].includes('The elder.'));
});
test('M1: an imported notice (not the short credit) is shared out unchanged', () => {
  assert.equal(realRead.commentaryFullCredit('© X all rights reserved'), '© X all rights reserved');
  assert.equal(realRead.commentaryFullCredit(SHORT), FULL);
  assert.equal(realRead.commentaryFullCredit(realRead.commentaryInAppCredit('OSN', FULL, false)), FULL, 'the round trip short -> full is not the module notice');
});
test('M1: tapping a received verse card opens the share sheet with the verse, never the thoughts', () => {
  const VERSE = { type: 'verse', ref: 'John 3:16', text: 'For God so loved the world', version: 'BSB' };
  const s = screen(['Bubble', 'evtToMsg'], { myPubkey: ME, displayFor: () => ({ handle: 'Anna' }) });
  const opened = [];
  const tree = s.draw(s.mod.Bubble, { m: s.mod.evtToMsg(ev(VERSE, '\u201cFor God so loved the world\u201d \u2014 John 3:16 \u00b7 BSB\n\nprivate thoughts')), ctx: { church: {}, shareText() {}, openShare: p => opened.push(p) }, summary: [], live: false });
  const card = find(tree, n => n.props && n.props['data-chat-card'] === 'verse');
  assert.equal(card.length, 1, 'the verse card is not drawn');
  card[0].props.onClick({ stopPropagation() {} });
  assert.deepEqual(opened, [{ ref: 'John 3:16', text: 'For God so loved the world', version: 'BSB' }]);
  // and the context menu on the row no longer shares anything (long-press-to-share was removed)
  const cm = find(tree, n => n.props && typeof n.props.onContextMenu === 'function');
  cm.forEach(n => n.props.onContextMenu({ preventDefault() {}, stopPropagation() {} }));
  assert.equal(opened.length, 1, 'a context-menu/long-press shared something');
});

// ── M2 (DM) ───────────────────────────────────────────────────────────────────────────────────────────────────
test('M2 POINT OF USE: a DM whose card words are not its body draws the plain body and no card', async () => {
  let push = null;
  const F = { myPubkey: ME, displayFor: () => ({ handle: 'Anna', av: {} }), subscribeThread: (_p, cb) => { push = cb; return () => {}; } };
  const s = screen(['DMThread'], F, { Overlay: ({ children }) => children, IconBtn: () => null, avOf: d => d.av, confirm: () => false });
  const props = { peer: ANNA, open: true, onClose() {}, ctx: { church: {}, openShare() {}, connTick: 0 } };
  s.draw(s.mod.DMThread, props);
  push({ id: 'd1', mine: false, content: 'hello there', card: { type: 'verse', ref: 'X 1:1', text: 'words nobody moderates' }, ts: 5, pubkey: ANNA, reactions: [] });
  await settle();
  const tree = s.draw(s.mod.DMThread, props);
  assert.equal(find(tree, n => n.props && n.props['data-chat-card']).length, 0, 'an unbound card was drawn in a DM');
  assert.ok(texts(tree).includes('hello there'));
  assert.ok(!texts(tree).join(' ').includes('nobody moderates'));
});

// ── L3 ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('L3 POINT OF USE: the share sheet preview shows the short credit a group gets, says a DM gets none, and "outside" says full licence', () => {
  const F = { myPubkey: ME, publishMessage: async () => ({}), sendDM: async () => ({}),
    subscribeChurchGroups: (_c, cb) => { cb([]); return () => {}; }, subscribeChurchMembers: (_c, cb) => { cb([]); return () => {}; }, displayFor: () => ({ handle: 'x' }) };
  const s = screen(['VerseShareSheet'], F, { BottomSheet: ({ open, children }) => (open ? children : null),
    IconBtn: ({ name, onClick }) => null, lsGet: (_k, d) => d, lsSet: () => {} });
  const payload = { type: 'commentary', ref: '2 John 1:1', source: 'Aquifer Open Study Notes', text: 'The elder.', license: FULL, credit: SHORT };
  const props = { payload, open: true, onClose() {}, ctx: { toast() {}, church: { npub: 'n' }, canDMPeer: () => true, shareText() {}, openShare() {} } };
  s.draw(s.mod.VerseShareSheet, props);
  const tree = s.draw(s.mod.VerseShareSheet, props);
  const pc = find(tree, n => n.props && n.props['data-preview-credit'] === '1');
  assert.equal(pc.length, 1, 'the preview shows no credit');
  assert.equal(texts(pc[0]).filter(t => t !== '1').join(''), SHORT, 'the preview does not show what a group gets');
  const words = texts(tree).join(' | ');
  assert.ok(!words.includes(FULL), 'the preview still shows the full notice, which no in-app send carries');
  assert.match(words, /Private messages go without it/);
  assert.match(words, /source and full licence/);
});

// ── L5 ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('L5 POINT OF USE: a steward\'s finance card becomes the card when the roster arrives, with no room re-render', () => {
  const FIN = { type: 'finance', title: 'St Bride’s', periodLabel: 'Q3', sections: [{ kind: 'summary', income: 1234500, expenditure: 1, surplus: 2 }], currency: 'GBP', decimals: 2 };
  let roster = false;
  const F = { myPubkey: ME, churchPub: CHURCH, isChurchVoice: pk => pk === CHURCH || (roster && pk === STEWARD), displayFor: () => ({ handle: 'Steward' }) };
  const s = screen(['Bubble', 'evtToMsg'], F);
  const props = { m: s.mod.evtToMsg(ev(FIN, 'Statement for Q3', STEWARD)), ctx: { church: { name: 'St Bride’s' }, shareText() {}, openShare() {} }, summary: [], live: false };
  const before = texts(s.draw(s.mod.Bubble, props)).join(' | ');
  assert.ok(!before.includes('£12,345.00') && before.includes('Statement for Q3'), 'before the roster: text, not the card');
  roster = true;
  assert.ok(!texts(s.draw(s.mod.Bubble, props)).join(' | ').includes('£12,345.00'), 'control: a bare re-draw (no trust event) must not re-decide - real React would not re-render this bubble');
  s.win.fire('trinity-church-trust');
  const after = texts(s.draw(s.mod.Bubble, props)).join(' | ');
  assert.match(after, /£12,345\.00/, 'the roster arrived and the finance card did not draw');
});

// ── N7 ────────────────────────────────────────────────────────────────────────────────────────────────────────
const lum = (h) => { const c = [0, 2, 4].map(i => parseInt(h.slice(1).slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
test('N7: the credit is >= 11px in a token with AA contrast (4.5:1) on the card surface, light AND dark', () => {
  const card = { type: 'commentary', ref: 'R', source: 'S', text: 'T', credit: SHORT };
  const s = screen(['Bubble', 'evtToMsg'], { myPubkey: ME, displayFor: () => ({ handle: 'Anna' }) });
  const tree = s.draw(s.mod.Bubble, { m: s.mod.evtToMsg(ev(card, 'R — S\n\nT\n\n' + SHORT)), ctx: { church: {}, shareText() {}, openShare() {} }, summary: [], live: false });
  const cr = find(tree, n => n.props && n.props['data-card-credit'] === '1')[0];
  assert.ok(parseFloat(cr.props.style.fontSize) >= 11, 'credit font ' + cr.props.style.fontSize);
  const tok = /^var\((--[\w-]+)\)$/.exec(cr.props.style.color);
  assert.ok(tok, 'the credit colour is not a theme token: ' + cr.props.style.color);
  const cardBg = find(tree, n => n.props && n.props['data-chat-card'] === 'commentary')[0].props.style.background;
  const bgTok = /^var\((--[\w-]+)\)$/.exec(cardBg)[1];
  const css = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const vals = (name) => [...css.matchAll(new RegExp(name.replace(/-/g, '\\-') + ':\\s*(#[0-9A-Fa-f]{6})', 'g'))].map(m => m[1]);
  const fg = vals(tok[1]), bg = vals(bgTok);
  assert.ok(fg.length >= 2 && bg.length >= 2, 'light and dark values not both found for ' + tok[1] + ' / ' + bgTok);
  for (let i = 0; i < 2; i++) assert.ok(ratio(fg[i], bg[i]) >= 4.5, `${i ? 'dark' : 'light'}: ${fg[i]} on ${bg[i]} is ${ratio(fg[i], bg[i]).toFixed(2)}:1`);
});

const DIRTY = 'John\u202E 3:16\u200B\u2066';
const ZW = 'a\u200Cb\u200Dc';   // ZWNJ/ZWJ are KEPT
// A HEBREW VERSE WITH A RIGHT-TO-LEFT MARK, as Bible modules carry them (re-audit 2026-11-17): the marks LRM/RLM/ALM
// stay; an RLO (U+202E, an override) is stripped.
const HEB = '\u05DB\u05B4\u05BC\u05D9 \u05DB\u05B5\u05BF\u05DF\u200F 3:16 \u200E\u061C';
const HEB_RLO = '\u202E' + HEB + '\u202C';
test('N7: the real chatShareCard strips bidi controls and zero-width characters (ZWNJ/ZWJ kept)', () => {
  const s = screen(['chatShareCard'], {});
  // EDITED (re-audit): the controls-only field is now an ISOLATE (U+2067), since LRM is a kept mark
  const c = s.mod.chatShareCard({ type: 'verse', ref: DIRTY, text: ZW + '\uFEFF', version: '\u2067' });
  assert.equal(c.ref, 'John 3:16');
  assert.equal(c.text, ZW);
  assert.equal(c.version, undefined, 'a field that is only controls is dropped');
});
test('N7 POINT OF USE: a Hebrew verse keeps its RLM/LRM/ALM on the drawn card; an RLO is stripped', () => {
  const s = screen(['Bubble', 'evtToMsg', 'chatShareCard', 'chatCardFallback'], { myPubkey: ME, displayFor: () => ({ handle: 'Anna' }) });
  const card = s.mod.chatShareCard({ type: 'verse', ref: 'John 3:16', text: HEB_RLO, version: 'WLC' });
  assert.equal(card.text, HEB, 'the marks were lost or the override survived');
  const tree = s.draw(s.mod.Bubble, { m: s.mod.evtToMsg(ev({ type: 'verse', ref: 'John 3:16', text: HEB_RLO, version: 'WLC' }, s.mod.chatCardFallback(card))), ctx: { church: {}, shareText() {}, openShare() {} }, summary: [], live: false });
  const drawn = find(tree, n => n.props && n.props['data-chat-card'] === 'verse');
  assert.equal(drawn.length, 1, 'the Hebrew verse card did not draw');
  const words = texts(drawn[0]).join('');
  assert.ok(words.includes(HEB), 'the RLM/LRM/ALM did not survive onto the card');
  assert.ok(!words.includes('\u202E'), 'the RLO reached the card');
});
test('N7: the real _chatCardClean, _dmWrap and _dmUnwrap strip them too', () => {
  const clean = new Function(fnBody(FEL, 'function _chatCardClean(x) {', '_chatCardClean') + '\nreturn _chatCardClean;')();
  assert.equal(clean({ type: 'verse', ref: DIRTY, text: ZW }).ref, 'John 3:16');
  assert.equal(clean({ type: 'verse', ref: DIRTY, text: ZW }).text, ZW);
  const o = new Function(`return ({ ${fnBody(FEL, '_dmWrap(text, replyTo, meta) {', '_dmWrap')}, ${fnBody(FEL, '_dmUnwrap(body) {', '_dmUnwrap')} });`)();
  assert.equal(JSON.parse(o._dmWrap('t', null, { card: { type: 'verse', ref: DIRTY, text: ZW } })).cd.ref, 'John 3:16');
  assert.equal(o._dmUnwrap(JSON.stringify({ v: 1, t: 't', cd: { type: 'verse', ref: DIRTY, text: ZW } })).card.ref, 'John 3:16');
  // the marks survive every engine path; the override does not
  assert.equal(clean({ type: 'verse', ref: 'R', text: HEB_RLO }).text, HEB);
  assert.equal(JSON.parse(o._dmWrap('t', null, { card: { type: 'verse', ref: 'R', text: HEB_RLO } })).cd.text, HEB);
  assert.equal(o._dmUnwrap(JSON.stringify({ v: 1, t: 't', cd: { type: 'verse', ref: 'R', text: HEB_RLO } })).card.text, HEB);
});

test('LOW (re-audit) POINT OF USE: profile events that change nothing do not re-render a card bubble; a roster change does', () => {
  const FIN = { type: 'finance', title: 'T', periodLabel: 'Q3', sections: [{ kind: 'summary', income: 1234500, expenditure: 1, surplus: 2 }], currency: 'GBP', decimals: 2 };
  const VERSE = { type: 'verse', ref: 'John 3:16', text: 'For God so loved the world', version: 'BSB' };
  let roster = false;
  const F = { myPubkey: ME, churchPub: CHURCH, isChurchVoice: pk => pk === CHURCH || (roster && pk === STEWARD), displayFor: () => ({ handle: 'x' }) };
  const counter = { sets: 0, states: 0 };
  const s = screen(['Bubble', 'evtToMsg'], F, {}, counter);
  const ctx = { church: { name: 'x' }, shareText() {}, openShare() {} };
  const finProps = { m: s.mod.evtToMsg(ev(FIN, 'Statement', STEWARD)), ctx, summary: [], live: false };
  const vProps = { m: { ...s.mod.evtToMsg(ev(VERSE, '\u201cFor God so loved the world\u201d \u2014 John 3:16 \u00b7 BSB')), id: 'e2' }, ctx, summary: [], live: false };
  // both bubbles in ONE tree, keyed, so each is its own instance (two separate draws would share the root's store)
  const Both = () => s.React.createElement('div', null, s.React.createElement(s.mod.Bubble, { ...finProps, key: 'f' }), s.React.createElement(s.mod.Bubble, { ...vProps, key: 'v' }));
  s.draw(Both, {});
  assert.ok(counter.states >= 2, 'the instrument never saw the card bubbles\' state - it would measure nothing');
  counter.sets = 0;
  for (let i = 0; i < 25; i++) s.win.fire('trinity-profiles');
  s.win.fire('trinity-church-trust');
  assert.equal(counter.sets, 0, counter.sets + ' state sets (re-renders) from events that changed nothing');
  roster = true;
  s.win.fire('trinity-church-trust');
  assert.ok(counter.sets >= 1, 'the roster change did not re-render the finance bubble');
  const n = counter.sets;
  for (let i = 0; i < 10; i++) s.win.fire('trinity-profiles');
  assert.equal(counter.sets, n, 'settled again: further events must not re-render');
  const after = texts(s.draw(Both, {})).join(' | ');
  assert.match(after, /£12,345\.00/, 'the finance card did not draw after the roster change');
  assert.match(after, /For God so loved the world/, 'the verse card was lost');
});
