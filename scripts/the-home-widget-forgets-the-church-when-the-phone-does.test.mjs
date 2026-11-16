// THE HOME-SCREEN WIDGET FORGETS THE CHURCH WHEN THE PHONE DOES — AND THE SETTINGS SWITCH IS REALLY ON THE SCREEN.
//   Run: node --test scripts/the-home-widget-forgets-the-church-when-the-phone-does.test.mjs
//
// AUDIT-phone-widget-c60c0f72-2026-11-16 F1, F3, F4 (TrinityOne-internal/reference/).
//
// F1. The widget's church settings (npub + relay addresses, polled hourly with the app closed) may only exist while
// "remember me" holds. Today wrote and cleared them, but only while Today was on screen — "Ask for my PIN again"
// on the security sheet left them for up to 30 days. The clear now lives in rememberClear() (src/identity.src.js),
// which every end of a remembered state reaches. POINT OF USE: the REAL security sheet (app/identity-extras.jsx)
// is drawn, its "Ask for my PIN again" button is pressed, and the identity behind it is the SHIPPED
// forgetDevice/rememberClear lifted out of vendor/identity.js.
//
// F3. The Settings switch is drawn INSIDE the real ProfileSheet (both sliced out of app/identity.jsx) — so deleting
// <HomeWidgetToggle /> from the sheet fails here.
//
// F4. The switch follows the native provider's real state, and a NEW ACCOUNT on the phone (a handover, a reseat:
// regenerate / importMnemonic) switches the widget off rather than carrying the last person's opt-in.
//
// Rule 3: nothing matches text in app/*.jsx. The vendor/identity.js checks read the BUNDLE, where dead code is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/identity.js'), 'utf8');
const IDJSX = readFileSync(join(ROOT, 'app/identity.jsx'), 'utf8');
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };

function liftOnce(decl) {
  const i = BUNDLE.indexOf(decl);
  assert.ok(i >= 0, decl + ' is not in vendor/identity.js — re-anchor this test');
  assert.equal(BUNDLE.indexOf(decl, i + 1), -1, decl + ' appears twice in the bundle — slice is ambiguous');
  return fnBody(BUNDLE, i, decl);
}
function plugin() {
  const calls = [];
  return { calls, W: {
    clearPrompt: () => { calls.push('clearPrompt'); return Promise.resolve(); },
    setEnabled: (a) => { calls.push('setEnabled:' + a.on); return Promise.resolve(); },
    status: () => Promise.resolve({ supported: true, enabled: true }),
  } };
}

// The SHIPPED identity pieces, over a fake phone with a remembered record and the widget plugin present.
function shippedIdentity(W) {
  const secure = new Map([['trinityone.nostr.remember', JSON.stringify({ m: 'seed words', until: Math.floor(Date.now() / 1000) + 20 * 86400 })]]);
  const local = new Map([['trinityone.widget', '1']]);
  const SS = { get: async k => (secure.has(k) ? secure.get(k) : null), set: async (k, v) => secure.set(k, v), remove: async k => secure.delete(k) };
  const events = [];
  const fns = [liftOnce('function _widgetPlugin('), liftOnce('function widgetForgetChurch('), liftOnce('function widgetOffForNewAccount('),
    liftOnce('async function rememberRead('), liftOnce('async function rememberClear(')].join('\n');
  const methods = [liftOnce('async forgetDevice() {'), liftOnce('async rememberedUntil() {')].join(',\n');
  const src = (fns + '\nconst api = {\n' + methods + '\n};')
    .replace(/await Promise\.resolve\(\)\.then\(\(\) => \(init_esm\(\), esm_exports\)\)/g, '({ SecureStorage: __SS })');
  assert.ok(!/esm_exports/.test(src), 'the plugin import shim no longer matches the bundle — re-anchor it');
  const scope = {
    REMEMBER_KEY: 'trinityone.nostr.remember', isNative: () => true, nowSec: () => Math.floor(Date.now() / 1000),
    console: { warn() {} }, __SS: SS,
    localStorage: { getItem: k => (local.has(k) ? local.get(k) : null), setItem: (k, v) => local.set(k, String(v)), removeItem: k => local.delete(k) },
    window: { Capacitor: { Plugins: { TrinityWidget: W } }, dispatchEvent: e => events.push(e.type) },
    CustomEvent: class { constructor(t) { this.type = t; } },
  };
  const out = new Function(...Object.keys(scope), src + '\nreturn { api, widgetOffForNewAccount };')(...Object.values(scope));
  return { ...out, secure, local, events };
}

test('F1 POINT OF USE: "Ask for my PIN again" on the security sheet clears the widget\'s church settings', async () => {
  const { calls, W } = plugin();
  const idn = shippedIdentity(W);
  const { React, draw } = miniReact();
  const ID = { hasPin: () => true, isLocked: () => false, rememberedUntil: () => idn.api.rememberedUntil(), forgetDevice: () => idn.api.forgetDevice() };
  const globals = {
    React, window: { TrinityIdentity: ID, addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout, clearTimeout, console, Icon: () => null, IconBtn: () => null,
    BottomSheet: ({ open, children }) => (open ? React.createElement('div', {}, children) : null),
  };
  const mod = loadScreen('app/identity-extras.jsx', ['CommunitySecuritySheet'], globals);
  const props = { open: true, onClose() {}, ctx: { toast() {} } };
  draw(mod.CommunitySecuritySheet, props);
  await settle();
  const btn = find(draw(mod.CommunitySecuritySheet, props), n => n.type === 'button' && /Ask for my PIN again/.test(texts(n).join(' ')));
  assert.equal(btn.length, 1, 're-anchor: the security sheet has no "Ask for my PIN again" button for a remembered phone');
  assert.equal(calls.includes('clearPrompt'), false, 're-anchor: the widget was cleared before anything was pressed');
  await btn[0].props.onClick();
  await settle();
  assert.equal(idn.secure.has('trinityone.nostr.remember'), false, 're-anchor: forgetDevice did not forget the phone');
  assert.ok(calls.includes('clearPrompt'),
    'the member said "ask for my PIN" and the home-screen widget KEPT the church\'s npub and relays (polled hourly with the app closed)');
});

test('F1: every path that ends a remembered state goes through rememberClear — and it clears the widget', () => {
  const body = liftOnce('async function rememberClear(');
  assert.match(body, /widgetForgetChurch\(\)/, 'rememberClear no longer clears the widget\'s church settings');
  // the shipped callers (the bundle, not app/*.jsx — rule 3 does not apply to dead-code-eliminated vendor code)
  for (const m of ['async setPin(', 'async forgetDevice() {', 'async regenerate() {', 'async importMnemonic(']) {
    assert.match(liftOnce(m), /rememberClear\(\)/, m + ' no longer reaches rememberClear');
  }
  assert.match(BUNDLE, /_lockWork = Promise\.resolve\(rememberClear\(\)\)/, 'lock() no longer reaches rememberClear');
});

test('F4: a NEW ACCOUNT on this phone (regenerate / importMnemonic — a handover) switches the widget OFF', async () => {
  const { calls, W } = plugin();
  const idn = shippedIdentity(W);
  idn.widgetOffForNewAccount();
  await settle();
  assert.equal(idn.local.has('trinityone.widget'), false, 'the previous person\'s opt-in is still stored');
  assert.ok(calls.includes('setEnabled:false'), 'the native widget was not switched off for the new account');
  assert.ok(idn.events.includes('trinity-widget-changed'), 'Today is not told');
  for (const m of ['async regenerate() {', 'async importMnemonic(']) {
    assert.match(liftOnce(m), /widgetOffForNewAccount\(\)/, m + ' carries the previous person\'s widget opt-in onto the new account');
  }
});

// ── the Settings switch, as it sits INSIDE the real ProfileSheet ───────────────────────────────────────────────
async function profileWithSwitch({ stored = null, native = null } = {}) {
  const src = fnBody(IDJSX, 'function ProfileSheet(', 'ProfileSheet') + '\n' + fnBody(IDJSX, 'function HomeWidgetToggle(', 'HomeWidgetToggle');
  const tmp = join(tmpdir(), 'widgetsw-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { ProfileSheet };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const store = new Map(stored == null ? [] : [['trinityone.widget', stored]]);
  const W = { status: () => Promise.resolve(native == null ? { supported: true } : { supported: true, enabled: native }), setEnabled: () => Promise.resolve(), requestPin: () => Promise.resolve({}) };
  const globals = {
    React, useId: React.useState, useIdE: React.useEffect,
    window: { TrinityData: { RELAYS: [] }, TrinityWallet: null, TrinityLN: null, Fellowship: {}, Capacitor: { Plugins: { TrinityWidget: W } },
      dispatchEvent() {} },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    CustomEvent: class { constructor(t) { this.type = t; } },
    AvatarPicker: Stub('AvatarPicker'), Overlay: function Overlay(p) { return p.children; },
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), UserAvatar: Stub('UserAvatar'),
    DirectoryToggle: Stub('DirectoryToggle'), BackupCard: Stub('BackupCard'),
    AppVersion: Stub('AppVersion'), FamilySheet: Stub('FamilySheet'), ChildrenAtChurchSheet: Stub('ChildrenAtChurchSheet'),
    VotdToggle: Stub('VotdToggle'),
    WALLET_ENABLED: false, navigator: { clipboard: null }, setTimeout, clearTimeout, console,
  };
  const key = '__widgetsw_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { ProfileSheet } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  const ctx = { church: { name: 'Grace', npub: 'npub1churchaaaaaaaaaaaaaaaaaa', features: {} }, safeguard: { isMinor: false }, toast() {}, openChurchSwitcher() {}, openHelp() {} };
  const props = { open: true, onClose() {}, onSave() {}, ctx, identity: { name: 'Mia Whitlock', avatar: null, npub: 'npub1miaaaaaaaaaaaaaaaaaaaaaa' } };
  return { draw: () => draw(ProfileSheet, props), store };
}
const widgetSwitches = (tree) => find(tree, n => n.type === 'button' && (n.props || {}).role === 'switch' && /^Home-screen widget/.test(String((n.props || {})['aria-label'] || '')));

test('F3: the Profile sheet carries exactly ONE home-screen widget switch on the APK', async () => {
  const s = await profileWithSwitch();
  assert.equal(widgetSwitches(s.draw()).length, 1,
    'the home-screen widget switch is not in the Profile sheet — the only way to turn the widget on is gone');
});

test('F4: the switch shows the NATIVE state — a lost stored flag over an enabled widget reads ON, not "Off"', async () => {
  const s = await profileWithSwitch({ stored: null, native: true });
  s.draw(); await settle();
  const sw = widgetSwitches(s.draw());
  assert.equal(sw.length, 1);
  assert.equal(sw[0].props['aria-checked'], true, 'the switch says Off while the widget is enabled on the home screen');
  assert.equal(s.store.get('trinityone.widget'), '1', 'the stored flag was not repaired');
});
