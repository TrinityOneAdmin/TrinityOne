// Joining a SELF-HOSTED church must not announce itself to the central host.
// Run: node --test scripts/join-resolver.test.mjs
//
// AUDIT-2026-07-29 S3. When an invite carries ?relayname=, the app resolves that name to the relay's current
// URL — because a self-hosted relay behind a free tunnel gets a new URL each restart, so a printed slip's
// ?relay= goes stale and the stable name is the only recovery. Sound reasoning.
//
// It resolved it against `https://app.trinityone.church`, hardcoded, and nothing else. So a member of a
// SELF-HOSTED congregation, joining from a printed slip, made their device tell the central host: this IP
// exists, it is joining now, and it is looking for this relay name. That is the one request that undoes
// self-hosting, at the single most sensitive moment there is — and a congregation runs its own box precisely
// so that no central party sees its people.
//
// /relay-names/resolve/ is public on EVERY relay and the directory is gossiped between them, so the church's
// own relay can answer it. This test stands up TWO real gateways — the church's own and a stand-in for the
// central host — and asserts which one the shipped code actually talks to.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const CHURCH_PORT = 8984, CENTRAL_PORT = 8985;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let churchRelay, dataDir, central, centralHits;

before(async () => {
  await requireFreePort(CHURCH_PORT, 'join-resolver.test.mjs (church relay)');
  await requireFreePort(CENTRAL_PORT, 'join-resolver.test.mjs (central stand-in)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-resolver-'));
  churchRelay = spawn(process.execPath, ['scripts/gateway.mjs', String(CHURCH_PORT)], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dataDir },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${CHURCH_PORT}/status`)).ok) break; } catch {} await sleep(150); }
  // a stand-in for app.trinityone.church that records every request it receives
  centralHits = [];
  central = createServer((req, res) => {
    centralHits.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ handle: 'x', url: 'wss://central.example/relay' }));
  });
  await new Promise(r => central.listen(CENTRAL_PORT, '127.0.0.1', r));
});
after(() => {
  try { churchRelay && churchRelay.kill('SIGKILL'); } catch {}
  try { central && central.close(); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

// Register a name on the CHURCH's own relay, the way a relay claims its handle.
async function claimOnChurchRelay(handle, url) {
  const sk = generateSecretKey();
  const ev = finalizeEvent({
    kind: 27235, created_at: Math.floor(Date.now() / 1000),
    tags: [['handle', handle], ['relay', url]], content: '',
  }, sk);
  const r = await fetch(`http://127.0.0.1:${CHURCH_PORT}/relay-names/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [ev] }),
  });
  const j = await r.json();
  assert.equal(j.merged, 1, 'the fixture could not register a relay name on the church relay');
  assert.equal(getPublicKey(sk).length, 64);
}

// Run the SHIPPED resolver block from app/app.jsx with our own fetch, so what is under test is the real
// control flow — which host it asks, and in what order.
function loadResolver() {
  const SRC = readFileSync(join(ROOT, 'app/app.jsx'), 'utf8');
  const at = SRC.indexOf('const nmm = String(raw || \'\').match(/[?&]relayname=');
  assert.notEqual(at, -1, 'the relayname resolver is gone from app/app.jsx — re-anchor this test');
  const end = SRC.indexOf('} catch (e) {} }', at);
  assert.notEqual(end, -1, 'could not find the end of the resolver block');
  const body = SRC.slice(at, end + '} catch (e) {} }'.length);
  const added = [];
  const asked = [];
  // fetch is STUBBED. The central URL is hardcoded in the app, so a local stand-in server cannot intercept
  // it — and a test must never actually call app.trinityone.church. `answers` maps a host substring to the
  // URL it resolves to; anything else 404s, which is what an unreachable self-hosted box looks like.
  let answers = {};
  const scope = {
    raw: '',
    rm: null,
    F: { addRelay: (u) => added.push(u) },
    fetch: async (u) => {
      asked.push(String(u));
      const hit = Object.keys(answers).find(k => String(u).includes(k));
      if (!hit) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ handle: 'x', url: answers[hit] }) };
    },
    String, decodeURIComponent, encodeURIComponent, Promise,
  };
  return {
    added, asked,
    setAnswers: (a) => { answers = a; },
    run: async (raw, rm) => {
      scope.raw = raw; scope.rm = rm;
      const args = Object.keys(scope);
      const fn = new Function(...args, `return (async () => { ${body} })();`);
      await fn(...args.map(k => scope[k]));
      await sleep(900);   // the resolver is fire-and-forget
    },
  };
}

test('CONTROL: any relay can resolve a name — the premise this fix rests on', async () => {
  // If /relay-names/resolve were central-only, preferring the church's own relay would be nonsense. Proved
  // against a REAL gateway with no church configured and no admin token: it answers.
  await claimOnChurchRelay('stbrides', 'wss://stbrides.example/relay');
  const res = await fetch(`http://127.0.0.1:${CHURCH_PORT}/relay-names/resolve/stbrides`);
  assert.equal(res.status, 200, 'an ordinary relay cannot resolve a relay name, so the church box could not answer this');
  assert.equal((await res.json()).url, 'wss://stbrides.example/relay');
});

test('CONTROL: the resolver asks somebody', async () => {
  const r = loadResolver();
  r.setAnswers({ 'app.trinityone.church': 'wss://central.example/relay' });
  await r.run('?relayname=stbrides', null);
  assert.ok(r.asked.length > 0, 'the resolver asked nobody at all — every assertion below would be vacuous');
});

test('a self-hosted invite resolves against the CHURCH’s relay, and never reaches the central host', async () => {
  const r = loadResolver();
  r.setAnswers({ 'stmarys.example': 'wss://stmarys.example/relay' });
  await r.run('?relayname=stmarys&relay=wss%3A%2F%2Fstmarys.example%2Frelay', [null, 'wss://stmarys.example/relay']);
  assert.ok(r.asked.some(u => u.startsWith('https://stmarys.example/')),
    'it never asked the relay the invite named — it went straight to the central host');
  assert.deepEqual(r.added, ['wss://stmarys.example/relay'], 'the resolved URL was not adopted');
  assert.equal(r.asked.some(u => u.includes('app.trinityone.church')), false,
    'joining a SELF-HOSTED church still told the central host that this device exists, that it is joining now, and what it is looking for');
});

test('but it still falls back when the church’s own relay cannot answer', async () => {
  // A slip may carry a name and no URL, or the self-hosted box may simply be down at that moment. Losing the
  // fallback would trade a privacy leak for members who cannot join at all.
  const r = loadResolver();
  r.setAnswers({ 'app.trinityone.church': 'wss://central.example/relay' });
  await r.run('?relayname=stmarys&relay=wss%3A%2F%2Fdown.example%2Frelay', [null, 'wss://down.example/relay']);
  assert.ok(r.asked.some(u => u.startsWith('https://down.example/')), 'it skipped the church relay entirely');
  assert.ok(r.asked.some(u => u.includes('app.trinityone.church')), 'with no other option it must still ask the shared directory');
  assert.deepEqual(r.added, ['wss://central.example/relay'], 'the fallback answer was not adopted');
});

test('the central host is the LAST entry, never the first', () => {
  const SRC = readFileSync(join(ROOT, 'app/app.jsx'), 'utf8');
  const at = SRC.indexOf('const nmm = String(raw || \'\').match(/[?&]relayname=');
  const body = SRC.slice(at, SRC.indexOf('} catch (e) {} }', at));
  const invite = body.indexOf('hosts.push(v.replace');
  const centralAt = body.indexOf("hosts.push('https://app.trinityone.church')");
  assert.ok(invite !== -1 && centralAt !== -1, 're-anchor: the host list has changed shape');
  assert.ok(invite < centralAt,
    'the central host is consulted before the church’s own relay, which is the finding');
});

test('a resolved URL must still be wss://', async () => {
  // L5. A crafted invite must not talk the app into a cleartext relay by way of the directory.
  const r = loadResolver();
  r.setAnswers({ 'evil.example': 'ws://insecure.example/relay' });
  await r.run('?relayname=x&relay=wss%3A%2F%2Fevil.example%2Frelay', [null, 'wss://evil.example/relay']);
  assert.deepEqual(r.added, [], 'a ws:// (cleartext) relay was adopted from the directory — a network MITM reads everything');
});
