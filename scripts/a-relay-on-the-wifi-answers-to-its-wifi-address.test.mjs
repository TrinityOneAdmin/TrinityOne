// "LET PHONES ON THIS WIFI CONNECT DIRECTLY" MUST ACTUALLY LET THEM.
// Run: node --test scripts/a-relay-on-the-wifi-answers-to-its-wifi-address.test.mjs
//
// Audit finding, 2026-09-14. The Suite's LAN toggle makes the relay LISTEN on the network but nothing
// declared a LAN address, so it answered HTTP 421 "this relay does not declare the address you dialled" to
// every phone on that wifi. The websocket still connected, so ungated reads kept painting while every gated
// read and every publish failed — partial, not an outage.
//
// ⚠ A REAL RELAY IS STARTED AND REALLY DIALLED at a LAN address, with the Host header a phone would send.
// Nothing here matches source text.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8977;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
await requireFreePort(PORT, 'a-relay-on-the-wifi-answers-to-its-wifi-address.test.mjs');

// This machine's own private address — the one a phone on the same wifi would dial.
const LAN = (() => {
  const ifs = networkInterfaces();
  for (const n of Object.keys(ifs || {})) for (const a of (ifs[n] || [])) {
    if (a.internal) continue;
    if (a.family !== 'IPv4' && a.family !== 4) continue;
    const p = String(a.address).split('.').map(Number);
    if (p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168)) return a.address;
  }
  return '';
})();

const dir = mkdtempSync(join(tmpdir(), 'lanrelay-'));
let relay = null;
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const start = () => new Promise((res, rej) => {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    env: { ...process.env, TRINITY_DATA_DIR: dir, RELAY_HOST: '0.0.0.0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const t = setTimeout(() => rej(new Error('relay did not start')), 20000);
  relay.stdout.on('data', (d) => { if (/listening|relay/i.test(String(d))) { clearTimeout(t); setTimeout(res, 600); } });
  relay.on('error', rej);
});

// Ask the way a phone does: the Host header IS the address it dialled.
async function identityAt(host) {
  const nonce = 'a'.repeat(32);
  const r = await fetch(`http://127.0.0.1:${PORT}/relay-identity?nonce=${nonce}&for=${encodeURIComponent('ws://' + host + ':' + PORT + '/relay')}`,
    { headers: { Host: `${host}:${PORT}` } });
  return r.status;
}

test('WITHOUT the toggle, a LAN address is refused — the relay does not declare what nobody asked for',
  { skip: !LAN ? 'no private network address on this machine' : false, timeout: 40000 }, async () => {
  try { unlinkSync(join(dir, 'lan-access')); } catch {}
  await start();
  const code = await identityAt(LAN);
  relay.kill('SIGKILL'); relay = null;
  assert.equal(code, 421,
    'A RELAY NOBODY OPTED IN IS DECLARING LAN ADDRESSES. The toggle is what asks for this; a server that ' +
    'binds 0.0.0.0 by default must not be given declarations it never wanted. Got ' + code);
});

test('WITH the toggle on, the SAME address answers — which is what the toggle promises',
  { skip: !LAN ? 'no private network address on this machine' : false, timeout: 40000 }, async () => {
  // THE DEFECT: measured at 421 before this fix, on exactly this call.
  writeFileSync(join(dir, 'lan-access'), '1');
  await start();
  const code = await identityAt(LAN);
  const loop = await identityAt('127.0.0.1');
  relay.kill('SIGKILL'); relay = null;
  assert.equal(code, 200,
    'THE RELAY LISTENS ON THE WIFI AND THEN REFUSES EVERY PHONE ON IT — 421 "does not declare the address ' +
    'you dialled". The socket still connects, so the app paints half-empty rather than failing. Got ' + code);
  assert.equal(loop, 200, 're-anchor: loopback must keep working, or this proves nothing about the LAN half');
});

test('a PUBLIC address is never declared, whatever the toggle says', () => {
  // The security of "simple". A Suite on a rented server has a public address; declaring it would advertise
  // a publicly reachable relay from a toggle whose words are "phones on this wifi". The three deliberate
  // ways to declare a public address are untouched.
  const src = readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8');
  // Driven, not matched: the predicate is lifted and run over real addresses.
  const i = src.indexOf('function _lanIsPrivate(a) {');
  assert.notEqual(i, -1, '_lanIsPrivate is gone — re-anchor this test');
  const end = src.indexOf('\nfunction _lanAddresses', i);
  const isPrivate = new Function(src.slice(i, end) + '\nreturn _lanIsPrivate;')();
  for (const ip of ['10.0.0.5', '172.16.4.1', '172.31.255.254', '192.168.1.50', '169.254.10.2'])
    assert.equal(isPrivate({ address: ip, family: 'IPv4' }), true, ip + ' is a private address and was refused');
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '203.0.113.7', '192.169.1.1'])
    assert.equal(isPrivate({ address: ip, family: 'IPv4' }), false,
      'A PUBLIC ADDRESS (' + ip + ') WOULD BE DECLARED. The toggle says "phones on this wifi"; this would ' +
      'advertise a publicly reachable relay nobody asked for.');
  assert.equal(isPrivate({ address: 'fd00::1', family: 'IPv6' }), true, 'unique-local v6 was refused');
  assert.equal(isPrivate({ address: 'fe80::1', family: 'IPv6' }), true, 'link-local v6 was refused');
  assert.equal(isPrivate({ address: '2001:db8::1', family: 'IPv6' }), false, 'a PUBLIC v6 address would be declared');
  assert.equal(isPrivate({ address: '127.0.0.1', family: 'IPv4', internal: true }), false, 'an internal iface was included twice');
});
