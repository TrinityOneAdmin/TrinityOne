// A MEMBER CAN WRITE A ONE-LINE BIO, AND IT GETS FROM THEIR PROFILE SCREEN TO THE ENGINE AND BACK OUT AGAIN.
//   Run: node --test scripts/a-members-bio-reaches-their-church.test.mjs
//
// Phase 1 of TrinityOne-internal/PLAN-PROFILE-CARD-2026-11-26.md (REVISION 2: no child gating - owner decision,
// children may have a bio). Three links, each tested where it is USED (CLAUDE.md rule 1), none by matching the
// text of a .jsx file (rule 3):
//
//   1. THE SCREEN. The REAL ProfileSheet is sliced out of app/identity.jsx, compiled with the packaged esbuild,
//      rendered through scripts/render-jsx-screen.mjs (as a-childs-photo-control-is-off.test.mjs does), driven
//      into edit mode by the member's own button, typed into, and saved. What onSave receives is read. View mode
//      is rendered with identity.about set and the bio is looked for in the tree.
//   2. THE SAVE PATH. app/app.jsx's saveIdentity and the `identity` object App builds for ProfileSheet are lifted
//      and RUN against a stub Fellowship: `about` must reach setProfile, a save that does not mention it must not
//      send it (setProfile reads a missing `about` as "keep what is stored"), and the member's own stored bio
//      must reach identity.about so the edit box is seeded with it.
//   3. THE ENGINE. The SHIPPED vendor/fellowship.js (the bundle, never src): both kind-0 readers that build
//      profile records (_flushProfiles and the member hub's live profile subscription) are lifted and fed an
//      event; displayFor() is lifted and must hand `about` back. Other people's events are untrusted, so a
//      non-string `about` must come back '' and an over-long one cut to 160.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts, eventTarget } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const IDENTITY = readFileSync(join(ROOT, 'app/identity.jsx'), 'utf8');
const APP = readFileSync(join(ROOT, 'app/app.jsx'), 'utf8');
const BUNDLE = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// ── 1. the screen ───────────────────────────────────────────────────────────────────────────────────────────
async function mountProfileSheet(identity) {
  const src = fnBody(IDENTITY, 'function ProfileSheet(', 'ProfileSheet');
  const tmp = join(tmpdir(), 'bio-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { ProfileSheet };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const globals = {
    React, useId: React.useState, useIdE: React.useEffect,
    window: { ...eventTarget(), TrinityData: { RELAYS: [] }, TrinityWallet: null, Fellowship: null, TrinityLN: null },
    AvatarPicker: Stub('AvatarPicker'), Overlay: function Overlay(p) { return p.children; },
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), UserAvatar: Stub('UserAvatar'),
    DirectoryToggle: Stub('DirectoryToggle'), BackupCard: Stub('BackupCard'),
    AppVersion: Stub('AppVersion'), FamilySheet: Stub('FamilySheet'),
    VotdToggle: Stub('VotdToggle'), HomeWidgetToggle: Stub('HomeWidgetToggle'),
    WALLET_ENABLED: false, navigator: { clipboard: null }, setTimeout, clearTimeout, console,
  };
  const key = '__bio_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { ProfileSheet } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  const saves = [];
  const ctx = { church: { name: 'Grace', features: {} }, safeguard: { isMinor: false }, toast() {}, openChurchSwitcher() {}, openHelp() {} };
  const props = { open: true, onClose() {}, onSave: (p) => { saves.push(p); return { id: 'evt' }; }, ctx, identity };
  return { draw: () => draw(ProfileSheet, props), saves, props };
}
async function intoEdit(identity) {
  const m = await mountProfileSheet(identity);
  let tree = m.draw();
  const edit = find(tree, n => n.type === 'button' && texts(n).join('').includes('Edit name & mark'));
  assert.equal(edit.length, 1, 'the profile sheet no longer offers a way into edit mode - re-anchor this test');
  edit[0].props.onClick();
  tree = m.draw();
  return { ...m, tree };
}
const bioBox = (tree) => {
  const boxes = find(tree, n => n.type === 'textarea');
  assert.equal(boxes.length, 1, 'the edit screen no longer renders exactly one textarea (the bio box)');
  return boxes[0];
};
const hasText = (tree, s) => find(tree, n => (n.kids || []).some(k => k === s)).length > 0;

const MIA = { name: 'Mia Whitlock', avatar: null, npub: 'npub1miaaaaaaaaaaaaaaaaaaaaaa' };

test('SCREEN: a bio typed into the profile sheet is what Save hands on', async () => {
  const m = await intoEdit({ ...MIA, about: '' });
  const box = bioBox(m.tree);
  assert.equal(box.props.maxLength, 160, 'the bio box no longer stops at 160 characters');
  assert.equal(box.props.placeholder, 'A short line about you (optional)');
  box.props.onChange({ target: { value: '  Sings alto, makes the tea  ' } });
  let tree = m.draw();
  assert.ok(texts(tree).includes('29/160'), 'the live counter does not follow what was typed');
  const save = find(tree, n => n.type === 'button' && texts(n).join('') === 'Save');
  assert.equal(save.length, 1, 'no Save button - re-anchor this test');
  save[0].props.onClick();
  assert.equal(m.saves.length, 1, 'pressing Save did not call onSave');
  assert.equal(m.saves[0].about, 'Sings alto, makes the tea',
    'the bio the member typed never left the profile screen (or was not trimmed)');
  assert.equal(m.saves[0].name, 'Mia Whitlock', 'CONTROL: the name stopped travelling with the bio');
});

test('SCREEN: the bio box is seeded with the bio the member already has', async () => {
  const m = await intoEdit({ ...MIA, about: 'Welcome team, 9:30' });
  assert.equal(bioBox(m.tree).props.value, 'Welcome team, 9:30',
    'editing the profile starts from an empty bio, so pressing Save to change only the name wipes the bio');
});

test('SCREEN: a bio that arrives while the sheet is open (relay echo, another device) re-seeds the box', async () => {
  // The reseed effect, not the initial state: the sheet opens with no bio, then the profile lands.
  const m = await mountProfileSheet({ ...MIA, about: '' });
  m.draw();
  m.props.identity = { ...MIA, about: 'Arrived later' };
  let tree = m.draw();
  const edit = find(tree, n => n.type === 'button' && texts(n).join('').includes('Edit name & mark'));
  edit[0].props.onClick();
  tree = m.draw();
  assert.equal(bioBox(tree).props.value, 'Arrived later',
    'a bio that reached this device after the sheet opened is not in the edit box, so Save would wipe it');
});

// ── the wipe (audit 2026-11-26, AMBER): an Edit opened before our own kind-0 arrived ──────────────────────
const nameBox = (tree) => {
  const ins = find(tree, n => n.type === 'input');
  assert.ok(ins.length >= 1, 'no display-name input - re-anchor this test');
  return ins[0];
};
const pressSave = (tree) => {
  const save = find(tree, n => n.type === 'button' && texts(n).join('') === 'Save');
  assert.equal(save.length, 1, 'no Save button - re-anchor this test');
  save[0].props.onClick();
};

test('SCREEN: changing only the name does not send a bio (an empty seed must not clear the stored one)', async () => {
  const m = await intoEdit({ ...MIA, about: '' });   // our kind-0 has not arrived yet
  nameBox(m.tree).props.onChange({ target: { value: 'Mia W' } });
  pressSave(m.draw());
  assert.equal(m.saves.length, 1);
  assert.equal(m.saves[0].name, 'Mia W', 'CONTROL: the name change was not saved');
  assert.ok(!('about' in m.saves[0]),
    'a name-only Save sent `about` (' + JSON.stringify(m.saves[0].about) + '): setProfile reads "" as clear, so ' +
    'the member\'s real bio is wiped because the box was seeded before their profile arrived');
});

test('SCREEN: a bio that lands WHILE editing fills an untouched box, and a name-only Save still sends no bio', async () => {
  const m = await intoEdit({ ...MIA, about: '' });
  m.props.identity = { ...MIA, about: 'Arrived mid-edit' };   // the kind-0 lands; App re-renders the sheet
  m.draw();   // the reseed effect runs after this draw; React re-renders on its setState, the harness needs a 2nd draw
  let tree = m.draw();
  assert.equal(bioBox(tree).props.value, 'Arrived mid-edit', 'an untouched bio box does not show the bio that just arrived');
  nameBox(tree).props.onChange({ target: { value: 'Mia W' } });
  pressSave(m.draw());
  assert.ok(!('about' in m.saves[0]), 'the bio that arrived mid-edit was re-sent (or blanked) by a name-only Save');
});

test('SCREEN: once the member has typed in the box, an arriving bio does not overwrite it, and theirs is sent', async () => {
  const m = await intoEdit({ ...MIA, about: '' });
  bioBox(m.tree).props.onChange({ target: { value: 'Mine' } });
  m.draw();
  m.props.identity = { ...MIA, about: 'Arrived later' };
  m.draw();
  const tree = m.draw();
  assert.equal(bioBox(tree).props.value, 'Mine', 'a bio arriving mid-edit overwrote what the member was typing');
  pressSave(tree);
  assert.equal(m.saves[0].about, 'Mine');
});

test('SCREEN: the 160 cut in the box never leaves half an emoji', async () => {
  const m = await intoEdit({ ...MIA, about: '' });
  bioBox(m.tree).props.onChange({ target: { value: 'a'.repeat(159) + '\u{1F600}' } });   // 161 UTF-16 units
  const v = bioBox(m.draw()).props.value;
  assert.equal(v, 'a'.repeat(159), 'the cut left a lone high surrogate: ' + JSON.stringify(v.slice(-2)));
});

test('SCREEN: view mode shows the bio under the name', async () => {
  const withBio = await mountProfileSheet({ ...MIA, about: 'Welcome team, 9:30' });
  assert.ok(hasText(withBio.draw(), 'Welcome team, 9:30'), 'a member who has a bio cannot see it on their own profile');
});

// ── 2. the save path ────────────────────────────────────────────────────────────────────────────────────────
function liftSaveIdentity() {
  const body = fnBody(APP, 'const saveIdentity = (patch) => {', 'saveIdentity');
  const sent = [];
  const fn = new Function('window', 'String', body + '\nreturn saveIdentity;')(
    { Fellowship: { ready: Promise.resolve(), setProfile: async (meta) => { sent.push(meta); return { id: 'evt' }; } } }, String);
  return { fn, sent };
}

test('SAVE PATH: saveIdentity forwards the bio to setProfile', async () => {
  const { fn, sent } = liftSaveIdentity();
  await fn({ name: 'Mia', avatar: { kind: 'monogram' }, about: ' Sings alto ' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].about, 'Sings alto', 'the bio stops at saveIdentity and never reaches the engine');
  await fn({ about: '' });
  assert.ok('about' in sent[1] && sent[1].about === '', 'clearing the bio is not sent, so the old one can never be removed');
});

test('SAVE PATH: a save that does not mention the bio does not send one (absent = keep what is stored)', async () => {
  const { fn, sent } = liftSaveIdentity();
  await fn({ hidden: true });
  await fn({ name: 'Mia' });
  assert.ok(!('about' in sent[0]) && !('about' in sent[1]),
    'a directory toggle or a name-only save sent an `about`, which would overwrite the stored bio');
});

test('SAVE PATH: the identity App hands ProfileSheet carries the member\'s own stored bio', () => {
  const anchor = 'const identity = (() => {';
  const at = APP.indexOf(anchor);
  assert.notEqual(at, -1, 're-anchor: the identity object moved in app/app.jsx');
  assert.equal(APP.indexOf(anchor, at + 1), -1, 're-anchor: the identity anchor is not unique');
  const arrow = fnBody(APP, at + anchor.indexOf('() =>'), 'identity');
  const build = (myProfile) => new Function('window', 'return (' + arrow + ')();')({
    TrinityIdentity: { current: { npub: 'npub1x', color: '#123456' } }, TrinityData: {},
    Fellowship: { myProfile, myPubkey: 'ab'.repeat(32), displayFor: () => (fresh == null ? {} : { about: fresh }) },
  });
  let fresh = null;
  assert.equal(build({ name: 'Mia', about: 'Welcome team, 9:30' }).about, 'Welcome team, 9:30',
    'the member\'s stored bio never reaches the profile screen, so the edit box opens empty');
  assert.equal(build({ name: 'Mia' }).about, '', 'a member with no bio got something other than an empty one');
  // myProfile can lag our own kind-0 (it lands in profiles[pub], which displayFor reads): the fresh copy wins.
  fresh = 'From the relay';
  assert.equal(build({ name: 'Mia', about: '' }).about, 'From the relay',
    'the bio is seeded from a stale myProfile instead of the copy displayFor has, so Edit opens with it empty');
});

test('SAVE PATH: a bio cleared on another device stays cleared; with no kind-0 seen yet, myProfile is the fallback', () => {
  const anchor = 'const identity = (() => {';
  const at = APP.indexOf(anchor);
  assert.notEqual(at, -1, 're-anchor: the identity object moved in app/app.jsx');
  const arrow = fnBody(APP, at + anchor.indexOf('() =>'), 'identity');
  const build = (displayFor) => new Function('window', 'return (' + arrow + ')();')({
    TrinityIdentity: { current: { npub: 'npub1x', color: '#123456' } }, TrinityData: {},
    Fellowship: { myProfile: { name: 'Mia', about: 'old' }, myPubkey: 'ab'.repeat(32), displayFor },
  });
  assert.equal(build(() => ({ about: '', aboutKnown: true })).about, '',
    'our own kind-0 was seen with the bio cleared, yet the old one from myProfile is still shown (and would be re-published on the next edit)');
  assert.equal(build(() => ({ about: '', aboutKnown: false })).about, 'old',
    'no kind-0 seen yet: the stored bio must still seed the box');
  assert.equal(build(() => ({ about: 'New', aboutKnown: true })).about, 'New');
});

// ── 3. the engine (shipped bundle) ──────────────────────────────────────────────────────────────────────────
// Lift by BUNDLE name; each anchor must occur exactly once so a renamed duplicate cannot be picked up instead.
function once(src, anchor) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, 're-anchor: ' + anchor + ' is missing from vendor/fellowship.js');
  assert.equal(src.indexOf(anchor, at + 1), -1, 're-anchor: ' + anchor + ' occurs more than once in vendor/fellowship.js');
  return at;
}
function engine() {
  once(BUNDLE, 'function displayFor(');
  once(BUNDLE, 'function _flushProfiles(');
  const cap = BUNDLE.match(/var ABOUT_MAX = \d+;/g);
  assert.equal(cap && cap.length, 1, 're-anchor: the ABOUT_MAX constant is missing or duplicated in vendor/fellowship.js');
  const pieces = [cap[0], ...['function _profileAbout(', 'function _profilePin(', 'function displayFor(', 'function _flushProfiles('].map(a => fnBody(BUNDLE, a, a))];
  // The member hub's live kind-0 subscription: its onevent is the one that merges into the roster (hub.byPub).
  const hubAt = once(BUNDLE, 'const nm = meta.name || meta.display_name || had.name || "";');
  const hubStart = BUNDLE.lastIndexOf('onevent(e) {', hubAt);
  assert.ok(hubStart > 0 && hubAt - hubStart < 200, 're-anchor: the member hub profile onevent moved');
  const hubOnevent = fnBody(BUNDLE, hubStart, 'member hub profile onevent');
  const profiles = {};
  const hub = { byPub: new Map(), dirty: false };
  const env = {
    profiles, hub, pub: 'f'.repeat(64), UNNAMED: 'Member', AV_SYMBOLS: ['halo', 'dove'],
    hashStr: (s) => s.length, profile: (pk) => ({ pubkey: pk, handle: '', color: '#000' }),
    _avSuppressPhoto: (pk, av) => av, churchVoiceFor: () => null, _churchNames: new Map(), _churchRoster: new Map(),
    _profQueue: new Set(), _profTimer: null, pendingProfiles: new Set(), _k0Seen: new Set(),
    _recoverOwnProfile() {}, saveProfiles() {}, _memHubSaveSoon() {}, emit() {},
    groupReadRelays: () => ['wss://box'],
    window: { Fellowship: { churchPub: 'c'.repeat(64) }, dispatchEvent() {} },
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = (i || {}).detail; } },
  };
  let deliver = null;
  env.pool = { subscribeMany: (urls, filters, h) => { deliver = h; return { close() {} }; } };
  const names = Object.keys(env);
  const api = new Function(...names, pieces.join('\n') + '\nreturn { displayFor, _flushProfiles, hubOnevent: function (e) ' +
    hubOnevent.slice(hubOnevent.indexOf('{')) + ' };')(...names.map(n => env[n]));
  // _flushProfiles: queue the author, flush, and let the "relay" deliver the event.
  const viaFlush = (pk, content) => { env._profQueue.add(pk); api._flushProfiles(); deliver.onevent({ pubkey: pk, content: JSON.stringify(content) }); return api.displayFor(pk); };
  const viaHub = (pk, content) => { api.hubOnevent({ pubkey: pk, content: JSON.stringify(content) }); return api.displayFor(pk); };
  return { viaFlush, viaHub, profiles, displayFor: api.displayFor };
}
const PK1 = '1'.repeat(64), PK2 = '2'.repeat(64);

for (const route of ['viaFlush', 'viaHub']) {
  test(`ENGINE (${route}): a profile event's about comes back from displayFor`, () => {
    const E = engine();
    const d = E[route](PK1, { about: 'Sings alto, makes the tea', picture: '' });
    assert.equal(d.about, 'Sings alto, makes the tea', 'the bio another member published never reaches displayFor');
  });
  test(`ENGINE (${route}): a non-string about becomes '' and a 500-character one is cut to 160`, () => {
    const E = engine();
    for (const bad of [{ x: 1 }, ['a'], 42, true, null]) {
      const d = E[route](PK1, { about: bad });
      assert.equal(d.about, '', 'a non-string about (' + JSON.stringify(bad) + ') came through instead of ""');
      assert.equal(typeof E.profiles[PK1].about, 'string', 'a non-string about was stored in the profile cache');
    }
    const long = 'a'.repeat(500);
    const d = E[route](PK2, { about: long });
    assert.equal(d.about, 'a'.repeat(160), 'a 500-character bio was not cut to 160');
    assert.equal(E.profiles[PK2].about.length, 160, 'the profile cache kept the uncut bio');
  });
}

test('ENGINE: displayFor caps a bio already sitting in the cache from an older build, and never invents one', () => {
  const E = engine();
  E.profiles[PK1] = { name: '', about: 'b'.repeat(300) };
  assert.equal(E.displayFor(PK1).about.length, 160, 'an uncapped cached bio is handed to the screen uncut');
  assert.equal(E.displayFor(PK2).about, '', 'someone with no profile at all got a bio');
});

for (const route of ['viaFlush', 'viaHub']) {
  test(`ENGINE (${route}): displayFor says aboutKnown only for a record that came from a kind-0 event, even an empty bio`, () => {
    const E = engine();
    assert.equal(E.displayFor(PK1).aboutKnown, false, 'nobody heard from: the bio was reported as known');
    assert.equal(E[route](PK1, { about: '' }).aboutKnown, true, 'a kind-0 with a cleared bio was not reported as known');
    assert.equal(E.displayFor(PK1).about, '');
    E.profiles[PK2] = { name: 'Cached', about: 'from a local copy' };   // what init()/setProfile leave: no k0
    assert.equal(E.displayFor(PK2).aboutKnown, false, 'a local copy (no kind-0 behind it) was reported as known');
  });
}

test('ENGINE: the published wire copy carries the bio and never the name', () => {
  const at = once(BUNDLE, 'const wire = { about: p.about, picture: p.picture };');
  const set = BUNDLE.slice(at, BUNDLE.indexOf('const body = JSON.stringify(wire);', at));
  const p = { name: 'Mia Whitlock', about: 'Sings alto', picture: '' };
  const wire = new Function('p', set + '\nreturn wire;')(p);
  assert.equal(wire.about, 'Sings alto');
  assert.ok(!('name' in wire), 'the member\'s name is on the kind-0 wire again (Stage 2 sealed it)');
});

// ── own bio in the engine is capped too (audit nit) ────────────────────────────────────────────────────────
function aboutPieces() {
  const cap = BUNDLE.match(/var ABOUT_MAX = \d+;/g);
  assert.equal(cap && cap.length, 1);
  return cap[0] + '\n' + fnBody(BUNDLE, 'function _profileAbout(', '_profileAbout');
}

test('ENGINE: setProfile caps the bio it stores and sends, and keeps missing = keep, "" = clear', () => {
  const sp = once(BUNDLE, 'async setProfile(meta) {');
  const from = BUNDLE.indexOf('const prev = profiles[pub] || {};', sp);
  const to = BUNDLE.indexOf('};', BUNDLE.indexOf('const p = {', from)) + 2;
  assert.ok(from > sp && to > from && to - from < 600, 're-anchor: setProfile\'s profile record moved');
  const build = (meta, prev) => new Function('meta', 'profiles', 'pub', aboutPieces() + '\n' + BUNDLE.slice(from, to) + '\nreturn p;')(meta, { me: prev }, 'me');
  assert.equal(build({ about: 'x'.repeat(500) }, {}).about.length, 160, 'setProfile publishes an uncapped bio');
  assert.equal(build({ name: 'Mia' }, { about: 'Kept' }).about, 'Kept', 'a save without `about` dropped the stored bio');
  assert.equal(build({ about: '' }, { about: 'Kept' }).about, '', 'about: "" no longer clears the bio');
});

test('ENGINE: _recoverOwnProfile caps a recovered bio', () => {
  const body = fnBody(BUNDLE, 'function _recoverOwnProfile(', '_recoverOwnProfile');
  once(BUNDLE, 'function _recoverOwnProfile(');
  const win = { Fellowship: { myProfile: {} }, dispatchEvent() {} };
  const fn = new Function('pub', 'window', 'localStorage', 'PROFILE_KEY', 'CustomEvent',
    aboutPieces() + '\n' + body + '\nreturn _recoverOwnProfile;')('me', win, { setItem() {} }, 'k', class { constructor() {} });
  assert.equal(fn({ pubkey: 'me', content: JSON.stringify({ about: 'y'.repeat(400) }) }), true);
  assert.equal(win.Fellowship.myProfile.about.length, 160, 'a recovered own bio is stored uncapped');
});
