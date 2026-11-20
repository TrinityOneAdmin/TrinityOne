// A NETWORK's recovery words must not boot a church console (sim 2026-11-20 D2). Executes the REAL
// `_phraseIsNetworkKey` + `adoptChurch` sliced out of the SHIPPED vendor/steward.js — only the true
// externals are stubbed (the relay read, restoreKey); the refusal logic, derivation, prefix handling and
// the fail-open decision run as shipped. Run: node --test scripts/network-words-refuse-church-restore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { getPublicKey } from 'nostr-tools/pure';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const NETWORK_D = 'trinityone/network:';

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

// Build the two shipped methods with injected externals. The crypto names are supplied under EVERY
// identifier esbuild may have used, all pointing at the real nostr-tools functions, so the derivation
// inside is genuine whatever the rename.
function rig({ queryImpl }) {
  const calls = { restore: [], query: [] };
  const holder = { Steward: {} };
  const q = async (urls, sk, filters, maxWait) => { calls.query.push({ urls, filters, maxWait }); return queryImpl(); };
  const src = 'return ({' + slice('async _phraseIsNetworkKey(m) {') + ',' + slice('async adoptChurch(payload) {') + '});';
  const S = new Function('privateKeyFromSeedWords', 'getPublicKey', 'getPublicKey2', 'getPublicKey3',
    '_queryAsKey', 'relays', 'NETWORK_D', 'window',
    src)(privateKeyFromSeedWords, getPublicKey, getPublicKey, getPublicKey,
    q, () => ['ws://127.0.0.1:1/relay'], NETWORK_D, holder);
  holder.Steward._phraseIsNetworkKey = (m) => S._phraseIsNetworkKey(m);
  holder.Steward.restoreKey = (m) => { calls.restore.push(m); return { npub: 'npub1test' }; };
  return { S, calls };
}

const WORDS = generateSeedWords();
const NP = getPublicKey(privateKeyFromSeedWords(WORDS));

test('network words are REFUSED: nothing restored, the error says where the network console lives', async () => {
  const { S, calls } = rig({ queryImpl: () => ({ events: [{ id: 'x' }], complete: true }) });
  await assert.rejects(() => S.adoptChurch(WORDS), (e) => e.networkKey === true && /Network console/.test(e.message)
    && /nothing has been restored/i.test(e.message));
  assert.equal(calls.restore.length, 0, 'restoreKey ran for a network key — the church console will boot on it');
  // control that the rig asked the real question: the shipped code derived THIS phrase's pubkey and asked
  // for ITS network declaration — a broken derivation or a stubbed-over guard both fail here.
  assert.equal(calls.query.length, 1);
  assert.deepEqual(calls.query[0].filters[0]['#d'], [NETWORK_D + NP]);
});

test('a tombstoned network declaration still marks the key as a network’s (any copy counts)', async () => {
  const { S, calls } = rig({ queryImpl: () => ({ events: [{ content: '', tags: [['deleted', '1']] }], complete: true }) });
  await assert.rejects(() => S.adoptChurch(WORDS), (e) => e.networkKey === true);
  assert.equal(calls.restore.length, 0);
});

test('a church’s words proceed to restoreKey unchanged (control)', async () => {
  const { S, calls } = rig({ queryImpl: () => ({ events: [], complete: true }) });
  const r = await S.adoptChurch('trinityone-church:' + WORDS);
  assert.equal(r.npub, 'npub1test');
  assert.deepEqual(calls.restore, [WORDS], 'the prefix was not stripped, or restoreKey never ran');
});

test('an unanswerable detection read FAILS OPEN — the restore proceeds (conductor decision 2026-11-20)', async () => {
  const { S, calls } = rig({ queryImpl: () => { throw new Error('no relay answered'); } });
  await S.adoptChurch(WORDS);
  assert.deepEqual(calls.restore, [WORDS], 'an offline restore was blocked — fail-open was the decided behaviour');
});

test('a bad phrase is still restoreKey’s error, not swallowed by the guard', async () => {
  const { S, calls } = rig({ queryImpl: () => ({ events: [], complete: true }) });
  await S.adoptChurch('definitely not twelve words');
  assert.equal(calls.restore.length, 1, 'the guard swallowed the phrase instead of letting restoreKey validate it');
});
