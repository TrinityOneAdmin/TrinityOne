// A CHURCH ITS RELAY HAS FORGOTTEN MUST TRY AGAIN. Run:
//   node --test scripts/a-refused-church-tries-registering-again.test.mjs
//
// 2026-09-08. A church could not save "people must be approved before they can join", for ever, while a
// church created the same afternoon was fine. The relay refuses that write unless it carries the church
// (gateway.mjs:2288 -> leaderOf -> CHURCH_PUBS.has), and the console's own retry could never put it back:
//
//     const mark = churchPub + '@' + base;
//     if (!force && done[mark]) continue;        // src/steward.src.js:7195
//
// `done[mark]` is written on SUCCESS (:7207) and never cleared, and until this change nothing anywhere
// passed `force`. So a relay that later LOST the church — reset, restored without its church.json, moved
// to new hardware — was skipped by that console for ever. A success marker no later failure could undo.
//
// TWO HALVES, and both have to hold or the fix is decorative:
//   1. the ENGINE honours force — proved against a real gateway, because a stub answering the question the
//      test is named after proves nothing;
//   2. the CONSOLE passes it, and only when a relay has actually refused us. app/stew-dashboard.jsx ships
//      UNBUNDLED, so under CLAUDE.md rule 3 a text assertion about that line would still pass with
//      `false && ` in front of it. Rule 3's remedy is "lift the function and run it" — so the retry lives
//      in the named hook useRegistrationRetry(), and this test slices it out and runs it under the mini
//      React in render-jsx-screen.mjs, whose useEffect really queues and compares deps.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';
import { miniReact } from './render-jsx-screen.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8772;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let relay = null, dataDir = null, token = '';

before(async () => {
  await requireFreePort(PORT, 'a-refused-church-tries-registering-again.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'refused-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dataDir },
  });
  for (let i = 0; i < 60; i++) { await sleep(250); try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} }
  try { token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || ''; } catch {}
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── 1. THE ENGINE ────────────────────────────────────────────────────────────────────────────────────
// THE PATH FORCE ACTUALLY TAKES, which is NOT the operator's. selfRegister posts a NIP-98-signed
// { addChurch } to /config (src/steward.src.js:7202) and that sits behind the private-relay, invite-only
// and cap gates (gateway.mjs:4130-4165) which the admin `churches:` write bypasses entirely. An earlier
// version of this test dropped and re-added the church with the admin token, proved the operator can do it,
// and passed identically on the parent commit — it guarded nothing about this change.
const nip98 = (sk, url) => finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1e3), tags: [['u', url], ['method', 'POST']], content: '' }, sk);
const cfgAdmin = (churches) => fetch(`http://127.0.0.1:${PORT}/config`, { method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ churches: churches.map(npub => ({ npub })) }) });
const setSettings = (s) => fetch(`http://127.0.0.1:${PORT}/settings`, { method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
async function selfRegisterAs(sk, npub) {
  const url = `http://127.0.0.1:${PORT}/config`;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addChurch: { npub, name: 'Forgotten Church' }, auth: nip98(sk, url) }) });
  let why = ''; try { why = ((await r.json()) || {}).error || ''; } catch {}
  return { status: r.status, why };
}

test('a COMMUNITY relay that has forgotten a church will take it back', async () => {
  assert.ok(token, 'no admin token — the test could not configure the relay');
  const keepSk = generateSecretKey(), keep = npubEncode(getPublicKey(keepSk));
  const goneSk = generateSecretKey(), gone = npubEncode(getPublicKey(goneSk));
  // gateway.mjs refuses to remove the ONLY church, so two are seeded and one dropped — this is the state
  // a relay is in for a church it used to carry.
  assert.equal((await cfgAdmin([keep, gone])).ok, true, 'could not seed two churches');
  assert.equal((await cfgAdmin([keep])).ok, true, 'could not drop the church — re-anchor this test');
  assert.equal((await setSettings({ offerHosting: true })).ok, true, 'could not put the relay in community mode');
  await sleep(300);
  const r = await selfRegisterAs(goneSk, gone);
  assert.equal(r.status, 200,
    `re-registering a forgotten church was refused (${r.status} ${r.why}). If this fails the fix reaches ` +
    'nothing: the console can stop skipping the relay and still never get the church back on it.');
});

// THE ROW THE SCOPE TABLE MUST CARRY. A private relay is the Suite DEFAULT (gateway.mjs:99
// offerHosting:false), and a private relay that still holds another church refuses the forced retry
// (:4142). Forcing is then correct and still useless, and only the operator can resolve it. Pinned so the
// limit is a measured fact rather than a paragraph nobody re-checks.
test('a PRIVATE relay still holding another church refuses it — the fix does NOT cover this', async () => {
  const keepSk = generateSecretKey(), keep = npubEncode(getPublicKey(keepSk));
  const goneSk = generateSecretKey(), gone = npubEncode(getPublicKey(goneSk));
  assert.equal((await setSettings({ offerHosting: false })).ok, true, 'could not put the relay back to private');
  assert.equal((await cfgAdmin([keep, gone])).ok, true, 'could not seed two churches');
  assert.equal((await cfgAdmin([keep])).ok, true, 'could not drop the church');
  await sleep(300);
  const r = await selfRegisterAs(goneSk, gone);
  assert.equal(r.status, 403,
    'a private relay accepted a forgotten church back. That is a WIDENING — self-registration on a private ' +
    'box is bootstrap-only by design (RELAY-AUDIT-2026-07-20 H4), and it is what turned one box into 19 ' +
    'tenants. If this is now allowed it was not allowed deliberately.');
  assert.match(r.why, /already set up for its church/, 'refused for a different reason than the bootstrap lock');
});

// ── 2. THE CONSOLE ───────────────────────────────────────────────────────────────────────────────────
// The real hook, sliced out of app/stew-dashboard.jsx and RUN. Delete the `force` argument, or invert the
// condition, and these go red — which a text match on that file could not do.
async function runHook({ refused, actingChurch = '', name = 'Grace Church' }) {
  const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
  // SLICE THE REAL FLAG TOO, not just the hook. Stubbing relayRejectionActive() would only prove "if this
  // returns true, force is passed" — it would say nothing about the flag noteRelayRejection() actually
  // writes, which is the link the whole fix hangs on. With the `typeof` guard in the hook, a real function
  // that was renamed or broken would force nothing, throw nothing, and leave a stubbed test green.
  const src = [
    fnBody(DASH, 'function noteRelayRejection(', 'noteRelayRejection'),
    fnBody(DASH, 'function clearRelayRejection(', 'clearRelayRejection'),
    fnBody(DASH, 'function relayRejectionActive(', 'relayRejectionActive'),
    fnBody(DASH, 'function useRegistrationRetry(', 'useRegistrationRetry'),
  ].join('\n');
  const tmp = join(tmpdir(), 'reg-retry-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    // fnBody() returns the WHOLE function, signature included — wrapping it in another `function
    // useRegistrationRetry(...) { }` nests it inside itself, so the outer one declares the inner and does
    // nothing. That is not a loud failure: the two tests that assert NO call passed vacuously over it.
    writeFileSync(tmp, src + '\nexport { useRegistrationRetry, noteRelayRejection, relayRejectionActive };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }

  const calls = [];
  let entered = 0;                                   // the effect body read window.Steward → it really ran
  const { React, draw } = miniReact();
  const steward = { actingChurch, selfRegister: (n, opts) => { calls.push({ n, opts }); return Promise.resolve(); } };
  const win = {};
  Object.defineProperty(win, 'Steward', { get() { entered++; return steward; } });
  // a localStorage the sliced recorder can really write to, so the flag is DRIVEN, never simulated
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  win.REG_NEEDED_LS = 'trinityone.steward.relay-rejected';
  win.addEventListener = () => {}; win.dispatchEvent = () => true;
  const key = '__reg_' + Math.random().toString(36).slice(2);
  globalThis[key] = { React, window: win, localStorage, CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } } };
  const pre = `const React = globalThis.${key}.React; const window = globalThis.${key}.window;`
    + ` const localStorage = globalThis.${key}.localStorage; const CustomEvent = globalThis.${key}.CustomEvent;`
    + ` const REG_NEEDED_TTL = 7*24*60*60*1000;`;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
  // the flag arrives the ONLY way it arrives in the app: a refusal was recorded.
  if (refused) mod.noteRelayRejection();
  draw(() => { mod.useRegistrationRetry(name); return null; }, {});
  await sleep(0);
  delete globalThis[key];
  return { calls, entered };
}

test('with no refusal on record the console asks exactly as it always did', async () => {
  const { calls, entered } = await runHook({ refused: false });
  assert.ok(entered > 0, 'the effect never ran — this harness would pass any assertion about calls it did not make');
  assert.equal(calls.length, 1, 'the ordinary retry stopped running — every church now depends on this');
  assert.equal(calls[0].n, 'Grace Church');
  assert.ok(!calls[0].opts || calls[0].opts.force !== true,
    'a healthy church is forcing. The whole safety argument for this change is that the ordinary path is ' +
    'unchanged, so it cannot make a working church worse.');
});

test('once a relay has refused us, the console stops skipping it', async () => {
  const { calls, entered } = await runHook({ refused: true });
  assert.ok(entered > 0, 'the effect never ran — see the fnBody note above');
  assert.equal(calls.length, 1, 'the retry did not run at all when a refusal was on record');
  assert.equal(calls[0].opts && calls[0].opts.force, true,
    'the console still passes no force, so selfRegister skips every relay it once succeeded at ' +
    '(steward.src.js:7195) and a church its relay has forgotten can never get back on it.');
});

test('a delegated steward never registers the church they are helping', async () => {
  const { calls, entered } = await runHook({ refused: true, actingChurch: 'f'.repeat(64) });
  assert.ok(entered > 0, 'the effect never ran, so "no call" proves nothing');
  assert.deepEqual(calls, [],
    'a delegate fired self-registration. That registered THEIR OWN key under the helped church’s name ' +
    'once already — the guard must survive both the hook extraction and the force change.');
});

test('with no name there is nothing to register under, forced or not', async () => {
  const { calls, entered } = await runHook({ refused: true, name: '' });
  assert.ok(entered > 0, 'the effect never ran, so "no call" proves nothing');
  assert.deepEqual(calls, [],
    'a nameless self-registration went out. The relay refuses those (steward-root.jsx:342) and it wastes ' +
    'the registration gate.');
});
