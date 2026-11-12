// Relay dashboard "Members" tile = APPROVED members summed over every church this relay hosts (owner decision
// 2026-11-12: a person in two churches counts twice). It used to show the number of kind-0 PROFILE events in the
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
const MEMBER_D = 'trinityone/member:', JOINPOLICY_D = 'trinityone/joinpolicy:', ADMITTED_D = 'trinityone/admitted:';
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

// Two churches, both approval-gated. Ada/Ben/Pat approved at A, Cal pending at A. Pat (in BOTH) and Dee approved
// at B, Eve pending at B. Approved per church: A=3, B=2 → 5. Distinct approved people: 4. Profiles: everyone.
const A = K(), B = K();
const ada = K(), ben = K(), pat = K(), cal = K(), dee = K(), eve = K();
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
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_LOOPBACK_ONLY: '1', CHURCH_NPUB: [A, B].map(k => npubEncode(k.pub)).join(',') },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/status')).ok) break; } catch {} await new Promise(r => setTimeout(r, 150)); }
  token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  const ws = await new Promise((res, rej) => { const w = new WebSocket(`ws://127.0.0.1:${PORT}/relay`); w.on('open', () => res(w)); w.on('error', rej); });
  try {
    for (const c of [A, B]) assert.equal(await publish(ws, doc(c, JOINPOLICY_D + c.pub, JSON.stringify({ approval: true }))), true, 'join policy refused');
    for (const [c, people] of [[A, [ada, ben, pat, cal]], [B, [pat, dee, eve]]])
      for (const p of people) assert.equal(await publish(ws, doc(p, MEMBER_D + c.pub, '{}')), true, 'member doc refused');
    assert.equal(await publish(ws, doc(A, ADMITTED_D + A.pub, JSON.stringify({ pubkeys: [ada.pub, ben.pub, pat.pub] }))), true);
    assert.equal(await publish(ws, doc(B, ADMITTED_D + B.pub, JSON.stringify({ pubkeys: [pat.pub, dee.pub] }))), true);
    // profiles for everyone — the old tile counted these; whether the relay takes a pending joiner's is not asserted
    for (const p of [ada, ben, pat, cal, dee, eve])
      await publish(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'x' }) }, p.sk));
  } finally { ws.close(); }
});
after(() => { try { relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const authed = (url, opts = {}) => fetch(BASE + url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });

test('the Members tile shows APPROVED members summed per church (5), not profiles, not distinct people, not pending', async () => {
  const { poll, els, errors } = liftPoll(authed);
  await poll();
  assert.deepEqual(errors, [], 'poll() hit its render-failure path');
  assert.equal(els['s-churches'].textContent, 2, 'church count (sanity: the poll rendered)');
  assert.equal(String(els['s-members'].textContent), '5',
    'Members tile is not the approved-per-church sum (A: ada, ben, pat; B: pat, dee — pending cal and eve excluded)');
  // and it is not secretly the old number: say what the kind-0 count was, so a coincidence would show
  const st = await (await authed('/stats?days=1')).json();
  const profiles = ((st.kinds || []).find(k => k.kind === 0) || {}).n;
  assert.notEqual(profiles, 5, `fixture no longer separates the two numbers (kind-0 count is ${profiles})`);
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
