// "LOCK NOW" RESTARTS THE APP (owner, 2026-10-02; sim item 6 in SIM-VERIFY-2026-10-02).
//   Run: node --test scripts/lock-now-restarts-the-app.test.mjs
//
// THE DEFECT: with the app already open, "Lock now" forgot the key and dropped the cached church data, but the
// screens still held names, rotas and care needs in their own state — Today went on showing them behind the PIN
// gate. THE OWNER'S DECISION: "Lock now" restarts the app after locking, so nothing is left on screen.
//
// TWO HALVES, BOTH DRIVEN:
//   · THE CONTROL. CommunitySecuritySheet is compiled from app/identity-extras.jsx and DRAWN through the
//     miniature React (scripts/render-jsx-screen.mjs); the "Lock now" button is clicked and the test reads
//     whether the page was reloaded. Per CLAUDE.md rule 1 this is the point of use: deleting the reload from
//     the handler fails it. Per rule 3 nothing here matches text in app/*.jsx.
//   · THE ENGINE. lock() and lockSettled() are lifted out of vendor/identity.js (the bundle the app loads) and
//     run. A restart that beats lock()'s clearing of the REMEMBERED seed would boot straight back into the
//     account, so lockSettled() must stay pending until that clear has finished.
//
// USERS OF WHAT CHANGED: TrinityIdentity.lock() has ONE caller, doLock in CommunitySecuritySheet; the new
// TrinityIdentity.lockSettled() has the same one. The console's Steward.lock() is a different function.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact, texts as treeTexts, find as treeFind } from './render-jsx-screen.mjs';

const VENDOR = readFileSync(new URL('../vendor/identity.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// ── THE CONTROL ───────────────────────────────────────────────────────────────────────────────────────────
function sheet({ lockSettled }) {
  const { React, draw } = miniReact();
  const log = [];
  const timers = [];
  const ID = {
    hasPin: () => true, isLocked: () => false,
    lock: () => { log.push('lock'); return true; },
    lockSettled,
    rememberedUntil: async () => 0,
  };
  const win = { TrinityIdentity: ID,
    location: { reload: () => log.push('reload') },
    addEventListener() {}, removeEventListener() {} };
  const globals = {
    React, window: win,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    // A TIMER THE TEST CONTROLS: the cap on the wait is a setTimeout, and a real 2.5 s sleep would make the
    // "secure store never answers" case slow and flaky.
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, console,
    Icon: () => null, IconBtn: () => null,
    BottomSheet: ({ open, children }) => (open ? React.createElement('div', {}, children) : null),
  };
  const mod = loadScreen('app/identity-extras.jsx', ['CommunitySecuritySheet'], globals);
  const props = { open: true, onClose: () => log.push('close'), ctx: { toast: (m) => log.push('toast:' + m) } };
  draw(mod.CommunitySecuritySheet, props);
  const tree = draw(mod.CommunitySecuritySheet, props);
  const lockBtn = treeFind(tree, n => n.type === 'button' && /Lock now/.test(treeTexts(n).join(' ')))[0];
  assert.ok(lockBtn, 're-anchor: no "Lock now" button was drawn — the control under test is not on the screen. Drew: ' + treeTexts(tree).join(' | '));
  return { click: () => lockBtn.props.onClick(), log, timers };
}

test('"Lock now" locks, then RESTARTS THE APP — in that order', async () => {
  const s = sheet({ lockSettled: () => Promise.resolve() });
  await s.click();
  await flush();
  assert.ok(s.log.includes('lock'), 're-anchor: the button never reached TrinityIdentity.lock()');
  assert.ok(s.log.includes('reload'),
    'LOCK NOW LOCKED BUT DID NOT RESTART. An app that was already open keeps its church names and care needs in ' +
    'screen state, so Today goes on showing them behind the PIN gate. Log: ' + JSON.stringify(s.log));
  assert.ok(s.log.indexOf('lock') < s.log.indexOf('reload'), 'the restart happened BEFORE the lock: ' + JSON.stringify(s.log));
  assert.equal(s.log.filter(x => x === 'reload').length, 1, 'the page was reloaded more than once');
});

test('THE RESTART WAITS for the remembered seed to be cleared — a reload that beat it would reopen the account', async () => {
  const d = deferred();
  const s = sheet({ lockSettled: () => d.promise });
  const clicked = s.click();
  await flush();
  assert.deepEqual(s.log.filter(x => x === 'lock' || x === 'reload'), ['lock'],
    'the app restarted while the remembered seed was still being cleared — the next boot can come straight back ' +
    'into the account the member just locked. Log: ' + JSON.stringify(s.log));
  d.resolve();
  await clicked; await flush();
  assert.ok(s.log.includes('reload'), 'once the seed was cleared the app never restarted');
});

test('…BUT A SECURE STORE THAT NEVER ANSWERS CANNOT STRAND THE MEMBER on a screen full of church data', async () => {
  const s = sheet({ lockSettled: () => new Promise(() => {}) });
  s.click();
  await flush();
  assert.ok(!s.log.includes('reload'), 're-anchor: it restarted without waiting at all');
  const cap = s.timers.find(t => t.ms >= 1000);
  assert.ok(cap, 'there is no timeout on the wait, so a hung store leaves the church on screen for ever. Timers: ' + JSON.stringify(s.timers.map(t => t.ms)));
  cap.fn();
  await flush();
  assert.ok(s.log.includes('reload'), 'the wait was capped but nothing restarted the app afterwards');
});

test('the sheet closes at once, so it does not flip to its unlock view for the moment before the restart', async () => {
  const s = sheet({ lockSettled: () => Promise.resolve() });
  await s.click(); await flush();
  assert.ok(s.log.includes('close'), 'the sheet was left open over the restart');
});

// ── THE ENGINE ────────────────────────────────────────────────────────────────────────────────────────────
function engine({ clear }) {
  const events = [];
  const stubs = {
    hasEnc: () => true,
    sessionMnemonic: 'twelve words',
    rememberClear: clear,
    _lockWork: Promise.resolve(),
    applyLocked: () => events.push('applied'),
    window: { TrinityIdentity: { locked: false }, Fellowship: { clearCommunityCache: () => events.push('cache-cleared') } },
    Promise,
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the lifted lock() needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const lock = fnBody(VENDOR, '    lock() {', 'lock');
  const settled = fnBody(VENDOR, '    lockSettled() {', 'lockSettled');
  const api = new Function('scope', `with (scope) { return ({ ${lock}, ${settled} }); }`)(scope);
  return { api, stubs, events };
}

test('lock() forgets the key, and lockSettled() stays pending until the remembered seed is cleared', async () => {
  const d = deferred();
  const e = engine({ clear: () => d.promise });
  assert.equal(e.api.lock(), true);
  assert.equal(e.stubs.sessionMnemonic, null, 'lock() did not forget the in-memory seed');
  assert.deepEqual(e.events, ['cache-cleared', 'applied'], 're-anchor: lock() no longer clears the cache and applies the locked state');
  let done = false;
  e.api.lockSettled().then(() => { done = true; });
  await flush();
  assert.equal(done, false, 'lockSettled() resolved while the remembered-seed clear was still pending — the restart would beat it');
  d.resolve();
  await flush();
  assert.equal(done, true, 'lockSettled() never resolved after the clear finished');
});

test('lockSettled() never rejects — a failing secure store must not leave an unhandled rejection or a stuck restart', async () => {
  const e = engine({ clear: () => Promise.reject(new Error('keystore down')) });
  e.api.lock();
  await assert.doesNotReject(e.api.lockSettled());
});

test('lockSettled() is already settled when nothing was locked', async () => {
  const e = engine({ clear: () => new Promise(() => {}) });
  await assert.doesNotReject(e.api.lockSettled());
});
