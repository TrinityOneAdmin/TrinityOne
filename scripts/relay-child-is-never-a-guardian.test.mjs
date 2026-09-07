// A CHILD IS NEVER A GUARDIAN — the relay must not let a guardian link open a route between two children.
//   Run: node --test scripts/relay-child-is-never-a-guardian.test.mjs
//
// Sim round 3, defect D2. The console refuses to LINK a child as a parent ("Only adults (not other children)
// can be linked") but never re-checked a link that already existed: link an adult to a child, then mark that
// adult as a young person, and the `guardians:` map still names them. The relay's safeguardAllows() matched a
// guardian link in EITHER direction and let a match short-circuit the refusal — so two people the same church
// had marked as children could exchange private messages, which is the one thing the gate exists to prevent.
//
// Owner's decision, 2026-09-06 (reference/DOMAIN.md): a person the church marks as a child is never a valid
// guardian. Not when the link is made, and not afterwards.
//
// WHY THIS BOOTS A REAL RELAY. safeguardAllows() is a closure over module maps that only exist in a running
// gateway, and a lifted copy with `guardianLinkedIn` stubbed is exactly the kind of test that stays green
// with the rule dead (child-dm-needs-safeguarding-cap.test.mjs says so in its own header). So: seed a store
// with the documents a real church produces — members, a minors list, a guardians map that names a child as
// another child's parent — boot the gateway on it, and send the messages.
//
// WHAT IS ENFORCED HERE, AND WHAT IS NOT. The relay ignores the child's guardian entry at EVALUATION time. It
// does NOT refuse the `guardians:` write for containing a child — one bad entry would then block every
// legitimate link in the same document from an older console — and it does not rewrite the map. The console
// is what tidies the record (console-child-is-never-a-guardian.test.mjs); this is the boundary that holds
// when the console is old or modified, and it is retroactive because the relay rehydrates all history.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { openStore } from './event-store.mjs';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8945;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();
const kidA = K();      // marked as a child — AND still named as kidB's guardian, the D2 shape
const kidB = K();      // marked as a child
const parent = K();    // an ordinary adult, linked as kidB's guardian — the control the exemption exists for
const sibling = K();   // NOT marked as a child, linked as kidB's guardian — the church's own choice, and allowed

let relay, dataDir;

const waitReady = async (ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); };
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res({ ok: m[2] === true, why: m[3] || '' }); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
  setTimeout(() => { ws.off('message', on); res({ ok: false, why: 'timeout — the relay never answered' }); }, 4000);
});

const memberDoc = (who, cp) => finalizeEvent({ kind: 30078, created_at: now() - 900,
  tags: [['d', 'trinityone/member:' + cp], ['t', NET], ['p', cp]], content: JSON.stringify({ joined: true }) }, who.sk);
const minorsDoc = (pubs, at) => finalizeEvent({ kind: 30078, created_at: at,
  tags: [['d', 'trinityone/minors:' + church.pub], ['t', NET]], content: JSON.stringify({ pubkeys: pubs }) }, church.sk);
const guardiansDoc = (links, at) => finalizeEvent({ kind: 30078, created_at: at,
  tags: [['d', 'trinityone/guardians:' + church.pub], ['t', NET]], content: JSON.stringify({ links }) }, church.sk);
const dm = (from, toPub) => finalizeEvent({ kind: 4, created_at: now(), tags: [['p', toPub]], content: 'ciphertext' }, from.sk);

const send = async (from, to) => { const ws = await connect(); try { return await publish(ws, dm(from, to)); } finally { ws.close(); } };

before(async () => {
  await requireFreePort(PORT, 'relay-child-is-never-a-guardian.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-childguard-'));
  const store = openStore(join(dataDir, 'relay.sqlite'), { maxEvents: 5000 });
  for (const who of [kidA, kidB, parent, sibling]) store.put(memberDoc(who, church.pub));
  // The guardians map is OLDER than the minors list: the link was made first, the child mark came afterwards.
  // That is the order D2 was found in, and the order a "check at link time" fix cannot see.
  store.put(guardiansDoc({ [kidB.pub]: [kidA.pub, parent.pub, sibling.pub] }, now() - 800));
  store.put(minorsDoc([kidA.pub, kidB.pub], now() - 700));
  store.close();
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub) },
    stdio: 'ignore',
  });
  await waitReady();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('CONTROL: a linked ADULT guardian can still message the child, and the child can reply', async () => {
  // Without this the two refusals below would pass just as well against a relay that had closed the whole
  // guardian exemption — and a parent unable to reach their own child is a harm of its own, not a fix.
  const down = await send(parent, kidB.pub);
  assert.equal(down.ok, true, 'a linked adult guardian was refused (' + down.why + ') — the exemption for real parents is gone');
  const up = await send(kidB, parent.pub);
  assert.equal(up.ok, true, 'a child was refused their own linked parent (' + up.why + ') — the exemption for real parents is gone');
});

test('CONTROL: a guardian the church chose NOT to mark as a child is still allowed', async () => {
  // The boundary in DOMAIN.md: the gate is the mechanism, who is marked as a child is the policy. A church
  // that wants a seventeen-year-old sibling as a pickup contact does that by not marking them.
  const r = await send(sibling, kidB.pub);
  assert.equal(r.ok, true, 'an unmarked linked guardian was refused (' + r.why + ') — the relay is deciding who is a child, which is the church\'s call');
});

test('A CHILD NAMED AS ANOTHER CHILD\'S GUARDIAN CANNOT MESSAGE THEM', async () => {
  const r = await send(kidA, kidB.pub);
  assert.equal(r.ok, false,
    'two people this church marked as children exchanged a private message because the guardians: map names ' +
    'one as the other\'s parent. The console refused to make that link but never re-checked it once the ' +
    '"parent" was marked as a young person, and guardianLinkedIn matches in either direction. A child is ' +
    'never a guardian; the entry must be ignored where the decision is made.');
});

test('…and not the other way round either — the link matches in both directions', async () => {
  const r = await send(kidB, kidA.pub);
  assert.equal(r.ok, false,
    'the child whose "guardian" is another child could message them. safeguardAllows is asked in both ' +
    'directions at every kind-4 site; the clause has to hold for the recipient-child case too.');
});

test('MARKED AFTERWARDS, LIVE: marking a linked guardian as a child ends the route on the spot', async () => {
  // The seeded case above is what rehydration produces. This is the running relay: the sibling is allowed
  // (proved above), the church now marks them as a child, and nothing touches the guardians map at all.
  const ws = await connect();
  try {
    const w = await publish(ws, minorsDoc([kidA.pub, kidB.pub, sibling.pub], now()));
    assert.equal(w.ok, true, 'the harness could not update the minors list (' + w.why + ') — nothing below means anything');
  } finally { ws.close(); }
  await sleep(300);
  const r = await send(sibling, kidB.pub);
  assert.equal(r.ok, false,
    'a guardian who was marked as a child AFTER the link was made can still message the child. The relay ' +
    'evaluates the exemption per message, so this must follow from the minors list alone — no console ' +
    'tidy-up should be needed for the boundary to hold.');
  // and the adult parent is untouched by any of it
  const p = await send(parent, kidB.pub);
  assert.equal(p.ok, true, 'updating the minors list broke the adult parent\'s route (' + p.why + ')');
});
