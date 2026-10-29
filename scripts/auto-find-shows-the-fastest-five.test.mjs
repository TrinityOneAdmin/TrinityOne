// AUTO-FIND'S CARD SHOWS THE FIVE FASTEST RELAYS, AND "SHOW ALL" REVEALS THE REST — ON THE SCREEN.
// Run: node --test scripts/auto-find-shows-the-fastest-five.test.mjs
//
// Owner decision 2026-10-29: the Add-a-relay card's Auto-find defaults its VISIBLE list to the five fastest
// public relays with a "Show all" control, and the steward ticks which to connect. CLAUDE.md rule 1 wants a
// test that fails if that is deleted FROM THE SCREEN, and rule 3 forbids proving it by matching text in
// app/*.jsx (those ship unbundled, so `false && ` leaves the words in place). So this renders the REAL
// DashAddRelayCard through the miniature React in render-jsx-screen.mjs, drives its own Auto-find button, and
// reads the tree. Real code runs and real branches evaluate.
//
// WHAT IT CANNOT WIDEN (rule 10 / RELAY-ADMISSION.md): the list is window.Steward.listRelayOffers()'s output,
// which is discoverRelayOffers() — already past admitRemoteRelay() (C5) and _probeRelayEnforces(). This card
// only re-orders and slices that output, so the connect handler can only ever pass back relays the engine
// already admitted. The LAST test here pins that: connecting sends exactly the ticked offers to
// connectFoundRelays, nothing the card invented. listRelayOffers is STUBBED here on purpose — its admission
// gates and its ms ordering are proved against the engine in scripts/relay-offer-probe.test.mjs (gateway,
// serial) and scripts/auto-find-ranks-relays-by-latency.test.mjs (pure). This file binds no port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, miniReact, find, texts, reads } from './render-jsx-screen.mjs';

const DASH = compileScreen('app/stew-dashboard.jsx');
const settle = () => new Promise(r => setImmediate(r));

// Seven offers, already ranked fastest-first the way listRelayOffers returns them. Distinct ms so order is
// unambiguous; the two slowest are deliberately outside the default five.
const OFFERS = [
  { url: 'wss://r1/relay', name: 'alpha',   operator: 'op-a', region: 'uk', churches: 3, ms: 18 },
  { url: 'wss://r2/relay', name: 'bravo',   operator: 'op-b', region: 'uk', churches: 1, ms: 41 },
  { url: 'wss://r3/relay', name: 'charlie', operator: 'op-c', region: 'uk', churches: 2, ms: 77 },
  { url: 'wss://r4/relay', name: 'delta',   operator: 'op-d', region: 'uk', churches: 0, ms: 110 },
  { url: 'wss://r5/relay', name: 'echo',    operator: 'op-e', region: 'uk', churches: 4, ms: 162 },
  { url: 'wss://r6/relay', name: 'foxtrot', operator: 'op-f', region: 'uk', churches: 1, ms: 240 },
  { url: 'wss://r7/relay', name: 'golf',    operator: 'op-g', region: 'uk', churches: 2, ms: 390 },
];

function card({ offers = OFFERS, onConnect = () => {} } = {}) {
  const { React, draw } = miniReact();
  const listeners = new Map();
  const steward = {
    useStewardChurch: () => ({ name: 'Grace Church' }),
    listRelayOffers: async () => offers.slice(),
    isSharedRelaySpelling: () => false,
    isOwnRelaySpelling: () => false,
    addRelay: () => '',
    knownRelay: () => '',
    rememberRelayName: () => {},
    publishRelayList: async () => null,
    signRelay: async () => '',   // '' from signOutcome == signed into the church list (success)
    connectFoundRelays: async (picks) => { onConnect(picks); return picks; },
  };
  const win = {
    useStewardChurch: steward.useStewardChurch,
    addEventListener(t, f) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(f); },
    removeEventListener(t, f) { const a = listeners.get(t) || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    dispatchEvent(e) { (listeners.get(e && e.type) || []).slice().forEach(f => f(e)); return true; },
    Steward: steward,
  };
  const globals = {
    React, window: win,
    location: { host: 'relay.grace.example', hostname: 'relay.grace.example' },
    navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; },
    SkPill: function SkPill() { return null; },
    SkBadge: function SkBadge() { return null; },
    useStewDialog: () => ({ current: null }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, DASH + '\nreturn { DashAddRelayCard };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.DashAddRelayCard, 'function', 'DashAddRelayCard is not a component any more — re-anchor this test');
  return { draw: () => draw(mod.DashAddRelayCard, {}) };
}

const offerRows = (tree) => find(tree, n => n.type === 'input' && n.props && n.props.type === 'checkbox'
  && /^Connect /.test(String(n.props['aria-label'] || '')));
// reads(), not texts().join(' '): a count rendered as `(${selected.size})` is three child nodes, and a space
// join turns "selected (2)" into "selected ( 2 )". reads() glues inline/text nodes the way the DOM lays them
// out, so "Connect selected (2)" and "Show all (7)" match what a steward actually sees.
const btn = (tree, label) => find(tree, n => n.type === 'button' && reads(n).includes(label));

// Click Auto-find and let its async listRelayOffers() resolve, then redraw so the list is on screen.
async function search(c) {
  let tree = c.draw();
  const find1 = btn(tree, 'Auto-find relays for me');
  assert.equal(find1.length, 1, 'the Auto-find button is gone — re-anchor this test');
  find1[0].props.onClick();
  await settle(); await settle();
  return c.draw();
}

test('before a search, no relay rows are on the card', () => {
  const tree = card().draw();
  assert.equal(offerRows(tree).length, 0, 'offer rows rendered before Auto-find was ever pressed');
});

test('after a search the card shows the fastest five, with a Show all control for the rest', async () => {
  const c = card();
  const tree = await search(c);
  const rows = offerRows(tree);
  assert.equal(rows.length, 5, 'the card did not default to the five fastest relays — it showed ' + rows.length);
  // The fastest five by ms are alpha..echo; the two slowest (foxtrot, golf) must be hidden until Show all.
  const labels = rows.map(r => String(r.props['aria-label']));
  assert.ok(labels.some(l => l.includes('alpha')), 'the fastest relay (alpha) is not shown');
  assert.ok(labels.some(l => l.includes('echo')), 'the fifth-fastest relay (echo) is not shown');
  assert.ok(!labels.some(l => l.includes('foxtrot')), 'a slower relay (foxtrot) is shown before Show all was pressed');
  assert.ok(!labels.some(l => l.includes('golf')), 'the slowest relay (golf) is shown before Show all was pressed');
  // the measured latency is on screen
  assert.ok(reads(tree).includes('18 ms'), 'the measured latency is not shown on the card');
  // and a Show all control that names how many there are
  assert.equal(btn(tree, 'Show all (7)').length, 1, 'the "Show all (7)" control is missing with more than five offers');
});

test('Show all reveals every offer and then there is nothing left to show', async () => {
  const c = card();
  let tree = await search(c);
  btn(tree, 'Show all (7)')[0].props.onClick();
  tree = c.draw();
  assert.equal(offerRows(tree).length, 7, 'Show all did not reveal all seven relays');
  assert.equal(btn(tree, 'Show all').length, 0, 'the Show all control is still on screen after everything is shown');
});

test('connecting sends exactly the ticked offers to the engine — the card invents nothing (rule 10)', async () => {
  let sent = null;
  const c = card({ onConnect: (picks) => { sent = picks; } });
  let tree = await search(c);
  // The card pre-ticks the two fastest. Connect selected -> consent -> Yes, connect.
  assert.equal(btn(tree, 'Connect selected (2)').length, 1, 'the card did not pre-tick the two fastest relays');
  btn(tree, 'Connect selected')[0].props.onClick();
  tree = c.draw();
  const yes = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Yes, connect'));
  assert.equal(yes.length, 1, 'the consent gate (RelayConsent) did not appear before connecting — it must');
  yes[0].props.onClick();
  await settle(); await settle();
  assert.ok(Array.isArray(sent), 'connectFoundRelays was never called');
  assert.deepEqual(sent.map(o => o.url), ['wss://r1/relay', 'wss://r2/relay'],
    'the connect path sent relays other than the two the steward ticked — selection or admission was bypassed');
});
