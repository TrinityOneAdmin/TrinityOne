// A CHURCH MUST NOT LOSE A RELAY — AND THE NAME THAT WOULD BRING IT BACK — TO ONE MISPLACED TAP.
// Run: node --test scripts/removing-a-relay-asks-first.test.mjs
//
// Audit item 19, 2026-09-14. MEASURED ON A REAL CONSOLE before anything was changed: a relay added by name
// (`falgate-box` → `wss://box.example.ts.net/relay`) was removed by ONE click on a trash icon — no
// confirmation of any kind — and `Steward.removeRelay` also deleted the name→url binding:
//     before: [{ name: 'falgate-box', url: 'wss://box.example.ts.net/relay' }]
//     after:  []
//
// THE NAME IS THE DURABLE HANDLE AND THE URL IS NOT. A self-hosted box reached through a tunnel changes
// address — that is the whole reason names exist (CLAUDE.md rule 10, root 3: "tunnel addresses churn", and
// URL-matching "drops every self-hosting church off every phone on each reboot"). So after one tap a church
// has no relay, no name, and an address on screen that may already be stale. Losing the relay list is how a
// church stops receiving its own data.
//
// Dropping the binding is CORRECT and stays — otherwise auto-follow re-adds what a steward just removed.
// What was missing is being ASKED, and being told which name goes with it. The member app's own relay list
// (app/identity-extras.jsx) has confirmed since the day it shipped; this is the console catching up.
//
// ⚠ RULE 3: app/*.jsx ships UNBUNDLED — `false && ` leaves the words in place and a text match still passes.
// The panel is RENDERED and read out of the tree. Nothing here matches text in a .jsx file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// ── the engine: what removal actually costs ────────────────────────────────────────────────────────────
function engine(named) {
  const store = { 'trinityone.steward.relay-names': JSON.stringify(named || []),
                  'trinityone.steward.extra-relays': JSON.stringify(['wss://box.example.ts.net/relay']) };
  const src = [
    stmt(SHIP, 'var NAMES_LS =', 'NAMES_LS'),
    fnBody(SHIP, 'function getNamedRelays()', 'getNamedRelays'),
    fnBody(SHIP, 'function setNamedRelays(', 'setNamedRelays'),
  ].join('\n');
  return new Function('lsGet', 'lsSet', 'normRelay',
    src + '\nreturn { get: getNamedRelays, set: setNamedRelays };')(
      (k) => (k in store ? store[k] : null), (k, v) => { store[k] = v; },
      (u) => String(u || '').trim().toLowerCase().replace(/\/+$/, ''));
}

test('removing a relay really does forget the name — so the screen must say so BEFORE it happens', () => {
  // Re-anchor on the COST, by running the shipped removeRelay rather than imitating it. An earlier version of
  // this test filtered the list itself and so could not see removeRelay change at all — the sabotage
  // "removeRelay keeps the name binding" came back green. If the binding ever starts surviving removal, the
  // confirmation's wording becomes a warning about a loss that no longer happens, which is its own lie.
  const store = { 'trinityone.steward.relay-names': JSON.stringify([{ name: 'falgate-box', url: 'wss://box.example.ts.net/relay' }]),
                  'trinityone.steward.extra-relays': JSON.stringify(['wss://box.example.ts.net/relay']) };
  const src = [
    stmt(SHIP, 'var NAMES_LS =', 'NAMES_LS'),
    stmt(SHIP, 'var RELAYS_LS =', 'RELAYS_LS'),
    fnBody(SHIP, 'function getNamedRelays()', 'getNamedRelays'),
    fnBody(SHIP, 'function setNamedRelays(', 'setNamedRelays'),
  ].join('\n');
  const removeRelay = new Function('lsGet', 'lsSet', 'extraRelays', 'window',
    src + '\nreturn ({ ' + fnBody(SHIP, 'removeRelay(url) {', 'removeRelay') + ' }).removeRelay;')(
      (k) => (k in store ? store[k] : null), (k, v) => { store[k] = v; },
      () => JSON.parse(store['trinityone.steward.extra-relays']),
      { dispatchEvent: () => {}, CustomEvent: function () {} });
  removeRelay('wss://box.example.ts.net/relay');
  assert.deepEqual(JSON.parse(store['trinityone.steward.relay-names']), [],
    'the name binding now SURVIVES removal — auto-follow would re-add a relay the steward just removed, and ' +
    'the confirmation this test guards would be warning about a loss that no longer happens');
  assert.deepEqual(JSON.parse(store['trinityone.steward.extra-relays']), [],
    're-anchor: removeRelay no longer removes the relay');
});

test('relayNameFor answers which name points at an address, and is read-only', () => {
  const store = { 'trinityone.steward.relay-names': JSON.stringify([{ name: 'falgate-box', url: 'wss://box.example.ts.net/relay' }]) };
  const writes = [];
  const fn = new Function('lsGet', 'lsSet', 'normRelay', 'getNamedRelays',
    // object-method shorthand in the bundle, so it is wrapped rather than declared
    'return ({ ' + fnBody(SHIP, 'relayNameFor(url) {', 'relayNameFor') + ' }).relayNameFor;')(
      (k) => (k in store ? store[k] : null), (k, v) => writes.push(k),
      (u) => String(u || '').trim().toLowerCase().replace(/\/+$/, ''),
      () => JSON.parse(store['trinityone.steward.relay-names']));
  assert.equal(fn('wss://box.example.ts.net/relay'), 'falgate-box', 'the bound name is not found');
  assert.equal(fn('wss://box.example.ts.net/relay/'), 'falgate-box',
    'a trailing slash missed the binding — the trap this codebase has recorded three times');
  assert.equal(fn('wss://somewhere-else.example/relay'), '', 'an unbound address was given a name anyway');
  assert.deepEqual(writes, [], 'relayNameFor WROTE to storage — it is meant to be a read');
});

// ── THE POINT OF USE: the panel must ASK, and must name what goes with it ───────────────────────────────
// CLAUDE.md rule 1. The engine half above proves what removal costs; this proves the console does not spend
// it on one tap. Deleting the confirmation from the screen leaves every engine test green.
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

function mini() {
  const states = []; const memos = []; const effDeps = []; let queued = [];
  let i = 0, mi = 0, ei = 0;
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, n) => Object.is(v, b[n]));
  const React = {
    useState(init) { const k = i++; if (!(k in states)) states[k] = typeof init === 'function' ? init() : init;
      return [states[k], (v) => { states[k] = typeof v === 'function' ? v(states[k]) : v; }]; },
    useMemo(f, deps) { const k = mi++; if (!memos[k] || !same(memos[k].deps, deps)) memos[k] = { deps, v: f() }; return memos[k].v; },
    useCallback(f, deps) { return React.useMemo(() => f, deps); },
    useEffect(fn, deps) { const k = ei++; if (!(k in effDeps) || !same(effDeps[k], deps)) { effDeps[k] = deps; queued.push(fn); } },
    useRef: () => ({ current: null }),
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    Fragment: 'Fragment',
  };
  const flush = () => { const r = queued; queued = []; r.forEach(f => { try { f(); } catch (e) {} }); };
  return { React, reset: () => { i = 0; mi = 0; ei = 0; }, flush };
}
const texts = (n, out = []) => {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => texts(c, out)); return out; }
  if (n.props) Object.values(n.props).forEach(v => { if (typeof v === 'string') out.push(v); else if (v && (v.kids || Array.isArray(v))) texts(v, out); });
  (n.kids || []).forEach(c => texts(c, out));
  return out;
};
const find = (n, p, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => find(c, p, out)); return out; }
  if (p(n)) out.push(n);
  (n.kids || []).forEach(c => find(c, p, out));
  return out;
};

// ⚠ TWO ROWS, AND relayNameFor ANSWERS PER URL. The first version of this fixture had ONE row and stubbed
// `relayNameFor: () => name` — a constant that ignores its argument — so replacing BOTH `relayName(r.url)`
// calls with a completely different address left 6/6 green. The tests proved the panel calls the lookup and
// renders the answer; they could not prove it asks about the relay being removed. A steward removing
// `falgate-box` could be told "It was added by the name 'grace-city'", write that down, and have no way back
// to the box she actually removed — which is the whole of what item 19 is about. Audit, 2026-09-14.
const ROW_A = 'wss://box.example.ts.net/relay';
const ROW_B = 'wss://second-box.example.ts.net/relay';
const NAMES = { [ROW_A]: 'falgate-box', [ROW_B]: 'grace-city' };

async function relayPanel({ names = NAMES } = {}) {
  const removed = [];
  const { React, reset, flush } = mini();
  const src = fnBody(DASH, 'function DashRelaysCard()', 'DashRelaysCard');
  const tmp = join(tmpdir(), 'relay19-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashRelaysCard };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__r19_' + Math.random().toString(36).slice(2);
  const Steward = {
    relaysDetailed: () => [{ url: ROW_A, status: 'on', ms: 20, member: true }, { url: ROW_B, status: 'on', ms: 30, member: true }],
    relays: () => [ROW_A, ROW_B], relaysRaw: () => [ROW_A, ROW_B],
    removeRelay: (u) => { removed.push(u); return true; },
    relayNameFor: (u) => names[u] || '',
    ownRelayUrl: () => '', selfHostedUrl: () => '', addRelay: () => {}, publishRelayList: async () => {},
  };
  globalThis[key] = {
    React, window: { Steward, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} },
    Icon: () => null, SkPill: ({ children }) => ({ type: 'span', props: {}, kids: [children] }),
    SkCard: ({ children }) => ({ type: 'div', props: {}, kids: [children] }),
    relayRejectionActive: false, noteRelayRejection: () => {}, shortNpub: () => '',
    // The card reads its whole relay list from this hook, so the fixture lives here: one removable relay,
    // answering, in-network, and NOT the church's own box (the trash control is hidden for `self` and for
    // `own`, which would make this test vacuous).
    useRelayBackupState: () => ({ status: [{ url: ROW_A, status: 'on', ms: 20, member: true }, { url: ROW_B, status: 'on', ms: 30, member: true }], backup: null }),
    location: { host: 'console.example' },
    relaysThatRefused: () => [],
    Panel: () => null,
  };
  const pre = Object.keys(globalThis[key]).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const b64 = Buffer.from(pre + '\n' + js).toString('base64');
  const Comp = (await import('data:text/javascript;base64,' + b64)).DashRelaysCard;
  const draw = () => { reset(); const t = Comp({}); flush(); return t; };
  return { draw, removed };
}

const trashAll = (tree) => find(tree, n => n.type === 'button' && /Remove relay/i.test((n.props && n.props['aria-label']) || ''));
const trash = (tree, i = 0) => trashAll(tree)[i];

test('one tap does NOT remove a relay — the console asks first', async () => {
  const p = await relayPanel();
  const btn = trash(p.draw());
  assert.ok(btn, 're-anchor: the relay panel no longer renders a remove control at all');
  btn.props.onClick();
  assert.deepEqual(p.removed, [],
    'ONE TAP ON A TRASH ICON STOPPED THIS CHURCH SENDING ITS DATA TO A RELAY, with nothing asked. Measured ' +
    'on a real console. Losing the relay list is how a church stops receiving its own data.');
  const after = texts(p.draw()).join(' | ');
  assert.match(after, /Stop sending this church’s data to this relay\?/,
    'nothing on the screen asks — the tap simply did nothing, which is its own bug');
});

test('…and the confirmation NAMES THE BINDING OF THE ROW SHE TAPPED, not just some name', async () => {
  // Two rows, two different names. Tapping the SECOND must not name the first's binding.
  const p = await relayPanel();
  trash(p.draw(), 1).props.onClick();
  const after = texts(p.draw()).join(' | ');
  assert.match(after, /grace-city/,
    'THE STEWARD IS NOT TOLD THE NAME IS GOING TOO. The name is the durable handle for a box behind a ' +
    'rotating tunnel address; the URL on screen may already be stale. Without it there is no way back.');
  assert.ok(!/falgate-box/.test(after),
    'THE CONFIRMATION NAMED A DIFFERENT RELAY’S BINDING. She writes down "falgate-box", removes the box that ' +
    'was called "grace-city", and has no way back to either. Screen read: ' + after);
});

test('…and confirming removes THAT row, not another one', async () => {
  const p = await relayPanel();
  trash(p.draw(), 1).props.onClick();
  find(p.draw(), n => n.type === 'button' && /Remove this relay/i.test((n.props && n.props.title) || ''))[0].props.onClick();
  assert.deepEqual(p.removed, [ROW_B],
    'the confirmation asked about one relay and removed another: ' + JSON.stringify(p.removed));
});

test('the confirmation opens on ONE row only', async () => {
  const p = await relayPanel();
  trash(p.draw(), 0).props.onClick();
  const t = texts(p.draw()).join(' | ');
  const n = (t.match(/Stop sending this church/g) || []).length;
  assert.equal(n, 1, 'the confirmation rendered on ' + n + ' rows — every relay is now armed for removal');
});

test('a relay with NO name says what IS needed to add it again', async () => {
  const p = await relayPanel({ names: {} });
  trash(p.draw()).props.onClick();
  const after = texts(p.draw()).join(' | ');
  assert.match(after, /this exact address/,
    'an unnamed relay gives the steward no idea what re-adding it would take');
  assert.doesNotMatch(after, /added by the name/, 'a relay with no name was described as having one');
});

test('confirming removes it; "Keep it" does not', async () => {
  const p = await relayPanel();
  trash(p.draw()).props.onClick();
  const keep = find(p.draw(), n => n.type === 'button' && /Keep this relay/i.test((n.props && n.props.title) || ''))[0];
  assert.ok(keep, 'there is no way OUT of the confirmation — the only exit is removal');
  keep.props.onClick();
  assert.deepEqual(p.removed, [], '"Keep it" removed the relay anyway');
  assert.doesNotMatch(texts(p.draw()).join(' | '), /Stop sending/, 'the confirmation will not go away');

  const q = await relayPanel();
  trash(q.draw()).props.onClick();
  const go = find(q.draw(), n => n.type === 'button' && /Remove this relay/i.test((n.props && n.props.title) || ''))[0];
  assert.ok(go, 're-anchor: the confirmation has no confirm button');
  go.props.onClick();
  assert.deepEqual(q.removed, [ROW_A],
    'confirming did not actually remove the relay — the control is now decorative');
});
