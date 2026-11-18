// A NETWORK'S ANNOUNCEMENTS AND EVENTS REACH ONLY THE CHURCHES THAT JOINED IT, WITH THAT SCOPE (Networks MVP, N5a, 2026-10-21).
// Run: node --test scripts/a-network-announcement-reaches-only-the-churches-that-joined-it.test.mjs   (SOLO -- fixed port)
//
// N1 took every church document away from a joined network key. N5a gives the network back exactly three things, each behind
// its own gate: `netann:` / `netevent:` content (read through netReader, never churchReader) and the `netkey:` envelope. It
// also closes two doors the network key used to walk through for free: the uncapped 30078 catch-all, and the cleartext
// kind-1 'net-announce' broadcast that was served to every member of every church on the box.
//
// NON-VACUITY (CLAUDE.md rules 1/7). Every REFUSAL below sits beside a CONTROL in which the same document IS served to a member
// of a church that joined with the matching scope -- so a refusal cannot be a dead relay, a wrong id, or a missing AUTH.
// The legacy read refusal is proved against an event that is demonstrably IN the store (read back through /export), because
// accept() now refuses to store one and a refusal of nothing proves nothing.
//
// PORTED 2026-11-18 (feat/networks-port-2026-11-18) unchanged in substance onto the network wall; runs against the REAL gateway on this branch.
//
// THE RELAY is the real gateway on a throwaway data dir, spawned AFTER this file is read, so it is newer than
// scripts/gateway.mjs (RELAY-ADMISSION rule 10) -- asserted explicitly.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

import { encrypt as _n44 } from 'nostr-tools/nip44';
import { generateSecretKey as _gsk } from 'nostr-tools/pure';
const REAL_E = () => _n44('x', _gsk());   // real NIP-44 v2 envelope: the relay requires the fingerprint
const PORT = 19871;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const P = 'trinityone/';
// four churches: A joined NET1 (announcements+events), C joined NET1 (events ONLY), D joined NET1 with NO scopes (legacy
// {joined:true} = the narrowest), B never joined NET1 (it joined NET2).
const A = K(), B = K(), C = K(), D = K();
const NET1 = K(), NET2 = K(), NETCAP = K();
const mA = K(), mB = K(), mC = K(), mD = K(), kidA = K(), blockedA = K(), stranger = K(), stewardB = K();
let relay, dataDir, spawnedAt, seq = 0;

const spawnRelay = () => spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
  env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: [A, B, C, D].map((c) => npubEncode(c.pub)).join(','), RELAY_MAX_EVENTS: '20000' },
});
async function waitUp() { for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); } throw new Error('relay did not come up'); }
const connect = (who) => new Promise((res, rej) => {
  const w = new WebSocket(WS_URL);
  w.on('open', () => { w.on('message', (d) => { const m = JSON.parse(d);
    if (m[0] === 'AUTH' && who) w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); }); res(w); });
  w.on('error', rej);
});
const publish = (w, evt) => new Promise((res) => { const on = (d) => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', evt])); setTimeout(() => res([null, 'timeout']), 5000); });
const read = (w, filters) => new Promise((res) => {
  const out = []; const id = 'r' + Math.random().toString(36).slice(2, 7);
  const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === id) out.push(m[2]); if (m[0] === 'EOSE' && m[1] === id) setTimeout(() => { w.off('message', on); res(out); }, 200); };
  w.on('message', on); w.send(JSON.stringify(['REQ', id, ...filters])); setTimeout(() => { w.off('message', on); res(out); }, 4000);
});
const ev = (who, kind, tags, content) => finalizeEvent({ kind, created_at: now() + (seq++), tags, content }, who.sk);
const doc = (who, d, content, extra = []) => ev(who, 30078, [['d', d], ['t', 'trinityone'], ...extra], typeof content === 'string' ? content : JSON.stringify(content));
const tomb = (who, d) => ev(who, 30078, [['d', d], ['t', 'trinityone'], ['deleted', '1']], '');
const sealed = (s = REAL_E()) => ({ v: 1, e: s });
async function served(who, id, kind = 30078) {
  const w = await connect(who); await sleep(200);
  const got = await read(w, [{ ids: [id], kinds: [kind] }]); w.close();
  return got.some((e) => e.id === id);
}
async function writes(who, e) { const w = await connect(who); await sleep(200); const [ok] = await publish(w, e); w.close(); return ok === true; }
async function ack(who, e) { const w = await connect(who); await sleep(200); const r = await publish(w, e); w.close(); return r; }
const join_ = (church, np, scopes) => doc(church, P + 'network:' + np, scopes === undefined ? { joined: true, v: 1 } : { joined: true, v: 1, scopes }, [['p', np]]);

before(async () => {
  await requireFreePort(PORT, 'a-network-announcement-reaches-only-the-churches-that-joined-it.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-n5a-'));
  relay = spawnRelay(); spawnedAt = Date.now(); await waitUp();
  const cw = {}; for (const [n, c] of [['A', A], ['B', B], ['C', C], ['D', D]]) cw[n] = await connect(c);
  const ok = async (c, e, why) => { const [k, m] = await publish(c, e); assert.equal(k, true, why + ' (' + m + ')'); return e; };
  await ok(cw.A, join_(A, NET1.pub, ['announcements', 'events']), 'A could not join NET1');
  await ok(cw.C, join_(C, NET1.pub, ['events']), 'C could not join NET1');
  await ok(cw.D, join_(D, NET1.pub), 'D could not join NET1');
  await ok(cw.B, join_(B, NET2.pub, ['announcements', 'events']), 'B could not join NET2');
  await ok(cw.A, join_(A, NETCAP.pub, ['announcements', 'events']), 'A could not join NETCAP');
  const anon = await connect(null);
  for (const [m, c] of [[mA, A], [mB, B], [mC, C], [mD, D], [kidA, A], [blockedA, A]]) await ok(anon, doc(m, P + 'member:' + c.pub, { joined: now() }, [['p', c.pub]]), 'member join refused');
  await ok(cw.A, doc(A, P + 'minors:' + A.pub, { pubkeys: [kidA.pub] }), 'minors list refused');
  await ok(cw.A, doc(A, P + 'blocked:' + A.pub, { pubkeys: [blockedA.pub] }), 'blocked list refused');
  await ok(cw.B, doc(B, P + 'stewards:' + B.pub, { pubkeys: [stewardB.pub], caps: { [stewardB.pub]: ['content'] } }), 'steward roster refused');
  anon.close(); Object.values(cw).forEach((w) => w.close());
  await sleep(500);
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('FRESHNESS (rule 10): the relay under test was spawned AFTER scripts/gateway.mjs was last written', () => {
  const gw = statSync(new URL('./gateway.mjs', import.meta.url).pathname).mtimeMs;
  assert.ok(spawnedAt > gw, 'a relay older than gateway.mjs would enforce old gates against the new bundle');
});

// ── WRITE: who may author network content ───────────────────────────────────────────────────────────────────────
const stored = {};
test('WRITE netann / netevent: the NETWORK key is accepted (control); a stranger, a member, a church, a steward and another network are not', async () => {
  const dA = P + 'netann:a1', dE = P + 'netevent:e1';
  const ann = (k) => doc(k, dA, sealed()), evt = (k) => doc(k, dE, sealed());
  for (const [who, name] of [[stranger, 'a stranger'], [mA, 'a member'], [A, 'a joined church key'], [B, 'a non-joined church key'], [stewardB, 'a steward']]) {
    assert.equal(await writes(who, ann(who)), false, `${name} authored a netann`);
    assert.equal(await writes(who, evt(who)), false, `${name} authored a netevent`);
  }
  const a = ann(NET1), e = evt(NET1);
  assert.equal(await writes(NET1, a), true, 'CONTROL: the network key itself was refused its own announcement -- the gate is shut for everyone');
  assert.equal(await writes(NET1, e), true, 'CONTROL: the network key itself was refused its own event');
  stored.ann = a.id; stored.evt = e.id;
  // a documents id is bound to its author: a different network writing the same d-tag makes ITS OWN row, never replaces NET1's
  assert.equal(await writes(NET2, doc(NET2, dA, sealed())), true, 'a second network could not write its own netann');
  const w = await connect(NET1); await sleep(200);
  const cur = await read(w, [{ kinds: [30078], authors: [NET1.pub], '#d': [dA] }]); w.close();
  assert.equal(cur[0] && cur[0].id, a.id, 'a different network replaced NET1\'s document at the same d-tag');
});

test('WRITE shape: the sealed {e} shape only -- every plaintext variant is refused', async () => {
  const bad = (d, c, extra, why) => async () => assert.equal(await writes(NET1, doc(NET1, d, c, extra || [])), false, why);
  await bad(P + 'netann:x1', { text: 'meet at my house' }, [], 'plaintext `text` field accepted')();
  await bad(P + 'netann:x2', { v: 1, e: 'QUJD', title: 'Youth night' }, [], 'a plaintext field BESIDE the sealed one accepted')();
  await bad(P + 'netann:x3b', { v: 1, e: Buffer.from('meet at 3pm').toString('base64') }, [], 'BASE64-WRAPPED PLAINTEXT accepted as the sealed string')();
  await bad(P + 'netevent:x3c', { e: Buffer.from('meet at 3pm, '.repeat(20)).toString('base64') }, [], 'LONG base64-wrapped plaintext (past the length floor) accepted')();
  await bad(P + 'netann:x3', { e: 'meet at my house tonight' }, [], 'a plaintext sentence accepted as the sealed string')();
  await bad(P + 'netann:x4', '{"e":', [], 'non-JSON accepted')();
  await bad(P + 'netann:x5', '["QUJD"]', [], 'a JSON array accepted')();
  await bad(P + 'netann:x6', { e: 12345 }, [], 'a non-string e accepted')();
  await bad(P + 'netann:x7', { e: '' }, [], 'an empty e accepted as live content')();
  await bad(P + 'netann:x8', { v: 'one', e: 'QUJD' }, [], 'a non-numeric v accepted')();
  await bad(P + 'netevent:x9', { e: 'QUJD'.repeat(6000) }, [], 'an oversize document accepted')();
  await bad(P + 'netann:bad id', sealed(), [], 'a d-tag id with a space accepted')();
  await bad(P + 'netann:', sealed(), [], 'an empty id accepted')();
  await bad(P + 'netann:' + 'a'.repeat(65), sealed(), [], 'an over-long id accepted')();
  await bad(P + 'netann:x10', sealed(), [['church', A.pub]], 'a ["church"] tag accepted (it would route the document into a church)')();
  await bad(P + 'netann:x11', sealed(), [['p', A.pub]], 'a ["p"] tag accepted')();
  await bad(P + 'netann:x12', sealed(), [['t', 'someroom']], 'a non-trinityone ["t"] tag accepted (it names a group)')();
  assert.equal(await writes(NET1, ev(NET1, 30078, [['d', P + 'netann:x13'], ['d', P + 'netann:x14'], ['t', 'trinityone']], JSON.stringify(sealed()))), false, 'two d tags accepted');
  // the control for every line above: the same call with a clean body is accepted
  assert.equal(await writes(NET1, doc(NET1, P + 'netann:ok1', sealed())), true, 'CONTROL: a clean sealed document was refused -- the refusals above prove nothing');
});

test('WRITE tombstones: a network can retract its own document; a "tombstone" that carries content is refused', async () => {
  assert.equal(await writes(NET1, doc(NET1, P + 'netann:t1', sealed())), true, 'setup');
  assert.equal(await writes(NET1, tomb(NET1, P + 'netann:t1')), true, 'the network could not retract its own announcement');
  assert.equal(await writes(NET1, ev(NET1, 30078, [['d', P + 'netann:t1'], ['t', 'trinityone'], ['deleted', '1']], JSON.stringify(sealed()))), false, 'a tombstone with content slipped past the shape check');
  assert.equal(await writes(stranger, tomb(stranger, P + 'netann:t1')), false, 'a stranger tombstoned (wrote) a netann');
});

test('WRITE cap: a network holds at most 300 distinct netann+netevent documents; replacing one of them is still allowed', { timeout: 120000 }, async () => {
  const w = await connect(NETCAP); await sleep(200);
  let accepted = 0, firstRefusal = -1;
  for (let i = 0; i < 305; i++) {
    const [ok] = await publish(w, doc(NETCAP, P + (i % 2 ? 'netevent:' : 'netann:') + 'c' + i, sealed()));
    if (ok === true) accepted++; else if (firstRefusal < 0) firstRefusal = i;
  }
  assert.equal(accepted, 300, 'the per-network cap is not 300 (accepted ' + accepted + ')');
  assert.equal(firstRefusal, 300, 'the first refusal was not the 301st document');
  const [again] = await publish(w, doc(NETCAP, P + 'netann:c0', sealed()));
  assert.equal(again, true, 'replacing an existing document at the cap was refused -- a network could never edit once full');
  const [tomb2] = await publish(w, tomb(NETCAP, P + 'netann:c0'));
  assert.equal(tomb2, true, 'a retraction at the cap was refused');
  w.close();
});

// ── READ: who is served a network's content ─────────────────────────────────────────────────────────────────────
test('READ netann: served to a member of a church that JOINED with `announcements` (control); refused to every other reader', async () => {
  assert.equal(await served(mA, stored.ann), true, 'CONTROL: a member of a church that joined NET1 with announcements was NOT served -- every refusal below proves nothing');
  const refused = [
    [mB, 'a member of a church that did NOT join NET1 (it joined another network)'],
    [mC, 'a member of a church that joined NET1 WITHOUT the announcements scope (events only)'],
    [mD, 'a member of a church that joined NET1 with NO scopes recorded (the narrowest)'],
    [stranger, 'a stranger'], [null, 'an anonymous reader'],
    [NET2, 'the key of a DIFFERENT network'], [B, 'the key of a church that did not join'], [C, 'the key of a church joined without the scope'], [D, 'the key of a church joined with no scopes'], [stewardB, 'a steward of a church that did not join'],
    [kidA, 'a CHILD of the joined church (a safeguarding refusal: an outside party\'s notice is not put in front of a young person unasked)'],
    [blockedA, 'a member the joined church has BLOCKED'],
  ];
  for (const [who, name] of refused) assert.equal(await served(who, stored.ann), false, `${name} was served the network announcement`);
  assert.equal(await served(A, stored.ann), true, 'the joined church key itself must be served (it is the reader the envelope is addressed to)');
  assert.equal(await served(NET1, stored.ann), true, 'the author reads its own document');
});

test('READ netevent: served to a member of a church that joined with `events`, INCLUDING the events-only church; refused to the rest', async () => {
  assert.equal(await served(mA, stored.evt), true, 'CONTROL: a member of a church that joined with events was NOT served');
  assert.equal(await served(mC, stored.evt), true, 'a member of the EVENTS-ONLY church was not served the event -- the scope split over-blocks');
  const refused = [[mB, 'a non-joined church member'], [mD, 'a no-scopes church member'], [stranger, 'a stranger'], [null, 'anon'], [NET2, 'another network key'], [B, 'a non-joined church key'], [D, 'a no-scopes church key'], [kidA, 'a child of the joined church'], [blockedA, 'a blocked member']];
  for (const [who, name] of refused) assert.equal(await served(who, stored.evt), false, `${name} was served the network event`);
});

test('READ is by SCOPE and JOIN, live: leaving stops it, re-joining with a narrower scope serves only that scope', async () => {
  const cw = await connect(A); await sleep(200);
  const put = async (e, why) => { const [k, m] = await publish(cw, e); assert.equal(k, true, why + ' (' + m + ')'); };
  await put(tomb(A, P + 'network:' + NET1.pub), 'A could not leave NET1'); await sleep(300);
  assert.equal(await served(mA, stored.ann), false, 'a church that LEFT the network still reads its announcements');
  assert.equal(await served(mA, stored.evt), false, 'a church that LEFT the network still reads its events');
  await put(join_(A, NET1.pub, ['events']), 'A could not re-join with events only'); await sleep(300);
  assert.equal(await served(mA, stored.ann), false, 'narrowing the consent to events left announcements readable');
  assert.equal(await served(mA, stored.evt), true, 'the re-joined, events-scoped church lost its events');
  await put(join_(A, NET1.pub, ['announcements', 'events']), 'A could not restore'); await sleep(300);
  assert.equal(await served(mA, stored.ann), true, 'restoring the scope did not restore the announcements');
  cw.close();
});

// ── netkey / netkeyc ────────────────────────────────────────────────────────────────────────────────────────────
test('netkey:<np> (hop 1): written by the network key only, for itself; READ by the author and a church that joined -- never a member', async () => {
  const dk = P + 'netkey:' + NET1.pub;
  const body = { v: 1, rev: 1, keys: { [A.pub]: 'QUJDREVGR0g', [C.pub]: 'SUpLTE1OT1A' } };
  assert.equal(await writes(stranger, doc(stranger, P + 'netkey:' + stranger.pub, body)), false, 'a stranger wrote a netkey');
  assert.equal(await writes(A, doc(A, dk, body)), false, 'a church wrote the network\'s netkey');
  assert.equal(await writes(NET2, doc(NET2, dk, body)), false, 'a different network wrote NET1\'s netkey (the d-tag must be the author\'s own pubkey)');
  assert.equal(await writes(NET1, doc(NET1, dk, { ...body, text: 'x' })), false, 'a plaintext field beside the envelope accepted');
  assert.equal(await writes(NET1, doc(NET1, dk, { v: 1, rev: 1, keys: { notahexkey: 'QUJD' } })), false, 'a recipient that is not a pubkey accepted');
  assert.equal(await writes(NET1, doc(NET1, dk, { v: 1, rev: 1, keys: { [A.pub]: 'plain text with spaces' } })), false, 'a non-base64 wrapped key accepted');
  const e = doc(NET1, dk, body);
  assert.equal(await writes(NET1, e), true, 'CONTROL: the network could not write its own netkey');
  assert.equal(await served(NET1, e.id), true, 'the author cannot read its own netkey');
  assert.equal(await served(A, e.id), true, 'CONTROL: the church that joined was not served the envelope addressed to it');
  assert.equal(await served(C, e.id), true, 'the second joined church was not served');
  for (const [who, name] of [[mA, 'a MEMBER of the joined church'], [stewardB, 'a steward'], [B, 'a church that did not join'], [NET2, 'another network'], [stranger, 'a stranger'], [null, 'anon']])
    assert.equal(await served(who, e.id), false, `${name} was served the network key envelope`);
});

test('netkeyc:<np> (hop 2): written by a CHURCH key that joined; read by that church\'s members -- not by another church\'s members nor the network', async () => {
  const dk = P + 'netkeyc:' + NET1.pub, body = { e: 'QUJDREVGR0hJSg' };
  assert.equal(await writes(B, doc(B, dk, body)), false, 'a church that did NOT join NET1 re-sealed its ring');
  assert.equal(await writes(mA, doc(mA, dk, body)), false, 'a member wrote the church\'s hop-2 envelope');
  assert.equal(await writes(NET1, doc(NET1, dk, body)), false, 'the network key wrote a hop-2 envelope');
  const e = doc(A, dk, body);
  assert.equal(await writes(A, e), true, 'CONTROL: the joined church could not write its hop-2 envelope');
  assert.equal(await served(mA, e.id), true, 'CONTROL: a member of the church was not served its own hop-2 envelope');
  for (const [who, name] of [[mB, 'a member of another church'], [NET1, 'the NETWORK key'], [stranger, 'a stranger'], [null, 'anon']])
    assert.equal(await served(who, e.id), false, `${name} was served a church's hop-2 envelope`);
});

test('KEY envelopes are auth-challenged: an unauthenticated REQ for netkey:/netkeyc: is challenged (KEY_ENVELOPE_D)', async () => {
  for (const d of [P + 'netkey:' + NET1.pub, P + 'netkeyc:' + NET1.pub]) {
    const sawAuth = await new Promise((res) => {
      const w = new WebSocket(WS_URL); let got = false;
      w.on('open', () => { w.send(JSON.stringify(['REQ', 'k', { kinds: [30078], '#d': [d] }])); });
      w.on('message', (m) => { const f = JSON.parse(m); if (f[0] === 'AUTH') got = true; if (f[0] === 'EOSE') { w.close(); res(got); } });
      setTimeout(() => { try { w.close(); } catch {} res(got); }, 3000);
    });
    assert.equal(sawAuth, true, d + ' was not challenged');
  }
});

// ── THE NETWORK KEY IS NARROWED ─────────────────────────────────────────────────────────────────────────────────
test('NARROWED: a network key may write a profile and its net* documents -- and nothing else (CONTROLS first)', async () => {
  // Ported 2026-11-18 onto the wall: "nothing else" now means nothing a STRANGER could not also write (a stranger's profile, member: join and
  // stewardreq: doors stay open to it -- see a-joined-network-key-has-no-authority-over-church-content). No _pureNet guard was ported; the wall's
  // isMember (no network term) is what refuses every row below.
  assert.equal(await writes(NET1, ev(NET1, 0, [], JSON.stringify({ name: 'Network One' }))), true, 'CONTROL: the network profile was refused -- createNetwork would fail');
  assert.equal(await writes(NET1, doc(NET1, P + 'netann:n1', sealed())), true, 'CONTROL: its own announcement was refused');
  // the old catch-all: ANY d-tag, uncapped
  assert.equal(await writes(NET1, doc(NET1, P + 'zz-anything:1', { x: 1 })), false, 'the network key still writes an arbitrary d-tag through the catch-all');
  assert.equal(await writes(mA, doc(mA, P + 'wallet:w1', { x: 1 })), true, 'CONTROL: an ordinary member could not write a member-docs type, so the refusal below proves nothing');
  assert.equal(await writes(NET1, doc(NET1, P + 'wallet:w1', { x: 1 })), false, 'the network key wrote a member-docs type');
  assert.equal(await writes(NET1, doc(NET1, 'finance/account:bank', { x: 1 })), false, 'the network key wrote finance');
  assert.equal(await writes(NET1, doc(NET1, P + 'careslot:zz:1', { x: 1 }, [['church', A.pub]])), false, 'the network key wrote a care slot (the unknown-owner `isMember` fallback)');
  // other kinds that ended in `return isMember`
  assert.equal(await writes(NET1, ev(NET1, 7, [['e', 'a'.repeat(64)], ['p', mA.pub]], '+')), false, 'the network key wrote a reaction');
  assert.equal(await writes(NET1, ev(NET1, 4, [['p', mA.pub]], 'hi')), false, 'the network key sent a DM');
  assert.equal(await writes(NET1, ev(NET1, 1, [['t', 'trinityone'], ['t', 'someroom']], 'hello')), false, 'the network key posted chat');
  // a church/steward writing its own docs is untouched (the callers of the old line)
  assert.equal(await writes(A, doc(A, P + 'zz-anything:1', { x: 1 })), true, 'a CHURCH can no longer write through the catch-all -- the narrowing over-reached');
  // a network key that is ALSO a member takes the ordinary capped member path, and a church declaring a member a "network" must not silence them
  const victim = K();
  const anon = await connect(null);
  assert.equal((await publish(anon, doc(victim, P + 'member:' + B.pub, { joined: now() }, [['p', B.pub]])))[0], true, 'setup: victim joins B');
  anon.close(); await sleep(300);
  const cw = await connect(A); await sleep(200);
  assert.equal((await publish(cw, doc(A, P + 'network:' + victim.pub, { joined: true, v: 1 })))[0], true, 'setup: church A declares the victim a network'); cw.close(); await sleep(300);
  const chat = ev(victim, 1, [['t', 'g-open'], ['church', B.pub]], 'still allowed to speak');
  const vr = await ack(victim, chat);
  assert.notEqual(vr[1], 'blocked: not a member', 'declaring a member a "network" silenced them everywhere');
  assert.equal(await writes(victim, doc(victim, P + 'wallet:w2', { x: 1 })), true, 'a member declared a network lost their ordinary member documents');
});

// ── THE LEGACY CLEARTEXT BROADCAST ──────────────────────────────────────────────────────────────────────────────
test('LEGACY net-announce: refused on WRITE from the network key and from anyone; and NOT SERVED on read even when it is in the store', async () => {
  const legacy = (k) => ev(k, 1, [['t', 'trinityone'], ['t', 'net-announce'], ['p', NET1.pub]], 'Cleartext words for every church');
  for (const [who, name] of [[NET1, 'the network key'], [mA, 'a member'], [A, 'a church'], [stranger, 'a stranger']])
    assert.equal(await writes(who, legacy(who)), false, `${name} posted a cleartext net-announce`);
  // READ: put one in the store the only way left -- the church's /import (it bypasses accept(), as a restore must) -- and prove it is THERE.
  const e = legacy(NET1);
  const url = `http://127.0.0.1:${PORT}/import`;
  const auth = (path, key) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({ kind: 27235, created_at: now(), tags: [['u', `http://127.0.0.1:${PORT}${path}`], ['method', 'POST'], ['church', A.pub]], content: '' }, key.sk))).toString('base64');
  const r = await fetch(url, { method: 'POST', headers: { Authorization: auth('/import', A) }, body: JSON.stringify(e) + '\n' });
  assert.equal(r.status, 200, '/import refused the setup: ' + r.status);
  await sleep(1500);
  const x = await fetch(`http://127.0.0.1:${PORT}/export`, { headers: { Authorization: auth('/export', A) } });
  const exported = x.status === 200 ? await x.text() : '';
  assert.ok(exported.includes(e.id), 'NON-VACUITY: the legacy event is not in the store (export status ' + x.status + ') -- the read refusal below would prove nothing');
  for (const [who, name] of [[mA, 'a member of a joined church'], [mB, 'a member of another church'], [mC, 'a member of a third'], [stranger, 'a stranger'], [null, 'anon'], [NET1, 'the author']])
    assert.equal(await served(who, e.id, 1), false, `${name} was served the legacy cleartext net-announce`);
});
