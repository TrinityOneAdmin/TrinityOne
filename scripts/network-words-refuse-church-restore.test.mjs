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
function rig(opts) {
  const { queryImpl } = opts;
  const calls = { restore: [], query: [] };
  const holder = { Steward: {} };
  const q = async (urls, sk, filters, maxWait) => { calls.query.push({ urls, filters, maxWait }); return queryImpl(); };
  // _phraseIsNetworkKey now delegates to _networkKeyProbe (F9 split the rich answer out for
  // restoreNetwork), so the probe rides along in the slice and is wired on the holder below.
  const src = 'return ({' + slice('async _networkKeyProbe(m) {') + ',' + slice('async _phraseIsNetworkKey(m) {') + ',' + slice('async adoptChurch(payload) {') + '});';
  const S = new Function('privateKeyFromSeedWords', 'getPublicKey', 'getPublicKey2', 'getPublicKey3',
    '_queryAsKey', 'relays', 'relaysRaw', 'CANONICAL_RELAYS', 'NETWORK_D', 'NETKEY_D', 'window',
    src)(privateKeyFromSeedWords, getPublicKey, getPublicKey, getPublicKey,
    q, opts.relaysImpl || (() => ['ws://127.0.0.1:1/relay']), opts.relaysRawImpl || (() => []), ['wss://canonical/relay'], NETWORK_D, 'trinityone/netkey:', holder);
  holder.Steward._networkKeyProbe = (m) => S._networkKeyProbe(m);
  holder.Steward._phraseIsNetworkKey = (m) => S._phraseIsNetworkKey(m);
  holder.Steward.restoreKey = (m) => { calls.restore.push(m); return { npub: 'npub1test' }; };
  return { S, calls };
}

const WORDS = generateSeedWords();
const NP = getPublicKey(privateKeyFromSeedWords(WORDS));
const NETKEY_DOC = 'trinityone/netkey:' + NP;
// the ONE document that marks a key as a network's: its own netkey doc, signed by itself
const ownNetkey = (extra) => ({ id: 'k', kind: 30078, pubkey: NP, tags: [['d', NETKEY_DOC]], ...(extra || {}) });
const OTHER = getPublicKey(privateKeyFromSeedWords(generateSeedWords()));   // a co-tenant church's key

test('network words are REFUSED: nothing restored, the error says where the network console lives', async () => {
  const { S, calls } = rig({ queryImpl: () => ({ events: [ownNetkey()], complete: true }) });
  await assert.rejects(() => S.adoptChurch(WORDS), (e) => e.networkKey === true && /Network console/.test(e.message)
    && /nothing has been restored/i.test(e.message));
  assert.equal(calls.restore.length, 0, 'restoreKey ran for a network key — the church console will boot on it');
  // control that the rig asked the real question: the shipped code derived THIS phrase's pubkey and asked
  // for ITS network declaration — a broken derivation or a stubbed-over guard both fail here.
  assert.equal(calls.query.length, 1);
  // RS-3 (2026-11-21): the join-declaration filter alone failed LIVE — the relay's N5c gate can withhold
  // every join doc from the derived key, and the detection fell open. The FIRST filter must be the
  // network's own self-authored netkey doc, which the own-events read rule serves unconditionally.
  assert.deepEqual(calls.query[0].filters[0], { kinds: [30078], authors: [NP], '#d': ['trinityone/netkey:' + NP], limit: 2 },
    'the self-authored netkey signal is gone — detection depends on the gated join docs again (RS-3)');
  // slice3-F1 (2026-11-21): the author-unconstrained join-declaration filter is GONE from the question —
  // every filter asked is pinned to the derived key as author, so nothing a third party wrote is fetched.
  assert.equal(calls.query[0].filters.length, 2);
  for (const f of calls.query[0].filters) assert.deepEqual(f.authors, [NP], 'a filter with no author pin is back in the probe');
  assert.ok(!JSON.stringify(calls.query[0].filters).includes(NETWORK_D), 'the forgeable join declaration is being asked for again');
});

test('a KEYLESS console (relays() empty — the ?adopt= page-load state) still asks the canonical relays and refuses', async () => {
  // Re-sim RS-3 round two (2026-11-21): at page load the gate-admitted set is [], the old probe asked
  // nobody, answered instantly with nothing, and the check fell open — the church console booted as the
  // network with no relay ever consulted. The probe set now falls back to configured + CANONICAL.
  const { S, calls } = rig({
    relaysImpl: () => [], relaysRawImpl: () => [],
    queryImpl: () => ({ events: [ownNetkey()], complete: true }),
  });
  await assert.rejects(() => S.adoptChurch(WORDS), (e) => e.networkKey === true);
  assert.deepEqual(calls.query[0].urls, ['wss://canonical/relay'],
    'the keyless probe did not fall back to the canonical relays — page-load adopts are unguarded again');
  assert.equal(calls.restore.length, 0);
});

test('a rig that serves ONLY the self-authored netkey doc still refuses (the live RS-3 shape)', async () => {
  const { S, calls } = rig({ queryImpl: () => ({ events: [{ id: 'k', kind: 30078, pubkey: NP, tags: [['d', 'trinityone/netkey:' + NP]] }], complete: true }) });
  await assert.rejects(() => S.adoptChurch(WORDS), (e) => e.networkKey === true);
  assert.equal(calls.restore.length, 0, 'the N5c-gated rig booted the church console again (RS-3 live failure)');
});

test('a tombstoned netkey document still marks the key as a network’s (any copy counts)', async () => {
  const { S, calls } = rig({ queryImpl: () => ({ events: [ownNetkey({ content: '', tags: [['d', NETKEY_DOC], ['deleted', '1']] })], complete: true }) });
  await assert.rejects(() => S.adoptChurch(WORDS), (e) => e.networkKey === true);
  assert.equal(calls.restore.length, 0);
});

// ── slice3-F1 (integration audit 2026-11-21): the refusal must not be forgeable by a co-tenant church ────
// A join declaration `network:<np>` is written by the JOINING church under ITS key, and the relay takes one
// from any registered church for any np. Counted as evidence, one such document made a genuine church's
// word-restore refuse. Each row hands the shipped probe exactly what a hostile or sloppy relay could.
test('FORGED: a network:<victim> join declaration authored by ANOTHER church does not refuse a genuine church restore', async () => {
  const forged = { id: 'f', kind: 30078, pubkey: OTHER, tags: [['d', NETWORK_D + NP], ['p', NP]], content: '{"joined":true,"v":1}' };
  const { S, calls } = rig({ queryImpl: () => ({ events: [forged], complete: true }) });
  const r = await S.adoptChurch(WORDS);
  assert.equal(r.npub, 'npub1test', 'a co-tenant church’s forged join declaration blocked this church’s restore');
  assert.deepEqual(calls.restore, [WORDS]);
  assert.equal(await S._phraseIsNetworkKey(WORDS), false);
});

test('FORGED: a netkey:<victim> d-tag under ANOTHER author, or the victim’s own event under another d-tag, is not evidence', async () => {
  const wrongAuthor = { id: 'a', kind: 30078, pubkey: OTHER, tags: [['d', NETKEY_DOC]] };
  const wrongDoc = { id: 'b', kind: 30078, pubkey: NP, tags: [['d', 'trinityone/joinpolicy:' + NP]] };   // an ordinary church document
  const joinBySelf = { id: 'c', kind: 30078, pubkey: NP, tags: [['d', NETWORK_D + NP]] };
  const bare = { id: 'd', kind: 30078 };
  const { S, calls } = rig({ queryImpl: () => ({ events: [wrongAuthor, wrongDoc, joinBySelf, bare], complete: true }) });
  assert.equal((await S._networkKeyProbe(WORDS)).network, false, 'the decision does not check author AND d-tag itself');
  await S.adoptChurch(WORDS);
  assert.deepEqual(calls.restore, [WORDS]);
  // control, same rig shape: add the one real document and the same call refuses
  const { S: S2, calls: c2 } = rig({ queryImpl: () => ({ events: [wrongAuthor, wrongDoc, joinBySelf, bare, ownNetkey()], complete: true }) });
  await assert.rejects(() => S2.adoptChurch(WORDS), (e) => e.networkKey === true);
  assert.equal(c2.restore.length, 0);
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
