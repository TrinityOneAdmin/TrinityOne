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
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, stmt } from './test-slice.mjs';

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
      // Auto-find's visible list (owner decision 2, 2026-10-29) reads from listRelayOffers (ranked, `ms` each).
      listRelayOffers: rec('listRelayOffers', async () => [{ url: 'wss://open-a.example/relay', name: 'open-a', ms: 20 }, { url: 'wss://open-b.example/relay', name: 'open-b', ms: 40 }]),
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
  // Re-anchored 2026-10-29 (owner decision 2, the visible list): Auto-find now reads listRelayOffers and shows a
  // ranked, pre-ticked list; the steward taps "Connect selected" to reach the consent line, then "Yes, connect".
  // The properties under test are unchanged: it searches first and adds/signs NOTHING until consent, then
  // connects and signs EXACTLY the relays named on the consent line, and never searches again after consent.
  const r = recorder();
  const card = addCard(r.steward);
  card.draw(); await settle();
  const go = button(card.draw(), 'Auto-find relays for me');
  assert.equal(go.length, 1, 're-anchor: the Auto-find button is gone');
  go[0].props.onClick();
  await settle(); await settle();
  // The list names what it found (fastest first) and the search alone has run — nothing added, connected or signed.
  let tree = card.draw();
  assert.match(said(tree), /open-a\.example/, 'the found list does not name the relays Auto-find found');
  assert.match(said(tree), /open-b\.example/, 'the found list does not name every relay Auto-find found');
  assert.deepEqual(r.log.map(x => x[0]), ['listRelayOffers'], 'Auto-find added, connected or signed before the list was even shown: ' + JSON.stringify(r.log.map(x => x[0])));
  // The two fastest are pre-ticked; "Connect selected" opens the consent line, which still adds/signs nothing.
  const connect = button(tree, 'Connect selected');
  assert.equal(connect.length, 1, 're-anchor: the "Connect selected" button is gone');
  connect[0].props.onClick();
  await settle();
  tree = card.draw();
  assert.match(said(tree), /Connecting these relays lets your whole church’s data go to them\./, 'Auto-find showed no consent line');
  assert.match(said(tree), /open-a\.example/, 'the consent line does not name the relays it will connect');
  assert.match(said(tree), /open-b\.example/, 'the consent line does not name every relay it will connect');
  assert.match(said(tree), /run by other people/, 'the consent line does not say these relays are run by other people');
  assert.deepEqual(r.log.map(x => x[0]), ['listRelayOffers'], 'Auto-find connected or signed before the steward consented: ' + JSON.stringify(r.log.map(x => x[0])));
  await consentYes(tree)[0].props.onClick();
  await settle(); await settle();
  assert.deepEqual(r.log.filter(x => x[0] === 'connectFoundRelays').map(x => x[1].map(p => p.url)),
    [['wss://open-a.example/relay', 'wss://open-b.example/relay']], 'Auto-find did not connect exactly the relays it named');
  assert.equal(r.count('listRelayOffers'), 1, 'Auto-find searched again after consent — what was agreed to may not be what is connected');
  assert.deepEqual(r.log.filter(x => x[0] === 'signRelay').map(x => x[1]), ['wss://open-a.example/relay', 'wss://open-b.example/relay'],
    'the relays Auto-find connected after consent were not signed');
});

test('a signing that did not put the relay in the list is never reported as done (second audit, findings 6 and 8)', async () => {
  for (const [why, result, re] of [
    ['skipped (not this church\'s own console)', { skipped: 'x', proven: [], entries: [] }, /Only your church’s own console/],
    ['unknown (a relay is not answering)', { unknown: true, proven: [], entries: [] }, /could not be read in full/],
    ['proven but not in the signed list', { proven: [{ url: 'wss://second.grace.example/relay', pubkey: 'b'.repeat(64) }], entries: [] }, /Couldn’t put it in your church’s relay list/],
    // Sixth audit, finding 5: the list found names it, but on a partial read — the wizard must not say "✓ Added".
    ['in a list found on a partial read', { full: false, proven: [{ url: 'wss://second.grace.example/relay', pubkey: 'b'.repeat(64) }], entries: [{ pubkey: 'b'.repeat(64) }] }, /can’t be confirmed in the list yet/],
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
function autoEnrol({ cands = ['ws://127.0.0.1:9/relay'], acting = '', network = false, hosts = true, shared = [], results, queue = null, self = { url: '', name: '' } }) {
  const body = fnBody(VENDOR, 'async function autoEnrolRelayNet()', 'autoEnrolRelayNet');
  let n = 0; const args = [];
  const fn = new Function('sk', 'pub', 'actingChurch', '_viewingNetwork', 'relayNetCandidates', 'enrolRelayNet', '_autoEnrolled',
    '_boxHostsUs', 'sharedRelayKeys', 'enrolSerial', 'selfPublicRelay', 'selfRelayName',
    body + '\nreturn autoEnrolRelayNet;')(
    'sk', 'a'.repeat(64), acting, () => network, () => cands.slice(),
    async (o) => { args.push(o); const r = results[Math.min(n, results.length - 1)]; n++; if (r instanceof Error) throw r; return r; }, new Set(),
    hosts, () => shared, queue || ((f) => f()), () => self.url, () => self.name);
  return { fn, calls: () => n, args };
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

test('B2: a tunnel restart or a new relay name runs the pass again on the same page (PR #7 audit, M-2)', async () => {
  // On a Suite box the own address is loopback and never changes; the public address it is signed under does,
  // on every quick-tunnel restart. Remembered by box alone, a pass that worked once never ran again, so the
  // church's list kept the dead tunnel address until the page was reloaded.
  const self = { url: 'wss://alpha.trycloudflare.com/relay', name: 'grace' };
  const a = autoEnrol({ results: [OK], self });
  await a.fn(); await a.fn();
  assert.equal(a.calls(), 1, 'staging: a pass that worked re-ran with nothing changed');
  self.url = 'wss://beta.trycloudflare.com/relay';
  await a.fn(); await a.fn();
  assert.equal(a.calls(), 2, 'THE TUNNEL MOVED AND NOTHING RE-SIGNED — the church\'s list keeps the dead address until reload');
  self.name = 'grace-city';
  await a.fn();
  assert.equal(a.calls(), 3, 'the relay name changed and nothing re-signed');
});

test('B2: the dashboard runs the pass when the tunnel address or relay name changes (\'steward-relays\')', async () => {
  let calls = 0;
  const e = runOwnRelayEffect({ autoEnrolRelayNet: async () => { calls++; return null; } });
  e.fire('steward-relays');
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 1, 'the console does not react to its own tunnel address changing — the list follows only a reload');
  e.cleanup();
  e.fire('steward-relays');
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 1, 'the steward-relays listener outlives the effect');
});

test('both setters that change what is signed tell the console (\'steward-relays\')', () => {
  // Lifted and RUN, not text-matched: each setter, given a new value, must dispatch the event the dashboard
  // listens for. setSelfPublicRelay already did; setSelfRelayName did not.
  const src = fnBody(VENDOR, 'function setSelfRelayName', 'setSelfRelayName') + '\n'
    + fnBody(VENDOR, 'function selfRelayName', 'selfRelayName') + '\n'
    + fnBody(VENDOR, 'function setSelfPublicRelay', 'setSelfPublicRelay') + '\n';
  const ls = new Map(); const seen = [];
  const f = new Function('lsGet', 'lsSet', 'SELF_NAME_LS', 'SELF_PUB_LS', 'normRelay', 'window', 'CustomEvent',
    src + '\nreturn { setSelfRelayName, setSelfPublicRelay };')(
    (k) => (ls.has(k) ? ls.get(k) : null), (k, v) => ls.set(k, v), 'n', 'p', (u) => String(u || ''),
    { dispatchEvent: (e) => seen.push(e.type) }, class { constructor(t) { this.type = t; } });
  f.setSelfRelayName('grace'); f.setSelfRelayName('grace');
  assert.deepEqual(seen, ['steward-relays'], 'a new relay name was not announced, or an unchanged one was');
  f.setSelfPublicRelay('wss://beta.trycloudflare.com/relay');
  assert.deepEqual(seen, ['steward-relays', 'steward-relays'], 'a new tunnel address was not announced');
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

// ── 7. the third audit round (2026-10-21) ───────────────────────────────────────────────────────────────
test('only the automatic pass asks for the own-box exception; Connect and the exported call never can (third audit, findings 1 and 8)', async () => {
  const auto = autoEnrol({ results: [OK] });
  await auto.fn();
  assert.deepEqual(auto.args, [{ auto: true }],
    'THE AUTOMATIC PASS DOES NOT ASK AS THE AUTOMATIC PASS — a Suite whose shared relays are unreachable never signs its own box');
  const asked = [];
  const sign = fnBody(VENDOR, '  signRelay(url) {', 'signRelay');
  const norm = fnBody(VENDOR, 'function normRelay(input) {', 'normRelay');
  const line = VENDOR.split('\n').find(l => /^\s*enrolRelayNet: \(opts\) => /.test(l));
  assert.ok(line, 're-anchor: Steward.enrolRelayNet is no longer the queued arrow');
  const queued = [];
  const api = new Function('enrolSerial', 'enrolRelayNet', 'unenrolRelayNet', norm + '\nreturn ({ ' + sign + ', ' + line.trim().replace(/,$/, '') + ' });')(
    (fn) => { queued.push(1); return fn(); }, async (o) => { asked.push(o); return {}; }, async () => ({}));
  await api.signRelay('wss://typed.example/relay');
  await api.enrolRelayNet({ auto: true, extra: ['wss://x.example/relay'] });
  await api.enrolRelayNet();
  assert.equal(queued.length, 3, 'Steward.enrolRelayNet signs outside the one queue');
  assert.ok(asked.every(o => !o || o.auto !== true), 'a steward\'s Connect or the exported call reached the own-box exception: ' + JSON.stringify(asked));
  assert.deepEqual(asked[0].extra, ['wss://typed.example/relay'], 'Connect no longer names the relay it signs');
});

test('the outcome lines say only what is true (third audit, findings 2 and 8)', async () => {
  const T = 'wss://second.grace.example/relay';
  for (const [why, result, want, never] of [
    ['unknown', { unknown: true, proven: [], entries: [] }, /Connect it again once your relays are answering/, /automatically/],
    ['the console switched church mid-signing', { unknown: true, changed: true, proven: [], entries: [] }, /switched church/, /Only your church’s own console|could not be read in full/],
    ['a shared relay', { proven: [{ url: T, pubkey: 'b'.repeat(64), shared: true }], entries: [] }, /shared relays/, /Try again/],
    // Fifth audit, finding 3: the list found names the relay, but not every relay answered, so it may be a stale copy.
    // Its "never" is what THIS card would wrongly say. "✓ Added" is checked where it can appear — the setup wizard
    // and Auto-find (sixth audit, finding 5: this card never shows "✓ Added", so checking for it here could not fail).
    ['a list found on a partial read', { full: false, proven: [{ url: T, pubkey: 'c'.repeat(64) }], entries: [{ pubkey: 'c'.repeat(64) }] }, /can’t be confirmed in the list yet/, /Try again\.|could not prove/],
  ]) {
    const r = recorder({ signRelay: async () => result });
    const card = addCard(r.steward);
    card.draw(); await settle();
    find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add')[0].props.onChange({ target: { value: T } });
    button(card.draw(), 'Add relay')[0].props.onClick();
    await settle();
    await consentYes(card.draw())[0].props.onClick();
    await settle(); await settle();
    const all = said(card.draw());
    assert.match(all, want, why + ': the card did not say ' + want);
    assert.doesNotMatch(all, never, why + ': the card said something untrue: ' + all);
  }
});

function relaysCard(steward, removed = []) {
  const { React, draw } = miniReact();
  const relays = [{ url: 'wss://relay.grace.example/relay', status: 'on' }, { url: 'wss://second.grace.example/relay', status: 'on' }];
  const win = {
    useStewardRelays: () => relays.slice(), useStewardChurch: () => ({ name: 'St Aidan’s' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Steward: { ownRelay: () => 'wss://relay.grace.example/relay', backupState: async () => ({ boxes: 2, online: 2, syncOn: true }),
      // Round 6: removeRelay really takes the row out of the panel's list, so a row can be seen to LEAVE THE SCREEN.
      removeRelay: (u) => { removed.push(1); const i = relays.findIndex(x => x.url === u); if (i >= 0) relays.splice(i, 1); return true; },
      canRemoveRelay: () => true, relayName: () => '', ...steward },
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
  return () => draw(mod.DashRelaysCard, {});
}
async function removeSecond(view) {
  view(); await settle();
  const trash = find(view(), n => n.type === 'button' && n.props['aria-label'] === 'Remove relay');
  assert.ok(trash.length >= 1, 're-anchor: no Remove relay button on the Relays card');
  trash[trash.length - 1].props.onClick();
  await settle();
  await find(view(), n => n.type === 'button' && n.props.title === 'Remove this relay')[0].props.onClick();
  await settle(); await settle();
  // One draw for the card to see the row has left its list (and end "Removing…"), one to show what it says then.
  view(); await settle();
  return said(view());
}

test('Remove says so whenever the relay could not be taken out of the church\'s list, and keeps the row (third and fourth audits, findings 3 and 2)', async () => {
  const WARN = /could not be updated right now|Couldn’t take|switched church|Only your church’s own console can take it out|is the box this console runs on/;
  // keep: the church's list may still name it, so the row stays on screen for the steward to try again.
  for (const [why, unsign, want, keep, never] of [
    ['the write failed', async () => ({ removed: false, entries: [] }), /could not be updated right now/, true, /gone for good/],
    ['it threw (no church key on this device)', async () => { throw new Error('No church key on this device'); }, /Couldn’t take .* out of your church’s relay list \(No church key on this device\)/, true],
    // Fifth audit, finding 1: unknown now means ANOTHER relay is silent, so the steward is told the way out.
    ['unknown (a relay is not answering)', async () => ({ removed: false, unknown: true }), /could not be updated right now.*If a relay you added is gone for good, remove it first/, true],
    // Fifth audit, finding 2: the list was read and does not name it, so it leaves the screen, and the note says why.
    ['not listed, and its key could not be proved', async () => ({ removed: false, notListed: true, proven: false }), /Removed from this console\. Your church’s relay list doesn’t name wss:\/\/second\.grace\.example\/relay\./, false, /could not be updated right now|Remove it again/],
    ['the console switched church mid-removal', async () => ({ removed: false, unknown: true, changed: true }), /switched church while removing/, true],
    ['a delegated console', async () => ({ removed: false, skipped: 'x' }), /Only your church’s own console can take it out/, false],
    ['the box this console runs on', async () => ({ removed: false, ownBox: true }), /is the box this console runs on/, false],
  ]) {
    const removed = [];
    const view = relaysCard({ unsignRelay: unsign }, removed);
    const text = await removeSecond(view);
    if (never) assert.doesNotMatch(text, never, why + ': the card said something that does not apply here: ' + text);
    // THE ROW ITSELF, on the rendered card: still there (its Remove button with it) when kept, gone when not.
    const trashLeft = find(view(), n => n.type === 'button' && n.props['aria-label'] === 'Remove relay').length;
    assert.equal(trashLeft, keep ? 1 : 0, why + (keep ? ': the row left the screen' : ': THE ROW IS STILL ON THE SCREEN — the steward can never get rid of it'));
    assert.match(text, want, why + ': REMOVE WAS SILENT — the steward believes their consent withdrawn when the church\'s list still names it');
    assert.equal(removed.length, keep ? 0 : 1, why + (keep
      ? ': THE ROW WAS REMOVED ANYWAY — "remove it again" with nothing left to remove, and adding it back signs it in again'
      : ': the row stayed although nothing more can be done from here'));
  }
  for (const [why, unsign] of [
    ['removed', async () => ({ removed: true, entries: [] })],
    ['never in the list (key proved)', async () => ({ removed: false, notListed: true, proven: true })],
  ]) {
    const removed = [];
    const text = await removeSecond(relaysCard({ unsignRelay: unsign }, removed));
    assert.doesNotMatch(text, WARN, why + ': a warning was shown over a removal that worked');
    assert.equal(removed.length, 1, why + ': the row was not removed');
  }
});

test('Remove ignores a second tap while removing, and says so in the neutral colour (fifth audit, finding 7)', async () => {
  let calls = 0, release;
  const held = new Promise(r => { release = r; });
  const removed = [];
  const view = relaysCard({ unsignRelay: () => { calls++; return held; } }, removed);
  view(); await settle();
  find(view(), n => n.type === 'button' && n.props['aria-label'] === 'Remove relay')[0].props.onClick(); await settle();
  const confirm = find(view(), n => n.type === 'button' && n.props.title === 'Remove this relay')[0];
  confirm.props.onClick(); await settle();   // not awaited: it is held
  const note = () => find(view(), n => n.type === 'div' && n.props.role === 'status')[0];
  assert.equal(calls, 1, 're-anchor: the first tap did not start a removal');
  assert.ok(note(), 'nothing on the card says a removal is under way');
  assert.match(texts(note()).join(''), /Removing wss:\/\/second\.grace\.example\/relay…/, 'the in-progress line is not shown');
  assert.equal(note().props.style.color, 'var(--ink-3)', '"Removing…" IS SHOWN IN THE WARNING COLOUR — it is progress, not a fault');
  // Seventh audit, finding 4: the row being removed offers no Remove of its own while it is removed.
  assert.equal(find(view(), n => n.type === 'button' && n.props['aria-label'] === 'Remove relay').length, 0,
    'THE ROW BEING REMOVED STILL OFFERS REMOVE — it can be tapped again mid-removal');
  // A second tap reaching dropRelay anyway (the confirm button of a render drawn before the first tap took hold).
  confirm.props.onClick(); await settle();
  assert.equal(calls, 1, 'A SECOND TAP WHILE REMOVING STARTED A SECOND REMOVAL — two signings of the church\'s list for one intent');
  release({ removed: false, unknown: true });
  await settle(); await settle(); view(); await settle();
  assert.equal(note().props.style.color, 'var(--clay-ink)', 'the outcome of a failed removal is not shown as a warning');
  assert.doesNotMatch(texts(note()).join(''), /Removing/, 'the in-progress line stayed after the removal finished');
});

test('two relays removed at once are each guarded, and a row stays "Removing…" until it has really gone (seventh audit, findings 2 and 4)', async () => {
  const { React, draw } = miniReact();
  const A = 'wss://second.grace.example/relay', B = 'wss://third.grace.example/relay';
  const relays = [{ url: 'wss://relay.grace.example/relay', status: 'on' }, { url: A, status: 'on' }, { url: B, status: 'on' }];
  const calls = [], gate = {}, removedFromConsole = [];
  const win = {
    useStewardRelays: () => relays.slice(), useStewardChurch: () => ({ name: 'St Aidan’s' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Steward: { ownRelay: () => 'wss://relay.grace.example/relay', backupState: async () => ({ boxes: 3, online: 3, syncOn: true }),
      // The REAL removeRelay drops the row only later (the panel re-reads its list): here it records the call and
      // leaves the row exactly where it is until the test takes it out.
      removeRelay: (u) => { removedFromConsole.push(u); return true; }, canRemoveRelay: () => true, relayName: () => '',
      unsignRelay: (u) => { calls.push(u); return new Promise(r => { gate[u] = r; }); } },
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
  const trashOf = (i) => find(view(), n => n.type === 'button' && n.props['aria-label'] === 'Remove relay')[i];
  view(); await settle();
  // Remove A, keeping its confirm button; then Remove B while A is still in flight.
  trashOf(0).props.onClick(); await settle();
  const confirmA = find(view(), n => n.type === 'button' && n.props.title === 'Remove this relay')[0];
  confirmA.props.onClick(); await settle();
  trashOf(0).props.onClick(); await settle();      // A's bin is gone, so the only bin left is B's
  find(view(), n => n.type === 'button' && n.props.title === 'Remove this relay')[0].props.onClick(); await settle();
  assert.deepEqual(calls, [A, B], 're-anchor: the two removals did not both start');
  // A second Remove of A (from the render drawn before), while B is the LAST one started.
  confirmA.props.onClick(); await settle();
  assert.deepEqual(calls, [A, B], 'A RELAY ALREADY BEING REMOVED WAS REMOVED AGAIN — the guard only remembered the last relay');
  assert.match(said(view()), /Removing wss:\/\/second\.grace\.example\/relay, wss:\/\/third\.grace\.example\/relay…/, 'the in-progress line does not name both removals');
  // A's removal finishes: taken off this console — but its row has not left the list yet.
  gate[A]({ removed: true, entries: [] }); await settle(); await settle(); view(); await settle();
  assert.deepEqual(removedFromConsole, [A], 're-anchor: A was not taken off this console');
  assert.equal(find(view(), n => n.type === 'button' && n.props['aria-label'] === 'Remove relay').length, 0,
    'A ROW THAT IS LEAVING OFFERS REMOVE AGAIN before it has gone');
  assert.match(said(view()), /Removing wss:\/\/second\.grace\.example\/relay/, '"Removing…" ended before the row had gone');
  // The row leaves the list: only now does A stop being "Removing…".
  relays.splice(relays.findIndex(x => x.url === A), 1);
  view(); await settle(); view(); await settle();
  assert.doesNotMatch(said(view()), /Removing wss:\/\/second/, '"Removing…" stayed after the row had gone');
  assert.match(said(view()), /Removing wss:\/\/third\.grace\.example\/relay…/, 'B, still in flight, stopped saying so');
  gate[B]({ removed: false, unknown: true }); await settle(); await settle(); view(); await settle();
  assert.equal(find(view(), n => n.type === 'button' && n.props['aria-label'] === 'Remove relay').length, 1, 'B, kept, has no Remove to try again');
});

test('the 10-second fallback frees a row that never leaves, and only its OWN removal (eighth audit, finding 3)', async () => {
  const { React, draw } = miniReact();
  const A = 'wss://second.grace.example/relay';
  const relays = [{ url: 'wss://relay.grace.example/relay', status: 'on' }, { url: A, status: 'on' }];
  const timers = [];   // the card's 10 s fallbacks, fired by the test; any other timer runs for real
  const fakeSetTimeout = (fn, ms, ...a) => (ms === 10000 ? (timers.push(fn), timers.length) : setTimeout(fn, ms, ...a));
  let calls = 0;
  const win = {
    useStewardRelays: () => relays.slice(), useStewardChurch: () => ({ name: 'St Aidan’s' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Steward: { ownRelay: () => 'wss://relay.grace.example/relay', backupState: async () => ({ boxes: 2, online: 2, syncOn: true }),
      // Taken off the console, but the row does not leave the list (the case the fallback exists for).
      removeRelay: () => true, canRemoveRelay: () => true, relayName: () => '',
      unsignRelay: async () => { calls++; return { removed: true, entries: [] }; } },
  };
  const globals = {
    React, window: win, localStorage: win.localStorage,
    location: { host: 'relay.grace.example', hostname: 'relay.grace.example' }, navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} }, setTimeout: fakeSetTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; }, SkPill: function SkPill() { return null; }, SkBadge: function SkBadge() { return null; },
    useStewDialog: () => ({ current: null }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { DashRelaysCard };')(...names.map(k => globals[k]));
  const view = () => draw(mod.DashRelaysCard, {});
  const bins = () => find(view(), n => n.type === 'button' && n.props['aria-label'] === 'Remove relay').length;
  const removeA = async () => {
    find(view(), n => n.type === 'button' && n.props['aria-label'] === 'Remove relay')[0].props.onClick(); await settle();
    await find(view(), n => n.type === 'button' && n.props.title === 'Remove this relay')[0].props.onClick();
    await settle(); view(); await settle();
  };
  view(); await settle();
  // 1. A row that never leaves: "Removing…" until its fallback fires, then free again.
  await removeA();
  assert.equal(calls, 1);
  assert.equal(timers.length, 1, 're-anchor: no 10-second fallback was set for a row that has not left');
  assert.equal(bins(), 0, 're-anchor: the leaving row offers Remove before it has gone');
  timers[0](); view(); await settle();
  assert.equal(bins(), 1, 'THE FALLBACK DID NOT FREE THE ROW — a row that never leaves is stuck in "Removing…" for ever');
  assert.doesNotMatch(said(view()), /Removing/, 'the in-progress line stayed after the fallback');
  // 2. Removed again: the OLD timer must not free the NEW removal.
  await removeA();
  assert.equal(calls, 2, 're-anchor: the second removal did not start');
  assert.equal(timers.length, 2);
  timers[0](); view(); await settle();
  assert.equal(bins(), 0, 'A STALE 10-SECOND TIMER FREED A NEWER REMOVAL — the row can be tapped mid-removal again');
  assert.match(said(view()), /Removing wss:\/\/second\.grace\.example\/relay/, 'a stale timer ended the newer removal\'s "Removing…"');
  timers[1](); view(); await settle();
  assert.equal(bins(), 1, 'the newer removal\'s own fallback did not free it');
});

// ── round 9: one relay, one row ────────────────────────────────────────────────────────────────────────────
// The SHIPPED Add guard, out of vendor/steward.js: Steward.isSharedRelaySpelling and Steward.addRelay, with the
// helpers they call (the bundle's own normalizeURL copy among them) — never a second opinion written here.
function shippedAdd() {
  const stored = [];
  const lib = [
    fnBody(VENDOR, 'function normalizeURL2(url) {', 'normalizeURL2'),
    stmt(VENDOR, 'var SHARED_RELAY_KEYS = ', 'SHARED_RELAY_KEYS'),
    stmt(VENDOR, 'var SHARED_RELAY_HINTS = ', 'SHARED_RELAY_HINTS'),
    stmt(VENDOR, 'var CANONICAL_RELAY_PUBS = ', 'CANONICAL_RELAY_PUBS'),
    stmt(VENDOR, 'var CANONICAL_RELAYS = ', 'CANONICAL_RELAYS'),
    fnBody(VENDOR, 'function relayAddrKey', 'relayAddrKey'),
    fnBody(VENDOR, 'function _relayKey', '_relayKey'),
    fnBody(VENDOR, 'function isSharedAddress', 'isSharedAddress'),
    fnBody(VENDOR, 'function normRelay(input) {', 'normRelay'),
    fnBody(VENDOR, 'function isSharedRelaySpelling(u) {', 'isSharedRelaySpelling'),
    fnBody(VENDOR, 'function isOwnRelaySpelling(u) {', 'isOwnRelaySpelling'),
    // RELAY-ADDRESS-GOSSIP, 2026-10-23: addRelay also clears a recorded removal, so a steward who adds back
    // an address they removed is not fighting the church's signed list. The REAL functions, not stubs.
    fnBody(VENDOR, 'function lsGet', 'lsGet'),
    stmt(VENDOR, 'var DECLINED_LS = ', 'DECLINED_LS'),
    stmt(VENDOR, 'var DECLINED_MAX = ', 'DECLINED_MAX'),
    fnBody(VENDOR, 'function declinedRelays', 'declinedRelays'),
    fnBody(VENDOR, 'function setDeclinedRelays', 'setDeclinedRelays'),
    stmt(VENDOR, 'var _declineKey = ', '_declineKey'),
    fnBody(VENDOR, 'function undeclineRelay', 'undeclineRelay'),
  ].join('\n');
  const methods = fnBody(VENDOR, '  isSharedRelaySpelling(input) {', 'Steward.isSharedRelaySpelling') + ',\n' + fnBody(VENDOR, '  isOwnRelaySpelling(input) {', 'Steward.isOwnRelaySpelling') + ',\n' + fnBody(VENDOR, '  addRelay(input) {', 'Steward.addRelay');
  const kv = { extra: JSON.stringify(stored) };
  const api = new Function('extraRelays', 'lsSet', 'RELAYS_LS', 'ownRelay', 'window', 'CustomEvent', 'localStorage', 'normalizeURL',
    lib + '\nreturn ({ ' + methods + ' });')(
    () => stored.slice(),
    (k, v) => { kv[k] = v; if (k === 'extra') { stored.length = 0; stored.push(...JSON.parse(v)); } },
    'extra', () => 'wss://relay.grace.example/relay',
    { dispatchEvent() { return true; } }, class { constructor(t) { this.type = t; } },
    { getItem: (k) => (k in kv ? kv[k] : null), setItem: (k, v) => { kv[k] = String(v); }, removeItem: (k) => { delete kv[k]; } },
    normalizeURL);
  return { api, stored };
}
const SHARED_SPELLINGS = ['wss://APP.TrinityOne.church/relay', 'wss://app.trinityone.church:443/relay', 'ws://app.trinityone.church/relay',
  'wss://app.trinityone.church//relay', 'wss://app.trinityone.church/relay/', 'wss://app.trinityone.church/relay',
  'ws://trinityone-master-01.tailbeaac0.ts.net/relay'];

test('Add refuses every spelling of a TrinityOne relay, on the card and in the wizard, and says why (ninth audit)', async () => {
  const ALREADY = /That’s already one of TrinityOne’s relays\./;
  for (const u of SHARED_SPELLINGS) {
    // The engine, which every Add path writes through (Connect by name and Auto-find's connectFoundRelays included).
    const eng = shippedAdd();
    assert.equal(eng.api.addRelay(u), false, u + ': THE SHIPPED addRelay STORED A SECOND SPELLING OF A SHARED RELAY');
    assert.deepEqual(eng.stored, [], u + ': something was written to the relay list');
    // The card.
    const s1 = shippedAdd(); const r1 = recorder({ isSharedRelaySpelling: s1.api.isSharedRelaySpelling, addRelay: (x) => s1.api.addRelay(x) });
    const card = addCard(r1.steward);
    card.draw(); await settle();
    find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add')[0].props.onChange({ target: { value: u } });
    button(card.draw(), 'Add relay')[0].props.onClick();
    await settle(); await settle();
    const t1 = said(card.draw());
    assert.match(t1, ALREADY, u + ': the Add-a-relay card did not say it is already one of TrinityOne’s relays: ' + t1);
    assert.equal(consentYes(card.draw()).length, 0, u + ': the consent line was offered for a shared relay');
    assert.deepEqual(s1.stored, [], u + ': the card stored it');
    assert.equal(r1.count('signRelay'), 0, u + ': the card signed it');
    // The setup wizard.
    const s2 = shippedAdd(); const r2 = recorder({ isSharedRelaySpelling: s2.api.isSharedRelaySpelling, addRelay: (x) => s2.api.addRelay(x) });
    const box = wizBox(r2.steward);
    box.draw(); await settle();
    find(box.draw(), n => n.type === 'input' && n.props.placeholder === 'wss://relay.yourchurch.org')[0].props.onChange({ target: { value: u } });
    button(box.draw(), 'Add')[0].props.onClick();
    await settle(); await settle();
    assert.match(said(box.draw()), ALREADY, u + ': the wizard did not say it is already one of TrinityOne’s relays');
    assert.equal(consentYes(box.draw()).length, 0, u + ': the wizard offered the consent line for a shared relay');
    assert.deepEqual(s2.stored, [], u + ': the wizard stored it');
    assert.equal(r2.count('signRelay'), 0, u + ': the wizard signed it');
  }
  // CONTROL: an ordinary relay is still added (after consent) and signed, through the same shipped guard.
  const s3 = shippedAdd(); const r3 = recorder({ isSharedRelaySpelling: s3.api.isSharedRelaySpelling, addRelay: (x) => s3.api.addRelay(x) });
  const card = addCard(r3.steward);
  card.draw(); await settle();
  find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add')[0].props.onChange({ target: { value: 'wss://friend.example/relay' } });
  button(card.draw(), 'Add relay')[0].props.onClick();
  await settle();
  await consentYes(card.draw())[0].props.onClick();
  await settle(); await settle();
  assert.deepEqual(s3.stored, ['wss://friend.example/relay'], 'AN ORDINARY RELAY COULD NOT BE ADDED — the guard refuses everything');
  assert.equal(r3.count('signRelay'), 1, 'an ordinary relay was not signed after consent');
  assert.doesNotMatch(said(card.draw()), ALREADY);
});

test('Add refuses this console\'s OWN relay, however it is spelled, before the consent line, and says why (phone test 2026-10-22)', async () => {
  // shippedAdd's console runs on wss://relay.grace.example/relay. On the phone, typing the own box's address showed
  // the consent line, then "Enter a relay address, e.g. wss://…" — which explains nothing.
  const OWN_SAID = /That’s this console’s own relay — it’s already on your list\./;
  const OWN_SPELLINGS = ['wss://relay.grace.example/relay', 'wss://Relay.Grace.Example/relay', 'wss://relay.grace.example:443/relay',
    'wss://relay.grace.example/relay/', 'ws://relay.grace.example/relay', 'wss://relay.grace.example//relay', 'relay.grace.example/relay'];
  for (const u of OWN_SPELLINGS) {
    const eng = shippedAdd();
    assert.equal(eng.api.addRelay(u), false, u + ': the shipped addRelay stored the console\'s own relay');
    const s1 = shippedAdd(); const r1 = recorder({ isSharedRelaySpelling: s1.api.isSharedRelaySpelling, isOwnRelaySpelling: s1.api.isOwnRelaySpelling, addRelay: (x) => s1.api.addRelay(x) });
    const card = addCard(r1.steward);
    card.draw(); await settle();
    find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add')[0].props.onChange({ target: { value: u } });
    button(card.draw(), 'Add relay')[0].props.onClick();
    await settle(); await settle();
    const t = said(card.draw());
    assert.match(t, OWN_SAID, u + ': THE CARD DID NOT SAY IT IS THIS CONSOLE\'S OWN RELAY: ' + t);
    assert.doesNotMatch(t, /Enter a relay address/, u + ': the card answered a typed address with "Enter a relay address"');
    assert.equal(consentYes(card.draw()).length, 0, u + ': THE CONSENT LINE WAS OFFERED FOR THE CONSOLE\'S OWN RELAY');
    assert.deepEqual(s1.stored, [], u + ': stored'); assert.equal(r1.count('signRelay'), 0, u + ': signed');
    const s2 = shippedAdd(); const r2 = recorder({ isSharedRelaySpelling: s2.api.isSharedRelaySpelling, isOwnRelaySpelling: s2.api.isOwnRelaySpelling, addRelay: (x) => s2.api.addRelay(x) });
    const box = wizBox(r2.steward);
    box.draw(); await settle();
    find(box.draw(), n => n.type === 'input' && n.props.placeholder === 'wss://relay.yourchurch.org')[0].props.onChange({ target: { value: u } });
    button(box.draw(), 'Add')[0].props.onClick();
    await settle(); await settle();
    assert.match(said(box.draw()), OWN_SAID, u + ': the wizard did not say it is this console\'s own relay');
    assert.equal(consentYes(box.draw()).length, 0, u + ': the wizard offered consent for the console\'s own relay');
  }
  // Connect by name leading to the own relay, and an Auto-find pick of it: neither is offered.
  const s3 = shippedAdd();
  const r3 = recorder({ isSharedRelaySpelling: s3.api.isSharedRelaySpelling, isOwnRelaySpelling: s3.api.isOwnRelaySpelling, addRelay: (x) => s3.api.addRelay(x),
    resolveRelayName: async () => ({ url: 'wss://RELAY.grace.example:443/relay/' }),
    findRelays: async () => [{ url: 'wss://relay.grace.example//relay', name: 'ourselves' }] });
  const card = addCard(r3.steward);
  card.draw(); await settle();
  find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay name to connect to')[0].props.onChange({ target: { value: 'grace-city' } });
  button(card.draw(), 'Connect').filter(b => b.props['aria-label'] === 'Connect to relay by name')[0].props.onClick();
  await settle(); await settle(); await settle();
  assert.match(said(card.draw()), OWN_SAID, 'Connect by name did not say the name leads to this console\'s own relay');
  assert.equal(consentYes(card.draw()).length, 0, 'Connect by name offered consent for the console\'s own relay');
  button(card.draw(), 'Auto-find relays for me')[0].props.onClick();
  await settle(); await settle();
  assert.equal(consentYes(card.draw()).length, 0, 'AUTO-FIND OFFERED THIS CONSOLE\'S OWN RELAY');
  // CONTROL: an ordinary relay still adds, after consent, and is signed.
  const s4 = shippedAdd(); const r4 = recorder({ isSharedRelaySpelling: s4.api.isSharedRelaySpelling, isOwnRelaySpelling: s4.api.isOwnRelaySpelling, addRelay: (x) => s4.api.addRelay(x) });
  const c4 = addCard(r4.steward);
  c4.draw(); await settle();
  find(c4.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add')[0].props.onChange({ target: { value: 'wss://friend.example/relay' } });
  button(c4.draw(), 'Add relay')[0].props.onClick();
  await settle();
  await consentYes(c4.draw())[0].props.onClick();
  await settle(); await settle();
  assert.deepEqual(s4.stored, ['wss://friend.example/relay'], 'AN ORDINARY RELAY COULD NOT BE ADDED — the own-relay check refuses everything');
  assert.equal(r4.count('signRelay'), 1);
});

test('a typed address that cannot be added is never answered "Enter a relay address" (phone test 2026-10-22)', async () => {
  const r = recorder({ addRelay: () => false, knownRelay: () => '' });
  const card = addCard(r.steward);
  card.draw(); await settle();
  find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add')[0].props.onChange({ target: { value: 'wss://friend.example/relay' } });
  button(card.draw(), 'Add relay')[0].props.onClick();
  await settle();
  await consentYes(card.draw())[0].props.onClick();
  await settle(); await settle();
  const t = said(card.draw());
  assert.doesNotMatch(t, /Enter a relay address/, 'A NON-EMPTY ADDRESS THAT COULD NOT BE ADDED WAS ANSWERED "Enter a relay address": ' + t);
  assert.match(t, /Couldn’t add wss:\/\/friend\.example\/relay/, 'the card did not say which address could not be added');
});

test('Connect by name and Auto-find add no spelling of a TrinityOne relay (ninth audit)', async () => {
  const s = shippedAdd();
  const r = recorder({ isSharedRelaySpelling: s.api.isSharedRelaySpelling, addRelay: (x) => s.api.addRelay(x),
    resolveRelayName: async () => ({ url: 'wss://APP.trinityone.church:443/relay' }),
    // Auto-find reads listRelayOffers now; put a shared-relay spelling in its output so the card's
    // isSharedRelaySpelling filter is the thing being tested, not an empty directory (re-anchored 2026-10-29).
    listRelayOffers: async () => [{ url: 'wss://app.trinityone.church//relay', name: 'shared-again', ms: 10 }] });
  const card = addCard(r.steward);
  card.draw(); await settle();
  const nameIn = find(card.draw(), n => n.type === 'input' && n.props['aria-label'] === 'Relay name to connect to');
  assert.equal(nameIn.length, 1, 're-anchor: no relay-name field on the card');
  nameIn[0].props.onChange({ target: { value: 'grace-city' } });
  button(card.draw(), 'Connect').filter(b => b.props['aria-label'] === 'Connect to relay by name')[0].props.onClick();
  await settle(); await settle(); await settle();
  assert.match(said(card.draw()), /That’s already one of TrinityOne’s relays\./, 'Connect by name did not say the name leads to a TrinityOne relay');
  assert.equal(consentYes(card.draw()).length, 0, 'Connect by name offered consent for a shared relay');
  button(card.draw(), 'Auto-find relays for me')[0].props.onClick();
  await settle(); await settle();
  // The shared spelling is the only offer, and it is filtered out — so no offer row, no "Connect selected",
  // and no consent line ever appears for it.
  assert.equal(button(card.draw(), 'Connect selected').length, 0, 'AUTO-FIND OFFERED A SPELLING OF A TRINITYONE RELAY');
  assert.equal(consentYes(card.draw()).length, 0, 'Auto-find reached consent for a shared relay');
  assert.deepEqual(s.stored, [], 'a spelling of a shared relay was stored');
  assert.equal(r.count('signRelay') + r.count('registerAtRelay'), 0, 'something was signed or registered');
});

test('Auto-find reports each relay\'s own result, never "✓ Added" over one that was not signed (third audit, finding 4)', async () => {
  const r = recorder({ signRelay: async (u) => (/open-b/.test(u)
    ? { proven: [], unproven: [u], published: false }
    : { proven: [{ url: u, pubkey: 'a'.repeat(64) }], entries: [{ pubkey: 'a'.repeat(64) }], published: true }) });
  const card = addCard(r.steward);
  card.draw(); await settle();
  button(card.draw(), 'Auto-find relays for me')[0].props.onClick();
  await settle(); await settle();
  // Re-anchored 2026-10-29: the pre-ticked list → "Connect selected" opens the consent line (the fastest two
  // are open-a and open-b, both ticked by default), then "Yes, connect" connects and signs them.
  button(card.draw(), 'Connect selected')[0].props.onClick();
  await settle();
  await consentYes(card.draw())[0].props.onClick();
  await settle(); await settle(); await settle();
  const all = said(card.draw());
  assert.match(all, /✓ Added 1 relay for backup: open-a/, 'the relay that WAS signed is not reported as added');
  assert.doesNotMatch(all, /Added 2 relays/, 'AUTO-FIND SAID BOTH WERE ADDED — one is not in the church\'s list');
  assert.match(all, /open-b: It could not prove it runs TrinityOne yet/, 'the steward was not told which relay was not signed, or why');
  assert.match(all, /To try again, enter wss:\/\/open-b\.example\/relay under Add a relay/, 'the steward was not told how to retry (Auto-find will not offer it again)');

  // Sixth audit, finding 5: a relay found on a PARTIAL read (fifth audit, finding 3) is not counted as added either.
  const r2 = recorder({ signRelay: async (u) => (/open-b/.test(u)
    ? { full: false, proven: [{ url: u, pubkey: 'b'.repeat(64) }], entries: [{ pubkey: 'b'.repeat(64) }], published: false }
    : { proven: [{ url: u, pubkey: 'a'.repeat(64) }], entries: [{ pubkey: 'a'.repeat(64) }], published: true }) });
  const card2 = addCard(r2.steward);
  card2.draw(); await settle();
  button(card2.draw(), 'Auto-find relays for me')[0].props.onClick();
  await settle(); await settle();
  button(card2.draw(), 'Connect selected')[0].props.onClick();
  await settle();
  await consentYes(card2.draw())[0].props.onClick();
  await settle(); await settle(); await settle();
  const all2 = said(card2.draw());
  assert.match(all2, /✓ Added 1 relay for backup: open-a/, 're-anchor: the relay that WAS signed is not reported as added');
  assert.doesNotMatch(all2, /✓ Added 2 relays/, 'AUTO-FIND SAID "✓ Added" OVER A RELAY ONLY A POSSIBLY STALE COPY OF THE LIST NAMES');
  assert.match(all2, /open-b: Added to this console, but .*can’t be confirmed in the list yet/, 'the steward was not told the partial-read relay is unconfirmed');
});

test('Steward.connectFoundRelays adds every relay it is handed and republishes once — out of the shipped bundle (third audit, finding 4)', async () => {
  const body = fnBody(VENDOR, '  async connectFoundRelays(picks) {', 'connectFoundRelays');
  const log = [];
  const window = { Steward: { addRelay: (u) => { log.push(['add', u]); return u; }, publishRelayList: async () => { log.push(['publish']); } } };
  const api = new Function('window', 'return ({ ' + body + ' });')(window);
  const picks = [{ url: 'wss://open-a.example/relay' }, { url: 'wss://open-b.example/relay' }];
  assert.deepEqual(await api.connectFoundRelays(picks), picks);
  assert.deepEqual(log, [['add', 'wss://open-a.example/relay'], ['add', 'wss://open-b.example/relay'], ['publish']],
    'THE FOUND RELAYS WERE NOT ADDED — the steward agreed to relays the console never connected');
  log.length = 0;
  assert.deepEqual(await api.connectFoundRelays([]), []);
  assert.deepEqual(log, [], 'nothing found, and the relay list was republished anyway');
});
