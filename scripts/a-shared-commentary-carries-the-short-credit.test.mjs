// A COMMENTARY SHARED INSIDE THE APP: a card, the short credit in groups (in SMALLER type), none in a DM
// (owner 2026-11-17). Run: node --test scripts/a-shared-commentary-carries-the-short-credit.test.mjs
//
// The sheet-level sends (real study panel → real VerseShareSheet) are pinned in
// aquifer-study-notes-reach-the-study-panel.test.mjs. This file drives the rest:
//   - the real commentaryInAppCredit out of app/screens-read.jsx (the short credit only for the vetted catalogue
//     notice; an imported or unknown notice untouched);
//   - the real VerseShareSheet with an IMPORTED notice: the full notice goes to a group, nothing to a DM, and the
//     full notice still goes "outside the app";
//   - the real Bubble / DMThread drawing the commentary card, the credit smaller than the body.
// Nothing matches source text (CLAUDE.md rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';
import { settle } from './console-component-rig.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const READ = readFileSync(join(ROOT, 'app/screens-read.jsx'), 'utf8');
const ME = 'a'.repeat(64), ANNA = 'b'.repeat(64), CHURCH = 'c'.repeat(64);
const OSN_FULL = 'Aquifer Open Study Notes © Mission Mutual · CC BY-SA 4.0 · an adaptation of Tyndale Open Study Notes © 2023 Tyndale House Publishers, also CC BY-SA 4.0';
const SHORT = '— Aquifer Open Study Notes © Mission Mutual, adapted from Tyndale Open Study Notes · CC BY-SA 4.0';

const credit = new Function(fnBody(READ, 'const COMMENTARY_INAPP_CREDITS = {', 'COMMENTARY_INAPP_CREDITS') + ';\n'
  + fnBody(READ, 'function commentaryInAppCredit(abbr, license, imported) {', 'commentaryInAppCredit') + '\nreturn commentaryInAppCredit;')();

test('commentaryInAppCredit: the vetted catalogue notes get the short credit', () => {
  assert.equal(credit('OSN', OSN_FULL, false), SHORT);
});
test('commentaryInAppCredit: an OSN abbr whose notice lacks Mission Mutual keeps its full notice (abbr collision)', () => {
  const other = 'Our Study Notes © Somebody Else · CC BY-SA 4.0';
  assert.equal(credit('OSN', other, false), other);
});
test('commentaryInAppCredit: an IMPORTED module keeps its full notice even with a matching abbr and notice', () => {
  assert.equal(credit('OSN', OSN_FULL, true), OSN_FULL);
  assert.equal(credit('XYZ', '© X all rights reserved', true), '© X all rights reserved');
  assert.equal(credit('MHC', '', false), '');
});

// ── the sheet, for an imported commentary ─────────────────────────────────────────────────────────────────────
function shareSheet(payload) {
  const { React, draw } = miniReact();
  const published = [], dms = [], shared = [];
  const F = {
    myPubkey: ME,
    publishMessage: async (id, text, tags, o) => { published.push({ id, text, o }); return {}; },
    sendDM: async (pk, text, replyTo, meta) => { dms.push({ pk, text, meta }); return {}; },
    subscribeChurchGroups: (_c, cb) => { cb([{ id: 'g1', name: 'Home group', kind: 'Group' }]); return () => {}; },
    subscribeChurchMembers: (_c, cb) => { cb([{ pubkey: ANNA, name: 'Anna' }]); return () => {}; },
    displayFor: () => ({ handle: 'Anna', av: { kind: 'symbol', color: '#5E8C6A', symbol: 'halo' } }),
  };
  const mod = loadScreen('app/screens-chat.jsx', ['VerseShareSheet'], {
    React,
    window: { matchMedia: () => ({ matches: true }), Fellowship: F, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-11-17',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ children }) => children, ScreenScroll: ({ children }) => children,
    ChurchPill: () => null, UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: c => c, relTime: () => 'now', avOf: d => d.av, D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = { toast() {}, church: { npub: 'npub1church' }, canDMPeer: () => true, shareText: (...a) => shared.push(a), openShare() {} };
  const props = { payload, open: true, onClose() {}, ctx };
  draw(mod.VerseShareSheet, props);
  const tree = draw(mod.VerseShareSheet, props);
  const tap = (label) => find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label))[0].props.onClick();
  return { tap, published, dms, shared };
}
const IMPORTED = '© 1999 Some Press, all rights reserved';
const impPayload = () => ({ type: 'commentary', ref: 'Ruth 1:16', source: 'My Notes', text: 'Where you go I will go.', license: IMPORTED,
  credit: credit('MYN', IMPORTED, true), warnLicence: true });

test('POINT OF USE: an IMPORTED commentary sends its FULL notice to a group, on the card and in the body', () => {
  const s = shareSheet(impPayload());
  s.tap('Home group');
  assert.ok(s.published[0].text.endsWith('\n\n' + IMPORTED));
  assert.equal(s.published[0].o.card.credit, IMPORTED);
});
test('POINT OF USE: an imported commentary sent to a person carries no licence line', () => {
  const s = shareSheet(impPayload());
  s.tap('Anna');
  assert.equal(s.dms[0].text, 'Ruth 1:16 — My Notes\n\nWhere you go I will go.');
  assert.equal(s.dms[0].meta.card.credit, undefined);
});
test('POINT OF USE: "Share outside the app" still carries the FULL notice, never the short credit', () => {
  const s = shareSheet({ type: 'commentary', ref: '2 John 1:1', source: 'Aquifer Open Study Notes', text: 'The elder.', license: OSN_FULL, credit: SHORT });
  s.tap('Share outside the app');
  assert.ok(s.shared[0][0].includes(OSN_FULL));
  assert.ok(!s.shared[0][0].includes(SHORT));
});
test('a group share whose notice is too long for a card goes as text, credit intact', () => {
  const huge = 'x'.repeat(1500);
  const s = shareSheet({ ...impPayload(), license: huge, credit: huge });
  s.tap('Home group');
  assert.equal(s.published[0].o.card, undefined);
  assert.ok(s.published[0].text.endsWith(huge));
});

// ── receiving ──────────────────────────────────────────────────────────────────────────────────────────────────
const globalsFor = (React, F) => ({
  React, window: { Fellowship: F, addEventListener() {}, removeEventListener() {} },
  Icon: ({ name }) => React.createElement('i', { 'data-icon': name }), UserAvatar: () => null,
  safeCssColor: (c, f) => f || 'var(--clay)', safeImgUrl: () => '', setTimeout: () => 0, clearTimeout: () => {},
});
const CARD = { type: 'commentary', ref: '2 John 1:1', source: 'Aquifer Open Study Notes', text: 'The elder: the apostle John.', credit: SHORT };
const BODY = '2 John 1:1 — Aquifer Open Study Notes\n\nThe elder: the apostle John.\n\n' + SHORT;
const px = (v) => parseFloat(String(v));

test('POINT OF USE: a group commentary card shows the short credit in noticeably SMALLER type than the body; thoughts under it', () => {
  const { React, draw } = miniReact();
  const opened = [];
  const mod = loadScreen('app/screens-chat.jsx', ['Bubble', 'evtToMsg'], globalsFor(React, { myPubkey: ME, displayFor: () => ({ handle: 'Anna' }) }));
  const m = mod.evtToMsg({ id: 'e1', pubkey: ANNA, created_at: 1, tags: [['t', 'g1'], ['p', CHURCH], ['card', '1', JSON.stringify(CARD)]], content: BODY + '\n\nSo helpful' });
  const tree = draw(mod.Bubble, { m, ctx: { church: { name: 'St Bride’s' }, openShare: v => opened.push(v), shareText() {} }, summary: [], live: false });
  const card = find(tree, n => n.props && n.props['data-chat-card'] === 'commentary');
  assert.equal(card.length, 1, 'no commentary card drawn');
  const body = find(card[0], n => n.props && n.props['data-card-body'] === '1')[0];
  const cr = find(card[0], n => n.props && n.props['data-card-credit'] === '1');
  assert.equal(cr.length, 1, 'the credit is not on the card');
  assert.equal(texts(cr[0]).filter(t => t !== '1').join(''), SHORT);
  // 11px credit under a 14.5px body (audit NIT 7 raised it from 10px for legibility; it is still ~3/4 the size)
  assert.ok(px(cr[0].props.style.fontSize) <= px(body.props.style.fontSize) * 0.8,
    `credit ${cr[0].props.style.fontSize} is not noticeably smaller than body ${body.props.style.fontSize}`);
  const th = find(tree, n => n.props && n.props['data-card-thoughts'] === '1');
  assert.equal(texts(find(th[0], n => n.type === 'p')[0]).join(''), 'So helpful');
  assert.ok(!texts(card[0]).join(' ').includes('So helpful'));
});

test('POINT OF USE: a commentary in a DM draws the card with NO credit line', async () => {
  const { React, draw } = miniReact();
  let push = null;
  const F = { myPubkey: ME, displayFor: () => ({ handle: 'Anna', av: {} }),
    subscribeThread: (_p, cb) => { push = cb; return () => {}; } };
  const mod = loadScreen('app/screens-chat.jsx', ['DMThread'], { ...globalsFor(React, F),
    document: { addEventListener() {}, removeEventListener() {} }, Overlay: ({ children }) => children, IconBtn: () => null, avOf: d => d.av, confirm: () => false });
  const props = { peer: ANNA, open: true, onClose() {}, ctx: { church: { name: 'x' }, openShare() {}, connTick: 0 } };
  draw(mod.DMThread, props);
  const { credit: _c, ...dmCard } = CARD;
  push({ id: 'd1', mine: false, content: '2 John 1:1 — Aquifer Open Study Notes\n\nThe elder: the apostle John.', card: dmCard, ts: 5, pubkey: ANNA, reactions: [] });
  await settle();
  const tree = draw(mod.DMThread, props);
  const card = find(tree, n => n.props && n.props['data-chat-card'] === 'commentary');
  assert.equal(card.length, 1, 'the DM did not draw the commentary card');
  assert.equal(find(card[0], n => n.props && n.props['data-card-credit'] === '1').length, 0);
  assert.ok(!/Mission Mutual|CC BY-SA/.test(texts(tree).join(' ')), 'a licence line shows in the DM');
  assert.equal(find(tree, n => n.props && n.props['data-card-thoughts'] === '1').length, 0, 'the body was repeated under the card');
});
