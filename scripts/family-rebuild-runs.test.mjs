// The family rebuild must actually return a child, against a real relay.
// Run: node --test scripts/family-rebuild-runs.test.mjs
//
// AUDIT-2026-07-28 F11. The existing scripts/family-rebuild.test.mjs asserts that the rebuild LOOKS right —
// every assertion in it is a string match on the source, including one called "and it actually runs after an
// identity arrives", which only checks that the call-site TEXT exists. So it was green while the rebuild was
// inert on every path:
//
//   • at a COLD BOOT, _docsHubs is still empty when deriveFromIdentity runs — hubs open once the app knows
//     its church, which is later — so the loop iterated nothing;
//   • on UNLOCK the hubs do exist, and sixteen lines further down reconnectAll() calls pool.close() on every
//     relay socket. That is the socket _rebuildFamily's subscription is riding, so its REQ died before EOSE.
//
// This file drives the SHIPPED _rebuildFamily over a real websocket against a real gateway holding a real
// guardian request, and asserts a child comes back. It also reproduces the socket-teardown case directly,
// because that is the half no amount of reading would have settled.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8976;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), parent = K(), child = K();
let relay, dataDir;

before(async () => {
  await requireFreePort(PORT, 'family-rebuild-runs.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-family-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  // the parent joins, then signs the guardian request that names their child — exactly what the rebuild reads
  const w = await conn();
  await pub(w, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone']], content: JSON.stringify({ joined: now() }) }, parent.sk));
  const [ok, why] = await pub(w, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/guardreq:' + child.pub], ['t', 'trinityone'], ['p', church.pub], ['church', church.pub]], content: JSON.stringify({ at: now() }) }, parent.sk));
  assert.equal(ok, true, 'the fixture could not store the guardian request: ' + why);
  w.close();
  await sleep(300);
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

function conn() { return new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); }); }
function pub(w, e) {
  return new Promise(res => {
    const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); } };
    w.on('message', on); w.send(JSON.stringify(['EVENT', e]));
    setTimeout(() => res(['(no reply)', '']), 5000);
  });
}

// Lift the SHIPPED _rebuildFamily and give it a real pool over a real socket.
const F = readFileSync(ROOT + 'vendor/fellowship.js', 'utf8');
function loadRebuild({ closeSocketAfterMs = 0 } = {}) {
  const at = F.indexOf('function _rebuildFamily(');
  assert.notEqual(at, -1, '_rebuildFamily is gone from the shipped bundle');
  let depth = 0, end = -1;
  for (let i = F.indexOf('{', at); i < F.length; i++) {
    if (F[i] === '{') depth++; else if (F[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const store = { family: [] };
  const sockets = [];
  const scope = {
    pub: parent.pub,
    toPub: (x) => x,
    _dtag: (e) => ((e.tags || []).find(t => t[0] === 'd') || [])[1] || '',
    _loadChildren: () => store.family,
    _saveChildLink: (l) => { store.family = store.family.filter(c => c.child !== l.child).concat(l); },
    relaysForChurch: () => [WS_URL],
    pool: {
      subscribeMany(_r, filters, handlers) {
        let w = null, closed = false;
        conn().then(sock => {
          if (closed) { sock.close(); return; }
          w = sock; sockets.push(sock);
          sock.on('message', d => { const m = JSON.parse(d);
            // The parent's OWN documents are default-deny: canRead grants them only over a NIP-42
            // authenticated socket (`authed === e.pubkey`). The real pool auto-signs the challenge; without
            // this the harness reads nothing and "proves" the bug for the wrong reason.
            if (m[0] === 'AUTH') sock.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, parent.sk)]));
            if (m[0] === 'EVENT' && m[1] === 'f') handlers.onevent(m[2]);
            if (m[0] === 'EOSE' && m[1] === 'f' && handlers.oneose) handlers.oneose(); });
          sock.send(JSON.stringify(['REQ', 'f', ...filters]));
          // the reconnectAll case: pool.close() drops the socket out from under the live REQ
          if (closeSocketAfterMs) setTimeout(() => { try { sock.close(); } catch (e) {} }, closeSocketAfterMs);
        }).catch(() => {});
        return { close() { closed = true; try { w && w.close(); } catch (e) {} } };
      },
    },
    Promise, setTimeout, JSON,
  };
  const args = Object.keys(scope);
  // A function DECLARATION inside parentheses is an expression, not a declaration, so the name never binds.
  // Emit it as a statement and return it by name.
  const fn = new Function(...args, `${F.slice(at, end)}\nreturn _rebuildFamily;`)(...args.map(k => scope[k]));
  return { rebuild: (cp) => fn(cp), store };
}

test('CONTROL: it finds the child when the socket is left alone', async () => {
  // If this fails nothing below means anything — the fixture or the harness is wrong, not the code.
  const { rebuild, store } = loadRebuild();
  const added = await rebuild(church.pub);
  assert.equal(added, 1, 'the rebuild found no child even on a healthy socket — check the fixture');
  assert.equal(store.family.length, 1);
  assert.equal(store.family[0].child, child.pub);
});

test('it returns NOTHING when the socket is torn down under it', async () => {
  // The unlock path, reproduced: deriveFromIdentity started the rebuild and reconnectAll closed every relay
  // socket a few lines later. This is why the parent's children never came back after an unlock.
  const { rebuild, store } = loadRebuild({ closeSocketAfterMs: 1 });
  const added = await rebuild(church.pub);
  assert.equal(added, 0, 'sanity: this case is supposed to lose the child — if it now succeeds, re-check the harness');
  assert.equal(store.family.length, 0);
});

// ── the two structural defects that made the above unreachable in the real app ───────────────────────────
const SRC = readFileSync(ROOT + 'src/fellowship.src.js', 'utf8');

test('the rebuild is not started before the reconnect that kills it', () => {
  const derive = SRC.slice(SRC.indexOf('async function deriveFromIdentity'), SRC.indexOf('let _reconnectGuard'));
  assert.doesNotMatch(derive, /for \(const hub of _docsHubs\.values\(\)\) _rebuildFamily\(hub\.cp\)/,
    'the rebuild still runs inside deriveFromIdentity — empty at a cold boot, and reconnectAll closes its socket on unlock');
});

test('it runs off a hub that has actually answered, with a key present', () => {
  // to the END of the function, not a character window — _docsHubOpen is long and a fixed slice silently
  // stops covering it, which is the bug class that bit five times in one session.
  const from = SRC.indexOf('function _docsHubOpen');
  const open = SRC.slice(from, SRC.indexOf('\nfunction ', from + 10));
  assert.match(open, /if \(sk && !hub\.familyRebuilt\)/,
    'nothing rebuilds the family from a live, keyed socket, so a cold boot still never repairs the phone');
  assert.match(open, /_rebuildFamily\(hub\.cp\)/, 'the rebuild is not called from the hub');
});

test('a reconnect re-arms it', () => {
  const rc = SRC.slice(SRC.indexOf('function reconnectAll'), SRC.indexOf('function reconnectAll') + 1200);
  assert.match(rc, /hub\.familyRebuilt = false/,
    'after an unlock reconnect the flag stays set, so the one socket that COULD have rebuilt never tries');
});

test('a rebuilt child is not left nameless on the family screen', () => {
  // The guardian request stopped carrying the child's name in the clear (AUDIT-2026-07-27, correctly), so the
  // rebuild has nothing to store and the row rendered blank. identity.jsx prints {k.name} directly.
  const at = SRC.indexOf('myChildren(churchNpub)');
  assert.notEqual(at, -1, 'myChildren is gone — re-anchor this test');
  const fn = SRC.slice(at, at + 900);
  assert.match(fn, /displayFor\(c\.child\)/,
    'a rebuilt child has no name and nothing resolves one, so the parent sees an empty row where their child was');
});
