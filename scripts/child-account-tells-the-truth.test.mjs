// A CHILD'S ACCOUNT IS NOT CREATED UNTIL THE RELAY SAYS SO.
// Run: node --test scripts/child-account-tells-the-truth.test.mjs
//
// AUDIT 2026-08-29 (member-app round). `createChildAccount` published four events in a loop, console.warned
// every failure, and returned the child's twelve words unconditionally. On a bad link the parent wrote them
// down, set up the child's phone, and there was no join document, no sealed name and nothing for the steward
// — the parent's row read "Waiting for steward to confirm" for ever, and nothing retried.
//
// The words are shown ONCE and stored NOWHERE. So a false success is not a cosmetic problem: it is an
// unrecoverable one, and the only signal the parent gets is the screen.
//
// This runs the shipped function against a relay we control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44v2 } from 'nostr-tools/nip44';

const SRC = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
function grabMethod(src, sig) {
  const at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test, do not delete it');
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}
const BODY = grabMethod(SRC, 'async createChildAccount(churchNpub, childName)');
// esbuild renumbers the nostr-tools imports; bind whatever the body actually calls so a rebuild that renames
// them fails loudly here rather than silently testing nothing.
const nameFor = (base) => (BODY.match(new RegExp('\\b' + base + '\\d*\\b')) || [])[0] || base;

const CHURCH_SK = generateSecretKey(), CHURCH = getPublicKey(CHURCH_SK);
const dOf = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';

// `fails` names which documents the relay refuses: 'join' | 'name' | 'k0' | 'req'.
function parent({ fails = [] } = {}) {
  const state = { published: [], order: [], saved: null };
  const kind = (e) => {
    const d = dOf(e);
    if (e.kind === 0) return 'k0';
    if (d.startsWith('trinityone/member:')) return 'join';
    if (d.startsWith('trinityone/name:')) return 'name';
    if (d.startsWith('trinityone/guardreq:')) return 'req';
    return 'other';
  };
  const parentSk = generateSecretKey();
  const scope = {
    sk: parentSk,
    pub: getPublicKey(parentSk),
    toPub: () => CHURCH,
    NET: 'trinityone',
    _needAuth: false,
    _saveChildLink: (rec) => { state.saved = rec; },
    _publishAny: async (_relays, e) => {
      const k = kind(e);
      state.order.push(k);
      if (fails.includes(k)) throw new Error('relay refused ' + k);
      state.published.push(k);
    },
    [nameFor('finalizeEvent')]: finalizeEvent,
    [nameFor('getPublicKey')]: getPublicKey,
    privateKeyFromSeedWords,
    npubEncode,
    [nameFor('encrypt')]: (pl, k) => nip44v2.encrypt(pl, k),
    [nameFor('getConversationKey')]: (a, b) => nip44v2.utils.getConversationKey(a, b),
    console: { warn() {} },
    window: {
      Fellowship: { relays: ['wss://test.invalid'], ready: Promise.resolve() },
      TrinityIdentity: { makeInvite: () => ({ mnemonic: 'abandon '.repeat(11) + 'about', profile: {} }) },
    },
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, `return ({ ${BODY} }).createChildAccount;`)(...args.map(k => scope[k]));
  return { call: () => fn('npub1church', 'Ellie'), state };
}

test('when nothing reaches the relay, the account is NOT reported as created', async () => {
  const p = parent({ fails: ['join', 'name', 'k0', 'req'] });
  const r = await p.call();
  assert.equal(r.ok, false, 'the parent is handed twelve words for an account no relay has heard of');
  assert.equal(p.state.saved, null, 'a ghost row was saved reading "Waiting for steward to confirm"');
});

test('the join is what makes the child a member — without it there is no account', async () => {
  const p = parent({ fails: ['join'] });
  assert.equal((await p.call()).ok, false);
  assert.equal(p.state.saved, null);
});

test('without the sealed name the steward is asked to approve a bare npub', async () => {
  // The console deliberately will not resolve a requester-supplied name (it is forgeable), so a missing
  // name document leaves a real person deciding about an identifier they cannot read.
  const p = parent({ fails: ['name'] });
  assert.equal((await p.call()).ok, false, 'a nameless link was reported as a working account');
  assert.equal(p.state.saved, null);
});

test('a late kind-0 does not fail the account — it is an empty profile', async () => {
  // The child's kind-0 carries no name by design (AUDIT-2026-07-27), so its absence costs nothing.
  const p = parent({ fails: ['k0'] });
  const r = await p.call();
  assert.equal(r.ok, true, 'an empty profile arriving late threw away a perfectly good account');
  assert.ok(p.state.saved, 'the link was not remembered');
});

test('when it all lands, the parent gets the words and the link is remembered', async () => {
  const p = parent();
  const r = await p.call();
  assert.equal(r.ok, true);
  assert.ok(r.mnemonic && r.childPub && r.npub, 'the caller lost fields it has always been given');
  assert.deepEqual(p.state.saved && p.state.saved.name, 'Ellie');
  assert.deepEqual([...new Set(p.state.published)].sort(), ['join', 'k0', 'name', 'req']);
});

test('the join is published BEFORE the sealed name, or the relay refuses the name', async () => {
  // gateway.mjs will not accept a `name:` document from a pubkey it does not already know is a member.
  const p = parent();
  await p.call();
  assert.ok(p.state.order.indexOf('join') < p.state.order.indexOf('name'),
    'the name was sent before the join, so the relay would silently refuse it');
});
