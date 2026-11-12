// A REVOKED HELPER MUST BE TOLD — AND NO ONE ELSE MAY LEARN WHO WAS DROPPED.
// Run: node --test scripts/a-revoked-helper-is-told-and-evicted.test.mjs
//
// THE BUG (2026-11-05, helper-delegation). When the owner revokes a delegated steward ("helper"), the relay
// correctly stops serving that key the church's documents — INCLUDING the stewards: roster event that would tell
// their app it was dropped — so their console kept showing a dead "ghost" church for ever. THE FIX is a dedicated
// church-signed notice at d=stewardrevoke:<removed helper pub> that the removed helper CAN still read, and which
// their subscribeStewardedChurches evicts the ghost on. This file proves the three surfaces of that fix against
// what actually ships:
//
//   RELAY  (scripts/gateway.mjs, driven as a real process): the SUBJECT may read their own stewardrevoke:; a
//          different authenticated member may NOT (closing a "who got revoked" leak); only a CHURCH key may write
//          it (a member key and a non-church key are refused).
//   HELPER (src/steward.src.js, the branch LIFTED FROM THE SHIPPED BUNDLE and run): a live revoke authored by a
//          church we steward, newer than the roster, evicts it; a tombstone/empty is a no-op; an older-than-roster
//          revoke is a no-op; a revoke authored by a key we do NOT steward is ignored (forgery guard).
//   OWNER  (app/stew-dashboard.jsx, remove()/add() LIFTED and run): remove() publishes the revoke ONLY once the
//          roster removal is confirmed landed — never on not-landed/unknown; add() publishes the cancelling tombstone.
//
// ⚠ NOT A CODE FAILURE IF YOU SEE IT: the relay section starts a gateway on a fixed high port. If that port is
// held, requireFreePort names the holding PID — kill THAT pid, never `pkill -f` (it kills other agents and this
// very shell). The relay must be a child of THIS process; the read gate is default-deny and needs a real NIP-42
// AUTH, so each read opens its own socket and authenticates as exactly one key — an anonymous socket reads EMPTY
// and would look exactly like a refusal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const STEWARDREVOKE_D = 'trinityone/stewardrevoke:';
const STEWARDS_D = 'trinityone/stewards:';
const MEMBER_D = 'trinityone/member:';
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 1 — THE RELAY. A real gateway, driven over sockets, so the read/write GATES run for real.
// ────────────────────────────────────────────────────────────────────────────────────────────────────────
const PORT = 19562;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;

const church = K();        // the owner's church key (configured as CHURCH_NPUB, so it is in CHURCH_PUBS)
const helperB = K();       // the delegated helper the owner revokes — the SUBJECT of the notice
const memberC = K();       // a different authenticated member of the same church
const outsider = K();      // a non-church, non-member key
const cp = church.pub;
let relay, dataDir;

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('relay never came up on :' + PORT);
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
// publish AS a signed event, authenticating when the relay challenges (writes to church-scoped docs need it).
const publishAs = (who, evt) => new Promise(async (res) => {
  const ws = await connect();
  const on = d => {
    const m = JSON.parse(d);
    if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
    else if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); try { ws.close(); } catch {} res({ ok: m[2], why: m[3] || '' }); }
  };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});
// ONE SOCKET PER QUESTION, authenticated as exactly one key — the only honest way to ask a default-deny gate.
async function askAs(who, filters, window = 900) {
  const ws = await connect();
  const subId = 'q' + Math.random().toString(36).slice(2, 8);
  const events = await new Promise((resolve) => {
    const out = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) out.push(m[2]);
      else if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
    };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, ...filters]));
    setTimeout(() => { ws.off('message', on); resolve(out); }, window);
  });
  try { ws.close(); } catch {}
  return events;
}

const revokeEvt = (signer, subjectPub, { tomb = false } = {}) => finalizeEvent({
  kind: 30078, created_at: now(),
  tags: tomb ? [['d', STEWARDREVOKE_D + subjectPub], ['t', NET], ['deleted']]
             : [['d', STEWARDREVOKE_D + subjectPub], ['t', NET], ['p', subjectPub]],
  content: tomb ? '' : JSON.stringify({ revoked: subjectPub }),
}, signer.sk);

before(async () => {
  await requireFreePort(PORT, 'a-revoked-helper-is-told-and-evicted.test.mjs (it spawns its own gateway)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-revoke-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  await waitReady();
  // memberC is a real member of the church (so "a different authenticated MEMBER cannot read it" is faithful).
  await publishAs(memberC, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp], ['t', NET]], content: '{}' }, memberC.sk));
});
after(async () => {
  await new Promise((res) => { if (!relay) return res(); relay.once('exit', () => res()); try { relay.kill(); } catch { res(); } });
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('WRITE: only a church key may write a stewardrevoke notice', async () => {
  const byChurch = await publishAs(church, revokeEvt(church, helperB.pub));
  assert.equal(byChurch.ok, true, 'the church key must be able to write stewardrevoke:<anyone> — got: ' + byChurch.why);
  const byMember = await publishAs(memberC, revokeEvt(memberC, helperB.pub));
  assert.equal(byMember.ok, false, 'a MEMBER key must NOT be able to write a stewardrevoke notice (forged eviction)');
  const byOutsider = await publishAs(outsider, revokeEvt(outsider, helperB.pub));
  assert.equal(byOutsider.ok, false, 'a non-church key must NOT be able to write a stewardrevoke notice');
});

test('READ: the subject may read their own revoke; a different member may not', async () => {
  // (the church wrote helperB's notice in the WRITE test above; it is on disk now)
  const filter = [{ kinds: [30078], '#d': [STEWARDREVOKE_D + helperB.pub] }];
  const asSubject = await askAs(helperB, filter);
  const mine = asSubject.filter(e => ((e.tags.find(t => t[0] === 'd') || [])[1] || '') === STEWARDREVOKE_D + helperB.pub);
  assert.equal(mine.length, 1, 'the SUBJECT (the removed helper) must receive their own stewardrevoke notice');

  const asMember = await askAs(memberC, filter);
  const leaked = asMember.filter(e => ((e.tags.find(t => t[0] === 'd') || [])[1] || '') === STEWARDREVOKE_D + helperB.pub);
  assert.equal(leaked.length, 0, 'a DIFFERENT authenticated member must NOT be served another helper’s revoke notice (who-got-revoked leak)');

  // and an outsider learns nothing either
  const asOutsider = await askAs(outsider, filter);
  assert.equal(asOutsider.length, 0, 'an outsider must be served nothing');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 2 — THE HELPER HANDLER. The STEWARDREVOKE_D branch of subscribeStewardedChurches, LIFTED OUT OF THE
// SHIPPED BUNDLE (vendor/steward.js) and RUN. A text match would pass over a dead branch (house rule 3); this
// drives it, so deleting or weakening the branch turns a case red.
// ────────────────────────────────────────────────────────────────────────────────────────────────────────
const VENDOR = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');

function makeHelperHandler(ctx) {
  // Everything the branch reaches, and nothing it does not. A missing stub throws a named ReferenceError rather
  // than resolving to a stray global, so the test cannot pass by accident.
  const stubs = {
    STEWARDREVOKE_D,
    stewardedChurches: ctx.stewardedChurches,
    seenAt: ctx.seenAt,
    save: () => { ctx.saves++; },
    actingChurch: ctx.actingChurch,
    _ownKeyBlank: () => !!ctx.ownKeyBlank,
    _ownedPubs: ctx.ownedPubs || new Set(),
    churchPub: ctx.churchPub || 'own-church',
    cb: (list) => { ctx.cbCalls.push(list); },
    window: { Steward: { setActiveIdentity: (to, opts) => { ctx.switches.push({ to, opts }); } } },
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('the lifted handler needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const branch = fnBody(VENDOR, 'if (d.startsWith(STEWARDREVOKE_D)) {', 'the stewardrevoke branch in subscribeStewardedChurches');
  return new Function('scope', `with (scope) { return function(e){ const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; ${branch} return 'nomatch'; }; }`)(scope);
}
// a church key we steward (X), a forger (R)
const X = getPublicKey(generateSecretKey());
const R = getPublicKey(generateSecretKey());
const revokeFor = (author, subject, { ts = 100, tomb = false, empty = false } = {}) => ({
  pubkey: author, created_at: ts,
  tags: tomb ? [['d', STEWARDREVOKE_D + subject], ['t', NET], ['deleted']] : [['d', STEWARDREVOKE_D + subject], ['t', NET], ['p', subject]],
  content: (tomb || empty) ? '' : JSON.stringify({ revoked: subject }),
});
const freshCtx = (over = {}) => ({ stewardedChurches: new Map([[X, { name: 'X' }]]), seenAt: new Map(), actingChurch: null, ownKeyBlank: false, ownedPubs: new Set(), churchPub: 'own-church', saves: 0, cbCalls: [], switches: [], ...over });

test('HELPER: a live revoke from a church we steward, newer than the roster, evicts it', () => {
  const ctx = freshCtx({ seenAt: new Map([[X, 50]]) });
  makeHelperHandler(ctx)(revokeFor(X, X, { ts: 100 }));
  assert.equal(ctx.stewardedChurches.has(X), false, 'the ghost church must be evicted');
  assert.equal(ctx.cbCalls.length, 1, 'the switcher must be told the list changed');
});

test('HELPER: when we were acting as the evicted church, identity switches away', () => {
  const ctx = freshCtx({ seenAt: new Map([[X, 50]]), actingChurch: X });
  makeHelperHandler(ctx)(revokeFor(X, X, { ts: 100 }));
  assert.equal(ctx.stewardedChurches.has(X), false);
  assert.equal(ctx.switches.length, 1, 'acting identity must be switched off the church that revoked us');
});

test('HELPER: a tombstone is a no-op (a re-added helper’s cancelled revoke)', () => {
  const ctx = freshCtx({ seenAt: new Map([[X, 50]]) });
  makeHelperHandler(ctx)(revokeFor(X, X, { ts: 100, tomb: true }));
  assert.equal(ctx.stewardedChurches.has(X), true, 'a tombstone must NOT evict');
  assert.equal(ctx.cbCalls.length, 0);
});

test('HELPER: an empty-content notice is a no-op', () => {
  const ctx = freshCtx({ seenAt: new Map([[X, 50]]) });
  makeHelperHandler(ctx)(revokeFor(X, X, { ts: 100, empty: true }));
  assert.equal(ctx.stewardedChurches.has(X), true, 'empty content must NOT evict');
  assert.equal(ctx.cbCalls.length, 0);
});

test('HELPER: a revoke OLDER than the roster we have seen is a no-op (a live roster wins)', () => {
  const ctx = freshCtx({ seenAt: new Map([[X, 100]]) });
  makeHelperHandler(ctx)(revokeFor(X, X, { ts: 80 }));
  assert.equal(ctx.stewardedChurches.has(X), true, 'a readable roster still listing us must win over an older revoke');
  assert.equal(ctx.cbCalls.length, 0);
});

test('HELPER forgery guard: a revoke whose AUTHOR we do not steward is ignored', () => {
  // (a) addressed at X but authored by a forger R: authority is the AUTHOR, never the d-tag subject, so X stays.
  const ctxA = freshCtx();
  makeHelperHandler(ctxA)(revokeFor(R, X, { ts: 100 }));
  assert.equal(ctxA.stewardedChurches.has(X), true, 'a forger must not evict X by merely ADDRESSING the notice to X');
  assert.equal(ctxA.cbCalls.length, 0, 'nothing must change for a forged author');
  // (b) authored by a forger R and addressed at R: not a church we steward, so stewardedChurches.has(R) is false.
  const ctxB = freshCtx();
  makeHelperHandler(ctxB)(revokeFor(R, R, { ts: 100 }));
  assert.equal(ctxB.cbCalls.length, 0, 'an author we do not steward must be ignored outright');
  assert.equal(ctxB.stewardedChurches.has(X), true);
});

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 3 — THE OWNER CONSOLE. remove() and add() LIFTED OUT OF app/stew-dashboard.jsx (it ships unbundled,
// so a text match proves nothing — house rule 3) and RUN with stubs, so the publish fires from the real code path.
// ────────────────────────────────────────────────────────────────────────────────────────────────────────
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

function liftOwner(name, anchor, stubs) {
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError(name + ' needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  // `const <name> = (…) => { … }` — a semicolon after it terminates the declaration before `return` (ASI does not
  // fire with only a space between the arrow body's `}` and `return`).
  const body = fnBody(DASH, anchor, name);
  return new Function('scope', `with (scope) { ${body}; return ${name}; }`)(scope);
}
const flush = () => new Promise(r => setTimeout(r, 30));
const PK = 'helper-key-removed';

function ownerStubs(over = {}) {
  const calls = { revoke: [], tomb: [], setStewards: [], rotate: 0 };
  const Steward = {
    setStewards: (list) => { calls.setStewards.push(list); return over.setStewardsResolves !== undefined ? over.setStewardsResolves : true; },
    stewardRemovalOutcome: () => (over.outcome || 'unknown'),
    publishStewardRevoke: (pk) => { calls.revoke.push(pk); },
    clearStewardRevoke: (pk) => { calls.tomb.push(pk); },
    listIsFresh: () => false,
  };
  const stubs = {
    setConfirmRemove: () => {}, setRemoveNote: () => {}, markHandled: () => {}, answeredAt: () => 0, since: {},
    // optimistic-revoke console-UI (stew-dashboard.jsx DashStewardsPanel, pendingRemoval state): the board hides the row while the write settles.
    // UI-only — no-ops here — but remove() guards on pendingRemoval.has(pk) and calls drop/restoreOptimistic.
    pendingRemoval: new Set(), dropOptimistic: () => {}, restoreOptimistic: () => {},
    setAdding: () => {}, setScanning: () => {}, setQ: () => {}, setCode: () => {}, setAddErr: () => {}, setApproving: () => {},
    setNewLabel: () => {}, setNewCaps: () => {},
    stewards: [PK, 'other-steward'], labels: {}, caps: {}, byPub: new Map(), niceName: () => 'A helper',
    blockedList: [], members: [], groups: [],
    spKr: { approved: () => [], orAdmitted: () => [] },
    rotateChurchKeys: () => { calls.rotate++; return Promise.resolve(Object.assign([], { pending: [] })); },
    window: { Steward },
  };
  return { stubs, calls };
}

test('OWNER remove(): publishes the revoke ONLY when the removal landed', async () => {
  // landed directly (setStewards acknowledged)
  { const { stubs, calls } = ownerStubs({ setStewardsResolves: true });
    liftOwner('remove', 'const remove = (pk) => {', stubs)(PK); await flush();
    assert.deepEqual(calls.revoke, [PK], 'a landed removal must publish exactly one revoke, for the removed pk');
    assert.equal(calls.rotate, 1, 'a landed removal also re-keys'); }

  // landed via the outcome re-read (ack lost, relay confirms it is gone)
  { const { stubs, calls } = ownerStubs({ setStewardsResolves: false, outcome: 'landed' });
    liftOwner('remove', 'const remove = (pk) => {', stubs)(PK); await flush();
    assert.deepEqual(calls.revoke, [PK], 'a removal confirmed landed by re-read must still publish the revoke'); }

  // NOT landed — every relay still lists them: must NOT publish
  { const { stubs, calls } = ownerStubs({ setStewardsResolves: false, outcome: 'not-landed' });
    liftOwner('remove', 'const remove = (pk) => {', stubs)(PK); await flush();
    assert.deepEqual(calls.revoke, [], 'a removal that did NOT land must NOT evict the helper');
    assert.equal(calls.rotate, 0, 'and must re-key nothing'); }

  // unknown — cannot confirm: must NOT publish
  { const { stubs, calls } = ownerStubs({ setStewardsResolves: false, outcome: 'unknown' });
    liftOwner('remove', 'const remove = (pk) => {', stubs)(PK); await flush();
    assert.deepEqual(calls.revoke, [], 'an unconfirmed removal must NOT evict the helper'); }
});

test('OWNER add(): publishes the cancelling tombstone (every re-add path runs through add())', () => {
  const { stubs, calls } = ownerStubs();
  liftOwner('add', 'const add = (pk, label, grants) => {', stubs)(PK, 'A helper', ['care']);
  assert.deepEqual(calls.tomb, [PK], 're-adding a helper must tombstone any prior revoke for them');
});
