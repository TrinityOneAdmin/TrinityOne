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


// ── AND NOW THE POINT OF USE ─────────────────────────────────────────────────────────────────────────────
// CLAUDE.md rule 1. Everything above tests the ENGINE. `createChildAccount` still RETURNS the child's
// mnemonic when `ok` is false — deliberately, so the caller has everything it needs — which means the only
// thing standing between a parent and twelve words for an account no relay has heard of is one `if` block
// in app/identity.jsx's FamilySheet:
//     if (r && r.ok === false) { setErr(…); setBusy(false); return; }
// An auditor deleted it and all six tests above stayed green. The words are shown once and stored nowhere,
// so that is the unrecoverable failure this whole file exists to prevent, reintroduced with the engine
// perfectly intact.
//
// A text match would not do: app/*.jsx ships unbundled, so `if (false && r && r.ok === false)` leaves every
// word of that block in place (rule 3). So LIFT the real handler and RUN it.
import { fnBody } from './test-slice.mjs';

const IDENT = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
// There are two `const create = async () =>` handlers in this file. Slice FamilySheet first so the anchor
// below cannot land on somebody else's — the mis-aimed-sabotage trap CLAUDE.md names.
const FAMILY = fnBody(IDENT, 'function FamilySheet({ open, onClose, ctx })', 'FamilySheet');
assert.equal((FAMILY.match(/const create = async \(\) => \{/g) || []).length, 1,
  'FamilySheet no longer has exactly one create handler — re-anchor this test rather than guessing');
const CREATE = fnBody(FAMILY, 'const create = async () => {', 'FamilySheet.create');

// Run the shipped handler with a stubbed sheet around it. Everything here is scaffolding; the handler's own
// logic is untouched.
function sheet({ result, throws }) {
  const seen = { made: undefined, stage: 'name', err: '', busy: null, refreshed: 0 };
  const scope = {
    name: 'Ellie',
    setName: () => {},
    setErr: (m) => { seen.err = m; },
    setBusy: (b) => { seen.busy = b; },
    setMade: (m) => { seen.made = m; },
    setStage: (s) => { seen.stage = s; },
    refreshKids: () => { seen.refreshed++; },
    F: { createChildAccount: async () => { if (throws) throw throws; return result; } },
    ctx: { church: { npub: 'npub1church' } },
    Promise, console,
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, CREATE + '\nreturn create;')(...args.map(k => scope[k]));
  return { run: () => fn(), seen };
}

// exactly what the engine hands back when nothing landed: ok false, and the words still present
const FAILED = { ok: false, published: {}, mnemonic: 'abandon '.repeat(11) + 'about', childPub: 'c'.repeat(64), npub: 'npub1child', name: 'Ellie' };

test('POINT OF USE: a parent is never shown the twelve words for an account that was not created', async () => {
  const s = sheet({ result: FAILED });
  await s.run();
  assert.equal(s.seen.made, undefined,
    'the sheet accepted the failed result, so the reveal screen is about to print twelve words — shown ' +
    'once, stored nowhere — for an account no relay has heard of');
  assert.notEqual(s.seen.stage, 'reveal', 'the sheet moved to the "Set up the child’s device" screen anyway');
  assert.match(s.seen.err, /\S/, 'and the parent was told nothing at all about why nothing happened');
  assert.equal(s.seen.busy, false, 'the button is stuck spinning with no way forward');
});

test('POINT OF USE: an unreachable relay and a half-landed account are told apart', async () => {
  // Different next step for the parent: "try again, nothing is set up" vs "your steward needs the name".
  const nothing = sheet({ result: FAILED });
  await nothing.run();
  assert.match(nothing.seen.err, /wasn’t created|nothing has been set up/i,
    'a parent whose phone never reached the relay is told the account exists but is unnamed');

  const partial = sheet({ result: { ...FAILED, published: { join: true } } });
  await partial.run();
  assert.match(partial.seen.err, /steward/i,
    'a parent whose child IS joined but unnamed is told to start over, which would mint a second account');
  assert.equal(partial.seen.made, undefined);
});

test('POINT OF USE: …and a real account still reveals its words', async () => {
  const ok = { ok: true, published: { join: true, name: true, req: true }, mnemonic: 'abandon '.repeat(11) + 'about', childPub: 'c'.repeat(64), npub: 'npub1child', name: 'Ellie' };
  const s = sheet({ result: ok });
  await s.run();
  assert.equal(s.seen.made, ok, 'a working account never reaches the screen that hands over the words');
  assert.equal(s.seen.stage, 'reveal');
  assert.equal(s.seen.refreshed, 1, 'the new child does not appear in the list until a reload');
});

test('POINT OF USE: a thrown error is reported, not swallowed into a blank reveal', async () => {
  const s = sheet({ throws: new Error('no network') });
  await s.run();
  assert.equal(s.seen.made, undefined, 'the reveal screen would print `made.mnemonic` of undefined');
  assert.notEqual(s.seen.stage, 'reveal');
  assert.match(s.seen.err, /\S/, 'the sheet swallowed the error and said nothing');
});
