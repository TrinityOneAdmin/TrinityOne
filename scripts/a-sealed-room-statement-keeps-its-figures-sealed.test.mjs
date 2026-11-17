// A FINANCE STATEMENT POSTED INTO A SEALED ROOM KEEPS ITS FIGURES SEALED. Run:
//   node --test scripts/a-sealed-room-statement-keeps-its-figures-sealed.test.mjs
//
// console-finance-card-trust 2026-11-17, hole 2. The console's publishPost sealed the body under the room key but
// sent the statement's ['card','1',json] tag in clear, so every figure went to the relay beside the ciphertext.
// It now seals the card as ['card','1',<ciphertext>,'enc'] (the member app's shape) and REFUSES the post (null)
// when the card cannot be sealed. The treasurer's screen reports that refusal honestly.
//
// Everything runs shipped code (rules 1 and 3): publishPost and subscribeGroupChat lifted from vendor/steward.js
// (bundle names encrypt2/decrypt3), _decEvt from vendor/fellowship.js (this tree, and main 9acf00f2 via git
// show), the member app's evtToMsg + Bubble and the console's DashFinanceBook/FinanceShareStatement rendered.
// Real nip44 throughout, so "sealed" means a real ciphertext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encrypt as nip44e, decrypt as nip44d } from 'nostr-tools/nip44';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts as ctexts } from './console-screens.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ESBUILD = join(ROOT, 'node_modules/.bin/esbuild');
const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const FEL_NOW = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');
const FEL_MAIN = execFileSync('git', ['-C', ROOT, 'show', '9acf00f2:vendor/fellowship.js'], { encoding: 'utf8', maxBuffer: 1 << 26 });
const CHURCH = 'c'.repeat(64), ME = 'a'.repeat(64);
const GKEY = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 255);
const FIN = { type: 'finance', title: 'Grace', periodLabel: 'Q3 2026', sections: [{ kind: 'summary', income: 1234500, expenditure: 980000, surplus: 254500 }], currency: 'GBP', decimals: 2 };
const BODY = 'Grace - Q3 2026\n\nTotal income 12,345.00';

// ── the console's publishPost, lifted ──
function poster({ skeys = { g1: [GKEY] }, sealed = ['g1'], encrypt2 = nip44e, locked = false } = {}) {
  const body = fnBody(STEWARD, 'publishPost(content, group, replyTo, opts) {', 'publishPost');
  const published = [], warned = [];
  const scope = { sk: locked ? null : new Uint8Array(32).fill(1), _skeys: skeys, _sealedGroupIds: new Set(sealed),
    publish: (e) => { published.push(e); return Promise.resolve(e); }, feChurch: (e) => ({ ...e, id: 'ev1', pubkey: CHURCH }),
    now: () => 1763000000, NET: 'trinityone', pub: CHURCH, encrypt2, Promise, console: { warn: (...a) => warned.push(a.join(' ')) } };
  const api = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  return { api, published, warned };
}
const cardTagOf = (e) => e.tags.find(t => t[0] === 'card');

test('in a keyed room the card is sealed: no figure in any tag, and the tag is ["card","1",<ct>,"enc"]', async () => {
  const p = poster();
  const ev = await p.api.publishPost(BODY, 'g1', null, [['card', '1', JSON.stringify(FIN)]]);
  assert.ok(ev, 'the post was refused');
  const ct = cardTagOf(ev);
  assert.equal(ct.length, 4); assert.equal(ct[0], 'card'); assert.equal(ct[1], '1'); assert.equal(ct[3], 'enc');
  const allTags = JSON.stringify(ev.tags);
  assert.ok(!/1234500|finance|Q3 2026/.test(allTags), 'a statement figure or field rode the tags in clear: ' + allTags.slice(0, 300));
  assert.deepEqual(JSON.parse(nip44d(ct[2], GKEY)), FIN, 'the sealed card does not open to the statement under the room key');
  assert.ok(ev.tags.some(t => t[0] === 'enc'), 'the body seal marker is missing');
});

test('an open (unkeyed) room is unchanged: the card rides in clear, exactly as before', async () => {
  const p = poster({ skeys: {}, sealed: [] });
  const ev = await p.api.publishPost(BODY, 'notices', null, [['card', '1', JSON.stringify(FIN)]]);
  assert.deepEqual(cardTagOf(ev), ['card', '1', JSON.stringify(FIN)]);
});

test('a card that cannot be sealed (over the nip44 65535-byte cap) REFUSES the post - nothing is sent', async () => {
  const p = poster();
  const huge = { ...FIN, sections: [{ kind: 'note', text: 'x'.repeat(70000) }] };
  const r = await p.api.publishPost(BODY, 'g1', null, [['card', '1', JSON.stringify(huge)]]);
  assert.equal(r, null, 'an unsealable card must refuse the post');
  assert.equal(p.published.length, 0, 'something was published although the card could not be sealed');
  assert.ok(p.warned.some(w => /could not be sealed/.test(w)), 'the refusal was not logged');
  assert.equal(p.api.lastPostRefusal, 'unsealable', 'the refusal did not say why');
});

test('a BODY over the 65535-byte seal limit in a keyed room is refused too; the same body in an open room is sent', async () => {
  const big = 'x'.repeat(70000);
  const p = poster();
  assert.equal(await p.api.publishPost(big, 'g1'), null, 'an over-limit body was sealed and sent');
  assert.equal(p.published.length, 0);
  assert.equal(p.api.lastPostRefusal, 'unsealable');
  const q = poster({ skeys: {}, sealed: [] });
  assert.ok(await q.api.publishPost(big, 'notices'), 'an open room has no seal limit - this must still send');
  assert.equal(q.api.lastPostRefusal, '', 'a post that was not refused must clear the reason');
});

test('each refusal names its cause: locked, nokey', async () => {
  const l = poster({ locked: true });
  assert.equal(await l.api.publishPost('hi', 'notices'), null); assert.equal(l.api.lastPostRefusal, 'locked');
  const k = poster({ skeys: {}, sealed: ['g1'] });
  assert.equal(await k.api.publishPost('hi', 'g1'), null); assert.equal(k.api.lastPostRefusal, 'nokey');
});

// ── what each reader makes of the sealed event ──
function decEvtFrom(fel) {
  const body = fnBody(fel, 'function _decEvt(cp, e) {', '_decEvt');
  return new Function('NET', '_gkeys', '_gkKey', 'decrypt', body + '\nreturn _decEvt;')('trinityone', { [CHURCH + '|g1']: [GKEY] }, (cp, g) => cp + '|' + g, nip44d);
}
function loadOldChat(globals) {
  const dir = mkdtempSync(join(tmpdir(), 'trin-oldfin-'));
  try {
    const comp = (rel) => { const p = join(dir, rel.replace(/\//g, '_')); writeFileSync(p, execFileSync('git', ['-C', ROOT, 'show', '9acf00f2:' + rel], { maxBuffer: 1 << 26 })); return execFileSync(ESBUILD, [p, '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 }); };
    const js = comp('app/reply-kit.jsx') + '\n' + comp('app/screens-chat.jsx');
    const names = Object.keys(globals);
    return new Function(...names, js + '\nreturn { Bubble, evtToMsg };')(...names.map(k => globals[k]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function memberSees(evt, { old = false } = {}) {
  const { React, draw } = miniReact();
  const F = { myPubkey: ME, churchPub: CHURCH, isChurchVoice: (pk) => pk === CHURCH, displayFor: () => ({ handle: 'Grace', isChurch: true }) };
  const g = { React, window: { Fellowship: F, addEventListener() {}, removeEventListener() {} },
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }), UserAvatar: () => null,
    safeCssColor: (c, f) => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim()) ? c.trim() : (f || 'var(--clay)')),
    safeImgUrl: () => '', setTimeout: () => 0, clearTimeout: () => {} };
  const mod = old ? loadOldChat(g) : loadScreen('app/screens-chat.jsx', ['Bubble', 'evtToMsg', 'shareTextOf'], g);
  const m = mod.evtToMsg(evt);
  const ctx = { church: { id: CHURCH, name: 'Grace', accent: '#C25A38', initials: 'G' }, shareText() {}, openShare() {} };
  return { m, seen: texts(draw(mod.Bubble, { m, ctx, summary: [], live: false })).join(' | ') };
}
async function sealedEvent() {
  const ev = await poster().api.publishPost(BODY, 'g1', null, [['card', '1', JSON.stringify(FIN)]]);
  return { ...ev, tags: ev.tags.filter(t => t[0] !== 'p' || t[1] === CHURCH) };
}

test('ROUND TRIP, member app (this build): _decEvt opens the card and the statement is drawn', async () => {
  const dec = decEvtFrom(FEL_NOW)(CHURCH, await sealedEvent());
  assert.ok(dec, '_decEvt dropped the sealed statement');
  const r = memberSees(dec);
  assert.equal(r.m.kind, 'card'); assert.equal(r.m.card.type, 'finance');
  assert.match(r.seen, /12,345\.00/, 'the member app did not draw the sealed statement');
});

test('ROUND TRIP, OLD member build (main 9acf00f2): the decrypted body shows - not ciphertext, not JSON', async () => {
  const dec = decEvtFrom(FEL_MAIN)(CHURCH, await sealedEvent());
  assert.ok(dec, 'the old _decEvt dropped the message');
  const r = memberSees(dec, { old: true });
  assert.notEqual(r.m.kind, 'card', 'the old build made a card out of a ciphertext');
  assert.ok(r.seen.includes('Total income 12,345.00'), 'the old build did not show the decrypted body: ' + r.seen.slice(0, 200));
  assert.ok(!r.seen.includes(cardTagOf(dec)[2].slice(0, 24)), 'the old build showed the card ciphertext');
});

test("ROUND TRIP, the console's own chat: subscribeGroupChat opens the sealed card with the room key", async () => {
  const body = fnBody(STEWARD, 'subscribeGroupChat(groupId, onMsgs) {', 'subscribeGroupChat');
  let onevent = null, out = [];
  const pool = { subscribeMany: (r, f, h) => { if (f.some(x => x.kinds && x.kinds.includes(1))) onevent = h.onevent; return { close() {} }; } };
  const scope = { pool, relays: () => [], pub: CHURCH, _skeys: { g1: [new Uint8Array(32).fill(9), GKEY] }, decrypt3: nip44d,
    _careRoster: new Set(), _careRosterKnown: false, _memberEmitters: new Set(), setTimeout: () => 0, clearTimeout() {}, Map, Set, JSON,
    window: { Steward: { subscribeHidden: (cb) => { cb(new Set()); return () => {}; } } } };
  new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope).subscribeGroupChat('g1', (m) => { out = m; });
  const ev = await sealedEvent();
  onevent(ev);
  const m = out.find(x => x.id === ev.id);
  assert.equal(m.text, BODY);
  assert.deepEqual(m.card, FIN, 'the console could not open its own sealed statement');
  // an 'enc' card on a message whose body is NOT sealed is no card (nothing to open it with)
  onevent({ ...ev, id: 'ev2', content: 'plain', tags: ev.tags.filter(t => t[0] !== 'enc') });
  assert.equal(out.find(x => x.id === 'ev2').card, null);
});

// ── the treasurer's screen: the refusal reads as a refusal ──
const _FL = Object.assign({}, ...(await Promise.all(['finance-ledger', 'finance-store', 'finance-statement', 'finance-import', 'finance-reconcile', 'finance-reports'].map(n => import('../src/' + n + '.mjs')))));
// `p` is a poster(): its SHIPPED publishPost is installed as the Steward's own method, so the refusal reason lands
// on the very object the screen reads (S.lastPostRefusal), as it does in the console.
function treasurer(p) {
  const fr = fakeReact();
  let encSubCb = null;
  const Steward = fakeSteward({ actingChurch: '', encSubscribe: (_p, cb) => { encSubCb = cb; return () => {}; }, encPublish: async () => true, relayAuthed: () => true,
    publishPost: function (...a) { return p.api.publishPost.apply(this, a); } });
  const { window } = fakeBrowser({ Steward });
  window.FinanceLedger = _FL;
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashFinanceBook, FinanceShareStatement }' });
  window.useStewardChurch = () => ({ name: 'Grace', accent: '', picture: '' });
  window.useStewardGroups = () => [{ id: 'g1', name: 'Leaders', kind: 'broadcast' }];
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashFinanceBook(); fr.flush(); return tree; };
  draw();
  const b = _FL.createBook({ baseCurrency: 'GBP', decimals: 2 });
  _FL.addAccount(b, { id: 'bank', code: '1000', name: 'Bank', type: 'asset' });
  _FL.addAccount(b, { id: 'giving', code: '4000', name: 'Giving', type: 'income' });
  _FL.post(b, { date: new Date().getFullYear() + '-01-05', memo: 'offering', postings: [{ account: 'bank', dir: 'dr', amount: 25000 }, { account: 'giving', dir: 'cr', amount: 25000 }] });
  encSubCb(_FL.bookToDocs(b).map(d => ({ ...d, id: d.t === 'settings' ? 'settings' : d.t + ':' + (d.id || d.seq) })));
  draw();
  nodes(tree).find(n => n.type === 'button' && ctexts(n).join(' ').includes('Share statement')).props.onClick({ stopPropagation() {}, preventDefault() {} });
  draw();
  const props = nodes(tree).find(n => n.type === mods.FinanceShareStatement).props;
  fr.fresh();
  let m = null;
  const drawM = () => { fr.reset(); m = mods.FinanceShareStatement(props); fr.flush(); return m; };
  drawM();
  const btn = (l) => nodes(m).find(n => n.type === 'button' && ctexts(n).join(' ').includes(l));
  return { drawM, btn, seen: () => ctexts(drawM()).join(' | ') };
}

async function postAndRead(p) {
  const t = treasurer(p);
  t.btn('Post to members').props.onClick({ stopPropagation() {}, preventDefault() {} }); t.drawM();
  t.btn('Yes, post to members').props.onClick({ stopPropagation() {}, preventDefault() {} });
  await new Promise(r => setTimeout(r, 5));
  const seen = t.seen();
  assert.equal(p.published.length, 0, 'the statement went out although publishPost refused it');
  assert.ok(!/check your connection/i.test(seen), 'a refusal was blamed on the connection');
  assert.ok(!/Shared with members/i.test(seen), 'the screen claimed success');
  return seen;
}

test('POINT OF USE: a statement whose card cannot be sealed says it could not be sealed', async () => {
  const p = poster({ encrypt2: (pt, k) => { if (pt.startsWith('{')) throw new Error('seal failed'); return nip44e(pt, k); } });
  assert.match(await postAndRead(p), /Not sent\. This statement could not be sealed for that private group/);
});

test('POINT OF USE: a locked console says it is locked - even for an open group', async () => {
  const p = poster({ locked: true, skeys: {}, sealed: [] });
  const seen = await postAndRead(p);
  assert.match(seen, /Not sent\. The console is locked/);
  assert.ok(!/sealed|private group/i.test(seen), 'a locked console was described as a seal failure');
});

test('POINT OF USE: a private group with no key says the key is missing', async () => {
  const p = poster({ skeys: {}, sealed: ['g1'] });
  assert.match(await postAndRead(p), /Not sent\. This console does not have the key for that private group/);
});
