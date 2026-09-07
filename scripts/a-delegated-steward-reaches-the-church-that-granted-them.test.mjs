// A DELEGATED STEWARD MUST REACH THE CHURCH THAT GRANTED THEM.
// Run: node --test scripts/a-delegated-steward-reaches-the-church-that-granted-them.test.mjs
//
// Measured 2026-09-06 (round 3, D1) on 00c30cf: the owner granted a steward from the console on the Suite
// box; the steward's console on the same box never showed the church. Zero frames on the wire. Two causes,
// one function each:
//
//   Half A — subscribeStewardedChurches read over relays(), the PUBLISH set. relaysRaw() starts from
//   ownRelay(), which names the community pool the moment `_boxHostsUs` is false — and for a delegated
//   steward it always is, because THEIR key is not a church anywhere, so /config honestly said "no". The
//   box holding the church was not a candidate at all. And relays() is admit(), the cache-only filter, so
//   on a cold cache the answer was [] and the subscription opened over nothing.
//
//   Half B — setActiveIdentity rebinds `pub` to the church but never reloaded the box-hosts answer for it,
//   so even after discovery the acting console kept the steward's own "no" and ownRelay() still named the
//   pool.
//
// WHAT IS NOT WIDENED (CLAUDE.md rule 10, reference/RELAY-ADMISSION.md). Every address the discovery read
// dials has been through `_gate.refresh` — proved at that address that it holds a relay identity key. The
// tests below hand the lifted function a gate whose `refresh` is the only thing that can turn a candidate
// into a dialled address, and assert that an unproved candidate is NEVER dialled (the control at the end).
//
// HOW IT ASSERTS. subscribeStewardedChurches, setActiveIdentity, ownRelay, relaysRaw, _loadBoxHosts and
// _boxHostsKey are lifted out of the SHIPPED bundle (vendor/steward.js) into one scope, the way
// an-accepted-registration-tells-the-console-its-box-holds-it.test.mjs lifts ownRelay. The assertion is on
// the URL list handed to pool.subscribeMany — which is what "zero frames" was about — never on text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CANON = 'wss://app.trinityone.church/relay';
const ORIGIN = 'http://127.0.0.1:8000';
const BOX = 'ws://127.0.0.1:8000/relay';
const ME = 'ee'.repeat(32);        // the steward's own key — a church nowhere
const CHURCH = 'cc'.repeat(32);    // the church whose roster names ME
const STEWARDS_D = 'trinityone/stewards:';

function proxyOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

// A tiny window: listeners by type, dispatch synchronously — enough for 'steward-relay-returned'.
function fakeWindow() {
  const ls = new Map();
  return {
    addEventListener(t, f) { if (!ls.has(t)) ls.set(t, new Set()); ls.get(t).add(f); },
    removeEventListener(t, f) { const s = ls.get(t); if (s) s.delete(f); },
    dispatchEvent(e) { const s = ls.get(e.type); if (s) [...s].forEach(f => f(e)); return true; },
    listeners(t) { const s = ls.get(t); return s ? s.size : 0; },
  };
}

// One console's worth of world. `proven` is the set of addresses the gate will admit once asked; `delay`
// is how long a proof takes. `cached` is the initial _boxHostsUs cell (false = the poisoned state).
function harness({ cached = false, origin = ORIGIN, proven = [BOX, CANON], delay = 0, warm = false } = {}) {
  const store = new Map();
  const subs = [];             // every pool.subscribeMany call: { urls, filters, handlers, closed }
  const refreshes = [];
  const boxRefreshes = [];
  const admitted = new Set(warm ? proven : []);   // the gate's cache
  const win = fakeWindow();
  const stewardedChurches = new Map();
  const stubs = {
    churchSk: new Uint8Array(32).fill(7), churchPub: ME, pub: ME, sk: null, actingChurch: '',
    stewardedChurches,
    netKeys: () => [],
    npubEncode: (p) => 'npub_' + p,
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null),
    privateKeyFromSeedWords: () => { throw new Error('not a network key'); }, getPublicKey: () => '',
    NET: 'trinityone', STEWARDS_D, ACTIVE_ID_KEY: 'active',
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
    lsSet: (k, v) => store.set(k, v),
    lsGet: (k) => (store.has(k) ? store.get(k) : null),
    // the relay list, real: ownRelay/relaysRaw/_loadBoxHosts/_boxHostsKey are lifted below and read these
    CANONICAL_RELAYS: [CANON], CANONICAL_RELAY: CANON,
    extraRelays: () => [],
    location: { protocol: 'http:', host: '127.0.0.1:8000', hostname: '127.0.0.1' },
    _ownOrigin: () => origin,
    _boxHostsUs: cached,
    _refreshBoxHostsUs: () => { boxRefreshes.push(stubs.pub); return Promise.resolve(); },
    // THE GATE, stubbed at its contract: admit() is cache-only and synchronous; refresh() proves, then admits.
    _gate: {
      admit: (list, cp) => list.filter(u => admitted.has(u)),
      refresh: (list, cp) => {
        refreshes.push({ list: [...list], cp });
        return new Promise(res => setTimeout(() => {
          list.forEach(u => { if (proven.includes(u)) admitted.add(u); });
          res(list.filter(u => admitted.has(u)));
        }, delay));
      },
      _admit: (u) => admitted.add(u),
    },
    pool: {
      subscribeMany(urls, filters, handlers) {
        const rec = { urls: [...urls], filters, handlers, closed: false, close() { rec.closed = true; } };
        subs.push(rec);
        return rec;
      },
    },
    // per-church state setActiveIdentity resets — cells, nothing more
    lastProfile: {}, _profileLoaded: false, _clearanceSent: new Map(),
    _careRoster: new Set(), _careRosterKnown: false, _careRosterSeen: false,
    _stewardCaps: {}, _stewardNames: {}, _stewardNamesCt: '', _stewardSince: {},
    _nameKeyRing: [], _nameKeyDocKeys: null, _nameKeyChecked: false, _localBlocked: new Set(),
    _applyNoPhotoList: () => {}, CAP_KEYS: {}, _capState: {}, _checkinMigrated: '',
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    window: Object.assign(win, { Steward: {} }),
  };
  const scope = proxyOf(stubs);
  const lift = (anchor, name) => new Function('scope', `with (scope) { return (${fnBody(VENDOR, anchor, name)}); }`)(scope);
  stubs.ownRelay = lift('function ownRelay() {', 'ownRelay');
  stubs.relaysRaw = lift('function relaysRaw() {', 'relaysRaw');
  stubs._boxHostsKey = lift('function _boxHostsKey() {', '_boxHostsKey');
  stubs._loadBoxHosts = lift('function _loadBoxHosts() {', '_loadBoxHosts');
  const method = (anchor, name) => new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, anchor, name)} }).${name}; }`)(scope);
  const subscribe = method('subscribeStewardedChurches(cb) {', 'subscribeStewardedChurches');
  const switchTo = method('setActiveIdentity(targetPub) {', 'setActiveIdentity');
  stubs.window.Steward.setActiveIdentity = (p) => switchTo.call(stubs.window.Steward, p);
  stubs.window.Steward.subscribeStewardedChurches = (cb) => subscribe.call(stubs.window.Steward, cb);
  return {
    stubs, store, subs, refreshes, boxRefreshes, win, stewardedChurches, admitted,
    subscribe: (cb) => subscribe.call(stubs.window.Steward, cb),
    switchTo: (p) => switchTo.call(stubs.window.Steward, p),
    // the owner's roster for CHURCH, naming ME, arriving on the discovery subscription
    grant: (sub) => sub.handlers.onevent({
      tags: [['d', STEWARDS_D + CHURCH], ['t', 'trinityone']],
      content: JSON.stringify({ pubkeys: [ME] }),
    }),
    discovery: () => subs.filter(s => s.filters.some(f => f.kinds && f.kinds.includes(30078))),
  };
}
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

// ── Half A ─────────────────────────────────────────────────────────────────────────────────────────────

test('HALF A: with the steward\'s own "no" cached, the discovery read still dials the box that served the console', async () => {
  const h = harness({ cached: false });
  assert.equal(h.stubs.ownRelay(), CANON, 'staging: the poisoned cell points ownRelay() at the pool');
  assert.deepEqual(h.stubs.relaysRaw(), [CANON], 'staging: the box is not in relaysRaw() at all');
  const lists = [];
  h.subscribe(l => lists.push(l));
  await tick(5);
  const d = h.discovery();
  assert.equal(d.length, 1, 'expected exactly one stewards-scan subscription, got ' + d.length);
  assert.ok(d[0].urls.includes(BOX),
    'the discovery read never dials the box that served this console — it went over ' + JSON.stringify(d[0].urls) +
    '. The church this box holds cannot be found from here; measured 2026-09-06 as zero frames.');
  assert.ok(d[0].urls.includes(CANON), 'the shared pool dropped out of the read');
  assert.deepEqual(new Set(d[0].urls), new Set([BOX, CANON]), 'the read dialled something neither the origin nor relaysRaw() named');
  // and the roster arriving over that read makes the church appear
  h.grant(d[0]);
  assert.ok(h.stewardedChurches.has(CHURCH), 'the owner\'s roster arrived and the church was not recorded');
  assert.deepEqual(lists[lists.length - 1], [CHURCH], 'the screen was not told');
});

test('HALF A: on a cold cache the read waits for the proof — it is never opened over an empty list', async () => {
  const h = harness({ cached: false, delay: 60, warm: false });
  h.subscribe(() => {});
  assert.equal(h.refreshes.length, 1, 'the candidate list was not put through _gate.refresh');
  assert.equal(h.refreshes[0].cp, ME, 'the proof was asked for the wrong church');
  assert.deepEqual(h.refreshes[0].list, [BOX, CANON], 'the candidates are not origin-then-relaysRaw(), de-duplicated');
  assert.equal(h.discovery().length, 0,
    'a subscription was opened before the proof landed — over ' + JSON.stringify(h.discovery().map(s => s.urls)) +
    '. admit() on a cold cache answers [], and a read over [] is the measured zero frames.');
  await tick(80);
  const d = h.discovery();
  assert.equal(d.length, 1, 'the proof landed and no subscription was opened');
  assert.ok(d[0].urls.length > 0 && d[0].urls.includes(BOX), 'opened over ' + JSON.stringify(d[0].urls));
});

test('HALF A: a relay proved AFTER the read opened re-opens it — the hook only re-subscribes on conn', async () => {
  // Nothing proves at first (the box is slow to answer /relay-identity); the pool is dialled alone.
  const h = harness({ cached: false, proven: [CANON] });
  h.subscribe(() => {});
  await tick(5);
  assert.deepEqual(h.discovery().map(s => s.urls), [[CANON]], 'staging: the pool alone was dialled');
  // Now the gate's background pass proves the box and fires its onChange event.
  h.stubs._gate._admit(BOX);
  h.win.dispatchEvent({ type: 'steward-relay-returned', detail: { url: '' } });
  const d = h.discovery();
  assert.equal(d.length, 2, 'the box entered the admitted set and the read was not re-opened to include it');
  assert.ok(d[0].closed, 'the old read was left open beside the new one');
  assert.deepEqual(new Set(d[1].urls), new Set([BOX, CANON]), 're-opened over ' + JSON.stringify(d[1].urls));
  // …and the same event with nothing new does NOT churn the subscription
  h.win.dispatchEvent({ type: 'steward-relay-returned', detail: { url: '' } });
  assert.equal(h.discovery().length, 2, 'the read was re-opened though the admitted set had not changed');
});

test('HALF A: the closer works before the proof lands, after it, and takes its listener with it', async () => {
  const early = harness({ delay: 30 });
  const closeEarly = early.subscribe(() => {});
  assert.equal(early.win.listeners('steward-relay-returned'), 1, 'no returned-relay listener was registered');
  closeEarly();
  assert.equal(early.win.listeners('steward-relay-returned'), 0, 'the closer left its listener behind');
  await tick(50);
  assert.equal(early.subs.length, 0, 'a subscription was opened after the closer ran');

  const late = harness();
  late.stewardedChurches.set(CHURCH, { name: 'Church' });   // a cached entry → a name subscription too
  const closeLate = late.subscribe(() => {});
  await tick(5);
  assert.ok(late.subs.length >= 2, 'staging: discovery + name subscriptions opened, got ' + late.subs.length);
  closeLate();
  assert.ok(late.subs.every(s => s.closed), 'the closer left a subscription open: ' + JSON.stringify(late.subs.map(s => s.closed)));
});

test('CONTROL (rule 10): a candidate the gate does not prove is never dialled, origin included', async () => {
  const h = harness({ cached: false, proven: [CANON] });   // the box answers /relay-identity with nothing
  h.subscribe(() => {});
  await tick(5);
  const d = h.discovery();
  assert.equal(d.length, 1);
  assert.ok(!d[0].urls.includes(BOX), 'an address that never proved it holds a relay identity key was dialled: ' + JSON.stringify(d[0].urls));
  assert.deepEqual(d[0].urls, [CANON]);
});

test('CONTROL: inside a Capacitor APK the candidate list is exactly relaysRaw()', async () => {
  const h = harness({ cached: null, origin: '' });
  h.subscribe(() => {});
  await tick(5);
  assert.deepEqual(h.refreshes[0].list, h.stubs.relaysRaw(), 'a phone was handed a candidate its raw list did not name');
});

// ── Half B ─────────────────────────────────────────────────────────────────────────────────────────────

test('HALF B: switching to a stewarded church reloads whether this box holds THAT church', async () => {
  const h = harness({ cached: false });
  h.store.set('trinityone.steward.boxhosts.' + CHURCH, '1');   // the box has said yes for the church…
  h.stewardedChurches.set(CHURCH, { name: 'St Aidan' });
  assert.equal(h.stubs.ownRelay(), CANON, 'staging: …but the steward\'s own "no" is what is loaded');
  assert.equal(h.switchTo(CHURCH), true, 'staging: the switch was refused');
  assert.equal(h.stubs.pub, CHURCH, 'staging: pub was not rebound');
  assert.equal(h.stubs._boxHostsUs, true,
    'the switch carried the previous key\'s "no" across; the box-hosts cell was not reloaded for the church');
  assert.equal(h.stubs.ownRelay(), BOX, 'ownRelay() still names ' + h.stubs.ownRelay() + ' after the switch — every write goes to the pool');
  assert.deepEqual(h.boxRefreshes, [CHURCH], 'the box was not re-asked about the church we just switched to');
  const last = h.refreshes[h.refreshes.length - 1];
  assert.deepEqual(last, { list: [BOX, CANON], cp: CHURCH }, 'the relay list was not re-proved for the church, with the box back in front');
});

test('HALF B CONTROL: switching back to our own church reloads OUR answer, not the church\'s', async () => {
  const h = harness({ cached: true });
  h.store.set('trinityone.steward.boxhosts.' + ME, '0');
  h.store.set('trinityone.steward.boxhosts.' + CHURCH, '1');
  h.stewardedChurches.set(CHURCH, { name: 'St Aidan' });
  h.switchTo(CHURCH);
  assert.equal(h.stubs.ownRelay(), BOX);
  h.switchTo(ME);
  assert.equal(h.stubs.pub, ME);
  assert.equal(h.stubs._boxHostsUs, false, 'our own key\'s cached "no" did not come back — the church\'s "yes" leaked across the switch');
  assert.equal(h.stubs.ownRelay(), CANON);
});

// ── Point of use (CLAUDE.md rule 1) ────────────────────────────────────────────────────────────────────
//
// The SHIPPED hook (app/steward-root.jsx) and the SHIPPED switcher (app/stew-dashboard.jsx), compiled and
// rendered through the repo's miniReact, over the real engine lifted above. The box is the ONLY relay that
// proves, so the church can reach the screen through the origin or not at all: delete the hook's call, the
// engine's origin candidate, or the row's onClick and this goes red. Nothing matches text in app/*.jsx.
import { writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniReact, texts, find } from './render-jsx-screen.mjs';

const REPO = new URL('../', import.meta.url).pathname;
const ROOT_JSX = readFileSync(join(REPO, 'app/steward-root.jsx'), 'utf8');
const DASH_JSX = readFileSync(join(REPO, 'app/stew-dashboard.jsx'), 'utf8');

async function loadSlices(pieces, exportNames, globals) {
  const src = pieces.map(([file, anchor, what]) => fnBody(file, anchor, what)).join('\n');
  const tmp = join(tmpdir(), 'dsr-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${exportNames.join(', ')} };\n`);
    js = execFileSync(join(REPO, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__dsr_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

// The hook and the switcher, wired to one harness whose engine is the shipped one.
async function screen(h) {
  const { React, draw } = miniReact();
  const picked = [];
  const win = h.stubs.window;
  win.Steward.identities = new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, 'identities() {', 'identities')} }).identities; }`)(proxyOf(h.stubs));
  const realSwitch = win.Steward.setActiveIdentity;
  win.Steward.setActiveIdentity = (p) => { picked.push(p); return realSwitch(p); };
  win.Steward.isViewingNetwork = () => false;
  win.Steward.isDelegated = () => !!h.stubs.actingChurch;
  Object.defineProperty(win.Steward, 'activePub', { get: () => h.stubs.pub });
  win.useStewardIdv = () => 0;
  const hookMod = await loadSlices([[ROOT_JSX, 'function useStewardStewardedChurches() {', 'useStewardStewardedChurches']], ['useStewardStewardedChurches'], {
    useSt: React.useState, useStE: React.useEffect, useStewardConn: () => 0, window: win, CustomEvent: h.stubs.CustomEvent,
  });
  win.useStewardStewardedChurches = hookMod.useStewardStewardedChurches;
  const dash = await loadSlices([[DASH_JSX, 'function IdentitySwitcher({', 'IdentitySwitcher']], ['IdentitySwitcher'], {
    React, window: win, SkBadge: () => null, Icon: () => null, churchHandle: () => '',
  });
  const props = { church: { name: 'My empty church', npub: 'npub_' + ME }, churchName: 'My empty church', initials: 'ME', onEditName: () => {} };
  let tree = draw(dash.IdentitySwitcher, props);
  const redraw = () => { tree = draw(dash.IdentitySwitcher, props); return tree; };
  const buttons = (re) => find(tree, n => n.type === 'button' && re.test(texts(n).join(' ')));
  return { picked, redraw, buttons, words: () => texts(tree).join(' ') };
}

test('POINT OF USE: the granted church reaches the switcher through the box that served the console', async () => {
  const h = harness({ cached: false, proven: [BOX] });   // the pool proves nothing: the origin is the only road
  const s = await screen(h);
  assert.equal(s.buttons(/You steward this church/).length, 0, 'staging: no stewarded row before discovery');
  await tick(5);
  const d = h.discovery();
  assert.equal(d.length, 1, 'the screen mounted and the hook opened no discovery read — is the hook still calling subscribeStewardedChurches?');
  assert.deepEqual(d[0].urls, [BOX], 'dialled ' + JSON.stringify(d[0].urls));
  h.grant(d[0]);
  s.redraw();
  assert.match(s.words(), /Switch between your church, networks, and churches you steward/,
    'the church arrived and the switcher did not turn into a switcher');
  s.buttons(/Switch between your church/)[0].props.onClick();
  s.redraw();
  const row = s.buttons(/You steward this church/);
  assert.equal(row.length, 1, 'the stewarded church has no row in the open switcher');
  row[0].props.onClick();
  assert.deepEqual(s.picked, [CHURCH], 'the row did not switch the console to the church');
  assert.equal(h.stubs.pub, CHURCH, 'the switch did not rebind pub');
});

test('POINT OF USE: after the switch, the acting console\'s own relay is the box', async () => {
  const h = harness({ cached: false, proven: [BOX] });
  h.store.set('trinityone.steward.boxhosts.' + CHURCH, '1');
  const s = await screen(h);
  await tick(5);
  h.grant(h.discovery()[0]);
  s.redraw();
  s.buttons(/Switch between your church/)[0].props.onClick();
  s.redraw();
  s.buttons(/You steward this church/)[0].props.onClick();
  assert.equal(h.stubs.ownRelay(), BOX, 'acting as the church, ownRelay() names ' + h.stubs.ownRelay() + ' — the steward\'s own "no" survived the switch');
  s.redraw();
  assert.match(s.words(), /STEWARD/, 'the badge does not say the console is acting as a steward');
});
