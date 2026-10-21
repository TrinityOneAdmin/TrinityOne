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
  const timers = [], listeners = new Map();
  let cleanup = null;
  const React = { useEffect(fn, deps) { assert.deepEqual(deps, [7], 'the effect does not re-run on unlockTick'); cleanup = fn(); } };
  const win = {
    Steward: steward,
    addEventListener(t, f) { (listeners.get(t) || listeners.set(t, []).get(t)).push(f); },
    removeEventListener(t, f) { const a = listeners.get(t) || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
  };
  new Function('React', 'window', 'setTimeout', 'clearTimeout', 'unlockTick', src)(
    React, win, (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, () => {}, 7);
  const fire = (t) => (listeners.get(t) || []).slice().forEach(f => f());
  return { timers, cleanup, fire, listeners };
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

test('B2: a console left open keeps trying — a relay coming back, or focus, runs the pass again (finding 7)', async () => {
  let calls = 0;
  const e = runOwnRelayEffect({ autoEnrolRelayNet: async () => { calls++; return null; } });
  e.fire('steward-relay-returned');
  e.fire('focus');
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 2, 'NOTHING RETRIES — a console open for days never signs a box that was offline at unlock');
  e.cleanup();
  e.fire('steward-relay-returned'); e.fire('focus');
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 2, 'the listeners outlive the effect — every re-render would add another');
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
const consentYes = (tree) => button(tree, 'Yes, connect');
function recorder(extra = {}) {
  const log = [];
  const rec = (name, ret) => (...a) => { log.push([name, ...a]); return typeof ret === 'function' ? ret(...a) : ret; };
  return {
    log, count: (n) => log.filter(x => x[0] === n).length,
    steward: {
      addRelay: rec('addRelay', (u) => String(u).trim()),
      // A signing that worked: the relay proved a key and that key is in the signed list.
      signRelay: rec('signRelay', async (u) => ({ proven: [{ url: u, pubkey: 'a'.repeat(64) }], entries: [{ pubkey: 'a'.repeat(64) }], published: true })),
      resolveRelayName: rec('resolveRelayName', async () => ({ url: 'wss://grace-city.example/relay' })),
      registerAtRelay: rec('registerAtRelay', async () => ({ ok: true })),
      rememberRelayName: rec('rememberRelayName'),
      knownRelay: rec('knownRelay', () => ''),
      findRelays: rec('findRelays', async () => [{ url: 'wss://open-a.example/relay', name: 'open-a' }, { url: 'wss://open-b.example/relay', name: 'open-b' }]),
      connectFoundRelays: rec('connectFoundRelays', async (picks) => picks),
      unsignRelay: rec('unsignRelay', async () => ({ removed: true })),
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

test('B4: "Connect" by name looks the name up, shows the address, and only the consent tap adds, registers and signs', async () => {
  const r = recorder();
  const card = addCard(r.steward);
  card.draw(); await settle();
  find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay name to connect to')[0]
    .props.onChange({ target: { value: 'grace-city' } });
  const go = button(card.draw(), 'Connect').filter(b => b.props['aria-label'] === 'Connect to relay by name');
  assert.equal(go.length, 1, 're-anchor: the connect-by-name button is gone');
  go[0].props.onClick();
  await settle();
  await settle();
  const tree = card.draw();
  assert.match(said(tree), CONSENT, 'connect-by-name did not show the consent line');
  // Looking the name up is allowed before consent — it is how the consent line can name the box (finding 8).
  // Adding, registering, remembering and signing are not.
  assert.deepEqual(r.log.map(x => x[0]), ['resolveRelayName'], 'connect-by-name acted before consent: ' + JSON.stringify(r.log.map(x => x[0])));
  assert.match(said(tree), /grace-city\.example\/relay/, 'the consent line does not show the address the name leads to');
  await consentYes(tree)[0].props.onClick();
  await settle();
  assert.equal(r.count('resolveRelayName'), 1, 'the name was looked up again after consent — the box agreed to may not be the one connected');
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

// ── 3. B4 in the new-church wizard, the auto-find button, and a relay that is already listed ─────────────
function wizBox(steward) {
  const { React, draw } = miniReact();
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, Steward: { ...steward } };
  const globals = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { host: 'app.example', hostname: 'app.example' }, navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} }, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; }, SkPill: function SkPill() { return null; }, SkBadge: function SkBadge() { return null; },
    useStewDialog: () => ({ current: null }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { WizAddRelay };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.WizAddRelay, 'function', 'the setup wizard\'s relay-address box is not a component any more — re-anchor');
  return { draw: () => draw(mod.WizAddRelay, {}) };
}

test('B4: the setup wizard\'s Add shows the consent line, and adds and signs only on "Yes, connect" (finding 4)', async () => {
  const r = recorder();
  const box = wizBox(r.steward);
  box.draw(); await settle();
  find(box.draw(), n => n.type === 'input' && n.props.placeholder === 'wss://relay.yourchurch.org')[0]
    .props.onChange({ target: { value: 'wss://second.grace.example/relay' } });
  button(box.draw(), 'Add')[0].props.onClick();
  await settle();
  const tree = box.draw();
  assert.match(said(tree), CONSENT, 'THE WIZARD\'S ADD SHOWED NO CONSENT LINE — the steward is never told where the data goes');
  assert.equal(r.count('addRelay') + r.count('signRelay'), 0, 'the wizard added or signed before consent');
  await consentYes(tree)[0].props.onClick();
  await settle(); await settle();
  assert.equal(r.count('addRelay'), 1, 'the wizard did not add the consented relay');
  assert.deepEqual(r.log.filter(x => x[0] === 'signRelay').map(x => x[1]), ['wss://second.grace.example/relay'], 'the wizard did not sign it');
  assert.match(said(box.draw()), /✓ Added/, 'a signed relay was not reported as added');
});

test('the setup wizard does not say "Added" for a relay that could not be signed (finding 4)', async () => {
  const r = recorder({ signRelay: async () => ({ proven: [], unproven: ['x'], published: false }) });
  const box = wizBox(r.steward);
  box.draw(); await settle();
  find(box.draw(), n => n.type === 'input' && n.props.placeholder === 'wss://relay.yourchurch.org')[0]
    .props.onChange({ target: { value: 'wss://second.grace.example/relay' } });
  button(box.draw(), 'Add')[0].props.onClick();
  await settle();
  await consentYes(box.draw())[0].props.onClick();
  await settle(); await settle();
  const all = said(box.draw());
  assert.doesNotMatch(all, /✓ Added/, 'THE WIZARD SAID "✓ Added" FOR A RELAY THAT IS NOT IN THE CHURCH\'S LIST');
  assert.match(all, /could not prove it runs TrinityOne yet/, 'the steward was not told it is not signed');
});

test('Auto-find finds first, NAMES the relays on the consent line, and connects and signs exactly those on "Yes, connect"', async () => {
  // Owner decision A, 2026-10-21: agree to boxes, not to a description — and these are other people's boxes.
  const r = recorder();
  const card = addCard(r.steward);
  card.draw(); await settle();
  const go = button(card.draw(), 'Auto-find relays for me');
  assert.equal(go.length, 1, 're-anchor: the Auto-find button is gone');
  go[0].props.onClick();
  await settle(); await settle();
  const tree = card.draw();
  assert.match(said(tree), /Connecting these relays lets your whole church’s data go to them\./, 'Auto-find showed no consent line');
  assert.match(said(tree), /open-a\.example/, 'the consent line does not name the relays Auto-find found');
  assert.match(said(tree), /open-b\.example/, 'the consent line does not name every relay Auto-find found');
  assert.match(said(tree), /run by other people/, 'the consent line does not say these relays are run by other people');
  assert.deepEqual(r.log.map(x => x[0]), ['findRelays'], 'Auto-find added, connected or signed before consent: ' + JSON.stringify(r.log.map(x => x[0])));
  await consentYes(tree)[0].props.onClick();
  await settle(); await settle();
  assert.deepEqual(r.log.filter(x => x[0] === 'connectFoundRelays').map(x => x[1].map(p => p.url)),
    [['wss://open-a.example/relay', 'wss://open-b.example/relay']], 'Auto-find did not connect exactly the relays it named');
  assert.equal(r.count('findRelays'), 1, 'Auto-find searched again after consent — what was agreed to may not be what is connected');
  assert.deepEqual(r.log.filter(x => x[0] === 'signRelay').map(x => x[1]), ['wss://open-a.example/relay', 'wss://open-b.example/relay'],
    'the relays Auto-find connected after consent were not signed');
});

test('a signing that did not put the relay in the list is never reported as done (second audit, findings 6 and 8)', async () => {
  for (const [why, result, re] of [
    ['skipped (not this church\'s own console)', { skipped: 'x', proven: [], entries: [] }, /Only your church’s own console/],
    ['unknown (a relay is not answering)', { unknown: true, proven: [], entries: [] }, /could not be read in full/],
    ['proven but not in the signed list', { proven: [{ url: 'wss://second.grace.example/relay', pubkey: 'b'.repeat(64) }], entries: [] }, /Couldn’t put it in your church’s relay list/],
  ]) {
    const r = recorder({ signRelay: async () => result });
    const card = addCard(r.steward);
    card.draw(); await settle();
    find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add')[0]
      .props.onChange({ target: { value: 'wss://second.grace.example/relay' } });
    button(card.draw(), 'Add relay')[0].props.onClick();
    await settle();
    await consentYes(card.draw())[0].props.onClick();
    await settle(); await settle();
    assert.match(said(card.draw()), re, why + ': the card did not say the relay is not in the list');
    // and the wizard says the same, never "✓ Added"
    const w = wizBox(recorder({ signRelay: async () => result }).steward);
    w.draw(); await settle();
    find(w.draw(), n => n.type === 'input' && n.props.placeholder === 'wss://relay.yourchurch.org')[0]
      .props.onChange({ target: { value: 'wss://second.grace.example/relay' } });
    button(w.draw(), 'Add')[0].props.onClick();
    await settle();
    await consentYes(w.draw())[0].props.onClick();
    await settle(); await settle();
    assert.doesNotMatch(said(w.draw()), /✓ Added/, why + ': THE WIZARD SAID "✓ Added" FOR A RELAY THAT IS NOT IN THE CHURCH\'S LIST');
  }
});

test('connecting a relay that is ALREADY listed signs it, instead of refusing it (finding 1)', async () => {
  // addRelay refuses a duplicate. The card used to stop there with "Enter a relay address", so a relay added
  // before consent existed — or offline the first time — could never be signed.
  const r = recorder({ addRelay: (() => { const f = (...a) => { r2.push(['addRelay', ...a]); return false; }; return f; })(),
    knownRelay: (u) => String(u).trim() });
  const r2 = r.log;
  const card = addCard(r.steward);
  card.draw(); await settle();
  find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add')[0]
    .props.onChange({ target: { value: 'wss://second.grace.example/relay' } });
  button(card.draw(), 'Add relay')[0].props.onClick();
  await settle();
  await consentYes(card.draw())[0].props.onClick();
  await settle(); await settle();
  assert.doesNotMatch(said(card.draw()), /Enter a relay address/, 'an already-listed relay was refused as if nothing had been typed');
  assert.deepEqual(r.log.filter(x => x[0] === 'signRelay').map(x => x[1]), ['wss://second.grace.example/relay'],
    'AN ALREADY-LISTED RELAY WAS NEVER SIGNED — "connect it again" was a dead end');
});

// ── 4. autoEnrolRelayNet, out of the bundle the console loads ───────────────────────────────────────────
// What the effect above calls. Lifted from vendor/steward.js (the shipped build), with the world it reads
// handed in: once per (church, box) per page load; an unfinished read is NOT remembered, so the next unlock
// tries again; nothing at all without an own box, or for a console that is not this church's own.
const VENDOR = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const OK = { proven: [{ url: 'ws://127.0.0.1:9/relay', pubkey: 'c'.repeat(64) }], published: true, entries: [{}], delivered: [] };
function autoEnrol({ cands = ['ws://127.0.0.1:9/relay'], acting = '', network = false, hosts = true, shared = [], results, queue = null }) {
  const body = fnBody(VENDOR, 'async function autoEnrolRelayNet()', 'autoEnrolRelayNet');
  let n = 0;
  const fn = new Function('sk', 'pub', 'actingChurch', '_viewingNetwork', 'relayNetCandidates', 'enrolRelayNet', '_autoEnrolled',
    '_boxHostsUs', 'sharedRelayKeys', 'enrolSerial',
    body + '\nreturn autoEnrolRelayNet;')(
    'sk', 'a'.repeat(64), acting, () => network, () => cands.slice(),
    async () => { const r = results[Math.min(n, results.length - 1)]; n++; if (r instanceof Error) throw r; return r; }, new Set(),
    hosts, () => shared, queue || ((f) => f()));
  return { fn, calls: () => n };
}

test('B2: the automatic call enrols once per church and box, and retries only when the answer was unknown', async () => {
  const done = autoEnrol({ results: [OK] });
  await done.fn(); await done.fn(); await done.fn();
  assert.equal(done.calls(), 1, 'a steward locking and unlocking re-ran enrolment ' + done.calls() + ' times');

  const unknown = autoEnrol({ results: [{ unknown: true }, OK] });
  await unknown.fn(); await unknown.fn(); await unknown.fn();
  assert.equal(unknown.calls(), 2, 'an unfinished read was remembered as done, so the box is never signed this session');

  const thrown = autoEnrol({ results: [new Error('relay down'), OK] });
  await thrown.fn(); await thrown.fn();
  assert.equal(thrown.calls(), 2, 'a failed run was remembered as done');

  // Finding 7: the own box proved nothing, or the signed list reached no box — neither is "done".
  const unproven = autoEnrol({ results: [{ proven: [], unproven: ['x'], published: false, entries: [], delivered: [] }, OK] });
  await unproven.fn(); await unproven.fn(); await unproven.fn();
  assert.equal(unproven.calls(), 2, 'a run in which the box proved nothing was remembered as done — never retried');
  const undelivered = autoEnrol({ results: [{ ...OK, published: false, delivered: [] }, OK] });
  await undelivered.fn(); await undelivered.fn(); await undelivered.fn();
  assert.equal(undelivered.calls(), 2, 'a list that reached no box was remembered as done');
  // …but a console served by the shared relay, with nothing to sign, is done after one pass.
  const sharedBox = autoEnrol({ shared: ['c'.repeat(64)], results: [{ ...OK, published: false, delivered: [], entries: [] }] });
  await sharedBox.fn(); await sharedBox.fn();
  assert.equal(sharedBox.calls(), 1, 'a console on the shared relay re-ran enrolment with nothing to do');
});

test('B2: nothing runs without an own box, or for a console that is not this church\'s own', async () => {
  for (const [why, opts] of [['no own box (APK / static host)', { cands: [] }],
    ['delegated', { acting: 'b'.repeat(64) }], ['network view', { network: true }],
    // Finding 9: the serving box is not (yet) known to hold THIS church — e.g. a delegated steward's console
    // on the helped church's box in the moment before it switches. Nothing is signed into the wrong list.
    ['box not known to hold this church', { hosts: null }], ['box holds a different church', { hosts: false }]]) {
    const a = autoEnrol({ ...opts, results: [OK] });
    assert.equal(await a.fn(), null, why + ': it did something');
    assert.equal(a.calls(), 0, why + ': enrolment was called');
  }
});

// ── 5. the wizard IN the wizard (second audit, finding 7) ───────────────────────────────────────────────
// Rendering WizAddRelay alone cannot see the wizard swapping it out. So the real StewSetupWizard is drawn,
// walked from its name step to the recovery-key step, and its "Running your own relay? Connect it" opened.
test('the setup wizard itself shows the relay-address box with its consent line', async () => {
  const { React, draw } = miniReact();
  const r = recorder({ isSelfHosted: () => false, exportMnemonic: () => 'one two three four five six seven eight nine ten eleven twelve', npub: 'npub1test' });
  const Steward = new Proxy(r.steward, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? (() => undefined) : undefined)) });
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, Steward };
  const globals = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { host: 'app.example', hostname: 'app.example' }, navigator: { userAgent: '', clipboard: { writeText: async () => {} } },
    document: { addEventListener() {}, removeEventListener() {} }, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; }, SkPill: function SkPill() { return null; }, SkBadge: function SkBadge() { return null; },
    useStewDialog: () => ({ current: null }),
    // Defined in app/stew-console.jsx, which the console loads beside this file.
    _wizMeetingId: () => 'evt' + Math.random().toString(36).slice(2), WizMeetings: function WizMeetings() { return null; },
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { StewSetupWizard };')(...names.map(k => globals[k]));
  const props = { church: { name: 'St Aidan’s', npub: 'npub1test' }, onDone() {}, onTab() {}, onSettings() {}, onInvite() {}, onNewPost() {} };
  const view = () => draw(mod.StewSetupWizard, props);
  view(); await settle();
  const cont = button(view(), 'Continue');
  assert.ok(cont.length >= 1, 're-anchor: the wizard\'s first step has no Continue');
  await cont[0].props.onClick();
  await settle(); await settle();
  const open = find(view(), n => n.type === 'button' && /Running your own relay\? Connect it/.test(said(n)));
  assert.equal(open.length, 1, 're-anchor: the recovery-key step no longer offers "Running your own relay? Connect it"');
  open[0].props.onClick();
  await settle();
  const box = find(view(), n => n.type === 'input' && n.props.placeholder === 'wss://relay.yourchurch.org');
  assert.equal(box.length, 1, 'THE WIZARD NO LONGER SHOWS ITS RELAY-ADDRESS BOX — the consent-guarded one was swapped out');
  box[0].props.onChange({ target: { value: 'wss://second.grace.example/relay' } });
  button(view(), 'Add')[0].props.onClick();
  await settle();
  assert.match(said(view()), CONSENT, 'the wizard\'s Add, in the wizard, showed no consent line');
  assert.equal(r.count('addRelay') + r.count('signRelay'), 0, 'the wizard added or signed before consent');
});

// ── 6. Steward.knownRelay, Remove un-signs, and one signing at a time — out of the shipped bundle ─────────
test('knownRelay answers only an address already in the relay panel (second audit, finding 6)', () => {
  const body = fnBody(VENDOR, '  knownRelay(input) {', 'knownRelay');
  const norm = fnBody(VENDOR, 'function normRelay(input) {', 'normRelay');
  const api = new Function('extraRelays', norm + '\nreturn ({ ' + body + ' });')(() => ['wss://second.grace.example/relay']);
  assert.equal(api.knownRelay('wss://second.grace.example/relay/'), 'wss://second.grace.example/relay',
    'AN ALREADY-LISTED RELAY WAS NOT RECOGNISED — "connect it again" is a dead end');
  assert.equal(api.knownRelay('second.grace.example/relay'), 'wss://second.grace.example/relay', 'a bare host was not normalised like addRelay does');
  assert.equal(api.knownRelay('wss://never-typed.example/relay'), '', 'knownRelay answered an address nobody typed');
  assert.equal(api.knownRelay(''), '');
});

test('Remove on the Relays card also takes the relay out of the church\'s signed list (owner decision B)', async () => {
  const { React, draw } = miniReact();
  const r = recorder({ removeRelay: (() => (u) => { r2.push(['removeRelay', u]); return true; })(), canRemoveRelay: () => true, relayName: () => '' });
  const r2 = r.log;
  const relays = [{ url: 'wss://relay.grace.example/relay', status: 'on' }, { url: 'wss://second.grace.example/relay', status: 'on' }];
  const win = {
    useStewardRelays: () => relays, useStewardChurch: () => ({ name: 'St Aidan’s' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Steward: { ownRelay: () => 'wss://relay.grace.example/relay', backupState: async () => ({ boxes: 2, online: 2, syncOn: true }), ...r.steward },
  };
  const globals = {
    React, window: win, localStorage: win.localStorage,
    location: { host: 'relay.grace.example', hostname: 'relay.grace.example' }, navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} }, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; }, SkPill: function SkPill() { return null; }, SkBadge: function SkBadge() { return null; },
    useStewDialog: () => ({ current: null }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { DashRelaysCard };')(...names.map(k => globals[k]));
  const view = () => draw(mod.DashRelaysCard, {});
  view(); await settle();
  const trash = find(view(), n => n.type === 'button' && n.props['aria-label'] === 'Remove relay');
  assert.ok(trash.length >= 1, 're-anchor: no Remove relay button on the Relays card');
  trash[trash.length - 1].props.onClick();
  await settle();
  const yes = find(view(), n => n.type === 'button' && n.props.title === 'Remove this relay');
  assert.equal(yes.length, 1, 're-anchor: the Remove confirmation is gone');
  await yes[0].props.onClick();
  await settle(); await settle();
  assert.deepEqual(r.log.filter(x => x[0] === 'unsignRelay').map(x => x[1]), ['wss://second.grace.example/relay'],
    'REMOVE LEFT THE RELAY IN THE CHURCH\'S SIGNED LIST — the steward\'s consent can never be withdrawn');
  assert.equal(r.count('removeRelay'), 1, 'the relay was not removed from the console');
});

test('one signing at a time: a steward\'s Connect waits for an automatic pass, so neither undoes the other (second audit, finding 1)', async () => {
  const body = fnBody(VENDOR, 'function enrolSerial(fn) {', 'enrolSerial');
  const enrolSerial = new Function('let _enrolQueue = Promise.resolve();\n' + body + '\nreturn enrolSerial;')();
  const order = [];
  let release; const held = new Promise(res => { release = res; });
  const auto = enrolSerial(async () => { order.push('auto:start'); await held; order.push('auto:end'); return 'a'; });
  const mine = enrolSerial(async () => { order.push('connect:start'); return 'c'; });
  await settle();
  assert.deepEqual(order, ['auto:start'], 'THE CONNECT STARTED WHILE THE AUTOMATIC PASS WAS STILL SIGNING — the later signature wins');
  release();
  assert.deepEqual([await auto, await mine], ['a', 'c']);
  assert.deepEqual(order, ['auto:start', 'auto:end', 'connect:start']);
  // a failing pass does not jam the queue
  const bad = enrolSerial(async () => { throw new Error('relay down'); });
  await assert.rejects(bad);
  assert.equal(await enrolSerial(async () => 'next'), 'next', 'one failed signing stopped every later one');
});

test('every signing path goes through the one queue (the automatic pass, Connect, and Remove)', () => {
  // Executed, not text-matched: each caller is lifted out of the shipped bundle and run with a queue that records.
  const seen = [];
  const enrolSerial = (fn) => { seen.push('queued'); return fn(); };
  const sign = fnBody(VENDOR, '  signRelay(url) {', 'signRelay');
  const unsign = fnBody(VENDOR, '  unsignRelay(url) {', 'unsignRelay');
  const norm = fnBody(VENDOR, 'function normRelay(input) {', 'normRelay');
  const api = new Function('enrolSerial', 'enrolRelayNet', 'unenrolRelayNet', norm + '\nreturn ({ ' + sign + ', ' + unsign + ' });')(
    enrolSerial, async () => 'signed', async () => 'unsigned');
  api.signRelay('wss://x.example/relay'); api.unsignRelay('wss://x.example/relay');
  assert.deepEqual(seen, ['queued', 'queued'], 'Connect or Remove signs outside the queue — it can overlap an automatic pass');
  const auto = autoEnrol({ results: [OK], queue: (fn) => { seen.push('auto-queued'); return fn(); } });
  return auto.fn().then(() => assert.ok(seen.includes('auto-queued'), 'the automatic pass signs outside the queue'));
});
