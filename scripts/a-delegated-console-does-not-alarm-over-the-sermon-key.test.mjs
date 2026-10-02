// A DELEGATED STEWARD IS NOT TOLD THE CHURCH'S SERMONS WILL NOT PLAY.
//   Run: node --test scripts/a-delegated-console-does-not-alarm-over-the-sermon-key.test.mjs
//
// `trinityone/mediakey:<church>` is OWNER-ONLY at the relay — `if (d.startsWith(MEDIAKEY_D)) return
// leaderOf(d.slice(MEDIAKEY_D.length));`, scripts/gateway.mjs — and a delegated console signs everything with
// the STEWARD's own key through feChurch. So the two functions that maintain that envelope can never land it
// from a delegated console. `mediaEncryptor` already refuses on `actingChurch`; `ensureMediaKeyForMembers`
// and `rotateMediaKey` did not.
//
// That was harmless until a6d13e0. Before it, subscribeMediaKey looked up only `o.keys[pub]`, which on a
// delegated console is the entry sealed TO THE CHURCH — unopenable with the steward's key — so `_mediaKeyHex`
// stayed null and the `!_mediaKeyHex` guard stopped both functions dead. a6d13e0 taught subscribeMediaKey to
// read OUR OWN entry so a delegate can encrypt a sermon, and that switched both publishes on.
//
// MEASURED at a845108 by lifting both functions out of the shipped vendor/steward.js and running them with
// `actingChurch` set and a media key in hand (the rows below, with the guard removed):
//
//   ensureMediaKeyForMembers  1 publish  d=trinityone/mediakey:<church>  signed by the STEWARD  background:true
//                             → refused → 1 × steward-write-blocked, what: 'sermon key'
//   rotateMediaKey            1 publish  same d-tag, same signer,        background:false
//                             → refused → returns false → block()'s blockWarn
//
// PublishErrorBanner arms a dismiss timer for `steward-publish-error` and NONE for `steward-write-blocked`
// (test C below renders the real one and proves it), so that first banner STANDS on every tab until it is
// dismissed, telling a steward who did nothing that this church's encrypted sermons will not play for a
// member. It is not true: the church's own console maintains the envelope, and the delegate reads its own
// copy out of it — which is exactly what a6d13e0 added.
//
// FIVE INSTRUMENTS, and the first two exist so the rest cannot be vacuous:
//   A. the OWNER console, unchanged — if the guard swallowed the owner's publishes every row below would
//      still pass and the church would silently stop keying new members;
//   B. `mediaEncryptor`, which a delegate must keep — the whole point of a6d13e0 is that it can encrypt;
//   C. the SCREEN — the real PublishErrorBanner, compiled and rendered, told what the engine actually said;
//   D. the ENGINE — both functions lifted out of the shipped bundle and run;
//   E. the CALL SITE — the real DashMembers rendered and a real Block tapped, because the difference between
//      `null` and `false` out of rotateMediaKey is a second banner only that screen can show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';
import { fnBody, liftKeyRead } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
// THE SHIPPED ring fitter (2026-10-01): the media-key publishers fit their envelope to the relay's 1 MB cap
// through it, so a lifted publisher needs it in scope. Lifted, not re-typed.
const _fitKeyRing = new Function('return ' + fnBody(BUNDLE, 'function _fitKeyRing(full, recipCount, sealSample) {', '_fitKeyRing in the shipped bundle'))();
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const CHURCH = '3eb1f889'.padEnd(64, '0');
const STEWARD = 'b'.repeat(64);
const MEMBER = 'a'.repeat(64);
const NEWJOINER = 'c'.repeat(64);
const KEY = 'de'.repeat(32);
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const reads = (t) => texts(t).join(' ').replace(/\s+/g, ' ').trim();

// ── the engine, out of the SHIPPED bundle ─────────────────────────────────────────────────────────────────
// A mirror of these functions would pass its own sabotage, so nothing here is re-typed: both bodies are
// sliced out of vendor/steward.js and executed. The relay stub enforces the one rule that matters — the
// mediakey: envelope is admitted from the CHURCH key only — so a delegated console's copy is refused exactly
// as the real box refuses it.
function engine({ actingChurch, mediaKeyHex = KEY, mediaDocKeys = 'default', mediaChecked = true }) {
  const attempts = [];
  const blocked = [];
  const scope = {
    // setActiveIdentity's delegated branch: `pub` is the CHURCH being stewarded, `sk` is our OWN key.
    actingChurch,
    pub: CHURCH,
    sk: new Uint8Array(32).fill(7),
    _mediaKeyHex: mediaKeyHex,
    _mediaKeyRing: mediaKeyHex ? [mediaKeyHex] : [],
    _mediaKeyDocKeys: mediaDocKeys === 'default' ? { [CHURCH]: 'sealed-church', [MEMBER]: 'sealed-member' } : mediaDocKeys,
    _mediaKeyPushRefused: null,
    _mediaKeyChecked: mediaChecked,
    _localBlocked: new Set(),
    _isRelayAuthed: () => true, _fitKeyRing, console, _mediaKeyVer: 0,
    MEDIAKEY_D: 'trinityone/mediakey:',
    NET: 'trinityone',
    now: () => 1758800000,
    _hex: (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join(''),
    _sealEach: async (pl, targets) => Object.fromEntries(targets.map(t => [t, 'sealed:' + String(t).slice(0, 6)])),
    encrypt3: (pl) => pl,
    getConversationKey: () => new Uint8Array(32),
    _unhex: (h) => new Uint8Array(h.match(/../g).map(b => parseInt(b, 16))),
    // feChurch signs with the ACTIVE key: our own while delegated, the church's otherwise.
    feChurch: (t) => ({ ...t, pubkey: actingChurch ? STEWARD : CHURCH }),
    publish: async (evt, opts) => {
      const d = ((evt.tags || []).find(t => t[0] === 'd') || [])[1];
      attempts.push({ d, signer: evt.pubkey === CHURCH ? 'church' : 'steward', background: !!(opts && opts.background) });
      if (evt.pubkey === CHURCH) { if (opts && typeof opts === 'object') opts.refused = false; return true; }
      if (opts && typeof opts === 'object') { opts.refused = true; opts.reason = 'blocked: not a member or not permitted for this group'; }
      return false;
    },
    JSON, Set, Object, Array, String, Number, Boolean, Promise, Error, Math, Date, crypto, Uint8Array,
    window: { dispatchEvent: (e) => { blocked.push({ type: e.type, detail: e.detail }); return true; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      throw new ReferenceError('the lifted media-key functions need `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const bodies = [
    fnBody(BUNDLE, '    async mediaEncryptor(memberPubs) {', 'mediaEncryptor in the shipped bundle'),
    fnBody(BUNDLE, '    async ensureMediaKeyForMembers(memberPubs, stewardPubs) {', 'ensureMediaKeyForMembers in the shipped bundle'),
    fnBody(BUNDLE, '    async rotateMediaKey(memberPubs, stewardPubs) {', 'rotateMediaKey in the shipped bundle'),
  ].join(',\n');
  const api = new Function('scope', `with (scope) { ${liftKeyRead(BUNDLE)}\n const _api = { ${bodies} }; return _api; }`)(proxy);
  return { api, attempts, blocked, scope };
}

// ── A. THE OWNER CONSOLE, UNCHANGED ───────────────────────────────────────────────────────────────────────
// Deleting either function outright, or gating it on something an owner also matches, passes every delegated
// row below. These two are what stops that.

test('CONTROL — the OWNER’s console still keys a new member, and the envelope is signed by the church', async () => {
  const e = engine({ actingChurch: '' });
  const out = await e.api.ensureMediaKeyForMembers([MEMBER, NEWJOINER]);
  assert.deepEqual(e.attempts, [{ d: 'trinityone/mediakey:' + CHURCH, signer: 'church', background: true }],
    'THE OWNER CONSOLE STOPPED DISTRIBUTING THE MEDIA KEY. A member who joins after a sermon was uploaded ' +
    'then has no key for it and their app dead-ends on “needs the unlock key”: ' + JSON.stringify(e.attempts));
  assert.equal(out, true, 're-anchor: the owner’s publish no longer reports success');
  assert.deepEqual(e.blocked, [], 'the owner console raised a sermon-key alarm over a write that landed');
});

test('CONTROL — the OWNER’s console still rotates the key when a member is blocked', async () => {
  const e = engine({ actingChurch: '' });
  const out = await e.api.rotateMediaKey([MEMBER]);
  assert.deepEqual(e.attempts, [{ d: 'trinityone/mediakey:' + CHURCH, signer: 'church', background: false }],
    'THE OWNER CONSOLE STOPPED ROTATING. A blocked member keeps a working key to every sermon uploaded ' +
    'after they left: ' + JSON.stringify(e.attempts));
  assert.equal(out, true, 're-anchor: the rotation no longer reports success');
  assert.notEqual(e.scope._mediaKeyHex, KEY, 'the ring did not move, so nothing was actually rotated');
  assert.equal(e.scope._mediaKeyRing.length, 2, 'the superseded key was dropped — every older sermon just became unplayable');
});

// ── B. WHAT a6d13e0 BOUGHT, WHICH THIS MUST NOT TAKE BACK ─────────────────────────────────────────────────

test('a DELEGATED console can still encrypt a sermon with the church’s key, and publishes nothing to do it', async () => {
  // The guard belongs on the two DISTRIBUTORS, not on encryption. If it reached mediaEncryptor, a delegated
  // steward could no longer upload an encrypted sermon at all — which is the feature a6d13e0 exists to add.
  const e = engine({ actingChurch: CHURCH });
  const enc = await e.api.mediaEncryptor([MEMBER]);
  assert.equal(typeof enc, 'function', 'a delegated console can no longer encrypt an upload');
  const out = await enc(new Uint8Array([1, 2, 3, 4]));
  assert.equal(out.length, 12 + 4 + 16, 'the encryptor no longer returns iv‖ciphertext‖tag');
  assert.deepEqual(e.attempts, [],
    'mediaEncryptor published the envelope from a delegated console — the refusal it already carries is gone');
});

// ── C. THE SCREEN — why this one mattered more than a failed background write ──────────────────────────────

function banner() {
  const { React, draw } = miniReact();
  const listeners = {}, timers = [], warned = [];
  const w = {
    Steward: { actingChurch: CHURCH },
    addEventListener: (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); },
    removeEventListener: (k, fn) => { listeners[k] = (listeners[k] || []).filter(x => x !== fn); },
    dispatchEvent() {},
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['PublishErrorBanner'], {
    React, window: w,
    Icon: Stub('Icon'),
    noteRelayRejection: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    console: { warn: (...a) => warned.push(a.join(' ')), log() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, Promise, RegExp,
  });
  const api = { listeners, timers, warned };
  api.redraw = () => { api.tree = draw(mod.PublishErrorBanner, {}); return api.tree; };
  api.fire = (type, detail) => { (api.listeners[type] || []).forEach(fn => fn({ detail })); return api.redraw(); };
  api.redraw();
  return api;
}

test('THE SCREEN: the sermon-key alarm really is STICKY — it arms no timer and never clears itself', () => {
  // This is the measurement that makes the fix worth making rather than an untidiness. The delegated console
  // fired this on every roster re-emit that found somebody unkeyed.
  const b = banner();
  b.fire('steward-write-blocked', { what: 'sermon key',
    message: '1 member(s) could not be given the key to this church’s encrypted sermons, so those sermons ' +
             'will not play for them. Only the console that holds the church key can publish it. This ' +
             'console will not keep retrying.' });
  assert.match(reads(b.tree), /will not play for them/, 're-anchor: this event no longer reaches the banner at all');
  assert.deepEqual(b.timers, [],
    'the sermon-key banner now auto-dismisses — re-anchor this test, the fix below is aimed at a banner that STANDS');
  b.timers.forEach(t => t.fn());
  assert.match(reads(b.redraw()), /will not play for them/, 're-anchor: it cleared itself after all');
});

test('THE SCREEN: a delegated console’s whole roster round now paints nothing at all', async () => {
  // Fire at the REAL banner whatever the REAL engine said, rather than asserting on a count in isolation.
  const e = engine({ actingChurch: CHURCH });
  await e.api.ensureMediaKeyForMembers([MEMBER, NEWJOINER]);
  await e.api.rotateMediaKey([MEMBER]);
  const b = banner();
  e.blocked.forEach(ev => b.fire(ev.type, ev.detail));
  assert.equal(reads(b.tree), '',
    'THE STANDING SERMON-KEY ALARM IS BACK on a console that has done nothing wrong: ' + JSON.stringify(reads(b.tree)));
});

// ── D. THE ENGINE ─────────────────────────────────────────────────────────────────────────────────────────

test('a DELEGATED console does not publish the media-key envelope when a member joins', async () => {
  const e = engine({ actingChurch: CHURCH });
  const out = await e.api.ensureMediaKeyForMembers([MEMBER, NEWJOINER]);
  assert.deepEqual(e.attempts, [],
    'THE REFUSED WRITE IS BACK. `trinityone/mediakey:` is owner-only at the relay and this console signs ' +
    'with the steward’s key, so this is refused every time somebody joins: ' + JSON.stringify(e.attempts));
  assert.deepEqual(e.blocked, [], 'the sermon-key alarm fired: ' + JSON.stringify(e.blocked));
  assert.equal(out, false, 'the declining return changed — the two callers in app/stew-dashboard.jsx ignore it, ' +
    'but every other no-op in this function answers false and this one should read the same');
});

test('…and it declines to ROTATE with null, not false, because false is a second banner', async () => {
  // block() in app/stew-dashboard.jsx awaits this in `rotations` and reports every `ok === false` as "could
  // not change the sermon key … Try blocking them again — and if it keeps failing, your church may have
  // grown past what one key document can hold". Both halves of that advice are untrue for a delegate.
  const e = engine({ actingChurch: CHURCH });
  const out = await e.api.rotateMediaKey([MEMBER]);
  assert.deepEqual(e.attempts, [],
    'THE REFUSED ROTATION IS BACK, and this one publishes with background:false — the LOUD banner: ' +
    JSON.stringify(e.attempts));
  assert.equal(out, null,
    'a delegated rotation must DECLINE (null), the way ensureNameKeyForMembers already does. `false` is ' +
    'block()’s signal to raise the sermon-key warning, and `undefined` would mean somebody deleted the return');
  assert.equal(e.scope._mediaKeyHex, KEY, 'the local ring moved on a console whose envelope can never land — ' +
    'this device would then encrypt with a key no member has');
});

test('the a6d13e0 regression, stated as a measurement: without a key in hand neither function ever ran', async () => {
  // The pre-a6d13e0 state. subscribeMediaKey could not open a delegated console's entry, `_mediaKeyHex`
  // stayed null, and the `!_mediaKeyHex` guards were what kept both publishes off the wire. This row is here
  // so the fix is not mistaken for one that was always needed, and so a future reader can see what changed.
  const e = engine({ actingChurch: CHURCH, mediaKeyHex: null });
  await e.api.ensureMediaKeyForMembers([MEMBER, NEWJOINER]);
  await e.api.rotateMediaKey([MEMBER]);
  assert.deepEqual(e.attempts, [], 'even with no key at all this console published something');
  // …and the guard must be what stops it NOW, not the missing key: a delegate holding the church's key is
  // the ordinary post-a6d13e0 state, and that is the row two tests above.
  const held = engine({ actingChurch: CHURCH });
  assert.equal(held.scope._mediaKeyHex, KEY, 're-anchor: the delegated fixture no longer holds a key, so the ' +
    'rows above prove nothing about the state a6d13e0 created');
});

// ── E. THE CALL SITE — the real members page, a real Block ─────────────────────────────────────────────────
// The difference between `null` and `false` is invisible in the engine; it is a banner on THIS screen. So the
// screen is the real DashMembers, and what it calls is the real rotateMediaKey out of the shipped bundle —
// not a stub returning the answer the test is named after, which is how this branch has been caught twice.
// `rotateMedia` is only ever supplied for the owner CONTROL, where the failure being reported is a refused
// publish and the point is that the screen still reports it.

async function membersPage({ delegated, rotateMedia, nameResult = null, engineOpts = {} }) {
  const e = engine({ actingChurch: delegated ? CHURCH : '', ...engineOpts });
  const { React, draw } = miniReact();
  const NOW = Math.floor(Date.now() / 1000);
  const src = fnBody(DASH, 'function DashMembers()', 'DashMembers');
  const tmp = join(tmpdir(), 'mk-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashMembers };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const fired = [];
  const g = {
    React, CustomEvent, setTimeout, clearTimeout, Promise, Date, Math, JSON, Set, Object, String, Array, Boolean, Number,
    Panel: (p) => (p && p.children) || null,
    SkPill: (p) => (p && p.children) || null,
    SkBadge: (p) => (p && p.children) || null,
    // The real table out of app/stew-data.jsx — DashMembers indexes it directly, and a stub that returned
    // undefined would throw inside the row rather than reporting a missing name.
    SK_TINT: { clay: { bg: 'var(--clay-soft)', fg: 'var(--clay)' }, gold: { bg: 'var(--gold-tint)', fg: '#8a6717' },
               sage: { bg: 'var(--sage-soft)', fg: '#345c41' }, ink: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
    DismissibleNote: (p) => (p && p.children) || null,
    StewHelpLink: (p) => (p && p.label) || null,
    useStewNarrow: () => false,
    Icon: (p) => (p && p.children) || null,
    copyText: () => {},
    // DashMembers' siblings in the same classic script. A name it needs and this list does not have is a
    // ReferenceError here rather than a silent stub — that is the second caller list a change to this page has.
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
        actingChurch: delegated ? CHURCH : '',
        setBlocked: () => Promise.resolve(true),
        setMinors: () => Promise.resolve(true), setApproved: () => Promise.resolve(true),
        setGuardians: () => Promise.resolve(true), setAdmitted: () => Promise.resolve(true),
        setNoPhoto: () => Promise.resolve(true),
        // The two rotations block() awaits alongside the media key. Both succeed, so anything the screen
        // says about a key is about the SERMON key and nothing else.
        rotateCareKey: () => Promise.resolve(true),
        ensureNameKeyForMembers: () => Promise.resolve(nameResult),
        rotateMediaKey: (pubs) => (rotateMedia === undefined ? e.api.rotateMediaKey(pubs) : Promise.resolve(rotateMedia)),
      },
      useStewardGroups: () => [], useStewardStewards: () => [], useStewardChurch: () => ({ name: 'St Aidan', features: {} }),
      useStewardBlocked: () => [],
      useStewardSafeguard: () => ({ loaded: true, minorsKnown: true, clearedKnown: true, cleared: {}, minors: [], approved: [], nophoto: [] }),
      useStewardGuardians: () => ({ links: {}, closed: {} }), useStewardJoinPolicy: () => false, useStewardAdmitted: () => [],
      useStewardMembers: () => [{ pubkey: MEMBER, npub: 'npub1aa', name: 'Bram Whitlock', count: 2, lastTs: NOW - 3600, joined: NOW - 86400 }],
      addEventListener() {}, removeEventListener() {},
      dispatchEvent: (e) => { fired.push({ type: e.type, detail: e.detail }); return true; },
    },
  };
  const key = '__mk_' + Math.random().toString(36).slice(2);
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
  await new Promise(r => setTimeout(r, 0));   // block()'s Promise.all reporter
  tree = draw(mod.DashMembers, {});
  delete globalThis[key];
  return { said: reads(tree), fired };
}

test('THE CALL SITE: a delegated Block no longer warns that the sermon key could not be changed', async () => {
  const p = await membersPage({ delegated: true });
  assert.doesNotMatch(p.said, /could not change/,
    'THE SECOND BANNER IS BACK. It tells a delegated steward to try blocking again and to suspect their ' +
    'church has outgrown one key document; neither is true, and neither can ever come right: ' + p.said);
});

test('…and the delegate IS still told the sermon key is the owner’s to change', async () => {
  // CLAUDE.md rule 1 in both directions: quiet is not the goal, and this codebase's standing failure is a
  // refusal that reaches no screen at all.
  const p = await membersPage({ delegated: true });
  const note = p.fired.filter(f => f.type === 'steward-write-blocked' && f.detail && f.detail.what === 'block');
  assert.equal(note.length, 1, 'the delegated Block now says nothing about the keys it could not change');
  assert.match(note[0].detail.message, /encrypted sermons/,
    'the owner-only note lists encrypted groups and members’ names and not sermons, so the one thing this ' +
    'fix made silent is the one thing nothing tells them about');
});

test('CONTROL: an OWNER whose rotation really failed is still warned about the sermon key', async () => {
  // Without this row, `rotateMediaKey` could return null for everybody — or the reporter could have been
  // deleted — and the two rows above would be just as green.
  const p = await membersPage({ delegated: false, rotateMedia: false });
  assert.match(p.said, /could not change the sermon key/,
    'AN OWNER’S FAILED ROTATION IS NOW SILENT. The blocked member may still hold the key to every sermon ' +
    'uploaded after they left and nothing on screen says so: ' + p.said);
});

// NULL IS A FAILURE TOO (audit of 3bc8905). block() warned only on `false`, but a name-key rotation returns null when
// it did not happen — no trusted view, an envelope this console is not in, or a Block queued across a church switch
// — and the blocked member then still holds the key to every name in the congregation. On an OWNER's console null
// now warns; a delegate's (whose sermon-key rotation is null by design) does not — the rows above.
test('THE CALL SITE: an OWNER whose name-key rotation did not happen (null) is warned', async () => {
  const p = await membersPage({ delegated: false, rotateMedia: true, nameResult: null });
  assert.match(p.said, /could not change the name key/,
    'A NAME-KEY ROTATION THAT NEVER HAPPENED IS SILENT — the blocked member keeps the key to every name in the church and nothing on screen says so: ' + p.said);
});

test('CONTROL: an OWNER whose rotations all landed is told nothing is wrong', async () => {
  const p = await membersPage({ delegated: false, rotateMedia: true, nameResult: { id: 'published' } });
  assert.doesNotMatch(p.said, /could not change/, 'a Block whose rotations all landed raised the failure banner: ' + p.said);
});

// NOTHING TO ROTATE (audit of 5276297, MEDIUM): every owner's Block in a church that never uploaded an encrypted sermon
// said "could not change the sermon key … Try blocking them again" — rotateMediaKey returned false for "no key".
test('THE CALL SITE: an OWNER\'s Block in a church with NO sermon key says nothing about the sermon key', async () => {
  const p = await membersPage({ delegated: false, nameResult: { id: 'published' }, engineOpts: { mediaKeyHex: null, mediaDocKeys: null, mediaChecked: true } });
  assert.doesNotMatch(p.said, /could not change the sermon key/, 'THE BLOCK WARNS ABOUT A SERMON KEY THE CHURCH NEVER HAD: ' + p.said);
});
test('CONTROL: …but one whose sermon-key read has not settled (it may HAVE one) is still warned', async () => {
  const p = await membersPage({ delegated: false, nameResult: { id: 'published' }, engineOpts: { mediaKeyHex: null, mediaDocKeys: null, mediaChecked: false } });
  assert.match(p.said, /could not change the sermon key/, 'a sermon key the console has not looked for is treated as absent — a blocked member may still hold it: ' + p.said);
});
