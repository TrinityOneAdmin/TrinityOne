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
import { privateKeyFromSeedWords, generateSeedWords } from 'nostr-tools/nip06';
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
const BODY = grabMethod(SRC, 'async createChildAccount(churchNpub, childName, opts)');
const REBUILD = grabMethod(SRC, 'function _rebuildFamily(churchNpub)');
// esbuild renumbers the nostr-tools imports; bind whatever the body actually calls so a rebuild that renames
// them fails loudly here rather than silently testing nothing.
const nameFor = (base) => (BODY.match(new RegExp('\\b' + base + '\\d*\\b')) || [])[0] || base;

const CHURCH_SK = generateSecretKey(), CHURCH = getPublicKey(CHURCH_SK);
const dOf = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';

// `fails` names which documents the relay refuses: 'join' | 'name' | 'k0' | 'req'.
// `children` is the parent's local family list, shared with the _rebuildFamily run at the foot of this file.
function parent({ fails = [], children = [] } = {}) {
  // `order` = every document the function ATTEMPTED, in order; `published` = the ones the relay took;
  // `relay` = the events actually sitting on the relay afterwards; `minted` = every key the engine minted.
  const state = { published: [], order: [], saved: null, relay: [], minted: [], children };
  const kind = (e) => {
    const d = dOf(e);
    if (e.kind === 0) return 'k0';
    if (d.startsWith('trinityone/member:')) return 'join';
    if (d.startsWith('trinityone/name:')) return 'name';
    if (d.startsWith('trinityone/guardreq:')) return 'req';
    return 'other';
  };
  const parentSk = generateSecretKey();
  state.parentPub = getPublicKey(parentSk);
  const scope = {
    sk: parentSk,
    pub: state.parentPub,
    toPub: () => CHURCH,
    NET: 'trinityone',
    _needAuth: false,
    _saveChildLink: (rec) => { state.saved = rec; state.children.push(rec); },
    _publishAny: async (_relays, e) => {
      const k = kind(e);
      state.order.push(k);
      if (fails.includes(k)) throw new Error('relay refused ' + k);
      state.published.push(k);
      state.relay.push(e);
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
      // a REAL minter: every call returns a different key, so "the engine minted a second account" is
      // visible as a different childPub rather than hidden behind one hard-coded phrase.
      TrinityIdentity: { makeInvite: () => { const m = generateSeedWords(); state.minted.push(m); return { mnemonic: m, profile: {} }; } },
    },
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, `return ({ ${BODY} }).createChildAccount;`)(...args.map(k => scope[k]));
  return { call: (opts) => fn('npub1church', 'Ellie', opts), state };
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


// ── (a) THE GUARDIAN REQUEST IS PART OF SUCCESS ──────────────────────────────────────────────────────────
// `ok` was `!!(published.join && published.name)`. The request is the ONLY document that ever asks a steward
// to confirm the link, this function is its only publisher anywhere in the codebase, and nothing re-sends it
// — so leaving it out of the check told the parent it had worked while the row read "Waiting for steward to
// confirm" for ever. It is also the likeliest of the four to fail: it alone is signed by the PARENT's key,
// so it alone counts against the parent's per-member document cap.
test('a guardian request that never arrives is not a created account', async () => {
  const p = parent({ fails: ['req'] });
  const r = await p.call();
  assert.equal(r.ok, false,
    'the parent was handed the twelve words and told it worked, but no steward will ever be asked to ' +
    'confirm the link — and nothing re-sends the request');
  assert.equal(p.state.saved, null, 'a row reading "Waiting for steward to confirm" was saved for a request nobody has');
});


// ── (c) A FAILED JOIN STOPS THE REST ─────────────────────────────────────────────────────────────────────
// The other three used to go out regardless, so a failed join left an orphan profile and a guardian request
// on the relay for a pubkey that belongs to no church — while the screen said "nothing has been set up yet".
test('when the join fails, NOTHING else is published', async () => {
  const p = parent({ fails: ['join'] });
  await p.call();
  assert.deepEqual(p.state.order, ['join'],
    'the child\'s profile / name / guardian request were sent for a pubkey that is not a member of anything: ' +
    'attempted ' + JSON.stringify(p.state.order));
  assert.equal(p.state.relay.length, 0, 'documents were left on the relay for an account that was never created');
});

test('the sealed name is not even attempted without the join, because the relay would refuse it', async () => {
  // gateway.mjs accepts a `name:` document only from a pubkey it already knows is a member of that church.
  const p = parent({ fails: ['join'] });
  await p.call();
  assert.ok(!p.state.order.includes('name'), 'a name document was sent that the relay is guaranteed to throw away');
});

test('a nameless account never asks a steward to approve a bare npub', async () => {
  // The request carries no name by design (AUDIT-2026-07-27) and the console will not resolve a
  // requester-supplied one (forgeable — SECURITY-AUDIT-2026-07-20 C1), so the sealed name is the ONLY way a
  // steward can see whose link they are confirming.
  const p = parent({ fails: ['name'] });
  await p.call();
  assert.ok(!p.state.order.includes('req'),
    'the steward was asked to confirm a link they cannot read the name of');
});


// ── (b) ONE CHILD, ONE KEY ───────────────────────────────────────────────────────────────────────────────
// makeInvite() used to be called INSIDE this function and the UI's only retry was to call it again, so a
// second attempt minted a SECOND account for the same child — two guardian requests for a steward to judge,
// and the first account permanently unrecoverable, because its sealed name can only be signed by a key the
// parent was never shown.
test('a retry with the caller\'s key finishes the SAME account', async () => {
  const p = parent({ fails: ['req'] });
  const first = await p.call();
  assert.equal(first.ok, false);
  const p2 = parent();                               // the relay is reachable this time
  const second = await p2.call({ mnemonic: first.mnemonic });
  assert.equal(second.ok, true);
  assert.equal(second.childPub, first.childPub,
    'the retry minted a SECOND child account: two guardian requests, and the first account unrecoverable');
  assert.equal(p2.state.minted.length, 0, 'the function minted a key of its own over the one it was handed');
});

test('…and with no key handed in it still mints one, as it always did', async () => {
  const p = parent();
  const r = await p.call();
  assert.ok(/^[0-9a-f]{64}$/.test(r.childPub), 'an omitted key no longer produces a working account');
  assert.equal(p.state.minted.length, 1);
  assert.equal(r.mnemonic, p.state.minted[0], 'the caller was handed different words from the key that was used');
});

test('which is exactly why the caller must hold the key: two bare calls are two children', async () => {
  // Not a bug in this function — the demonstration of why the UI, not the engine, owns the key.
  const p = parent();
  const a = await p.call(), b = await p.call();
  assert.notEqual(a.childPub, b.childPub);
});


// ── (d) THE GHOST ROW ON THE NEXT LAUNCH ─────────────────────────────────────────────────────────────────
// `_rebuildFamily` runs once per session and rebuilds the family list from the parent's OWN guardreq
// documents on the relay, saving each as `{ name: '' }`. So anything this function leaves behind after a
// failed setup comes back as a blank-named "Waiting for steward to confirm" row on the next app start — the
// exact row `if (ok)` exists to suppress. This runs BOTH shipped functions, one after the other, over one
// relay: whatever createChildAccount really left there is what _rebuildFamily really reads.
function nextLaunch({ relay, children, parentPub }) {
  const scope = {
    toPub: () => CHURCH,
    pub: parentPub,
    relaysForChurch: () => ['wss://test.invalid'],
    _dtag: dOf,
    _loadChildren: () => children,
    _saveChildLink: (rec) => { children.push(rec); },
    pool: {
      subscribeMany(_relays, _filters, h) {
        // asynchronously, like a real relay: oneose fires before `const sub` is assigned otherwise
        setTimeout(() => { for (const e of relay) if (e.pubkey === parentPub) h.onevent(e); h.oneose(); }, 0);
        return { close() {} };
      },
    },
    // the real one arms a 9s fallback timer; don't hold the test process open for it
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; },
    Promise,
  };
  const args = Object.keys(scope);
  return new Function(...args, REBUILD + '\nreturn _rebuildFamily;')(...args.map(k => scope[k]))('npub1church');
}

test('GHOST ROW: a setup that failed does not come back on the next launch', async () => {
  for (const fails of [['join'], ['name'], ['name', 'k0'], ['req'], ['join', 'k0', 'name', 'req']]) {
    const which = JSON.stringify(fails);
    const children = [];
    const p = parent({ fails, children });
    const r = await p.call();
    assert.equal(r.ok, false, 'fixture is wrong: ' + which + ' was reported as a success');
    assert.deepEqual(children, [], 'the failed setup saved a local row itself (' + which + ')');
    const added = await nextLaunch({ relay: p.state.relay, children, parentPub: p.state.parentPub });
    assert.equal(added, 0,
      'the next app start resurrected a blank-named "Waiting for steward to confirm" row from a guardian ' +
      'request the failed setup left on the relay (' + which + ')');
    assert.deepEqual(children, [], 'the ghost row is back (' + which + ')');
  }
});

test('GHOST ROW: …but a setup that WORKED is still rebuilt after the local list is wiped', async () => {
  // The rebuild exists because restoring an identity clears trinityone.family and a parent's children
  // vanished from their phone (AUDIT-2026-07-28). A fix that simply stopped it finding anything would be
  // worse than the bug it closes.
  const children = [];
  const p = parent({ children });
  assert.equal((await p.call()).ok, true);
  children.length = 0;                                  // the locked-boot wipe
  const added = await nextLaunch({ relay: p.state.relay, children, parentPub: p.state.parentPub });
  assert.equal(added, 1, 'a real child can no longer be recovered from the relay after a restore');
  assert.equal(children[0].child, (await Promise.resolve(p.state.relay.find(e => dOf(e).startsWith('trinityone/guardreq:')))) &&
    dOf(p.state.relay.find(e => dOf(e).startsWith('trinityone/guardreq:'))).slice('trinityone/guardreq:'.length));
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
//
// The handler is REBUILT for every attempt, from the state the previous attempt left behind — which is what
// React does on re-render, and the only way a "tap Create again" test can mean anything.
function sheet({ result, throws, childName = 'Ellie' }) {
  const seen = { made: undefined, stage: 'name', err: '', busy: null, refreshed: 0, calls: [], minted: [] };
  // The key is held in a MODULE global now, not in component state, because this sheet is unmounted the
  // moment it is closed. This object stands in for it; that it really is OUTSIDE the component is what
  // scripts/a-closed-sheet-must-not-mint-a-second-child.test.mjs proves, by rendering the real screen twice.
  seen.pending = { church: '', name: '', mnemonic: '' };
  let attempt = 0;
  const run = (typed) => {
    const scope = {
      name: typed === undefined ? childName : typed,
      _familyPendingKey: seen.pending,
      // a fresh key every time it is called, so "the screen minted a second account" shows up as a
      // different key rather than hiding behind one constant
      mintSeed: () => { const m = 'seed-' + (seen.minted.length + 1); seen.minted.push(m); return m; },
      setName: () => {},
      setErr: (m) => { seen.err = m; },
      setBusy: (b) => { seen.busy = b; },
      setMade: (m) => { seen.made = m; },
      setStage: (s) => { seen.stage = s; },
      refreshKids: () => { seen.refreshed++; },
      F: {
        createChildAccount: async (_npub, n, opts) => {
          seen.calls.push({ name: n, mnemonic: opts && opts.mnemonic });
          if (throws) throw throws;
          const r = typeof result === 'function' ? result(attempt++) : result;
          // the real engine hands back the key it actually used, whoever minted it
          return r ? { ...r, mnemonic: (opts && opts.mnemonic) || r.mnemonic } : r;
        },
      },
      ctx: { church: { npub: 'npub1church' } },
      Promise, console,
    };
    const args = Object.keys(scope);
    const fn = new Function(...args, CREATE + '\nreturn create;')(...args.map(k => scope[k]));
    return fn();
  };
  return { run, seen };
}

// exactly what the engine hands back when nothing landed: ok false, and the words still present
const FAILED = { ok: false, published: {}, mnemonic: 'abandon '.repeat(11) + 'about', childPub: 'c'.repeat(64), npub: 'npub1child', name: 'Ellie' };
const MADE = { ok: true, published: { join: true, name: true, req: true }, mnemonic: 'abandon '.repeat(11) + 'about', childPub: 'c'.repeat(64), npub: 'npub1child', name: 'Ellie' };

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

// ── (a), at the point of use ─────────────────────────────────────────────────────────────────────────────
// The engine now calls a missing guardian request a failure. That only reaches the parent if this screen
// still reports it, AND reports it as its own case: the account IS set up, so "nothing has been set up yet"
// would be a lie, and "your steward needs the name" points at the wrong missing piece.
test('POINT OF USE: a missing guardian request is reported, and as its own case', async () => {
  const s = sheet({ result: { ...FAILED, published: { join: true, name: true } } });
  await s.run();
  assert.equal(s.seen.made, undefined, 'the words were revealed for a link no steward will ever be asked to confirm');
  assert.notEqual(s.seen.stage, 'reveal');
  assert.match(s.seen.err, /steward/i, 'the parent is not told what is missing');
  assert.doesNotMatch(s.seen.err, /nothing has been set up/i,
    'the parent is told nothing was set up, but the child IS joined — starting over would mint a second account');

  const nameless = sheet({ result: { ...FAILED, published: { join: true } } });
  await nameless.run();
  assert.notEqual(s.seen.err, nameless.seen.err,
    'a missing name and a missing guardian request read identically, so the parent cannot tell them apart');
});

// ── (b), at the point of use — THE ONE THAT MINTED A SECOND CHILD ────────────────────────────────────────
// The engine will happily mint a key when handed none, so moving the minting out of it changes nothing on
// its own: the retry is only safe if THIS screen holds the key across attempts. Delete `pending` and every
// engine test above still passes.
test('POINT OF USE: tapping Create again finishes the same child, it does not mint a second', async () => {
  const s = sheet({ result: (n) => (n === 0 ? { ...FAILED, published: { join: true, name: true } } : MADE) });
  await s.run();                                    // fails: the guardian request did not get through
  assert.equal(s.seen.made, undefined);
  await s.run();                                    // the parent taps "Create the account" again
  assert.equal(s.seen.calls.length, 2);
  assert.equal(s.seen.calls[1].mnemonic, s.seen.calls[0].mnemonic,
    'the retry created a SECOND account for the same child: two guardian requests for the steward to judge, ' +
    'and the first account unrecoverable because its words were never shown');
  assert.equal(s.seen.minted.length, 1, 'a second key was minted for a child who already has one');
  assert.equal(s.seen.stage, 'reveal', 'the successful retry never reached the words');
});

test('POINT OF USE: a DIFFERENT child never inherits the first child’s key', async () => {
  // Two children sharing one key is worse than the bug being fixed: one account, two people.
  const s = sheet({ result: { ...FAILED, published: { join: true, name: true } } });
  await s.run('Ellie');
  await s.run('Sam Carter');
  assert.equal(s.seen.calls.length, 2);
  assert.notEqual(s.seen.calls[1].mnemonic, s.seen.calls[0].mnemonic,
    'a second child was set up with the first child’s key — one account for two people');
});

test('POINT OF USE: after a success the key is let go, so the next child gets their own', async () => {
  const s = sheet({ result: MADE });
  await s.run('Ellie');
  assert.equal(s.seen.pending.mnemonic, '', 'the finished child’s key is still held, and the next child would reuse it');
  await s.run('Ellie');        // the same name again — a sibling, a correction, whatever
  assert.notEqual(s.seen.calls[1].mnemonic, s.seen.calls[0].mnemonic);
});

test('POINT OF USE: the key handed to the engine is a real one, not undefined', async () => {
  const s = sheet({ result: MADE });
  await s.run();
  assert.match(String(s.seen.calls[0].mnemonic || ''), /\S/,
    'the screen passed no key at all, so the engine minted its own and a retry would mint another');
});

test('POINT OF USE: …and a real account still reveals its words', async () => {
  const s = sheet({ result: MADE });
  await s.run();
  assert.equal(s.seen.made && s.seen.made.childPub, MADE.childPub, 'a working account never reaches the screen that hands over the words');
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
