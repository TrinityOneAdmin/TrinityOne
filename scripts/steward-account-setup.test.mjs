// SET UP ACCOUNTS — pre-minted member accounts handed over as printed QR sign-in slips (plan v3).
//   Run: node --test scripts/steward-account-setup.test.mjs
//
// WHAT IS REAL HERE. The engine functions are sliced out of the SHIPPED vendor/steward.js by brace-match
// and run with the bundle's own identifier names (esbuild renames imports: nip44e is `encrypt2`, nip44ck is
// `getConversationKey`, getPublicKey is `getPublicKey2`, finalizeEvent is `finalizeEvent2` — measured on
// this bundle, and a wrong name lands in a catch and fails invisibly, so the scope Proxy THROWS on any name
// without a stub). The injected crypto is the real nostr-tools, so the sealing round-trip below decrypts
// what the shipped code sealed. The modal is the real SetupAccountsModal sliced from app/stew-dashboard.jsx,
// compiled with the same esbuild the packaged build uses, rendered, and DRIVEN by its own handlers — nothing
// in this file matches text in app/*.jsx to claim behaviour (CLAUDE.md rule 3); the two reachability
// assertions at the bottom are existence checks only, and say so.
//
// CONTROL ROWS: the happy-path cases ARE the controls — a broken rig (a missing injected name, a dead
// classifier) fails them, which is what tells a broken rig from a broken product.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, button, texts } from './render-jsx-screen.mjs';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { encrypt as nip44e, decrypt as nip44d, getConversationKey as nip44ck } from 'nostr-tools/nip44';
import { npubEncode } from 'nostr-tools/nip19';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const IDENTITY = readFileSync(join(ROOT, 'app/identity.jsx'), 'utf8');
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

// lift a free-standing function or an object-literal METHOD out of a source, with a scope Proxy that throws
// on any free identifier the test did not stub (the invisible-catch trap, memory 2026-09-27)
function lift(src, anchor, name, stubs, { method = false } = {}) {
  const body = fnBody(src, anchor, name);
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      throw new ReferenceError('the lifted ' + name + ' needs `' + String(k) + '` — add a stub');
    },
  });
  const decl = /^(const|let|var|function|async function)\b/.test(body.trim());
  const src2 = method
    ? `with (scope) { return ({ ${body} })${JSON.stringify([name])[0] === '[' ? '' : ''}['${name}']; }`
    : (decl ? `with (scope) { ${body}\n; return ${name}; }` : `with (scope) { return (${body}); }`);
  return new Function('scope', src2)(scope);
}

const CHURCH_WORDS = 'ridge lunar absent gospel timber olive candle harvest meadow bishop anchor kindle';
const MEMBER_WORDS = 'trim stadium message bicycle napkin bleak slow life wool total sand cost';
const churchSk = privateKeyFromSeedWords(CHURCH_WORDS);
const churchPub = getPublicKey(churchSk);

// the bundle-named crypto every engine lift shares (measured names — see the header)
const CRYPTO = {
  privateKeyFromSeedWords,
  getPublicKey2: getPublicKey,
  finalizeEvent2: finalizeEvent,
  encrypt2: nip44e,
  getConversationKey: nip44ck,
  npubEncode,
  NET: 'trinityone',
  now: () => 1763600000,
};

// ── the slip's URL round-trips through the scanner, church half intact ───────────────────────────────────
test('a printed slip is a code the scanner reads: seed out, church half intact, fragment gone', () => {
  const memberInviteUrl = lift(BUNDLE, 'memberInviteUrl(mnemonic) {', 'memberInviteUrl', {
    window: { Steward: { joinUrl: () => 'https://app.trinityone.church/?follow=npub1abc&relay=wss%3A%2F%2Ftun.example%2Frelay&relayname=grace-city' } },
  }, { method: true });
  const seedFromScan = lift(IDENTITY, 'const seedFromScan = (text) => {', 'seedFromScan', {});
  const url = memberInviteUrl(MEMBER_WORDS);
  const r = seedFromScan(url);
  assert.equal(r.seed, MEMBER_WORDS, 'the scanner cannot read the slip this feature prints');
  assert.equal(r.src, 'https://app.trinityone.church/?follow=npub1abc&relay=wss%3A%2F%2Ftun.example%2Frelay&relayname=grace-city',
    'the church half must pass through VERBATIM — ?relayname= is what keeps a printed slip alive after the tunnel address rotates');
  assert.ok(!r.src.includes('#') && !r.src.includes('invite'),
    'the fragment must be STRIPPED: the engine reads [?&]relay= to the next &, so a trailing fragment would carry the seed into the relay address');
});

// ── createMemberAccount: the three documents, sealed name both keys can open, join as a gate ─────────────
function liftCreateAccount(sendLog, { failJoin = false, failName = false } = {}) {
  const _quietSend = async (evt) => {
    sendLog.push(evt);
    const d = ((evt.tags || []).find(t => t[0] === 'd') || [])[1] || (evt.kind === 0 ? 'k0' : '');
    if (failJoin && /^trinityone\/member:/.test(d)) return { ok: false, reason: 'refused by test' };
    if (failName && /^trinityone\/name:/.test(d)) return { ok: false, reason: 'refused by test' };
    return { ok: true };
  };
  return lift(BUNDLE, 'async createMemberAccount(name, opts) {', 'createMemberAccount',
    { ...CRYPTO, _quietSend, actingChurch: '', pub: churchPub }, { method: true });
}

test('createMemberAccount publishes join, kind-0 and a sealed name BOTH the church and the member can open', async () => {
  const log = [];
  const create = liftCreateAccount(log);
  const r = await create('Tamsin Oyelaran', { mnemonic: MEMBER_WORDS });
  assert.equal(r.ok, true, 'control row: the happy path must pass, or the rig is broken');
  assert.equal(r.attempted, true);
  const memberSk = privateKeyFromSeedWords(MEMBER_WORDS);
  const memberPub = getPublicKey(memberSk);
  assert.equal(r.pubkey, memberPub);
  assert.equal(log.length, 3, 'join + kind-0 + sealed name');
  const dOf = (e) => ((e.tags || []).find(t => t[0] === 'd') || [])[1] || '';
  // join FIRST — the relay refuses a name from a pubkey it does not know is a member
  assert.equal(dOf(log[0]), 'trinityone/member:' + churchPub);
  assert.ok(log[0].tags.some(t => t[0] === 'p' && t[1] === churchPub));
  assert.equal(log[0].pubkey, memberPub, 'the join is signed by the MEMBER key, not the church');
  assert.ok(verifyEvent(log[0]), 'the join signature must verify');
  const k0 = log.find(e => e.kind === 0);
  assert.ok(k0 && k0.content === '{}' && k0.pubkey === memberPub, 'an EMPTY kind-0 — a name there would be a guessable cleartext lookup handle');
  const nameDoc = log.find(e => dOf(e) === 'trinityone/name:' + churchPub);
  assert.ok(nameDoc && verifyEvent(nameDoc));
  const { c, m } = JSON.parse(nameDoc.content);
  assert.equal(JSON.parse(nip44d(c, nip44ck(churchSk, memberPub))).name, 'Tamsin Oyelaran', 'the CHURCH key must open its copy');
  assert.equal(JSON.parse(nip44d(m, nip44ck(memberSk, memberPub))).name, 'Tamsin Oyelaran', 'the MEMBER key must open its own recovery copy');
});

test('a failed join publishes NOTHING else, and a failed name reports failure', async () => {
  const log1 = [];
  const r1 = await liftCreateAccount(log1, { failJoin: true })('Ben', { mnemonic: MEMBER_WORDS });
  assert.equal(r1.ok, false);
  assert.equal(r1.attempted, true, 'a refused join may still have landed — the tombstone path needs to know it was ATTEMPTED');
  assert.equal(log1.length, 1, 'the join is a GATE: kind-0 and name must not go out over a failed join');
  const log2 = [];
  const r2 = await liftCreateAccount(log2, { failName: true })('Ben', { mnemonic: MEMBER_WORDS });
  assert.equal(r2.ok, false, 'the sealed name is what the steward reads — without it the account is not usable as created');
  assert.match(r2.reason, /name/);
  const r3 = await liftCreateAccount([])('Ben', {});
  assert.equal(r3.ok, false, 'it must never mint a key itself — the caller owns the key so a retry finishes THIS account');
});

// ── createMemberAccounts: mark FIRST, admit second, joins last — and every refusal fails closed ──────────
function liftBatch(opts) {
  const {
    authed = true, minorsKnown = true, existingMinors = ['oldkidpk'], setMinorsOk = true,
    admittedFresh = true, existingAdmitted = ['oldmemberpk'], setAdmittedOk = true,
  } = opts || {};
  const log = [];
  const steward = {
    readMinors: async () => { log.push(['readMinors']); return { known: minorsKnown, list: existingMinors }; },
    setMinors: (list) => { log.push(['setMinors', list]); return Promise.resolve(setMinorsOk); },
    setAdmitted: (list) => { log.push(['setAdmitted', list]); return Promise.resolve(setAdmittedOk); },
    admittedListFresh: () => admittedFresh,
    createMemberAccount: async (name, o) => {
      log.push(['create', name]);
      const pk = getPublicKey(privateKeyFromSeedWords(o.mnemonic));
      return { ok: true, attempted: true, name, pubkey: pk, npub: 'npub1x', reason: '' };
    },
  };
  const fn = lift(BUNDLE, 'async createMemberAccounts(entries, opts) {', 'createMemberAccounts', {
    ...CRYPTO,
    _waitForRegistration: async () => {},
    relays: () => ['wss://one.example/relay'],
    _isRelayAuthed: () => authed,
    _lastAdmitted: { cp: churchPub, list: existingAdmitted },
    actingChurch: '', pub: churchPub,
    window: { Steward: steward },
  }, { method: true });
  return { fn, log };
}
const W1 = 'ridge lunar absent gospel timber olive candle harvest meadow bishop anchor abandon';
const W2 = 'ridge lunar absent gospel timber olive candle harvest meadow bishop anchor ability';
const W3 = 'ridge lunar absent gospel timber olive candle harvest meadow bishop anchor able';
const W4 = 'ridge lunar absent gospel timber olive candle harvest meadow bishop anchor about';
const pkOf = (w) => getPublicKey(privateKeyFromSeedWords(w));
const BATCH = [
  { name: 'Adult One', mnemonic: W1 },
  { name: 'Child One', mnemonic: W2, isChild: true },
  { name: 'Adult Two', mnemonic: W3 },
  { name: 'Child Two', mnemonic: W4, isChild: true },
];

test('the batch marks children FIRST (one union write), admits everyone second (one write), joins last', async () => {
  const { fn, log } = liftBatch({});
  const out = await fn(BATCH, {});
  assert.equal(out.results.length, 4, 'control row');
  assert.ok(out.results.every(r => r.ok), 'control row: all four must be created');
  const kinds = log.map(l => l[0]);
  assert.deepEqual(kinds, ['readMinors', 'setMinors', 'setAdmitted', 'create', 'create', 'create', 'create'],
    'mark -> admit -> join, in that order, one list-write each — the order reseatMember titles SAFEGUARDING BEFORE ADMISSION');
  const minors = log.find(l => l[0] === 'setMinors')[1];
  assert.ok(minors.includes('oldkidpk'), 'a child ALREADY on the list must survive the batch — a shrunk write un-marks every other child in the church');
  assert.ok(minors.includes(pkOf(W2)) && minors.includes(pkOf(W4)), 'both new children in ONE write — a per-child loop overwrites itself');
  const admitted = log.find(l => l[0] === 'setAdmitted')[1];
  assert.ok(admitted.includes('oldmemberpk'), 'an existing member must survive the admission write');
  for (const w of [W1, W2, W3, W4]) assert.ok(admitted.includes(pkOf(w)));
});

test('a COLD children list refuses every child and only the children', async () => {
  const { fn, log } = liftBatch({ minorsKnown: false });
  const out = await fn(BATCH, {});
  assert.ok(!log.some(l => l[0] === 'setMinors'), 'a cold list must never be written — it would knock every existing child off');
  const kids = out.results.filter(r => BATCH.find(b => b.name === r.name && b.isChild));
  assert.ok(kids.every(r => !r.ok && !r.attempted), 'no child account may exist whose mark did not land (NB2)');
  assert.ok(out.results.filter(r => !BATCH.find(b => b.name === r.name && b.isChild)).every(r => r.ok), 'the adults still go through');
  const admitted = log.find(l => l[0] === 'setAdmitted')[1];
  assert.ok(!admitted.includes(pkOf(W2)) && !admitted.includes(pkOf(W4)), 'an unmarked child must not be admitted either');
});

test('a REFUSED children write excludes ALL children — setMinors is all-or-nothing across relays', async () => {
  const { fn, log } = liftBatch({ setMinorsOk: false });
  const out = await fn(BATCH, {});
  assert.equal(log.filter(l => l[0] === 'setMinors').length, 1);
  const kids = out.results.filter(r => BATCH.find(b => b.name === r.name && b.isChild));
  assert.ok(kids.every(r => !r.ok && !r.attempted));
});

test('an UNAUTHED console publishes joins without admitting, and refuses children outright', async () => {
  const { fn, log } = liftBatch({ authed: false });
  const out = await fn(BATCH, {});
  assert.ok(!log.some(l => l[0] === 'setMinors' || l[0] === 'setAdmitted' || l[0] === 'readMinors'),
    'no list write without auth — an open church makes the joins effective alone, an approval church queues them: fails closed either way');
  assert.ok(out.results.filter(r => !BATCH.find(b => b.name === r.name && b.isChild)).every(r => r.ok));
  const kids = out.results.filter(r => BATCH.find(b => b.name === r.name && b.isChild));
  assert.ok(kids.every(r => !r.ok), '"create them as adults and mark later" is the NB2 gap — children refuse instead');
});

test('a STALE admitted list refuses before ANYTHING is written — the children’s list stays untouched', async () => {
  const { fn, log } = liftBatch({ admittedFresh: false });
  const out = await fn(BATCH, {});
  assert.ok(out.refused, 'the batch must refuse on a stale list');
  assert.equal(out.results.length, 0);
  assert.deepEqual(log, [],
    'no readMinors, no setMinors, no setAdmitted, no join: checked only at the admission step, the children’s marking had already landed, so "nothing has been published yet" was false and an abandoned retry left stray pubkeys on the children’s list (audit F5)');
});

test('a REFUSED admission write still stops the batch before any account is published', async () => {
  const { fn, log } = liftBatch({ setAdmittedOk: false });
  const out = await fn(BATCH, {});
  assert.ok(out.refused, 'the batch must refuse on a refused admission');
  assert.equal(out.results.length, 0);
  assert.ok(!log.some(l => l[0] === 'create'), 'nothing may be published past a failed admission — in an approval church those joins would sit invisible');
  assert.ok(log.some(l => l[0] === 'setMinors'),
    'control: the marking ran first (mark → admit is the safeguarding order) — a refusal HERE may follow a landed mark, which is the safe direction and what the engine’s comment now says');
});

test('a single name goes through the SAME path (no special case), and the batch caps at 200', async () => {
  const one = liftBatch({});
  await one.fn([{ name: 'Only One', mnemonic: W1 }], {});
  assert.deepEqual(one.log.map(l => l[0]), ['setAdmitted', 'create'], 'one entry, same orchestrator: admitted first, then the join');
  const many = liftBatch({});
  const out = await many.fn(Array.from({ length: 220 }, (_, i) => ({ name: 'P' + i, mnemonic: W1 })), {});
  assert.equal(out.results.length, 200);
});

// ── tombstone: name doc withdrawn FIRST, then the member tombstone, leaveMembership's exact shape ────────
test('close-without-print withdraws the name FIRST and then the membership', async () => {
  const log = [];
  const tomb = lift(BUNDLE, 'async tombstoneMemberAccount(mnemonic) {', 'tombstoneMemberAccount',
    { ...CRYPTO, _quietSend: async (e) => { log.push(e); return { ok: true }; }, actingChurch: '', pub: churchPub }, { method: true });
  assert.equal(await tomb(MEMBER_WORDS), true, 'control row');
  assert.equal(log.length, 2);
  const dOf = (e) => ((e.tags || []).find(t => t[0] === 'd') || [])[1] || '';
  assert.equal(dOf(log[0]), 'trinityone/name:' + churchPub, 'name FIRST: its write gate needs the author still in MEMBER_DOCS, which the member tombstone ends');
  assert.equal(dOf(log[1]), 'trinityone/member:' + churchPub);
  for (const e of log) {
    assert.ok(e.tags.some(t => t[0] === 'deleted' && t[1] === '1'), 'the tombstone tag the ingest honours');
    assert.equal(e.content, '', 'empty content — leaveMembership’s shape');
    assert.ok(verifyEvent(e), 'signed by the member key');
  }
});

// ── the quiet sender: the connection-failure string is a FAILURE, success raises no banner ───────────────
test('_quietSend treats the connection-failure resolution as failure and an acceptance as success', async () => {
  const mk = (results) => lift(BUNDLE, 'async function _quietSend(evt) {', '_quietSend', {
    relays: () => results.map((_, i) => 'wss://r' + i + '.example'),
    pool: { publish: () => results.map(r => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r))) },
  });
  assert.deepEqual(await mk(['connection failure: timed out'])({}), { ok: false, reason: 'connection failure: timed out' },
    'nostr-tools RESOLVES this string — treating it as success is the false-reassurance publish() already guards against');
  const ok = await mk(['connection failure: x', ''])({});
  assert.equal(ok.ok, true, 'one genuine acceptance is enough (any-relay, the createChildAccount bar)');
  const refused = await mk([new Error('rejected: not allowed')])({});
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /not allowed/);
});

test('_quietSend clears its 15s timer once the publish settles', async () => {
  const timers = { set: 0, cleared: [] };
  const send = lift(BUNDLE, 'async function _quietSend(evt) {', '_quietSend', {
    relays: () => ['wss://r.example'],
    pool: { publish: () => [Promise.resolve('')] },
    setTimeout: () => { timers.set++; return 'T' + timers.set; },
    clearTimeout: (t) => { timers.cleared.push(t); },
  });
  const r = await send({});
  assert.equal(r.ok, true, 'control row');
  assert.equal(timers.set, 1, 'control row: one timeout was armed');
  assert.deepEqual(timers.cleared, ['T1'],
    'the timer must be CLEARED when the publish settles — left running it held the loop open 15s per event (audit F7)');
});

// ── the scanner hands the church half to followChurch, and a throw cannot strand the sign-in ─────────────
function liftScan(stubs) {
  const seedFromScan = lift(IDENTITY, 'const seedFromScan = (text) => {', 'seedFromScan', {});
  return lift(IDENTITY, 'const doScanSignIn = async (text) => {', 'doScanSignIn', {
    seedFromScan,
    setRErr: () => {}, setScanNonce: () => {}, setRMode: () => {}, setRBusy: () => {},
    rTypedWords: { current: false },
    localStorage: { getItem: () => '[]', setItem: () => {}, removeItem: () => {} },
    window: { confirm: () => true, TrinityIdentity: { importMnemonic: async () => {} } },
    ...stubs,
  });
}
const SLIP = 'https://app.trinityone.church/?follow=npub1abc&relay=wss%3A%2F%2Ftun.example%2Frelay&relayname=grace-city#invite=' + encodeURIComponent(MEMBER_WORDS);

test('doScanSignIn follows the church the slip names, then finishes the restore knowing it did', async () => {
  const calls = [];
  const fin = [];
  await liftScan({ followChurch: (src) => { calls.push(src); return () => {}; }, finishRestore: async (o) => { fin.push(o); } })(SLIP);
  assert.equal(calls.length, 1, 'followChurch must be called for a slip that names a church');
  assert.ok(!calls[0].includes('#') && calls[0].includes('relayname=grace-city'), 'fragment stripped, relayname intact');
  assert.deepEqual(fin, [{ followed: true }]);
});

test('a throwing or absent followChurch cannot strand "Signing in" — the restore still finishes', async () => {
  const fin = [];
  await liftScan({ followChurch: () => { throw new Error('boom'); }, finishRestore: async (o) => { fin.push(o); } })(SLIP);
  assert.deepEqual(fin, [{ followed: false }], 'a throw is contained and reported as not-followed');
  const fin2 = [];
  await liftScan({ followChurch: undefined, finishRestore: async (o) => { fin2.push(o); } })(SLIP);
  assert.deepEqual(fin2, [{ followed: false }], 'an older host without the prop still signs in');
  const fin3 = [], calls3 = [];
  await liftScan({ followChurch: (s) => { calls3.push(s); }, finishRestore: async (o) => { fin3.push(o); } })('  ' + MEMBER_WORDS + '  ');
  assert.equal(calls3.length, 0, 'a bare phrase names no church');
  assert.deepEqual(fin3, [{ followed: false }]);
});

// ── finishRestore({followed}): an empty lookup after a followed slip is first contact, not a dead end ────
// The REAL finishRestore lifted from app/identity.jsx; only its externals are stubbed. setTimeout is stubbed
// to a recorder, so "the reload path was taken" is observed as the scheduled reload, never executed.
function liftFinishRestore(log, { churches = [] } = {}) {
  return lift(IDENTITY, 'const finishRestore = async (opts) => {', 'finishRestore', {
    setRBusy: (s) => log.push(['busy', s]),
    rTypedWords: { current: false },
    setXferStage: (s) => log.push(['xfer', s]),
    setRNoChurch: (v) => log.push(['nochurch', v]),
    localStorage: {
      setItem: (k, v) => log.push(['set', k, v]),
      removeItem: (k) => log.push(['rm', k]),
      getItem: () => null,
    },
    window: {
      Fellowship: { recoverIdentityRetry: async () => ({ churches, name: '' }), toNpub: (x) => 'npub' + x },
      TrinityIdentity: { current: { npub: 'npub1me' } },
    },
    setTimeout: (fn, ms) => log.push(['reload-scheduled', ms]),
  });
}

test('finishRestore: empty lookup + followed slip -> reload into the followed church, restorePending CLEARED', async () => {
  const log = [];
  await liftFinishRestore(log)({ followed: true });
  assert.ok(log.some(l => l[0] === 'set' && l[1] === 'trinityone.onboarded' && l[2] === 'true'),
    'onboarded is written unconditionally, before the branch — losing it bounced restores back to Welcome (2026-07-28)');
  assert.ok(log.some(l => l[0] === 'rm' && l[1] === 'trinityone.restorePending'), 'restorePending must be CLEARED — the follow already set the retry in motion');
  assert.ok(!log.some(l => l[0] === 'set' && l[1] === 'trinityone.restorePending'), 'restorePending must not be re-set on this path');
  assert.ok(log.some(l => l[0] === 'busy' && /Connecting you to your church/.test(l[1])), 'the member is told what is happening');
  assert.ok(log.some(l => l[0] === 'reload-scheduled'), 'the reload path must be taken — the followed church is in app state, the reload lands in it');
  assert.ok(!log.some(l => l[0] === 'nochurch'), 'the no-church dead end must NOT be shown: it would tell the member to scan the code they are holding');
});

test('finishRestore: empty lookup WITHOUT a follow keeps the no-church screen and the retry flag (control)', async () => {
  const log = [];
  await liftFinishRestore(log)({ followed: false });
  assert.ok(log.some(l => l[0] === 'set' && l[1] === 'trinityone.restorePending' && l[2] === '1'), 'a later boot must retry');
  assert.ok(log.some(l => l[0] === 'nochurch'), 'nothing found and nothing followed IS the no-church screen');
  assert.ok(!log.some(l => l[0] === 'reload-scheduled'), 'no reload into nothing');
  const found = [];
  await liftFinishRestore(found, { churches: ['cp1'] })({ followed: true });
  assert.ok(found.some(l => l[0] === 'set' && l[1] === 'trinityone.followedChurches'), 'control: a FOUND church still takes the normal path');
  assert.ok(found.some(l => l[0] === 'reload-scheduled') && !found.some(l => l[0] === 'nochurch'));
});

// ── the CSV parser: headers, quotes, child column — and NEVER an age column ──────────────────────────────
function liftCsv() { return lift(STEW, 'function parseAccountsCsv(txt) {', 'parseAccountsCsv', {}); }

test('the CSV parser reads headered and bare files, quoted commas, and the child column — never age', () => {
  const parse = liftCsv();
  assert.deepEqual(parse('Full Name,Child\n"Smith, John",yes\nMaria Gonzalez,\nLittle Ana,X'),
    [{ name: 'Smith, John', isChild: true }, { name: 'Maria Gonzalez', isChild: false }, { name: 'Little Ana', isChild: true }]);
  assert.deepEqual(parse('Maria Gonzalez\nJohn Park'),
    [{ name: 'Maria Gonzalez', isChild: false }, { name: 'John Park', isChild: false }], 'no header: every line is a name');
  assert.deepEqual(parse('name,age\nAna,9'), [{ name: 'Ana', isChild: false }],
    'an AGE column must never mark a child — TrinityOne does not decide who is a child, the steward marks (DOMAIN.md)');
  assert.deepEqual(parse('person,young person\nTam,true'), [{ name: 'Tam', isChild: true }]);
  // European Excel exports semicolons — the file must parse like a comma file, not become ;-riddled names
  assert.deepEqual(parse('name;child\n"Smith; John";yes\nAna;'),
    [{ name: 'Smith; John', isChild: true }, { name: 'Ana', isChild: false }],
    'semicolon-delimited files must read their header and quoted fields like comma files (audit F9)');
  assert.deepEqual(parse('Ana;9\nBob;10'), [{ name: 'Ana', isChild: false }, { name: 'Bob', isChild: false }],
    '"Ana;9" must never become an account NAMED "Ana;9" (audit F9)');
});

// ── point of use: the REAL modal, rendered and driven end to end ─────────────────────────────────────────
function loadModal({ steward, gate, skPrintableLog }) {
  const { React, draw } = miniReact();
  const src = fnBody(STEW, 'function parseAccountsCsv(txt) {', 'parseAccountsCsv')
    + '\n' + fnBody(STEW, 'function SetupAccountsModal({ onClose, sg, kidPhotosAllowed, nameByPub, delegated }) {', 'SetupAccountsModal');
  const tmp = join(tmpdir(), 'setupmodal-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { SetupAccountsModal };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const CkModal = ({ title, children }) => React.createElement('div', { title }, children);
  const SkConfirm = ({ title, confirmLabel, onConfirm, onCancel }) =>
    React.createElement('div', {}, React.createElement('div', {}, title),
      React.createElement('button', { onClick: onConfirm }, confirmLabel),
      React.createElement('button', { onClick: onCancel }, 'Keep them'));
  const globals = {
    React,
    CkModal, SkConfirm,
    GoPublicNote: () => null, GoPublicPanel: () => React.createElement('div', {}, 'go-public-panel'),
    Icon: () => null,
    useGoPublicGate: () => gate || { blocking: false },
    churchMarkDataUrl: async () => '',
    // Node has no FileReader; a synchronous stand-in lets a test drive the REAL onFile -> parseAccountsCsv
    // -> childMarks path instead of poking state. The fake file carries its text as `__csv`.
    FileReader: class { readAsText(f) { this.result = String((f && f.__csv) || ''); if (this.onload) this.onload(); } },
    window: {
      Steward: steward,
      addEventListener: () => {}, removeEventListener: () => {},
      useStewardChurch: () => ({ name: 'St Hilda’s', accent: '#b4533f' }),
      skPrintable: (html) => { (skPrintableLog || []).push(html); },
    },
  };
  const key = '__setupmodal_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return { React, draw, load: import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')) };
}

const stewardSpy = (log, { results } = {}) => ({
  relayAuthed: () => true,
  mintAccountKey: () => 'word word word word word word word word word word word mint' + (log.push(['mint']), ''),
  createMemberAccounts: async (entries, opts) => {
    log.push(['createMemberAccounts', entries.map(e => ({ name: e.name, isChild: !!e.isChild, hasKey: !!e.mnemonic }))]);
    const rs = results || entries.map(e => ({ ok: true, attempted: true, name: e.name, pubkey: 'pk-' + e.name, isChild: !!e.isChild, mnemonic: e.mnemonic, reason: '' }));
    rs.forEach((r, i) => opts && opts.onProgress && opts.onProgress({ done: i + 1, total: rs.length, current: r.name, ok: r.ok, reason: r.reason }));
    return { results: rs, authed: true, childrenRefused: '' };
  },
  memberInviteUrl: (m) => 'https://app.trinityone.church/?follow=npub1abc#invite=' + encodeURIComponent(m),
  qrSVG: (t) => '<svg data-qr="1"></svg>',
  setNoPhoto: (list) => { log.push(['setNoPhoto', list]); return Promise.resolve(true); },
  tombstoneMemberAccount: async (m) => { log.push(['tombstone', m]); return true; },
});

const typeNames = (tree, value) => {
  const ta = find(tree, n => n.type === 'textarea');
  assert.ok(ta.length, 'the names textarea is gone from the modal');
  ta[0].props.onChange({ target: { value } });
};
const press = (tree, label) => {
  const b = button(tree, label).filter(n => !n.props.disabled);
  assert.ok(b.length, 'no enabled button reads "' + label + '"');
  return b[0].props.onClick();
};

test('POINT OF USE: typing two names and driving the real modal creates two accounts and prints two slips', async () => {
  const log = [], printed = [];
  const steward = stewardSpy(log);
  const { draw, load } = loadModal({ steward, skPrintableLog: printed });
  const { SetupAccountsModal } = await load;
  const props = { onClose: () => log.push(['close']), sg: { loaded: true, nophoto: [] }, kidPhotosAllowed: false, nameByPub: { x: 'Maria Gonzalez' }, delegated: false };
  let tree = draw(SetupAccountsModal, props);
  typeNames(tree, 'Maria Gonzalez\nJohn Park');
  tree = draw(SetupAccountsModal, props);
  assert.ok(texts(tree).join(' ').includes('already a member?'), 'a duplicate of an existing member name must be flagged on its row');
  press(tree, 'Continue with');
  tree = draw(SetupAccountsModal, props);
  assert.ok(texts(tree).join(' ').includes('you will hold the sign-in code'), 'the key-custody warning must stand between typing and creating');
  const run = press(tree, 'Create');
  await run;
  const call = log.find(l => l[0] === 'createMemberAccounts');
  assert.ok(call, 'the engine was never called — the screen is not wired to it');
  assert.deepEqual(call[1], [{ name: 'Maria Gonzalez', isChild: false, hasKey: true }, { name: 'John Park', isChild: false, hasKey: true }],
    'every entry reaches the engine with a key the UI minted — the engine must never mint');
  tree = draw(SetupAccountsModal, props);
  await press(tree, 'Print 2 slips');
  assert.equal(printed.length, 1, 'printing must go through skPrintable');
  assert.ok(printed[0].includes('Maria Gonzalez') && printed[0].includes('John Park') && printed[0].split('data-qr').length === 3,
    'one slip per person, each carrying its QR');
  assert.ok(printed[0].includes('Someone set this up for me'), 'the slip must tell the person the route that reads it');
  tree = draw(SetupAccountsModal, props);
  press(tree, 'Done');
  assert.ok(!log.some(l => l[0] === 'close'), 'pressing Print proves nothing about paper — closing must CONFIRM, never close silently (audit F8)');
  tree = draw(SetupAccountsModal, props);
  assert.ok(texts(tree).join(' ').includes('Did the slips print?'), 'the after-print close asks whether the slips really printed');
  press(tree, 'Yes — close');
  assert.ok(log.some(l => l[0] === 'close'), 'confirming closes');
  assert.ok(!log.some(l => l[0] === 'tombstone'), 'the slips MAY be on paper — closing after Print must NEVER withdraw the accounts');
});

test('POINT OF USE: closing WITHOUT printing warns, and "Close anyway" withdraws every attempted account', async () => {
  const log = [];
  const steward = stewardSpy(log);
  const { draw, load } = loadModal({ steward });
  const { SetupAccountsModal } = await load;
  const props = { onClose: () => log.push(['close']), sg: { loaded: true, nophoto: [] }, kidPhotosAllowed: false, nameByPub: {}, delegated: false };
  let tree = draw(SetupAccountsModal, props);
  typeNames(tree, 'Only One');
  tree = draw(SetupAccountsModal, props);
  press(tree, 'Continue with');
  tree = draw(SetupAccountsModal, props);
  await press(tree, 'Create');
  tree = draw(SetupAccountsModal, props);
  press(tree, 'Close');
  assert.ok(!log.some(l => l[0] === 'close'), 'closing with unprinted slips must NOT close silently');
  tree = draw(SetupAccountsModal, props);
  assert.ok(texts(tree).join(' ').includes('Close without printing?'), 'the warning must say what is about to be lost');
  await press(tree, 'Close anyway');
  assert.equal(log.filter(l => l[0] === 'tombstone').length, 1, 'every ATTEMPTED account is withdrawn — a timed-out publish may have landed');
  assert.ok(log.some(l => l[0] === 'close'));
});

test('POINT OF USE: a successful child write puts the children on the no-photo list (church photos off)', async () => {
  const log = [];
  const steward = stewardSpy(log);
  const { draw, load } = loadModal({ steward });
  const { SetupAccountsModal } = await load;
  const props = { onClose: () => {}, sg: { loaded: true, nophoto: ['already'] }, kidPhotosAllowed: false, nameByPub: {}, delegated: false };
  let tree = draw(SetupAccountsModal, props);
  typeNames(tree, 'Little Ana');
  tree = draw(SetupAccountsModal, props);
  const childBtns = button(tree, 'Child?');
  assert.ok(childBtns.length, 'the per-row child toggle is gone');
  childBtns[0].props.onClick();
  tree = draw(SetupAccountsModal, props);
  press(tree, 'Continue with');
  tree = draw(SetupAccountsModal, props);
  await press(tree, 'Create');
  const np = log.find(l => l[0] === 'setNoPhoto');
  assert.ok(np, 'the owner’s rule: marking a child adds them to the no-photo list');
  assert.deepEqual(np[1], ['already', 'pk-Little Ana'], 'the existing list must survive the write');
});

test('POINT OF USE: a helper console offers no child toggle it can use', async () => {
  const log = [];
  const steward = stewardSpy(log);
  const { draw, load } = loadModal({ steward });
  const { SetupAccountsModal } = await load;
  const props = { onClose: () => {}, sg: { loaded: true, nophoto: [] }, kidPhotosAllowed: false, nameByPub: {}, delegated: true };
  let tree = draw(SetupAccountsModal, props);
  typeNames(tree, 'Some Name');
  tree = draw(SetupAccountsModal, props);
  const toggles = button(tree, 'Child');
  assert.ok(toggles.length, 'the toggle should render (disabled), so the reason can sit in its tooltip');
  assert.ok(toggles.every(b => b.props.disabled), 'the relay only accepts the children’s list from the church key — a helper’s toggle must be disabled');
  assert.ok(toggles.some(b => /main steward/.test(b.props.title || '')), 'and the tooltip must say why');
});

// ── row identity: same-named rows are separate people, and prototype names are nobody ────────────────────
test('POINT OF USE: two same-named rows keep independent Child toggles, and prototype names start unmarked', async () => {
  const log = [];
  const steward = stewardSpy(log);
  const { draw, load } = loadModal({ steward });
  const { SetupAccountsModal } = await load;
  const props = { onClose: () => {}, sg: { loaded: true, nophoto: [] }, kidPhotosAllowed: true, nameByPub: {}, delegated: false };
  let tree = draw(SetupAccountsModal, props);
  typeNames(tree, 'John Smith\nJohn Smith');
  tree = draw(SetupAccountsModal, props);
  const toggles = button(tree, 'Child');
  assert.equal(toggles.length, 2, 'control: one toggle per row');
  toggles[1].props.onClick();   // mark ONLY the second John Smith
  tree = draw(SetupAccountsModal, props);
  assert.equal(button(tree, 'Child ✓').length, 1, 'marking one row must not mark its same-named sibling (audit F6)');
  press(tree, 'Continue with');
  tree = draw(SetupAccountsModal, props);
  await press(tree, 'Create');
  const call = log.find(l => l[0] === 'createMemberAccounts');
  assert.deepEqual(call[1], [
    { name: 'John Smith', isChild: false, hasKey: true },
    { name: 'John Smith', isChild: true, hasKey: true },
  ], 'the first row stays an adult, the second is the child — a shared name-key merged them before (audit F6)');
  // a person really named __proto__ or constructor must not arrive pre-marked off Object.prototype
  const two = loadModal({ steward: stewardSpy([]) });
  const { SetupAccountsModal: M2 } = await two.load;
  let t2 = two.draw(M2, props);
  const ta2 = find(t2, n => n.type === 'textarea');
  ta2[0].props.onChange({ target: { value: '__proto__\nconstructor' } });
  t2 = two.draw(M2, props);
  assert.equal(button(t2, 'Child?').length, 2, 'control: both rows render');
  assert.equal(button(t2, 'Child ✓').length, 0, 'prototype-chain names must start UNMARKED (audit F6)');
});

// ── a CSV's child marks on a console that cannot save them: said and left out, never silently adults ─────
const MARKED_CSV = 'name,child\nAna Adult,\nLittle Ben,yes\nLittle Cara,yes';
const feedCsv = (tree, csv) => {
  const fi = find(tree, n => n.type === 'input' && n.props && n.props.type === 'file');
  assert.ok(fi.length, 'the CSV import input is gone from the modal');
  fi[0].props.onChange({ target: { files: [{ __csv: csv }] } });
};

test('POINT OF USE: a blocked console (helper, or unauthed) LEAVES OUT CSV-marked children — never creates them as adults', async () => {
  for (const variant of ['helper', 'unauthed']) {
    const log = [];
    const steward = stewardSpy(log);
    if (variant === 'unauthed') steward.relayAuthed = () => false;
    const { draw, load } = loadModal({ steward });
    const { SetupAccountsModal } = await load;
    const props = { onClose: () => {}, sg: { loaded: true, nophoto: [] }, kidPhotosAllowed: false, nameByPub: {}, delegated: variant === 'helper' };
    let tree = draw(SetupAccountsModal, props);
    feedCsv(tree, MARKED_CSV);
    tree = draw(SetupAccountsModal, props);
    const all = texts(tree).join(' ');
    assert.ok(/marked as children, and will be left out/.test(all),
      variant + ': dropping a file’s child marks must be SAID on screen, not silent — the mark is the steward’s, this console just cannot save it');
    assert.equal(button(tree, 'Child ✓').length, 2, variant + ': the file’s marks must stay VISIBLE on their rows');
    assert.equal(find(tree, n => n.type === 'span' && texts(n).includes('left out')).length, 2, variant + ': each excluded row must say so');
    const cont = button(tree, 'Continue with');
    assert.ok(cont.length && texts(cont[0]).join(' ').includes('1'), variant + ': the batch must count ONLY the unmarked rows');
    press(tree, 'Continue with');
    tree = draw(SetupAccountsModal, props);
    assert.ok(/Left out \(marked as children\):\s+Little Ben, Little Cara/.test(texts(tree).join(' ')),
      variant + ': the confirm step must state the exclusion by name');
    await press(tree, 'Create');
    const call = log.find(l => l[0] === 'createMemberAccounts');
    assert.ok(call, variant + ': control — the adult row must still go through');
    assert.deepEqual(call[1], [{ name: 'Ana Adult', isChild: false, hasKey: true }],
      variant + ': ONLY unmarked rows may reach the engine — a CSV-marked child created as an adult is the I3 gap');
  }
});

test('POINT OF USE: the same CSV on an authed main console creates the marked children AS children (control)', async () => {
  const log = [];
  const steward = stewardSpy(log);
  const { draw, load } = loadModal({ steward });
  const { SetupAccountsModal } = await load;
  const props = { onClose: () => {}, sg: { loaded: true, nophoto: [] }, kidPhotosAllowed: true, nameByPub: {}, delegated: false };
  let tree = draw(SetupAccountsModal, props);
  feedCsv(tree, MARKED_CSV);
  tree = draw(SetupAccountsModal, props);
  assert.ok(!/left out/.test(texts(tree).join(' ')), 'nothing is excluded on a console that can save the marks');
  press(tree, 'Continue with');
  tree = draw(SetupAccountsModal, props);
  await press(tree, 'Create');
  const call = log.find(l => l[0] === 'createMemberAccounts');
  assert.deepEqual(call[1], [
    { name: 'Ana Adult', isChild: false, hasKey: true },
    { name: 'Little Ben', isChild: true, hasKey: true },
    { name: 'Little Cara', isChild: true, hasKey: true },
  ], 'the file’s marks must arrive at the engine as CHILD entries');
});

// ── a refused batch, retried: the SAME keys go back — a re-mint would strand the first accounts ──────────
test('POINT OF USE: retrying after a refusal re-uses the SAME minted keys (no re-mint, no new accounts)', async () => {
  let mintN = 0;
  const calls = [];
  const steward = {
    relayAuthed: () => true,
    mintAccountKey: () => 'key-' + (++mintN),
    createMemberAccounts: async (entries, opts) => {
      calls.push(entries.map(e => e.mnemonic));
      if (calls.length === 1) return { refused: 'The members list hasn’t loaded yet — try again in a moment.' };
      return { results: entries.map(e => ({ ok: true, attempted: true, name: e.name, pubkey: 'pk-' + e.name, isChild: !!e.isChild, mnemonic: e.mnemonic, reason: '' })), childrenRefused: '' };
    },
    memberInviteUrl: (m) => 'https://x/#invite=' + m, qrSVG: () => '<svg></svg>',
    setNoPhoto: async () => true, tombstoneMemberAccount: async () => true,
  };
  const { draw, load } = loadModal({ steward });
  const { SetupAccountsModal } = await load;
  const props = { onClose: () => {}, sg: { loaded: true, nophoto: [] }, kidPhotosAllowed: true, nameByPub: {}, delegated: false };
  let tree = draw(SetupAccountsModal, props);
  typeNames(tree, 'Ana\nBen');
  tree = draw(SetupAccountsModal, props);
  press(tree, 'Continue with');
  tree = draw(SetupAccountsModal, props);
  await press(tree, 'Create');
  tree = draw(SetupAccountsModal, props);
  assert.ok(texts(tree).join(' ').includes('hasn’t loaded yet'), 'the refusal must be shown on the confirm screen the steward retries from');
  await press(tree, 'Create');
  assert.equal(calls.length, 2, 'control: the retry reached the engine');
  assert.deepEqual(calls[0], ['key-1', 'key-2'], 'control: one key per name at Continue');
  assert.deepEqual(calls[1], calls[0],
    'the retry must carry the SAME mnemonics — a re-mint is the historical false claim (rule 4): it starts NEW accounts and strands the first set');
  assert.equal(mintN, 2, 'nothing may mint between the refusal and the retry');
});

// ── POINT OF USE (rule 1): the Members-panel wiring, EXECUTED — not grepped ──────────────────────────────
// The three real pieces of the trigger wiring are sliced out of DashMembers BY STRUCTURE (the state line,
// the button whose label is "Set up accounts", and the ENCLOSING {…} JSX expression that mounts the modal —
// taken from the outside in, so a `false && ` prefixed to the condition rides along), assembled into one
// compilable component, compiled with the packaged esbuild, and DRIVEN. Deadening the onClick or prefixing
// the mount condition leaves every word of the text in place — a text match stayed green over exactly that
// sabotage (audit F2, 19/19) — but here the button is CLICKED and the mount is OBSERVED, so either goes red.
function loadDashWiring(React, SetupAccountsModalStub) {
  const dash = fnBody(STEW, 'function DashMembers({ dmConvos: dmConvosProp }) {', 'DashMembers');
  const stateLine = 'const [setupOpen, setSetupOpen] = React.useState(false);';
  assert.equal(dash.split(stateLine).length, 2, 'the setupOpen state is gone from DashMembers — re-anchor');
  const btnEndTag = ' Set up accounts</button>';
  assert.equal(dash.split(btnEndTag).length, 2, 'the Set up accounts button is gone from DashMembers');
  const be = dash.indexOf(btnEndTag);
  const bs = dash.lastIndexOf('<button', be);
  assert.notEqual(bs, -1, 'no opening <button before the Set up accounts label');
  const btn = dash.slice(bs, be + btnEndTag.length);
  assert.equal(dash.split('<SetupAccountsModal').length, 2, 'DashMembers must render the modal exactly once');
  const mAt = dash.indexOf('<SetupAccountsModal');
  const os = dash.lastIndexOf('{', mAt);
  let depth = 0, oe = -1;
  for (let i = os; i < dash.length; i++) {
    const c = dash[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { oe = i; break; } }
  }
  assert.notEqual(oe, -1, 'unbalanced modal-mount expression');
  const mount = dash.slice(os, oe + 1);
  const src = 'function DashWiring({ sg, kidPhotosAllowed, nameByPub, delegated }) {\n  ' + stateLine
    + '\n  return <div>' + btn + mount + '</div>;\n}\n';
  const tmp = join(tmpdir(), 'dashwiring-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  return new Function('React', 'Icon', 'SetupAccountsModal', js + '\nreturn DashWiring;')(React, () => null, SetupAccountsModalStub);
}

test('POINT OF USE: the Members-panel button CAUSES the modal to mount, with the live props, and onClose unmounts it', () => {
  const { React, draw } = miniReact();
  const seen = [];
  const Stub = (props) => { seen.push(props); return React.createElement('div', {}, 'SETUP-MODAL-MOUNTED'); };
  const DashWiring = loadDashWiring(React, Stub);
  const props = { sg: { loaded: true, nophoto: [] }, kidPhotosAllowed: false, nameByPub: { x: 'Maria' }, delegated: true };
  let tree = draw(DashWiring, props);
  assert.ok(!texts(tree).join(' ').includes('SETUP-MODAL-MOUNTED'), 'the modal must not be open before the tap');
  const b = button(tree, 'Set up accounts').filter(n => typeof n.props.onClick === 'function' && !n.props.disabled);
  assert.ok(b.length, 'no live Set up accounts button on the Members panel — the trigger is dead on the screen');
  b[0].props.onClick();
  tree = draw(DashWiring, props);
  assert.ok(texts(tree).join(' ').includes('SETUP-MODAL-MOUNTED'),
    'tapping the button must MOUNT the modal — a dead onClick or a false&& on the render goes red HERE, where a text match stays green');
  const mp = seen[seen.length - 1];
  assert.equal(mp.sg, props.sg, 'the modal must receive the live safeguarding roster');
  assert.equal(mp.delegated, props.delegated, 'the modal must be told it is on a helper console — the child gates hang off this');
  assert.equal(mp.kidPhotosAllowed, props.kidPhotosAllowed);
  assert.equal(mp.nameByPub, props.nameByPub);
  assert.equal(typeof mp.onClose, 'function');
  mp.onClose();
  tree = draw(DashWiring, props);
  assert.ok(!texts(tree).join(' ').includes('SETUP-MODAL-MOUNTED'), 'the modal’s own onClose must close it');
});

// ── reachability (regex, and it bites: REMOVING the prop fails this — measured in the audit) ─────────────
test('both IdentityOnboarding render sites pass followChurch', () => {
  const APP = readFileSync(join(ROOT, 'app/app.jsx'), 'utf8');
  const sites = APP.match(/<IdentityOnboarding[^>]*followChurch=\{followChurch\}/g) || [];
  assert.equal(sites.length, 2, 'BOTH IdentityOnboarding render sites must pass followChurch, or the scan route silently stops following (the saveIdentity lesson)');
});

test('POINT OF USE: a batch that created a CHILD while a configured relay was away says so on the done screen (F7)', async () => {
  const log = [];
  const steward = { ...stewardSpy(log), writeSpread: (which) => which === 'minors'
    ? { landed: ['ws://a/relay'], missed: [], configured: ['ws://a/relay', 'ws://b/relay'], at: 1 } : null };
  const { draw, load } = loadModal({ steward });
  const { SetupAccountsModal } = await load;
  const props = { onClose: () => {}, sg: { loaded: true, nophoto: [] }, kidPhotosAllowed: false, nameByPub: {}, delegated: false };
  let tree = draw(SetupAccountsModal, props);
  typeNames(tree, 'Olive Oak');
  tree = draw(SetupAccountsModal, props);
  press(tree, 'Child?');
  tree = draw(SetupAccountsModal, props);
  press(tree, 'Continue with');
  tree = draw(SetupAccountsModal, props);
  await press(tree, 'Create');
  tree = draw(SetupAccountsModal, props);
  const all = texts(tree).join(' ');
  assert.match(all, /reached 1 of your 2 relay machines/,
    'the owner’s N-of-M line is missing from the batch done screen — a child made in an outage stays silent (sim D3)');
  assert.match(all, /back and in sync/);
});

test('POINT OF USE: an adults-only batch with the same gap stays quiet — the line is about children (F7 control)', async () => {
  const log = [];
  const steward = { ...stewardSpy(log), writeSpread: () => ({ landed: ['ws://a/relay'], missed: [], configured: ['ws://a/relay', 'ws://b/relay'], at: 1 }) };
  const { draw, load } = loadModal({ steward });
  const { SetupAccountsModal } = await load;
  const props = { onClose: () => {}, sg: { loaded: true, nophoto: [] }, kidPhotosAllowed: false, nameByPub: {}, delegated: false };
  let tree = draw(SetupAccountsModal, props);
  typeNames(tree, 'Adam Ash');
  tree = draw(SetupAccountsModal, props);
  press(tree, 'Continue with');
  tree = draw(SetupAccountsModal, props);
  await press(tree, 'Create');
  tree = draw(SetupAccountsModal, props);
  assert.doesNotMatch(texts(tree).join(' '), /relay machines/, 'the child line fired for a batch with no children');
});

// ── S5 (integration audit 2026-11-21): the batch's no-photo write is READ, and a miss is SAID ────────────
// It was fire-and-forget behind sg.loaded: a refused save or a skipped one left the done screen reading
// as though the children's photos were off. Driven through the real modal each time.
async function batchOneChild({ setNoPhoto, sg, kidPhotosAllowed = false }) {
  const log = [];
  const steward = stewardSpy(log);
  steward.setNoPhoto = (list) => { log.push(['setNoPhoto', list]); return setNoPhoto(); };
  const { draw, load } = loadModal({ steward });
  const { SetupAccountsModal } = await load;
  const props = { onClose: () => {}, sg, kidPhotosAllowed, nameByPub: {}, delegated: false };
  let tree = draw(SetupAccountsModal, props);
  typeNames(tree, 'Little Ana');
  tree = draw(SetupAccountsModal, props);
  button(tree, 'Child?')[0].props.onClick();
  tree = draw(SetupAccountsModal, props);
  press(tree, 'Continue with');
  tree = draw(SetupAccountsModal, props);
  await press(tree, 'Create');
  tree = draw(SetupAccountsModal, props);
  const all = texts(tree).join(' ');
  assert.ok(/1\s+account\s+created/.test(all), 'control: the batch reached its done screen: ' + all.slice(0, 200));
  return { log, all };
}
const NOT_ON_LIST = /not added to your church.s no-photo list/;

test('POINT OF USE: a no-photo write the relay REFUSES is said on the done screen — resolved null, false, or thrown', async () => {
  for (const [what, impl] of [['null', () => Promise.resolve(null)], ['false', () => Promise.resolve(false)],
    ['rejects', () => Promise.reject(new Error('refused'))], ['throws', () => { throw new Error('may not write'); }]]) {
    const { log, all } = await batchOneChild({ setNoPhoto: impl, sg: { loaded: true, nophoto: [] } });
    assert.ok(log.some(l => l[0] === 'setNoPhoto'), what + ': control — the write was attempted');
    assert.match(all, NOT_ON_LIST, what + ': a refused no-photo write passed in silence');
    assert.match(all, /was not accepted/, what);
  }
});

test('POINT OF USE: a no-photo list that had NOT LOADED is left alone, and the skip is said', async () => {
  const { log, all } = await batchOneChild({ setNoPhoto: () => Promise.resolve(true), sg: { loaded: false, nophoto: [] } });
  assert.ok(!log.some(l => l[0] === 'setNoPhoto'), 'a cold list must never be replaced (audit 2026-10-13)');
  assert.match(all, NOT_ON_LIST, 'the skipped write passed in silence');
  assert.match(all, /had not loaded/);
});

test('POINT OF USE: an accepted no-photo write, and a church that allows children’s photos, both stay quiet (control)', async () => {
  const a = await batchOneChild({ setNoPhoto: () => Promise.resolve(true), sg: { loaded: true, nophoto: [] } });
  assert.ok(a.log.some(l => l[0] === 'setNoPhoto'));
  assert.doesNotMatch(a.all, NOT_ON_LIST);
  const b = await batchOneChild({ setNoPhoto: () => Promise.resolve(null), sg: { loaded: false, nophoto: [] }, kidPhotosAllowed: true });
  assert.ok(!b.log.some(l => l[0] === 'setNoPhoto'));
  assert.doesNotMatch(b.all, NOT_ON_LIST, 'a church that allows children’s photos has nothing to report');
});
