// NOTHING IN THE PRODUCT MAY SUGGEST A RELAY WE DO NOT RUN.
// Run: node --test scripts/no-relay-we-do-not-run-is-suggested.test.mjs
//
// reference/DOMAIN.md, "TrinityOne relays are a closed network", 2026-09-01: *"allowing outside relays is
// NOT allowed in our main build ... a church doesn't have to 'trust' or select relays."* Every protection
// in this product — the read gate, the safeguarding gates, default-deny — lives in the relay. A generic
// Nostr relay has none of them, so publishing a church's documents there hands a sealed care request to a
// machine that will serve it to anyone who asks.
//
// Before this, the product ASKED for exactly that. The console's Add-relay box read
// `<a public relay> · <another public relay> · wss://relay.example.com`, its error named a third, and the
// panel below reassured the steward that public relays "stay publish-only, so gated content never leaves
// your own infrastructure" — which was not true: publish() fans out over the raw relay list. A steward who
// typed one in was not making a mistake, they were following instructions.
//
// THIS FILE IS TWO INDEPENDENT MECHANISMS AND IT SAYS WHICH IS WHICH:
//
//   PART 1 is BEHAVIOURAL and is the assertion that matters. It renders the REAL console relays panel
//   (DashRelaysCard, app/stew-dashboard.jsx) and the REAL member relays sheet (RelaysSheet,
//   app/identity-extras.jsx) through the miniature React in render-jsx-screen.mjs, drives the panel's own
//   Add button so its own error handler runs, and asserts that NO string that reaches the screen — visible
//   text, placeholder, aria-label, title — names a relay we do not run. Real code runs and real branches are
//   evaluated, so this fails if a suggestion is put back on screen.
//
//   PART 2 is A LINT OVER SOURCE TEXT of app/, src/ and vendor/, and claims nothing about behaviour.
//   CLAUDE.md rule 3 forbids asserting BEHAVIOUR by matching text in app/*.jsx, because those files ship
//   unbundled and `false && ` in front of a condition leaves every word in place. An ABSENCE assertion is
//   sound in a way a presence assertion is not: dead code cannot hide a deleted string. Part 2 exists
//   because the worst instance of this defect was NEVER ON SCREEN — app/identity-extras.jsx shipped a
//   six-entry SUGGESTED_RELAYS with a complete add flow, one line of JSX from being live, and Part 1 by
//   construction could not see it. Part 2 catches the latent kind; Part 1 catches the live kind.
//
// SCOPE, deliberately: scripts/ is NOT scanned. scripts/console-ink-colours-are-covered.test.mjs seeds a
// church whose SAVED relay list contains a public relay and asserts the row renders — that is the
// "an existing church must not be stranded" case, and it must keep working. This item removes SUGGESTIONS,
// never stored values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

// The seed list from the plan (reference/PLAN-CLOSED-RELAY-NETWORK-2026-09-01.md, C1). Five generic public
// Nostr relays that shipped in SUGGESTED_RELAYS and the console placeholder, plus relay.trinityone.app —
// a relay hostname on a domain this project does not own (ours is trinityone.church), which is therefore
// a machine nobody has vouched for exactly like the others.
const FORBIDDEN = [
  'relay.damus.io',
  'nos.lol',
  'relay.snort.social',
  'nostr.wine',
  'relay.primal.net',
  'relay.trinityone.app',
  // bare vendor names, so a re-add under a different subdomain is caught too
  'damus', 'snort.social', 'primal.net', 'purplepag.es',
];
const hits = (s) => FORBIDDEN.filter(h => s.toLowerCase().includes(h));

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// PART 1 — RENDERED. The real components, real branches, real handlers.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

const DASH = compileScreen('app/stew-dashboard.jsx');
const EXTRAS = compileScreen('app/identity-extras.jsx');

// ── the steward console's Relays panel ────────────────────────────────────────────────────────────────────
// Everything DashRelaysCard takes from outside its own file. A name it needs that is not here is a
// ReferenceError at the point of use, deliberately: a silently-stubbed global is how a test ends up
// asserting about something that is not the code.
function relaysCard({ relays = [], backup = null, steward = {} } = {}) {
  const { React, draw } = miniReact();
  const listeners = new Map();
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const win = {
    useStewardRelays: () => relays,
    addEventListener(t, f) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(f); },
    removeEventListener(t, f) { const a = listeners.get(t) || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    dispatchEvent(e) { (listeners.get(e && e.type) || []).slice().forEach(f => f(e)); return true; },
    localStorage,
    Steward: {
      ownRelay: () => 'wss://relay.grace.example/relay',
      backupState: async () => { if (backup === null) throw new Error('no backup state'); return backup; },
      addRelay: () => '',
      removeRelay: () => {},
      rememberRelayName: () => {},
      ...steward,
    },
  };
  const globals = {
    React, window: win, localStorage,
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
  const mod = new Function(...names, DASH + '\nreturn { DashRelaysCard };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.DashRelaysCard, 'function', 'DashRelaysCard is not a component any more — re-anchor this test');
  return { draw: () => draw(mod.DashRelaysCard, {}) };
}

// ── the member app's Relays sheet ─────────────────────────────────────────────────────────────────────────
function relaysSheet({ fellowship = null, fallback = [] } = {}) {
  const { React, draw } = miniReact();
  const listeners = new Map();
  const win = {
    Fellowship: fellowship,
    TrinityData: { RELAYS: fallback },
    addEventListener(t, f) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(f); },
    removeEventListener(t, f) { const a = listeners.get(t) || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
  };
  const globals = {
    React, window: win,
    navigator: { clipboard: { writeText: async () => {} } },
    document: { addEventListener() {}, removeEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    // furniture from other app files. BottomSheet must pass its children through or the sheet's own body
    // never renders and this test would be measuring an empty box.
    BottomSheet: function BottomSheet(p) { return p.children; },
    IconBtn: function IconBtn() { return null; },
    Icon: function Icon() { return null; },
    Avatar: function Avatar() { return null; },
    Row: function Row() { return null; },
    Field: function Field() { return null; },
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, EXTRAS + '\nreturn { RelaysSheet };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.RelaysSheet, 'function', 'RelaysSheet is not a component any more — re-anchor this test');
  return { draw: (props) => draw(mod.RelaysSheet, { open: true, onClose() {}, ctx: { toast() {} }, ...props }) };
}

const settle = () => new Promise(r => setImmediate(r));
async function paint(card) { card.draw(); await settle(); return card.draw(); }
const said = (n) => texts(n).join(' § ').replace(/\s+/g, ' ').trim();

test('CONTROL: the console relays panel renders, keeps its typed-address box, and still shows a saved relay', async () => {
  // A church that ALREADY has a public relay saved. C1 removes suggestions, not stored values: the row must
  // still render, or an existing church has been stranded by this change.
  const stored = [
    { url: 'wss://relay.grace.example/relay', status: 'on', ms: 21 },
    { url: 'wss://nos.lol', status: 'off' },
  ];
  const tree = await paint(relaysCard({ relays: stored, backup: { boxes: 2, online: 2, syncOn: true } }));
  const all = said(tree);
  assert.match(all, /Where your church publishes/, 'DashRelaysCard no longer renders its blurb — re-anchor this test');
  assert.match(all, /wss:\/\/nos\.lol/,
    'a relay already saved in a church\'s list stopped rendering. C1 removes SUGGESTIONS, never stored values');
  const box = find(tree, n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add');
  assert.equal(box.length, 1,
    'the Add-relay input is gone. A church legitimately adds the second box it runs itself; that path stays ' +
    'until there is a gate. C1 removes the suggestion, not the ability to type an address');
});

test('the console relays panel names no relay we do not run — placeholder, labels and all', async () => {
  const tree = await paint(relaysCard({ relays: [], backup: { boxes: 1, online: 1, syncOn: false } }));
  const all = said(tree);
  // texts() collects string PROPS as well as visible text, so the placeholder and aria-label are in here.
  assert.deepEqual(hits(all), [],
    'the console relays panel puts ' + hits(all).join(', ') + ' in front of a steward. A relay we do not run ' +
    'has none of this product\'s gates on it; suggesting one is instructing a churchwarden to publish the ' +
    'church\'s documents, sealed care requests included, to a machine that will serve them to anyone');
  const box = find(tree, n => n.type === 'input' && n.props['aria-label'] === 'Relay address to add')[0];
  assert.ok(box, 'the Add-relay input is gone — re-anchor this test');
  assert.deepEqual(hits(String(box.props.placeholder || '')), [],
    'the Add-relay placeholder still reads "' + box.props.placeholder + '"');
});

test('the console\'s Add-relay ERROR, produced by its own handler, suggests no relay we do not run', async () => {
  // Steward.addRelay returns falsy for a malformed address — the panel then renders its error line. Press
  // the panel's own button so its own handler runs; nothing here is injected.
  const card = relaysCard({ relays: [], backup: { boxes: 1, online: 1, syncOn: false }, steward: { addRelay: () => false } });
  let tree = await paint(card);
  const btn = find(tree, n => n.type === 'button' && said(n).includes('Add relay'));
  assert.equal(btn.length, 1, 'the Add-relay button is gone or duplicated — re-anchor this test');
  btn[0].props.onClick();
  tree = card.draw();
  const all = said(tree);
  assert.match(all, /Enter a relay address/,
    'pressing Add relay with a bad address no longer produces an error line — re-anchor this test, because ' +
    'the assertion below is then measuring nothing');
  assert.deepEqual(hits(all), [],
    'the error a steward sees after a failed Add still names ' + hits(all).join(', '));
});

test('the console\'s sync blurb makes no claim about what a public relay does with the church\'s data', async () => {
  // One relay box: this is the branch that used to say public relays "stay publish-only, so gated content
  // never leaves your own infrastructure". It was false — publish() fans out over the raw relay list — and
  // CLAUDE.md rule 4 applies to shipped copy as much as to commit messages.
  const tree = await paint(relaysCard({ relays: [], backup: { boxes: 1, online: 1, syncOn: false } }));
  const all = said(tree);
  assert.match(all, /Add a second relay your church runs/,
    'the one-box sync blurb is gone — re-anchor this test');
  assert.doesNotMatch(all, /publish-only/i,
    'the console still tells a steward a public relay is "publish-only". It is not: every console write goes ' +
    'out through publish() over the raw relay list, whatever the relay advertises');
  assert.doesNotMatch(all, /never leaves your own infrastructure/i,
    'the console still promises the church\'s gated content never leaves its own infrastructure. Clients ' +
    'publish to every relay in the list, so that sentence is false');
});

test('the member relays sheet offers no relay to add, and still shows the church\'s own', async () => {
  const tree = relaysSheet({ fellowship: { relays: ['wss://relay.grace.example/relay'] } }).draw();
  const all = said(tree);
  assert.match(all, /relay\.grace\.example/,
    'the member sheet stopped listing the church\'s relay — re-anchor this test');
  assert.deepEqual(hits(all), [],
    'the member relays sheet offers ' + hits(all).join(', ') + '. A member never chooses a relay: they get ' +
    'their church\'s when they join it');
  assert.equal(find(tree, n => n.type === 'input').length, 0,
    'the member relays sheet has grown an input. A member has no relay to add — the sheet is a list');
});

test('the member relays sheet renders with no transport at all, on the shipped fallback list', async () => {
  // window.Fellowship absent is a real state (first launch, before a church is joined): the sheet falls back
  // to window.TrinityData.RELAYS. app/data.jsx keeps that binding and empties it — deleting the symbol would
  // be a ReferenceError, because app/*.jsx are classic scripts sharing one global scope.
  const D = await import('node:fs').then(fs => fs.readFileSync(join(ROOT, 'app/data.jsx'), 'utf8'));
  assert.match(D, /^const RELAYS = \[\];$/m,
    'app/data.jsx RELAYS is no longer the empty list this test renders against — re-anchor this test');
  const tree = relaysSheet({ fellowship: null, fallback: [] }).draw();
  const all = said(tree);
  assert.match(all, /No relay yet/,
    'with no transport and an empty fallback the sheet must still render its empty state, not throw');
  assert.deepEqual(hits(all), []);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// PART 2 — SOURCE LINT. Claims nothing about behaviour; catches the LATENT re-add that Part 1 cannot see.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

const shipped = () => {
  const out = [];
  for (const dir of ['app', 'src', 'vendor']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (/\.(jsx?|mjs)$/.test(f)) out.push(dir + '/' + f);
    }
  }
  for (const f of readdirSync(ROOT)) if (/\.html$/.test(f)) out.push(f);
  return out;
};

test('no file that ships to a phone or a console names a relay we do not run', () => {
  const files = shipped();
  assert.ok(files.length > 60, 'the file sweep found only ' + files.length + ' files — it is not looking where it thinks');
  const bad = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8').toLowerCase();
    for (const h of FORBIDDEN) {
      if (src.includes(h)) {
        const line = src.split('\n').findIndex(l => l.includes(h)) + 1;
        bad.push(f + ':' + line + ' names ' + h);
      }
    }
  }
  assert.deepEqual(bad, [],
    'these shipped files name a relay we do not run:\n  ' + bad.join('\n  ') + '\n' +
    'TrinityOne relays are a closed network (reference/DOMAIN.md). This includes a list that nothing renders ' +
    'yet: app/identity-extras.jsx shipped SUGGESTED_RELAYS with a complete add flow one line of JSX from live, ' +
    'and no rendered test could ever have seen it.');
});
