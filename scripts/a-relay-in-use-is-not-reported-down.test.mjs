// A RELAY THE CONSOLE IS ALREADY USING IS NOT "Down". Sim round 2026-10-02, finding #63 ("Your relay: Down" all
// afternoon while publishing worked).
// Run: node --test scripts/a-relay-in-use-is-not-reported-down.test.mjs
//
// The Overview's "Your relay" card says Live when any relay's status is 'on' and Down when none is. Steward.relayStatus
// decided each relay by dialling a THROWAWAY socket every 30 s and calling it off if that socket did not open in
// 2.5 s. A relay that limits new connections, or a slow link, fails the throwaway while the console's own long-lived
// socket - the one every publish and subscription rides - is open and carrying traffic. The card then said Down over a
// relay that was working.
//
// R1 (fix/relay-panel-truth-2026-11-11): relayStatus now derives the dot from the HELD pool connection — the very
// instance our subscriptions / auth live on (_subbedOn / _authAccepted / _authedRelays), reported `viaPool` with no
// latency. The throwaway dial is only a last-resort hint. CRITICALLY it does NOT trust a bare
// listConnectionStatus()===true: a "connected but not listening" socket (re-opened by a one-shot read, nothing
// subscribed/authed) must stay off, so the false-RED is fixed without a false-GREEN — the last test pins that.
//
// Users of the changed code (rule 2): relayStatus has one caller, app/steward-root.jsx useStewardRelays, whose consumers
// are DashOverview's "Your relay" card (reads status === 'on') and the Relays panel rows (read status and `ms != null`,
// so a viaPool row simply shows no millisecond figure). The same name on window.Fellowship (member app) is a different
// function and is NOT changed here.
//
// HOW IT ASSERTS (rule 3): the SHIPPED vendor/steward.js runs whole in a vm whose sockets never open (the harness's
// WebSocket always errors, i.e. every dial fails), and the card is then read through the real DashOverview. The pool's
// HELD state (a live instance in pool.relays + _subbedOn pointing at it) is the INPUT the harness sets up; what is
// under test is that the engine believes the held connection and the card shows it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFellowship } from './fellowship-vm.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// `held` = the pool holds an OPEN socket for the relay AND our subscriptions live on that very instance — a relay
//   genuinely carrying the console's traffic. This is what must read "on" even though every dial fails.
// `connectedOnly` = listConnectionStatus says connected, but NOTHING is subscribed/authed on it — the
//   "connected but not listening" false-GREEN, which must stay off.
async function consoleWith({ held = false, connectedOnly = false } = {}) {
  const { S, exposed } = loadFellowship({ bundle: 'steward', expose: ['pool', '_subbedOn'] });
  await S.restoreKey(words);
  const first = (await S.relayStatus())[0];
  assert.ok(first && first.url, 'the console has no relays at all - the fixture is wrong');
  if (held || connectedOnly) {
    const inst = { connected: true };                                // the AbstractRelay the pool is holding
    exposed.pool.relays = new Map([[first.url, inst]]);
    exposed.pool.listConnectionStatus = () => new Map([[first.url, true]]);
    if (held) exposed._subbedOn.set(first.url, inst);                // …and the one our subscriptions live on
  }
  return { S, url: first.url };
}

test('control: every dial fails and the pool holds nothing - the relay is off', async () => {
  const { S } = await consoleWith();
  const all = await S.relayStatus();
  assert.ok(all.length > 0 && all.every(r => r.status === 'off'), 'the harness should make every dial fail: ' + JSON.stringify(all));
});

test('a relay the pool is HOLDING OPEN and subscribed on is on, even though the dial failed', async () => {
  const { S, url } = await consoleWith({ held: true });
  const row = (await S.relayStatus()).find(r => r.url === url);
  assert.equal(row.status, 'on', 'THE DEFECT: a relay carrying the console’s own traffic is reported off');
  assert.equal(row.viaPool, true);
  assert.equal(row.ms, null, 'no latency was measured, so none should be claimed');
});

test('a connected-but-not-listening socket is NOT on (the false-RED is not traded for a false-GREEN)', async () => {
  const { S, url } = await consoleWith({ connectedOnly: true });
  const row = (await S.relayStatus()).find(r => r.url === url);
  assert.equal(row.status, 'off',
    'a bare listConnectionStatus()===true, with nothing subscribed/authed on the socket, read "on" — ' +
    'that is the "connected but not listening" false-green relaysHealthy was written to defeat');
});

test('the Overview card then says Live, not Down', async () => {
  const card = async (opts) => {
    const { S } = await consoleWith(opts);
    const relays = await S.relayStatus();
    const { React, draw } = miniReact();
    const win = {
      Steward: S, useStewardRelays: () => relays,
      useStewardGroups: () => [], useStewardMembers: () => [], useStewardRosters: () => [], useStewardStats: () => ({ events: 0, announcements: 0 }),
      useStewardActivity: () => [], useStewardChurch: () => ({ name: 'St X', features: {} }), useStewardConn: () => 0, useStewardStewards: () => [],
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage: { getItem: () => null, setItem() {} },
    };
    const proxied = new Proxy(win, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && k.startsWith('useSteward')) return () => []; return undefined; }, has: () => true });
    const names = ['DashOverview'];
    const mod = loadScreen('app/stew-dashboard.jsx', names, {
      React, window: proxied, localStorage: win.localStorage, Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), SkToggle: Stub('SkToggle'), SkPill: Stub('SkPill'), SkConfirm: Stub('SkConfirm'),
      DismissibleNote: Stub('DismissibleNote'), StewHelpLink: Stub('StewHelpLink'), DashMealsPanel: Stub('DashMealsPanel'), DashMannaPanel: Stub('DashMannaPanel'),
      Halo: Stub('Halo'), SkKey: Stub('SkKey'), SkQR: Stub('SkQR'), StewVersion: Stub('StewVersion'), NetworkAnnounceComposer: Stub('NetworkAnnounceComposer'), ConsoleChrome: Stub('ConsoleChrome'), StewHelpButton: Stub('StewHelpButton'),
      WizMeetings: Stub('WizMeetings'), _wizMeetingId: () => 'evt1', churchHandle: () => 'grace', stewCapState: () => ({ allowed: false }), location: { host: 'x', hostname: 'x' }, navigator: { userAgent: '' }, document: { addEventListener() {}, removeEventListener() {} },
      setInterval, clearInterval, console, fetch: async () => ({ ok: false, json: async () => ({}) }),
      SK_TINT: { clay: {}, gold: {}, sage: {}, ink: {} }, useStewDialog: () => ({ current: null }), useStewNarrow: () => false, todayISO: () => '2026-10-03', CustomEvent,
    });
    const tree = draw(mod.DashOverview, { onTab() {}, onNewPost() {}, onSettings() {} });
    const hit = find(tree, n => n.props && n.props.label === 'Your relay');
    assert.equal(hit.length, 1, 're-anchor: the Overview has no "Your relay" card');
    return String(hit[0].props.value);
  };
  const down = await card({});
  assert.match(down, /Down/, 'control: with the pool holding nothing the card should still say Down');
  const live = await card({ held: true });
  assert.match(live, /Live/);
  assert.doesNotMatch(live, /Down/, 'the card says Down over a relay the console is publishing through');
});
