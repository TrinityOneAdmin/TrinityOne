// A MEMBER CAN PIN A VERSE FROM THE SHARE SHEET, AND IT TRAVELS FROM THERE TO THEIR CHURCH'S MEMBER CARD.
//   Run: node --test scripts/a-members-pinned-verse-reaches-their-card.test.mjs
//
// Phase 3 of TrinityOne-internal/PLAN-PROFILE-CARD-2026-11-26.md (REVISION 2: no child gating - children may pin).
// Every link is tested where it is USED (CLAUDE.md rule 1) and none by matching the text of a .jsx file (rule 3):
//   1. THE SHEET.   the REAL VerseShareSheet (app/screens-chat.jsx): Pin is offered only for a verse with a ref
//                   AND text; tapping it hands the verse to ctx.pinVerse and toasts only once that resolved.
//   2. THE PROFILE. the REAL ProfileSheet: shows the pin, Remove + Save sends pinnedVerse:null, a name-only Save
//                   sends no pinnedVerse key at all.
//   3. THE SAVE PATH. app.jsx's saveIdentity and `identity` object, sliced and RUN.
//   4. THE CARD.    the REAL MemberCard fed by the SHIPPED displayFor and kind-0 reader (vendor/fellowship.js).
//   5. THE ENGINE.  the SHIPPED setProfile (whole method, run against a fake relay) and both kind-0 readers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact, find, texts, eventTarget } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const IDENTITY = readFileSync(join(ROOT, 'app/identity.jsx'), 'utf8');
const APP = readFileSync(join(ROOT, 'app/app.jsx'), 'utf8');
const BUNDLE = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');
const words = (n, out = []) => { if (n == null || n === false) return out; if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; } if (Array.isArray(n)) { n.forEach(c => words(c, out)); return out; } (n.kids || []).forEach(c => words(c, out)); return out; };
const ME = 'a'.repeat(64), ANNA = 'b'.repeat(64);
const VERSE = { ref: 'John 3:16', text: 'For God so loved the world', version: 'BSB' };

// ── 1. the share sheet ─────────────────────────────────────────────────────────────────────────────────────
function sheet(payload, { pinned = null, pinResult = { id: 'evt' }, noPin = false } = {}) {
  const { React, draw } = miniReact();
  const pins = [], toasts = [];
  const F = {
    myPubkey: ME,
    publishMessage: async () => ({}), sendDM: async () => ({}),
    subscribeChurchGroups: (_c, cb) => { cb([]); return () => {}; }, subscribeChurchMembers: (_c, cb) => { cb([]); return () => {}; },
    displayFor: () => ({ handle: 'Me', pinnedVerse: pinned }),
  };
  const mod = loadScreen('app/screens-chat.jsx', ['VerseShareSheet'], {
    React,
    window: { matchMedia: () => ({ matches: true }), Fellowship: F, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-11-26',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ children }) => children, ScreenScroll: ({ children }) => children,
    ChurchPill: () => null, UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: c => c, relTime: () => 'now', avOf: d => d.av, D: { GROUPS: [], RELAYS: [] },
  });
  const closed = [];
  const ctx = { toast: (m) => toasts.push(m), church: { npub: 'npub1church' }, canDMPeer: () => true, shareText() {}, openShare() {} };
  if (!noPin) ctx.pinVerse = (v) => { pins.push(v); return Promise.resolve(pinResult); };
  const props = { payload, open: true, onClose: () => closed.push(1), ctx };
  draw(mod.VerseShareSheet, props);
  const tree = draw(mod.VerseShareSheet, props);
  const pinBtn = find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Pin to my profile');
  return { pinBtn, pins, toasts, closed, tree };
}
const flush = () => new Promise(r => setTimeout(r, 0));

test('SHEET: a verse offers Pin, and tapping it hands the verse to the save path, then toasts', async () => {
  const s = sheet({ ...VERSE });
  assert.equal(s.pinBtn.length, 1, 'a verse share sheet does not offer "Pin to my profile"');
  s.pinBtn[0].props.onClick();
  assert.deepEqual(s.pins, [VERSE], 'tapping Pin did not hand { ref, text, version } to ctx.pinVerse');
  assert.deepEqual(s.toasts, [], 'the sheet said "Pinned" before the save had resolved');
  await flush();
  assert.deepEqual(s.toasts, ['Pinned to your profile']);
  assert.equal(s.closed.length, 1, 'the sheet stayed open after pinning');
});
test('SHEET: a pin that did not save says so, never "Pinned"', async () => {
  const s = sheet({ ...VERSE }, { pinResult: null });
  s.pinBtn[0].props.onClick();
  await flush();
  assert.equal(s.toasts.length, 1);
  assert.doesNotMatch(s.toasts[0], /^Pinned/, 'a failed save was announced as pinned');
});
test('SHEET: commentary, note, devotional and an empty-text cross-reference preview offer no Pin', () => {
  const cases = {
    commentary: { type: 'commentary', ref: 'Ruth 1:16', source: 'Notes', text: 'Where you go', license: '' },
    note: { type: 'note', ref: 'John 3:16', text: 'For God so loved', version: 'BSB', note: 'mine' },
    devotional: { type: 'devotional', title: 'Rest', ref: 'Psalm 23', series: 's', excerpt: 'x' },
    'cross-ref preview with no text': { ref: 'John 3:16', text: '', version: '' },
    'no ref': { text: 'For God so loved', ref: '', version: 'BSB' },
  };
  for (const [k, p] of Object.entries(cases)) assert.equal(sheet(p).pinBtn.length, 0, k + ' offers Pin');
  assert.equal(sheet({ ...VERSE }, { noPin: true }).pinBtn.length, 0, 'Pin shown with no save path behind it');
});
test('SHEET: a ref over 80 or a version over 40 offers no Pin (the engine would read it as malformed = CLEAR); the limits themselves do', () => {
  assert.equal(sheet({ ...VERSE, ref: 'x'.repeat(81) }).pinBtn.length, 0, 'an 81-char ref (a long scattered-verse range) offers Pin, which would erase the old pin');
  assert.equal(sheet({ ...VERSE, version: 'v'.repeat(41) }).pinBtn.length, 0, 'a 41-char version offers Pin');
  assert.equal(sheet({ ...VERSE, ref: 'x'.repeat(80) }).pinBtn.length, 1, 'CONTROL: an 80-char ref is refused');
  assert.equal(sheet({ ...VERSE, version: 'v'.repeat(40) }).pinBtn.length, 1, 'CONTROL: a 40-char version is refused');
  assert.equal(sheet({ ...VERSE, text: 't'.repeat(900) }).pinBtn.length, 1, 'CONTROL: long text is capped by the engine, not refused');
});
test('SHEET: a saved event that does not carry this pin is not announced as pinned', async () => {
  const s = sheet({ ...VERSE }, { pinResult: { content: JSON.stringify({ about: '' }) } });
  s.pinBtn[0].props.onClick();
  await flush();
  assert.equal(s.toasts.length, 1);
  assert.doesNotMatch(s.toasts[0], /^Pinned/, 'a save whose event holds no pin was announced as pinned');
  const ok = sheet({ ...VERSE }, { pinResult: { content: JSON.stringify({ pinnedVerse: VERSE }) } });
  ok.pinBtn[0].props.onClick();
  await flush();
  assert.deepEqual(ok.toasts, ['Pinned to your profile'], 'CONTROL: a save that holds the pin was not announced');
});
test('SHEET: a verse that is already pinned shows as pinned and does not save again', async () => {
  const s = sheet({ ...VERSE }, { pinned: { ...VERSE } });
  assert.equal(s.pinBtn.length, 1);
  assert.match(words(s.pinBtn[0]).join(' '), /Pinned to your profile/);
  s.pinBtn[0].props.onClick();
  await flush();
  assert.deepEqual(s.pins, [], 'an already-pinned verse was saved a second time');
  assert.deepEqual(s.toasts, []);
});

// ── 2. the profile screen ──────────────────────────────────────────────────────────────────────────────────
async function mountProfileSheet(identity) {
  const src = fnBody(IDENTITY, 'function ProfileSheet(', 'ProfileSheet');
  const tmp = join(tmpdir(), 'pin-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { ProfileSheet };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
  const globals = {
    React, useId: React.useState, useIdE: React.useEffect,
    window: { ...eventTarget(), TrinityData: { RELAYS: [] }, TrinityWallet: null, Fellowship: null, TrinityLN: null },
    AvatarPicker: Stub('AvatarPicker'), Overlay: function Overlay(p) { return p.children; },
    Icon: Stub('Icon'), UserAvatar: Stub('UserAvatar'),
    IconBtn: ({ title, onClick }) => React.createElement('button', { title, onClick }),
    DirectoryToggle: Stub('DirectoryToggle'), BackupCard: Stub('BackupCard'),
    AppVersion: Stub('AppVersion'), FamilySheet: Stub('FamilySheet'),
    VotdToggle: Stub('VotdToggle'), HomeWidgetToggle: Stub('HomeWidgetToggle'),
    WALLET_ENABLED: false, navigator: { clipboard: null }, setTimeout, clearTimeout, console,
  };
  const key = '__pin_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { ProfileSheet } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  const saves = [];
  const ctx = { church: { name: 'Grace', features: {} }, safeguard: { isMinor: false }, toast() {}, openChurchSwitcher() {}, openHelp() {} };
  const props = { open: true, onClose() {}, onSave: (p) => { saves.push(p); return { id: 'evt' }; }, ctx, identity };
  return { draw: () => draw(ProfileSheet, props), saves };
}
const MIA = { name: 'Mia Whitlock', avatar: null, npub: 'npub1miaaaaaaaaaaaaaaaaaaaaaa', about: '', pinnedVerse: { ...VERSE } };
async function intoEdit(identity) {
  const m = await mountProfileSheet(identity);
  const edit = find(m.draw(), n => n.type === 'button' && texts(n).join('').includes('Edit name & mark'));
  assert.equal(edit.length, 1, 're-anchor: no way into edit mode');
  edit[0].props.onClick();
  return { ...m, tree: m.draw() };
}
const pressSave = (tree) => { const s = find(tree, n => n.type === 'button' && texts(n).join('') === 'Save'); assert.equal(s.length, 1); s[0].props.onClick(); };

test('PROFILE: view mode shows the pinned verse with its reference and version', async () => {
  const m = await mountProfileSheet({ ...MIA });
  const q = find(m.draw(), n => n.props && n.props['data-pinned-verse'] === '1');
  assert.equal(q.length, 1, 'the member cannot see their pinned verse on their own profile');
  assert.match(words(q[0]).join(' '), /For God so loved the world.*John 3:16.*BSB/);
  const none = await mountProfileSheet({ ...MIA, pinnedVerse: null });
  assert.equal(find(none.draw(), n => n.props && n.props['data-pinned-verse']).length, 0, 'a pinned block with nothing pinned');
});
test('PROFILE: Remove then Save sends pinnedVerse:null', async () => {
  const m = await intoEdit({ ...MIA });
  const rm = find(m.tree, n => n.type === 'button' && n.props.title === 'Remove pinned verse');
  assert.equal(rm.length, 1, 'edit mode has no Remove control for the pinned verse');
  rm[0].props.onClick();
  const after = m.draw();
  assert.equal(find(after, n => n.props && n.props['data-pinned-verse']).length, 0, 'the pin is still shown after Remove');
  pressSave(after);
  assert.equal(m.saves.length, 1);
  assert.ok('pinnedVerse' in m.saves[0] && m.saves[0].pinnedVerse === null, 'Remove + Save did not send pinnedVerse:null: ' + JSON.stringify(m.saves[0]));
});
test('PROFILE: a name-only Save sends no pinnedVerse key', async () => {
  const m = await intoEdit({ ...MIA });
  find(m.tree, n => n.type === 'input')[0].props.onChange({ target: { value: 'Mia W' } });
  pressSave(m.draw());
  assert.equal(m.saves[0].name, 'Mia W', 'CONTROL: the name was not saved');
  assert.ok(!('pinnedVerse' in m.saves[0]), 'a name-only Save sent pinnedVerse, which would clear or overwrite the pin');
});

// ── 3. the save path ───────────────────────────────────────────────────────────────────────────────────────
function liftSaveIdentity() {
  const body = fnBody(APP, 'const saveIdentity = (patch) => {', 'saveIdentity');
  const sent = [];
  const fn = new Function('window', 'String', body + '\nreturn saveIdentity;')(
    { Fellowship: { ready: Promise.resolve(), setProfile: async (meta) => { sent.push(meta); return { id: 'evt' }; } } }, String);
  return { fn, sent };
}
test('SAVE PATH: saveIdentity passes a pinned verse, passes null (Remove), and sends nothing when absent', async () => {
  const { fn, sent } = liftSaveIdentity();
  await fn({ pinnedVerse: { ...VERSE } });
  await fn({ pinnedVerse: null });
  await fn({ name: 'Mia' });
  assert.deepEqual(sent[0].pinnedVerse, VERSE, 'a pinned verse stops at saveIdentity');
  assert.ok('pinnedVerse' in sent[1] && sent[1].pinnedVerse === null, 'null (Remove) is swallowed, so a pin can never be removed');
  assert.ok(!('pinnedVerse' in sent[2]), 'a name-only save sent a pinnedVerse key');
});
test('SAVE PATH: the ctx.pinVerse line in app.jsx reaches setProfile as a pinnedVerse', async () => {
  const lines = APP.split('\n').filter(l => l.trim().startsWith('pinVerse:'));
  assert.equal(lines.length, 1, 're-anchor: expected exactly one pinVerse ctx line in app.jsx');
  const { fn: saveIdentity, sent } = liftSaveIdentity();
  const ctx = new Function('saveIdentity', 'return ({' + lines[0] + '});')(saveIdentity);
  await ctx.pinVerse({ ...VERSE });
  assert.equal(sent.length, 1, 'ctx.pinVerse never reached setProfile');
  assert.deepEqual(sent[0].pinnedVerse, VERSE);
});
test('SAVE PATH: identity.pinnedVerse is the fresh kind-0 copy once our kind-0 was seen, else myProfile', () => {
  const anchor = 'const identity = (() => {';
  const at = APP.indexOf(anchor);
  assert.notEqual(at, -1); assert.equal(APP.indexOf(anchor, at + 1), -1);
  const arrow = fnBody(APP, at + anchor.indexOf('() =>'), 'identity');
  const build = (myProfile, d) => new Function('window', 'return (' + arrow + ')();')({
    TrinityIdentity: { current: { npub: 'npub1x', color: '#123456' } }, TrinityData: {},
    Fellowship: { myProfile, myPubkey: ME, displayFor: () => d },
  });
  const old = { ref: 'Psalm 1:1', text: 'Blessed', version: 'BSB' };
  assert.deepEqual(build({ name: 'M', pinnedVerse: old }, {}).pinnedVerse, old, 'myProfile fallback lost');
  assert.deepEqual(build({ name: 'M', pinnedVerse: old }, { about: '', aboutKnown: false, pinnedVerse: VERSE }).pinnedVerse, VERSE, 'the fresh copy does not win');
  assert.equal(build({ name: 'M', pinnedVerse: old }, { about: '', aboutKnown: true, pinnedVerse: null }).pinnedVerse, null,
    'a pin removed on another device is brought back from the stale myProfile');
  assert.equal(build({ name: 'M' }, {}).pinnedVerse, null);
});

// ── 4/5. the engine (shipped bundle) ───────────────────────────────────────────────────────────────────────
function once(src, anchor) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, 're-anchor: ' + anchor + ' missing from vendor/fellowship.js');
  assert.equal(src.indexOf(anchor, at + 1), -1, 're-anchor: ' + anchor + ' occurs more than once');
  return at;
}
function engine() {
  once(BUNDLE, 'function displayFor('); once(BUNDLE, 'function _flushProfiles('); once(BUNDLE, 'function _profilePin(');
  const cap = BUNDLE.match(/var ABOUT_MAX = \d+;/g);
  const pieces = [cap[0], ...['function _profileAbout(', 'function _profilePin(', 'function displayFor(', 'function _flushProfiles('].map(a => fnBody(BUNDLE, a, a))];
  const hubAt = once(BUNDLE, 'const nm = meta.name || meta.display_name || had.name || "";');
  const hubStart = BUNDLE.lastIndexOf('onevent(e) {', hubAt);
  const hubOnevent = fnBody(BUNDLE, hubStart, 'hub onevent');
  const profiles = {};
  const hub = { byPub: new Map(), dirty: false };
  const env = {
    profiles, hub, pub: 'f'.repeat(64), UNNAMED: 'Member', AV_SYMBOLS: ['halo', 'dove'],
    hashStr: (s) => s.length, profile: (pk) => ({ pubkey: pk, handle: '', color: '#000' }),
    _avSuppressPhoto: (pk, av) => av, churchVoiceFor: () => null, _churchNames: new Map(), _churchRoster: new Map(),
    _profQueue: new Set(), _profTimer: null, pendingProfiles: new Set(), _k0Seen: new Set(),
    _recoverOwnProfile() {}, saveProfiles() {}, _memHubSaveSoon() {}, emit() {}, groupReadRelays: () => ['wss://box'],
    window: { Fellowship: { churchPub: 'c'.repeat(64) }, dispatchEvent() {} },
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = (i || {}).detail; } },
  };
  let deliver = null;
  env.pool = { subscribeMany: (urls, filters, h) => { deliver = h; return { close() {} }; } };
  const names = Object.keys(env);
  const api = new Function(...names, pieces.join('\n') + '\nreturn { displayFor, _flushProfiles, hubOnevent: function (e) ' + hubOnevent.slice(hubOnevent.indexOf('{')) + ' };')(...names.map(n => env[n]));
  const viaFlush = (pk, content) => { env._profQueue.add(pk); api._flushProfiles(); deliver.onevent({ pubkey: pk, content: JSON.stringify(content) }); return api.displayFor(pk); };
  const viaHub = (pk, content) => { api.hubOnevent({ pubkey: pk, content: JSON.stringify(content) }); return api.displayFor(pk); };
  return { viaFlush, viaHub, profiles, displayFor: api.displayFor };
}

for (const route of ['viaFlush', 'viaHub']) {
  test(`ENGINE (${route}): a published pinnedVerse comes back from displayFor`, () => {
    const d = engine()[route](ANNA, { about: '', pinnedVerse: { ...VERSE } });
    assert.deepEqual(d.pinnedVerse, VERSE, 'the pin another member published never reaches displayFor');
  });
  test(`ENGINE (${route}): invalid shapes become null, text is cut to 500 without a split emoji`, () => {
    const E = engine();
    const bad = [null, 'x', 7, [], {}, { ref: 'a', text: 'b' }, { ref: 1, text: 'b', version: '' }, { ref: 'a', text: 2, version: '' },
      { ref: 'a', text: 'b', version: 3 }, { ref: 'r'.repeat(81), text: 'b', version: '' }, { ref: 'a', text: 'b', version: 'v'.repeat(41) },
      { ref: '', text: 'b', version: '' }, { ref: 'a', text: '', version: '' }];
    for (const b of bad) assert.equal(E[route](ANNA, { pinnedVerse: b }).pinnedVerse, null, 'accepted ' + JSON.stringify(b));
    const long = E[route](ANNA, { pinnedVerse: { ref: 'a', text: 'x'.repeat(900), version: '' } }).pinnedVerse;
    assert.equal(long.text.length, 500, 'a 900-character verse text was not cut to 500');
    assert.equal(E.profiles[ANNA].pinnedVerse.text.length, 500, 'the cache kept the uncut text');
    const emoji = E[route](ANNA, { pinnedVerse: { ref: 'a', text: 'x'.repeat(499) + '\u{1F600}', version: '' } }).pinnedVerse;
    assert.equal(emoji.text, 'x'.repeat(499), 'the cut left half an emoji');
    const kept = E[route](ANNA, { pinnedVerse: { ref: 'a', text: 'b', version: '', extra: 'z', name: 'Mallory' } }).pinnedVerse;
    assert.deepEqual(kept, { ref: 'a', text: 'b', version: '' }, 'extra fields from another member\'s event were kept');
  });
}
test('ENGINE: displayFor re-validates a pin already in the cache, and says null for someone with none', () => {
  const E = engine();
  E.profiles[ANNA] = { name: 'A', pinnedVerse: { ref: 'a', text: 'y'.repeat(900), version: '' } };
  assert.equal(E.displayFor(ANNA).pinnedVerse.text.length, 500);
  E.profiles[ANNA] = { name: 'A', pinnedVerse: 'junk' };
  assert.equal(E.displayFor(ANNA).pinnedVerse, null);
  assert.equal(E.displayFor(ME).pinnedVerse, null);
});

// the SHIPPED setProfile, whole, against a fake relay
function grabMethod(src, sig) {
  const at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone - re-anchor');
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('no end for ' + sig);
}
const grabFn = (name) => { const m = new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  \\}').exec(BUNDLE); assert.ok(m, 'could not lift ' + name); return m[0]; };
const grabVar = (name) => { const m = new RegExp('\\n  (?:var|let|const) ' + name + ' = [\\s\\S]*?;').exec(BUNDLE); assert.ok(m, 'could not lift ' + name); return m[0]; };
const SET_BODY = grabMethod(BUNDLE, 'async setProfile(meta)');
const FE_NAME = (SET_BODY.match(/\bfinalizeEvent\d*\b/) || [])[0];
const HELPERS = [grabVar('AV_SYMBOLS'), grabVar('_photosOffChurches'), grabFn('hashStr'), grabFn('_churchPhotosOff'), grabFn('_stripPhoto'),
  grabVar('normPub'), grabFn('isPhotoSuppressed'), 'let _noPhoto = new Set();', grabFn('_myPhotoReset')].join('\n');
function memberSide(cached = {}, tweak = null) {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const state = { published: [], toasts: [] };
  const scope = {
    sk, pub, profiles: { [pub]: { ...cached } }, _k0Seen: new Set([pub]), _profilePubFor: '', _profilePubBody: '',
    _outbox: [], _outboxSave: () => {}, isConnectionFailure: () => false, isNoNetworkRelay: () => false, PROFILE_KEY: 'k',
    localStorage: { setItem() {}, getItem: () => null }, console: { warn() {} },
    CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
    _publishAny: async (_r, evt) => { state.published.push(evt); }, profilePublishRelays: () => ['wss://t.invalid'],
    window: { Fellowship: { ready: Promise.resolve(), relays: ['wss://t.invalid'], myProfile: null, requestProfiles() {}, syncSealedNames() {} }, dispatchEvent() {}, trinityToast: (m) => state.toasts.push(String(m)) },
  };
  scope._pubReason = () => '';
  const m0 = { scope, state };
  if (tweak) tweak(m0);
  const args = Object.keys(scope);
  const fn = new Function(...args, FE_NAME, `${HELPERS}\nreturn ({ ${SET_BODY} }).setProfile;`)(...args.map(k => scope[k]), finalizeEvent);
  return { call: (meta) => fn(meta), state, scope, pub, last: () => JSON.parse(state.published[state.published.length - 1].content) };
}
test('ENGINE: setProfile puts the pin on the wire, never the name, and keeps it as the next prev', async () => {
  const m = memberSide({ name: 'Mia', about: 'hi' });
  await m.call({ name: 'Mia Whitlock', pinnedVerse: { ...VERSE } });
  assert.deepEqual(m.last().pinnedVerse, VERSE, 'the pin is not on the kind-0 wire');
  assert.ok(!('name' in m.last()), 'the member\'s name is on the kind-0 wire (Stage 2 sealed it)');
  assert.deepEqual(m.scope.window.Fellowship.myProfile.pinnedVerse, VERSE, 'the pin is not kept locally');
  assert.deepEqual(m.scope.profiles[m.pub].pinnedVerse, VERSE, 'the pin is not in the cache that becomes the next prev');
});
test('ENGINE: undefined keeps the pin, null clears it, a malformed one clears it, text is cut to 500', async () => {
  const m = memberSide({ name: 'Mia', pinnedVerse: { ...VERSE } });
  await m.call({ about: 'new bio' });   // undefined -> keep
  assert.deepEqual(m.last().pinnedVerse, VERSE, 'a save that did not mention the pin lost it');
  await m.call({ pinnedVerse: null });
  assert.ok(!('pinnedVerse' in m.last()), 'null did not clear the pin on the wire');
  assert.ok(!m.scope.profiles[m.pub].pinnedVerse);
  await m.call({ pinnedVerse: { ...VERSE } });
  await m.call({ pinnedVerse: { ref: 'a', text: 5, version: '' } });
  assert.ok(!('pinnedVerse' in m.last()), 'a malformed pin was published');
  await m.call({ pinnedVerse: { ref: 'a', text: 'x'.repeat(499) + '\u{1F600}', version: 'v'.repeat(10) } });
  assert.equal(m.last().pinnedVerse.text, 'x'.repeat(499), 'own pin text was not cut to 500 without a split emoji');
  await m.call({ pinnedVerse: { ref: 'r'.repeat(81), text: 'b', version: '' } });
  assert.ok(!('pinnedVerse' in m.last()), 'an 81-character ref was published');
});
test('ENGINE: a pin-only change publishes', async () => {
  const m = memberSide({ name: 'Mia', about: 'hi' });
  await m.call({ name: 'Mia' });
  const before = m.state.published.length;
  await m.call({ pinnedVerse: { ...VERSE } });
  assert.equal(m.state.published.length, before + 1, 'pinning a verse published nothing');
  await m.call({ pinnedVerse: null });
  assert.equal(m.state.published.length, before + 2, 'removing the pin published nothing (null is a change)');
});
test('ENGINE: a pin that no relay accepted is reported (it is something that travels); a name-only save is not', async () => {
  const refuse = (m) => { m.scope._publishAny = async () => { throw new Error('refused'); }; m.scope._pubReason = () => 'refused'; };
  const pinned = memberSide({ name: 'Mia' }, refuse);
  await pinned.call({ pinnedVerse: { ...VERSE } });
  assert.equal(pinned.state.toasts.length, 1, 'a refused pin was never reported - the member believes it is pinned');
  const removed = memberSide({ name: 'Mia', pinnedVerse: { ...VERSE } }, refuse);
  await removed.call({ pinnedVerse: null });
  assert.equal(removed.state.toasts.length, 1, 'a refused Remove was never reported');
  const nameOnly = memberSide({ name: 'Mia' }, refuse);
  await nameOnly.call({ name: 'Mia W' });
  assert.equal(nameOnly.state.toasts.length, 0, 'CONTROL: a name-only save (nothing travels) was reported as unsaved');
});

test('ENGINE: a pin cannot be sent while our own kind-0 is unread - it is withheld, and the member is told', async () => {
  // the OTHER "something that travels" list: our own profile has not arrived (this waits the engine's six seconds)
  const m = memberSide({ name: 'Mia' }, (x) => { x.scope._k0Seen = new Set(); });
  await m.call({ pinnedVerse: { ...VERSE } });
  assert.equal(m.state.published.length, 0, 'a pin was published over a profile we have not read');
  assert.equal(m.state.toasts.length, 1, 'a withheld pin was not reported');
  const n = memberSide({ name: 'Mia' }, (x) => { x.scope._k0Seen = new Set(); });
  await n.call({ name: 'Mia W' });
  assert.equal(n.state.toasts.length, 0, 'CONTROL: a name-only save was reported as unsaved');
});

// ── own-profile recovery ───────────────────────────────────────────────────────────────────────────────────
test('ENGINE: _recoverOwnProfile recovers a pin, validates it, and never overwrites one we hold', () => {
  const body = fnBody(BUNDLE, 'function _recoverOwnProfile(', '_recoverOwnProfile');
  const run = (cur, pv) => {
    const win = { Fellowship: { myProfile: cur }, dispatchEvent() {} };
    const fn = new Function('pub', 'window', 'localStorage', 'PROFILE_KEY', 'CustomEvent', body + '\nreturn _recoverOwnProfile;')('me', win, { setItem() {} }, 'k', class {});
    fn({ pubkey: 'me', content: JSON.stringify({ pinnedVerse: pv }) });
    return win.Fellowship.myProfile.pinnedVerse;
  };
  assert.deepEqual(run({}, { ...VERSE }), VERSE, 'a locked boot loses the pin for good');
  assert.equal(run({}, { ref: 'a', text: 'x'.repeat(900), version: '' }).text.length, 500);
  assert.equal(run({}, { ref: 'a', text: 5, version: '' }), undefined, 'a malformed recovered pin was stored');
  const mine = { ref: 'Psalm 1:1', text: 'Blessed', version: 'BSB' };
  assert.deepEqual(run({ pinnedVerse: mine }, { ...VERSE }), mine, 'a pin we already hold was overwritten');
});

// ── 4. the card ────────────────────────────────────────────────────────────────────────────────────────────
test('CARD: the real MemberCard shows the pin the shipped engine hands back (plain text, with version)', () => {
  const E = engine();
  E.viaFlush(ANNA, { about: 'hi', pinnedVerse: { ...VERSE, text: '<b>For God</b> so loved' } });
  const { React, draw } = miniReact();
  const mod = loadScreen('app/identity-extras.jsx', ['MemberCard'], {
    React, window: { Fellowship: { myPubkey: ME, displayFor: E.displayFor } },
    UserAvatar: () => null, BottomSheet: ({ open, children }) => (open ? children : null),
    IconBtn: () => null, Icon: () => null,
  });
  const tree = draw(mod.MemberCard, { pubkey: ANNA, open: true, onClose() {}, ctx: {} });
  const q = find(tree, n => n.props && n.props['data-member-pinned'] === '1');
  assert.equal(q.length, 1, 'the member card shows no pinned verse');
  assert.equal(words(q[0]).join(''), '<b>For God</b> so lovedJohn 3:16 · BSB', 'the pin is not rendered as plain text with ref and version');
  const none = draw(mod.MemberCard, { pubkey: 'd'.repeat(64), open: true, onClose() {}, ctx: {} });
  assert.equal(find(none, n => n.props && n.props['data-member-pinned']).length, 0);
});
