// RESTORE A NETWORK (F9 / RS-1, owner-approved 2026-11-21): a founder holding the network's 12 words
// regains the network console on a church console. The engine half runs the REAL `restoreNetwork` +
// `_networkKeyProbe` sliced from the SHIPPED vendor/steward.js (only true externals stubbed); the screen
// half compiles the REAL DashNetworksPanel and DRIVES the affordance — a `false &&` on it fails here.
// FAIL-CLOSED pin: an unanswered probe REFUSES (opposite polarity to adoptChurch's refusal, which errs
// open) — storing a random phrase as an owned network is the worse error.
// Run: node --test scripts/restore-a-network.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { miniReact, find, texts } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

function slice(anchor) {
  const at = BUNDLE.indexOf(anchor);
  assert.notEqual(at, -1, anchor + ' is gone from the shipped bundle');
  let depth = 0, started = false;
  for (let i = at; i < BUNDLE.length; i++) {
    const c = BUNDLE[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}' && started && --depth === 0) return BUNDLE.slice(at, i + 1);
  }
  assert.fail('unbalanced slice for ' + anchor);
}

const WORDS = generateSeedWords();
const NP = getPublicKey(privateKeyFromSeedWords(WORDS));

// The shipped restoreNetwork + probe with recording stubs. `held` pre-fills the owned-network store;
// `queryImpl` is the relay's answer. saveNetKey RECORDS — nothing may reach it unverified.
function rig(opts) {
  const calls = { saved: [], events: [], query: [] };
  const holder = { Steward: {}, dispatchEvent: (e) => calls.events.push(e && e.type) };
  const q = async (urls, sk, filters, maxWait) => { calls.query.push({ urls, filters }); return opts.queryImpl(); };
  const src = 'return ({' + slice('async _networkKeyProbe(m) {') + ',' + slice('async restoreNetwork(mnemonic) {') + '});';
  const S = new Function('privateKeyFromSeedWords', 'getPublicKey', 'getPublicKey2', 'getPublicKey3',
    'npubEncode', 'npubEncode2', '_queryAsKey', 'relays', 'relaysRaw', 'CANONICAL_RELAYS', 'NETWORK_D', 'NETKEY_D',
    'netKeys', 'saveNetKey', 'CustomEvent', 'window',
    src)(privateKeyFromSeedWords, getPublicKey, getPublicKey, getPublicKey,
    npubEncode, npubEncode, q, () => ['ws://127.0.0.1:1/relay'], () => [], ['wss://canonical/relay'],
    'trinityone/network:', 'trinityone/netkey:',
    () => (opts.held || []), (rec) => calls.saved.push(rec), class { constructor(t) { this.type = t; } }, holder);
  holder.Steward._networkKeyProbe = (m) => S._networkKeyProbe(m);
  return { S, calls };
}

test('valid network words on an answering relay: stored once, named from the network’s kind-0, switcher event fired', async () => {
  const { S, calls } = rig({
    queryImpl: () => ({
      events: [
        { id: 'k', kind: 30078, pubkey: NP, tags: [['d', 'trinityone/netkey:' + NP]] },
        { id: 'p', kind: 0, pubkey: NP, created_at: 10, content: JSON.stringify({ name: 'Thames Churches' }) },
      ], complete: true,
    }),
  });
  const r = await S.restoreNetwork(WORDS.toUpperCase() + '  ');   // normalisation is the shipped code's job
  assert.equal(r.ok, true);
  assert.equal(r.name, 'Thames Churches', 'the confirmation must carry the network’s own name');
  assert.equal(r.npub, npubEncode(NP));
  assert.equal(calls.saved.length, 1, 'exactly one store write');
  assert.equal(calls.saved[0].pub, NP);
  assert.equal(calls.saved[0].mnemonic, WORDS, 'the normalised words reach the store and nothing else');
  assert.deepEqual(calls.events, ['steward-networks'], 'the switcher relies on this event to re-read ownedNetworks');
});

test('FAIL-CLOSED: an unanswered probe refuses with the try-again reason and stores NOTHING', async () => {
  const { S, calls } = rig({ queryImpl: () => ({ events: [], complete: false }) });
  const r = await S.restoreNetwork(WORDS);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'relay', 'an unanswered check is its own stage — not "not a network"');
  assert.match(r.reason, /Couldn.t check|try again/i);
  assert.equal(calls.saved.length, 0, 'an unverified phrase must never reach the owned-network store');
});

test('words that are provably NOT a network’s are refused with the church pointer, nothing stored', async () => {
  const { S, calls } = rig({ queryImpl: () => ({ events: [], complete: true }) });
  const r = await S.restoreNetwork(WORDS);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'verify');
  assert.match(r.reason, /not a network/i);
  assert.equal(calls.saved.length, 0);
});

test('idempotent: an already-held network says so and the store is untouched', async () => {
  const { S, calls } = rig({ held: [{ pub: NP, name: 'Thames Churches' }], queryImpl: () => ({ events: [], complete: false }) });
  const r = await S.restoreNetwork(WORDS);
  assert.equal(r.ok, true);
  assert.equal(r.already, true);
  assert.equal(r.name, 'Thames Churches');
  assert.equal(calls.saved.length, 0, 'restoring twice must not rewrite the key');
  assert.equal(calls.query.length, 0, 'a held key needs no relay round-trip');
});

test('a short or invalid phrase never reaches the relay probe', async () => {
  const { S, calls } = rig({ queryImpl: () => ({ events: [], complete: true }) });
  const r = await S.restoreNetwork('only five words right here');
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'words');
  assert.equal(calls.query.length, 0);
  assert.equal(calls.saved.length, 0);
});

// ── the screen: the REAL DashNetworksPanel, compiled and driven ─────────────────────────────────────────
function panelRig(restoreImpl) {
  const src = fnBody(DASH, 'function stewNetView(church) {', 'stewNetView')
    + '\n' + fnBody(DASH, 'function DashNetworksPanel() {', 'DashNetworksPanel');
  const tmp = join(tmpdir(), 'netrestore-' + process.pid + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashNetworksPanel };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const calls = [];
  const globals = {
    React,
    Icon: () => null,
    Panel: ({ children }) => React.createElement('div', {}, children),
    useStewDialog: () => ({ current: null }),
    NetworkRow: () => null,
    NetworkAnnounceComposer: () => null,
    publishErrorMessage: () => ({ msg: '' }),
    window: {
      NETWORKS_ENABLED: true,
      useStewardNetworks: () => [],
      useStewardChurch: () => ({ isNetwork: false }),
      addEventListener: () => {}, removeEventListener: () => {},
      Steward: {
        restoreNetwork: async (w) => { calls.push(w); return restoreImpl(w); },
        resolveNetwork: async () => null,
        subscribeNetworkProfile: () => () => {},
      },
    },
  };
  const fn = new Function(...Object.keys(globals), js.replace(/export\s*\{\s*DashNetworksPanel\s*\};?/, 'return DashNetworksPanel;'));
  const Comp = fn(...Object.values(globals));
  return { React, draw, Comp, calls };
}

test('POINT OF USE: the panel’s restore affordance drives Steward.restoreNetwork and shows the named confirmation', async () => {
  const { draw, Comp, calls } = panelRig(async () => ({ ok: true, name: 'Thames Churches', npub: 'npub1x' }));
  let tree = draw(Comp, {});
  const opener = find(tree, n => n.type === 'button' && /Restore a network/.test(texts(n).join(' ')));
  assert.ok(opener.length, 'the Restore a network affordance is gone from the panel');
  opener[0].props.onClick();
  tree = draw(Comp, {});
  const ta = find(tree, n => n.type === 'textarea');
  assert.ok(ta.length, 'no words box after opening the restore flow');
  ta[0].props.onChange({ target: { value: 'w '.repeat(12).trim() } });
  tree = draw(Comp, {});
  const go = find(tree, n => n.type === 'button' && /Restore network/.test(texts(n).join(' ')));
  assert.ok(go.length);
  go[0].props.onClick();
  await new Promise(r => setImmediate(r));
  tree = draw(Comp, {});
  assert.equal(calls.length, 1, 'the screen never called the engine');
  const all = texts(tree).join(' ');
  assert.ok(/Thames Churches/.test(all) && /Tap to switch view/.test(all),
    'the confirmation must name the network and point at the switcher');
});

test('POINT OF USE: an engine refusal is shown in the panel’s error slot, and the words stay for retry', async () => {
  const { draw, Comp, calls } = panelRig(async () => ({ ok: false, stage: 'relay', reason: 'Couldn’t check these words with your relay — nothing has been added. Try again when your relay answers.' }));
  let tree = draw(Comp, {});
  find(tree, n => n.type === 'button' && /Restore a network/.test(texts(n).join(' ')))[0].props.onClick();
  tree = draw(Comp, {});
  find(tree, n => n.type === 'textarea')[0].props.onChange({ target: { value: 'w '.repeat(12).trim() } });
  tree = draw(Comp, {});
  find(tree, n => n.type === 'button' && /Restore network/.test(texts(n).join(' ')))[0].props.onClick();
  await new Promise(r => setImmediate(r));
  tree = draw(Comp, {});
  assert.equal(calls.length, 1);
  assert.ok(/Couldn.t check these words/.test(texts(tree).join(' ')), 'the refusal reason must reach the screen');
  const ta = find(tree, n => n.type === 'textarea');
  assert.ok(ta.length && /w w/.test(ta[0].props.value || ''), 'a refusal must not clear what the founder typed');
});
