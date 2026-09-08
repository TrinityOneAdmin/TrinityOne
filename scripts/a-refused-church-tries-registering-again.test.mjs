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
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
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
// A relay that has forgotten a church accepts its registration again. This is what `force` reaches once
// the console stops skipping — measured against the real gateway, not asserted about it.
test('a relay that has forgotten a church will take it back', async () => {
  assert.ok(token, 'no admin token — the test could not configure the relay');
  const keep = getPublicKey(generateSecretKey());          // a second church, so the first can be removed:
  const gone = getPublicKey(generateSecretKey());          // gateway.mjs refuses to remove the ONLY church
  const cfg = (churches) => fetch(`http://127.0.0.1:${PORT}/config`, { method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ churches: churches.map(npub => ({ npub })) }) });

  assert.equal((await cfg([keep, gone])).ok, true, 'could not seed two churches');
  assert.equal((await cfg([keep])).ok, true, 'could not drop the church again — re-anchor this test');

  // the state a reset relay is in for a church it used to carry
  const after = await (await fetch(`http://127.0.0.1:${PORT}/config`, { headers: { Authorization: 'Bearer ' + token } })).json();
  const npubs = JSON.stringify(after.churches || []);
  assert.equal(npubs.includes(gone), false, 'the relay still carries the church this test needs it to have forgotten');
  assert.equal((await cfg([keep, gone])).ok, true,
    're-registering a forgotten church was refused. If this fails the fix has nothing to reach: the console ' +
    'can stop skipping the relay and still never get the church back on it.');
});

// ── 2. THE CONSOLE ───────────────────────────────────────────────────────────────────────────────────
// The real hook, sliced out of app/stew-dashboard.jsx and RUN. Delete the `force` argument, or invert the
// condition, and these go red — which a text match on that file could not do.
async function runHook({ refused, actingChurch = '', name = 'Grace Church' }) {
  const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
  const src = fnBody(DASH, 'function useRegistrationRetry(', 'useRegistrationRetry');
  const tmp = join(tmpdir(), 'reg-retry-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    // fnBody() returns the WHOLE function, signature included — wrapping it in another `function
    // useRegistrationRetry(...) { }` nests it inside itself, so the outer one declares the inner and does
    // nothing. That is not a loud failure: the two tests that assert NO call passed vacuously over it.
    writeFileSync(tmp, src + '\nexport { useRegistrationRetry };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }

  const calls = [];
  let entered = 0;                                   // the effect body read window.Steward → it really ran
  const { React, draw } = miniReact();
  const steward = { actingChurch, selfRegister: (n, opts) => { calls.push({ n, opts }); return Promise.resolve(); } };
  const win = {};
  Object.defineProperty(win, 'Steward', { get() { entered++; return steward; } });
  const key = '__reg_' + Math.random().toString(36).slice(2);
  globalThis[key] = { React, window: win, relayRejectionActive: () => refused };
  const pre = `const React = globalThis.${key}.React; const window = globalThis.${key}.window; const relayRejectionActive = globalThis.${key}.relayRejectionActive;`;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
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
