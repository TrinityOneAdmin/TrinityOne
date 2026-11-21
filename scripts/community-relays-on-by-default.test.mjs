// COMMUNITY RELAYS ON BY DEFAULT — the opt-out and the chosen set (PLAN-relay-autoconnect-selfhealing-sync-2026-11-20 §B1).
// Run: node --test scripts/community-relays-on-by-default.test.mjs
//
// The opt-out + chosen set live in ONE church-signed, OWNER-ONLY document (trinityone/relayprefs). This proves, out of
// the SHIPPED vendor/steward.js (CLAUDE.md rule 3's vendor half — a dead-code revert disappears from the slice):
//   1. absent doc + COMPLETE read = auto ON (the opt-out default); an INCOMPLETE read = OFF-this-pass (fail closed, 13b);
//   2. a round-trip: setPublicAuto / setPublicTarget write, and relayPrefs reads the same back;
//   3. publicTarget is clamped 0-10, and 0 leaves publicAuto untouched;
//   4. the writer is owner-key-only — a delegated / network console never writes it, and _writeRelayPrefs never over-
//      writes the church's prefs over a partial read;
//   5. POINT OF USE (rule 1): the Settings switch DRIVES publicAuto — the real card is rendered and the switch pressed,
//      and the call reaches window.Steward. Nothing asserts behaviour by matching text in app/*.jsx (rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { compileScreen, miniReact, find, texts, button } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');

// ── A console's prefs engine, lifted from the bundle over one in-memory relay ────────────────────────────────
// `complete` models the three-state read: a box answered (true) or some box did not (false). `store.ev` is the one
// signed copy the relay holds. publish() stamps the author (a church-key signature), exactly what the re-check guards on.
function prefsApi({ sk = 'sk', pub = 'CHURCHPUB', actingChurch = '', network = false, complete = true } = {}) {
  const store = { ev: null };
  let clock = 1000;
  const read = () => ({
    ev: store.ev,
    askedUrls: ['wss://a/relay'],
    answeredUrls: complete ? ['wss://a/relay'] : [],
  });
  const scope = {
    sk, pub, actingChurch, PUBLIC_TARGET_DEFAULT: 5, RELAYPREFS_D: 'trinityone/relayprefs',
    CANONICAL_RELAYS: ['wss://app.trinityone.church/relay'],
    _viewingNetwork: () => network,
    _oneComplete: async () => read(),
    _readCovers: (r) => (r.askedUrls || []).length > 0 && (r.askedUrls || []).every((u) => (r.answeredUrls || []).includes(u)),
    enrolSerial: (fn) => Promise.resolve(fn()),
    finalizeEvent: (e) => ({ ...e, pubkey: pub }), finalizeEvent2: (e) => ({ ...e, pubkey: pub }),
    _monotonic: (e) => e,
    now: () => ++clock,
    publish: async (ev) => { store.ev = ev; return ev; },
    Math, JSON, Number, Array, Set, String, Object, Promise, Boolean,
  };
  const names = Object.keys(scope);
  const src = [
    fnBody(STEWARD, 'function _clampPublicTarget(n) {', '_clampPublicTarget'),
    fnBody(STEWARD, 'function _communityCap(publicTarget) {', '_communityCap'),
    fnBody(STEWARD, 'function _mergeChosen(a, b) {', '_mergeChosen'),
    fnBody(STEWARD, 'async function _readRelayPrefs() {', '_readRelayPrefs'),
    fnBody(STEWARD, 'async function _writeRelayPrefs(mutate) {', '_writeRelayPrefs'),
  ].join('\n');
  const methods = '{ ' + [
    fnBody(STEWARD, 'async relayPrefs() {', 'relayPrefs'),
    fnBody(STEWARD, 'setPublicAuto(on) {', 'setPublicAuto'),
    fnBody(STEWARD, 'setPublicTarget(n) {', 'setPublicTarget'),
  ].join(', ') + ' }';
  const api = new Function(...names, src + '\nreturn (' + methods + ');')(...names.map((k) => scope[k]));
  return { api, store };
}

test('1. an ABSENT doc read in FULL is auto ON (the opt-out default); an INCOMPLETE read is OFF-this-pass', async () => {
  const onByDefault = prefsApi({ complete: true }).api;
  const r = await onByDefault.relayPrefs();
  assert.equal(r.complete, true);
  assert.equal(r.publicAuto, true, 'ABSENT + COMPLETE must default to ON — the owner opt-out default');
  assert.equal(r.publicTarget, 5, 'the default target is 5');

  const failClosed = prefsApi({ complete: false }).api;
  const r2 = await failClosed.relayPrefs();
  assert.equal(r2.complete, false);
  assert.equal(r2.publicAuto, null, 'AN INCOMPLETE READ MUST NOT READ AS ON — a 2G church that opted out would be auto-joined over a timeout (13b)');
});

test('2. round-trip: setPublicAuto(false) persists and reads back; setPublicTarget writes a clamped value', async () => {
  const { api } = prefsApi({});
  const w = await api.setPublicAuto(false);
  assert.equal(w.written, true, 'the opt-out was not written');
  const r = await api.relayPrefs();
  assert.equal(r.publicAuto, false, 'the opt-out did not read back — the switch would not stick');

  const t = await api.setPublicTarget(3);
  assert.equal(t.written, true);
  assert.equal((await api.relayPrefs()).publicTarget, 3, 'the new target did not read back');
});

test('3. publicTarget is clamped 0-10, and 0 does NOT touch publicAuto', async () => {
  const { api } = prefsApi({});
  await api.setPublicTarget(99);
  assert.equal((await api.relayPrefs()).publicTarget, 10, 'an over-large target was not capped at 10');
  await api.setPublicTarget(-4);
  assert.equal((await api.relayPrefs()).publicTarget, 0, 'a negative target was not floored at 0');
  // 0 is "adopt no new relays" — it must leave publicAuto exactly as it was.
  const before = (await api.relayPrefs()).publicAuto;
  await api.setPublicTarget(0);
  assert.equal((await api.relayPrefs()).publicAuto, before, 'setting the target to 0 changed publicAuto');
});

test('4. owner-key-only: a delegated or network console never writes, and a partial read never over-writes', async () => {
  const delegated = prefsApi({ actingChurch: 'f'.repeat(64) }).api;
  const d = await delegated.setPublicAuto(false);
  assert.notEqual(d.written, true);
  assert.equal(d.skipped, true, 'A DELEGATED CONSOLE WROTE THE OPT-OUT — a helper must not widen who holds the corpus (13a)');

  const net = prefsApi({ network: true }).api;
  assert.equal((await net.setPublicTarget(2)).skipped, true, 'a network view wrote the church\'s relay prefs');

  const partial = prefsApi({ complete: false });
  const w = await partial.api.setPublicAuto(false);
  assert.notEqual(w.written, true, 'A PARTIAL READ WROTE OVER THE CHURCH\'S PREFS — a timeout could flip the opt-out');
  assert.equal(w.unknown, true);
  assert.equal(partial.store.ev, null, 'a document was signed over an incomplete read');
});

// ── 5. the Settings switch, rendered and pressed (rule 1) ────────────────────────────────────────────────────
const JS = compileScreen('app/stew-dashboard.jsx');
function card(steward, { acting = '' } = {}) {
  const { React, draw } = miniReact();
  const win = {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Steward: { actingChurch: acting, myStewardCaps: () => [], relayPrefs: async () => ({ complete: true, publicAuto: false, publicTarget: 5, chosen: [] }), ...steward },
  };
  const globals = {
    React, window: win, localStorage: win.localStorage,
    location: { host: 'app.example', hostname: 'app.example' }, navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} }, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; }, SkPill: function SkPill() { return null; }, SkBadge: function SkBadge() { return null; },
    // The card now links to the B4 high-risk guide (stew-help.jsx in the real console); here it is a no-op stub,
    // so this file's switch/target assertions below are unchanged. The LINK itself is asserted in its own test file.
    StewHelpLink: function StewHelpLink() { return null; },
    useStewDialog: () => ({ current: null }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { DashCommunityRelaysCard };')(...names.map((k) => globals[k]));
  assert.equal(typeof mod.DashCommunityRelaysCard, 'function', 'DashCommunityRelaysCard is not a component any more — re-anchor');
  return { draw: () => draw(mod.DashCommunityRelaysCard, {}) };
}
const settle = () => new Promise((r) => setImmediate(r));
const said = (n) => texts(n).join('').replace(/\s+/g, ' ').trim();
const theSwitch = (tree) => find(tree, (n) => n.type === 'button' && n.props.role === 'switch' && n.props['aria-label'] === 'Use community relays automatically');

test('5. the switch drives publicAuto — pressing it calls setPublicAuto with the toggled value', async () => {
  const calls = [];
  const c = card({ setPublicAuto: async (on) => { calls.push(on); return { written: true }; }, relayPrefs: async () => ({ complete: true, publicAuto: false, publicTarget: 5, chosen: [] }) });
  c.draw(); await settle();
  const sw = theSwitch(c.draw());
  assert.equal(sw.length, 1, 're-anchor: the community-relays switch is gone');
  assert.equal(sw[0].props['aria-checked'], false, 'the switch does not reflect the stored OFF state');
  await sw[0].props.onClick();
  await settle();
  assert.deepEqual(calls, [true], 'THE SWITCH IS WIRED TO NOTHING — turning community relays on from Settings does nothing');
  assert.equal(theSwitch(c.draw())[0].props['aria-checked'], true, 'the switch did not move to ON after it was saved');
});

test('5b. the target control drives publicTarget (+ / −), and 0-10 bounds hold at the wire', async () => {
  const calls = [];
  const c = card({ setPublicTarget: async (n) => { calls.push(n); return { written: true }; }, relayPrefs: async () => ({ complete: true, publicAuto: true, publicTarget: 5, chosen: [] }) });
  c.draw(); await settle();
  const more = find(c.draw(), (n) => n.type === 'button' && n.props['aria-label'] === 'More community relays');
  const less = find(c.draw(), (n) => n.type === 'button' && n.props['aria-label'] === 'Fewer community relays');
  assert.equal(more.length, 1, 're-anchor: the "more" stepper is gone');
  await more[0].props.onClick(); await settle();
  await less[0].props.onClick(); await less[0].props.onClick(); await settle();
  assert.deepEqual(calls, [6, 4, 4], 'the target stepper does not drive setPublicTarget with the new value');
});

test('5c. a delegated console cannot flip the switch — the press reaches the owner-only sentence, not the engine', async () => {
  const calls = [];
  const c = card({ setPublicAuto: async (on) => { calls.push(on); return { written: true }; }, myStewardCaps: () => [], relayPrefs: async () => ({ complete: true, publicAuto: false, publicTarget: 5, chosen: [] }) }, { acting: 'a'.repeat(64) });
  c.draw(); await settle();
  await theSwitch(c.draw())[0].props.onClick();
  await settle();
  assert.equal(calls.length, 0, 'A DELEGATED CONSOLE WROTE THE OPT-OUT FROM THE SCREEN — the UI did not honour owner-only');
  assert.match(said(c.draw()), /Only the church’s own console/, 'the delegate was not told why the switch did nothing');
});
