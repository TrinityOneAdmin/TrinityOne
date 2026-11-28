// THE "WHILE THE APP IS CLOSED" PICKER IS HONEST PER PLATFORM, AND "PROMPT ALERTS" NEVER ARMS THE LOCK-READABLE KEY.
// Run: node --test scripts/the-notification-tier-picker-offers-three-and-push-never-arms-the-key.test.mjs
//
// Owner decisions (2026-11-25, reference/SCOPE-notifications.md §8/§9/§15):
//  - Platform-honest tiers: iOS offers "Prompt alerts" (APNs push) + "Off"; Android offers "On-device only"
//    (today's polling) + "Off". iOS does NOT list On-device (its BGAppRefresh native isn't wired — deferred
//    follow-up), and Android does NOT list Prompt alerts (push is out of scope there). Never a one-size list.
//  - Prompt alerts is PUSH-ONLY: it must NEVER write the lock-readable "Stay open 30 days" key (dpBgKeyWrite ->
//    DirectPushBridge.writeBgKey) — that key is the safeguarding cost generic push exists to remove.
//
// POINT OF USE (rule 1): the REAL NotifSettingsScreen is drawn and its tier buttons are clicked. Delete a tier
// and its button vanishes (the find fails); route Prompt alerts through dpBgKeyWrite and "push never arms the key"
// fails; drop apnsRegister() and the register assert fails; list the wrong tiers for a platform and the per-platform
// presence/absence asserts fail.
// Users of the changed code (rule 2): NotifSettingsScreen (app/screens-extras.jsx), opened from Notifications. The
// tier is read by bg-entry.js via the DERIVED trinityone.directpush.optin key and by the apnsToken listener. Native
// bridges: ApnsBridge (push, scripts/ios-fixup.sh) and DirectPushBridge (on-device, present on feat/ios-bgrefresh).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, button } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function harness(platform = 'ios', seed, opts = {}) {
  const grant = opts.grant !== false;   // does the OS permission prompt get granted?
  let permState = opts.permission || 'granted';
  const store = new Map(seed ? Object.entries(seed) : []);
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const spies = { ensurePerm: 0, register: 0, writeBgKey: 0, deleteBgKey: 0, deletePushToken: 0, publishPushToken: [] };
  const win = {
    addEventListener() {}, removeEventListener() {},
    TrinityNotif: { isNative: () => true, permission: () => permState, get: () => ({ enabled: true, dm: true, announce: true, serving: true, reminders: true }), set: async (p) => p, ensurePerm: async () => { spies.ensurePerm++; permState = grant ? 'granted' : 'denied'; return grant; } },
    TrinityIdentity: { hasPin: () => false, isLocked: () => false, canRemember: () => false, rememberedUntil: async () => 0 },
    Fellowship: { deletePushToken: async () => { spies.deletePushToken++; return { ok: true }; }, publishPushToken: async (t, e) => { spies.publishPushToken.push([t, e]); return { ok: true }; } },
    Capacitor: { getPlatform: () => platform, Plugins: {
      ApnsBridge: { register: async () => { spies.register++; }, addListener: (name, cb) => { win._apnsCb = cb; return { remove() {} }; } },
      DirectPushBridge: { writeBgKey: async () => { spies.writeBgKey++; }, deleteBgKey: async () => { spies.deleteBgKey++; } },
      TrinityWidget: { clearMessageCount: async () => {} },
    } },
  };
  const { React, draw } = miniReact();
  const mod = loadScreen('app/screens-extras.jsx', ['NotifSettingsScreen', 'dpBootNotifications'], {
    React, Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), safeCssColor: (c) => c, UserAvatar: Stub('UserAvatar'), Sheet: Stub('Sheet'), NotifToggleRow: Stub('NotifToggleRow'),
    Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
    window: win, localStorage, setTimeout, clearTimeout, lsGet: (k, d) => d, lsSet() {}, useTrinityAudio: () => ({}), fetch: async () => ({}),
    navigator: { userAgent: '' }, document: { addEventListener() {}, removeEventListener() {} },
  });
  const tree = draw(mod.NotifSettingsScreen, { open: true, onClose() {}, ctx: { toast() {} } });
  return { tree, spies, store, win, boot: mod.dpBootNotifications };
}

const selectedLabel = (tree) => {
  const on = find(tree, (n) => n.type === 'button' && n.props && n.props['aria-pressed'] === true);
  assert.equal(on.length, 1, 'exactly one tier is selected');
  for (const label of ['Prompt alerts', 'On-device only', 'Off']) if (button(tree, label)[0] === on[0]) return label;
  return null;
};

test('iOS lists Prompt alerts + Off, and NOT On-device (its native is unwired)', () => {
  const { tree } = harness('ios');
  assert.equal(button(tree, 'Prompt alerts').length, 1, 'iOS must offer Prompt alerts');
  assert.equal(button(tree, 'Off').length, 1, 'iOS must offer Off');
  assert.equal(button(tree, 'On-device only').length, 0, 'iOS must NOT offer the unwired On-device tier');
});

test('Android lists On-device only + Off, and NOT Prompt alerts (push out of scope)', () => {
  const { tree } = harness('android');
  assert.equal(button(tree, 'On-device only').length, 1, 'Android must keep its On-device polling tier');
  assert.equal(button(tree, 'Off').length, 1, 'Android must offer Off');
  assert.equal(button(tree, 'Prompt alerts').length, 0, 'Android must NOT offer push (out of scope)');
});

test('iOS: choosing Prompt alerts registers for APNs and NEVER arms the lock-readable key', async () => {
  const { tree, spies, store, win } = harness('ios', { 'trinityone.notif.tier': 'off' });
  await button(tree, 'Prompt alerts')[0].props.onClick();
  assert.equal(spies.register, 1, 'Prompt alerts must register for remote notifications');
  assert.equal(spies.writeBgKey, 0, 'PUSH MUST NOT arm the lock-readable "Stay open 30 days" key');
  assert.equal(store.get('trinityone.notif.tier'), 'push');
  assert.equal(store.get('trinityone.directpush.optin'), '0', 'push does not opt into the on-device reader');
  assert.equal(typeof win._apnsCb, 'function', 'a token listener was wired');
  await win._apnsCb({ token: 'AABB1122', env: 'production' });
  assert.deepEqual(spies.publishPushToken, [['AABB1122', 'production']], 'an arriving token publishes the signed pushtoken doc');
});

test('iOS: turning Off deregisters the push token', async () => {
  const { tree, spies } = harness('ios', { 'trinityone.notif.tier': 'off' });
  await button(tree, 'Prompt alerts')[0].props.onClick();
  await button(tree, 'Off')[0].props.onClick();
  assert.equal(spies.deletePushToken, 1, 'leaving push must tell the relay to forget this device token');
  assert.equal(spies.writeBgKey, 0, 'no lock-readable key is ever touched on the push/off path');
});

test('Android: On-device only arms the key; Off clears it; push is never registered', async () => {
  const { tree, spies, store } = harness('android', { 'trinityone.notif.tier': 'off' });
  await button(tree, 'On-device only')[0].props.onClick();
  assert.equal(spies.writeBgKey, 1, 'On-device only arms the lock-readable key (its reader needs it)');
  assert.equal(spies.register, 0, 'Android never registers for push');
  assert.equal(store.get('trinityone.directpush.optin'), '1', 'the legacy reader key is kept in step');
  await button(tree, 'Off')[0].props.onClick();
  assert.equal(spies.deleteBgKey, 1, 'Off clears the lock-readable key the on-device tier wrote');
  assert.equal(store.get('trinityone.notif.tier'), 'off');
});

const tick = () => new Promise((r) => setTimeout(r, 0));

test('fresh install defaults ON per platform: Android on-device, iOS push pre-selected, web off', () => {
  assert.equal(selectedLabel(harness('ios').tree), 'Prompt alerts');
  assert.equal(selectedLabel(harness('android').tree), 'On-device only');
  assert.equal(selectedLabel(harness('web').tree), 'Off');
});

test('Android fresh install: the on-device key is ARMED AT BOOT (point of use: dpBootNotifications), push never registered', async () => {
  const { boot, spies, store } = harness('android', undefined, { permission: 'default' });
  await boot(); await tick();
  assert.equal(store.get('trinityone.notif.tier'), 'ondevice');
  assert.equal(spies.writeBgKey, 1, 'a default-ON on-device tier must arm the lock-readable key at boot, not only on a picker tap');
  assert.equal(spies.register, 0, 'Android never registers for push');
  assert.equal(spies.ensurePerm, 0, 'on-device polling needs no APNs permission prompt');
});

test('Android boot never re-flips an explicit Off, and arms nothing', async () => {
  const { boot, spies } = harness('android', { 'trinityone.notif.tier': 'off' });
  await boot(); await tick();
  assert.equal(spies.writeBgKey, 0);
  assert.equal(spies.register, 0);
});

test('web fresh install: tier off, nothing armed, no prompt', async () => {
  const { boot, spies, store } = harness('web');
  await boot(); await tick();
  assert.equal(store.get('trinityone.notif.tier'), 'off');
  assert.deepEqual([spies.writeBgKey, spies.register, spies.ensurePerm, spies.publishPushToken.length], [0, 0, 0, 0]);
});

test('iOS boot WITHOUT permission: prompt shown, NO APNs register, NO token published, key never armed', async () => {
  const { boot, spies } = harness('ios', undefined, { permission: 'default', grant: false });
  await boot(); await tick();
  assert.equal(spies.ensurePerm, 1, 'the OS permission prompt is requested first');
  assert.equal(spies.register, 0, 'no grant => no registration with APNs');
  assert.deepEqual(spies.publishPushToken, [], 'no grant => no token doc published');
  assert.equal(spies.writeBgKey, 0);
});

test('iOS boot WITH permission granted: registers, and an arriving token is published; the on-device key is still never armed', async () => {
  const { boot, spies, win } = harness('ios', undefined, { permission: 'default', grant: true });
  await boot(); await tick();
  assert.equal(spies.ensurePerm, 1);
  assert.equal(spies.register, 1, 'grant => register for APNs');
  await win._apnsCb({ token: 'CCDD', env: 'sandbox' });
  assert.deepEqual(spies.publishPushToken, [['CCDD', 'sandbox']]);
  assert.equal(spies.writeBgKey, 0, 'PUSH MUST NOT arm the lock-readable key, even at boot');
});

test('iOS picker: choosing Prompt alerts when permission is refused does not register or publish', async () => {
  const { tree, spies, win } = harness('ios', { 'trinityone.notif.tier': 'off' }, { permission: 'default', grant: false });
  await button(tree, 'Prompt alerts')[0].props.onClick();
  assert.equal(spies.register, 0);
  assert.deepEqual(spies.publishPushToken, []);
  assert.equal(spies.writeBgKey, 0);
});

test('migration: Android legacy opt-in stays On-device; a legacy iOS opt-in clamps to a LISTED tier (push, the iOS default)', () => {
  assert.equal(selectedLabel(harness('android', { 'trinityone.directpush.optin': '1' }).tree), 'On-device only',
    'Android must keep an existing on-device opt-in, never silently turn it off');
  assert.equal(selectedLabel(harness('ios', { 'trinityone.directpush.optin': '1' }).tree), 'Prompt alerts',
    'iOS never offered a working on-device tier, so a legacy opt-in clamps to the listed iOS default (never a selected-but-unlisted option)');
});
