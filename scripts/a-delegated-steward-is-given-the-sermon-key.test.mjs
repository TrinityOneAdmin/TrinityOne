// A DELEGATED STEWARD IS GIVEN THE CHURCH'S SERMON KEY.
//   Run: node --test scripts/a-delegated-steward-is-given-the-sermon-key.test.mjs
//
// THE DEFECT. `ensureMediaKeyForMembers` sealed the church media key to [church, ...members] and nothing
// else. A delegated steward's console key is minted fresh by createKeyQuiet ("Help run a church",
// app/steward-root.jsx) and is deliberately NOT a member, so the envelope held no entry that key could open:
// subscribeMediaKey's `o.keys[_meKey]` lookup found nothing, `_mediaKeyHex` stayed null, and mediaEncryptor
// refused the upload with "…hasn't shared its media key with this account yet…". The delegate could publish
// a sermon in the clear and not an encrypted one.
//
// MEASURED at e58adfb, by lifting the shipped subscribeMediaKey out of vendor/steward.js and feeding it an
// envelope built the way ensureMediaKeyForMembers built one:
//
//   owner console (its key IS the church key)          KEY IN HAND
//   delegate, fresh key, not a member                  NULL          <- mediaEncryptor throws
//   delegate whose key happens to also be a member     KEY IN HAND
//
// THE FIX is the one `ensureCareKeyForMembers`/`rotateCareKey` already made: both media-key functions take a
// `stewardPubs` argument and put it in `want`, and all three call sites pass the roster. The OWNER's console
// is still the only one that may publish the envelope — `if (actingChurch) return false;` stays in both, the
// relay refuses a delegate's copy — so the delegate gets the key because the owner seals it to the roster.
//
// FOUR INSTRUMENTS, and none of them is allowed to be satisfied by a stub:
//   A. THE ENGINE, END TO END, with real nip44: the owner's REAL ensureMediaKeyForMembers out of the shipped
//      bundle produces the envelope, and the delegate's REAL subscribeMediaKey out of the same bundle opens
//      it. A stranger row keeps it from being vacuous, and the owner row keeps the fix from having broken
//      the console that actually publishes.
//   B. THE SCREEN — the real KeyDistributor compiled out of app/stew-dashboard.jsx and rendered. This is the
//      point of USE (CLAUDE.md rule 1): deleting the roster from the call leaves the engine perfect and the
//      delegate still locked out.
//   C. THE SCREEN'S SECOND CALL SITE — the mount re-check timers, which run off a `[]`-deps effect and so
//      must read the roster through a ref. The roster arrives asynchronously; at mount it is empty.
//   D. THE SCREEN'S THIRD CALL SITE — a real Block on the real DashMembers, because rotateMediaKey rewrites
//      the whole recipient list and would otherwise take the key away from every delegate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { miniReact, find } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);
const memberSk = generateSecretKey(), memberPub = getPublicKey(memberSk);
// "Help run a church" mints this. It is not a member and never was.
const delegSk = generateSecretKey(), delegPub = getPublicKey(delegSk);
const strangerSk = generateSecretKey(), strangerPub = getPublicKey(strangerSk);
const KEY = 'ab'.repeat(32);

// A `with (scope)` proxy. `locals` are names the lifted code DECLARES for itself, which the trap must not
// claim or the declaration is unreachable; anything else missing is a loud ReferenceError rather than a
// silent undefined, because a silently-stubbed global is how a test ends up asserting about something that
// is not the code.
function scoped(scope, locals = []) {
  const L = new Set(locals);
  return new Proxy(scope, {
    has: (t, k) => (L.has(String(k)) ? false : ((k in t) || !(String(k) in globalThis))),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (String(k) in globalThis) return globalThis[k];
      throw new ReferenceError('the lifted media-key code needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

// ── A. THE ENGINE, END TO END ─────────────────────────────────────────────────────────────────────────────
// Nothing here is re-typed: ensureMediaKeyForMembers, _sealEach and subscribeMediaKey are all sliced out of
// vendor/steward.js and executed, over real nip44.

// The OWNER's console, with both media-key publishers lifted out of the shipped bundle.
function ownerEngine() {
  const published = [];
  const scope = {
    actingChurch: '', pub: churchPub, sk: churchSk,
    _mediaKeyHex: KEY, _mediaKeyRing: [KEY], _mediaKeyDocKeys: null, _mediaKeyPushRefused: null,
    _mediaKeyChecked: true, _localBlocked: new Set(), _sealEachFailed: [],
    _isRelayAuthed: () => true,
    MEDIAKEY_D: 'trinityone/mediakey:', NET: 'trinityone',
    now: () => 1758800000,
    _hex: (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join(''),
    encrypt3: (pl, ck) => nip44.encrypt(pl, ck),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    feChurch: (t) => ({ ...t, pubkey: churchPub }),      // the owner signs with the church key
    publish: async (evt) => { published.push(evt); return true; },
  };
  const body = [
    fnBody(BUNDLE, '  async function _sealEach(payload, targets, sealTo, onProgress) {', '_sealEach in the shipped bundle'),
    'const _api = { ' + [
      fnBody(BUNDLE, '    async ensureMediaKeyForMembers(memberPubs, stewardPubs) {', 'ensureMediaKeyForMembers in the shipped bundle'),
      fnBody(BUNDLE, '    async rotateMediaKey(memberPubs, stewardPubs) {', 'rotateMediaKey in the shipped bundle'),
    ].join(',\n') + ' };',
    'return _api;',
  ].join('\n');
  const api = new Function('scope', `with (scope) { ${body} }`)(scoped(scope, ['_sealEach', '_api']));
  return { api, published, scope };
}

// One publish, checked to be the real envelope at the real address, and handed back parsed.
function oneEnvelope(published, scope) {
  assert.equal(published.length, 1, 're-anchor: expected exactly one media-key publish, got ' + published.length);
  assert.equal((published[0].tags.find(t => t[0] === 'd') || [])[1], 'trinityone/mediakey:' + churchPub,
    're-anchor: the envelope is no longer at d=trinityone/mediakey:<church>');
  // ⚠ THE RIG'S OWN CONTROL. _sealEach swallows a throw from the sealing lambda into _sealEachFailed, so a
  // wrong nip44 name in this file's scope produces an EMPTY envelope and every "gets nothing" row below goes
  // green for the wrong reason. That happened while writing this (nip44.getConversationKey vs
  // nip44.utils.getConversationKey) and was caught only by the owner CONTROL row.
  assert.deepEqual(scope._sealEachFailed, [],
    'the rig could not seal to ' + JSON.stringify(scope._sealEachFailed) + ' — fix this harness, the ' +
    'envelope it produces is not the one the console produces');
  return JSON.parse(published[0].content);
}

// The owner DISTRIBUTING the key (the roster changed, someone is missing an entry).
async function ownerPublishes(memberPubs, stewardPubs) {
  const e = ownerEngine();
  const ok = await e.api.ensureMediaKeyForMembers(memberPubs, stewardPubs);
  assert.equal(ok, true, 're-anchor: the owner console no longer publishes the media key at all');
  return oneEnvelope(e.published, e.scope);
}

// The owner ROTATING the key (someone was blocked). The envelope's recipient list is rewritten from scratch,
// which is why a missing roster here is a REMOVAL and not a missing addition.
async function ownerRotates(memberPubs, stewardPubs) {
  const e = ownerEngine();
  const ok = await e.api.rotateMediaKey(memberPubs, stewardPubs);
  assert.equal(ok, true, 're-anchor: the owner console no longer rotates the media key');
  const fresh = e.scope._mediaKeyHex;
  assert.notEqual(fresh, KEY, 're-anchor: the rotation did not mint a new key');
  return { env: oneEnvelope(e.published, e.scope), fresh };
}

// A console reading that envelope. `mySk` is the key this console holds; on a delegated console `pub` is the
// CHURCH and `_myOwnPub()` is our own key, which is setActiveIdentity's delegated shape.
function consoleReads(envelope, mySk) {
  const myPub = getPublicKey(mySk);
  let handlers = null;
  const scope = {
    _mediaKeyDocKeys: null, _mediaKeyPushRefused: 'a-previous-refusal', _mediaKeyRing: [], _mediaKeyHex: null,
    _mediaKeyChecked: false,
    _myOwnPub: () => myPub, pub: churchPub, sk: mySk,
    MEDIAKEY_D: 'trinityone/mediakey:',
    relays: () => ['wss://relay.example'],
    pool: { subscribeMany: (_r, _f, h) => { handlers = h; return { close() {} }; } },
    decrypt3: (ct, ck) => nip44.decrypt(ct, ck),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
  };
  const body = fnBody(BUNDLE, '    subscribeMediaKey() {', 'subscribeMediaKey in the shipped bundle');
  const api = new Function('scope', `with (scope) { return { ${body} }; }`)(scoped(scope));
  api.subscribeMediaKey();
  assert.ok(handlers, 're-anchor: subscribeMediaKey no longer subscribes');
  handlers.onevent({ content: JSON.stringify(envelope), pubkey: churchPub });
  return scope._mediaKeyHex;
}

test('THE ENGINE: a delegated steward on the roster ends up holding the church sermon key', async () => {
  const env = await ownerPublishes([memberPub], [delegPub]);
  assert.equal(consoleReads(env, delegSk), KEY,
    'A DELEGATED STEWARD STILL CANNOT ENCRYPT A SERMON. Their console key opens no entry in the church’s ' +
    'media-key envelope, so mediaEncryptor refuses the upload and the church loses encrypted sermons on ' +
    'every console but the owner’s.');
});

test('CONTROL: the OWNER’s console still opens its own entry', async () => {
  // Without this row, sealing to the roster INSTEAD of the church would pass the row above and silently
  // break the one console that maintains the envelope.
  const env = await ownerPublishes([memberPub], [delegPub]);
  assert.equal(consoleReads(env, churchSk), KEY,
    'THE OWNER CONSOLE CAN NO LONGER READ ITS OWN MEDIA-KEY ENVELOPE.');
});

test('CONTROL: someone who is neither a member nor a steward gets nothing', async () => {
  // Without this row, an envelope sealed to all comers — or a rig that hands every caller the key — would
  // look exactly like the fix working.
  const env = await ownerPublishes([memberPub], [delegPub]);
  assert.equal(consoleReads(env, strangerSk), null,
    'THE MEDIA KEY IS BEING GIVEN TO SOMEONE WHO IS NOT IN THIS CHURCH.');
});

test('CONTROL: with an EMPTY roster the delegate gets nothing — the roster is what carries them', async () => {
  // This is the pre-fix state, reproduced through the post-fix engine: the argument is what does the work,
  // not some incidental change in the same commit.
  const env = await ownerPublishes([memberPub], []);
  assert.equal(consoleReads(env, delegSk), null,
    're-anchor: the delegate is now keyed by something other than the steward roster, so every roster ' +
    'assertion in this file is measuring the wrong thing');
});

test('THE ENGINE: a ROTATION keeps the delegated steward keyed', async () => {
  const { env, fresh } = await ownerRotates([memberPub], [delegPub]);
  assert.equal(consoleReads(env, delegSk), fresh,
    'BLOCKING ONE MEMBER LOCKS EVERY DELEGATED STEWARD OUT OF ENCRYPTED SERMONS. A rotation rewrites the ' +
    'whole recipient list, so a steward left out of it loses a key they already had.');
});

test('CONTROL: the OWNER still reads its own entry after a rotation, and a stranger does not', async () => {
  const { env, fresh } = await ownerRotates([memberPub], [delegPub]);
  assert.equal(consoleReads(env, churchSk), fresh, 'the owner console lost its own entry in the rotation');
  assert.equal(consoleReads(env, strangerSk), null, 'the rotation is keying someone outside the church');
});

test('BACKWARDS COMPATIBLE: the extra recipients do not disturb a member’s own entry', async () => {
  // Every reader of this document looks up ONE entry by its own pubkey and ignores the rest — `o.keys[pub]`
  // in fellowship's mediaDecryptor, `o.keys[_meKey] || o.keys[pub]` in subscribeMediaKey. So adding
  // recipients is additive. Read the member's entry the way the member app reads it.
  const before = await ownerPublishes([memberPub], []);
  const after = await ownerPublishes([memberPub], [delegPub]);
  const open = (env) => JSON.parse(nip44.decrypt(env.keys[memberPub], nip44.utils.getConversationKey(memberSk, churchPub)));
  assert.deepEqual(open(before), [KEY], 're-anchor: a member no longer reads a key ring out of their entry');
  assert.deepEqual(open(after), [KEY],
    'ADDING THE STEWARD ROSTER CHANGED WHAT A MEMBER READS. Every member of every church upgrading to this ' +
    'build would lose access to the sermons they can play today.');
  assert.deepEqual(Object.keys(after.keys).sort(), [churchPub, memberPub, delegPub].sort(),
    'the envelope’s recipients are not [church, members, stewards]: ' + Object.keys(after.keys).join(','));
});

// ── B + C. THE SCREEN ─────────────────────────────────────────────────────────────────────────────────────
// The real KeyDistributor, compiled out of app/stew-dashboard.jsx and rendered. CLAUDE.md rule 3: no
// assertion here reads the text of that file — the component is run.

let _kdMod = null;
async function keyDistributorModule() {
  if (_kdMod) return _kdMod;
  const src = fnBody(DASH, 'function KeyDistributor()', 'KeyDistributor');
  const tmp = join(tmpdir(), 'kd-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { KeyDistributor };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  _kdMod = js;
  return js;
}

// Render KeyDistributor and record every call it makes to ensureMediaKeyForMembers. `rosters` is drawn once
// per entry, so a test can let the steward roster arrive AFTER the first draw — which is what really happens.
async function renderKeyDistributor(rosters, members) {
  const js = await keyDistributorModule();
  const { React, draw } = miniReact();
  const media = [];
  const timers = [];
  let roster = rosters[0];
  const g = {
    React, Set, Math, Date, Promise, JSON, Object, String, Array, Boolean, Number,
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = (i || {}).detail; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    window: {
      useStewardChurch: () => ({ name: 'St Aidan', features: {} }),
      useStewardGroups: () => [],
      useStewardMembers: () => members,
      useStewardStewards: () => roster,
      useStewardBlocked: () => [],
      useStewardConn: () => 0,
      Steward: {
        subscribeMediaKey: () => () => {}, subscribeCareKey: () => () => {},
        subscribeNameKey: () => () => {}, subscribeWebsiteShare: () => () => {},
        setCareRoster: () => {},
        ensureMediaKeyForMembers: (...a) => { media.push(a); return Promise.resolve(true); },
        ensureCareKeyForMembers: () => Promise.resolve(true),
        ensureNameKeyForMembers: () => Promise.resolve(null),
        ensureGroupKeys: () => Promise.resolve(true),
        publishGroupKey: () => Promise.resolve(true),
      },
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    },
  };
  const key = '__kd_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const preamble = Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  for (const r of rosters) { roster = r; draw(mod.KeyDistributor, {}); }
  delete globalThis[key];
  return { media, timers, fireTimers: () => timers.forEach(t => t.fn()) };
}

test('THE SCREEN: the key-distributor effect hands ensureMediaKeyForMembers the steward roster', async () => {
  const r = await renderKeyDistributor([[delegPub]], [{ pubkey: memberPub }]);
  assert.ok(r.media.length, 'the console no longer distributes the media key at all');
  const [pubs, stewards] = r.media[0];
  assert.deepEqual(pubs, [memberPub], 're-anchor: the member list is no longer the first argument');
  assert.deepEqual(stewards, [delegPub],
    'THE SCREEN IS NOT PASSING THE STEWARD ROSTER. The engine can seal to whoever it is told about, and it ' +
    'is told about members only — so a delegated steward is never in the envelope and can never encrypt a ' +
    'sermon, with every engine test green. Got: ' + JSON.stringify(r.media[0]));
});

test('THE SCREEN, END TO END: what the screen passes really does key the delegate', async () => {
  // The two halves joined, so that neither can be right on its own. Whatever the SCREEN handed the engine is
  // handed to the REAL engine, and the REAL delegated console then reads the envelope that comes out.
  const r = await renderKeyDistributor([[delegPub]], [{ pubkey: memberPub }]);
  const env = await ownerPublishes(...r.media[0]);
  assert.equal(consoleReads(env, delegSk), KEY,
    'THE DELEGATE IS NOT KEYED BY WHAT THE CONSOLE ACTUALLY SENDS. Engine and screen may each be right on ' +
    'their own; this is the only row that says they meet.');
});

test('THE MOUNT RE-CHECK TIMERS read the roster as it is WHEN THEY FIRE, not at mount', async () => {
  // The roster loads asynchronously and is EMPTY at mount — which is precisely the console state where the
  // media key has not arrived yet and these timers exist to catch up. A closure over the mount-time value
  // sends [] and re-keys the church without its stewards.
  const r = await renderKeyDistributor([[], [delegPub]], [{ pubkey: memberPub }]);
  const before = r.media.length;
  r.fireTimers();
  const fired = r.media.slice(before);
  assert.ok(fired.length, 're-anchor: the mount re-check timers no longer call ensureMediaKeyForMembers');
  for (const [pubs, stewards] of fired) {
    assert.deepEqual(pubs, [memberPub], 're-anchor: the re-check no longer passes the member list');
    assert.deepEqual(stewards, [delegPub],
      'THE RE-CHECK TIMERS SEND AN EMPTY STEWARD ROSTER. They fire 3.5s and 9s after mount, which is after ' +
      'the roster has loaded and after the distributor effect has already run — so on the cold console they ' +
      'were written for, they are the call that lands, and it drops every steward. Got: ' + JSON.stringify(stewards));
  }
});

// ── D. THE THIRD CALL SITE — a real Block on the real members page ────────────────────────────────────────
// rotateMediaKey rewrites the whole recipient list, so a roster left out here does not merely fail to add a
// delegate: it takes the sermon key away from every delegate the church has, the next time anyone is blocked.

async function blockOnMembersPage() {
  const { React, draw } = miniReact();
  const NOW = Math.floor(Date.now() / 1000);
  const src = fnBody(DASH, 'function DashMembers()', 'DashMembers');
  const tmp = join(tmpdir(), 'dm-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashMembers };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const rot = [];
  const g = {
    React, CustomEvent, setTimeout, clearTimeout, Promise, Date, Math, JSON, Set, Object, String, Array, Boolean, Number,
    Panel: (p) => (p && p.children) || null,
    SkPill: (p) => (p && p.children) || null,
    SkBadge: (p) => (p && p.children) || null,
    SK_TINT: { clay: { bg: '', fg: '' }, gold: { bg: '', fg: '' }, sage: { bg: '', fg: '' }, ink: { bg: '', fg: '' } },
    DismissibleNote: (p) => (p && p.children) || null,
    StewHelpLink: (p) => (p && p.label) || null,
    useStewNarrow: () => false,
    Icon: (p) => (p && p.children) || null,
    copyText: () => {},
    nameHandle: (m) => (m && m.nip05 ? String(m.nip05).split('@')[0] : ''),
    shortNpub: (np) => String(np || '').slice(0, 12),
    ago: () => '2 days ago',
    Avatar: (p) => (p && p.children) || null,
    StewMemberSheet: () => null,
    ReseatModal: () => null,
    GuardianLinkModal: () => null,
    BulkInviteModal: () => null,
    stewCapState: () => ({ allowed: true }),
    location: { search: '', hostname: 'x' },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    window: {
      Steward: {
        actingChurch: '',
        setBlocked: () => Promise.resolve(true), setMinors: () => Promise.resolve(true),
        setApproved: () => Promise.resolve(true), setGuardians: () => Promise.resolve(true),
        setAdmitted: () => Promise.resolve(true), setNoPhoto: () => Promise.resolve(true),
        rotateCareKey: () => Promise.resolve(true),
        ensureNameKeyForMembers: () => Promise.resolve(null),
        rotateMediaKey: (...a) => { rot.push(a); return Promise.resolve(true); },
      },
      useStewardGroups: () => [], useStewardStewards: () => [delegPub],
      useStewardChurch: () => ({ name: 'St Aidan', features: {} }),
      useStewardBlocked: () => [],
      useStewardSafeguard: () => ({ loaded: true, minorsKnown: true, clearedKnown: true, cleared: {}, minors: [], approved: [], nophoto: [] }),
      useStewardGuardians: () => ({ links: {}, closed: {} }), useStewardJoinPolicy: () => false, useStewardAdmitted: () => [],
      useStewardMembers: () => [
        { pubkey: memberPub, npub: 'npub1aa', name: 'Bram Whitlock', count: 2, lastTs: NOW - 3600, joined: NOW - 86400 },
        { pubkey: strangerPub, npub: 'npub1bb', name: 'Ada Nwosu', count: 1, lastTs: NOW - 60, joined: NOW - 8000 },
      ],
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    },
  };
  const key = '__dm_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const preamble = Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  let tree = draw(mod.DashMembers, {});
  const tap = (re) => {
    const b = find(tree, n => n.type === 'button' && re.test(String((n.props || {}).title || '')) && n.props.onClick);
    assert.ok(b.length, 're-anchor: no button on the members page matching ' + re);
    b[0].props.onClick();
    tree = draw(mod.DashMembers, {});
  };
  tap(/Remove \/ block this member/);
  tap(/Confirm — bans them/);
  await new Promise(r => setTimeout(r, 0));
  delete globalThis[key];
  return rot;
}

test('THE BLOCK SCREEN: rotateMediaKey is given the steward roster as well as the remaining members', async () => {
  const rot = await blockOnMembersPage();
  assert.equal(rot.length, 1, 're-anchor: blocking a member no longer rotates the sermon key exactly once');
  const [remaining, stewards] = rot[0];
  assert.ok(Array.isArray(remaining) && remaining.length,
    're-anchor: the remaining-member list is no longer rotateMediaKey’s first argument: ' + JSON.stringify(remaining));
  assert.deepEqual(stewards, [delegPub],
    'BLOCKING ONE MEMBER TAKES THE SERMON KEY AWAY FROM EVERY DELEGATED STEWARD. A rotation rewrites the ' +
    'whole recipient list, so a roster left out here is not a missing addition — it is a removal, and the ' +
    'delegate’s console stops being able to encrypt a sermon from that moment. Got: ' + JSON.stringify(rot[0]));
});
