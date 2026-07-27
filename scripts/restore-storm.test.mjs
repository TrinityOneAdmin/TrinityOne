// Does a 12-word restore that finds NO church quietly turn the phone into a broadcast station?
// Run: node --test scripts/restore-storm.test.mjs
//
// AUDIT-2026-07-26 CRITICAL 4. The restore-recovery effect in app/app.jsx polled every 4 seconds, forever:
// it never re-read the pending flag, never cleared its interval, had no in-flight guard, and its one guard
// (`relaysHealthy()`) returned true even when nothing was connected. Each pass called saveIdentity() ->
// setProfile(), which built a FRESH kind-0 with a new created_at and published it with no diff — so a restored
// member republished their profile ~15 times a minute, forever, to every relay, and every member of the church
// received all of it on their batched {kinds:[0],authors:[…]} subscription. It could never converge, because
// recoverIdentity subscribes to the member's own kind-0 and therefore re-found the name it had just written.
//
// This test is END-TO-END on purpose: it runs the REAL app in a REAL browser against a REAL relay and COUNTS
// what lands on the wire. Every cheaper version of this check (reading the effect, unit-testing setProfile)
// was available to the session that shipped the bug.
//
// Shape: boot the app pointed at a local relay, plant a kind-0 so the recovery has a name to find, leave
// `restorePending` set with no church to find (the exact trigger), then watch the relay for 30 seconds.
//
// Skips itself (rather than failing) when chromium is unavailable, like app-boots.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8894, CDP = 9351;   // unique across scripts/*.test.mjs — a duplicate fixed port deadlocks both files
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WATCH_MS = 30000;          // long enough for ~5 publishes at the broken cadence (one attempt ≈ 6s locally)
let relay, dataDir;

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

before(async () => {
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-storm-'));
  // A relay with NO CHURCH_NPUB refuses every publish, so the test would prove nothing (HANDOFF §4). Give it a
  // throwaway church — never a real one; this app dials whatever it is told and we do not want it on a8.
  const cp = getPublicKey(generateSecretKey());
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// count kind-0 events this pubkey publishes AFTER the subscription's EOSE (i.e. new publishes, not the stored one)
async function countProfilePublishes(pubkey, ms) {
  const ws = new WebSocket(WS_URL);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let live = false, n = 0;
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    if (m[0] === 'EOSE') { live = true; return; }
    if (m[0] === 'EVENT' && live && m[2] && m[2].kind === 0 && m[2].pubkey === pubkey) n++;
  });
  ws.send(JSON.stringify(['REQ', 'storm', { kinds: [0], authors: [pubkey] }]));
  await sleep(ms);
  try { ws.close(); } catch {}
  return n;
}

test('a restore that finds no church does not republish the profile on a loop', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const prof = join(tmpdir(), 'trin-chr-storm-' + process.pid);
  // Never let a test reach production (the app dials CANONICAL_RELAYS regardless of who served the page).
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
    assert.ok(targets && targets.length, 'chromium never exposed a debug target');
    const page = targets.find(t => t.type === 'page') || targets[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    let id = 0; const pend = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
      return r.result.result.value;
    };
    await send('Runtime.enable'); await send('Page.enable');
    await sleep(2500);
    // Seed the exact state a restore leaves behind: onboarded, pointed at THIS relay, and `restorePending`
    // still set because no church came back. Written raw — the flag is read with a literal === '1'.
    await evalJs(`(() => {
      localStorage.setItem('trinityone.relays', ${JSON.stringify(JSON.stringify([WS_URL]))});
      localStorage.setItem('trinityone.onboarded', 'true');
      localStorage.setItem('trinityone.restorePending', '1');
    })()`);
    await send('Page.reload', { ignoreCache: false });
    await sleep(4000);
    const pubkey = await evalJs(`(async () => { await window.Fellowship.ready; for (let i=0;i<40 && !window.Fellowship.myPubkey;i++) await new Promise(r=>setTimeout(r,250)); return window.Fellowship.myPubkey || ''; })()`);
    assert.match(pubkey || '', /^[0-9a-f]{64}$/, 'the app never derived an identity');
    // Plant the name the recovery will find. This is what made the loop self-sustaining: recoverIdentity
    // subscribes to the member's own kind-0, so every republish re-satisfied the next pass.
    await evalJs(`(async () => { await window.Fellowship.setProfile({ name: 'Storm Test' }); return 1; })()`);
    await sleep(1500);
    const n = await countProfilePublishes(pubkey, WATCH_MS);
    // One is forgivable (a restored member adopting a recovered name they did not have). A loop is not.
    assert.ok(n <= 1, `the app published ${n} kind-0 profile events in ${WATCH_MS / 1000}s with restorePending set — that is a broadcast storm to every member of the church`);
    // The flag's convergence is asserted in the source test below rather than here: since Stage 2 the name is
    // no longer in kind-0, so this church-less member has genuinely nothing to recover, and the chain has to
    // run its full four minutes before it can say so — longer than this test's budget. What this test exists
    // for is the STORM bound above, and that is unchanged.
    ws.close();
  } finally { try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} }
});

test('the recovery chain gives up once it has actually asked', () => {
  // The flag used to be left armed whenever nothing came back, so the whole four-minute chain re-ran on every
  // launch for ever. Survivable while the name lived in kind-0 — almost every restore found something — but
  // Stage 2 removed it, and a member who belongs to no church has nothing to recover by definition.
  // AUDIT-2026-07-27.
  const SRC = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
  const at = SRC.indexOf('const next = () => {');
  assert.notEqual(at, -1, 'the recovery chain scheduler is gone');
  const body = SRC.slice(at, at + 400);
  assert.match(body, /tries >= DELAYS\.length[\s\S]{0,160}removeItem\('trinityone\.restorePending'\)/,
    'exhausting the retries leaves the flag armed, so the whole chain re-runs on every launch for ever');
  // …but a connection that never came up must still be retried next launch.
  const runAt = SRC.indexOf('if (waits++ < 30)');
  assert.notEqual(runAt, -1, 'the not-connected-yet branch is gone');
  assert.doesNotMatch(SRC.slice(runAt - 300, runAt + 120), /removeItem\('trinityone\.restorePending'\)/,
    'a member who restored with no connection would be left church-less for ever');
});
