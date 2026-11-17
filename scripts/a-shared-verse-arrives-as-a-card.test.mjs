// A VERSE SHARED INTO A CHAT ARRIVES AS A DESIGNED CARD, the sharer's thoughts under it (owner 2026-11-17).
//   Run: node --test scripts/a-shared-verse-arrives-as-a-card.test.mjs
//
// The rich-message shape is the one the church's finance statements already use: a ['card','1',json] tag (in a
// DM, the envelope's `cd`), the plain words in the body as the fallback. No image travels.
//
// Point of use, end to end, every piece the SHIPPED one:
//   send     the real VerseShareSheet (app/screens-chat.jsx), thoughts typed, a group / a person tapped;
//   wire     the real publishMessage / _dmWrap / _dmUnwrap / subscribeThread / _decEvt lifted out of the built
//            vendor/fellowship.js, with real nip44 — so a sealed room really is sealed;
//   receive  the real evtToMsg → Bubble, and the real DMThread, rendered through the mini React.
// Plus: a member's hand-built FINANCE card is not drawn as the church's; hostile card fields never throw or render
// raw; the build on main (9acf00f2) shows the plain words for a card it does not know; the steward console shows
// readable text. Nothing here matches source text (CLAUDE.md rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encrypt as nip44e, decrypt as nip44d } from 'nostr-tools/nip44';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';
import { loadComponent, Stub, settle } from './console-component-rig.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ESBUILD = join(ROOT, 'node_modules/.bin/esbuild');
const FEL = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');
const ME = 'a'.repeat(64), ANNA = 'b'.repeat(64), CHURCH = 'c'.repeat(64);
const VERSE = { type: 'verse', ref: 'John 3:16', text: 'For God so loved the world', version: 'BSB' };
const THOUGHTS = 'This got me through last week';
const PLAIN = '“For God so loved the world” — John 3:16 · BSB';

// ── the sheet ────────────────────────────────────────────────────────────────────────────────────────────────
function shareSheet(payload, { thoughts = '', encrypted = false } = {}) {
  const { React, draw } = miniReact();
  const published = [], dms = [], toasts = [];
  const F = {
    myPubkey: ME,
    publishMessage: async (id, text, tags, o) => { published.push({ id, text, tags, o }); return {}; },
    sendDM: async (pk, text, replyTo, meta) => { dms.push({ pk, text, replyTo, meta }); return {}; },
    subscribeChurchGroups: (_c, cb) => { cb([{ id: 'g1', name: 'Home group', kind: 'Group', encrypted }]); return () => {}; },
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
  const ctx = { toast: m => toasts.push(m), church: { npub: 'npub1church' }, canDMPeer: () => true, shareText() {}, openShare() {} };
  const props = { payload, open: true, onClose() {}, ctx };
  let tree = draw(mod.VerseShareSheet, props);
  if (thoughts) {
    const ta = find(tree, n => n.type === 'textarea');
    assert.equal(ta.length, 1, 'no thoughts box on the sheet');
    ta[0].props.onChange({ target: { value: thoughts } });
  }
  tree = draw(mod.VerseShareSheet, props);
  const tap = (label) => {
    const b = find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));
    assert.equal(b.length, 1, 'no "' + label + '" row on the sheet');
    b[0].props.onClick();
  };
  return { tree, tap, published, dms, toasts };
}

// ── the engine, lifted out of the BUILT bundle ─────────────────────────────────────────────────────────────────
const lift = (anchor) => fnBody(FEL, anchor, anchor);
function engine({ gkey = null } = {}) {
  const GID = 'g1';
  const body = [
    lift('function _chatCardClean(x) {'), lift('function _decEvt(cp, e) {'),
    'const api = { ' + lift('async publishMessage(groupId, content, extraTags = [], opts = {}) {') + ' };',
    'return { api, _decEvt };',
  ].join('\n');
  const outbox = [];
  const scope = {
    sk: generateSecretKey(), NET: 'trinityone',
    window: { Fellowship: { churchPub: CHURCH } },
    _gkeys: gkey ? { [CHURCH + '|' + GID]: [gkey] } : {}, _gkKey: (cp, g) => cp + '|' + g,
    _wantsEncrypted: (_g, hint) => !!hint, _leavingFor: () => false, _outboxFull: () => false, _failedFull: () => false,
    encrypt: nip44e, decrypt: nip44d, finalizeEvent2: finalizeEvent,
    publishSetFor: () => [], _outbox: outbox, _outboxSave() {}, _publishBounded: async () => {}, console,
  };
  const names = Object.keys(scope);
  return new Function(...names, body)(...names.map(n => scope[n]));
}
const dmLift = () => {
  const make = new Function('pool', 'window', 'pub', 'sk', '_dmDecrypt', 'dmReadRelays',
    `return ({ ${lift('_dmWrap(text, replyTo, meta) {')}, ${lift('_dmUnwrap(body) {')}, ${lift('subscribeThread(peerPub, onMsg) {')} });`);
  let handler = null;
  const pool = { subscribeMany: (_u, _f, h) => { handler = h.onevent; return { close() {} }; } };
  const window = { Fellowship: {} };
  const o = make(pool, window, ME, new Uint8Array(32), async (_sk, _peer, ct) => ct, () => []);
  window.Fellowship._dmUnwrap = o._dmUnwrap; window.Fellowship._dmWrap = o._dmWrap;
  return { o, push: (e) => handler(e) };
};

// ── the receiving screen ─────────────────────────────────────────────────────────────────────────────────────
function bubbleGlobals(React, F, opened) {
  return {
    React,
    window: { Fellowship: F, addEventListener() {}, removeEventListener() {} },
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    UserAvatar: () => null,
    safeCssColor: (c, f) => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim()) ? c.trim() : (f || 'var(--clay)')),
    safeImgUrl: (v) => { const s = typeof v === 'string' ? v.trim() : ''; return /^data:image\/[a-zA-Z0-9.+-]+;/.test(s) ? s : ''; },
    setTimeout: () => 0, clearTimeout: () => {},
  };
}
const CTX = (opened) => ({ church: { id: CHURCH, name: 'St Bride’s', accent: '#C25A38', initials: 'SB' }, shareText() {}, openShare: (v) => opened.push(v) });
function receive(evt, { F = { myPubkey: ME, displayFor: () => ({ handle: 'Anna' }) }, file = 'app/screens-chat.jsx' } = {}) {
  const { React, draw } = miniReact();
  const opened = [];
  const mod = file === 'app/screens-chat.jsx'
    ? loadScreen(file, ['Bubble', 'evtToMsg', 'shareTextOf'], bubbleGlobals(React, F, opened))
    : loadOld(file.split('@')[0], ['Bubble', 'evtToMsg'], bubbleGlobals(React, F, opened));
  const m = mod.evtToMsg(evt);
  const tree = draw(mod.Bubble, { m, ctx: CTX(opened), summary: [], live: false });
  return { m, tree, opened, mod };
}
const cardEvt = (card, content, by = ANNA, extra = []) => ({ id: 'e1', pubkey: by, created_at: 1763000000,
  tags: [['t', 'trinityone'], ['t', 'g1'], ['p', CHURCH], ...extra, ['card', '1', typeof card === 'string' ? card : JSON.stringify(card)]], content });
const cards = (tree, kind) => find(tree, n => n.props && n.props['data-chat-card'] === kind);
// the words of the thoughts bubble under a card (its <p>), or null when there is none
const thoughtsOf = (tree) => { const th = find(tree, n => n.props && n.props['data-card-thoughts'] === '1'); return th.length ? texts(find(th[0], n => n.type === 'p')[0]).join('') : null; };

// ═════ SEND ═════════════════════════════════════════════════════════════════════════════════════════════════
test('POINT OF USE: a verse shared to a group sends the card tag, plain words + thoughts in the body, no thoughts in the card', () => {
  const s = shareSheet({ type: 'verse', ...VERSE, type: 'verse' }, { thoughts: THOUGHTS });
  s.tap('Home group');
  assert.equal(s.published.length, 1);
  const p = s.published[0];
  assert.equal(p.text, PLAIN + '\n\n' + THOUGHTS, 'the body an older build shows must be the words + thoughts');
  assert.deepEqual(p.o.card, VERSE, 'the card sent is exactly the verse fields');
  assert.ok(!JSON.stringify(p.o.card).includes(THOUGHTS), 'the thoughts leaked into the card');
  assert.ok(!/data:|<img|base64/.test(JSON.stringify(p)), 'something image-shaped rides the send');
});

test('POINT OF USE: a verse shared to a person sends the card in the DM meta, thoughts only in the text', () => {
  const s = shareSheet({ type: 'verse', ...VERSE }, { thoughts: THOUGHTS });
  s.tap('Anna');
  assert.equal(s.dms.length, 1);
  assert.equal(s.dms[0].pk, ANNA);
  assert.equal(s.dms[0].text, PLAIN + '\n\n' + THOUGHTS);
  assert.deepEqual(s.dms[0].meta, { card: VERSE });
  assert.ok(!JSON.stringify(s.dms[0].meta).includes(THOUGHTS));
});

test('a devotional or note share is unchanged: no card goes with it', () => {
  const s = shareSheet({ type: 'devotional', title: 'Morning', ref: 'Ps 23', excerpt: 'The Lord is my shepherd' });
  s.tap('Home group'); s.tap('Anna');
  assert.equal(s.published[0].o.card, undefined);
  assert.equal(s.dms[0].meta, undefined);
});

// ═════ WIRE ═════════════════════════════════════════════════════════════════════════════════════════════════
test('the real publishMessage puts the card in a ["card","1",json] tag in an open room', async () => {
  const { api } = engine();
  const evt = await api.publishMessage('g1', PLAIN + '\n\n' + THOUGHTS, [], { encrypted: false, card: { ...VERSE, comment: THOUGHTS, html: '<b>x</b>' } });
  const tag = evt.tags.find(t => t[0] === 'card');
  assert.ok(tag, 'no card tag on the event');
  assert.equal(tag[1], '1');
  assert.deepEqual(JSON.parse(tag[2]), VERSE, 'only the verse fields may ride the tag — extra fields are dropped');
  assert.equal(evt.content, PLAIN + '\n\n' + THOUGHTS);
});

test('in a SEALED room the card is sealed with the body — no verse words in clear tags — and _decEvt opens it', async () => {
  const gkey = new Uint8Array(32).fill(7);
  const { api, _decEvt } = engine({ gkey });
  const evt = await api.publishMessage('g1', PLAIN + '\n\n' + THOUGHTS, [], { encrypted: true, card: VERSE });
  assert.ok(evt.tags.some(t => t[0] === 'enc'), 'the room did not seal');
  const tag = evt.tags.find(t => t[0] === 'card');
  assert.equal(tag[3], 'enc', 'the card tag is not marked sealed');
  assert.ok(!JSON.stringify(evt.tags).includes('loved the world'), 'the verse is readable in the public tags of a sealed room');
  const dec = _decEvt(CHURCH, evt);
  assert.deepEqual(JSON.parse(dec.tags.find(t => t[0] === 'card')[2]), VERSE);
  // and the opened event draws as the card on the real screen
  const r = receive(dec);
  assert.equal(cards(r.tree, 'verse').length, 1, 'a sealed-room verse card did not draw');
});

test('a sealed card tag that will not open is dropped — the body text shows', async () => {
  const gkey = new Uint8Array(32).fill(7);
  const { api, _decEvt } = engine({ gkey });
  const evt = await api.publishMessage('g1', PLAIN, [], { encrypted: true, card: VERSE });
  const bad = { ...evt, tags: evt.tags.map(t => (t[0] === 'card' ? ['card', '1', 'not-a-ciphertext', 'enc'] : t)) };
  const dec = _decEvt(CHURCH, bad);
  assert.equal(dec.tags.some(t => t[0] === 'card'), false);
  assert.equal(dec.content, PLAIN);
});

test('a DM: the real _dmWrap carries the card inside the envelope; the real subscribeThread hands it to the screen', async () => {
  const { o, push } = dmLift();
  const body = o._dmWrap(PLAIN + '\n\n' + THOUGHTS, null, { card: { ...VERSE, comment: THOUGHTS } });
  const env = JSON.parse(body);
  assert.equal(env.t, PLAIN + '\n\n' + THOUGHTS, 't must still carry all the words');
  assert.deepEqual(env.cd, VERSE, 'the envelope card must be the verse fields only');
  const got = [];
  o.subscribeThread(ANNA, m => got.push(m));
  await push({ id: 'd1', kind: 4, pubkey: ANNA, created_at: 5, tags: [['p', ME]], content: body });
  assert.deepEqual(got[0].card, VERSE);
  assert.equal(got[0].content, PLAIN + '\n\n' + THOUGHTS);
});

test('a DM with no card is byte-for-byte what it was (plain text, no envelope)', () => {
  const { o } = dmLift();
  assert.equal(o._dmWrap('hello', null, undefined), 'hello');
  assert.equal(o._dmWrap('hello', null, { card: { type: 'finance', text: 'x' } }), 'hello', 'a non-member card type rode a DM');
  assert.equal(o._dmUnwrap('hello').card, undefined, 'a plain DM must unwrap to exactly the shape it always had');
});

// ═════ RECEIVE ═════════════════════════════════════════════════════════════════════════════════════════════
test('POINT OF USE: the group bubble draws the designed verse card, the thoughts UNDER it, and a tap re-shares the verse only', () => {
  const r = receive(cardEvt(VERSE, PLAIN + '\n\n' + THOUGHTS));
  const c = cards(r.tree, 'verse');
  assert.equal(c.length, 1, 'no designed verse card in the bubble');
  const onCard = texts(c[0]).join(' | ');
  assert.match(onCard, /For God so loved the world/);
  assert.match(onCard, /John 3:16/);
  assert.match(onCard, /BSB/);
  assert.ok(!onCard.includes(THOUGHTS), 'the thoughts are drawn ON the card');
  assert.equal(thoughtsOf(r.tree), THOUGHTS, 'the thoughts are not under the card');
  assert.ok(!texts(r.tree).join(' ').includes('“For God so loved the world” —'), 'the plain fallback is drawn as well as the card');
  c[0].props.onClick({ stopPropagation() {} });
  assert.deepEqual(r.opened, [{ ref: 'John 3:16', text: 'For God so loved the world', version: 'BSB' }], 'the tap must share the verse and nothing else');
  assert.equal(r.mod.shareTextOf(r.m), PLAIN, 'the message menu "Share" must not carry the sender\'s thoughts');
});

test('a card with no thoughts draws no empty bubble under it', () => {
  const r = receive(cardEvt(VERSE, PLAIN));
  assert.equal(cards(r.tree, 'verse').length, 1);
  assert.equal(thoughtsOf(r.tree), null);
});

// EDITED 2026-11-17 after the audit (M2): this used to draw the card AND the whole body under it. A card whose
// words are not the body's would show members words the console (which shows only the body) never sees, so now
// such a message is drawn as its plain body, no card. Same count.
test('a body that does not start with the card\'s words draws the plain body and NO card (the card is bound to the body)', () => {
  for (const body of ['something else entirely', PLAIN.slice(0, -1), 'x' + PLAIN, PLAIN + 'tail-without-a-blank-line']) {
    const r = receive(cardEvt({ ...VERSE, text: 'A 4000-char sermon the console never shows' }, body));
    assert.equal(cards(r.tree, 'verse').length, 0, 'an unbound card was drawn for body ' + JSON.stringify(body.slice(0, 30)));
    assert.equal(thoughtsOf(r.tree), null);
    assert.ok(texts(r.tree).includes(body), 'the plain body is not shown');
    assert.ok(!texts(r.tree).join(' ').includes('console never shows'));
    assert.equal(r.mod.shareTextOf(r.m), body, 'an unbound card must share its body, not the card');
  }
});

test('POINT OF USE: the real DMThread draws the card, the thoughts under it', async () => {
  const { o, push } = dmLift();
  const { React, draw } = miniReact();
  const opened = [];
  const F = { myPubkey: ME, displayFor: () => ({ handle: 'Anna', av: {} }), subscribeThread: o.subscribeThread };
  const mod = loadScreen('app/screens-chat.jsx', ['DMThread'], {
    ...bubbleGlobals(React, F, opened),
    window: { Fellowship: F, addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {} },
    Overlay: ({ children }) => children, IconBtn: () => null, avOf: d => d.av, confirm: () => false,
  });
  const props = { peer: ANNA, open: true, onClose() {}, ctx: { ...CTX(opened), connTick: 0 } };
  draw(mod.DMThread, props);
  await push({ id: 'd1', kind: 4, pubkey: ANNA, created_at: 5, tags: [['p', ME]], content: o._dmWrap(PLAIN + '\n\n' + THOUGHTS, null, { card: VERSE }) });
  await settle();
  const tree = draw(mod.DMThread, props);
  const c = cards(tree, 'verse');
  assert.equal(c.length, 1, 'the DM did not draw the verse card');
  assert.ok(!texts(c[0]).join(' ').includes(THOUGHTS));
  assert.equal(thoughtsOf(tree), THOUGHTS);
  c[0].props.onClick({ stopPropagation() {} });
  assert.deepEqual(opened, [{ ref: 'John 3:16', text: 'For God so loved the world', version: 'BSB' }]);
});

// ═════ WHO MAY POST WHICH CARD ═════════════════════════════════════════════════════════════════════════════
const FIN = { type: 'finance', title: 'St Bride’s', periodLabel: 'Q3 2026', sections: [{ kind: 'summary', income: 1234500, expenditure: 1, surplus: 2 }], currency: 'GBP', decimals: 2 };
test('a MEMBER-authored finance card is NOT drawn as the church\'s statement — only its body text shows', () => {
  const F = { myPubkey: ME, churchPub: CHURCH, isChurchVoice: (pk) => pk === CHURCH, displayFor: () => ({ handle: 'Anna' }) };
  const r = receive(cardEvt(FIN, 'my made-up statement', ANNA), { F });
  const seen = texts(r.tree).join(' | ');
  assert.ok(!/£12,345\.00|aggregate figures only/i.test(seen), 'a member\'s card was drawn as an official statement');
  assert.match(seen, /my made-up statement/);
});

test('the church\'s own finance card still draws, and so does a roster steward\'s', () => {
  const F = { myPubkey: ME, churchPub: CHURCH, isChurchVoice: (pk) => pk === CHURCH || pk === 'd'.repeat(64), displayFor: () => ({ handle: 'x' }) };
  for (const by of [CHURCH, 'd'.repeat(64)]) {
    const seen = texts(receive(cardEvt(FIN, 'body', by), { F }).tree).join(' | ');
    assert.match(seen, /£12,345\.00/, 'a church-voice finance card did not draw: ' + by.slice(0, 4));
  }
});

test('the real isChurchVoice: the church key and a roster steward only', () => {
  const body = 'const api = { ' + lift('isChurchVoice(pubkey) {') + ' }; return api;';
  const roster = new Map([[CHURCH, new Set(['d'.repeat(64)])]]);
  const api = new Function('window', '_churchRoster', body)({ Fellowship: { churchPub: CHURCH } }, roster);
  assert.equal(api.isChurchVoice(CHURCH), true);
  assert.equal(api.isChurchVoice('d'.repeat(64)), true);
  assert.equal(api.isChurchVoice(ANNA), false);
  assert.equal(api.isChurchVoice(''), false);
});

// ═════ HOSTILE FIELDS ═════════════════════════════════════════════════════════════════════════════════════
test('hostile card fields never throw, never draw raw, and fall back to the body', () => {
  const bad = [
    { type: 'verse', ref: 'X', text: { html: '<script>' } },
    { type: 'verse', ref: 'X', text: 'y'.repeat(1_000_000) },
    { type: 'verse', ref: ['a'], text: 5 },
    { type: 'verse' },
    { type: 'nope', text: 'x' },
    '["verse"]', 'not json', 'null',
  ];
  for (const c of bad) {
    const r = receive(cardEvt(c, 'FALLBACK BODY'));
    assert.equal(cards(r.tree, 'verse').length, 0, 'drew a card from ' + JSON.stringify(c).slice(0, 40));
    assert.match(texts(r.tree).join(' | '), /FALLBACK BODY/);
  }
  // an over-long ref is dropped, a markup-looking text is drawn as TEXT (React text node), never as html
  // (the body is the cleaned card's own words, as an honest sender builds it - the card is bound to its body)
  const r = receive(cardEvt({ type: 'verse', ref: 'r'.repeat(500), text: '<img src=x onerror=alert(1)>' }, '“<img src=x onerror=alert(1)>” — '));
  const c = cards(r.tree, 'verse');
  assert.equal(c.length, 1);
  assert.equal(find(c[0], n => n.type === 'img').length, 0);
  assert.equal(find(r.tree, n => n.props && n.props.dangerouslySetInnerHTML).length, 0);
  assert.ok(!texts(c[0]).join('').includes('rrrrr'), 'an over-long ref was drawn');
});

// ═════ THE BUILD ON MAIN (9acf00f2) ═══════════════════════════════════════════════════════════════════════
// The shipped member app at main, compiled from git, gets the new event: it must show the plain words.
function loadOld(file, exportNames, globals) {
  const dir = mkdtempSync(join(tmpdir(), 'trin-oldbuild-'));
  try {
    const comp = (rel) => { const p = join(dir, rel.replace(/\//g, '_')); writeFileSync(p, execFileSync('git', ['-C', ROOT, 'show', '9acf00f2:' + rel], { maxBuffer: 1 << 26 })); return execFileSync(ESBUILD, [p, '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 }); };
    // main predates app/header-more.jsx; it has the reply kit, which the bubble's Row uses
    const js = comp('app/reply-kit.jsx') + '\n' + comp(file);
    const names = Object.keys(globals);
    return new Function(...names, js + '\nreturn { ' + exportNames.join(', ') + ' };')(...names.map(k => globals[k]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('OLD BUILD (main 9acf00f2): a verse card shows its plain words + thoughts, never blank, never JSON', () => {
  for (const ev of [cardEvt(VERSE, PLAIN + '\n\n' + THOUGHTS), cardEvt('sealed-ciphertext', PLAIN + '\n\n' + THOUGHTS, ANNA)]) {
    const r = receive(ev, { file: 'app/screens-chat.jsx@9acf00f2' });
    const seen = texts(r.tree).join(' | ');
    assert.ok(seen.includes(PLAIN + '\n\n' + THOUGHTS), 'the old build did not show the words: ' + seen.slice(0, 200));
    assert.ok(!seen.includes('"type"') && !seen.includes('{'), 'the old build showed raw JSON');
  }
});
test('OLD BUILD (main 9acf00f2): its _dmUnwrap reads the new envelope as the words', () => {
  const OLD = execFileSync('git', ['-C', ROOT, 'show', '9acf00f2:vendor/fellowship.js'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const oldUnwrap = new Function(`return ({ ${fnBody(OLD, '_dmUnwrap(body) {', '_dmUnwrap')} });`)();
  const { o } = dmLift();
  const un = oldUnwrap._dmUnwrap(o._dmWrap(PLAIN + '\n\n' + THOUGHTS, null, { card: VERSE }));
  assert.equal(un.text, PLAIN + '\n\n' + THOUGHTS);
});

// ═════ THE STEWARD CONSOLE ═════════════════════════════════════════════════════════════════════════════════
test('the steward console shows a member verse card as readable text, not JSON', async () => {
  const { React, draw } = miniReact();
  const cjs = execFileSync(ESBUILD, [join(ROOT, 'app/stew-cards.jsx'), '--jsx=transform', '--format=cjs', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const mm = { exports: {} };
  new Function('React', 'module', 'exports', cjs + '\nmodule.exports = { ConsoleCard, ConsoleFinanceCard, cardRenderable };')(React, mm, mm.exports);
  const msgs = [{ id: 'm1', by: ANNA, mine: false, ts: 1, text: PLAIN + '\n\n' + THOUGHTS, card: VERSE, kind: '' }];
  const win = {
    Steward: { pubkey: CHURCH, stewardLabels: () => ({}), subscribeGroupChat: (id, cb) => { cb(msgs); return () => {}; },
      subscribeGroupPin: (id, cb) => { cb(null); return () => {}; }, subscribeGroupEvents: (id, cb) => { cb([]); return () => {}; },
      publishPost: () => Promise.resolve({ id: 'e1' }) },
    useStewardMembers: () => [{ pubkey: ANNA, name: 'Anna' }], useStewardChurch: () => ({ name: 'St Bride’s' }), useStewardStewards: () => [],
    dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  };
  const mod = await loadComponent('app/stew-dashboard.jsx', ['function GroupChatModal({ group, onClose }) {', 'function groupIcon('], {
    React, window: win, CustomEvent, setTimeout, clearTimeout, document: { addEventListener() {}, removeEventListener() {} },
    TrinityReplyKit: { quote: () => null, bar: () => null, cue: () => null, style: () => ({}), dotsProps: () => ({}) },
    Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), useStewDialog: () => ({}),
    ConsoleCard: mm.exports.ConsoleCard, ConsoleFinanceCard: mm.exports.ConsoleFinanceCard, cardRenderable: mm.exports.cardRenderable,
  });
  const props = { group: { id: 'g1', name: 'Whole Church', kind: 'group' }, onClose() {} };
  draw(mod.GroupChatModal, props); await settle();
  const seen = texts(draw(mod.GroupChatModal, props)).join(' | ');
  assert.ok(seen.includes(PLAIN + '\n\n' + THOUGHTS), 'the console does not show the words');
  assert.ok(!seen.includes('"type"'), 'the console shows raw JSON');
});
