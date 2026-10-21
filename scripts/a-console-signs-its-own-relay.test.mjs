// THE CONSOLE SIGNS ITS OWN RELAY — AND A TYPED ONE ONLY ON THE STEWARD'S INFORMED CONSENT.
// Self-hosting Phase 1, 2026-10-21 (reference/DESIGN-SELFHOSTING-2026-10-21.md §6; PLAN-ENROLMENT-GAP B2/B4).
// Run: node --test scripts/a-console-signs-its-own-relay.test.mjs
//
// Two things the screen must do, each driven at the point of use (CLAUDE.md rule 1), never by matching words
// in app/*.jsx (rule 3 — those files ship unbundled, so `false && ` would leave every word in place):
//
//  1. B2 — the console calls autoEnrolRelayNet() once it has its key, and again on every unlock. The effect
//     in KeyDistributor is sliced out of app/stew-dashboard.jsx and RUN; delete the call and this goes red.
//  2. B4 — owner's decision: a relay a steward typed is signed into the church's list only after they have
//     read "Connecting this relay lets your whole church's data go to it" and tapped Connect. The real
//     Add-a-relay card is compiled and rendered, the buttons are pressed, and what reached window.Steward is
//     counted. The first tap must reach NOTHING; the consent tap must add AND sign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileScreen, miniReact, find, texts, button } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const CONSENT = /Connecting this relay lets your whole church’s data go to it\./;

// ── 1. B2: the effect that signs this console's own box ─────────────────────────────────────────────────
function runOwnRelayEffect(steward) {
  const START = "  // ── SIGN THIS CONSOLE'S OWN RELAY INTO THE CHURCH'S LIST";
  const END = '  // ── end of the own-relay enrolment effect';
  const a = DASH.indexOf(START), b = DASH.indexOf(END, a);
  assert.ok(a > 0 && b > a, 're-anchor: the own-relay enrolment effect moved or was removed from KeyDistributor');
  assert.equal(DASH.indexOf(START, a + 1), -1, 'the start anchor appears twice — the slice would be ambiguous');
  const src = DASH.slice(a, b);
  const timers = [];
  let cleanup = null;
  const React = { useEffect(fn, deps) { assert.deepEqual(deps, [7], 'the effect does not re-run on unlockTick'); cleanup = fn(); } };
  new Function('React', 'window', 'setTimeout', 'clearTimeout', 'unlockTick', src)(
    React, { Steward: steward }, (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, () => {}, 7);
  return { timers, cleanup };
}

test('B2: once the console has its key, it signs its own relay — the effect runs, the call is made', async () => {
  let calls = 0;
  const { timers, cleanup } = runOwnRelayEffect({ autoEnrolRelayNet: async () => { calls++; return { published: true }; } });
  assert.equal(timers.length, 1, 'the effect scheduled nothing');
  assert.equal(calls, 0, 'it ran before the first paint instead of deferring');
  timers[0].fn();
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 1, 'THE CONSOLE NEVER ASKED TO SIGN ITS OWN RELAY — enrolment is wired to nothing, so no ' +
    'self-hosting church ever gets its box into its signed list');
  assert.equal(typeof cleanup, 'function', 'the timer is not cleared when the console re-renders or unmounts');
});

test('B2: a failing enrolment cannot break the console', async () => {
  const { timers } = runOwnRelayEffect({ autoEnrolRelayNet: async () => { throw new Error('relay down'); } });
  timers[0].fn();
  await new Promise(r => setImmediate(r));   // an unhandled rejection would fail the run
  const { timers: t2 } = runOwnRelayEffect({});   // an older bundle with no autoEnrolRelayNet
  assert.doesNotThrow(() => t2[0].fn());
});

// ── 2. B4: the real Add-a-relay card ────────────────────────────────────────────────────────────────────
const JS = compileScreen('app/stew-dashboard.jsx');
function addCard(steward) {
  const { React, draw } = miniReact();
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const win = {
    useStewardRelays: () => [], useStewardChurch: () => ({ name: 'St Aidan’s' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, localStorage,
    Steward: { ownRelay: () => 'wss://relay.grace.example/relay', backupState: async () => ({}), ...steward },
  };
  const globals = {
    React, window: win, localStorage,
    location: { host: 'relay.grace.example', hostname: 'relay.grace.example' },
    navigator: { userAgent: '' }, document: { addEventListener() {}, removeEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; }, SkPill: function SkPill() { return null; }, SkBadge: function SkBadge() { return null; },
    useStewDialog: () => ({ current: null }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { DashAddRelayCard };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.DashAddRelayCard, 'function', 'DashAddRelayCard is not a component any more — re-anchor');
  return { draw: () => draw(mod.DashAddRelayCard, {}) };
}
const settle = () => new Promise(r => setImmediate(r));
const said = (n) => texts(n).join('').replace(/\s+/g, ' ').trim();
const consentYes = (tree) => button(tree, 'Connect').filter(b => b.props['aria-label'] !== 'Connect to relay by name');
function recorder(extra = {}) {
  const log = [];
  const rec = (name, ret) => (...a) => { log.push([name, ...a]); return typeof ret === 'function' ? ret(...a) : ret; };
  return {
    log, count: (n) => log.filter(x => x[0] === n).length,
    steward: {
      addRelay: rec('addRelay', (u) => String(u).trim()),
      signRelay: rec('signRelay', async () => ({ proven: [{ url: 'x', pubkey: 'a'.repeat(64) }], published: true })),
      resolveRelayName: rec('resolveRelayName', async () => ({ url: 'wss://grace-city.example/relay' })),
      registerAtRelay: rec('registerAtRelay', async () => ({ ok: true })),
      rememberRelayName: rec('rememberRelayName'),
      ...extra,
    },
  };
}

test('B4: "Add relay" first shows what connecting means, and adds or signs NOTHING until Connect', async () => {
  const r = recorder();
  const card = addCard(r.steward);
  let tree = card.draw(); await settle(); tree = card.draw();
  const input = find(tree, n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add');
  assert.equal(input.length, 1, 're-anchor: the relay address field is gone');
  input[0].props.onChange({ target: { value: 'wss://second.grace.example/relay' } });
  button(card.draw(), 'Add relay')[0].props.onClick();
  await settle();
  tree = card.draw();
  assert.match(said(tree), CONSENT, 'the steward was not told that connecting sends their whole church\'s data to it');
  assert.equal(r.count('addRelay'), 0, 'the relay was ADDED on the first tap, before the steward consented');
  assert.equal(r.count('signRelay'), 0, 'THE RELAY WAS SIGNED BEFORE CONSENT — one tap and every member trusts it');

  const yes = consentYes(tree);
  assert.equal(yes.length, 1, 'the consent line has no Connect to tap');
  await yes[0].props.onClick();
  await settle();
  assert.equal(r.count('addRelay'), 1, 'the consented relay was not added');
  assert.deepEqual(r.log.filter(x => x[0] === 'signRelay').map(x => x[1]), ['wss://second.grace.example/relay'],
    'the consented relay was not signed into the church\'s list — "connect" would then quietly carry nothing');
  assert.doesNotMatch(said(card.draw()), CONSENT, 'the consent line stayed up after the steward answered it');
});

test('B4: Cancel on the consent line adds and signs nothing', async () => {
  const r = recorder();
  const card = addCard(r.steward);
  card.draw(); await settle();
  find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add')[0]
    .props.onChange({ target: { value: 'wss://second.grace.example/relay' } });
  button(card.draw(), 'Add relay')[0].props.onClick();
  await settle();
  const no = button(card.draw(), 'Cancel');
  assert.equal(no.length, 1, 'the consent line has no way to say no');
  no[0].props.onClick();
  await settle();
  assert.doesNotMatch(said(card.draw()), CONSENT, 'Cancel did not close the consent line');
  assert.equal(r.count('addRelay') + r.count('signRelay'), 0, 'Cancel still added or signed the relay');
});

test('B4: "Connect" by name asks first too, and only the consent tap looks it up, registers and signs', async () => {
  const r = recorder();
  const card = addCard(r.steward);
  card.draw(); await settle();
  find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay name to connect to')[0]
    .props.onChange({ target: { value: 'grace-city' } });
  const go = button(card.draw(), 'Connect').filter(b => b.props['aria-label'] === 'Connect to relay by name');
  assert.equal(go.length, 1, 're-anchor: the connect-by-name button is gone');
  go[0].props.onClick();
  await settle();
  const tree = card.draw();
  assert.match(said(tree), CONSENT, 'connect-by-name did not show the consent line');
  assert.equal(r.log.length, 0, 'connect-by-name acted before consent: ' + JSON.stringify(r.log.map(x => x[0])));
  await consentYes(tree)[0].props.onClick();
  await settle();
  assert.equal(r.count('registerAtRelay'), 1, 'the consented relay was not registered');
  assert.deepEqual(r.log.filter(x => x[0] === 'signRelay').map(x => x[1]), ['wss://grace-city.example/relay'],
    'the relay the name resolved to was not signed after consent');
});

test('B4: a relay that cannot prove itself is not reported as signed', async () => {
  const r = recorder({ signRelay: async () => ({ proven: [], unproven: ['wss://second.grace.example/relay'], published: false }) });
  const card = addCard(r.steward);
  card.draw(); await settle();
  find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add')[0]
    .props.onChange({ target: { value: 'wss://second.grace.example/relay' } });
  button(card.draw(), 'Add relay')[0].props.onClick();
  await settle();
  await consentYes(card.draw())[0].props.onClick();
  await settle(); await settle();
  assert.match(said(card.draw()), /could not prove it runs TrinityOne yet/,
    'a relay that was NOT signed was left looking connected — the steward is told nothing');
});

// ── 3. B4 in the new-church wizard: the same consent before its Add ─────────────────────────────────────
test('B4: the setup wizard\'s Add asks first too, and signs only on consent', () => {
  const src = fnBody(DASH, 'const addOwnRelay = (confirmed) => {', 'addOwnRelay');
  const log = [];
  let asking = false;
  const run = new Function('relayAddr', 'setAddrAsk', 'setAddrMsg', 'setRelayAddr', 'window',
    'return (' + src.replace(/^const addOwnRelay = /, '') + ');')(
    'wss://second.grace.example/relay', (v) => { asking = v; }, () => {}, () => {},
    { Steward: { addRelay: (u) => { log.push('add'); return u; }, signRelay: async (u) => { log.push('sign:' + u); return {}; } } });
  run();
  assert.equal(asking, true, 'the wizard\'s Add did not show the consent line');
  assert.deepEqual(log, [], 'the wizard added or signed before consent');
  run(true);
  assert.deepEqual(log, ['add', 'sign:wss://second.grace.example/relay'], 'the wizard did not add and sign on consent');
});

// ── 4. autoEnrolRelayNet, out of the bundle the console loads ───────────────────────────────────────────
// What the effect above calls. Lifted from vendor/steward.js (the shipped build), with the world it reads
// handed in: once per (church, box) per page load; an unfinished read is NOT remembered, so the next unlock
// tries again; nothing at all without an own box, or for a console that is not this church's own.
const VENDOR = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
function autoEnrol({ cands = ['ws://127.0.0.1:9/relay'], acting = '', network = false, results }) {
  const body = fnBody(VENDOR, 'async function autoEnrolRelayNet()', 'autoEnrolRelayNet');
  let n = 0;
  const fn = new Function('sk', 'pub', 'actingChurch', '_viewingNetwork', 'relayNetCandidates', 'enrolRelayNet', '_autoEnrolled',
    body + '\nreturn autoEnrolRelayNet;')(
    'sk', 'a'.repeat(64), acting, () => network, () => cands.slice(),
    async () => { const r = results[Math.min(n, results.length - 1)]; n++; if (r instanceof Error) throw r; return r; }, new Set());
  return { fn, calls: () => n };
}

test('B2: the automatic call enrols once per church and box, and retries only when the answer was unknown', async () => {
  const done = autoEnrol({ results: [{ published: true }] });
  await done.fn(); await done.fn(); await done.fn();
  assert.equal(done.calls(), 1, 'a steward locking and unlocking re-ran enrolment ' + done.calls() + ' times');

  const unknown = autoEnrol({ results: [{ unknown: true }, { published: true }] });
  await unknown.fn(); await unknown.fn(); await unknown.fn();
  assert.equal(unknown.calls(), 2, 'an unfinished read was remembered as done, so the box is never signed this session');

  const thrown = autoEnrol({ results: [new Error('relay down'), { published: true }] });
  await thrown.fn(); await thrown.fn();
  assert.equal(thrown.calls(), 2, 'a failed run was remembered as done');
});

test('B2: nothing runs without an own box, or for a console that is not this church\'s own', async () => {
  for (const [why, opts] of [['no own box (APK / static host)', { cands: [] }],
    ['delegated', { acting: 'b'.repeat(64) }], ['network view', { network: true }]]) {
    const a = autoEnrol({ ...opts, results: [{ published: true }] });
    assert.equal(await a.fn(), null, why + ': it did something');
    assert.equal(a.calls(), 0, why + ': enrolment was called');
  }
});
