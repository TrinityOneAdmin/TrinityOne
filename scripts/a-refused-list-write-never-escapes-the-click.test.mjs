// A LIST WRITE THE CONSOLE REFUSES NEVER ESCAPES THE CLICK — AND ITS BANNER GOES WHEN THE SAME LIST IS SAVED.
//   Run: node --test scripts/a-refused-list-write-never-escapes-the-click.test.mjs
//
// Device round 2026-10-01 (Oppo). Approve on a join request, pressed while the console had not finished logging
// back in to its relay, left the click handler with an UNCAUGHT exception (_requireTrustedView → setAdmitted →
// admitMember) and the row said nothing. The guard throws SYNCHRONOUSLY, and `Promise.resolve(setAdmitted(…))`
// evaluates the call before any promise exists, so the .catch beside it never saw it. The same shape was on
// Unblock, the photo switch, the youth-clearance switch, Block, the steward roster's three controls and the
// join-approval switch. And the "Couldn't save the approved-members list" banner stayed on screen, collapsed,
// after the retry had let the person in.
//
// The REAL components, compiled out of app/stew-dashboard.jsx and rendered (rule 3: nothing here matches text in
// the jsx); every guarded list write throws exactly as the engine's guard does. And the engine side out of the
// SHIPPED bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const CHURCH = '3eb1f889'.padEnd(64, '0');
const MEMBER = 'a'.repeat(64), JOINER = 'c'.repeat(64), BLOCKEDM = 'd'.repeat(64), STEW = 'e'.repeat(64), KID = '9'.repeat(64);
const reads = (t) => texts(t).join(' ').replace(/\s+/g, ' ').trim();
// what a control SAYS: the text of its children, not its class names and styles
const said = (n) => { const out = []; const walk = (x) => { if (x == null || x === false) return; if (typeof x === 'string' || typeof x === 'number') { out.push(String(x)); return; } if (Array.isArray(x)) { x.forEach(walk); return; } (x.kids || []).forEach(walk); }; walk(n); return out.join(' ').replace(/\s+/g, ' ').trim(); };
// exactly what src/steward.src.js _requireTrustedView throws
const refused = (what) => () => { const e = new Error('Couldn’t save the ' + what + ' — nothing was changed. This console hasn’t finished connecting to your church, so it can’t see the current list.'); e.notConnected = true; throw e; };

async function compiled(name, globals) {
  const { React, draw } = miniReact();
  const src = fnBody(DASH, 'function ' + name + '(', name);
  const tmp = join(tmpdir(), 'rw-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { ' + name + ' };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const g = { React, ...globals };
  const key = '__rw_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const preamble = Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  delete globalThis[key];
  return { C: mod[name], draw };
}
const common = () => ({
  CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
  setTimeout: (fn) => 0, clearTimeout: () => {}, Promise, Date, Math, JSON, Set, Map, Object, String, Array, Boolean, Number, RegExp,
  Panel: (p) => (p && p.children) || null, SkPill: (p) => (p && p.children) || null, SkBadge: () => null,
  SK_TINT: { clay: { bg: 'x', fg: 'x' }, gold: { bg: 'x', fg: 'x' }, sage: { bg: 'x', fg: 'x' }, ink: { bg: 'x', fg: 'x' } },
  DismissibleNote: (p) => (p && p.children) || null, StewHelpLink: (p) => (p && p.label) || null,
  useStewNarrow: () => false, Icon: () => null, copyText: () => {},
  location: { search: '', hostname: 'x' },
  document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console,
});
// Press every enabled control on the page, round after round (confirms appear after their first press), and say
// which ones threw. A throw out of an onClick is what the browser reports as an uncaught exception.
async function pressEverything(draw, C, rounds = 4, props = {}) {
  const threw = [], pressed = new Set();
  let tree = draw(C, props);
  for (let r = 0; r < rounds; r++) {
    const btns = find(tree, n => n && n.props && typeof n.props.onClick === 'function' && !n.props.disabled);
    for (const b of btns) {
      const label = String(b.props['aria-label'] || b.props.title || said(b) || '').slice(0, 60);
      pressed.add(label);
      try { const ret = b.props.onClick({ stopPropagation() {}, preventDefault() {}, target: { value: '' } }); if (ret && typeof ret.then === 'function') await ret.then(() => {}, (e) => threw.push(label + ' (rejected: ' + (e && e.message || e) + ')')); }
      catch (e) { threw.push(label + ' (threw: ' + String(e && e.message || e).slice(0, 60) + ')'); }
      await new Promise(res => setImmediate(res));
      tree = draw(C, props);
    }
  }
  return { threw, pressed, said: reads(draw(C, props)) };
}

function membersGlobals({ steward }) {
  const NOW = Math.floor(Date.now() / 1000);
  return {
    ...common(),
    nameHandle: () => '', shortNpub: (np) => String(np || '').slice(0, 12), ago: () => '2 days ago',
    Avatar: () => null, StewMemberSheet: () => null, ReseatModal: () => null, GuardianLinkModal: () => null, BulkInviteModal: () => null,
    stewCapState: () => ({ allowed: true }),
    window: {
      Steward: steward,
      useStewardGroups: () => [], useStewardStewards: () => [], useStewardChurch: () => ({ name: 'St Aidan', features: { childPhotos: false } }),
      useStewardBlocked: () => [BLOCKEDM],
      useStewardSafeguard: () => ({ loaded: true, minorsKnown: true, clearedKnown: true, cleared: {}, minors: [KID], approved: [], nophoto: [] }),
      useStewardGuardians: () => ({ links: {}, closed: {} }), useStewardJoinPolicy: () => true, useStewardAdmitted: () => [MEMBER, BLOCKEDM, KID],
      stewardStreamLoaded: () => true, useStewardIdv: () => 0,
      useStewardMembers: () => [
        { pubkey: MEMBER, npub: 'npub1aa', name: 'Bram Whitlock', count: 2, lastTs: NOW - 3600, joined: NOW - 86400, hasPhoto: true },
        { pubkey: JOINER, npub: 'npub1cc', name: 'Cleo Ashby', count: 0, lastTs: NOW - 60, joined: NOW - 60 },
        { pubkey: BLOCKEDM, npub: 'npub1dd', name: 'Dov Marr', count: 1, lastTs: NOW - 7200, joined: NOW - 99999 },
        { pubkey: KID, npub: 'npub199', name: 'Kit Marr', count: 1, lastTs: NOW - 5000, joined: NOW - 88888 },
      ],
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    },
  };
}
const allRefused = () => ({
  actingChurch: '', churchPub: CHURCH, relayAuthed: () => false, refreshClearances: () => Promise.resolve(),
  setAdmitted: refused('approved-members list'), setBlocked: refused('blocked list'), setNoPhoto: refused('photo settings'),
  setMinors: refused('list of children'), setApproved: refused('cleared-adults list'), setGuardians: refused('parent links'),
  rotateCareKey: () => Promise.resolve(true), ensureNameKeyForMembers: () => Promise.resolve({ rotated: false }), rotateMediaKey: () => Promise.resolve(true),
});

test('THE CALL SITE: Approve while the console cannot save — the click throws nothing, and the row says why', async () => {
  const { C, draw } = await compiled('DashMembers', membersGlobals({ steward: allRefused() }));
  let tree = draw(C, {});
  const approve = find(tree, n => n && n.type === 'button' && /^Approve$/.test(said(n)) && n.props.onClick);
  assert.equal(approve.length, 1, 're-anchor: no single Approve button for the waiting member');
  let threw = null;
  try { await approve[0].props.onClick(); } catch (e) { threw = e; }
  assert.equal(threw, null, 'APPROVE THREW OUT OF THE CLICK — an uncaught exception on the phone, and nothing on the row (device round 2026-10-01): ' + (threw && threw.message));
  await new Promise(res => setImmediate(res));
  tree = draw(C, {});
  assert.match(reads(tree), /Couldn’t let Cleo Ashby in — this console hasn’t finished connecting to your church/,
    'the refused Approve said nothing on the row (or blamed the relay, which was never asked): ' + reads(tree).slice(0, 300));
});

test('EVERY control on the Members page, with every list write refused: no click throws', async () => {
  const { C, draw } = await compiled('DashMembers', membersGlobals({ steward: allRefused() }));
  const r = await pressEverything(draw, C);
  // the controls whose clicks called a guarded list write bare, each pressed (a sweep that missed them proves nothing)
  for (const want of [/^Approve$/, /^Confirm — bans them/, /^Confirm: let .* back in/, /photo/i, /^Clear for youth work/])
    assert.ok([...r.pressed].some(l => want.test(l)), 'CONTROL: never pressed ' + want + ' — ' + [...r.pressed].join(' | '));
  assert.deepEqual(r.threw, [], 'these controls threw out of their click with the list write refused');
});

test('turning join approval on while the approved list cannot be written: nothing throws, and approval is NOT switched on', async () => {
  let policy = 0;
  const steward = { ...allRefused(), setJoinPolicy: () => { policy++; return Promise.resolve(true); }, publishProfile: () => Promise.resolve(true), sealGroup: () => Promise.resolve(true) };
  const { C, draw } = await compiled('DashFeaturesPanel', {
    ...common(), SkConfirm: () => null, DashGivingPanel: () => null, DashMealsPanel: () => null,
    // the join-approval switch now asks whether this steward holds Members (sim 4); the owner console does, and that is not what this row is about
    stewCapState: () => ({ allowed: true, owner: true, why: '' }),
    window: { Steward: steward, useStewardJoinPolicy: () => false, useStewardAdmitted: () => [], useStewardMembers: () => [{ pubkey: MEMBER }],
      useStewardGroups: () => [], useStewardChurch: () => ({ name: 'St Aidan', features: {}, rules: {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true },
  });
  const tree = draw(C, { church: { name: 'St Aidan', features: {}, rules: {} } });
  const sw = find(tree, n => n && n.props && n.props['aria-label'] === 'Toggle approval to join' && n.props.onClick);
  assert.equal(sw.length, 1, 're-anchor: no join-approval switch');
  let threw = null;
  try { sw[0].props.onClick({ stopPropagation() {} }); } catch (e) { threw = e; }
  assert.equal(threw, null, 'the join-approval switch threw out of its click: ' + (threw && threw.message));
  assert.equal(policy, 0, 'APPROVAL WAS SWITCHED ON WITHOUT GRANDFATHERING — everyone already in the church would now be waiting at the door');
});

test('the steward roster with its write refused: no click throws', async () => {
  const steward = { ...allRefused(), setStewards: refused('steward roster'), pubkey: CHURCH, hasPinLock: () => false, verifyPin: () => Promise.resolve(true),
    stewardCaps: () => ({ [STEW]: ['members'] }), stewardCapNames: () => ['members', 'care'], stewardLabels: () => ({}), stewardName: () => '', stewardSince: () => ({}),
    stewardCodeToPub: () => STEW, stewardInvitePayload: () => 'x', qrSVG: () => '' };
  const { C, draw } = await compiled('DashStewardsPanel', {
    ...common(), StewQRScanner: () => null,
    window: { Steward: steward, Capacitor: null, usePendingStewards: () => [{ pubkey: 'f'.repeat(64), name: 'Fen' }], useStewardMembers: () => [], useStewardStewards: () => [STEW],
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true },
  });
  const r = await pressEverything(draw, C, 4, { church: { name: 'St Aidan' } });
  for (const want of [/^Approve$/, /^Confirm — revoke this steward/])   // add (approve a request) and remove, each pressed
    assert.ok([...r.pressed].some(l => want.test(l)), 'CONTROL: never pressed ' + want + ' — ' + [...r.pressed].join(' | '));
  assert.deepEqual(r.threw, [], 'these steward-roster controls threw out of their click with the roster write refused');
});

// ── the banner ──────────────────────────────────────────────────────────────────────────────────────────────
function banner() {
  const listeners = {};
  const win = { Steward: { actingChurch: '' }, stewModalOpen: () => false,
    addEventListener: (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); }, removeEventListener: () => {}, dispatchEvent: () => {} };
  const b = miniReact();
  const mod = loadScreen('app/stew-dashboard.jsx', ['PublishErrorBanner'], {
    React: b.React, window: win, Icon: () => null, useStewDialog: () => ({ current: null }), useStewModalOpen: () => {},
    noteRelayRejection: () => {}, setTimeout: () => 1, clearTimeout: () => {}, console,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, Promise, RegExp,
  });
  b.draw(mod.PublishErrorBanner, {});
  const fire = (ev, detail) => { for (const fn of (listeners[ev] || [])) fn({ detail }); return reads(b.draw(mod.PublishErrorBanner, {})); };
  return { fire };
}
test('THE BANNER: a refused list write’s message goes when THAT list is saved — not another list, not a newer message', () => {
  const B = banner();
  const msg = 'Couldn’t save the approved-members list — nothing was changed.';
  assert.match(B.fire('steward-write-blocked', { what: 'approved-members list', message: msg }), /approved-members list/, 'CONTROL: the refusal was not shown');
  assert.match(B.fire('steward-write-landed', { what: 'blocked list' }), /approved-members list/, 'a DIFFERENT list landing took the message down');
  assert.doesNotMatch(B.fire('steward-write-landed', { what: 'approved-members list' }), /approved-members list/,
    'THE BANNER STAYED after the approved-members list was saved — on the Oppo it sat there, collapsed, after the retry let the person in');
  // a newer message is not the refused write's, and the old write landing must not take it down
  B.fire('steward-write-blocked', { what: 'approved-members list', message: msg });
  const later = B.fire('steward-write-blocked', { what: 'parent links', message: 'Couldn’t save the parent links — nothing was changed.' });
  assert.match(later, /parent links/, 'CONTROL: the newer refusal was not shown');
  assert.match(B.fire('steward-write-landed', { what: 'approved-members list' }), /parent links/, 'an OLDER refusal landing took down a newer, unrelated message');
});

// ── the engine: every guarded write reports when it lands, by the name its refusal used ───────────────────
test('THE ENGINE: setAdmitted that lands says so by the refusal’s own name; one that does not, does not', async () => {
  const fired = [];
  const scope = {
    window: { dispatchEvent: (e) => { fired.push(e); return true; } }, CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
    sk: new Uint8Array(32).fill(3), pub: CHURCH, ADMITTED_D: 'trinityone/admitted:', NET: 'trinityone', now: () => 1700000000, feChurch: (e) => e,
    _isRelayAuthed: () => true, publish: null,
  };
  const lifted = fnBody(BUNDLE, 'function _requireTrustedView(what) {', '_requireTrustedView') + '\n' + fnBody(BUNDLE, 'function _landed(what, p) {', '_landed in the shipped bundle');
  const method = fnBody(BUNDLE, '  setAdmitted(pubkeys) {', 'setAdmitted');
  const make = () => new Function(...Object.keys(scope), lifted + '\nreturn ({ ' + method + ' });')(...Object.values(scope));
  scope.publish = (e) => Promise.resolve(e);
  await make().setAdmitted([MEMBER]);
  assert.deepEqual(fired.filter(e => e.type === 'steward-write-landed').map(e => e.detail.what), ['approved-members list'], 'a saved approved-members list said nothing, so its refusal banner can never come down');
  fired.length = 0;
  scope.publish = () => Promise.resolve(false);
  await make().setAdmitted([MEMBER]);
  assert.equal(fired.filter(e => e.type === 'steward-write-landed').length, 0, 'a write every relay rejected was reported as landed');
  fired.length = 0;
  scope._isRelayAuthed = () => false;
  assert.throws(() => make().setAdmitted([MEMBER]), (e) => e.notConnected === true, 'the refusal no longer marks itself, so the row cannot say which failure it was');
  assert.deepEqual(fired.map(e => [e.type, e.detail.what]), [['steward-write-blocked', 'approved-members list']], 'CONTROL: the refusal was not raised under the same name');
});
test('THE ENGINE: each of the eight guarded list writes reports its landing under the name its refusal uses', () => {
  // The shipped bundle (rule 3 permits it): in each setter, the label the guard raises a refusal under and the
  // label the landing is reported under are the same string — or that list's banner can never come down.
  const setters = ['setBlocked(pubkeys) {', 'setNoPhoto(pubkeys) {', 'setMinors(pubkeys) {', 'setApproved(pubkeys, opts) {', 'setGuardians(links, closed) {', 'setReseats(pairs) {', 'setAdmitted(pubkeys) {', 'setStewards(pubkeys, caps, names) {'];
  const bad = [];
  for (const sig of setters) {
    const body = fnBody(BUNDLE, sig, sig);
    const g = body.match(/_requireTrustedView\("([^"]+)"\)/), l = body.match(/_landed\("([^"]+)"/);
    if (!g || !l || g[1] !== l[1]) bad.push(`${sig.split('(')[0]}: refused as ${g && g[1]}, lands as ${l && l[1]}`);
  }
  assert.deepEqual(bad, [], 'a guarded list write whose landing is reported under another name (or not at all)');
});
