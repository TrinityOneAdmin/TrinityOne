// Relay dashboard "Members" tile = APPROVED members summed over every church this relay hosts (owner decision
// 2026-11-12: a person in two churches counts twice; blocked people and leavers do not count; an open church
// counts everyone who joined). It used to show the number of kind-0 PROFILE events in the
// whole store — "4 churches, 7 members" on a box where the 7 were profiles, not people let in.
//   Run: node --test scripts/relay-dashboard-members.test.mjs      (own port 8152; never run with other relay tests)
//
// POINT OF USE: the real poll() is lifted out of relay-app/control.js and run against a REAL gateway (its fetch is
// the network, with the admin token the panel would hold). What is asserted is what lands in #s-members.
// Reverting the client to the kind-0 count, or dropping `members` from /stats, turns the first test red.
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

const SRC = readFileSync(new URL('../relay-app/control.js', import.meta.url), 'utf8');
const PORT = 8152;
const BASE = `http://127.0.0.1:${PORT}`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', JOINPOLICY_D = 'trinityone/joinpolicy:', ADMITTED_D = 'trinityone/admitted:', BLOCKED_D = 'trinityone/blocked:';
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

function liftPoll(fetchImpl) {
  const reg = SRC.match(/  function registeredChurches\(s, st\) \{[\s\S]*?\n  \}\n/);
  const poll = SRC.match(/  async function poll\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(reg && poll, 'registeredChurches/poll gone or reshaped — re-anchor this test');
  const body = poll[0];
  const els = {};
  const document = { getElementById: (id) => (els[id] ||= { textContent: '—', style: {}, className: '' }) };
  const adminFetch = (url, opts = {}) => fetchImpl(url, opts);
  const errors = [];
  const con = { error: (...a) => errors.push(a) };
  const fn = new Function('document', 'adminFetch', 'noteStatsStatus', 'renderNextStep', 'renderDisk', 'syncLineText', 'console',
    reg[0] + body + '; return poll;')(document, adminFetch, () => {}, () => {}, () => {}, () => '', con);
  return { poll: fn, els, errors };
}

// Three churches. A and B are approval-gated; O is OPEN (no approval needed).
//   A: Ada/Ben/Pat approved, Cal pending, Bob approved but then BLOCKED by A            -> 3
//   B: Pat (in BOTH A and B) and Dee approved, Eve pending                              -> 2
//   O: Fay and Gus joined (open church: joining is enough), Hal joined then LEFT        -> 2
// Approved per church: 3 + 2 + 2 = 7. Counting Bob (blocklist ignored) gives 8; counting Hal (leaver kept) gives 8;
// dropping the open church gives 5; counting pending gives 9. Profiles: everyone.
const A = K(), B = K(), O = K();
const ada = K(), ben = K(), pat = K(), cal = K(), dee = K(), eve = K(), bob = K(), fay = K(), gus = K(), hal = K();
const EXPECTED = 7;
let relay, dataDir, token;

const publish = (ws, evt) => new Promise((res) => {
  const on = (d) => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res(m[2]); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});
const doc = (who, d, content) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET]], content }, who.sk);

before(async () => {
  await requireFreePort(PORT, 'relay-dashboard-members.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-dmembers-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_LOOPBACK_ONLY: '1', CHURCH_NPUB: [A, B, O].map(k => npubEncode(k.pub)).join(',') },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/status')).ok) break; } catch {} await new Promise(r => setTimeout(r, 150)); }
  token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  const ws = await new Promise((res, rej) => { const w = new WebSocket(`ws://127.0.0.1:${PORT}/relay`); w.on('open', () => res(w)); w.on('error', rej); });
  try {
    for (const c of [A, B]) assert.equal(await publish(ws, doc(c, JOINPOLICY_D + c.pub, JSON.stringify({ approval: true }))), true, 'join policy refused');
    assert.equal(await publish(ws, doc(O, JOINPOLICY_D + O.pub, JSON.stringify({ approval: false }))), true, 'open join policy refused');
    for (const [c, people] of [[A, [ada, ben, pat, cal, bob]], [B, [pat, dee, eve]], [O, [fay, gus, hal]]])
      for (const p of people) assert.equal(await publish(ws, doc(p, MEMBER_D + c.pub, '{}')), true, 'member doc refused');
    assert.equal(await publish(ws, doc(A, ADMITTED_D + A.pub, JSON.stringify({ pubkeys: [ada.pub, ben.pub, pat.pub, bob.pub] }))), true);
    assert.equal(await publish(ws, doc(B, ADMITTED_D + B.pub, JSON.stringify({ pubkeys: [pat.pub, dee.pub] }))), true);
    // Bob is admitted at A, then A blocks him
    assert.equal(await publish(ws, doc(A, BLOCKED_D + A.pub, JSON.stringify({ pubkeys: [bob.pub] }))), true, 'blocklist refused');
    // Hal leaves O: the app's leave is the same member doc, emptied (later timestamp so it replaces the join)
    const leave = finalizeEvent({ kind: 30078, created_at: now() + 1, tags: [['d', MEMBER_D + O.pub], ['t', NET], ['deleted', '1']], content: '' }, hal.sk);
    assert.equal(await publish(ws, leave), true, 'leave refused');
    // profiles for everyone — the old tile counted these; whether the relay takes a pending joiner's is not asserted
    for (const p of [ada, ben, pat, cal, dee, eve, bob, fay, gus, hal])
      await publish(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'x' }) }, p.sk));
  } finally { ws.close(); }
});
after(() => { try { relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const authed = (url, opts = {}) => fetch(BASE + url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });

test('the Members tile shows APPROVED members summed per church (7): not profiles, not distinct people, not pending, not blocked, not leavers; open church counts its joiners', async () => {
  const { poll, els, errors } = liftPoll(authed);
  await poll();
  assert.deepEqual(errors, [], 'poll() hit its render-failure path');
  assert.equal(els['s-churches'].textContent, 3, 'church count (sanity: the poll rendered)');
  assert.equal(String(els['s-members'].textContent), String(EXPECTED),
    'Members tile is not the approved-per-church sum (A: ada, ben, pat; B: pat, dee; O: fay, gus — pending cal/eve, blocked bob, leaver hal excluded)');
  // and it is not secretly the old number: say what the kind-0 count was, so a coincidence would show
  const st = await (await authed('/stats?days=1')).json();
  const profiles = ((st.kinds || []).find(k => k.kind === 0) || {}).n;
  assert.notEqual(profiles, EXPECTED, `fixture no longer separates the two numbers (kind-0 count is ${profiles})`);
});

test('/stats carries `members` only behind the admin token; public /status does not', async () => {
  const r = await fetch(BASE + '/stats?days=1');
  assert.equal(r.status, 401, '/stats answered without the admin token');
  const pub = await (await fetch(BASE + '/status')).json();
  assert.equal(pub.counts, undefined, 'unauthed /status leaked counts');
  assert.equal(pub.members, undefined, 'unauthed /status leaked a member count');
});

test('an older relay that sends no `members` leaves the tile at — rather than another number', async () => {
  const { poll, els } = liftPoll(async (url) => ({
    ok: true, status: 200,
    json: async () => String(url).startsWith('/status') ? { uptimeMs: 1000, port: 1 } : { kinds: [{ kind: 0, n: 7 }], churches: [], connections: 0 },
  }));
  await poll();
  assert.equal(els['s-churches'].textContent, 0, 'sanity: the poll rendered the counts block');
  assert.equal((els['s-members'] || { textContent: '—' }).textContent, '—', 'tile was written from something other than `members`');
});
