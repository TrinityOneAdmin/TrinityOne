// A RELAY SAVED BY NAME FOLLOWS ITS BOX WHEN THE TUNNEL ADDRESS CHURNS — AND ONLY THAT BOX.
// Run: node --test scripts/a-named-relay-follows-and-pins-its-box.test.mjs
//
// SPEC-relay-self-healing-2026-11-03 §1 (audit-corrected item 1 + item 7). refreshNamedRelays/relayNameFor
// were correct; the break was upstream — the name→row binding (NAMES_LS) was created by connect-by-name
// ALONE, so a box that entered the list another way recorded no name and refreshNamedRelays
// (`if (!named.length) return`) was inert for it. This proves the two halves the binding drives:
//   · FOLLOW: given a binding, a directory url-change IS swapped on the refresh tick and relayNameFor labels
//     the new address (the rendered row follows).
//   · PIN (rule 10 / item 7): rememberRelayName now stores the proved key, and refreshNamedRelays refuses the
//     swap unless BOTH the directory record's pub AND a fresh proof at the new address equal the pinned key —
//     so a re-pointed handle can never silently swing the church onto a DIFFERENT box.
//
// POINT OF USE (CLAUDE.md rule 1): the REAL rememberRelayName, refreshNamedRelays and relayNameFor are lifted
// out of src/steward.src.js and RUN against an in-memory store. Delete the pin and tests 3–4 go red; delete
// the follow and test 2 goes red. Binds no port, spawns nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'src/steward.src.js'), 'utf8');

const normRelay = new Function(fnBody(SRC, 'function normRelay(', 'normRelay') + '\nreturn normRelay;')();

const KEY = 'a'.repeat(64);        // the box's real identity key (what the binding pins)
const OTHER = 'd'.repeat(64);      // some other box's key — a re-point must never swap onto this
const OLD = 'wss://old-tunnel.example/relay';
const NEW = 'wss://new-tunnel.example/relay';

// A store and the real functions that read/write it, wired together through one scope.
function world({ named = [], extra = [], resolve = null, proved = null } = {}) {
  const store = { named: named.slice(), extra: extra.slice() };
  const scope = {
    normRelay,
    getNamedRelays: () => store.named,
    setNamedRelays: (a) => { store.named = a; },
    extraRelays: () => store.extra,
    _writeExtraRelays: (list) => { store.extra = [...new Set(list.filter(Boolean))]; },
    resolveRelayName: async (name) => (resolve ? resolve(name) : null),
    verifyRelayIdentity: async (u) => (proved ? proved(u) : null),
    admitRemoteRelay: async () => true,
    isSharedRelaySpelling: () => false,
    window: { Steward: { publishRelayList: () => {} } },
    _refreshingNames: false,
  };
  // Object-method shorthands (`name(args) {`) are not statements on their own, so lift them as function
  // declarations by prefixing `function `; the `async function …` declaration is already valid as-is.
  const mk = (anchor, name, prefix = 'function ') => {
    const params = Object.keys(scope);
    return new Function(...params, prefix + fnBody(SRC, anchor, name) + `\nreturn ${name};`)(...params.map(p => scope[p]));
  };
  const rememberRelayName = mk('rememberRelayName(name, url, pub) {', 'rememberRelayName');
  const relayNameFor = mk('relayNameFor(url) {', 'relayNameFor');
  const refreshNamedRelays = mk('async function refreshNamedRelays(', 'refreshNamedRelays', '');
  return { store, rememberRelayName, relayNameFor, refreshNamedRelays };
}

test('rememberRelayName persists the proved key (item 7), and drops a malformed one', () => {
  const w = world();
  w.rememberRelayName('My Box', OLD, KEY);
  assert.deepEqual(w.store.named, [{ name: 'my-box', url: OLD, pub: KEY }], 'the pubkey was not pinned on the binding');
  w.rememberRelayName('nopub', OLD, 'not-a-key');
  assert.equal(w.store.named.find(e => e.name === 'nopub').pub, undefined, 'a non-hex pub must not be stored as a pin');
});

test('FOLLOW: a directory url-change is swapped on the tick and relayNameFor labels the new address', async () => {
  const w = world({
    named: [{ name: 'box', url: OLD, pub: KEY }],
    extra: [OLD],
    resolve: () => ({ url: NEW, pub: KEY }),
    proved: () => ({ relayPub: KEY }),
  });
  await w.refreshNamedRelays();
  assert.deepEqual(w.store.extra, [NEW], 'the row did not follow the box to its new tunnel address');
  assert.equal(w.store.named[0].url, NEW, 'the binding was not updated to the live address');
  assert.equal(w.relayNameFor(NEW), 'box', 'the rendered row would show a raw address, not the box name');
  assert.equal(w.relayNameFor(OLD), '', 'the dead address still labels as the box');
});

test('PIN: a handle re-pointed to a DIFFERENT box (directory pub mismatch) is refused — no swap', async () => {
  const w = world({
    named: [{ name: 'box', url: OLD, pub: KEY }],
    extra: [OLD],
    resolve: () => ({ url: NEW, pub: OTHER }),   // the directory now points this name at another key
    proved: () => ({ relayPub: OTHER }),
  });
  await w.refreshNamedRelays();
  assert.deepEqual(w.store.extra, [OLD], 'the church was swung onto a box it never pinned — rule 10 breach');
  assert.equal(w.store.named[0].url, OLD, 'the binding followed a re-point to a different key');
});

test('PIN: the directory agrees but the box at the new address proves a DIFFERENT key — refused', async () => {
  const w = world({
    named: [{ name: 'box', url: OLD, pub: KEY }],
    extra: [OLD],
    resolve: () => ({ url: NEW, pub: KEY }),      // record says the right key…
    proved: () => ({ relayPub: OTHER }),          // …but the box answering there is not it
    });
  await w.refreshNamedRelays();
  assert.deepEqual(w.store.extra, [OLD], 'the swap trusted the directory record without re-proving the box');
});

test('ARM ON AUTO-FIND: connectFoundRelays remembers each picked box by its handle, so it can follow', async () => {
  // Auto-find rows carry the directory HANDLE (discoverRelayOffers). Connecting one must arm the name binding
  // or the box would render as a raw address and never follow when its tunnel churned — the same root defect
  // as the adoption path. The key is not known here (the offers directory carries no pub), so the binding is
  // un-pinned; admitRemoteRelay still gates every swap, and the next adoption pass upgrades it to pinned.
  const remembered = [];
  const scope = {
    window: { Steward: {
      addRelay: () => '',
      rememberRelayName: (name, url, pub) => remembered.push([name, url, pub]),
      publishRelayList: async () => null,
    } },
  };
  const names = Object.keys(scope);
  const connectFoundRelays = new Function(...names, 'async function ' + fnBody(SRC, 'connectFoundRelays(picks) {', 'connectFoundRelays') + '\nreturn connectFoundRelays;')(...names.map(n => scope[n]));
  await connectFoundRelays([{ url: NEW, name: 'w-relay-starter-005' }, { url: 'wss://x/relay' }]);
  assert.deepEqual(remembered, [['w-relay-starter-005', NEW, undefined]],
    'auto-find did not remember the picked box by name (or invented a name for a nameless pick)');
});

test('BACK-COMPAT: an entry saved before pinning (no pub) still follows on an admitted swap', async () => {
  const w = world({
    named: [{ name: 'legacy', url: OLD }],       // no pinned key
    extra: [OLD],
    resolve: () => ({ url: NEW, pub: KEY }),
    proved: () => ({ relayPub: KEY }),
  });
  await w.refreshNamedRelays();
  assert.deepEqual(w.store.extra, [NEW], 'a legacy un-pinned binding stopped following — a regression for existing consoles');
});
