// Relay dashboard "Churches" headline = REGISTERED churches (authed /status counts.churches), not active ones.
//   Run: node --test scripts/relay-dashboard-count.test.mjs      (own port 8891; never run with other relay tests)
//
// Test 1 drives the REAL relay-app/control.js: it runs the real poll() (extracted from source, with a stubbed
// fetch/DOM) and reads what lands in #s-churches. Reverting the client to (st.churches||[]).length, or dropping the
// token from the /status fetch, turns it red. Test 2 proves the SERVER only (not the client fix).
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
const PORT = 8891;

function liftPoll(fetchStub) {
  const reg = SRC.match(/  function registeredChurches\(s, st\) \{[\s\S]*?\n  \}\n/);
  const poll = SRC.match(/  async function poll\(\) \{[\s\S]*?\n  \}\n  \/\/ ── setup wizard|  async function poll\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(reg && poll, 'registeredChurches/poll gone or reshaped — re-anchor this test');
  const body = poll[0].replace(/\n  \/\/ ── setup wizard$/, '\n');
  const els = {};
  const document = { getElementById: (id) => (els[id] ||= { textContent: '', style: {}, className: '' }) };
  const fn = new Function('fetch', 'document', 'authHeaders', 'renderNextStep', 'renderDisk', 'console',
    reg[0] + body + '; return poll;')(fetchStub, document, () => ({ Authorization: 'Bearer T' }), () => {}, () => {}, console);
  return { poll: fn, els };
}
const J = (o) => Promise.resolve({ ok: true, json: () => Promise.resolve(o) });
const stub = (status) => (url, opts) => {
  if (String(url).startsWith('/status')) return J(status(opts));
  return J({ kinds: [], churches: [{ church: 'a', n: 1 }], connections: 0 });
};

test('poll() shows the REGISTERED count from authed /status, not the active count from /stats', async () => {
  const seen = [];
  const { poll, els } = liftPoll((u, o) => { seen.push([u, o]); return stub((o2) => ({ uptimeMs: 1000, port: 1, counts: o2 && o2.headers && o2.headers.Authorization ? { churches: 3 } : undefined }))(u, o); });
  await poll();
  assert.equal(els['s-churches'].textContent, 3, 'headline did not use /status counts.churches (/stats said 1 active)');
  const st = seen.find(([u]) => String(u).startsWith('/status'));
  assert.ok(st[1].headers && st[1].headers.Authorization, '/status was fetched without the admin token, so counts never arrive');
});

test('poll() falls back to the active count when /status carries no counts', async () => {
  const { poll, els } = liftPoll(stub(() => ({ uptimeMs: 1000, port: 1 })));
  await poll();
  assert.equal(els['s-churches'].textContent, 1);
});

// ---- SERVER half: proves the relay, NOT the client fix ----
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
test('SERVER: 3 registered churches, 1 active => authed /status counts.churches 3, /stats churches.length 1', async () => {
  await requireFreePort(PORT, 'relay-dashboard-count.test.mjs');
  const [a, b, c] = [K(), K(), K()];
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-dcount-'));
  const relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: [a, b, c].map(k => npubEncode(k.pub)).join(',') },
    stdio: 'ignore',
  });
  let ws;
  try {
    const base = `http://127.0.0.1:${PORT}`;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/status')).ok) break; } catch {} await new Promise(r => setTimeout(r, 150)); }
    const token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
    ws = await new Promise((res, rej) => { const w = new WebSocket(`ws://127.0.0.1:${PORT}/relay`); w.on('open', () => res(w)); w.on('error', rej); });
    const evt = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [['church', a.pub]], content: 'hi' }, a.sk);
    const ok = await new Promise((res) => { ws.on('message', d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) res(m[2]); }); ws.send(JSON.stringify(['EVENT', evt])); });
    assert.equal(ok, true);
    const H = { headers: { Authorization: 'Bearer ' + token } };
    const status = await (await fetch(base + '/status', H)).json();
    const stats = await (await fetch(base + '/stats?days=1', H)).json();
    assert.equal(status.counts.churches, 3);
    assert.equal(stats.churches.length, 1);
    assert.equal((await (await fetch(base + '/status')).json()).counts, undefined, 'unauthed /status leaked counts');
  } finally { try { ws.close(); } catch {} try { relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} }
});
